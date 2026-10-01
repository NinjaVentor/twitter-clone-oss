package handlers

import (
	"strconv"
	"strings"

	"twitter-server/internal/algorithm"
	"twitter-server/internal/middleware"
	"twitter-server/internal/models"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// Search implements GET /api/v1/search?q=&tab=top|latest|people|media.
func (h *Handler) Search(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	q := strings.TrimSpace(c.Query("q", ""))
	if q == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "q is required"})
	}
	// Search interest signal: +1.5 to queried hashtags/keywords.
	for _, tag := range algorithm.QueryTags(q) {
		algorithm.RecordSignal(c.Context(), h.VC, me.ID, algorithm.WSearch, 0, []string{tag})
	}
	tab := c.Query("tab", "top")
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

	if tab == "people" {
		like := "%" + q + "%"
		rows, err := h.Pool.Query(ctx,
			`SELECT `+userColumns+` FROM public.users u
			 WHERE u.username ILIKE $1 OR u.display_name ILIKE $1 OR u.bio ILIKE $1
			 ORDER BY u.followers_count DESC, u.id DESC LIMIT 20`, like)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "search failed"})
		}
		defer rows.Close()
		users := []models.FollowUser{}
		var ids []int64
		var raw []models.User
		for rows.Next() {
			var u models.User
			if serr := rows.Scan(scanUserDest(&u)...); serr == nil {
				raw = append(raw, u)
				ids = append(ids, u.ID)
			}
		}
		following := idSet(ctx, h.Pool, `SELECT following_id FROM public.follows WHERE follower_id = $1 AND following_id = ANY($2)`, me.ID, ids)
		for _, u := range raw {
			users = append(users, models.FollowUser{User: u, IsFollowing: following[u.ID]})
		}
		return c.JSON(fiber.Map{"users": users})
	}

	match := `(search_vector @@ websearch_to_tsquery('english', $1) OR content ILIKE '%' || $1 || '%')`
	order := `(like_count * 2 + retweet_count * 3 + reply_count) DESC, created_at DESC`
	if tab == "latest" {
		order = `created_at DESC`
	}
	mediaFilter := ""
	if tab == "media" {
		mediaFilter = `AND jsonb_array_length(media_urls) > 0`
		order = `(like_count * 2 + retweet_count * 3 + reply_count) DESC, created_at DESC`
	}
	rows, err := h.Pool.Query(ctx,
		`SELECT `+tweetColumns+` FROM public.tweets
		 WHERE `+match+` `+mediaFilter+` AND ($2::bigint IS NULL OR id < $2)
		 ORDER BY `+order+` LIMIT $3`, q, cursor, limit+1)
	if err != nil {
		// websearch_to_tsquery can reject exotic input; retry with ILIKE only.
		rows, err = h.Pool.Query(ctx,
			`SELECT `+tweetColumns+` FROM public.tweets
			 WHERE content ILIKE '%' || $1 || '%' `+mediaFilter+` AND ($2::bigint IS NULL OR id < $2)
			 ORDER BY `+order+` LIMIT $3`, q, cursor, limit+1)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "search failed"})
		}
	}
	tweets, qerr := scanTweets(rows)
	if qerr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "search failed"})
	}
	var nextCursor *string
	if len(tweets) > limit {
		tweets = tweets[:limit]
		s := strconv.FormatInt(tweets[len(tweets)-1].ID, 10)
		nextCursor = &s
	}
	hydrated, herr := h.hydrateTweets(ctx, tweets, me.ID)
	if herr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "search failed"})
	}
	return c.JSON(fiber.Map{"tweets": hydrated, "next_cursor": nextCursor})
}

// Typeahead implements GET /api/v1/search/typeahead?q= (top 5 hashtags + users).
func (h *Handler) Typeahead(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	q := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(c.Query("q", ""), "#")))
	if q == "" {
		return c.JSON(models.TypeaheadResult{Hashtags: []models.Trend{}, Users: []models.FollowUser{}})
	}
	ctx := c.Context()
	tags := []models.Trend{}
	if rows, err := h.Pool.Query(ctx,
		`SELECT tag, tweet_count FROM public.hashtags WHERE lower(tag) LIKE '#' || $1 || '%' ORDER BY tweet_count DESC LIMIT 5`, q); err == nil {
		func() {
			defer rows.Close()
			for rows.Next() {
				var t models.Trend
				if serr := rows.Scan(&t.Tag, &t.Count); serr == nil {
					tags = append(tags, t)
				}
			}
		}()
	}
	users := []models.FollowUser{}
	var rows pgx.Rows
	var err error
	rows, err = h.Pool.Query(ctx,
		`SELECT `+userColumns+` FROM public.users u
		 WHERE u.id <> $2 AND (lower(u.username) LIKE $1 || '%' OR lower(u.display_name) LIKE '%' || $1 || '%')
		 ORDER BY u.followers_count DESC LIMIT 5`, q, me.ID)
	if err == nil {
		func() {
			defer rows.Close()
			var ids []int64
			var raw []models.User
			for rows.Next() {
				var u models.User
				if serr := rows.Scan(scanUserDest(&u)...); serr == nil {
					raw = append(raw, u)
					ids = append(ids, u.ID)
				}
			}
			following := idSet(ctx, h.Pool, `SELECT following_id FROM public.follows WHERE follower_id = $1 AND following_id = ANY($2)`, me.ID, ids)
			for _, u := range raw {
				users = append(users, models.FollowUser{User: u, IsFollowing: following[u.ID]})
			}
		}()
	}
	return c.JSON(models.TypeaheadResult{Hashtags: tags, Users: users})
}
