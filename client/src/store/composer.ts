import { create } from 'zustand'
import type { Tweet } from '../types'

export type ComposerMode =
  | { kind: 'post' }
  | { kind: 'reply'; replyTo: Tweet }
  | { kind: 'quote'; quoteOf: Tweet }

interface ComposerState {
  open: boolean
  mode: ComposerMode
  openPost: () => void
  openReply: (replyTo: Tweet) => void
  openQuote: (quoteOf: Tweet) => void
  close: () => void
}

export const useComposerStore = create<ComposerState>((set) => ({
  open: false,
  mode: { kind: 'post' },
  openPost: () => set({ open: true, mode: { kind: 'post' } }),
  openReply: (replyTo) => set({ open: true, mode: { kind: 'reply', replyTo } }),
  openQuote: (quoteOf) => set({ open: true, mode: { kind: 'quote', quoteOf } }),
  close: () => set({ open: false, mode: { kind: 'post' } }),
}))
