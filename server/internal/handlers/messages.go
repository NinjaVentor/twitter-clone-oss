package handlers

import (
	"strconv"
	"strings"

	"twitter-server/internal/middleware"
	"twitter-server/internal/models"
	sf "twitter-server/internal/snowflake"
	"twitter-server/internal/storage"
	"twitter-server/internal/ws"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
)

const messageColumns = `id, sender_id, recipient_id, content, media_url, reaction, is_read, created_at`

func scanMessages(rows pgx.Rows) ([]models.Message, error) {
	defer rows.Close()
	out := make([]models.Message, 0)
	for rows.Next() {
		var m models.Message
		if err := rows.Scan(&m.ID, &m.SenderID, &m.RecipientID, &m.Content, &m.MediaURL, &m.Reaction, &m.Read, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Conversations implements GET /api/v1/messages/conversations.
func (h *Handler) Conversations(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	ctx := c.Context()
	rows, err := h.Pool.Query(ctx,
		`SELECT `+messageColumns+` FROM public.messages m
		 JOIN (
			SELECT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS partner,
			       MAX(id) AS max_id
			FROM public.messages
			WHERE sender_id = $1 OR recipient_id = $1
			GROUP BY 1
		 ) t ON m.id = t.max_id
		 ORDER BY m.id DESC`, me.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "conversations failed"})
	}
	msgs, qerr := scanMessages(rows)
	if qerr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "conversations failed"})
	}
	partnerIDs := make([]int64, 0, len(msgs))
	for _, m := range msgs {
		partnerIDs = append(partnerIDs, partnerOf(m, me.ID))
	}
	partners := usersByIDs(ctx, h.Pool, partnerIDs)
	unread := map[int64]int{}
	if len(partnerIDs) > 0 {
		urows, uerr := h.Pool.Query(ctx,
			`SELECT sender_id, count(*) FROM public.messages
			 WHERE recipient_id = $1 AND is_read = FALSE GROUP BY sender_id`, me.ID)
		if uerr == nil {
			defer urows.Close()
			for urows.Next() {
				var sid int64
				var n int
				if serr := urows.Scan(&sid, &n); serr == nil {
					unread[sid] = n
				}
			}
		}
	}
	out := make([]models.Conversation, 0, len(msgs))
	for _, m := range msgs {
		cp := m
		pid := partnerOf(m, me.ID)
		if pid == me.ID {
			continue // never surface self-conversations
		}
		out = append(out, models.Conversation{
			Partner:     partners[pid],
			LastMessage: &cp,
			UnreadCount: unread[pid],
		})
	}
	return c.JSON(fiber.Map{"conversations": out})
}

func partnerOf(m models.Message, meID int64) int64 {
	if m.SenderID == meID {
		return m.RecipientID
	}
	return m.SenderID
}

// Thread implements GET /api/v1/messages/conversations/:userId.
func (h *Handler) MessageThread(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	partnerID, err := strconv.ParseInt(c.Params("userId"), 10, 64)
	if err != nil || partnerID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid user id"})
	}
	if partnerID == me.ID {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot message yourself"})
	}
	ctx := c.Context()
	rows, err := h.Pool.Query(ctx,
		`SELECT `+messageColumns+` FROM public.messages
		 WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)
		 ORDER BY id ASC LIMIT 200`, me.ID, partnerID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "messages failed"})
	}
	msgs, qerr := scanMessages(rows)
	if qerr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "messages failed"})
	}
	// Mark incoming unread messages as read + broadcast DM_READ.
	if res, rerr := h.Pool.Exec(ctx,
		`UPDATE public.messages SET is_read = TRUE
		 WHERE sender_id = $1 AND recipient_id = $2 AND is_read = FALSE`, partnerID, me.ID); rerr == nil && res.RowsAffected() > 0 {
		ws.PublishTyped(h.Hub, ctx, ws.UserChannel(partnerID), "DM_READ", map[string]any{
			"sender_id":    strconv.FormatInt(partnerID, 10),
			"recipient_id": strconv.FormatInt(me.ID, 10),
		})
		ws.PublishTyped(h.Hub, ctx, ws.UserChannel(me.ID), "DM_READ", map[string]any{
			"sender_id":    strconv.FormatInt(partnerID, 10),
			"recipient_id": strconv.FormatInt(me.ID, 10),
		})
	}
	return c.JSON(fiber.Map{"messages": msgs})
}

type sendMessageBody struct {
	Content  string `json:"content"`
	MediaURL string `json:"media_url"`
}

// SendMessage implements POST /api/v1/messages/conversations/:userId.
func (h *Handler) SendMessage(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	partnerID, err := strconv.ParseInt(c.Params("userId"), 10, 64)
	if err != nil || partnerID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid user id"})
	}
	if partnerID == me.ID {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot message yourself"})
	}
	var body sendMessageBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid JSON"})
	}
	content := strings.TrimSpace(body.Content)
	mediaURL := strings.TrimSpace(body.MediaURL)
	if content == "" && mediaURL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "message is empty"})
	}
	if len([]rune(content)) > 2000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "message too long"})
	}
	ctx := c.Context()
	var exists bool
	_ = h.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.users WHERE id=$1)`, partnerID).Scan(&exists)
	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "user not found"})
	}
	id := sf.Generate()
	var m models.Message
	if err := h.Pool.QueryRow(ctx,
		`INSERT INTO public.messages (id, sender_id, recipient_id, content, media_url)
		 VALUES ($1,$2,$3,$4,$5)
		 RETURNING `+messageColumns, id, me.ID, partnerID, content, mediaURL,
	).Scan(&m.ID, &m.SenderID, &m.RecipientID, &m.Content, &m.MediaURL, &m.Reaction, &m.Read, &m.CreatedAt); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "send failed"})
	}
	// Broadcast to recipient channel and sender channel (multi-tab sync).
	ws.PublishTyped(h.Hub, ctx, ws.UserChannel(partnerID), "DM_RECEIVED", map[string]any{"message": m})
	ws.PublishTyped(h.Hub, ctx, ws.UserChannel(me.ID), "DM_RECEIVED", map[string]any{"message": m})
	return c.Status(fiber.StatusCreated).JSON(m)
}

type reactBody struct {
	Reaction string `json:"reaction"`
}

// ReactMessage implements POST /api/v1/messages/:messageId/react.
func (h *Handler) ReactMessage(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	msgID, err := strconv.ParseInt(c.Params("messageId"), 10, 64)
	if err != nil || msgID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid message id"})
	}
	var body reactBody
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid JSON"})
	}
	reaction := strings.TrimSpace(body.Reaction)
	if len([]rune(reaction)) > 16 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "reaction too long"})
	}
	ctx := c.Context()
	var m models.Message
	if err := h.Pool.QueryRow(ctx,
		`SELECT `+messageColumns+` FROM public.messages WHERE id = $1`, msgID,
	).Scan(&m.ID, &m.SenderID, &m.RecipientID, &m.Content, &m.MediaURL, &m.Reaction, &m.Read, &m.CreatedAt); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "message not found"})
	}
	if m.SenderID != me.ID && m.RecipientID != me.ID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "not your conversation"})
	}
	// Toggle when re-sending the same reaction.
	if m.Reaction == reaction {
		reaction = ""
	}
	if _, err := h.Pool.Exec(ctx, `UPDATE public.messages SET reaction = $1 WHERE id = $2`, reaction, msgID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "react failed"})
	}
	m.Reaction = reaction
	other := partnerOf(m, me.ID)
	ws.PublishTyped(h.Hub, ctx, ws.UserChannel(other), "DM_REACTION", map[string]any{"message": m})
	ws.PublishTyped(h.Hub, ctx, ws.UserChannel(me.ID), "DM_REACTION", map[string]any{"message": m})
	return c.JSON(m)
}

// Typing implements POST /api/v1/messages/conversations/:userId/typing.
func (h *Handler) Typing(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	partnerID, err := strconv.ParseInt(c.Params("userId"), 10, 64)
	if err != nil || partnerID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid user id"})
	}
	if partnerID == me.ID {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot message yourself"})
	}
	ws.PublishTyped(h.Hub, c.Context(), ws.UserChannel(partnerID), "DM_TYPING", map[string]any{
		"sender_id":    strconv.FormatInt(me.ID, 10),
		"recipient_id": strconv.FormatInt(partnerID, 10),
	})
	return c.JSON(fiber.Map{"ok": true})
}

// DeleteMessage implements DELETE /api/v1/messages/:messageId. Only the
// sender may delete. Attached media is purged from Storage and DM_DELETED
// is broadcast to both participants so open threads update in realtime.
func (h *Handler) DeleteMessage(c *fiber.Ctx) error {
	me := middleware.UserFrom(c)
	if me == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "not synced"})
	}
	msgID, err := strconv.ParseInt(c.Params("messageId"), 10, 64)
	if err != nil || msgID <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid message id"})
	}
	ctx := c.Context()
	var m models.Message
	if err := h.Pool.QueryRow(ctx,
		`SELECT `+messageColumns+` FROM public.messages WHERE id = $1`, msgID,
	).Scan(&m.ID, &m.SenderID, &m.RecipientID, &m.Content, &m.MediaURL, &m.Reaction, &m.Read, &m.CreatedAt); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "message not found"})
	}
	if m.SenderID != me.ID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "only the sender can delete this message"})
	}
	if _, err := h.Pool.Exec(ctx, `DELETE FROM public.messages WHERE id = $1`, msgID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "delete failed"})
	}
	if paths := storage.ObjectPathsFromURLs(h.Cfg.SupabaseURL, []string{m.MediaURL}); len(paths) > 0 {
		_ = storage.DeleteObjects(ctx, h.Cfg.SupabaseURL, h.Cfg.SupabaseServiceRoleKey, middleware.BearerToken(c), paths)
	}
	payload := map[string]any{
		"message_id":   strconv.FormatInt(msgID, 10),
		"sender_id":    strconv.FormatInt(m.SenderID, 10),
		"recipient_id": strconv.FormatInt(m.RecipientID, 10),
	}
	ws.PublishTyped(h.Hub, ctx, ws.UserChannel(m.RecipientID), "DM_DELETED", payload)
	ws.PublishTyped(h.Hub, ctx, ws.UserChannel(m.SenderID), "DM_DELETED", payload)
	return c.JSON(fiber.Map{"deleted": true})
}
