package handlers

import (
	"context"
	"strconv"

	"twitter-server/internal/models"
	"twitter-server/internal/ws"
)

// notifyUser inserts a notification row and broadcasts the hydrated
// NOTIFICATION_CREATED event to the recipient's user channel.
func (h *Handler) notifyUser(ctx context.Context, recipientID, actorID int64, typ string, tweetID *int64) {
	id, err := insertNotification(ctx, h.Pool, recipientID, actorID, typ, tweetID)
	if err != nil {
		return
	}
	n, err := h.hydrateNotification(ctx, id, actorID)
	if err != nil {
		return
	}
	ws.PublishTyped(h.Hub, ctx, ws.UserChannel(recipientID), "NOTIFICATION_CREATED", map[string]any{
		"notification": n,
	})
}

// hydrateNotification loads one notification with actor + tweet embeds.
func (h *Handler) hydrateNotification(ctx context.Context, id, viewerID int64) (*models.Notification, error) {
	var n models.Notification
	err := h.Pool.QueryRow(ctx,
		`SELECT id, recipient_id, actor_id, type, tweet_id, is_read, created_at
		 FROM public.notifications WHERE id = $1`, id,
	).Scan(&n.ID, &n.UserID, &n.ActorID, &n.Type, &n.TweetID, &n.Read, &n.CreatedAt)
	if err != nil {
		return nil, err
	}
	users := usersByIDs(ctx, h.Pool, []int64{n.ActorID})
	if a, ok := users[n.ActorID]; ok {
		n.Actor = a
	}
	if n.TweetID != nil {
		if tw, terr := findTweetByID(ctx, h.Pool, *n.TweetID); terr == nil {
			if hydrated, herr := h.hydrateTweets(ctx, []models.Tweet{*tw}, viewerID); herr == nil && len(hydrated) == 1 {
				n.Tweet = &hydrated[0]
			}
		}
	}
	return &n, nil
}

// publishNewTweet broadcasts a hydrated NEW_TWEET for a top-level post/repost.
func (h *Handler) publishNewTweet(ctx context.Context, tw models.Tweet, viewerID int64) {
	hydrated, err := h.hydrateTweets(ctx, []models.Tweet{tw}, viewerID)
	if err != nil || len(hydrated) != 1 {
		return
	}
	ws.PublishTyped(h.Hub, ctx, ws.FeedChannel, "NEW_TWEET", map[string]any{
		"tweet_id": strconv.FormatInt(tw.ID, 10),
		"tweet":    hydrated[0],
	})
}
