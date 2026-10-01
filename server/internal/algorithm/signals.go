package algorithm

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"time"

	"twitter-server/internal/valkey"

	"github.com/jackc/pgx/v5/pgxpool"
	vk "github.com/valkey-io/valkey-go"
)

// Engagement weights inspired by twitter/the-algorithm.
const (
	WView    = 0.5
	WProfile = 1.5
	WSearch  = 1.5
	WLike    = 3.0
	WBookmark = 4.0
	WRetweet = 5.0
	WReply   = 7.0
	WFollow  = 2.0
)

// SeenTTLSeconds keeps viewed tweet IDs for 48 hours.
const SeenTTLSeconds = int64(48 * 3600)

// AuthorAffinityKey maps target_author_id -> score for a viewer.
func AuthorAffinityKey(userID int64) string {
	return "affinity:authors:" + strconv.FormatInt(userID, 10)
}

// TagAffinityKey maps lowercase hashtag/keyword -> score for a viewer.
func TagAffinityKey(userID int64) string {
	return "affinity:tags:" + strconv.FormatInt(userID, 10)
}

// SeenKey holds tweet IDs a viewer has already seen.
func SeenKey(userID int64) string {
	return "seen:tweets:" + strconv.FormatInt(userID, 10)
}

var hashtagRe = regexp.MustCompile(`#[A-Za-z0-9_]+`)

// TagsFor extracts lowercase hashtags (with leading #) from tweet content.
func TagsFor(content string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range hashtagRe.FindAllString(content, -1) {
		tag := strings.ToLower(m)
		if len(tag) < 2 || seen[tag] {
			continue
		}
		seen[tag] = true
		out = append(out, tag)
	}
	return out
}

// QueryTags tokenizes a free-text search query into tag-like terms.
func QueryTags(q string) []string {
	seen := map[string]bool{}
	var out []string
	for _, tok := range strings.Fields(strings.ToLower(q)) {
		tok = strings.Trim(tok, "#@.,!?;:\"'()[]")
		if len(tok) < 2 || seen[tok] {
			continue
		}
		seen[tok] = true
		out = append(out, tok)
		if len(out) >= 10 {
			break
		}
	}
	return out
}

// RecordSignal adds delta affinity for an author and their tags. Best effort.
// A non-positive authorID records tag-only affinity (used by search).
func RecordSignal(ctx context.Context, vc vk.Client, userID int64, delta float64, authorID int64, tags []string) {
	if vc == nil || delta == 0 {
		return
	}
	if authorID > 0 {
		_ = vstore.ZIncrBy(ctx, vc, AuthorAffinityKey(userID), strconv.FormatInt(authorID, 10), delta)
	}
	for _, tag := range tags {
		if tag == "" {
			continue
		}
		_ = vstore.ZIncrBy(ctx, vc, TagAffinityKey(userID), tag, delta)
	}
}

// RecordEngagement is shorthand for author + content-tag affinity.
func RecordEngagement(ctx context.Context, vc vk.Client, viewerID, authorID int64, content string, weight float64) {
	RecordSignal(ctx, vc, viewerID, weight, authorID, TagsFor(content))
}

// MarkSeen records a viewed tweet ID with a 48h TTL. Best effort.
func MarkSeen(ctx context.Context, vc vk.Client, userID, tweetID int64) {
	if vc == nil {
		return
	}
	key := SeenKey(userID)
	_ = vstore.ZAdd(ctx, vc, key, map[string]float64{strconv.FormatInt(tweetID, 10): float64(nowUnix())})
	_ = vstore.Expire(ctx, vc, key, SeenTTLSeconds)
}

func nowUnix() int64 {
	return time.Now().Unix()
}

// Affinities bundles a viewer's interest maps plus seen-tweet set.
type Affinities struct {
	Authors map[int64]float64
	Tags    map[string]float64
	Seen    map[int64]bool
}

// GetAffinities loads Valkey affinity maps, hydrating from Postgres on
// cold start (both ZSETs empty).
func GetAffinities(ctx context.Context, vc vk.Client, pool *pgxpool.Pool, userID int64) Affinities {
	a := Affinities{
		Authors: map[int64]float64{},
		Tags:    map[string]float64{},
		Seen:    map[int64]bool{},
	}
	if vc != nil {
		if members, scores, err := vstore.ZRevRangeWithScores(ctx, vc, AuthorAffinityKey(userID), 0, -1); err == nil {
			for i, m := range members {
				if id, perr := strconv.ParseInt(m, 10, 64); perr == nil {
					a.Authors[id] = scores[i]
				}
			}
		}
		if members, scores, err := vstore.ZRevRangeWithScores(ctx, vc, TagAffinityKey(userID), 0, -1); err == nil {
			for i, m := range members {
				a.Tags[m] = scores[i]
			}
		}
		if members, _, err := vstore.ZRevRangeWithScores(ctx, vc, SeenKey(userID), 0, -1); err == nil {
			for _, m := range members {
				if id, perr := strconv.ParseInt(m, 10, 64); perr == nil {
					a.Seen[id] = true
				}
			}
		}
	}
	if len(a.Authors) == 0 && len(a.Tags) == 0 && pool != nil {
		hydrateFromPostgres(ctx, vc, pool, userID, &a)
	}
	return a
}

// hydrateFromPostgres derives initial affinities from historical likes,
// retweets, bookmarks, follows, and replies in a single fast query.
func hydrateFromPostgres(ctx context.Context, vc vk.Client, pool *pgxpool.Pool, userID int64, a *Affinities) {
	rows, err := pool.Query(ctx, `
		SELECT t.user_id, t.content, 3.0 FROM public.likes l JOIN public.tweets t ON t.id = l.tweet_id WHERE l.user_id = $1
		UNION ALL SELECT t.user_id, t.content, 5.0 FROM public.retweets r JOIN public.tweets t ON t.id = r.tweet_id WHERE r.user_id = $1
		UNION ALL SELECT t.user_id, t.content, 4.0 FROM public.bookmarks b JOIN public.tweets t ON t.id = b.tweet_id WHERE b.user_id = $1
		UNION ALL SELECT p.user_id, p.content, 7.0 FROM public.tweets t JOIN public.tweets p ON p.id = t.parent_id WHERE t.user_id = $1 AND t.parent_id IS NOT NULL
		UNION ALL SELECT f.following_id, '', 2.0 FROM public.follows f WHERE f.follower_id = $1
		LIMIT 2000`, userID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var author int64
		var content string
		var w float64
		if err := rows.Scan(&author, &content, &w); err != nil {
			continue
		}
		a.Authors[author] += w
		for _, tag := range TagsFor(content) {
			a.Tags[tag] += w
		}
	}
	// Warm Valkey so the next request hits cache (cap map sizes).
	if vc == nil {
		return
	}
	trimFloatMap(a.Authors, 200)
	trimStringMap(a.Tags, 200)
	authorMembers := make(map[string]float64, len(a.Authors))
	for id, s := range a.Authors {
		authorMembers[strconv.FormatInt(id, 10)] = s
	}
	_ = vstore.ZAdd(ctx, vc, AuthorAffinityKey(userID), authorMembers)
	_ = vstore.ZAdd(ctx, vc, TagAffinityKey(userID), a.Tags)
}

func trimFloatMap(m map[int64]float64, keep int) {
	for len(m) > keep {
		var worst int64
		var worstScore float64
		first := true
		for id, s := range m {
			if first || s < worstScore {
				worst, worstScore, first = id, s, false
			}
		}
		delete(m, worst)
	}
}

func trimStringMap(m map[string]float64, keep int) {
	for len(m) > keep {
		var worst string
		var worstScore float64
		first := true
		for tag, s := range m {
			if first || s < worstScore {
				worst, worstScore, first = tag, s, false
			}
		}
		delete(m, worst)
	}
}
