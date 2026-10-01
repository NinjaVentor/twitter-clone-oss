package handlers

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"twitter-server/internal/middleware"
	"twitter-server/internal/models"
	"twitter-server/internal/algorithm"
	"twitter-server/internal/storage"
	vstore "twitter-server/internal/valkey"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ByUsername implements GET /api/v1/users/by-username/:username.
func (h *Handler) ByUsername(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	username := strings.TrimPrefix(strings.TrimSpace(c.Params("username")), "@")
	if username == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid username"})
	}
	ctx := c.Context()
	var u models.User
	if err := h.Pool.QueryRow(ctx, `SELECT `+userColumns+` FROM public.users u WHERE lower(u.username) = lower($1)`, username).
		Scan(scanUserDest(&u)...); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "user not found"})
	}
	prof := h.toProfile(ctx, &u, me.ID)
	if u.ID != me.ID {
		algorithm.RecordSignal(ctx, h.VC, me.ID, algorithm.WProfile, u.ID, nil)
	}
	return c.JSON(prof)
}

func (h *Handler) toProfile(ctx context.Context, u *models.User, viewerID int64) *models.ProfileUser {
	prof := &models.ProfileUser{User: *u}
	if u.ID != viewerID {
		_ = h.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.follows WHERE follower_id=$1 AND following_id=$2)`, viewerID, u.ID).Scan(&prof.IsFollowing)
		_ = h.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.follows WHERE follower_id=$1 AND following_id=$2)`, u.ID, viewerID).Scan(&prof.IsFollowedBy)
	}
	if u.PinnedTweetID != nil {
		if tw, err := findTweetByID(ctx, h.Pool, *u.PinnedTweetID); err == nil {
			if hydrated, herr := h.hydrateTweets(ctx, []models.Tweet{*tw}, viewerID); herr == nil && len(hydrated) == 1 {
				prof.PinnedTweet = &hydrated[0]
			}
		}
	}
	return prof
}

// UserTweets implements GET /api/v1/users/:id/tweets?tab=posts|replies|media|likes.
func (h *Handler) UserTweets(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	targetID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	tab := c.Query("tab", "posts")
	limit := clampLimit(c.QueryInt("limit", 20))
	var cursor *int64
	if raw := c.Query("cursor", ""); raw != "" {
		id, cerr := strconv.ParseInt(raw, 10, 64)
		if cerr != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid cursor"})
		}
		cursor = &id
	}
	ctx := c.Context()
	var rows pgx.Rows
	switch tab {
	case "replies":
		rows, err = h.Pool.Query(ctx,
			`SELECT `+tweetColumns+` FROM public.tweets
			 WHERE user_id = $1 AND parent_id IS NOT NULL AND ($2::bigint IS NULL OR id < $2)
			 ORDER BY id DESC LIMIT $3`, targetID, cursor, limit+1)
	case "media":
		rows, err = h.Pool.Query(ctx,
			`SELECT `+tweetColumns+` FROM public.tweets
			 WHERE user_id = $1 AND parent_id IS NULL AND jsonb_array_length(media_urls) > 0
			   AND ($2::bigint IS NULL OR id < $2)
			 ORDER BY id DESC LIMIT $3`, targetID, cursor, limit+1)
	case "likes":
		rows, err = h.Pool.Query(ctx,
			`SELECT `+tweetColumnsT+` FROM public.tweets t
			 JOIN public.likes l ON l.tweet_id = t.id
			 WHERE l.user_id = $1 AND ($2::bigint IS NULL OR t.id < $2)
			 ORDER BY l.created_at DESC, t.id DESC LIMIT $3`, targetID, cursor, limit+1)
	default: // posts
		rows, err = h.Pool.Query(ctx,
			`SELECT `+tweetColumns+` FROM public.tweets
			 WHERE user_id = $1 AND parent_id IS NULL AND ($2::bigint IS NULL OR id < $2)
			 ORDER BY id DESC LIMIT $3`, targetID, cursor, limit+1)
	}
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "tweets failed"})
	}
	tweets, qerr := scanTweets(rows)
	if qerr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "tweets failed"})
	}
	var nextCursor *string
	if len(tweets) > limit {
		tweets = tweets[:limit]
		s := strconv.FormatInt(tweets[len(tweets)-1].ID, 10)
		nextCursor = &s
	}
	hydrated, herr := h.hydrateTweets(ctx, tweets, me.ID)
	if herr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "tweets failed"})
	}
	if tab == "replies" {
		attachParents(ctx, h.Pool, hydrated)
	}
	return c.JSON(fiber.Map{"tweets": hydrated, "next_cursor": nextCursor})
}

// attachParents hydrates ParentTweet (+ author) for reply-tab tweets.
func attachParents(ctx context.Context, pool *pgxpool.Pool, hydrated []models.HydratedTweet) {
	need := map[int64]bool{}
	for _, ht := range hydrated {
		if ht.ParentID != nil {
			need[*ht.ParentID] = true
		}
	}
	if len(need) == 0 {
		return
	}
	rows, err := pool.Query(ctx, `SELECT `+tweetColumns+` FROM public.tweets WHERE id = ANY($1)`, keys(need))
	if err != nil {
		return
	}
	parents, serr := scanTweets(rows)
	if serr != nil {
		return
	}
	users := usersByIDs(ctx, pool, parentAuthorIDs(parents))
	byID := map[int64]models.EmbeddedTweet{}
	for _, p := range parents {
		e := models.EmbeddedTweet{Tweet: p}
		if a, ok := users[p.UserID]; ok {
			e.Author = a
		}
		byID[p.ID] = e
	}
	for i, ht := range hydrated {
		if ht.ParentID != nil {
			if e, ok := byID[*ht.ParentID]; ok {
				cp := e
				hydrated[i].ParentTweet = &cp
			}
		}
	}
}

func parentAuthorIDs(parents []models.Tweet) []int64 {
	ids := make([]int64, 0, len(parents))
	for _, p := range parents {
		ids = append(ids, p.UserID)
	}
	return ids
}

type updateMeBody struct {
	DisplayName *string `json:"display_name"`
	Bio         *string `json:"bio"`
	Location    *string `json:"location"`
	Website     *string `json:"website"`
	AvatarURL   *string `json:"avatar_url"`
	BannerURL   *string `json:"banner_url"`
}

// UpdateMe implements PATCH /api/v1/users/me.
func (h *Handler) UpdateMe(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	var body updateMeBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid JSON"})
	}
	display := me.DisplayName
	if body.DisplayName != nil {
		display = strings.TrimSpace(*body.DisplayName)
	}
	bio := me.Bio
	if body.Bio != nil {
		bio = strings.TrimSpace(*body.Bio)
	}
	location := me.Location
	if body.Location != nil {
		location = strings.TrimSpace(*body.Location)
	}
	website := me.Website
	if body.Website != nil {
		website = strings.TrimSpace(*body.Website)
	}
	avatar := me.AvatarURL
	if body.AvatarURL != nil {
		avatar = strings.TrimSpace(*body.AvatarURL)
	}
	banner := me.BannerURL
	if body.BannerURL != nil {
		banner = strings.TrimSpace(*body.BannerURL)
	}
	if display == "" || len([]rune(display)) > 50 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Name must be 1-50 characters."})
	}
	if len([]rune(bio)) > 160 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Bio must be 160 characters or fewer."})
	}
	if len([]rune(location)) > 30 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Location must be 30 characters or fewer."})
	}
	if len([]rune(website)) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Website must be 100 characters or fewer."})
	}
	var u models.User
	err := h.Pool.QueryRow(c.Context(),
		`UPDATE public.users SET display_name=$1, bio=$2, location=$3, website=$4, avatar_url=$5, banner_url=$6, updated_at=now()
		 WHERE id=$7 RETURNING `+userColumnsRet,
		display, bio, location, website, avatar, banner, me.ID,
	).Scan(scanUserDest(&u)...)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "update failed"})
	}
	// Purge replaced avatar/banner files from Storage so orphans never accumulate.
	for _, pair := range [][2]string{{me.AvatarURL, avatar}, {me.BannerURL, banner}} {
		if old, next := pair[0], pair[1]; old != "" && old != next {
			if paths := storage.ObjectPathsFromURLs(h.Cfg.SupabaseURL, []string{old}); len(paths) > 0 {
				_ = storage.DeleteObjects(c.Context(), h.Cfg.SupabaseURL, h.Cfg.SupabaseServiceRoleKey, middleware.BearerToken(c), paths)
			}
		}
	}
	// Invalidate the Valkey auth cache so fresh profile fields reflect immediately.
	_ = vstore.Del(c.Context(), h.VC, "auth:user:"+me.AuthID)
	cacheUser(c.Context(), h.VC, &u)
	return c.JSON(&u)
}

// DeleteMe implements DELETE /api/v1/users/me. Purges the user's Storage
// files, removes their Supabase Auth user via the admin API, repairs
// counters the user affected on other people's tweets, then deletes the
// Postgres row (FK cascades remove the rest). Storage/admin steps are best
// effort and never fail the account deletion itself.
func (h *Handler) DeleteMe(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	ctx := c.Context()

	// 1. Collect every Storage object owned by this account.
	var mediaURLs []string
	mediaURLs = append(mediaURLs, me.AvatarURL, me.BannerURL)
	if rows, err := h.Pool.Query(ctx, `SELECT COALESCE(media_urls,'[]')::text FROM public.tweets WHERE user_id = $1`, me.ID); err == nil {
		for rows.Next() {
			var raw string
			if serr := rows.Scan(&raw); serr == nil {
				var urls []string
				if jerr := json.Unmarshal([]byte(raw), &urls); jerr == nil {
					mediaURLs = append(mediaURLs, urls...)
				}
			}
		}
		rows.Close()
	}
	if rows, err := h.Pool.Query(ctx, `SELECT media_url FROM public.messages WHERE sender_id = $1 AND media_url <> ''`, me.ID); err == nil {
		for rows.Next() {
			var u string
			if serr := rows.Scan(&u); serr == nil {
				mediaURLs = append(mediaURLs, u)
			}
		}
		rows.Close()
	}
	if paths := storage.ObjectPathsFromURLs(h.Cfg.SupabaseURL, mediaURLs); len(paths) > 0 {
		_ = storage.DeleteObjects(ctx, h.Cfg.SupabaseURL, h.Cfg.SupabaseServiceRoleKey, middleware.BearerToken(c), paths)
	}

	// 2. Remove the Supabase Auth user (requires service_role; best effort).
	_ = storage.DeleteAuthUser(ctx, h.Cfg.SupabaseURL, h.Cfg.SupabaseServiceRoleKey, me.AuthID)

	// 3. Repair counters on other people's tweets before cascades fire.
	_, _ = h.Pool.Exec(ctx,
		`UPDATE public.tweets t SET like_count = GREATEST(like_count - s.n, 0)
		 FROM (SELECT tweet_id, count(*) AS n FROM public.likes WHERE user_id = $1 GROUP BY tweet_id) s
		 WHERE t.id = s.tweet_id`, me.ID)
	_, _ = h.Pool.Exec(ctx,
		`UPDATE public.tweets t SET retweet_count = GREATEST(retweet_count - s.n, 0)
		 FROM (SELECT tweet_id, count(*) AS n FROM public.retweets WHERE user_id = $1 GROUP BY tweet_id) s
		 WHERE t.id = s.tweet_id`, me.ID)
	_, _ = h.Pool.Exec(ctx,
		`UPDATE public.tweets t SET bookmark_count = GREATEST(bookmark_count - s.n, 0)
		 FROM (SELECT tweet_id, count(*) AS n FROM public.bookmarks WHERE user_id = $1 GROUP BY tweet_id) s
		 WHERE t.id = s.tweet_id`, me.ID)
	_, _ = h.Pool.Exec(ctx,
		`UPDATE public.tweets p SET reply_count = GREATEST(reply_count - s.n, 0)
		 FROM (SELECT parent_id, count(*) AS n FROM public.tweets WHERE user_id = $1 AND parent_id IS NOT NULL GROUP BY parent_id) s
		 WHERE p.id = s.parent_id`, me.ID)
	_, _ = h.Pool.Exec(ctx,
		`UPDATE public.tweets q SET quote_count = GREATEST(quote_count - s.n, 0)
		 FROM (SELECT quote_of_id, count(*) AS n FROM public.tweets WHERE user_id = $1 AND quote_of_id IS NOT NULL GROUP BY quote_of_id) s
		 WHERE q.id = s.quote_of_id`, me.ID)
	_, _ = h.Pool.Exec(ctx,
		`UPDATE public.users u SET followers_count = GREATEST(followers_count - s.n, 0)
		 FROM (SELECT following_id, count(*) AS n FROM public.follows WHERE follower_id = $1 GROUP BY following_id) s
		 WHERE u.id = s.following_id`, me.ID)
	_, _ = h.Pool.Exec(ctx,
		`UPDATE public.users u SET following_count = GREATEST(following_count - s.n, 0)
		 FROM (SELECT follower_id, count(*) AS n FROM public.follows WHERE following_id = $1 GROUP BY follower_id) s
		 WHERE u.id = s.follower_id`, me.ID)

	// 4. Delete the row; FK cascades remove tweets, follows, likes, DMs, etc.
	if _, err := h.Pool.Exec(ctx, `DELETE FROM public.users WHERE id = $1`, me.ID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "delete failed"})
	}
	_ = vstore.Del(ctx, h.VC, "auth:user:"+me.AuthID)
	return c.JSON(fiber.Map{"deleted": true})
}

// TogglePin implements POST /api/v1/tweets/:id/pin.
func (h *Handler) TogglePin(c *fiber.Ctx) error {
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
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "only your own posts can be pinned"})
	}
	var pinned *int64
	if me.PinnedTweetID != nil && *me.PinnedTweetID == id {
		_, _ = h.Pool.Exec(ctx, `UPDATE public.users SET pinned_tweet_id = NULL WHERE id = $1`, me.ID)
	} else {
		_, _ = h.Pool.Exec(ctx, `UPDATE public.users SET pinned_tweet_id = $1 WHERE id = $2`, id, me.ID)
		pinned = &id
	}
	_ = vstore.Del(ctx, h.VC, "auth:user:"+me.AuthID)
	if pinned == nil {
		return c.JSON(fiber.Map{"pinned_tweet_id": nil})
	}
	s := strconv.FormatInt(*pinned, 10)
	return c.JSON(fiber.Map{"pinned_tweet_id": s})
}

// Followers implements GET /api/v1/users/:id/followers.
func (h *Handler) Followers(c *fiber.Ctx) error {
	return h.followList(c, "followers")
}

// Following implements GET /api/v1/users/:id/following.
func (h *Handler) Following(c *fiber.Ctx) error {
	return h.followList(c, "following")
}

func (h *Handler) followList(c *fiber.Ctx, which string) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	targetID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	limit := clampLimit(c.QueryInt("limit", 20))
	ctx := c.Context()
	var q string
	if which == "followers" {
		q = `SELECT ` + userColumns + ` FROM public.users u
			 JOIN public.follows f ON f.follower_id = u.id
			 WHERE f.following_id = $1 ORDER BY f.created_at DESC LIMIT $2`
	} else {
		q = `SELECT ` + userColumns + ` FROM public.users u
			 JOIN public.follows f ON f.following_id = u.id
			 WHERE f.follower_id = $1 ORDER BY f.created_at DESC LIMIT $2`
	}
	rows, err := h.Pool.Query(ctx, q, targetID, limit)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "follow list failed"})
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

func clampLimit(n int) int {
	if n < 1 {
		return 20
	}
	if n > 50 {
		return 50
	}
	return n
}
