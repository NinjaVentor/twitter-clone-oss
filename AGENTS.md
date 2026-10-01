# AGENTS.md — Production Classic Twitter Clone Specification

## 0. Classic Twitter Branding (Strict — Never "X")
- **Logo**: The iconic Twitter Blue Bird SVG only (`viewBox="0 0 24 24"`, `src/components/icons.tsx` → `TwitterBird`, extracted from `/references/ccrsxx-twitter`). Fill `#1d9bf0` (or `currentColor` on dark surfaces). The "X" glyph, name, and "X Corp." must never appear anywhere in UI, titles, or copy. Favicon is the Blue Bird data-URI SVG; `<title>` is `Twitter. It's what's happening`.
- **Terminology**: **Tweet** (never Post), **Tweets**, **Retweet** / **Retweeted** (never Repost), **Quote Tweet** (never Quote), **"Show N Tweets"** realtime pill, "Join Twitter today." Dynamic titles are `"Home / Twitter"`, `"Explore / Twitter"`, `"Notifications / Twitter"`, `"Messages / Twitter"`, `"Bookmarks / Twitter"`, `"<name> (@<user>) / Twitter"`.
- Backend API field names (`reposted_tweet`, `reposted_by`, `retweeted_by_me`) are wire-contract identifiers and stay as-is; only user-visible strings follow Tweet/Retweet terminology.

## 1. Tooling & Verification
- **Linter**: We use `oxlint` (NOT ESLint). After making frontend changes in `/client`, always run `npm run check` (`oxlint src --deny-warnings && tsc -b --noEmit`).
- **Backend Verification**: After editing `/server`, always run `go build ./...` to verify compilation.
- **Reference Codebases**: Inspect `/references/twitter-ui-build` and `/references/ccrsxx-twitter` for exact SVG icon paths, Twitter layout geometry, and modal transitions.

## 2. Authentication & Google OAuth Flow (Exact Twitter.com Behavior)
- Logged-out users hit `/` which renders the split-screen Twitter landing page (giant Blue Bird SVG on the left over `#1d9bf0`, "Happening now / Join Twitter today." on the right).
- Support:
  1. **Continue with Google** via `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/auth/callback' } })`.
  2. **Create account / Sign in** via email + password (`supabase.auth.signUp` / `signInWithPassword`) inside Twitter's multi-step dark modal.
- On session acquisition, the client calls `POST /api/v1/auth/sync` with `Authorization: Bearer <supabase_access_token>`.
- The Go `/api/v1/auth/sync` handler:
  - Extracts `sub` (`auth_id`), `email`, `user_metadata.full_name` (or `name`), and `user_metadata.avatar_url` (or `picture`) from the verified Supabase token.
  - Upgrades Google profile picture URLs by replacing `=s96-c` with `=s400-c`.
  - Inserts or updates `public.users` with a 64-bit Snowflake ID (`bwmarrin/snowflake`).
  - Returns the `User` struct. If `user.onboarded == false`, the frontend pops Twitter's "What should we call you?" `@username` claim modal (`PATCH /api/v1/users/me/onboarding`) with live username availability checking (`GET /api/v1/users/check-username?username=...`).

## 3. Zero Mock Data Rule
- Never hardcode arrays for feeds, trends, who-to-follow, notifications, or messages.
- Every UI component must read and mutate real state from `/server` (Supabase PostgreSQL + Valkey).
- All 64-bit `BIGINT` Snowflake IDs must be serialized as strings in JSON (`json:"id,string"`).

## 4. Typography, Emojis & Theme
- Load `TwitterChirp` font weights (400, 500, 700, 800) from `abs.twimg.com` in `/client/src/index.css`.
- Render all emojis in tweet text, display names, bios, and DMs as Twitter SVGs via `@twemoji/api` / `twemoji-parser` (`https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/`).
- Use `twitter-text` for weighted 280-character validation and entity extraction (`#hashtags`, `@mentions`, URLs).