import { useMemo, useState } from 'react'
import { X } from 'lucide-react'

interface GifItem {
  id: string
  title: string
  tags: string
  url: string
}

const G = (id: string, title: string, tags: string): GifItem => ({
  id,
  title,
  tags,
  url: `https://media.giphy.com/media/${id}/giphy.gif`,
})

// Reaction GIFs verified live (HTTP 200 + image/gif) at build time.
const GIFS: GifItem[] = [
  G('JIX9t2j0ZTN9S', 'Thumbs up cat', 'yes agree thanks cool'),
  G('26tknCqiP3cDro2Sk', 'Deal with it', 'cool confident swag'),
  G('3o7TKSjRrfIPjeiVyM', 'Happy dance', 'happy dance party celebrate'),
  G('l0HlBO7eyvsqJqB36', 'Laughing', 'funny laugh lol hilarious'),
  G('xT9IgGQoDzuJxYQaMo', 'Excited', 'excited wow happy'),
  G('o0vwzPv6PUD7s', 'Clapping', 'clap applause congrats well done'),
  G('l2JhL1YLvrD5yId2R', 'Love it', 'love heart adore'),
  G('d2lcHJTG5Tscg', 'Mind blown', 'wow shocked unbelievable'),
  G('h62v7i2p5oTpm', 'Facepalm', 'oops fail seriously'),
  G('ICOgUNj9iQ7Tos', 'Shrug', 'whatever unsure shrug'),
  G('Cmr1V8GvBCRBq', 'Party time', 'party celebrate birthday'),
  G('8Iv5lkKy6P2h9', 'Good morning', 'morning hello hi'),
  G('M90mJvfWPhU1i', 'Thank you', 'thanks thank you grateful'),
]

interface Props {
  onPick: (url: string) => void
  onClose: () => void
}

/** Searchable reaction-GIF picker. Attaches a real animated GIF media URL. */
export default function GifPickerModal({ onPick, onClose }: Props) {
  const [q, setQ] = useState('')
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const needle = q.trim().toLowerCase()
  const results = useMemo(() => {
    const live = GIFS.filter((g) => !failed.has(g.id))
    if (!needle) return live
    return live.filter(
      (g) =>
        g.title.toLowerCase().includes(needle) ||
        g.tags.toLowerCase().includes(needle),
    )
  }, [needle, failed])

  const markFailed = (id: string) =>
    setFailed((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#5b708366] p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-2xl bg-black text-[#e7e9ea]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 border-b border-[#2f3336] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close GIF picker"
            className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
          >
            <X className="h-5 w-5" />
          </button>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reaction GIFs"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-[#71767b]"
          />
        </div>
        {results.length === 0 ? (
          <p className="py-10 text-center text-[15px] text-[#71767b]">
            No GIFs found. Try another search.
          </p>
        ) : (
          <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3">
            {results.map((g) => (
              <button
                key={g.id}
                type="button"
                title={g.title}
                onClick={() => onPick(g.url)}
                className="group relative overflow-hidden rounded-xl border border-[#2f3336] transition hover:border-[#1d9bf0]"
              >
                <img
                  src={g.url}
                  alt={g.title}
                  loading="lazy"
                  onError={() => markFailed(g.id)}
                  className="aspect-square w-full bg-[#16181c] object-cover"
                />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-2 py-1 text-left text-[12px]">
                  {g.title}
                </span>
              </button>
            ))}
          </div>
        )}
        <form
          className="flex gap-2 border-t border-[#2f3336] p-3"
          onSubmit={(e) => {
            e.preventDefault()
            const v = new FormData(e.currentTarget).get('url')
            if (typeof v === 'string' && v.trim().startsWith('http')) onPick(v.trim())
          }}
        >
          <input
            name="url"
            placeholder="...or paste any GIF link"
            autoComplete="off"
            className="w-full rounded-full border border-[#333639] bg-transparent px-4 py-2 text-[14px] outline-none placeholder:text-[#71767b] focus:border-[#1d9bf0]"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-[#1d9bf0] px-4 py-2 text-[14px] font-bold text-white transition hover:bg-[#1a8cd8]"
          >
            Use
          </button>
        </form>
      </div>
    </div>
  )
}
