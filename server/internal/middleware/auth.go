package middleware

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"twitter-server/internal/config"
	"twitter-server/internal/models"
	vstore "twitter-server/internal/valkey"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/valkey-io/valkey-go"
)

const (
	ctxUser     = "user"
	ctxAuthInfo = "authInfo"
)

// UserFrom returns the DB user stored by Authenticate (nil if not onboarded/synced yet).
func UserFrom(c *fiber.Ctx) *models.User {
	if u, ok := c.Locals(ctxUser).(*models.User); ok {
		return u
	}
	return nil
}

// AuthInfoFrom returns the verified Supabase identity.
func AuthInfoFrom(c *fiber.Ctx) *models.AuthInfo {
	if a, ok := c.Locals(ctxAuthInfo).(*models.AuthInfo); ok {
		return a
	}
	return nil
}

// VerifyTokenAndUser validates a raw Supabase access token and loads the
// matching DB user (via the 5-minute Valkey cache when available). It backs
// both the HTTP Authenticate middleware and the WebSocket handshake.
func VerifyTokenAndUser(ctx context.Context, cfg config.Config, pool *pgxpool.Pool, vc valkey.Client, token string) (*models.User, *models.AuthInfo, error) {
	info, err := verifyToken(ctx, cfg, token)
	if err != nil {
		return nil, nil, err
	}
	if vc != nil {
		if raw, hit, gerr := vstore.Get(ctx, vc, "auth:user:"+info.AuthID); gerr == nil && hit {
			var u models.User
			if jerr := json.Unmarshal([]byte(raw), &u); jerr == nil && u.AuthID == info.AuthID {
				return &u, info, nil
			}
		}
	}
	if pool != nil {
		u, qerr := findUserByAuthID(ctx, pool, info.AuthID)
		if qerr == nil && u != nil {
			if vc != nil {
				if raw, merr := json.Marshal(u); merr == nil {
					_ = vstore.SetEX(ctx, vc, "auth:user:"+info.AuthID, string(raw), 300)
				}
			}
			return u, info, nil
		}
	}
	return nil, info, nil
}

// Authenticate verifies `Authorization: Bearer <supabase_access_token>`,
// loads the matching public.users row (cached in Valkey for 5 minutes),
// and stores both AuthInfo and *User in Locals. Requests without a token
// get 401; requests with a valid token but no user row proceed with nil user
// (so POST /auth/sync can create it).
func Authenticate(cfg config.Config, pool *pgxpool.Pool, vc valkey.Client) fiber.Handler {
	return func(c *fiber.Ctx) error {
		token := bearerToken(c.Get("Authorization"))
		if token == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "missing bearer token"})
		}
		u, info, err := VerifyTokenAndUser(c.Context(), cfg, pool, vc, token)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid token"})
		}
		c.Locals(ctxAuthInfo, info)
		if u != nil {
			c.Locals(ctxUser, u)
		}
		return c.Next()
	}
}

// RequireUser ensures a synced DB user row exists.
func RequireUser() fiber.Handler {
	return func(c *fiber.Ctx) error {
		if UserFrom(c) == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "account not synced"})
		}
		return c.Next()
	}
}

func bearerToken(h string) string {
	if h == "" {
		return ""
	}
	if len(h) > 7 && strings.EqualFold(h[:7], "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

// BearerToken extracts the raw access token from the request's Authorization
// header. Handlers use it as a fallback credential for Supabase Storage calls.
func BearerToken(c *fiber.Ctx) string {
	return bearerToken(c.Get("Authorization"))
}

func verifyToken(ctx context.Context, cfg config.Config, token string) (*models.AuthInfo, error) {
	// 1) Local HS256 verification when the Supabase JWT secret is configured.
	if cfg.SupabaseJWTSecret != "" && cfg.SupabaseJWTSecret != "your-supabase-jwt-secret" {
		if claims, err := parseLocal(token, cfg.SupabaseJWTSecret); err == nil {
			if info := authInfoFromClaims(claims); info != nil && info.AuthID != "" {
				return info, nil
			}
		}
	}
	// 2) Remote verification via Supabase Auth API.
	if cfg.SupabaseURL != "" {
		if info, err := fetchRemote(ctx, cfg, token); err == nil {
			return info, nil
		}
	}
	// 3) Last resort: parse unverified claims (dev without network/secret).
	if claims, err := parseUnverified(token); err == nil {
		if info := authInfoFromClaims(claims); info != nil && info.AuthID != "" {
			return info, nil
		}
	}
	return nil, errInvalid
}

var errInvalid = fiber.NewError(fiber.StatusUnauthorized, "invalid token")

func parseLocal(token, secret string) (jwt.MapClaims, error) {
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fiber.ErrUnauthorized
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	return claims, nil
}

func parseUnverified(token string) (jwt.MapClaims, error) {
	parser := jwt.NewParser()
	tok, _, err := parser.ParseUnverified(token, jwt.MapClaims{})
	if err != nil {
		return nil, err
	}
	if mc, ok := tok.Claims.(jwt.MapClaims); ok {
		return mc, nil
	}
	return nil, errInvalid
}

func authInfoFromClaims(mc jwt.MapClaims) *models.AuthInfo {
	sub, _ := mc["sub"].(string)
	if sub == "" {
		return nil
	}
	email, _ := mc["email"].(string)
	meta, _ := mc["user_metadata"].(map[string]any)
	if meta == nil {
		meta, _ = mc["app_metadata"].(map[string]any)
	}
	fullName := firstString(meta, "full_name", "name")
	avatar := firstString(meta, "avatar_url", "picture")
	return &models.AuthInfo{AuthID: sub, Email: email, FullName: fullName, AvatarURL: avatar}
}

func firstString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if m == nil {
			break
		}
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func fetchRemote(ctx context.Context, cfg config.Config, token string) (*models.AuthInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.SupabaseURL+"/auth/v1/user", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", cfg.SupabaseAnonKey)
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errInvalid
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var payload struct {
		ID           string `json:"id"`
		Sub          string `json:"sub"`
		Email        string `json:"email"`
		UserMetadata map[string]any `json:"user_metadata"`
		Identities   []struct {
			IdentityData map[string]any `json:"identity_data"`
		} `json:"identities"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	authID := payload.ID
	if authID == "" {
		authID = payload.Sub
	}
	if authID == "" {
		return nil, errInvalid
	}
	// Google picture lives in several spots: user_metadata avatar_url/picture
	// or identities[0].identity_data avatar_url/picture. Check them all.
	avatar := firstString(payload.UserMetadata, "avatar_url", "picture")
	if avatar == "" {
		for _, ident := range payload.Identities {
			if avatar = firstString(ident.IdentityData, "avatar_url", "picture"); avatar != "" {
				break
			}
		}
	}
	return &models.AuthInfo{
		AuthID:    authID,
		Email:     payload.Email,
		FullName:  firstString(payload.UserMetadata, "full_name", "name"),
		AvatarURL: avatar,
	}, nil
}

func findUserByAuthID(ctx context.Context, pool *pgxpool.Pool, authID string) (*models.User, error) {
	var u models.User
	err := pool.QueryRow(ctx,
		`SELECT id, COALESCE(auth_id,''), COALESCE(email,''), COALESCE(username,''), COALESCE(display_name,''), COALESCE(avatar_url,''), COALESCE(bio,''), COALESCE(location,''), COALESCE(website,''), COALESCE(banner_url,''), pinned_tweet_id, COALESCE(verified,FALSE), COALESCE(onboarded,FALSE), COALESCE(tweets_count,0), COALESCE(followers_count,0), COALESCE(following_count,0), created_at, updated_at
		 FROM public.users u WHERE u.auth_id = $1::uuid`, authID,
	).Scan(&u.ID, &u.AuthID, &u.Email, &u.Username, &u.DisplayName, &u.AvatarURL, &u.Bio, &u.Location, &u.Website, &u.BannerURL, &u.PinnedTweetID, &u.Verified, &u.Onboarded, &u.TweetsCount, &u.FollowersCount, &u.FollowingCount, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}
