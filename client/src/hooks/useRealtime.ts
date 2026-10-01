import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { wsClient, type WsMessage } from '../lib/ws'
import { api } from '../lib/api'
import { patchTweetEverywhere, removeTweetEverywhere } from '../lib/feed-cache'
import { useUnreadStore } from '../store/unread'
import { usePendingStore } from '../store/pending'
import type {
  Conversation,
  Message,
  Notification,
  Tweet,
  UnreadCount,
} from '../types'

interface NotificationsCache {
  pages: { notifications: Notification[]; next_cursor?: string | null }[]
}

interface ConversationsCache {
  conversations: Conversation[]
}

interface ThreadCache {
  messages: Message[]
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
}

/** Global realtime subscription: connect on session, route events into stores/caches. */
export function useRealtime(myId: string | null, token: string | null) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!token) {
      wsClient.disconnect()
      return
    }
    wsClient.connect(token)
    // Prime sidebar badges from the server.
    void api
      .get<UnreadCount>('/notifications/unread-count')
      .then((res) =>
        useUnreadStore.getState().setCounts(res.data.unread_notifications, res.data.unread_messages),
      )
      .catch(() => {})
  }, [token])

  useEffect(() => {
    if (!myId) return
    const unsub = wsClient.subscribe((msg: WsMessage) => {
      const unread = useUnreadStore.getState()
      switch (msg.type) {
        case 'NEW_TWEET': {
          const tweet = asRecord(msg.tweet) as unknown as Tweet | null
          if (!tweet || typeof tweet.id !== 'string') break
          // Own posts/reposts are already in cache via composer invalidation.
          if (tweet.user_id === myId) break
          // Only top-level posts + quotes/reposts queue behind the pill.
          if (tweet.parent_id) break
          usePendingStore.getState().push([tweet])
          break
        }
        case 'TWEET_METRICS_UPDATED': {
          const id = msg.tweet_id
          if (typeof id !== 'string') break
          patchTweetEverywhere(queryClient, id, {
            like_count: Number(msg.like_count ?? 0),
            retweet_count: Number(msg.retweet_count ?? 0),
            reply_count: Number(msg.reply_count ?? 0),
            quote_count: Number(msg.quote_count ?? 0),
            bookmark_count: Number(msg.bookmark_count ?? 0),
            view_count: Number(msg.view_count ?? 0),
          })
          break
        }
        case 'NOTIFICATION_CREATED': {
          const n = asRecord(msg.notification) as unknown as Notification | null
          if (!n || typeof n.id !== 'string') break
          unread.incNotifications()
          prependNotification(queryClient, n)
          break
        }
        case 'DM_RECEIVED': {
          const m = asRecord(msg.message) as unknown as Message | null
          if (!m || typeof m.id !== 'string') break
          const partnerId = m.sender_id === myId ? m.recipient_id : m.sender_id
          // Badges: only count incoming messages.
          if (m.sender_id !== myId) unread.incMessages()
          upsertConversation(queryClient, m, partnerId, m.sender_id !== myId)
          appendThreadMessage(queryClient, m, partnerId)
          break
        }
        case 'DM_REACTION': {
          const m = asRecord(msg.message) as unknown as Message | null
          if (!m || typeof m.id !== 'string') break
          const partnerId = m.sender_id === myId ? m.recipient_id : m.sender_id
          updateThreadMessage(queryClient, partnerId, m.id, { reaction: m.reaction })
          updateConversationLast(queryClient, partnerId, { reaction: m.reaction }, m.id)
          break
        }
        case 'DM_READ': {
          const sender = msg.sender_id
          const recipient = msg.recipient_id
          if (typeof sender !== 'string' || typeof recipient !== 'string') break
          // The other party's id in the affected thread.
          const partnerId = sender === myId ? recipient : sender
          markThreadSeen(queryClient, partnerId, myId)
          break
        }
        case 'TWEET_DELETED': {
          const id = msg.tweet_id
          if (typeof id !== 'string') break
          removeTweetEverywhere(queryClient, id)
          break
        }
        case 'DM_DELETED': {
          const id = msg.message_id
          if (typeof id !== 'string') break
          removeMessageEverywhere(queryClient, id)
          break
        }
        default:
          break
      }
    })
    return unsub
  }, [queryClient, myId])
}

function prependNotification(queryClient: ReturnType<typeof useQueryClient>, n: Notification) {
  const tabs: Record<string, (x: Notification) => boolean> = {
    all: () => true,
    verified: (x) => !!x.actor?.verified,
    mentions: (x) => x.type === 'MENTION' || x.type === 'REPLY' || x.type === 'QUOTE',
  }
  for (const [tab, match] of Object.entries(tabs)) {
    if (!match(n)) continue
    queryClient.setQueryData<NotificationsCache>(['notifications', tab], (old) => {
      if (!old || old.pages.length === 0) return old
      const [first, ...rest] = old.pages
      if (first.notifications.some((x) => x.id === n.id)) return old
      return { ...old, pages: [{ ...first, notifications: [n, ...first.notifications] }, ...rest] }
    })
  }
}

function upsertConversation(
  queryClient: ReturnType<typeof useQueryClient>,
  m: Message,
  partnerId: string,
  incoming: boolean,
) {
  queryClient.setQueryData<ConversationsCache>(['conversations'], (old) => {
    if (!old) return old
    const rest = old.conversations.filter((c) => c.partner?.id !== partnerId)
    const existing = old.conversations.find((c) => c.partner?.id === partnerId)
    const updated: Conversation = {
      partner: existing?.partner,
      last_message: m,
      unread_count: (existing?.unread_count ?? 0) + (incoming ? 1 : 0),
    }
    return { conversations: [updated, ...rest] }
  })
}

function appendThreadMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  m: Message,
  partnerId: string,
) {
  queryClient.setQueryData<ThreadCache>(['conversation', partnerId], (old) => {
    if (!old) return old
    if (old.messages.some((x) => x.id === m.id)) return old
    return { messages: [...old.messages, m] }
  })
}

function updateThreadMessage(
  queryClient: ReturnType<typeof useQueryClient>,
  partnerId: string,
  messageId: string,
  patch: Partial<Message>,
) {
  queryClient.setQueryData<ThreadCache>(['conversation', partnerId], (old) => {
    if (!old) return old
    return {
      messages: old.messages.map((x) => (x.id === messageId ? { ...x, ...patch } : x)),
    }
  })
}

function updateConversationLast(
  queryClient: ReturnType<typeof useQueryClient>,
  partnerId: string,
  patch: Partial<Message>,
  messageId: string,
) {
  queryClient.setQueryData<ConversationsCache>(['conversations'], (old) => {
    if (!old) return old
    return {
      conversations: old.conversations.map((c) =>
        c.partner?.id === partnerId && c.last_message?.id === messageId
          ? { ...c, last_message: { ...c.last_message, ...patch } }
          : c,
      ),
    }
  })
}

function markThreadSeen(
  queryClient: ReturnType<typeof useQueryClient>,
  partnerId: string,
  myId: string,
) {
  queryClient.setQueryData<ThreadCache>(['conversation', partnerId], (old) => {
    if (!old) return old
    return {
      messages: old.messages.map((x) =>
        x.sender_id === myId && !x.is_read ? { ...x, is_read: true } : x,
      ),
    }
  })
}

function removeMessageEverywhere(queryClient: ReturnType<typeof useQueryClient>, id: string) {
  let lastDeleted = false
  queryClient.setQueriesData<ThreadCache>({ queryKey: ['conversation'] }, (old) => {
    if (!old) return old
    if (!old.messages.some((x) => x.id === id)) return old
    return { messages: old.messages.filter((x) => x.id !== id) }
  })
  queryClient.setQueryData<ConversationsCache>(['conversations'], (old) => {
    if (!old) return old
    const needsRefetch = old.conversations.some((c) => c.last_message?.id === id)
    if (needsRefetch) lastDeleted = true
    return old
  })
  if (lastDeleted) {
    void queryClient.invalidateQueries({ queryKey: ['conversations'] })
  }
}
