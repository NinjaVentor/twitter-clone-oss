export interface User {
  id: string
  auth_id: string
  email: string
  username: string
  display_name: string
  avatar_url: string
  bio: string
  location: string
  website: string
  banner_url: string
  pinned_tweet_id?: string
  verified: boolean
  onboarded: boolean
  tweets_count: number
  followers_count: number
  following_count: number
  created_at: string
  updated_at: string
}

export interface PollOption {
  text: string
  votes: number
}

export interface PollData {
  options: PollOption[]
  duration_minutes?: number
  ends_at?: string
}

export interface Tweet {
  id: string
  user_id: string
  content: string
  reply_to_id?: string
  parent_id?: string
  quote_of_id?: string
  repost_of_id?: string
  media_urls: string[]
  poll_data?: PollData
  like_count: number
  retweet_count: number
  reply_count: number
  quote_count: number
  bookmark_count: number
  view_count: number
  created_at: string
  author?: User
  quoted_tweet?: Tweet & { author?: User }
  reposted_tweet?: Tweet & { author?: User }
  parent_tweet?: Tweet & { author?: User }
  reposted_by?: User
  liked_by_me: boolean
  retweeted_by_me: boolean
  bookmarked_by_me: boolean
  my_poll_vote?: number
}

export interface FeedResponse {
  tweets: Tweet[]
  next_cursor: string | null
}

export interface ThreadResponse {
  tweet: Tweet
  ancestors: Tweet[]
  replies: Tweet[]
}

export interface Trend {
  tag: string
  count: number
}

export interface FollowUser extends User {
  is_following: boolean
}

export interface ProfileUser extends User {
  is_following: boolean
  is_followed_by: boolean
  pinned_tweet?: Tweet
}

export interface TypeaheadResult {
  hashtags: Trend[]
  users: FollowUser[]
}

export type SearchTab = 'top' | 'latest' | 'people' | 'media'

export interface Notification {
  id: string
  user_id: string
  actor_id: string
  type: 'LIKE' | 'RETWEET' | 'REPLY' | 'QUOTE' | 'MENTION' | 'FOLLOW'
  tweet_id?: string
  is_read: boolean
  created_at: string
  actor?: User
  tweet?: Tweet
}

export interface NotificationsResponse {
  notifications: Notification[]
  next_cursor: string | null
}

export interface UnreadCount {
  unread_notifications: number
  unread_messages: number
}

export interface Message {
  id: string
  sender_id: string
  recipient_id: string
  content: string
  media_url: string
  reaction: string
  is_read: boolean
  created_at: string
}

export interface Conversation {
  partner?: User
  last_message?: Message
  unread_count: number
}
