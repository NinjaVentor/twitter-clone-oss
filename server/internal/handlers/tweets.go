package handlers

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"time"

	"twitter-server/internal/algorithm"
	"twitter-server/internal/middleware"
	"twitter-server/internal/models"
	sf "twitter-server/internal/snowflake"
	"twitter-server/internal/storage"
	vstore "twitter-server/internal/valkey"
	"twitter-server/internal/ws"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	hashtagRe = regexp.MustCompile(`#[A-Za-z0-9_]+`)
	mentionRe = regexp.MustCompile(`@([A-Za-z0-9_]{1,15})`)
)

const tweetColumns = `id, user_id, content, parent_id, quote_of_id, repost_of_id,
	COALESCE(media_urls,'[]')::text, COALESCE(poll_data::text, ''),
	COALESCE(like_count,0), COALESCE(retweet_count,0), COALESCE(reply_count,0), COALESCE(quote_count,0), COALESCE(bookmark_count,0), COALESCE(view_count,0), created_at`

// tweetColumnsT is tweetColumns qualified for the "t" alias. Use it whenever
// tweets are JOINed: likes/bookmarks tables also carry user_id/created_at,
// so the bare list is ambiguous there and Postgres 500s.
// ponytail: keep in sync with tweetColumns (same order, same expressions).
const tweetColumnsT = `t.id, t.user_id, t.content, t.parent_id, t.quote_of_id, t.repost_of_id,
	COALESCE(t.media_urls,'[]')::text, COALESCE(t.poll_data::text, ''),
	COALESCE(t.like_count,0), COALESCE(t.retweet_count,0), COALESCE(t.reply_count,0), COALESCE(t.quote_count,0), COALESCE(t.bookmark_count,0), COALESCE(t.view_count,0), t.created_at`

type createTweetBody struct {
	Content   string   `json:"content"`
	ParentID  any      `json:"parent_id"`
	ParentID2 any      `json:"parentId"`
	QuoteOfID any      `json:"quote_of_id"`
	QuoteOfID2 any     `json:"quoteOfId"`
	RepostOfID any     `json:"repost_of_id"`
	RepostOfID2 any    `json:"repostOfId"`
	MediaURLs []string `json:"media_urls"`
	Poll      *struct {
		Options         []string `json:"options"`
		DurationMinutes int      `json:"duration_minutes"`
	} `json:"poll_data"`
}

// parseSnowflakeID accepts IDs as JSON strings, numbers, or nil and returns
// a *int64 (nil stays nil) so parent/quote/repost links are never dropped.
func parseSnowflakeID(v any) (*int64, error) {
	if v == nil {
		return nil, nil
	}
	switch t := v.(type) {
	case string:
		s := strings.TrimSpace(t)
		if s == "" {
			return nil, nil
		}
		id, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return nil, err
		}
		return &id, nil
	case float64:
		id := int64(t)
		return &id, nil
	case json.Number:
		id, err := t.Int64()
		if err != nil {
			return nil, err
		}
		return &id, nil
	default:
		return nil, strconv.ErrSyntax
	}
}

func firstID(vals ...any) (*int64, error) {
	for _, v := range vals {
		if v == nil {
			continue
		}
		if s, ok := v.(string); ok && strings.TrimSpace(s) == "" {
			continue
		}
		return parseSnowflakeID(v)
	}
	return nil, nil
}

type pollInput struct {
	Options         []string
	DurationMinutes int
}

// CreateTweet implements POST /api/v1/tweets.
func (h *Handler) CreateTweet(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	var body createTweetBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid JSON"})
	}
	content := strings.TrimSpace(body.Content)
	media := dedupeStrings(body.MediaURLs, 4)
	var poll *pollInput
	if body.Poll != nil {
		opts := cleanPollOptions(body.Poll.Options)
		if len(opts) < 2 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "polls need 2-4 options"})
		}
		if len(media) > 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "polls cannot have media"})
		}
		dur := body.Poll.DurationMinutes
		if dur <= 0 {
			dur = 1440
		}
		poll = &pollInput{Options: opts, DurationMinutes: dur}
	}
	if content == "" && len(media) == 0 && poll == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "tweet is empty"})
	}
	if len([]rune(content)) > 2000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "tweet too long"})
	}
	ctx := c.Context()
	parentID, perr := firstID(body.ParentID, body.ParentID2)
	if perr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid parent_id"})
	}
	quoteOfID, qerr := firstID(body.QuoteOfID, body.QuoteOfID2)
	if qerr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid quote_of_id"})
	}
	repostOfID, rerr := firstID(body.RepostOfID, body.RepostOfID2)
	if rerr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid repost_of_id"})
	}
	if parentID != nil {
		if _, err := findTweetByID(ctx, h.Pool, *parentID); err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "parent tweet not found"})
		}
	}
	if quoteOfID != nil {
		if _, err := findTweetByID(ctx, h.Pool, *quoteOfID); err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "quoted tweet not found"})
		}
	}
	if repostOfID != nil {
		if _, err := findTweetByID(ctx, h.Pool, *repostOfID); err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "reposted tweet not found"})
		}
	}

	var pollJSON *string
	if poll != nil {
		pd := models.PollData{DurationMinutes: poll.DurationMinutes}
		ends := time.Now().Add(time.Duration(poll.DurationMinutes) * time.Minute)
		pd.EndsAt = &ends
		for _, t := range poll.Options {
			pd.Options = append(pd.Options, models.PollOption{Text: t})
		}
		raw, _ := json.Marshal(pd)
		s := string(raw)
		pollJSON = &s
	}

	id := sf.Generate()
	var tw models.Tweet
	var mediaRaw, pollRaw string
	err := h.Pool.QueryRow(ctx,
		`INSERT INTO public.tweets (id, user_id, content, parent_id, quote_of_id, repost_of_id, media_urls, poll_data)
		 VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,CASE WHEN $8::text IS NULL THEN NULL ELSE $8::jsonb END)
		 RETURNING `+tweetColumns,
		id, me.ID, content, parentID, quoteOfID, repostOfID, mediaJSON(media), pollJSONString(pollJSON),
	).Scan(scanTweetDest(&tw, &mediaRaw, &pollRaw)...)
	if err != nil {
		return dberr(c, "tweet creation", err)
	}
	attachMedia(&tw, mediaRaw)
	attachPoll(&tw, pollRaw)

	// Recompute counts from real rows so they can never drift.
	_, _ = h.Pool.Exec(ctx, `UPDATE public.users SET tweets_count = (SELECT COUNT(*) FROM public.tweets WHERE user_id = $1) WHERE id = $1`, me.ID)
	if parentID != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET reply_count = (SELECT COUNT(*) FROM public.tweets WHERE parent_id = $1) WHERE id = $1`, *parentID)
		publishMetrics(ctx, h, *parentID)
	}
	if quoteOfID != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET quote_count = quote_count + 1 WHERE id = $1`, *quoteOfID)
	}

	// Hashtags + mentions.
	tags := extractHashtags(content)
	for _, tag := range tags {
		_, _ = h.Pool.Exec(ctx,
			`INSERT INTO public.hashtags (tag, tweet_count) VALUES ($1, 1)
			 ON CONFLICT (tag) DO UPDATE SET tweet_count = public.hashtags.tweet_count + 1`, tag)
		_, _ = h.Pool.Exec(ctx,
			`INSERT INTO public.tweet_hashtags (tweet_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, tag)
		_ = vstore.ZIncrBy(ctx, h.VC, "trends:24h", tag, 1)
	}
	mentions := extractMentions(content)
	if len(mentions) > 0 {
		ids := userIDsByUsernames(ctx, h.Pool, mentions)
		for _, uid := range ids {
			if uid == me.ID {
				continue
			}
			h.notifyUser(ctx, uid, me.ID, "MENTION", &id)
		}
	}
	if parentID != nil {
		if p, err := findTweetByID(ctx, h.Pool, *parentID); err == nil {
			algorithm.RecordEngagement(ctx, h.VC, me.ID, p.UserID, p.Content, algorithm.WReply)
			if p.UserID != me.ID {
				h.notifyUser(ctx, p.UserID, me.ID, "REPLY", &id)
			}
		}
	}
	if quoteOfID != nil {
		if q, err := findTweetByID(ctx, h.Pool, *quoteOfID); err == nil {
			algorithm.RecordEngagement(ctx, h.VC, me.ID, q.UserID, q.Content, algorithm.WRetweet)
			if q.UserID != me.ID {
				h.notifyUser(ctx, q.UserID, me.ID, "QUOTE", &id)
			}
		}
	}

	// Fan-out to followers' Valkey timelines + Pub/Sub broadcast.
	followerIDs, _ := followerIDsOf(ctx, h.Pool, me.ID)
	for _, fid := range followerIDs {
		_ = vstore.TimelinePush(ctx, h.VC, "timeline:following:"+strconv.FormatInt(fid, 10), id)
	}
	_ = vstore.TimelinePush(ctx, h.VC, "timeline:following:"+strconv.FormatInt(me.ID, 10), id)
	h.publishNewTweet(ctx, tw, me.ID)

	hydrated, _ := h.hydrateTweets(ctx, []models.Tweet{tw}, me.ID)
	if len(hydrated) == 1 {
		return c.Status(fiber.StatusCreated).JSON(hydrated[0])
	}
	return c.Status(fiber.StatusCreated).JSON(tw)
}

// Feed implements GET /api/v1/tweets/feed?type=foryou|following&cursor=&limit=.
func (h *Handler) Feed(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	feedType := c.Query("type", "foryou")
	limit := c.QueryInt("limit", 20)
	if limit < 1 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	rawCursor := c.Query("cursor", "")
	ctx := c.Context()

	var total int
	if err := h.Pool.QueryRow(ctx, `SELECT count(*) FROM public.tweets`).Scan(&total); err == nil && total == 0 {
		// First call on an empty database: populate real relational rows.
		_, _, _, _ = h.ensureSeeded(ctx)
	}

	if feedType != "following" {
		// Ranked For You feed uses an integer offset cursor over the
		// deterministically ranked candidate list.
		offset := 0
		if rawCursor != "" {
			o, err := strconv.Atoi(rawCursor)
			if err != nil || o < 0 {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid cursor"})
			}
			offset = o
		}
		return h.rankedForYouFeed(c, me.ID, offset, limit)
	}
	var cursor *int64
	if rawCursor != "" {
		id, err := strconv.ParseInt(rawCursor, 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid cursor"})
		}
		cursor = &id
	}

	var rows pgx.Rows
	var err error
	{
		// Strictly chronological: self + followed authors, newest first.
		rows, err = h.Pool.Query(ctx,
			`SELECT `+tweetColumns+` FROM public.tweets t
			 WHERE ($1::bigint IS NULL OR t.id < $1)
			   AND t.parent_id IS NULL
			   AND (t.user_id = $2 OR EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = $2 AND f.following_id = t.user_id))
			 ORDER BY t.id DESC LIMIT $3`, cursor, me.ID, limit+1)
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "feed failed"})
	}
	tweets, qerr := scanTweets(rows)
	if qerr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "feed failed"})
	}
	var nextCursor *string
	if len(tweets) > limit {
		tweets = tweets[:limit]
		s := strconv.FormatInt(tweets[len(tweets)-1].ID, 10)
		nextCursor = &s
	}
	hydrated, herr := h.hydrateTweets(ctx, tweets, me.ID)
	if herr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "feed failed"})
	}
	return c.JSON(fiber.Map{"tweets": hydrated, "next_cursor": nextCursor})
}

// Thread implements GET /api/v1/tweets/:id with ancestor chain + replies.
func (h *Handler) Thread(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	ctx := c.Context()
	focal, err := findTweetByID(ctx, h.Pool, id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "tweet not found"})
	}
	// Ordered ancestor chain root -> direct parent via parent_id walk.
	ancestors := h.ancestorChain(ctx, id)
	replyRows, err := h.Pool.Query(ctx,
		`SELECT `+tweetColumns+` FROM public.tweets WHERE parent_id = $1 ORDER BY id DESC LIMIT 20`, id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "replies failed"})
	}
	replies, err := scanTweets(replyRows)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "replies failed"})
	}
	all := append(append([]models.Tweet{*focal}, ancestors...), replies...)
	hydrated, herr := h.hydrateTweets(ctx, all, me.ID)
	if herr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "thread failed"})
	}
	byID := map[int64]models.HydratedTweet{}
	for _, ht := range hydrated {
		byID[ht.ID] = ht
	}
	ancOut := make([]models.HydratedTweet, 0, len(ancestors))
	for _, a := range ancestors {
		if ht, ok := byID[a.ID]; ok {
			ancOut = append(ancOut, ht)
		}
	}
	replyOut := make([]models.HydratedTweet, 0, len(replies))
	for _, r := range replies {
		if ht, ok := byID[r.ID]; ok {
			replyOut = append(replyOut, ht)
		}
	}
	return c.JSON(fiber.Map{
		"tweet":     byID[focal.ID],
		"ancestors": ancOut,
		"replies":   replyOut,
	})
}

// ancestorChain returns the full ordered ancestor chain (root -> direct
// parent) using a recursive CTE on parent_id.
func (h *Handler) ancestorChain(ctx context.Context, id int64) []models.Tweet {
	rows, err := h.Pool.Query(ctx,
		`WITH RECURSIVE chain(id, depth) AS (
			SELECT parent_id, 1 FROM public.tweets WHERE id = $1
			UNION
			SELECT t.parent_id, c.depth + 1
			FROM public.tweets t JOIN chain c ON t.id = c.id
			WHERE t.parent_id IS NOT NULL AND c.depth < 25
		)
		SELECT `+tweetColumns+` FROM public.tweets
		WHERE id IN (SELECT id FROM chain WHERE id IS NOT NULL)
		ORDER BY id ASC`, id)
	if err != nil {
		return nil
	}
	chain, err := scanTweets(rows)
	if err != nil {
		return nil
	}
	return chain
}

// DeleteTweet implements DELETE /api/v1/tweets/:id.
func (h *Handler) DeleteTweet(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	ctx := c.Context()
	tw, err := findTweetByID(ctx, h.Pool, id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "tweet not found"})
	}
	if tw.UserID != me.ID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "not your tweet"})
	}
	if _, err := h.Pool.Exec(ctx, `DELETE FROM public.notifications WHERE tweet_id = $1`, id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "delete failed"})
	}
	_, _ = h.Pool.Exec(ctx, `UPDATE public.users SET pinned_tweet_id = NULL WHERE pinned_tweet_id = $1`, id)
	if _, err := h.Pool.Exec(ctx, `DELETE FROM public.tweets WHERE id = $1`, id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "delete failed"})
	}
	// Purge media files from Supabase Storage (best effort — never fails the delete).
	if paths := storage.ObjectPathsFromURLs(h.Cfg.SupabaseURL, tw.MediaURLs); len(paths) > 0 {
		_ = storage.DeleteObjects(ctx, h.Cfg.SupabaseURL, h.Cfg.SupabaseServiceRoleKey, middleware.BearerToken(c), paths)
	}
	_, _ = h.Pool.Exec(ctx, `UPDATE public.users SET tweets_count = GREATEST(tweets_count - 1, 0) WHERE id = $1`, me.ID)
	if tw.ParentID != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = $1`, *tw.ParentID)
	}
	if tw.QuoteOfID != nil {
		_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET quote_count = GREATEST(quote_count - 1, 0) WHERE id = $1`, *tw.QuoteOfID)
	}
	// Realtime: every connected client removes the tweet immediately.
	ws.PublishTyped(h.Hub, ctx, ws.FeedChannel, "TWEET_DELETED", map[string]any{
		"tweet_id": strconv.FormatInt(id, 10),
	})
	return c.JSON(fiber.Map{"deleted": true})
}

// --- shared scan/hydrate helpers ---

func scanTweetDest(tw *models.Tweet, mediaRaw, pollRaw *string) []any {
	return []any{
		&tw.ID, &tw.UserID, &tw.Content, &tw.ParentID, &tw.QuoteOfID, &tw.RepostOfID,
		mediaRaw, pollRaw,
		&tw.LikeCount, &tw.RetweetCount, &tw.ReplyCount, &tw.QuoteCount, &tw.BookmarkCount, &tw.ViewCount,
		&tw.CreatedAt,
	}
}

func attachMedia(tw *models.Tweet, raw string) {
	tw.MediaURLs = []string{}
	if raw == "" {
		return
	}
	var urls []string
	if err := json.Unmarshal([]byte(raw), &urls); err != nil {
		return
	}
	tw.MediaURLs = urls
}

// mediaJSON marshals media URLs for the tweets.media_urls JSONB column.
func mediaJSON(urls []string) string {
	if len(urls) == 0 {
		return "[]"
	}
	raw, err := json.Marshal(urls)
	if err != nil {
		return "[]"
	}
	return string(raw)
}

func attachPoll(tw *models.Tweet, raw string) {
	if raw == "" {
		tw.PollData = nil
		return
	}
	var pd models.PollData
	if err := json.Unmarshal([]byte(raw), &pd); err != nil {
		tw.PollData = nil
		return
	}
	tw.PollData = &pd
}

func scanTweets(rows pgx.Rows) ([]models.Tweet, error) {
	defer rows.Close()
	var out []models.Tweet
	for rows.Next() {
		var tw models.Tweet
		var mediaRaw, pollRaw string
		if err := rows.Scan(scanTweetDest(&tw, &mediaRaw, &pollRaw)...); err != nil {
			return nil, err
		}
		attachMedia(&tw, mediaRaw)
		attachPoll(&tw, pollRaw)
		out = append(out, tw)
	}
	return out, rows.Err()
}

func findTweetByID(ctx context.Context, pool *pgxpool.Pool, id int64) (*models.Tweet, error) {
	var tw models.Tweet
	var mediaRaw, pollRaw string
	err := pool.QueryRow(ctx, `SELECT `+tweetColumns+` FROM public.tweets WHERE id = $1`, id).
		Scan(scanTweetDest(&tw, &mediaRaw, &pollRaw)...)
	if err != nil {
		return nil, err
	}
	attachMedia(&tw, mediaRaw)
	attachPoll(&tw, pollRaw)
	return &tw, nil
}

// hydrateTweets attaches authors, one-level quote/repost embeds and viewer flags.
func (h *Handler) hydrateTweets(ctx context.Context, tweets []models.Tweet, viewerID int64) ([]models.HydratedTweet, error) {
	out := make([]models.HydratedTweet, 0, len(tweets))
	if len(tweets) == 0 {
		return out, nil
	}
	userIDs := map[int64]bool{}
	tweetIDs := make([]int64, 0, len(tweets))
	quoteIDs := map[int64]bool{}
	for _, t := range tweets {
		userIDs[t.UserID] = true
		tweetIDs = append(tweetIDs, t.ID)
		if t.QuoteOfID != nil {
			quoteIDs[*t.QuoteOfID] = true
		}
		if t.RepostOfID != nil {
			quoteIDs[*t.RepostOfID] = true
		}
	}
	users := usersByIDs(ctx, h.Pool, keys(userIDs))

	embeds := map[int64]models.EmbeddedTweet{}
	if len(quoteIDs) > 0 {
		qrows, err := h.Pool.Query(ctx, `SELECT `+tweetColumns+` FROM public.tweets WHERE id = ANY($1)`, keys64(quoteIDs))
		if err == nil {
			qt, serr := scanTweets(qrows)
			if serr == nil {
				for _, t := range qt {
					userIDs[t.UserID] = true
					embeds[t.ID] = models.EmbeddedTweet{Tweet: t}
				}
				more := usersByIDs(ctx, h.Pool, keys(userIDs))
				for k, v := range more {
					users[k] = v
				}
				for id, e := range embeds {
					if a, ok := users[e.UserID]; ok {
						e.Author = a
						embeds[id] = e
					}
				}
			}
		}
	}

	liked := idSet(ctx, h.Pool, `SELECT tweet_id FROM public.likes WHERE user_id = $1 AND tweet_id = ANY($2)`, viewerID, tweetIDs)
	retweeted := idSet(ctx, h.Pool, `SELECT tweet_id FROM public.retweets WHERE user_id = $1 AND tweet_id = ANY($2)`, viewerID, tweetIDs)
	bookmarked := idSet(ctx, h.Pool, `SELECT tweet_id FROM public.bookmarks WHERE user_id = $1 AND tweet_id = ANY($2)`, viewerID, tweetIDs)
	votes := map[int64]int{}
	if len(tweetIDs) > 0 {
		rows, err := h.Pool.Query(ctx, `SELECT tweet_id, option_index FROM public.poll_votes WHERE user_id = $1 AND tweet_id = ANY($2)`, viewerID, tweetIDs)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var tid int64
				var idx int
				if serr := rows.Scan(&tid, &idx); serr == nil {
					votes[tid] = idx
				}
			}
		}
	}

	for _, t := range tweets {
		ht := models.HydratedTweet{Tweet: t}
		if a, ok := users[t.UserID]; ok {
			ht.Author = a
		} else {
			ht.Author = &models.User{ID: t.UserID}
		}
		if t.QuoteOfID != nil {
			if e, ok := embeds[*t.QuoteOfID]; ok {
				cp := e
				ht.QuotedTweet = &cp
			}
		}
		if t.RepostOfID != nil {
			if e, ok := embeds[*t.RepostOfID]; ok {
				cp := e
				ht.RepostedTweet = &cp
			}
			if a, ok := users[t.UserID]; ok {
				ht.RepostedBy = a
			}
		}
		ht.LikedByMe = liked[t.ID]
		ht.RetweetedByMe = retweeted[t.ID]
		ht.BookmarkedByMe = bookmarked[t.ID]
		if v, ok := votes[t.ID]; ok {
			cp := v
			ht.MyPollVote = &cp
		}
		out = append(out, ht)
	}
	return out, nil
}

func usersByIDs(ctx context.Context, pool *pgxpool.Pool, ids []int64) map[int64]*models.User {
	m := map[int64]*models.User{}
	if len(ids) == 0 {
		return m
	}
	rows, err := pool.Query(ctx,
		`SELECT `+userColumns+`
		 FROM public.users u WHERE u.id = ANY($1)`, ids)
	if err != nil {
		return m
	}
	defer rows.Close()
	for rows.Next() {
		var u models.User
		if err := rows.Scan(scanUserDest(&u)...); err == nil {
			cp := u
			m[u.ID] = &cp
		}
	}
	return m
}

func idSet(ctx context.Context, pool *pgxpool.Pool, q string, viewerID int64, tweetIDs []int64) map[int64]bool {
	m := map[int64]bool{}
	if len(tweetIDs) == 0 {
		return m
	}
	rows, err := pool.Query(ctx, q, viewerID, tweetIDs)
	if err != nil {
		return m
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			m[id] = true
		}
	}
	return m
}

func keys(m map[int64]bool) []int64 {
	out := make([]int64, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func keys64(m map[int64]bool) []int64 { return keys(m) }

func userIDsByUsernames(ctx context.Context, pool *pgxpool.Pool, names []string) []int64 {
	if len(names) == 0 {
		return nil
	}
	rows, err := pool.Query(ctx, `SELECT id FROM public.users WHERE lower(username) = ANY($1)`, names)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			out = append(out, id)
		}
	}
	return out
}

func followerIDsOf(ctx context.Context, pool *pgxpool.Pool, userID int64) ([]int64, error) {
	rows, err := pool.Query(ctx, `SELECT follower_id FROM public.follows WHERE following_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err == nil {
			out = append(out, id)
		}
	}
	return out, rows.Err()
}

func insertNotification(ctx context.Context, pool *pgxpool.Pool, userID, actorID int64, typ string, tweetID *int64) (int64, error) {
	id := sf.Generate()
	_, err := pool.Exec(ctx,
		`INSERT INTO public.notifications (id, user_id, actor_id, type, tweet_id) VALUES ($1,$2,$3,$4,$5)`,
		id, userID, actorID, typ, tweetID)
	return id, err
}

func extractHashtags(content string) []string {
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

func extractMentions(content string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range mentionRe.FindAllStringSubmatch(content, -1) {
		name := strings.ToLower(m[1])
		if seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}

func dedupeStrings(in []string, max int) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
		if len(out) >= max {
			break
		}
	}
	return out
}

func cleanPollOptions(opts []string) []string {
	var out []string
	for _, o := range opts {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		if len([]rune(o)) > 60 {
			o = string([]rune(o)[:60])
		}
		out = append(out, o)
		if len(out) == 4 {
			break
		}
	}
	return out
}

func pollJSONString(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}
