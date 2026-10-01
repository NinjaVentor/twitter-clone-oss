import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { patchTweetEverywhere } from '../lib/feed-cache'
import { useComposerStore } from '../store/composer'
import { useFocusStore } from '../store/focus'
import { useAuth } from '../context/useAuth'
import type { Tweet } from '../types'

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable || tag === 'SELECT'
}

function visibleTweetIds(): string[] {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-tweet-id]'))
  return els
    .filter((el) => el.offsetParent !== null)
    .map((el) => el.dataset.tweetId ?? '')
    .filter(Boolean)
}

function findTweetInCaches(queryClient: ReturnType<typeof useQueryClient>, id: string): Tweet | null {
  const feeds = queryClient.getQueriesData<{ pages: { tweets: Tweet[] }[] }>({
    predicate: (q) => {
      const k = q.queryKey
      return (
        k[0] === 'feed' ||
        k[0] === 'profile-tweets' ||
        k[0] === 'bookmarks' ||
        k[0] === 'search-tweets'
      )
    },
  })
  for (const [, data] of feeds) {
    if (!data) continue
    for (const p of data.pages) {
      const t = p.tweets.find((x) => x.id === id)
      if (t) return t
    }
  }
  return null
}

/** Global X keyboard shortcuts (ignored while typing). Mount inside the authed shell. */
export function useKeyboardShortcuts() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const pendingG = useRef(false)
  const gTimer = useRef<number | null>(null)

  useEffect(() => {
    const armG = () => {
      pendingG.current = true
      if (gTimer.current != null) window.clearTimeout(gTimer.current)
      gTimer.current = window.setTimeout(() => {
        pendingG.current = false
      }, 1200)
    }
    const disarmG = () => {
      pendingG.current = false
      if (gTimer.current != null) {
        window.clearTimeout(gTimer.current)
        gTimer.current = null
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const composer = useComposerStore.getState()
      if (composer.open) return // ComposerModal owns Escape/keys while open.
      if (isTypingTarget(e.target)) return

      const focus = useFocusStore.getState()
      const key = e.key

      // g-sequences: g then h/e/n/m/b/p.
      if (pendingG.current) {
        disarmG()
        const dest: Record<string, string> = {
          h: '/home',
          e: '/explore',
          n: '/notifications',
          m: '/messages',
          b: '/bookmarks',
          p: user ? `/profile/${user.username}` : '/home',
        }
        if (dest[key]) {
          e.preventDefault()
          navigate(dest[key])
        }
        return
      }
      if (key === 'g') {
        armG()
        return
      }

      switch (key) {
        case 'n':
          e.preventDefault()
          composer.openPost()
          break
        case '/':
          e.preventDefault()
          document
            .querySelector<HTMLElement>('[data-search-input]')
            ?.focus()
          break
        case '?':
          focus.setShortcutsOpen(true)
          break
        case 'j':
        case 'k': {
          e.preventDefault()
          const ids = visibleTweetIds()
          if (ids.length === 0) break
          const cur = focus.focusedId
          const idx = cur ? ids.indexOf(cur) : -1
          const next =
            key === 'j' ? ids[Math.min(idx + 1, ids.length - 1)] : ids[Math.max(idx - 1, 0)]
          focus.setFocusedId(next ?? null)
          document
            .querySelector<HTMLElement>(`[data-tweet-id="${next}"]`)
            ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          break
        }
        case 'l':
        case 'r':
        case 't':
        case 'b': {
          const id = focus.focusedId
          if (!id) break
          const tweet = findTweetInCaches(queryClient, id)
          if (!tweet) break
          if (key === 'l') {
            const next = !tweet.liked_by_me
            patchTweetEverywhere(queryClient, id, {
              liked_by_me: next,
              like_count: tweet.like_count + (next ? 1 : -1),
            })
            void api
              .post<{ liked: boolean; like_count: number }>(`/tweets/${id}/like`)
              .then((res) =>
                patchTweetEverywhere(queryClient, id, {
                  liked_by_me: res.data.liked,
                  like_count: res.data.like_count,
                }),
              )
              .catch(() => {})
          } else if (key === 'r') {
            composer.openReply(tweet)
          } else if (key === 't') {
            const next = !tweet.retweeted_by_me
            patchTweetEverywhere(queryClient, id, {
              retweeted_by_me: next,
              retweet_count: tweet.retweet_count + (next ? 1 : -1),
            })
            void api
              .post<{ retweeted: boolean; retweet_count: number }>(`/tweets/${id}/retweet`)
              .then((res) => {
                patchTweetEverywhere(queryClient, id, {
                  retweeted_by_me: res.data.retweeted,
                  retweet_count: res.data.retweet_count,
                })
                return queryClient.invalidateQueries({ queryKey: ['feed'] })
              })
              .catch(() => {})
          } else {
            const next = !tweet.bookmarked_by_me
            patchTweetEverywhere(queryClient, id, {
              bookmarked_by_me: next,
              bookmark_count: tweet.bookmark_count + (next ? 1 : -1),
            })
            void api
              .post<{ bookmarked: boolean; bookmark_count: number }>(`/tweets/${id}/bookmark`)
              .then((res) =>
                patchTweetEverywhere(queryClient, id, {
                  bookmarked_by_me: res.data.bookmarked,
                  bookmark_count: res.data.bookmark_count,
                }),
              )
              .catch(() => {})
          }
          break
        }
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (gTimer.current != null) window.clearTimeout(gTimer.current)
    }
  }, [navigate, queryClient, user])
}
