import { useEffect, useRef } from 'react'

/**
 * Calls onClose when the user clicks/taps outside the referenced element
 * (or presses Escape), like x.com popovers. Only listens while active.
 */
export function useOutsideClick<T extends HTMLElement>(active: boolean, onClose: () => void) {
  const ref = useRef<T>(null)
  const closeRef = useRef(onClose)

  // Keep the latest callback without re-subscribing listeners.
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    if (!active) return
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        closeRef.current()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [active])

  return ref
}
