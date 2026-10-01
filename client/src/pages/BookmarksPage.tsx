import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../context/useAuth'
import { useViewBatching } from '../hooks/useFeed'
import { useOutsideClick } from '../hooks/useDismiss'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import TweetCard from '../components/tweet/TweetCard'
import type { FeedResponse } from '../types'

export default function BookmarksPage() {
  useDocumentTitle('Bookmarks')
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuPopRef = useOutsideClick<HTMLSpanElement>(menuOpen, () => setMenuOpen(false))
  const [clearing, setClearing] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const bookmarks = useInfiniteQuery({
    queryKey: ['bookmarks'],
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const res = await api.get<FeedResponse>('/bookmarks', {
        params: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
      })
      return res.data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  })

  const listRef = useViewBatching(!bookmarks.isLoading)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          bookmarks.hasNextPage &&
          !bookmarks.isFetchingNextPage
        ) {
          void bookmarks.fetchNextPage()
        }
      },
      { rootMargin: '600px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [bookmarks])

  const clearAll = async () => {
    setMenuOpen(false)
    if (!window.confirm('Clear all Bookmarks?')) return
    setClearing(true)
    try {
      await api.delete('/bookmarks')
      await queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
    } finally {
      setClearing(false)
    }
  }

  const tweets = bookmarks.data?.pages.flatMap((p) => p.tweets) ?? []

  return (
    <div ref={listRef}>
      <div className="sticky top-0 z-10 flex items-center justify-between bg-black/65 px-4 py-2 backdrop-blur-md">
        <div className="min-w-0">
          <h1 className="text-[20px] font-extrabold">Bookmarks</h1>
          <p className="truncate text-[13px] text-[#71767b]">@{user?.username}</p>
        </div>
        <span ref={menuPopRef} className="relative">
          <button
            type="button"
            aria-label="More"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-10 z-30 w-[240px] overflow-hidden rounded-2xl bg-black py-2 shadow-[0_0_15px_rgba(255,255,255,0.25)]">
              <button
                type="button"
                onClick={() => void clearAll()}
                disabled={clearing || tweets.length === 0}
                className="w-full px-4 py-3 text-left text-[15px] font-bold text-[#f4212e] hover:bg-[#e7e9ea1a] disabled:opacity-40"
              >
                {clearing ? 'Clearing…' : 'Clear all Bookmarks'}
              </button>
            </div>
          )}
        </span>
      </div>

      {bookmarks.isLoading ? (
        <p className="animate-pulse py-16 text-center text-[15px] text-[#71767b]">
          Loading bookmarks…
        </p>
      ) : tweets.length === 0 ? (
        <div className="mx-auto max-w-[380px] px-8 py-16 text-center">
          <p className="text-[31px] font-extrabold">Save Tweets for later</p>
          <p className="mt-2 text-[15px] text-[#71767b]">
            Bookmark Tweets to easily find them again in the future.
          </p>
        </div>
      ) : (
        tweets.map((t) => (
          <div key={t.id} data-tweet-id={t.id}>
            <TweetCard tweet={t} />
          </div>
        ))
      )}
      <div ref={sentinelRef} className="py-6 text-center text-[14px] text-[#71767b]">
        {bookmarks.isFetchingNextPage ? 'Loading more…' : ''}
      </div>
    </div>
  )
}
