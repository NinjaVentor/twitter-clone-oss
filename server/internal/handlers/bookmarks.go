package handlers

import (
	"strconv"

	"twitter-server/internal/middleware"

	"github.com/gofiber/fiber/v2"
)

// Bookmarks implements GET /api/v1/bookmarks (cursor-paginated).
func (h *Handler) Bookmarks(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	limit := clampLimit(c.QueryInt("limit", 20))
	var cursor *int64
	if raw := c.Query("cursor", ""); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid cursor"})
		}
		cursor = &id
	}
	ctx := c.Context()
	rows, err := h.Pool.Query(ctx,
		`SELECT `+tweetColumnsT+` FROM public.tweets t
		 JOIN public.bookmarks b ON b.tweet_id = t.id
		 WHERE b.user_id = $1 AND ($2::bigint IS NULL OR t.id < $2)
		 ORDER BY b.created_at DESC, t.id DESC LIMIT $3`, me.ID, cursor, limit+1)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "bookmarks failed"})
	}
	tweets, qerr := scanTweets(rows)
	if qerr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "bookmarks failed"})
	}
	var nextCursor *string
	if len(tweets) > limit {
		tweets = tweets[:limit]
		s := strconv.FormatInt(tweets[len(tweets)-1].ID, 10)
		nextCursor = &s
	}
	hydrated, herr := h.hydrateTweets(ctx, tweets, me.ID)
	if herr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "bookmarks failed"})
	}
	return c.JSON(fiber.Map{"tweets": hydrated, "next_cursor": nextCursor})
}

// ClearBookmarks implements DELETE /api/v1/bookmarks.
func (h *Handler) ClearBookmarks(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	ctx := c.Context()
	rows, err := h.Pool.Query(ctx, `SELECT tweet_id FROM public.bookmarks WHERE user_id = $1`, me.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "clear failed"})
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if serr := rows.Scan(&id); serr == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	if _, err := h.Pool.Exec(ctx, `DELETE FROM public.bookmarks WHERE user_id = $1`, me.ID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "clear failed"})
	}
	if len(ids) > 0 {
		_, _ = h.Pool.Exec(ctx,
			`UPDATE public.tweets SET bookmark_count = GREATEST(bookmark_count - 1, 0) WHERE id = ANY($1)`, ids)
	}
	return c.JSON(fiber.Map{"cleared": len(ids)})
}
