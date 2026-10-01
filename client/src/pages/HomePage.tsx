import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp } from 'lucide-react'
import { useFeed, useViewBatching, type FeedType } from '../hooks/useFeed'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAuth } from '../context/useAuth'
import { prependTweetsToFeed } from '../lib/feed-cache'
import { useFocusStore } from '../store/focus'
import { usePendingStore } from '../store/pending'
import OnboardingModal from '../components/auth/OnboardingModal'
import TweetCard from '../components/tweet/TweetCard'
import TweetComposer from '../components/tweet/TweetComposer'

export default function HomePage() {
  const { user } = useAuth()
  useDocumentTitle('Home')
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<FeedType>('foryou')
  const feed = useFeed(tab)
  const listRef = useViewBatching(!feed.isLoading)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const pending = usePendingStore((s) => s.queue)
  const flushPending = usePendingStore((s) => s.flush)
  const focusedId = useFocusStore((s) => s.focusedId)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) {
          void feed.fetchNextPage()
        }
      },
      { rootMargin: '600px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [feed])

  const tweets = feed.data?.pages.flatMap((p) => p.tweets) ?? []
  const showPill = tab === 'foryou' && pending.length > 0
  const avatars = pending
    .map((t) => t.author?.avatar_url)
    .filter((u): u is string => !!u)
    .slice(0, 3)

  const flush = () => {
    const fresh = flushPending()
    prependTweetsToFeed(queryClient, fresh)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div ref={listRef}>
      {user && !user.onboarded && <OnboardingModal />}

      <div className="sticky top-0 z-10 border-b border-[#2f3336] bg-black/65 backdrop-blur-md">
        <div className="flex">
          {(['foryou', 'following'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="relative flex-1 py-4 text-[15px] transition hover:bg-[#e7e9ea08]"
            >
              <span className={tab === t ? 'font-bold' : 'text-[#71767b]'}>
                {t === 'foryou' ? 'For you' : 'Following'}
              </span>
              {tab === t && (
                <span className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full bg-[#1d9bf0]" />
              )}
            </button>
          ))}
        </div>
        {showPill && (
          <button
            type="button"
            onClick={flush}
            className="flex w-full items-center justify-center gap-2 border-t border-[#2f3336] py-3 text-[15px] text-[#1d9bf0] transition hover:bg-[#e7e9ea08]"
          >
            {avatars.length > 0 && (
              <span className="flex -space-x-2">
                {avatars.map((u, i) => (
                  <img
                    key={`${u}-${i}`}
                    src={u}
                    alt=""
                    className="h-5 w-5 rounded-full border border-black object-cover"
                  />
                ))}
              </span>
            )}
            <ArrowUp className="h-4 w-4" />
            Show {pending.length} Tweet{pending.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <TweetComposer />

      {feed.isLoading ? (
        <p className="py-16 text-center text-[15px] text-[#71767b]">Loading your timeline…</p>
      ) : feed.isError ? (
        <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <p className="text-[20px] font-extrabold">Something went wrong</p>
          <p className="text-[15px] text-[#71767b]">We couldn&apos;t load Tweets. Try again.</p>
          <button
            type="button"
            onClick={() => void feed.refetch()}
            className="mt-2 rounded-full bg-[#1d9bf0] px-6 py-2 font-bold text-white"
          >
            Retry
          </button>
        </div>
      ) : tweets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
          <p className="text-[31px] font-extrabold">
            {tab === 'following' ? 'No Tweets from people you follow yet' : 'Welcome to Twitter 🎉'}
          </p>
          <p className="max-w-[380px] text-[15px] text-[#71767b] whitespace-pre-line">
            {tab === 'following'
              ? 'Follow accounts from "Who to follow" on the right, then switch back here.'
              : 'Be the first to Tweet — your timeline starts with you.'}
          </p>
        </div>
      ) : (
        tweets.map((t) => (
          <div
            key={`${t.id}-${t.reposted_by?.id ?? 'o'}`}
            data-tweet-id={t.id}
            className={focusedId === t.id ? 'rounded-xl ring-2 ring-[#1d9bf0]' : undefined}
          >
            <TweetCard tweet={t} />
          </div>
        ))
      )}

      <div ref={sentinelRef} className="py-6 text-center text-[14px] text-[#71767b]">
        {feed.isFetchingNextPage
          ? 'Loading more…'
          : feed.hasNextPage
            ? 'Scroll for more'
            : tweets.length > 0
              ? 'You’re all caught up 🎉'
              : ''}
      </div>
    </div>
  )
}
