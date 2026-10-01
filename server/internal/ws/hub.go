package ws

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"twitter-server/internal/config"
	"twitter-server/internal/middleware"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/valkey-io/valkey-go"
)

// FeedChannel is the global Pub/Sub channel for tweet events.
const FeedChannel = "channel:feed"

// UserChannel returns the per-user Pub/Sub channel for notifications + DMs.
func UserChannel(userID int64) string {
	return "channel:user:" + strconv.FormatInt(userID, 10)
}

// client wraps one WS connection with its own write mutex because
// fasthttp websocket writes are not safe for concurrent use.
type client struct {
	conn   *websocket.Conn
	mu     sync.Mutex
	userID int64
}

// Hub keeps per-user connections plus global feed listeners, and bridges
// Valkey Pub/Sub (channel:feed, channel:user:*) onto them. Every event is
// delivered directly through in-memory fan-out first (never Valkey-only),
// then also published to Valkey for cross-instance fan-out. An event-ID
// dedup set keeps the bridge echo from double-delivering locally.
type Hub struct {
	mu      sync.RWMutex
	byUser  map[int64]map[*client]bool
	byConn  map[*websocket.Conn]*client
	pool    *pgxpool.Pool
	vc      valkey.Client
	cfg     config.Config
	bridged bool
	dedupMu sync.Mutex
	seen    map[string]time.Time
	eidCtr  atomic.Uint64
}

func NewHub(pool *pgxpool.Pool, vc valkey.Client, cfg config.Config) *Hub {
	return &Hub{
		byUser: make(map[int64]map[*client]bool),
		byConn: make(map[*websocket.Conn]*client),
		pool:   pool,
		vc:     vc,
		cfg:    cfg,
		seen:   make(map[string]time.Time),
	}
}

// BroadcastToAll delivers msg to every connected client (global listeners).
func (h *Hub) BroadcastToAll(msg []byte) {
	h.BroadcastFeed(msg)
}

// BroadcastToUser delivers msg to every connection owned by userID.
func (h *Hub) BroadcastToUser(userID int64, msg []byte) {
	h.SendToUser(userID, msg)
}

// Handler upgrades /ws connections authenticated via ?token=<access_token>.
func (h *Hub) Handler() fiber.Handler {
	return websocket.New(func(conn *websocket.Conn) {
		token := conn.Query("token")
		if token == "" {
			_ = conn.WriteMessage(websocket.TextMessage, mustJSON(fiber.Map{"type": "error", "error": "missing token"}))
			_ = conn.Close()
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		user, _, err := middleware.VerifyTokenAndUser(ctx, h.cfg, h.pool, h.vc, token)
		cancel()
		if err != nil || user == nil {
			_ = conn.WriteMessage(websocket.TextMessage, mustJSON(fiber.Map{"type": "error", "error": "unauthorized"}))
			_ = conn.Close()
			return
		}
		c := &client{conn: conn, userID: user.ID}
		h.add(c)
		defer h.remove(conn)

		_ = h.sendTo(c, mustJSON(fiber.Map{"type": "connected", "user_id": strconv.FormatInt(user.ID, 10)}))

		for {
			mt, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if mt != websocket.TextMessage {
				continue
			}
			var incoming struct {
				Type string `json:"type"`
			}
			if jerr := json.Unmarshal(msg, &incoming); jerr != nil {
				continue
			}
			// Heartbeat: client pings every ~25s, we pong.
			if incoming.Type == "ping" {
				_ = h.sendTo(c, mustJSON(fiber.Map{"type": "pong"}))
			}
		}
	})
}

func (h *Hub) add(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.byConn[c.conn] = c
	if h.byUser[c.userID] == nil {
		h.byUser[c.userID] = make(map[*client]bool)
	}
	h.byUser[c.userID][c] = true
}

func (h *Hub) remove(conn *websocket.Conn) {
	h.mu.Lock()
	c, ok := h.byConn[conn]
	if ok {
		delete(h.byConn, conn)
		if set := h.byUser[c.userID]; set != nil {
			delete(set, c)
			if len(set) == 0 {
				delete(h.byUser, c.userID)
			}
		}
	}
	h.mu.Unlock()
	_ = conn.Close()
}

func (h *Hub) sendTo(c *client, msg []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return c.conn.WriteMessage(websocket.TextMessage, msg)
}

// SendToUser delivers msg to every connection owned by userID.
func (h *Hub) SendToUser(userID int64, msg []byte) {
	h.mu.RLock()
	set := h.byUser[userID]
	clients := make([]*client, 0, len(set))
	for c := range set {
		clients = append(clients, c)
	}
	h.mu.RUnlock()
	for _, c := range clients {
		_ = h.sendTo(c, msg)
	}
}

// BroadcastFeed delivers msg to every connected (global feed listener) client.
func (h *Hub) BroadcastFeed(msg []byte) {
	h.mu.RLock()
	clients := make([]*client, 0, len(h.byConn))
	for _, c := range h.byConn {
		clients = append(clients, c)
	}
	h.mu.RUnlock()
	for _, c := range clients {
		_ = h.sendTo(c, msg)
	}
}

// RouteMessage fans a Pub/Sub payload out to local connections. Both the
// direct in-memory path and the Valkey bridge call it; the event-ID dedup
// set guarantees each event is delivered exactly once per process.
func (h *Hub) RouteMessage(channel, payload string) {
	if h == nil {
		return
	}
	var envelope struct {
		EID string `json:"eid"`
	}
	if json.Unmarshal([]byte(payload), &envelope) == nil && envelope.EID != "" {
		now := time.Now()
		h.dedupMu.Lock()
		if _, dup := h.seen[envelope.EID]; dup {
			h.dedupMu.Unlock()
			return
		}
		h.seen[envelope.EID] = now
		// Prune stale entries so the set stays tiny.
		for id, at := range h.seen {
			if now.Sub(at) > time.Minute {
				delete(h.seen, id)
			}
		}
		if len(h.seen) > 10000 {
			h.seen = make(map[string]time.Time)
		}
		h.dedupMu.Unlock()
	}
	msg := []byte(payload)
	if channel == FeedChannel {
		h.BroadcastFeed(msg)
		return
	}
	if strings.HasPrefix(channel, "channel:user:") {
		if id, err := strconv.ParseInt(strings.TrimPrefix(channel, "channel:user:"), 10, 64); err == nil {
			h.SendToUser(id, msg)
		}
	}
}

// StartBridge subscribes to channel:feed and channel:user:* and routes every
// message to local connections. It reconnects with backoff until ctx ends.
func (h *Hub) StartBridge(ctx context.Context) {
	if h.vc == nil {
		return
	}
	h.mu.Lock()
	if h.bridged {
		h.mu.Unlock()
		return
	}
	h.bridged = true
	h.mu.Unlock()

	go h.bridgeLoop(ctx, "feed", func() error {
		return h.vc.Receive(ctx, h.vc.B().Subscribe().Channel(FeedChannel).Build(), func(m valkey.PubSubMessage) {
			h.RouteMessage(m.Channel, m.Message)
		})
	})
	go h.bridgeLoop(ctx, "user", func() error {
		return h.vc.Receive(ctx, h.vc.B().Psubscribe().Pattern("channel:user:*").Build(), func(m valkey.PubSubMessage) {
			h.RouteMessage(m.Channel, m.Message)
		})
	})
}

func (h *Hub) bridgeLoop(ctx context.Context, name string, run func() error) {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		if err := run(); err != nil {
			if ctx.Err() != nil {
				return
			}
			time.Sleep(backoff)
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
			continue
		}
		backoff = time.Second
	}
}

// PublishEvent delivers payload directly through in-memory fan-out first
// (never Valkey-only), then also publishes to Valkey for cross-instance
// fan-out. Safe to call on a nil Hub (no-op).
func (h *Hub) PublishEvent(ctx context.Context, channel, payload string) {
	if h == nil {
		return
	}
	h.RouteMessage(channel, payload)
	if h.vc == nil {
		return
	}
	_ = h.vc.Do(ctx, h.vc.B().Arbitrary("PUBLISH").Keys(channel).Args(payload).Build()).Error()
}

func mustJSON(v any) []byte {
	raw, err := json.Marshal(v)
	if err != nil {
		return []byte(`{"type":"error"}`)
	}
	return raw
}

// PublishTyped is a small helper for handlers to emit typed WS events.
func PublishTyped(h *Hub, ctx context.Context, channel, typ string, body map[string]any) {
	body["type"] = typ
	if h != nil {
		body["eid"] = strconv.FormatInt(time.Now().UnixNano(), 10) + "-" + strconv.FormatUint(h.eidCtr.Add(1), 10)
	}
	h.PublishEvent(ctx, channel, string(mustJSON(body)))
}
