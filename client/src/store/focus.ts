import { create } from 'zustand'

interface FocusState {
  /** Tweet id currently highlighted by j/k navigation (null = none). */
  focusedId: string | null
  setFocusedId: (id: string | null) => void
  /** X keyboard-shortcuts cheat-sheet modal. */
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
}

export const useFocusStore = create<FocusState>((set) => ({
  focusedId: null,
  setFocusedId: (focusedId) => set({ focusedId }),
  shortcutsOpen: false,
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
}))
