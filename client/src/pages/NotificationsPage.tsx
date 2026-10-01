import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, Heart, Repeat2, Settings, User } from 'lucide-react'
import { api } from '../lib/api'
import { timeAgo } from '../lib/time'
import { useUnreadStore } from '../store/unread'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import TweetCard from '../components/tweet/TweetCard'
import TwemojiText from '../components/common/TwemojiText'
import UserHoverCard from '../components/user/UserHoverCard'
import type { Notification, NotificationsResponse } from '../types'

type Tab = 'all' | 'verified' | 'mentions'

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'verified', label: 'Verified' },
  { key: 'mentions', label: 'Mentions' },
]

function SystemRow({ n }: { n: Notification }) {
  const actor = n.actor
  const Icon =
    n.type === 'LIKE' ? (
      <Heart className="h-7 w-7" fill="#f91880" color="#f91880" />
    ) : n.type === 'RETWEET' ? (
      <Repeat2 className="h-8 w-8" color="#00ba7c" />
    ) : (
      <User className="h-7 w-7" color="#1d9bf0" />
    )
  const verb =
    n.type === 'LIKE' ? 'liked your Tweet' : n.type === 'RETWEET' ? 'Retweeted your Tweet' : 'followed you'
  return (
    <Link
      to={n.tweet ? `/status/${n.tweet.id}` : actor ? `/profile/${actor.username}` : '#'}
      className="block border-b border-[#2f3336] px-4 py-3 transition hover:bg-[#080808]"
    >
      <div className="mb-1 ml-8">{Icon}</div>
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {actor ? (
            <UserHoverCard username={actor.username}>
              <span>
                {actor.avatar_url ? (
                  <img
                    src={actor.avatar_url}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-8 w-8 rounded-full border border-black object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-black bg-[#333639] text-sm font-bold">
                    {(actor.display_name || '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
            </UserHoverCard>
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#333639] text-sm font-bold">
              ?
            </span>
          )}
        </div>
        <p className="min-w-0 flex-1 truncate text-[15px]">
          {actor ? (
            <UserHoverCard username={actor.username}>
              <span className="font-bold hover:underline">
                <TwemojiText text={actor.display_name} />
              </span>
            </UserHoverCard>
          ) : (
            <span className="font-bold">Someone</span>
          )}{' '}
          <span className="text-[#71767b]">{verb}</span>{' '}
          <span className="text-[#71767b]">· {timeAgo(n.created_at)}</span>
        </p>
      </div>
      {n.tweet?.content && (
        <p className="mt-1 truncate text-[15px] text-[#71767b]">{n.tweet.content}</p>
      )}
    </Link>
  )
}

export default function NotificationsPage() {
  useDocumentTitle('Notifications')
  const queryClient = useQueryClient()
  const clearNotifications = useUnreadStore((s) => s.clearNotifications)
  const markedRef = useRef(false)

  const tabs: Tab[] = ['all', 'verified', 'mentions']
  const [params] = useSearchParams()
  // Active tab from local state (default all).
  const active = (params.get('tab') as Tab) || 'all'
  const safeTab: Tab = tabs.includes(active) ? active : 'all'

  const feed = useInfiniteQuery({
    queryKey: ['notifications', safeTab],
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const res = await api.get<NotificationsResponse>('/notifications', {
        params: { tab: safeTab, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
      })
      return res.data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  })

  // Mark everything read on view + clear the sidebar badge.
  useEffect(() => {
    if (markedRef.current) return
    markedRef.current = true
    void api
      .post('/notifications/mark-read')
      .then(() => {
        clearNotifications()
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      })
      .catch(() => {})
  }, [clearNotifications, queryClient])

  const markAll = () => {
    void api
      .post('/notifications/mark-read')
      .then(() => {
        clearNotifications()
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      })
      .catch(() => {})
  }

  const items = feed.data?.pages.flatMap((p) => p.notifications) ?? []

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-[#2f3336] bg-black/65 backdrop-blur-md">
        <div className="flex items-center justify-between px-4 py-2">
          <h1 className="text-[20px] font-extrabold">Notifications</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Mark all read"
              title="Mark all read"
              onClick={markAll}
              className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
            >
              <CheckCheck className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Notification settings"
              title="Settings"
              className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex">
          {TABS.map((t) => (
            <Link
              key={t.key}
              to={`/notifications?tab=${t.key}`}
              className="relative flex-1 py-4 text-center text-[15px] transition hover:bg-[#e7e9ea08]"
            >
              <span className={safeTab === t.key ? 'font-bold' : 'text-[#71767b]'}>{t.label}</span>
              {safeTab === t.key && (
                <span className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full bg-[#1d9bf0]" />
              )}
            </Link>
          ))}
        </div>
      </div>

      {feed.isLoading ? (
        <p className="py-16 text-center text-[15px] text-[#71767b]">Loading notifications…</p>
      ) : feed.isError ? (
        <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <p className="text-[20px] font-extrabold">Something went wrong</p>
          <button
            type="button"
            onClick={() => void feed.refetch()}
            className="mt-2 rounded-full bg-[#1d9bf0] px-6 py-2 font-bold text-white"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="mx-auto max-w-[380px] px-8 py-16 text-center">
          <p className="text-[31px] font-extrabold">Nothing to see here — yet</p>
          <p className="mt-2 text-[15px] text-[#71767b]">
            Likes, Retweets, replies and follows will show up here.
          </p>
        </div>
      ) : (
        <>
          {items.map((n) =>
            n.type === 'MENTION' || n.type === 'REPLY' || n.type === 'QUOTE' ? (
              n.tweet ? (
                <div key={n.id} data-tweet-id={n.tweet.id}>
                  <TweetCard tweet={n.tweet} />
                </div>
              ) : (
                <SystemRow key={n.id} n={n} />
              )
            ) : (
              <SystemRow key={n.id} n={n} />
            ),
          )}
          {feed.hasNextPage && (
            <button
              type="button"
              disabled={feed.isFetchingNextPage}
              onClick={() => void feed.fetchNextPage()}
              className="mx-auto my-4 block rounded-full border border-[#536471] px-6 py-2 text-[15px] font-bold transition hover:bg-[#e7e9ea1a] disabled:opacity-50"
            >
              {feed.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
