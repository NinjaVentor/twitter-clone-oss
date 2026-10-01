package handlers

import (
	"math"
	"sort"
	"strconv"

	"twitter-server/internal/algorithm"
	"twitter-server/internal/middleware"
	"twitter-server/internal/models"
	vstore "twitter-server/internal/valkey"

	"github.com/gofiber/fiber/v2"
)

// Trends implements GET /api/v1/trends: top 10 hashtags from the Valkey
// `trends:24h` ZSET with fallback to the Postgres hashtags table.
func (h *Handler) Trends(c *fiber.Ctx) error {
	if h.VC != nil {
		members, scores, err := vstore.ZRevRangeWithScores(c.Context(), h.VC, "trends:24h", 0, 9)
		if err == nil && len(members) > 0 {
			trends := make([]models.Trend, 0, len(members))
			for i, m := range members {
				trends = append(trends, models.Trend{Tag: m, Count: int(scores[i])})
			}
			return c.JSON(fiber.Map{"trends": trends})
		}
	}
	rows, err := h.Pool.Query(c.Context(),
		`SELECT tag, tweet_count FROM public.hashtags ORDER BY tweet_count DESC LIMIT 10`)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "trends failed"})
	}
	defer rows.Close()
	trends := []models.Trend{}
	for rows.Next() {
		var t models.Trend
		if err := rows.Scan(&t.Tag, &t.Count); err == nil {
			trends = append(trends, t)
		}
	}
	return c.JSON(fiber.Map{"trends": trends})
}

// WhoToFollow implements GET /api/v1/users/who-to-follow, ranked by
// mutual followers, author affinity, and follower count.
func (h *Handler) WhoToFollow(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	ctx := c.Context()
	rows, err := h.Pool.Query(ctx,
		`SELECT `+userColumns+`
		 FROM public.users u
		 WHERE u.id <> $1 AND u.id NOT IN (SELECT following_id FROM public.follows WHERE follower_id = $1)
		 ORDER BY u.followers_count DESC, u.id DESC LIMIT 50`, me.ID)
	if err != nil {
		return dberr(c, "suggestions", err)
	}
	type candidate struct {
		u       models.User
		mutual  int
		affinity float64
		score   float64
	}
	cands := []candidate{}
	ids := []int64{}
	idSet := map[int64]bool{}
	collect := func() {
		defer rows.Close()
		for rows.Next() {
			var u models.User
			if serr := rows.Scan(scanUserDest(&u)...); serr == nil {
				cands = append(cands, candidate{u: u})
				ids = append(ids, u.ID)
				idSet[u.ID] = true
			}
		}
	}
	collect()
	if len(ids) == 0 {
		return c.JSON(fiber.Map{"users": []models.FollowUser{}})
	}
	// Mutual followers: my follows who also follow the candidate.
	mutual := map[int64]int{}
	if mrows, merr := h.Pool.Query(ctx, `
		SELECT f2.following_id, COUNT(*) FROM public.follows f1
		JOIN public.follows f2 ON f2.follower_id = f1.following_id
		WHERE f1.follower_id = $1 AND f2.following_id = ANY($2)
		GROUP BY f2.following_id`, me.ID, ids); merr == nil {
		for mrows.Next() {
			var id int64
			var n int
			if serr := mrows.Scan(&id, &n); serr == nil {
				mutual[id] = n
			}
		}
		mrows.Close()
	}
	aff := algorithm.GetAffinities(ctx, h.VC, h.Pool, me.ID)
	for i := range cands {
		m := mutual[cands[i].u.ID]
		a := aff.Authors[cands[i].u.ID]
		cands[i].mutual = m
		cands[i].affinity = a
		cands[i].score = float64(m)*3.0 + a*2.0 + math.Log10(1+float64(cands[i].u.FollowersCount))
	}
	sort.SliceStable(cands, func(i, j int) bool {
		if cands[i].score == cands[j].score {
			return cands[i].u.ID > cands[j].u.ID
		}
		return cands[i].score > cands[j].score
	})
	if len(cands) > 5 {
		cands = cands[:5]
	}
	users := make([]models.FollowUser, 0, len(cands))
	for _, cand := range cands {
		users = append(users, models.FollowUser{User: cand.u, IsFollowing: false})
	}
	return c.JSON(fiber.Map{"users": users})
}

// ToggleFollow implements POST /api/v1/users/:id/follow.
// follower_id is always the actor (current user); following_id is always the
// target. Counts are recomputed from COUNT(*) subqueries so they never drift.
func (h *Handler) ToggleFollow(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	targetID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id"})
	}
	if targetID == me.ID {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cannot follow yourself"})
	}
	ctx := c.Context()
	var targetExists bool
	_ = h.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.users WHERE id=$1)`, targetID).Scan(&targetExists)
	if !targetExists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "user not found"})
	}
	var following bool
	_ = h.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.follows WHERE follower_id=$1 AND following_id=$2)`, me.ID, targetID).Scan(&following)
	if following {
		_, _ = h.Pool.Exec(ctx, `DELETE FROM public.follows WHERE follower_id=$1 AND following_id=$2`, me.ID, targetID)
	} else {
		if _, err := h.Pool.Exec(ctx, `INSERT INTO public.follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, me.ID, targetID); err != nil {
			return dberr(c, "follow", err)
		}
		h.notifyUser(ctx, targetID, me.ID, "FOLLOW", nil)
	}
	// Atomic recompute — counts can never drift or go negative.
	_, _ = h.Pool.Exec(ctx, `UPDATE public.users SET following_count = (SELECT COUNT(*) FROM public.follows WHERE follower_id = $1) WHERE id = $1`, me.ID)
	_, _ = h.Pool.Exec(ctx, `UPDATE public.users SET followers_count = (SELECT COUNT(*) FROM public.follows WHERE following_id = $1) WHERE id = $1`, targetID)
	var followersCount int
	_ = h.Pool.QueryRow(ctx, `SELECT followers_count FROM public.users WHERE id = $1`, targetID).Scan(&followersCount)
	return c.JSON(fiber.Map{"following": !following, "followers_count": followersCount})
}
