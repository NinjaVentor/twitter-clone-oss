import { create } from 'zustand'

interface UnreadState {
  notifications: number
  messages: number
  setCounts: (n: number, m: number) => void
  incNotifications: () => void
  incMessages: () => void
  clearNotifications: () => void
  clearMessages: () => void
}

export const useUnreadStore = create<UnreadState>((set) => ({
  notifications: 0,
  messages: 0,
  setCounts: (notifications, messages) => set({ notifications, messages }),
  incNotifications: () => set((s) => ({ notifications: s.notifications + 1 })),
  incMessages: () => set((s) => ({ messages: s.messages + 1 })),
  clearNotifications: () => set({ notifications: 0 }),
  clearMessages: () => set({ messages: 0 }),
}))
