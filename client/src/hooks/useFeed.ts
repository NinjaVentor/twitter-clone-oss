import { useEffect, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { FeedResponse } from '../types'

export type FeedType = 'foryou' | 'following'

export function useFeed(feedType: FeedType) {
  return useInfiniteQuery({
    queryKey: ['feed', feedType],
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const res = await api.get<FeedResponse>('/tweets/feed', {
        params: { type: feedType, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
      })
      return res.data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  })
}

/**
 * Observes [data-tweet-id] nodes and batch-reports views.
 * A tweet counts as viewed only after 1.5s of continuous visibility
 * (viewport dwell), firing once per tweet per mount.
 */
export function useViewBatching(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!enabled) return
    const root = ref.current
    if (!root) return
    const pending = new Set<string>()
    const dwellTimers = new Map<string, number>()
    let timer: number | null = null
    const flush = () => {
      timer = null
      if (pending.size === 0) return
      const ids = Array.from(pending)
      pending.clear()
      void api.post('/tweets/views', { tweet_ids: ids }).catch(() => {})
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.tweetId
          if (!id || seen.current.has(id)) continue
          if (e.isIntersecting) {
            // Start the 1.5s dwell clock; leaving early cancels it.
            if (!dwellTimers.has(id)) {
              dwellTimers.set(
                id,
                window.setTimeout(() => {
                  dwellTimers.delete(id)
                  if (seen.current.has(id)) return
                  seen.current.add(id)
                  pending.add(id)
                  observer.unobserve(e.target)
                  if (timer == null) timer = window.setTimeout(flush, 800)
                }, 1500),
              )
            }
          } else {
            const t = dwellTimers.get(id)
            if (t != null) {
              window.clearTimeout(t)
              dwellTimers.delete(id)
            }
          }
        }
        if (timer == null && pending.size > 0) timer = window.setTimeout(flush, 800)
      },
      { rootMargin: '200px' },
    )
    const watch = () => {
      root.querySelectorAll<HTMLElement>('[data-tweet-id]').forEach((el) => {
        if (!seen.current.has(el.dataset.tweetId ?? '')) observer.observe(el)
      })
    }
    watch()
    const mo = new MutationObserver(watch)
    mo.observe(root, { childList: true, subtree: true })
    return () => {
      if (timer != null) window.clearTimeout(timer)
      dwellTimers.forEach((t) => window.clearTimeout(t))
      dwellTimers.clear()
      observer.disconnect()
      mo.disconnect()
      flush()
    }
  }, [enabled])

  return ref
}
