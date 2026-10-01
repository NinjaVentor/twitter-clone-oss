# Twitter Clone

A full-stack classic-Twitter clone: Tweet, Retweet, Quote Tweet, threads, likes, bookmarks, polls, follows, profiles, trends, search, notifications, and real-time Direct Messages over WebSockets.

**Tech stack:** Go (Fiber) · React + Vite · Supabase (Postgres + Auth + Storage) · Valkey/Redis (cache + Pub/Sub) · Tailwind CSS · React Query.

Built by [Rishabh Verma](https://github.com/NinjaVentor).

## Run it locally

**Prerequisites:** Go 1.27+, Node 18+, a Supabase project, and Valkey/Redis (local Docker works: `docker run -d -p 6379:6379 valkey/valkey`).

**1. Backend** (`/server`):

```bash
cd server
cp .env.example .env
# Fill in DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
# (VALKEY_ADDR defaults to localhost:6379; or set VALKEY_URL for cloud/TLS)
go run ./cmd/api        # API on http://localhost:8080, /healthz for monitors
```

**2. Frontend** (`/client`):

```bash
cd client
cp .env.example .env
# Fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
# (VITE_API_URL / VITE_WS_URL default to the local backend)
npm install
npm run dev             # App on http://localhost:5173
```

**Checks:** `go build ./...` in `/server`; `npm run check` (`oxlint` + `tsc`) and `npm run build` in `/client`.

## Deploy

- **Frontend → Vercel:** import `/client`; `client/vercel.json` already rewrites all routes to `index.html` for SPA refreshes.
- **Backend → Render/Koyeb:** deploy `/server` (`server/Dockerfile`, binds `0.0.0.0:$PORT`, CORS allows `FRONTEND_URL` + `*.vercel.app`); set `DATABASE_URL`, `SUPABASE_*`, `VALKEY_URL`, `FRONTEND_URL`. Point UptimeRobot at `/healthz`.

Never commit real credentials — `.env`, `.env.local`, `.env.development`, and `.env.production` are git-ignored in every package; only `.env.example` placeholders belong in the repo.
