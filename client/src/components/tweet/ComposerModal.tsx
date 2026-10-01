import { useEffect } from 'react'
import { useComposerStore } from '../../store/composer'
import TweetCard from './TweetCard'
import TweetComposer from './TweetComposer'
import { TwitterBird } from '../icons'

/** Global Post/Reply/Quote modal. (Letter shortcuts live in useKeyboardShortcuts.) */
export default function ComposerModal() {
  const { open, mode, close } = useComposerStore()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useComposerStore.getState().open) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!open) return null

  const replyToId = mode.kind === 'reply' ? mode.replyTo.id : undefined
  const quoteOfId = mode.kind === 'quote' ? mode.quoteOf.id : undefined
  const placeholder =
    mode.kind === 'reply'
      ? `Reply to @${mode.replyTo.author?.username ?? ''}`
      : mode.kind === 'quote'
        ? 'Add a comment'
        : undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#5b708366] p-4 pt-[5vh]"
      onClick={close}
    >
      <div
        className="w-full max-w-[600px] rounded-2xl bg-black p-4 text-[#e7e9ea]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center">
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl transition hover:bg-[#e7e9ea1a]"
          >
            ✕
          </button>
          <TwitterBird className="mx-auto h-6 w-6 text-[#1d9bf0]" />
          <span className="w-9" />
        </div>
        {mode.kind === 'quote' && (
          <p className="mb-2 truncate px-12 text-[14px] text-[#71767b]">
            Quoting @{mode.quoteOf.author?.username} in a Quote Tweet
          </p>
        )}
        {mode.kind === 'reply' && (
          <div className="mb-1">
            <div className="pointer-events-none">
              <TweetCard tweet={mode.replyTo} hideActions threadLine />
            </div>
            <p className="px-4 pb-1 pt-2 text-[14px] text-[#71767b]">
              Replying to{' '}
              <span className="text-[#1d9bf0]">@{mode.replyTo.author?.username}</span>
            </p>
          </div>
        )}
        <TweetComposer
          replyToId={replyToId}
          quoteOfId={quoteOfId}
          autoFocus
          placeholder={placeholder}
          onPosted={close}
        />
      </div>
    </div>
  )
}

