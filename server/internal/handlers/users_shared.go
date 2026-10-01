package handlers

import (
	"log"

	"twitter-server/internal/models"

	"github.com/gofiber/fiber/v2"
)

// userColumns is the canonical SELECT/RETURNING list for public.users.
// Order must match scanUserDest. COALESCE guards nullable text/counter
// columns so pgx.Scan never crashes on NULLs from foreign schemas.
const userColumns = `id, COALESCE(auth_id::text,''), COALESCE(email,''), COALESCE(username,''), COALESCE(display_name,''), COALESCE(avatar_url,''), COALESCE(bio,''), COALESCE(location,''), COALESCE(website,''), COALESCE(banner_url,''), pinned_tweet_id, COALESCE(is_verified,FALSE), COALESCE(onboarded,FALSE), COALESCE(tweets_count,0), COALESCE(followers_count,0), COALESCE(following_count,0), u.created_at, u.updated_at`

// userColumnsRet is the same list for UPDATE...RETURNING, where no table
// alias is in scope.
const userColumnsRet = `id, COALESCE(auth_id::text,''), COALESCE(email,''), COALESCE(username,''), COALESCE(display_name,''), COALESCE(avatar_url,''), COALESCE(bio,''), COALESCE(location,''), COALESCE(website,''), COALESCE(banner_url,''), pinned_tweet_id, COALESCE(is_verified,FALSE), COALESCE(onboarded,FALSE), COALESCE(tweets_count,0), COALESCE(followers_count,0), COALESCE(following_count,0), created_at, updated_at`

func scanUserDest(u *models.User) []any {
	return []any{
		&u.ID, &u.AuthID, &u.Email, &u.Username, &u.DisplayName, &u.AvatarURL,
		&u.Bio, &u.Location, &u.Website, &u.BannerURL, &u.PinnedTweetID,
		&u.Verified, &u.Onboarded, &u.TweetsCount, &u.FollowersCount, &u.FollowingCount,
		&u.CreatedAt, &u.UpdatedAt,
	}
}

// dberr logs the exact Postgres error server-side and returns a generic 500
// to the client, so failures are never swallowed silently.
func dberr(c *fiber.Ctx, op string, err error) error {
	log.Printf("db error [%s]: %v", op, err)
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": op + " failed"})
}
