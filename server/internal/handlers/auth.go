package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"twitter-server/internal/config"
	"twitter-server/internal/middleware"
	"twitter-server/internal/models"
	sf "twitter-server/internal/snowflake"
	vstore "twitter-server/internal/valkey"
	"twitter-server/internal/ws"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/valkey-io/valkey-go"
)

type Handler struct {
	Cfg  config.Config
	Pool *pgxpool.Pool
	VC   valkey.Client
	Hub  *ws.Hub
}

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9_]{1,15}$`)

// syncBody carries optional client-supplied identity metadata (from
// supabase.auth.getUser()/getSession()). It enriches — never replaces —
// token-verified identity, so Google OAuth sync never 500s on sparse claims.
type syncBody struct {
	AuthID    string `json:"auth_id"`
	Email     string `json:"email"`
	FullName  string `json:"full_name"`
	AvatarURL string `json:"avatar_url"`
}

// Sync implements POST /api/v1/auth/sync.
func (h *Handler) Sync(c *fiber.Ctx) error {
	info := middleware.AuthInfoFrom(c)
	var body syncBody
	_ = c.BodyParser(&body) // optional enrichment only; never fails the request

	authID, email, fullName, avatarURL := "", "", "", ""
	if info != nil {
		authID, email, fullName, avatarURL = info.AuthID, info.Email, info.FullName, info.AvatarURL
	}
	if v := strings.TrimSpace(body.AuthID); v != "" && authID == "" {
		authID = v
	}
	if v := strings.TrimSpace(body.Email); v != "" && email == "" {
		email = v
	}
	if v := strings.TrimSpace(body.FullName); v != "" && fullName == "" {
		fullName = v
	}
	if v := strings.TrimSpace(body.AvatarURL); v != "" && avatarURL == "" {
		avatarURL = v
	}
	if authID == "" || !isUUID(authID) {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid token"})
	}
	ctx := c.Context()
	avatar := upgradeAvatar(avatarURL)
	display := displayNameFor(fullName, email)

	// 1) Existing row for this auth identity: refresh provider fields.
	// Never wipe a good stored avatar with an empty one; explicitly backfill
	// empty avatars from Google and flush the auth cache afterwards.
	if existing, ferr := findByAuthID(ctx, h.Pool, authID); ferr == nil && existing != nil {
		if existing.DisplayName != "" && fullName == "" {
			display = existing.DisplayName
		}
		storeAvatar := avatar
		backfilling := false
		if storeAvatar == "" {
			storeAvatar = existing.AvatarURL
		} else if existing.AvatarURL == "" {
			backfilling = true
		}
		var updated models.User
		qerr := h.Pool.QueryRow(ctx,
			`UPDATE public.users SET email=$1, avatar_url=$2, display_name=$3, updated_at=now()
			 WHERE auth_id=$4::uuid RETURNING `+userColumnsRet,
			email, storeAvatar, display, authID,
		).Scan(scanUserDest(&updated)...)
		if qerr != nil {
			return dberr(c, "sync refresh", qerr)
		}
		if backfilling {
			_ = vstore.Del(ctx, h.VC, "auth:user:"+authID)
		}
		cacheUser(ctx, h.VC, &updated)
		return c.JSON(&updated)
	} else if ferr != nil && !errors.Is(ferr, pgx.ErrNoRows) {
		return dberr(c, "sync lookup", ferr)
	}

	// 2) Same email under a different auth_id (provider re-link): attach the
	// new auth_id to the existing row instead of 23505-crashing.
	if email != "" {
		var linked models.User
		lerr := h.Pool.QueryRow(ctx,
			`UPDATE public.users SET auth_id=$1::uuid, avatar_url=CASE WHEN $2<>'' THEN $2 ELSE avatar_url END, display_name=CASE WHEN $3<>'' THEN $3 ELSE display_name END, updated_at=now()
			 WHERE lower(email)=lower($4) RETURNING `+userColumnsRet,
			authID, avatar, display, email,
		).Scan(scanUserDest(&linked)...)
		if lerr == nil {
			cacheUser(ctx, h.VC, &linked)
			return c.JSON(&linked)
		} else if !errors.Is(lerr, pgx.ErrNoRows) {
			return dberr(c, "sync link", lerr)
		}
	}

	// 3) Fresh account. ON CONFLICT guards double-submit races; on a
	// username 23505 race we retry once with a suffixed username.
	base := sanitizeUsername(email, fullName)
	for attempt := 0; attempt < 2; attempt++ {
		username := base
		if attempt > 0 {
			username = base[:min(11, len(base))] + "_" + itoa(sf.Generate()%900+100)
		} else {
			var uerr error
			username, uerr = uniqueUsername(ctx, h.Pool, base)
			if uerr != nil {
				return dberr(c, "username allocation", uerr)
			}
		}
		var u models.User
		err := h.Pool.QueryRow(ctx,
			`INSERT INTO public.users (id, auth_id, email, username, display_name, avatar_url, bio, location, website, banner_url, pinned_tweet_id, is_verified, onboarded)
			 VALUES ($1,$2::uuid,$3,$4,$5,$6,'','','','',NULL,FALSE,FALSE)
			 ON CONFLICT (auth_id) DO UPDATE SET email=EXCLUDED.email, avatar_url=EXCLUDED.avatar_url, display_name=EXCLUDED.display_name, updated_at=now()
			 RETURNING `+userColumnsRet,
			sf.Generate(), authID, email, username, display, avatar,
		).Scan(scanUserDest(&u)...)
		if err == nil {
			cacheUser(ctx, h.VC, &u)
			return c.Status(fiber.StatusCreated).JSON(&u)
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && attempt == 0 {
			continue // username race: retry once with a suffix
		}
		return dberr(c, "user creation", err)
	}
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "user creation failed"})
}

func displayNameFor(fullName, email string) string {
	if fullName != "" {
		return fullName
	}
	if parts := strings.SplitN(email, "@", 2); len(parts) > 0 && parts[0] != "" {
		return parts[0]
	}
	return "user"
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// isUUID guards uuid-typed columns (users.auth_id) from malformed casts.
func isUUID(s string) bool {
	return uuidRe.MatchString(s)
}

// Me implements GET /api/v1/auth/me.
func (h *Handler) Me(c *fiber.Ctx) error {
	u := middleware.UserFrom(c)
	if u == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not synced"})
	}
	return c.JSON(u)
}

// CheckUsername implements GET /api/v1/users/check-username?username=...
func (h *Handler) CheckUsername(c *fiber.Ctx) error {
	raw := strings.TrimSpace(c.Query("username", ""))
	username := strings.TrimPrefix(raw, "@")
	if !usernameRe.MatchString(username) {
		return c.JSON(fiber.Map{"username": username, "available": false, "reason": "Usernames must be 1-15 chars: letters, numbers, underscore."})
	}
	var count int
	err := h.Pool.QueryRow(c.Context(),
		`SELECT count(*) FROM public.users WHERE lower(username) = lower($1)`, username).Scan(&count)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "lookup failed"})
	}
	if count == 0 {
		return c.JSON(fiber.Map{"username": username, "available": true})
	}
	// Own username counts as available (no-op change).
	if me := middleware.UserFrom(c); me != nil && strings.EqualFold(me.Username, username) {
		return c.JSON(fiber.Map{"username": username, "available": true})
	}
	return c.JSON(fiber.Map{"username": username, "available": false})
}

type onboardingBody struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Bio         string `json:"bio"`
}

// CompleteOnboarding implements PATCH /api/v1/users/me/onboarding.
func (h *Handler) CompleteOnboarding(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	var body onboardingBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid JSON"})
	}
	username := strings.TrimPrefix(strings.TrimSpace(body.Username), "@")
	display := strings.TrimSpace(body.DisplayName)
	bio := strings.TrimSpace(body.Bio)
	if !usernameRe.MatchString(username) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Usernames must be 1-15 chars: letters, numbers, underscore."})
	}
	if display == "" {
		display = me.DisplayName
	}
	if len([]rune(bio)) > 160 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Bio must be 160 characters or fewer."})
	}
	var taken int
	if err := h.Pool.QueryRow(c.Context(),
		`SELECT count(*) FROM public.users WHERE lower(username)=lower($1) AND id <> $2`, username, me.ID).Scan(&taken); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "lookup failed"})
	}
	if taken > 0 {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "username taken"})
	}
	var u models.User
	err := h.Pool.QueryRow(c.Context(),
		`UPDATE public.users SET username=$1, display_name=$2, bio=$3, onboarded=TRUE, updated_at=now() WHERE id=$4
		 RETURNING `+userColumnsRet,
		username, display, bio, me.ID,
	).Scan(scanUserDest(&u)...)
	if err != nil {
		return dberr(c, "onboarding update", err)
	}
	cacheUser(c.Context(), h.VC, &u)
	return c.JSON(&u)
}

func upgradeAvatar(url string) string {
	if url == "" {
		return ""
	}
	if strings.Contains(url, "googleusercontent.com") {
		url = strings.ReplaceAll(url, "=s96-c", "=s400-c")
	}
	return url
}

func sanitizeUsername(email, fullName string) string {
	base := ""
	if email != "" {
		if parts := strings.SplitN(email, "@", 2); len(parts) > 0 {
			base = parts[0]
		}
	}
	if base == "" && fullName != "" {
		base = fullName
	}
	lowered := strings.ToLower(base)
	var b strings.Builder
	for _, r := range lowered {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
		} else if r == ' ' || r == '-' || r == '.' {
			b.WriteRune('_')
		}
	}
	out := strings.Trim(b.String(), "_")
	if out == "" {
		out = "user"
	}
	if len(out) > 12 {
		out = out[:12]
	}
	return out
}

func uniqueUsername(ctx context.Context, pool *pgxpool.Pool, base string) (string, error) {
	candidate := base
	for i := 0; i < 50; i++ {
		name := candidate
		if i > 0 {
			suffix := itoa(int64(i) * 7 % 997)
			// Keep total <= 15 chars.
			maxBase := 15 - len(suffix) - 1
			trimmed := candidate
			if len(trimmed) > maxBase && maxBase > 0 {
				trimmed = trimmed[:maxBase]
			}
			name = trimmed + "_" + suffix
		}
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.users WHERE lower(username)=lower($1)`, name).Scan(&count); err != nil {
			return "", err
		}
		if count == 0 {
			return name, nil
		}
	}
	// Final fallback: base + snowflake suffix.
	return base[:min(8, len(base))] + "_" + itoa(sf.Generate()%9000+1000), nil
}

func findByAuthID(ctx context.Context, pool *pgxpool.Pool, authID string) (*models.User, error) {
	var u models.User
	err := pool.QueryRow(ctx,
		`SELECT `+userColumns+`
		 FROM public.users u WHERE u.auth_id=$1::uuid`, authID,
	).Scan(scanUserDest(&u)...)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func cacheUser(ctx context.Context, vc valkey.Client, u *models.User) {
	if vc == nil || u == nil {
		return
	}
	raw, err := json.Marshal(u)
	if err != nil {
		return
	}
	_ = vstore.SetEX(ctx, vc, "auth:user:"+u.AuthID, string(raw), 300)
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var buf [24]byte
	i := len(buf)
	neg := n < 0
	if neg {
		n = -n
	}
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
