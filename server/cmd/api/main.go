package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"twitter-server/internal/config"
	"twitter-server/internal/db"
	"twitter-server/internal/handlers"
	"twitter-server/internal/middleware"
	sf "twitter-server/internal/snowflake"
	vstore "twitter-server/internal/valkey"
	"twitter-server/internal/ws"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	_ = godotenv.Load(".env")

	cfg := config.Load()
	if err := sf.Init(); err != nil {
		log.Fatalf("snowflake init: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db pool: %v", err)
	}
	defer pool.Close()
	if err := db.EnsureSchema(ctx, pool); err != nil {
		log.Fatalf("ensure schema: %v", err)
	}

	valkeyTarget := cfg.ValkeyURL
	if valkeyTarget == "" {
		valkeyTarget = cfg.ValkeyAddr
	}
	vc, err := vstore.NewClient(valkeyTarget)
	if err != nil {
		log.Printf("valkey unavailable (%v); continuing without cache", err)
		vc = nil
	} else if err := vc.Do(ctx, vc.B().Ping().Build()).Error(); err != nil {
		log.Printf("valkey ping failed (%v); continuing without cache", err)
		vc.Close()
		vc = nil
	}
	if vc != nil {
		defer vc.Close()
	}

	h := &handlers.Handler{Cfg: cfg, Pool: pool, VC: vc}
	hub := ws.NewHub(pool, vc, cfg)
	h.Hub = hub
	go hub.StartBridge(context.Background())

	// Auto-seed on boot so timeline, trends, and suggestions are never empty.
	if seeded, serr := h.SeedIfEmpty(context.Background()); serr != nil {
		log.Printf("boot seed failed: %v", serr)
	} else if seeded {
		log.Printf("boot seed: demo accounts and tweets created")
	}

	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(logger.New(logger.Config{Format: "${method} ${path} ${status} ${latency}\n"}))
	// Log every 4xx/5xx with method+path+status so client failures are traceable.
	app.Use(func(c *fiber.Ctx) error {
		err := c.Next()
		if code := c.Response().StatusCode(); code >= 400 {
			log.Printf("http %d %s %s", code, c.Method(), c.OriginalURL())
		}
		return err
	})
	origins := "http://localhost:5173,http://localhost:3000"
	if cfg.FrontendURL != "" {
		origins += "," + cfg.FrontendURL
	}
	app.Use(cors.New(cors.Config{
		AllowOrigins: origins,
		AllowOriginsFunc: func(origin string) bool {
			// Preview + production deployments on *.vercel.app.
			return strings.HasPrefix(origin, "https://") && strings.HasSuffix(origin, ".vercel.app")
		},
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowMethods:     "GET,POST,PATCH,PUT,DELETE,OPTIONS",
		AllowCredentials: false,
	}))

	// Production keep-alive health router (Render + UptimeRobot). Registered
	// before any auth middleware. Hits only touch memory; DB/Valkey are
	// pinged at most every 10 minutes so 5-minute monitor pings don't spam.
	var valkeyPing func(context.Context) error
	if vc != nil {
		valkeyPing = func(ctx context.Context) error {
			return vc.Do(ctx, vc.B().Ping().Build()).Error()
		}
	}
	registerHealthz(app, pool.Ping, valkeyPing)
	// Self-ping keeps free Render instances from spinning down after 15m idle.
	startSelfPing(strings.TrimRight(os.Getenv("RENDER_EXTERNAL_URL"), "/"), os.Getenv("SELF_PING_URL"))

	v1 := app.Group("/api/v1")
	auth := middleware.Authenticate(cfg, pool, vc)

	v1.Post("/auth/sync", auth, h.Sync)
	v1.Get("/auth/me", auth, middleware.RequireUser(), h.Me)
	v1.Get("/users/check-username", auth, h.CheckUsername)
	v1.Patch("/users/me/onboarding", auth, middleware.RequireUser(), h.CompleteOnboarding)
	v1.Post("/seed", h.Seed)

	tweets := v1.Group("/tweets", auth, middleware.RequireUser())
	tweets.Post("/", h.CreateTweet)
	tweets.Get("/feed", h.Feed)
	tweets.Get("/:id", h.Thread)
	tweets.Delete("/:id", h.DeleteTweet)
	tweets.Post("/:id/like", h.LikeTweet)
	tweets.Delete("/:id/like", h.UnlikeTweet)
	tweets.Post("/:id/retweet", h.Retweet)
	tweets.Delete("/:id/retweet", h.Unretweet)
	tweets.Post("/:id/bookmark", h.Bookmark)
	tweets.Delete("/:id/bookmark", h.Unbookmark)
	tweets.Post("/:id/poll/vote", h.VotePoll)
	tweets.Post("/:id/pin", h.TogglePin)
	tweets.Post("/views", h.ReportViews)

	v1.Get("/trends", auth, middleware.RequireUser(), h.Trends)
	v1.Get("/users/who-to-follow", auth, middleware.RequireUser(), h.WhoToFollow)
	// Static by-username route must precede :id routes.
	v1.Get("/users/by-username/:username", auth, middleware.RequireUser(), h.ByUsername)
	v1.Patch("/users/me", auth, middleware.RequireUser(), h.UpdateMe)
	v1.Delete("/users/me", auth, middleware.RequireUser(), h.DeleteMe)
	v1.Get("/users/:id/tweets", auth, middleware.RequireUser(), h.UserTweets)
	v1.Get("/users/:id/followers", auth, middleware.RequireUser(), h.Followers)
	v1.Get("/users/:id/following", auth, middleware.RequireUser(), h.Following)
	v1.Post("/users/:id/follow", auth, middleware.RequireUser(), h.ToggleFollow)

	v1.Get("/bookmarks", auth, middleware.RequireUser(), h.Bookmarks)
	v1.Delete("/bookmarks", auth, middleware.RequireUser(), h.ClearBookmarks)

	v1.Get("/search/typeahead", auth, middleware.RequireUser(), h.Typeahead)
	v1.Get("/search", auth, middleware.RequireUser(), h.Search)

	v1.Get("/notifications", auth, middleware.RequireUser(), h.Notifications)
	v1.Get("/notifications/unread-count", auth, middleware.RequireUser(), h.UnreadCount)
	v1.Post("/notifications/mark-read", auth, middleware.RequireUser(), h.MarkRead)

	msgs := v1.Group("/messages", auth, middleware.RequireUser())
	msgs.Get("/conversations", h.Conversations)
	msgs.Get("/conversations/:userId", h.MessageThread)
	msgs.Post("/conversations/:userId", h.SendMessage)
	msgs.Post("/conversations/:userId/typing", h.Typing)
	msgs.Post("/:messageId/react", h.ReactMessage)
	msgs.Delete("/:messageId", h.DeleteMessage)

	app.Get("/ws", hub.Handler())

	port := cfg.Port
	if port == "" {
		port = "8080"
	}
	// Explicit 0.0.0.0 so PaaS hosts (Render/Koyeb) route $PORT to us.
	addr := "0.0.0.0:" + port
	log.Printf("api listening on %s", addr)
	if err := app.Listen(addr); err != nil {
		log.Fatal(err)
	}
}

var (
	bootTime      = time.Now()
	lastWarmCheck atomic.Int64 // unix seconds of last DB/Valkey warm ping
)

// registerHealthz serves GET+HEAD on /healthz, /health and /api/v1/health.
// Every hit is memory-only; a background DB pool.Ping + Valkey PING (2s
// timeout) fires at most every 10 minutes to keep cloud connections warm.
func registerHealthz(app *fiber.App, poolPing, valkeyPing func(context.Context) error) {
	handler := func(c *fiber.Ctx) error {
		now := time.Now()
		if last := lastWarmCheck.Load(); now.Unix()-last >= 600 &&
			lastWarmCheck.CompareAndSwap(last, now.Unix()) {
			go func() {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				if poolPing != nil {
					if err := poolPing(ctx); err != nil {
						log.Printf("keep-alive db ping failed: %v", err)
					}
				}
				if valkeyPing != nil {
					if err := valkeyPing(ctx); err != nil {
						log.Printf("keep-alive valkey ping failed: %v", err)
					}
				}
			}()
		}
		c.Set("Cache-Control", "no-store, no-cache, must-revalidate")
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"status":         "ok",
			"uptime_seconds": int64(now.Sub(bootTime).Seconds()),
		})
	}
	for _, p := range []string{"/healthz", "/health", "/api/v1/health"} {
		app.Get(p, handler)
		app.Head(p, handler)
	}
}

// startSelfPing GETs target+"/healthz" every 12 minutes so free Render
// instances never hit the 15-minute idle spin-down. No-op when no URL set.
func startSelfPing(renderURL, selfURL string) {
	target := renderURL
	if target == "" {
		target = strings.TrimRight(selfURL, "/")
	}
	if target == "" {
		return
	}
	target += "/healthz"
	go func() {
		client := &http.Client{Timeout: 10 * time.Second}
		ticker := time.NewTicker(12 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			resp, err := client.Get(target)
			if err != nil {
				log.Printf("self-ping failed: %v", err)
				continue
			}
			resp.Body.Close()
		}
	}()
	log.Printf("self-ping enabled: %s every 12m", target)
}
