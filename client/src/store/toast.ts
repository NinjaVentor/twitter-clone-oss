import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  /** Optional action link (e.g. "View" -> /status/:id). */
  actionLabel?: string
  actionTo?: string
  /** Blue Twitter toast (default) or plain dark toast. */
  tone?: 'blue' | 'dark'
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id }] }))
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
    }, 4000)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

export function toast(message: string, opts?: Omit<Toast, 'id' | 'message'>) {
  useToastStore.getState().push({ message, ...opts })
}
