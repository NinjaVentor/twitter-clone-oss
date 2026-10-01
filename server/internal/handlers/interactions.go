package handlers

import (
	"context"
	"encoding/json"
	"strconv"

	"twitter-server/internal/algorithm"
	"twitter-server/internal/middleware"
	"twitter-server/internal/models"
	sf "twitter-server/internal/snowflake"
	vstore "twitter-server/internal/valkey"
	"twitter-server/internal/ws"

	"github.com/gofiber/fiber/v2"
)

// LikeTweet implements POST /api/v1/tweets/:id/like (toggle).
func (h *Handler) LikeTweet(c *fiber.Ctx) error {
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
	var exists bool
	_ = h.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.likes WHERE user_id=$1 AND tweet_id=$2)`, me.ID, id).Scan(&exists)
	liked := !exists
	if liked {
		if _, err := h.Pool.Exec(ctx, `INSERT INTO public.likes (user_id, tweet_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, me.ID, id); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "like failed"})
		}
		_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET like_count = like_count + 1 WHERE id = $1`, id)
		if tw.UserID != me.ID {
			h.notifyUser(ctx, tw.UserID, me.ID, "LIKE", &id)
		}
	} else {
		_, _ = h.Pool.Exec(ctx, `DELETE FROM public.likes WHERE user_id=$1 AND tweet_id=$2`, me.ID, id)
		_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`, id)
	}
	var count int
	_ = h.Pool.QueryRow(ctx, `SELECT like_count FROM public.tweets WHERE id = $1`, id).Scan(&count)
	publishMetrics(ctx, h, id)
	if liked {
		algorithm.RecordEngagement(ctx, h.VC, me.ID, tw.UserID, tw.Content, algorithm.WLike)
	} else {
		algorithm.RecordEngagement(ctx, h.VC, me.ID, tw.UserID, tw.Content, -algorithm.WLike)
	}
	return c.JSON(fiber.Map{"liked": liked, "like_count": count})
}

// UnlikeTweet implements DELETE /api/v1/tweets/:id/like (idempotent undo).
func (h *Handler) UnlikeTweet(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	ctx := c.Context()
	tw, uerr := findTweetByID(ctx, h.Pool, id)
	if uerr != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "tweet not found"})
	}
	_, _ = h.Pool.Exec(ctx, `DELETE FROM public.likes WHERE user_id=$1 AND tweet_id=$2`, me.ID, id)
	_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1`, id)
	algorithm.RecordEngagement(ctx, h.VC, me.ID, tw.UserID, tw.Content, -algorithm.WLike)
	var count int
	_ = h.Pool.QueryRow(ctx, `SELECT like_count FROM public.tweets WHERE id = $1`, id).Scan(&count)
	publishMetrics(ctx, h, id)
	return c.JSON(fiber.Map{"liked": false, "like_count": count})
}

// Retweet implements POST /api/v1/tweets/:id/retweet (toggle + pure repost row).
func (h *Handler) Retweet(c *fiber.Ctx) error {
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
	var exists bool
	_ = h.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.retweets WHERE user_id=$1 AND tweet_id=$2)`, me.ID, id).Scan(&exists)
	retweeted := !exists
	if retweeted {
		if _, err := h.Pool.Exec(ctx, `INSERT INTO public.retweets (user_id, tweet_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, me.ID, id); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "retweet failed"})
		}
		// Pure repost row so reposts flow through feeds with a "Reposted by" banner.
		repostID := sf.Generate()
		_, _ = h.Pool.Exec(ctx,
			`INSERT INTO public.tweets (id, user_id, content, repost_of_id, media_urls) VALUES ($1,$2,'',$3,'[]'::jsonb) ON CONFLICT (id) DO NOTHING`,
			repostID, me.ID, id)
		_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET retweet_count = retweet_count + 1 WHERE id = $1`, id)
		if tw.UserID != me.ID {
			h.notifyUser(ctx, tw.UserID, me.ID, "RETWEET", &id)
		}
		if repost, rerr := findTweetByID(ctx, h.Pool, repostID); rerr == nil {
			h.publishNewTweet(ctx, *repost, me.ID)
		}
	} else {
		_, _ = h.Pool.Exec(ctx, `DELETE FROM public.retweets WHERE user_id=$1 AND tweet_id=$2`, me.ID, id)
		_, _ = h.Pool.Exec(ctx, `DELETE FROM public.tweets WHERE user_id=$1 AND repost_of_id=$2`, me.ID, id)
		_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET retweet_count = GREATEST(retweet_count - 1, 0) WHERE id = $1`, id)
	}
	var count int
	_ = h.Pool.QueryRow(ctx, `SELECT retweet_count FROM public.tweets WHERE id = $1`, id).Scan(&count)
	publishMetrics(ctx, h, id)
	if retweeted {
		algorithm.RecordEngagement(ctx, h.VC, me.ID, tw.UserID, tw.Content, algorithm.WRetweet)
	} else {
		algorithm.RecordEngagement(ctx, h.VC, me.ID, tw.UserID, tw.Content, -algorithm.WRetweet)
	}
	return c.JSON(fiber.Map{"retweeted": retweeted, "retweet_count": count})
}

// Unretweet implements DELETE /api/v1/tweets/:id/retweet (idempotent undo + repost row delete).
func (h *Handler) Unretweet(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	ctx := c.Context()
	tw, terr := findTweetByID(ctx, h.Pool, id)
	if terr != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "tweet not found"})
	}
	// Collect owned repost rows first so clients can drop them in realtime.
	var repostIDs []int64
	if rows, err := h.Pool.Query(ctx, `SELECT id FROM public.tweets WHERE user_id=$1 AND repost_of_id=$2`, me.ID, id); err == nil {
		for rows.Next() {
			var rid int64
			if serr := rows.Scan(&rid); serr == nil {
				repostIDs = append(repostIDs, rid)
			}
		}
		rows.Close()
	}
	_, _ = h.Pool.Exec(ctx, `DELETE FROM public.retweets WHERE user_id=$1 AND tweet_id=$2`, me.ID, id)
	_, _ = h.Pool.Exec(ctx, `DELETE FROM public.tweets WHERE user_id=$1 AND repost_of_id=$2`, me.ID, id)
	_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET retweet_count = GREATEST(retweet_count - 1, 0) WHERE id = $1`, id)
	algorithm.RecordEngagement(ctx, h.VC, me.ID, tw.UserID, tw.Content, -algorithm.WRetweet)
	for _, rid := range repostIDs {
		ws.PublishTyped(h.Hub, ctx, ws.FeedChannel, "TWEET_DELETED", map[string]any{
			"tweet_id": strconv.FormatInt(rid, 10),
		})
	}
	var count int
	_ = h.Pool.QueryRow(ctx, `SELECT retweet_count FROM public.tweets WHERE id = $1`, id).Scan(&count)
	publishMetrics(ctx, h, id)
	return c.JSON(fiber.Map{"retweeted": false, "retweet_count": count})
}

// Bookmark implements POST /api/v1/tweets/:id/bookmark (toggle).
func (h *Handler) Bookmark(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	ctx := c.Context()
	tw, terr := findTweetByID(ctx, h.Pool, id)
	if terr != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "tweet not found"})
	}
	var exists bool
	_ = h.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.bookmarks WHERE user_id=$1 AND tweet_id=$2)`, me.ID, id).Scan(&exists)
	bookmarked := !exists
	if bookmarked {
		if _, err := h.Pool.Exec(ctx, `INSERT INTO public.bookmarks (user_id, tweet_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, me.ID, id); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "bookmark failed"})
		}
		_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET bookmark_count = bookmark_count + 1 WHERE id = $1`, id)
	} else {
		_, _ = h.Pool.Exec(ctx, `DELETE FROM public.bookmarks WHERE user_id=$1 AND tweet_id=$2`, me.ID, id)
		_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET bookmark_count = GREATEST(bookmark_count - 1, 0) WHERE id = $1`, id)
	}
	var count int
	_ = h.Pool.QueryRow(ctx, `SELECT bookmark_count FROM public.tweets WHERE id = $1`, id).Scan(&count)
	publishMetrics(ctx, h, id)
	if bookmarked {
		algorithm.RecordEngagement(ctx, h.VC, me.ID, tw.UserID, tw.Content, algorithm.WBookmark)
	} else {
		algorithm.RecordEngagement(ctx, h.VC, me.ID, tw.UserID, tw.Content, -algorithm.WBookmark)
	}
	return c.JSON(fiber.Map{"bookmarked": bookmarked, "bookmark_count": count})
}

// Unbookmark implements DELETE /api/v1/tweets/:id/bookmark (idempotent undo).
func (h *Handler) Unbookmark(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	ctx := c.Context()
	tw, terr := findTweetByID(ctx, h.Pool, id)
	if terr != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "tweet not found"})
	}
	_, _ = h.Pool.Exec(ctx, `DELETE FROM public.bookmarks WHERE user_id=$1 AND tweet_id=$2`, me.ID, id)
	_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET bookmark_count = GREATEST(bookmark_count - 1, 0) WHERE id = $1`, id)
	algorithm.RecordEngagement(ctx, h.VC, me.ID, tw.UserID, tw.Content, -algorithm.WBookmark)
	var count int
	_ = h.Pool.QueryRow(ctx, `SELECT bookmark_count FROM public.tweets WHERE id = $1`, id).Scan(&count)
	publishMetrics(ctx, h, id)
	return c.JSON(fiber.Map{"bookmarked": false, "bookmark_count": count})
}

type pollVoteBody struct {
	OptionIndex *int `json:"option_index"`
}

// VotePoll implements POST /api/v1/tweets/:id/poll/vote.
func (h *Handler) VotePoll(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	id, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	var body pollVoteBody
	if err := c.BodyParser(&body); err != nil || body.OptionIndex == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "option_index required"})
	}
	ctx := c.Context()
	tw, err := findTweetByID(ctx, h.Pool, id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "tweet not found"})
	}
	if tw.PollData == nil || len(tw.PollData.Options) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "no poll on this tweet"})
	}
	if *body.OptionIndex < 0 || *body.OptionIndex >= len(tw.PollData.Options) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid option_index"})
	}
	if _, err := h.Pool.Exec(ctx,
		`INSERT INTO public.poll_votes (user_id, tweet_id, option_index) VALUES ($1,$2,$3)
		 ON CONFLICT (user_id, tweet_id) DO UPDATE SET option_index = EXCLUDED.option_index`,
		me.ID, id, *body.OptionIndex); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "vote failed"})
	}
	// Recompute per-option counts and persist into poll_data.
	type row struct {
		Idx int
		N   int
	}
	rows, err := h.Pool.Query(ctx, `SELECT option_index, count(*) FROM public.poll_votes WHERE tweet_id = $1 GROUP BY option_index`, id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "vote failed"})
	}
	counts := map[int]int{}
	defer rows.Close()
	for rows.Next() {
		var r row
		if serr := rows.Scan(&r.Idx, &r.N); serr == nil {
			counts[r.Idx] = r.N
		}
	}
	pd := *tw.PollData
	for i := range pd.Options {
		pd.Options[i].Votes = counts[i]
	}
	raw, _ := json.Marshal(pd)
	_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET poll_data = $1::jsonb WHERE id = $2`, string(raw), id)
	publishMetrics(ctx, h, id)
	return c.JSON(fiber.Map{"poll_data": pd, "my_poll_vote": *body.OptionIndex})
}

// flexID accepts Snowflake IDs serialized either as JSON strings or numbers.
type flexID struct {
	Value int64
}

func (f *flexID) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		v, verr := strconv.ParseInt(s, 10, 64)
		if verr != nil {
			return verr
		}
		f.Value = v
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(b, &n); err != nil {
		return err
	}
	v, err := n.Int64()
	if err != nil {
		return err
	}
	f.Value = v
	return nil
}

// ReportViews implements POST /api/v1/tweets/views { tweet_ids: string[] }.
func (h *Handler) ReportViews(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	var body struct {
		TweetIDs []flexID `json:"tweet_ids"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid JSON"})
	}
	ids := make([]int64, 0, len(body.TweetIDs))
	for _, f := range body.TweetIDs {
		if f.Value > 0 {
			ids = append(ids, f.Value)
		}
		if len(ids) >= 100 {
			break
		}
	}
	if len(ids) == 0 {
		return c.JSON(fiber.Map{"ok": true, "counted": 0})
	}
	ctx := c.Context()
	_, _ = h.Pool.Exec(ctx, `UPDATE public.tweets SET view_count = view_count + 1 WHERE id = ANY($1)`, ids)
	for _, id := range ids {
		_ = vstore.Incr(ctx, h.VC, "views:tweet:"+strconv.FormatInt(id, 10))
	}
	// Dwell signal: +0.5 affinity for each viewed author + hashtags, and mark seen.
	if len(ids) > 0 {
		if rows, err := h.Pool.Query(ctx, `SELECT user_id, content FROM public.tweets WHERE id = ANY($1)`, ids); err == nil {
			for rows.Next() {
				var author int64
				var content string
				if serr := rows.Scan(&author, &content); serr == nil {
					algorithm.RecordEngagement(ctx, h.VC, me.ID, author, content, algorithm.WView)
				}
			}
			rows.Close()
		}
		for _, id := range ids {
			algorithm.MarkSeen(ctx, h.VC, me.ID, id)
		}
	}
	return c.JSON(fiber.Map{"ok": true, "counted": len(ids)})
}

func publishMetrics(ctx context.Context, h *Handler, tweetID int64) {
	var tw models.Tweet
	var mediaRaw, pollRaw string
	err := h.Pool.QueryRow(ctx, `SELECT `+tweetColumns+` FROM public.tweets WHERE id = $1`, tweetID).
		Scan(scanTweetDest(&tw, &mediaRaw, &pollRaw)...)
	if err != nil {
		return
	}
	ws.PublishTyped(h.Hub, ctx, ws.FeedChannel, "TWEET_METRICS_UPDATED", map[string]any{
		"tweet_id":       strconv.FormatInt(tweetID, 10),
		"like_count":     tw.LikeCount,
		"retweet_count":  tw.RetweetCount,
		"reply_count":    tw.ReplyCount,
		"quote_count":    tw.QuoteCount,
		"bookmark_count": tw.BookmarkCount,
		"view_count":     tw.ViewCount,
	})
}
