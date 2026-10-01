import type { QueryClient } from '@tanstack/react-query'
import type { ThreadResponse, Tweet } from '../types'

interface FeedPages {
  pages: { tweets: Tweet[]; next_cursor?: string | null }[]
}

type Patch = Partial<Tweet> | ((t: Tweet) => Tweet)

function apply(t: Tweet, patch: Patch): Tweet {
  const p = typeof patch === 'function' ? patch(t) : patch
  return { ...t, ...p }
}

/** Optimistically patch a tweet everywhere it appears (both feeds + any open thread). */
export function patchTweetEverywhere(queryClient: QueryClient, id: string, patch: Patch) {
  for (const feedType of ['foryou', 'following']) {
    queryClient.setQueryData<FeedPages>(['feed', feedType], (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          tweets: p.tweets.map((t) => (t.id === id ? apply(t, patch) : t)),
        })),
      }
    })
  }
  queryClient.setQueriesData<ThreadResponse>({ queryKey: ['thread'] }, (old) => {
    if (!old) return old
    const map = (t: Tweet) => (t.id === id ? apply(t, patch) : t)
    return {
      ...old,
      tweet: map(old.tweet),
      ancestors: old.ancestors.map(map),
      replies: old.replies.map(map),
    }
  })
  // Profile tabs, bookmarks and search results share the paged-tweets shape.
  queryClient.setQueriesData<FeedPages>(
    {
      predicate: (q) => {
        const k = q.queryKey
        return k[0] === 'profile-tweets' || k[0] === 'bookmarks' || k[0] === 'search-tweets'
      },
    },
    (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          tweets: p.tweets.map((t) => (t.id === id ? apply(t, patch) : t)),
        })),
      }
    },
  )
}

/** Remove a tweet from bookmarks/search/profile caches (e.g. after unbookmark). */
export function removeTweetFromLists(queryClient: QueryClient, id: string) {
  queryClient.setQueriesData<FeedPages>(
    {
      predicate: (q) => {
        const k = q.queryKey
        return k[0] === 'bookmarks' || k[0] === 'search-tweets'
      },
    },
    (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          tweets: p.tweets.filter((t) => t.id !== id),
        })),
      }
    },
  )
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) {
    const v = n / 1000
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}K`
  }
  const v = n / 1_000_000
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}M`
}

/** Prepend live tweets to the top of the foryou feed's first page (Show N posts). */
export function prependTweetsToFeed(queryClient: QueryClient, tweets: Tweet[]) {
  if (tweets.length === 0) return
  queryClient.setQueryData<FeedPages>(['feed', 'foryou'], (old) => {
    if (!old || old.pages.length === 0) return old
    const seen = new Set(old.pages.flatMap((p) => p.tweets.map((t) => t.id)))
    const fresh = tweets.filter((t) => !seen.has(t.id))
    if (fresh.length === 0) return old
    const [first, ...rest] = old.pages
    return { ...old, pages: [{ ...first, tweets: [...fresh, ...first.tweets] }, ...rest] }
  })
}

/** Remove a deleted tweet from every tweet cache (feeds, threads, profile, bookmarks, search). */
export function removeTweetEverywhere(queryClient: QueryClient, id: string) {
  for (const feedType of ['foryou', 'following']) {
    queryClient.setQueryData<FeedPages>(['feed', feedType], (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          tweets: p.tweets.filter((t) => t.id !== id),
        })),
      }
    })
  }
  queryClient.setQueriesData<ThreadResponse>({ queryKey: ['thread'] }, (old) => {
    if (!old) return old
    return {
      ...old,
      ancestors: old.ancestors.filter((t) => t.id !== id),
      replies: old.replies.filter((t) => t.id !== id),
    }
  })
  removeTweetFromLists(queryClient, id)
  queryClient.setQueriesData<FeedPages>(
    {
      predicate: (q) => {
        const k = q.queryKey
        return k[0] === 'profile-tweets'
      },
    },
    (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          tweets: p.tweets.filter((t) => t.id !== id),
        })),
      }
    },
  )
}

/** Append a fresh reply into every cached thread view of its parent. */
export function appendThreadReply(queryClient: QueryClient, parentId: string, reply: Tweet) {
  queryClient.setQueriesData<ThreadResponse>({ queryKey: ['thread'] }, (old) => {
    if (!old) return old
    const isThread =
      old.tweet.id === parentId || old.replies.some((t) => t.id === parentId)
    if (!isThread) return old
    if (old.replies.some((t) => t.id === reply.id)) return old
    return { ...old, replies: [reply, ...old.replies] }
  })
}
