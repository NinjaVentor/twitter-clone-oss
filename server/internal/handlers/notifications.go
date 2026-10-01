package handlers

import (
	"context"
	"strconv"

	"twitter-server/internal/middleware"
	"twitter-server/internal/models"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

// Notifications implements GET /api/v1/notifications?tab=all|verified|mentions.
func (h *Handler) Notifications(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	tab := c.Query("tab", "all")
	limit := c.QueryInt("limit", 20)
	if limit < 1 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	var cursor *int64
	if raw := c.Query("cursor", ""); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid cursor"})
		}
		cursor = &id
	}
	ctx := c.Context()

	filter := ""
	switch tab {
	case "verified":
		filter = `AND EXISTS(SELECT 1 FROM public.users a WHERE a.id = n.actor_id AND a.is_verified)`
	case "mentions":
		filter = `AND n.type IN ('MENTION','REPLY','QUOTE')`
	}

	rows, err := h.Pool.Query(ctx,
		`SELECT n.id, n.recipient_id, n.actor_id, n.type, n.tweet_id, n.is_read, n.created_at
		 FROM public.notifications n
		 WHERE n.recipient_id = $1 AND ($2::bigint IS NULL OR n.id < $2) `+filter+`
		 ORDER BY n.id DESC LIMIT $3`, me.ID, cursor, limit+1)
	if err != nil {
		return dberr(c, "notifications", err)
	}
	notifs, qerr := scanNotifications(rows)
	if qerr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "notifications failed"})
	}
	var nextCursor *string
	if len(notifs) > limit {
		notifs = notifs[:limit]
		s := strconv.FormatInt(notifs[len(notifs)-1].ID, 10)
		nextCursor = &s
	}
	h.hydrateNotificationList(ctx, notifs, me.ID)
	return c.JSON(fiber.Map{"notifications": notifs, "next_cursor": nextCursor})
}

func scanNotifications(rows pgx.Rows) ([]models.Notification, error) {
	defer rows.Close()
	out := make([]models.Notification, 0)
	for rows.Next() {
		var n models.Notification
		if err := rows.Scan(&n.ID, &n.UserID, &n.ActorID, &n.Type, &n.TweetID, &n.Read, &n.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// hydrateNotificationList attaches actor users and tweet embeds in bulk.
func (h *Handler) hydrateNotificationList(ctx context.Context, notifs []models.Notification, viewerID int64) {
	if len(notifs) == 0 {
		return
	}
	actorIDs := map[int64]bool{}
	tweetIDs := map[int64]bool{}
	for _, n := range notifs {
		actorIDs[n.ActorID] = true
		if n.TweetID != nil {
			tweetIDs[*n.TweetID] = true
		}
	}
	actors := usersByIDs(ctx, h.Pool, keys(actorIDs))
	tweets := map[int64]models.HydratedTweet{}
	if len(tweetIDs) > 0 {
		rows, err := h.Pool.Query(ctx, `SELECT `+tweetColumns+` FROM public.tweets WHERE id = ANY($1)`, keys(tweetIDs))
		if err == nil {
			if list, serr := scanTweets(rows); serr == nil {
				if hydrated, herr := h.hydrateTweets(ctx, list, viewerID); herr == nil {
					for _, ht := range hydrated {
						tweets[ht.ID] = ht
					}
				}
			}
		}
	}
	for i := range notifs {
		if a, ok := actors[notifs[i].ActorID]; ok {
			notifs[i].Actor = a
		}
		if notifs[i].TweetID != nil {
			if t, ok := tweets[*notifs[i].TweetID]; ok {
				cp := t
				notifs[i].Tweet = &cp
			}
		}
	}
}

// UnreadCount implements GET /api/v1/notifications/unread-count.
func (h *Handler) UnreadCount(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	ctx := c.Context()
	var unreadNotifs, unreadMsgs int
	_ = h.Pool.QueryRow(ctx, `SELECT count(*) FROM public.notifications WHERE recipient_id=$1 AND is_read=FALSE`, me.ID).Scan(&unreadNotifs)
	_ = h.Pool.QueryRow(ctx, `SELECT count(*) FROM public.messages WHERE recipient_id=$1 AND is_read=FALSE`, me.ID).Scan(&unreadMsgs)
	return c.JSON(fiber.Map{"unread_notifications": unreadNotifs, "unread_messages": unreadMsgs})
}

type markReadBody struct {
	IDs []flexID `json:"ids"`
}

// MarkRead implements POST /api/v1/notifications/mark-read.
func (h *Handler) MarkRead(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	var body markReadBody
	_ = c.BodyParser(&body)
	ctx := c.Context()
	if len(body.IDs) == 0 {
		_, err := h.Pool.Exec(ctx, `UPDATE public.notifications SET is_read=TRUE WHERE recipient_id=$1 AND is_read=FALSE`, me.ID)
		if err != nil {
			return dberr(c, "mark-read", err)
		}
		return c.JSON(fiber.Map{"marked": "all"})
	}
	ids := make([]int64, 0, len(body.IDs))
	for _, f := range body.IDs {
		if f.Value > 0 {
			ids = append(ids, f.Value)
		}
	}
	if len(ids) == 0 {
		return c.JSON(fiber.Map{"marked": 0})
	}
	_, err := h.Pool.Exec(ctx, `UPDATE public.notifications SET is_read=TRUE WHERE recipient_id=$1 AND id = ANY($2)`, me.ID, ids)
	if err != nil {
		return dberr(c, "mark-read", err)
	}
	return c.JSON(fiber.Map{"marked": len(ids)})
}
