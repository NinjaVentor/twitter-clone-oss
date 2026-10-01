package handlers

import (
	"context"
	"encoding/json"
	"time"

	"twitter-server/internal/models"
	sf "twitter-server/internal/snowflake"
	vstore "twitter-server/internal/valkey"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type seedUser struct {
	Email       string
	Username    string
	DisplayName string
	AvatarURL   string
	Bio         string
}

var seedAccounts = []seedUser{
	{Email: "sundar@google.com", Username: "sundarpichai", DisplayName: "Sundar Pichai", AvatarURL: "https://i.pravatar.cc/400?img=11", Bio: "CEO of Google and Alphabet. Building helpful AI for everyone. 🚀"},
	{Email: "satya@microsoft.com", Username: "satyanadella", DisplayName: "Satya Nadella", AvatarURL: "https://i.pravatar.cc/400?img=12", Bio: "Chairman and CEO of Microsoft. Hit refresh. ☁️"},
	{Email: "elon@tesla.com", Username: "elonmusk", DisplayName: "Elon Musk", AvatarURL: "https://i.pravatar.cc/400?img=13", Bio: "Technoking. Mars, memes & machines. 🛸"},
	{Email: "jensen@nvidia.com", Username: "jensenhuang", DisplayName: "Jensen Huang", AvatarURL: "https://i.pravatar.cc/400?img=14", Bio: "Founder & CEO of NVIDIA. Accelerated computing. 🖥️"},
	{Email: "sam@openai.com", Username: "sama", DisplayName: "Sam Altman", AvatarURL: "https://i.pravatar.cc/400?img=15", Bio: "CEO of OpenAI. AGI for everyone. ✨"},
	{Email: "linus@kernel.org", Username: "linustorvalds", DisplayName: "Linus Torvalds", AvatarURL: "https://i.pravatar.cc/400?img=16", Bio: "Creator of Linux & Git. Talk is cheap, show me the code. 🐧"},
}

var seedTweets = []struct {
	By      string
	Content string
	Media   []string
	Poll    []string
}{
	{"sundarpichai", "Gemini just keeps getting better. Proud of the team shipping multimodal reasoning at scale. What are you building with it? #AI #Gemini 🚀", nil, nil},
	{"satyanadella", "Copilot + Windows + Azure: the AI PC era is here. Developers, the platform is yours. ☁️ #Build2026", []string{"https://picsum.photos/seed/copilot/600/400"}, nil},
	{"elonmusk", "Starship flight 9 was incredible. Next stop: Mars. 🛸 #SpaceX", []string{"https://picsum.photos/seed/starship/600/400"}, nil},
	{"jensenhuang", "The next industrial revolution is here — AI factories. Every company will have two factories: one for products, one for intelligence. 🖥️ #GTC", nil, []string{"Bullish", "Bearish", "Already building"}},
	{"sama", "Shipping is a feature. Iterate fast, listen faster. ✨ What should we build next? #OpenAI", nil, nil},
	{"linustorvalds", "Linux 6.14 is out. Nothing too scary this time, which honestly makes me suspicious. Go test it. 🐧 #Linux", nil, nil},
	{"sundarpichai", "Search is being reimagined with generative AI. The future of information access is conversational. 🔍", nil, nil},
	{"elonmusk", "Twitter video calls are getting a huge upgrade next week. 📹", []string{"https://picsum.photos/seed/videocall/600/400"}, nil},
	{"satyanadella", "50 years of Microsoft, and we're just getting started. Thank you to everyone building with us. 🙏", nil, nil},
	{"jensenhuang", "CUDA turns 18 this year. Thank you to the 5M+ developers in the ecosystem. 🙌 #CUDA", nil, []string{"CUDA forever", "Time to learn", "What's CUDA?"}},
	{"sama", "AGI will not arrive with a single announcement. It will diffuse into the world gradually. 🌊", nil, nil},
	{"linustorvalds", "PSA: if your patch subject line says 'fix bug', I will quietly judge you. Describe WHAT changed. 😤", nil, nil},
	{"sundarpichai", "Quantum computing + AI is the most exciting frontier I've seen in my career. Willow is just the beginning. ⚛️", []string{"https://picsum.photos/seed/quantum/600/400"}, nil},
	{"elonmusk", "Grokk is learning fast. Unfiltered, maximally curious. 🤖 #Grok", nil, nil},
	{"satyanadella", "Security is job zero. Proud of our teams raising the bar with Secure Future Initiative. 🔒", nil, nil},
}

var seedTrends = map[string]float64{
	"#ai": 98500, "#build2026": 45200, "#spacex": 78300, "#gtc": 32100,
	"#openai": 65400, "#linux": 28900, "#gemini": 52100, "#grok": 41700,
	"#quantum": 19800, "#mars": 61200,
}

// Seed implements POST /api/v1/seed. Idempotent: skips tweet/user creation
// when public.tweets already has >= 5 rows (trends ZSET is still refreshed).
func (h *Handler) Seed(c *fiber.Ctx) error {
	seeded, users, tweets, err := h.ensureSeeded(c.Context())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "seed failed"})
	}
	if !seeded {
		return c.JSON(fiber.Map{"seeded": false, "reason": "already seeded"})
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"seeded": true, "users": users, "tweets": tweets})
}

// SeedIfEmpty is the exported boot-time entry point: it seeds the database
// when public.tweets is empty. Safe to call on every startup (idempotent).
func (h *Handler) SeedIfEmpty(ctx context.Context) (bool, error) {
	var count int
	if err := h.Pool.QueryRow(ctx, `SELECT count(*) FROM public.tweets`).Scan(&count); err != nil {
		return false, err
	}
	if count > 0 {
		return false, nil
	}
	seeded, _, _, err := h.ensureSeeded(ctx)
	return seeded, err
}

// ensureSeeded runs the idempotent seed and reports (seeded, users, tweets).
// It is also called automatically by the feed endpoint on an empty database.
func (h *Handler) ensureSeeded(ctx context.Context) (bool, int, int, error) {
	var count int
	if err := h.Pool.QueryRow(ctx, `SELECT count(*) FROM public.tweets`).Scan(&count); err != nil {
		return false, 0, 0, err
	}
	// Always refresh trends so Explore never renders mock/empty state.
	_ = vstore.ZAdd(ctx, h.VC, "trends:24h", seedTrends)
	if count >= 5 {
		return false, 0, count, nil
	}
	ids, err := h.ensureSeedUsers(ctx, h.Pool)
	if err != nil {
		return false, 0, 0, err
	}
	// Backfill avatars/bios on pre-existing seed rows.
	for _, s := range seedAccounts {
		_, _ = h.Pool.Exec(ctx,
			`UPDATE public.users SET avatar_url=CASE WHEN avatar_url='' THEN $1 ELSE avatar_url END,
			 bio=CASE WHEN bio='' THEN $2 ELSE bio END, is_verified=TRUE
			 WHERE lower(username)=lower($3)`, s.AvatarURL, s.Bio, s.Username)
	}
	tweetIDs, err := h.insertSeedTweets(ctx, h.Pool, ids)
	if err != nil {
		return false, 0, 0, err
	}
	h.insertSeedFollows(ctx, h.Pool, ids)
	h.refreshUserCounters(ctx, h.Pool)
	return true, len(ids), len(tweetIDs), nil
}

// refreshUserCounters recomputes denormalized counters from relational rows.
func (h *Handler) refreshUserCounters(ctx context.Context, pool *pgxpool.Pool) {
	_, _ = pool.Exec(ctx,
		`UPDATE public.users u SET tweets_count = COALESCE((SELECT count(*) FROM public.tweets t WHERE t.user_id = u.id AND t.repost_of_id IS NULL), 0)`)
	_, _ = pool.Exec(ctx,
		`UPDATE public.users u SET followers_count = COALESCE((SELECT count(*) FROM public.follows f WHERE f.following_id = u.id), 0)`)
	_, _ = pool.Exec(ctx,
		`UPDATE public.users u SET following_count = COALESCE((SELECT count(*) FROM public.follows f WHERE f.follower_id = u.id), 0)`)
}

func (h *Handler) ensureSeedUsers(ctx context.Context, pool *pgxpool.Pool) (map[string]int64, error) {
	ids := make(map[string]int64, len(seedAccounts))
	for _, s := range seedAccounts {
		var id int64
		err := pool.QueryRow(ctx, `SELECT id FROM public.users WHERE lower(username)=lower($1)`, s.Username).Scan(&id)
		if err == nil {
			ids[s.Username] = id
			continue
		}
		id = sf.Generate()
		_, ierr := pool.Exec(ctx,
			`INSERT INTO public.users (id, auth_id, email, username, display_name, avatar_url, bio, is_verified, onboarded)
			 VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,TRUE,TRUE)
			 ON CONFLICT (username) DO NOTHING`,
			id, uuid.NewString(), s.Email, s.Username, s.DisplayName, s.AvatarURL, s.Bio)
		if ierr != nil {
			return nil, ierr
		}
		// Re-read (handles race / conflict path).
		if rerr := pool.QueryRow(ctx, `SELECT id FROM public.users WHERE lower(username)=lower($1)`, s.Username).Scan(&id); rerr != nil {
			return nil, rerr
		}
		ids[s.Username] = id
	}
	return ids, nil
}

func (h *Handler) insertSeedTweets(ctx context.Context, pool *pgxpool.Pool, ids map[string]int64) ([]int64, error) {
	var out []int64
	var prevID *int64
	for i, t := range seedTweets {
		uid, ok := ids[t.By]
		if !ok {
			continue
		}
		id := sf.Generate()
		var replyTo *int64
		// Thread every 3rd tweet as a reply to the previous one.
		if i%3 == 2 && prevID != nil {
			replyTo = prevID
		}
		var pollJSON *string
		if len(t.Poll) >= 2 {
			opts := make([]models.PollOption, 0, len(t.Poll))
			for _, o := range t.Poll {
				opts = append(opts, models.PollOption{Text: o})
			}
			ends := time.Now().Add(7 * 24 * time.Hour)
			raw, _ := json.Marshal(models.PollData{Options: opts, DurationMinutes: 10080, EndsAt: &ends})
			s := string(raw)
			pollJSON = &s
		}
		media := t.Media
		if media == nil {
			media = []string{}
		}
		if _, err := pool.Exec(ctx,
			`INSERT INTO public.tweets (id, user_id, content, parent_id, media_urls, poll_data) VALUES ($1,$2,$3,$4,$5::jsonb,CASE WHEN $6::text IS NULL THEN NULL ELSE $6::jsonb END) ON CONFLICT (id) DO NOTHING`,
			id, uid, t.Content, replyTo, mediaJSON(media), pollJSONString(pollJSON)); err != nil {
			return nil, err
		}
		for _, tag := range extractHashtags(t.Content) {
			_, _ = pool.Exec(ctx,
			`INSERT INTO public.hashtags (tag, tweet_count) VALUES ($1, 1)
			 ON CONFLICT (tag) DO UPDATE SET tweet_count = public.hashtags.tweet_count + 1`, tag)
			_, _ = pool.Exec(ctx,
				`INSERT INTO public.tweet_hashtags (tweet_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`, id, tag)
		}
		out = append(out, id)
		cp := id
		prevID = &cp
	}
	return out, nil
}

func (h *Handler) insertSeedFollows(ctx context.Context, pool *pgxpool.Pool, ids map[string]int64) {
	pairs := [][2]string{
		{"sama", "elonmusk"}, {"sama", "sundarpichai"}, {"elonmusk", "sama"},
		{"sundarpichai", "satyanadella"}, {"satyanadella", "sundarpichai"},
		{"jensenhuang", "sama"}, {"sama", "jensenhuang"}, {"linustorvalds", "sama"},
		{"elonmusk", "jensenhuang"}, {"satyanadella", "jensenhuang"},
	}
	for _, p := range pairs {
		a, ok1 := ids[p[0]]
		b, ok2 := ids[p[1]]
		if !ok1 || !ok2 || a == b {
			continue
		}
		_, _ = pool.Exec(ctx,
			`INSERT INTO public.follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, a, b)
	}
}
