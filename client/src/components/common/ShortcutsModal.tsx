import { X } from 'lucide-react'
import { useFocusStore } from '../../store/focus'

const ROWS: [string, string][] = [
  ['n', 'New Tweet'],
  ['/', 'Search'],
  ['j / k', 'Next / previous Tweet'],
  ['l', 'Like focused Tweet'],
  ['r', 'Reply to focused Tweet'],
  ['t', 'Retweet focused Tweet'],
  ['b', 'Bookmark focused Tweet'],
  ['g then h', 'Go to Home'],
  ['g then e', 'Go to Explore'],
  ['g then n', 'Go to Notifications'],
  ['g then m', 'Go to Messages'],
  ['g then b', 'Go to Bookmarks'],
  ['g then p', 'Go to Profile'],
  ['?', 'This menu'],
  ['Esc', 'Close dialogs'],
]

/** Twitter keyboard-shortcuts cheat-sheet modal (opened with ?). */
export default function ShortcutsModal() {
  const { shortcutsOpen, setShortcutsOpen } = useFocusStore()
  if (!shortcutsOpen) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#5b708366] p-4 pt-[10vh]"
      onClick={() => setShortcutsOpen(false)}
    >
      <div
        className="w-full max-w-[480px] overflow-hidden rounded-2xl bg-black text-[#e7e9ea]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-6 px-5 py-4">
          <button
            type="button"
            onClick={() => setShortcutsOpen(false)}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
          >
            <X className="h-5 w-5" />
          </button>
          <h2 className="text-[20px] font-extrabold">Keyboard shortcuts</h2>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 pb-6">
          {ROWS.map(([keys, label]) => (
            <div
              key={keys}
              className="flex items-center justify-between border-b border-[#2f3336] py-2.5 text-[15px]"
            >
              <span className="text-[#71767b]">{label}</span>
              <span className="flex gap-1">
                {keys.split(' ').map((k, i) =>
                  k === '/' || k === 'then' ? (
                    <span key={i} className="px-1 text-[#71767b]">
                      {k}
                    </span>
                  ) : (
                    <kbd
                      key={i}
                      className="min-w-[28px] rounded-md border border-[#536471] bg-[#202327] px-2 py-0.5 text-center font-bold"
                    >
                      {k}
                    </kbd>
                  ),
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
