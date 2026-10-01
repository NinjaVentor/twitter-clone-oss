package handlers

import (
	"context"
	"strconv"
	"time"

	"twitter-server/internal/algorithm"
	"twitter-server/internal/models"

	"github.com/gofiber/fiber/v2"
)

func (h *Handler) queryCandidates(ctx context.Context, q string, args ...any) ([]models.Tweet, error) {
	rows, err := h.Pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	return scanTweets(rows)
}

// rankedForYouFeed implements the personalized For You recommendation feed:
// candidate sourcing (in-network, social proof, discovery), scoring via the
// ranker, author-diversity re-ranking, and offset pagination.
func (h *Handler) rankedForYouFeed(c *fiber.Ctx, viewerID int64, offset, limit int) error {
	ctx := c.Context()
	now := time.Now()

	aff := algorithm.GetAffinities(ctx, h.VC, h.Pool, viewerID)

	// Followed-author set for follow + social-proof boosts.
	followed := map[int64]bool{}
	if rows, err := h.Pool.Query(ctx, `SELECT following_id FROM public.follows WHERE follower_id = $1`, viewerID); err == nil {
		for rows.Next() {
			var id int64
			if serr := rows.Scan(&id); serr == nil {
				followed[id] = true
			}
		}
		rows.Close()
	}

	// 1. In-network (self + followed), newest first.
	inNet, err := h.queryCandidates(ctx, `
		SELECT `+tweetColumns+` FROM public.tweets t
		WHERE t.parent_id IS NULL
		  AND (t.user_id = $1 OR EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = $1 AND f.following_id = t.user_id))
		ORDER BY t.id DESC LIMIT 120`, viewerID)
	if err != nil {
		return dberr(c, "foryou candidates", err)
	}
	// 2. Out-of-network social proof: liked/retweeted by followed accounts.
	social, err := h.queryCandidates(ctx, `
		SELECT `+tweetColumns+` FROM public.tweets t
		WHERE t.parent_id IS NULL
		  AND t.user_id <> $1
		  AND NOT EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = $1 AND f.following_id = t.user_id)
		  AND EXISTS (
			SELECT 1 FROM public.likes l WHERE l.tweet_id = t.id
			  AND EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = $1 AND f.following_id = l.user_id)
			UNION
			SELECT 1 FROM public.retweets r WHERE r.tweet_id = t.id
			  AND EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = $1 AND f.following_id = r.user_id)
		  )
		ORDER BY t.id DESC LIMIT 50`, viewerID)
	if err != nil {
		return dberr(c, "foryou candidates", err)
	}
	// 3. Recent discovery: newest top-level tweets overall.
	discovery, err := h.queryCandidates(ctx, `
		SELECT `+tweetColumns+` FROM public.tweets t
		WHERE t.parent_id IS NULL
		ORDER BY t.id DESC LIMIT 30`)
	if err != nil {
		return dberr(c, "foryou candidates", err)
	}

	// Merge + dedupe (cap 200).
	seenIDs := map[int64]bool{}
	merged := make([]models.Tweet, 0, 200)
	for _, list := range [][]models.Tweet{inNet, social, discovery} {
		for _, tw := range list {
			if seenIDs[tw.ID] {
				continue
			}
			seenIDs[tw.ID] = true
			merged = append(merged, tw)
			if len(merged) >= 200 {
				break
			}
		}
		if len(merged) >= 200 {
			break
		}
	}
	if len(merged) == 0 {
		return c.JSON(fiber.Map{"tweets": []models.HydratedTweet{}, "next_cursor": nil})
	}

	// 4. Social-proof counts: followed accounts that liked/retweeted each candidate.
	ids := make([]int64, 0, len(merged))
	for _, tw := range merged {
		ids = append(ids, tw.ID)
	}
	proof := map[int64]int{}
	if rows, err := h.Pool.Query(ctx, `
		SELECT tweet_id, COUNT(DISTINCT user_id) FROM (
			SELECT l.tweet_id, l.user_id FROM public.likes l
			 WHERE l.tweet_id = ANY($2) AND EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = $1 AND f.following_id = l.user_id)
			UNION ALL
			SELECT r.tweet_id, r.user_id FROM public.retweets r
			 WHERE r.tweet_id = ANY($2) AND EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = $1 AND f.following_id = r.user_id)
		) s GROUP BY tweet_id`, viewerID, ids); err == nil {
		for rows.Next() {
			var tid int64
			var n int
			if serr := rows.Scan(&tid, &n); serr == nil {
				proof[tid] = n
			}
		}
		rows.Close()
	}

	// 5. Hydrate, score, diversify.
	hydrated, herr := h.hydrateTweets(ctx, merged, viewerID)
	if herr != nil {
		return dberr(c, "foryou hydrate", herr)
	}
	scored := make([]algorithm.ScoredTweet, 0, len(hydrated))
	for _, ht := range hydrated {
		var tagSum float64
		for _, tag := range algorithm.TagsFor(ht.Content) {
			tagSum += aff.Tags[tag]
		}
		s := algorithm.ScoreTweet(ht, viewerID, aff.Authors[ht.UserID], tagSum, followed[ht.UserID], proof[ht.ID], aff.Seen[ht.ID], now)
		scored = append(scored, algorithm.ScoredTweet{Tweet: ht, Score: s})
	}
	ranked := algorithm.RankScores(scored)

	// 6. Deterministic offset pagination.
	pageIdx, next := algorithm.Paginate(ranked, offset, limit)
	page := make([]models.HydratedTweet, 0, len(pageIdx))
	for _, s := range pageIdx {
		page = append(page, s.Tweet)
	}
	var nextCursor *string
	if next >= 0 {
		nc := strconv.Itoa(next)
		nextCursor = &nc
	}
	return c.JSON(fiber.Map{"tweets": page, "next_cursor": nextCursor})
}
