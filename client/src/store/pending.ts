import { create } from 'zustand'
import type { Tweet } from '../types'

interface PendingState {
  queue: Tweet[]
  push: (tweets: Tweet[]) => void
  flush: () => Tweet[]
  clear: () => void
}

/** Tweets received live via NEW_TWEET, waiting behind the "Show N posts" pill. */
export const usePendingStore = create<PendingState>((set, get) => ({
  queue: [],
  push: (tweets) =>
    set((s) => {
      const seen = new Set(s.queue.map((t) => t.id))
      const fresh = tweets.filter((t) => !seen.has(t.id))
      if (fresh.length === 0) return s
      return { queue: [...fresh, ...s.queue].slice(0, 50) }
    }),
  flush: () => {
    const q = get().queue
    set({ queue: [] })
    return q
  },
  clear: () => set({ queue: [] }),
}))
