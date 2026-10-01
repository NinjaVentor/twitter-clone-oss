package models

import "time"

// User maps public.users. All 64-bit IDs serialize as strings for the browser.
type User struct {
	ID             int64     `json:"id,string" db:"id"`
	AuthID         string    `json:"auth_id" db:"auth_id"`
	Email          string    `json:"email" db:"email"`
	Username       string    `json:"username" db:"username"`
	DisplayName    string    `json:"display_name" db:"display_name"`
	AvatarURL      string    `json:"avatar_url" db:"avatar_url"`
	Bio            string    `json:"bio" db:"bio"`
	Location       string    `json:"location" db:"location"`
	Website        string    `json:"website" db:"website"`
	BannerURL      string    `json:"banner_url" db:"banner_url"`
	PinnedTweetID  *int64    `json:"pinned_tweet_id,string,omitempty" db:"pinned_tweet_id"`
	Verified       bool      `json:"verified" db:"verified"`
	Onboarded      bool      `json:"onboarded" db:"onboarded"`
	TweetsCount    int       `json:"tweets_count" db:"tweets_count"`
	FollowersCount int       `json:"followers_count" db:"followers_count"`
	FollowingCount int       `json:"following_count" db:"following_count"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
	UpdatedAt      time.Time `json:"updated_at" db:"updated_at"`
}

// ProfileUser is a full public profile hydrated relative to the viewer.
type ProfileUser struct {
	User
	IsFollowing bool           `json:"is_following"`
	IsFollowedBy bool          `json:"is_followed_by"`
	PinnedTweet *HydratedTweet `json:"pinned_tweet,omitempty"`
}

// TypeaheadResult is one GET /api/v1/search/typeahead response.
type TypeaheadResult struct {
	Hashtags []Trend      `json:"hashtags"`
	Users    []FollowUser `json:"users"`
}

// PollOption is one choice inside PollData.
type PollOption struct {
	Text  string `json:"text"`
	Votes int    `json:"votes"`
}

// PollData is stored as JSONB on tweets.poll_data.
type PollData struct {
	Options         []PollOption `json:"options"`
	DurationMinutes int          `json:"duration_minutes,omitempty"`
	EndsAt          *time.Time   `json:"ends_at,omitempty"`
}

// Tweet maps public.tweets (full Milestone 2 columns).
type Tweet struct {
	ID            int64     `json:"id,string" db:"id"`
	UserID        int64     `json:"user_id,string" db:"user_id"`
	Content       string    `json:"content" db:"content"`
	ParentID      *int64    `json:"parent_id,string,omitempty" db:"parent_id"`
	QuoteOfID     *int64    `json:"quote_of_id,string,omitempty" db:"quote_of_id"`
	RepostOfID    *int64    `json:"repost_of_id,string,omitempty" db:"repost_of_id"`
	MediaURLs     []string  `json:"media_urls" db:"media_urls"`
	PollData      *PollData `json:"poll_data,omitempty" db:"poll_data"`
	LikeCount     int       `json:"like_count" db:"like_count"`
	RetweetCount  int       `json:"retweet_count" db:"retweet_count"`
	ReplyCount    int       `json:"reply_count" db:"reply_count"`
	QuoteCount    int       `json:"quote_count" db:"quote_count"`
	BookmarkCount int       `json:"bookmark_count" db:"bookmark_count"`
	ViewCount     int       `json:"view_count" db:"view_count"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// EmbeddedTweet is a quoted/reposted tweet hydrated one level with its author.
type EmbeddedTweet struct {
	Tweet
	Author *User `json:"author"`
}

// HydratedTweet is a feed/thread tweet with author, embeds and viewer state.
type HydratedTweet struct {
	Tweet
	Author       *User          `json:"author"`
	QuotedTweet  *EmbeddedTweet `json:"quoted_tweet,omitempty"`
	RepostedTweet *EmbeddedTweet `json:"reposted_tweet,omitempty"`
	ParentTweet  *EmbeddedTweet `json:"parent_tweet,omitempty"`
	RepostedBy   *User          `json:"reposted_by,omitempty"`
	LikedByMe     bool `json:"liked_by_me"`
	RetweetedByMe bool `json:"retweeted_by_me"`
	BookmarkedByMe bool `json:"bookmarked_by_me"`
	MyPollVote    *int `json:"my_poll_vote,omitempty"`
}

// Trend is one row of GET /api/v1/trends.
type Trend struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

// FollowUser is one row of GET /api/v1/users/who-to-follow.
type FollowUser struct {
	User
	IsFollowing bool `json:"is_following"`
}

// Notification maps public.notifications, hydrated for the client.
type Notification struct {
	ID        int64          `json:"id,string" db:"id"`
	UserID    int64          `json:"user_id,string" db:"user_id"`
	ActorID   int64          `json:"actor_id,string" db:"actor_id"`
	Type      string         `json:"type" db:"type"`
	TweetID   *int64         `json:"tweet_id,string,omitempty" db:"tweet_id"`
	Read      bool           `json:"is_read" db:"read"`
	CreatedAt time.Time      `json:"created_at" db:"created_at"`
	Actor     *User          `json:"actor,omitempty"`
	Tweet     *HydratedTweet `json:"tweet,omitempty"`
}

// Message maps public.messages (direct messages).
type Message struct {
	ID          int64     `json:"id,string" db:"id"`
	SenderID    int64     `json:"sender_id,string" db:"sender_id"`
	RecipientID int64     `json:"recipient_id,string" db:"recipient_id"`
	Content     string    `json:"content" db:"content"`
	MediaURL    string    `json:"media_url" db:"media_url"`
	Reaction    string    `json:"reaction" db:"reaction"`
	Read        bool      `json:"is_read" db:"read"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// Conversation is one DM thread preview for the conversation list.
type Conversation struct {
	Partner     *User    `json:"partner"`
	LastMessage *Message `json:"last_message"`
	UnreadCount int      `json:"unread_count"`
}

// AuthInfo is the verified Supabase identity extracted from the access token.
type AuthInfo struct {
	AuthID    string `json:"auth_id"`
	Email     string `json:"email"`
	FullName  string `json:"full_name"`
	AvatarURL string `json:"avatar_url"`
}
