import { useEffect } from 'react'

const BASE = "Twitter. It's what's happening"

/** Sets `document.title` to "<title> / Twitter" and restores BASE on unmount. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} / Twitter` : BASE
    return () => {
      document.title = BASE
    }
  }, [title])
}
