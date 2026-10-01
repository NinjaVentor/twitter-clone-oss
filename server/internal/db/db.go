package db

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool parses DATABASE_URL and forces SimpleProtocol so Supabase
// Supavisor (port 6543, transaction mode) never errors on prepared statements.
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return pool, nil
}

// EnsureSchema creates the Milestone 1 + 2 tables if they do not exist and
// backfills columns for databases created by Milestone 1.
func EnsureSchema(ctx context.Context, pool *pgxpool.Pool) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS public.users (
			id BIGINT PRIMARY KEY,
			auth_id UUID UNIQUE NOT NULL,
			email TEXT NOT NULL,
			username TEXT UNIQUE NOT NULL,
			display_name TEXT NOT NULL DEFAULT '',
			avatar_url TEXT NOT NULL DEFAULT '',
			bio TEXT NOT NULL DEFAULT '',
			is_verified BOOLEAN NOT NULL DEFAULT FALSE,
			onboarded BOOLEAN NOT NULL DEFAULT FALSE,
			tweets_count INT NOT NULL DEFAULT 0,
			followers_count INT NOT NULL DEFAULT 0,
			following_count INT NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tweets_count INT NOT NULL DEFAULT 0`,
		`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS followers_count INT NOT NULL DEFAULT 0`,
		`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS following_count INT NOT NULL DEFAULT 0`,
		`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS website TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS banner_url TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pinned_tweet_id BIGINT`,
		`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
		// Heal pre-Supabase schemas: verified -> is_verified.
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'verified')
			   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_verified') THEN
				ALTER TABLE public.users RENAME COLUMN verified TO is_verified;
			END IF;
		END $$`,
		`CREATE INDEX IF NOT EXISTS idx_users_username_lower ON public.users (lower(username))`,
		`CREATE INDEX IF NOT EXISTS idx_users_auth_id ON public.users (auth_id)`,
		`CREATE TABLE IF NOT EXISTS public.tweets (
			id BIGINT PRIMARY KEY,
			user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
			content TEXT NOT NULL DEFAULT '',
			parent_id BIGINT REFERENCES public.tweets(id) ON DELETE SET NULL,
			quote_of_id BIGINT REFERENCES public.tweets(id) ON DELETE SET NULL,
			repost_of_id BIGINT REFERENCES public.tweets(id) ON DELETE CASCADE,
			media_urls JSONB NOT NULL DEFAULT '[]',
			poll_data JSONB,
			like_count INT NOT NULL DEFAULT 0,
			retweet_count INT NOT NULL DEFAULT 0,
			reply_count INT NOT NULL DEFAULT 0,
			quote_count INT NOT NULL DEFAULT 0,
			bookmark_count INT NOT NULL DEFAULT 0,
			view_count INT NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES public.tweets(id) ON DELETE SET NULL`,
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS quote_of_id BIGINT REFERENCES public.tweets(id) ON DELETE SET NULL`,
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS repost_of_id BIGINT REFERENCES public.tweets(id) ON DELETE CASCADE`,
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'`,
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS poll_data JSONB`,
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS like_count INT NOT NULL DEFAULT 0`,
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS retweet_count INT NOT NULL DEFAULT 0`,
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS reply_count INT NOT NULL DEFAULT 0`,
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS quote_count INT NOT NULL DEFAULT 0`,
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS bookmark_count INT NOT NULL DEFAULT 0`,
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0`,
		// Milestone 1 seeds stored replies in reply_to_id; unify onto parent_id
		// (only where that legacy column exists — Supabase may not have it).
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tweets' AND column_name = 'reply_to_id') THEN
				UPDATE public.tweets SET parent_id = reply_to_id WHERE parent_id IS NULL AND reply_to_id IS NOT NULL;
			END IF;
		END $$`,
		`CREATE INDEX IF NOT EXISTS idx_tweets_user_id ON public.tweets (user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_tweets_id_desc ON public.tweets (id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_tweets_parent_id ON public.tweets (parent_id)`,
		// Full-text search over tweet content (Milestone 3).
		`ALTER TABLE public.tweets ADD COLUMN IF NOT EXISTS search_vector TSVECTOR`,
		`CREATE INDEX IF NOT EXISTS idx_tweets_search_vector ON public.tweets USING GIN (search_vector)`,
		// Supabase manages search_vector as GENERATED ALWAYS; a manual trigger
		// writing to it makes every INSERT fail. Drop ours unconditionally,
		// then only recreate it when the column is NOT generated (local PG).
		`DROP TRIGGER IF EXISTS trg_tweets_search_vector ON public.tweets`,
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tweets' AND column_name = 'search_vector' AND is_generated = 'NEVER') THEN
				IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tweets_search_vector') THEN
					CREATE TRIGGER trg_tweets_search_vector
					BEFORE INSERT OR UPDATE OF content ON public.tweets
					FOR EACH ROW EXECUTE FUNCTION tsvector_update_trigger(search_vector, 'pg_catalog.english', content);
				END IF;
			END IF;
		END $$`,
		`UPDATE public.tweets SET content = content WHERE search_vector IS NULL`,
		`DO $$ BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_pinned_tweet') THEN
				ALTER TABLE public.users ADD CONSTRAINT fk_users_pinned_tweet FOREIGN KEY (pinned_tweet_id) REFERENCES public.tweets(id) ON DELETE SET NULL;
			END IF;
		END $$`,
		`CREATE TABLE IF NOT EXISTS public.follows (
			follower_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
			following_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (follower_id, following_id)
		)`,
		// Heal pre-Supabase schemas: followed_id -> following_id.
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'follows' AND column_name = 'followed_id')
			   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'follows' AND column_name = 'following_id') THEN
				ALTER TABLE public.follows RENAME COLUMN followed_id TO following_id;
			END IF;
		END $$`,
		`CREATE TABLE IF NOT EXISTS public.hashtags (
			tag TEXT PRIMARY KEY,
			tweet_count INT NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		`CREATE TABLE IF NOT EXISTS public.tweet_hashtags (
			tweet_id BIGINT NOT NULL REFERENCES public.tweets(id) ON DELETE CASCADE,
			tag TEXT NOT NULL REFERENCES public.hashtags(tag) ON DELETE CASCADE,
			PRIMARY KEY (tweet_id, tag)
		)`,
		`CREATE TABLE IF NOT EXISTS public.likes (
			user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
			tweet_id BIGINT NOT NULL REFERENCES public.tweets(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (user_id, tweet_id)
		)`,
		`CREATE TABLE IF NOT EXISTS public.retweets (
			user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
			tweet_id BIGINT NOT NULL REFERENCES public.tweets(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (user_id, tweet_id)
		)`,
		`CREATE TABLE IF NOT EXISTS public.bookmarks (
			user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
			tweet_id BIGINT NOT NULL REFERENCES public.tweets(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (user_id, tweet_id)
		)`,
		`CREATE TABLE IF NOT EXISTS public.poll_votes (
			user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
			tweet_id BIGINT NOT NULL REFERENCES public.tweets(id) ON DELETE CASCADE,
			option_index INT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			PRIMARY KEY (user_id, tweet_id)
		)`,
		`CREATE TABLE IF NOT EXISTS public.notifications (
			id BIGINT PRIMARY KEY,
			recipient_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
			actor_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
			type TEXT NOT NULL,
			tweet_id BIGINT REFERENCES public.tweets(id) ON DELETE CASCADE,
			is_read BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		// Heal pre-Supabase schemas: user_id -> recipient_id, read -> is_read.
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'user_id')
			   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'recipient_id') THEN
				ALTER TABLE public.notifications RENAME COLUMN user_id TO recipient_id;
			END IF;
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'read')
			   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'is_read') THEN
				ALTER TABLE public.notifications RENAME COLUMN read TO is_read;
			END IF;
		END $$`,
		`CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications (recipient_id, id DESC)`,
		`CREATE TABLE IF NOT EXISTS public.messages (
			id BIGINT PRIMARY KEY,
			sender_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
			recipient_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
			content TEXT NOT NULL DEFAULT '',
			media_url TEXT NOT NULL DEFAULT '',
			reaction TEXT NOT NULL DEFAULT '',
			is_read BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`,
		// Heal pre-Supabase schemas: read -> is_read.
		`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'read')
			   AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'is_read') THEN
				ALTER TABLE public.messages RENAME COLUMN read TO is_read;
			END IF;
		END $$`,
		`DELETE FROM public.messages WHERE sender_id = recipient_id`,
		`CREATE INDEX IF NOT EXISTS idx_messages_convo ON public.messages (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), id DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_messages_unread ON public.messages (recipient_id, is_read)`,
		// One-time startup repair: resync every denormalized counter from
		// real COUNT(*) rows so legacy drift can never persist.
		`UPDATE public.users u SET followers_count = (SELECT COUNT(*) FROM public.follows f WHERE f.following_id = u.id)`,
		`UPDATE public.users u SET following_count = (SELECT COUNT(*) FROM public.follows f WHERE f.follower_id = u.id)`,
		`UPDATE public.users u SET tweets_count = (SELECT COUNT(*) FROM public.tweets t WHERE t.user_id = u.id AND t.repost_of_id IS NULL)`,
		`UPDATE public.tweets t SET like_count = (SELECT COUNT(*) FROM public.likes l WHERE l.tweet_id = t.id)`,
		`UPDATE public.tweets t SET retweet_count = (SELECT COUNT(*) FROM public.retweets r WHERE r.tweet_id = t.id)`,
		`UPDATE public.tweets t SET reply_count = (SELECT COUNT(*) FROM public.tweets c WHERE c.parent_id = t.id)`,
		`UPDATE public.tweets t SET bookmark_count = (SELECT COUNT(*) FROM public.bookmarks b WHERE b.tweet_id = t.id)`,
	}
	for i, s := range stmts {
		if _, err := pool.Exec(ctx, s); err != nil {
			return fmt.Errorf("schema stmt %d failed: %w", i, err)
		}
	}
	// Best-effort trigram support (may lack privileges on managed DBs).
	if _, err := pool.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS pg_trgm`); err != nil {
		log.Printf("schema notice: pg_trgm unavailable: %v", err)
	} else if _, err := pool.Exec(ctx, `CREATE INDEX IF NOT EXISTS idx_tweets_content_trgm ON public.tweets USING GIN (content gin_trgm_ops)`); err != nil {
		log.Printf("schema notice: trgm index unavailable: %v", err)
	}
	// Best-effort Google avatar backfill from auth.users for rows whose
	// avatar_url is still empty (requires access to the auth schema).
	if res, err := pool.Exec(ctx, `
		UPDATE public.users u
		SET avatar_url = REPLACE(COALESCE(au.raw_user_meta_data->>'avatar_url', au.raw_user_meta_data->>'picture', ''), '=s96-c', '=s400-c')
		FROM auth.users au
		WHERE u.auth_id = au.id
		  AND (u.avatar_url = '' OR u.avatar_url IS NULL)
		  AND COALESCE(au.raw_user_meta_data->>'avatar_url', au.raw_user_meta_data->>'picture', '') <> ''`); err != nil {
		log.Printf("schema notice: avatar backfill unavailable: %v", err)
	} else if res.RowsAffected() > 0 {
		log.Printf("schema: backfilled %d avatar(s) from auth.users", res.RowsAffected())
	}
	return nil
}
