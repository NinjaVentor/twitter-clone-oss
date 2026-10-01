import { X } from 'lucide-react'
import { ACCENTS, DEFAULT_FONT_SIZE, FONT_SIZES, useThemeStore, type ThemeName } from '../../store/theme'
import { TwitterBird } from '../icons'
import { VerifiedBadge } from '../tweet/VerifiedBadge'
import TwemojiText from '../common/TwemojiText'

const BACKGROUNDS: { key: ThemeName; label: string; swatch: string }[] = [
  { key: 'default', label: 'Default', swatch: '#ffffff' },
  { key: 'dim', label: 'Dim', swatch: '#15202b' },
  { key: 'lights-out', label: 'Lights out', swatch: '#000000' },
]

function PreviewTweet() {
  const fontSize = useThemeStore((s) => s.fontSize)
  return (
    <div
      className="rounded-2xl border p-4"
      style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}
    >
      <div className="flex gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: 'var(--accent-color)' }}
        >
          <TwitterBird className="h-6 w-6 text-white" />
        </span>
        <div className="min-w-0 flex-1" style={{ fontSize }}>
          <p className="flex items-center gap-1 font-bold" style={{ color: 'var(--text-primary)' }}>
            <TwemojiText text="Twitter" />
            <VerifiedBadge className="h-[18px] w-[18px] shrink-0" />
            <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>
              @Twitter · now
            </span>
          </p>
          <p className="mt-0.5 break-words leading-normal" style={{ color: 'var(--text-primary)' }}>
            This is how your Tweets will look with your new display settings. ✨
          </p>
          <p className="mt-2 flex gap-6 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            <span>
              💬 <span style={{ color: 'var(--accent-color)' }}>12</span>
            </span>
            <span>🔁 34</span>
            <span>❤️ 56</span>
          </p>
        </div>
      </div>
    </div>
  )
}

/** Twitter's authentic "Customize your view" display modal. */
export default function DisplayModal() {
  const displayOpen = useThemeStore((s) => s.displayOpen)
  const setDisplayOpen = useThemeStore((s) => s.setDisplayOpen)
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)
  const accent = useThemeStore((s) => s.accent)
  const setAccent = useThemeStore((s) => s.setAccent)
  const fontSize = useThemeStore((s) => s.fontSize)
  const setFontSize = useThemeStore((s) => s.setFontSize)

  if (!displayOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#5b708366] p-4"
      onClick={() => setDisplayOpen(false)}
    >
      <div
        className="max-h-[90vh] w-full max-w-[600px] overflow-y-auto rounded-2xl p-6"
        style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-6">
          <button
            type="button"
            onClick={() => setDisplayOpen(false)}
            aria-label="Close display settings"
            className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
            style={{ color: 'var(--text-primary)' }}
          >
            <X className="h-5 w-5" />
          </button>
          <h2 className="text-[20px] font-extrabold">Customize your view</h2>
        </div>

        <p className="mb-3 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
          These settings affect all the Twitter accounts on this browser.
        </p>

        <PreviewTweet />

        <div className="mt-6">
          <p className="mb-1 text-[15px] font-bold">Font size</p>
          <div className="flex items-center gap-3">
            <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Aa</span>
            <div className="flex flex-1 items-center justify-between rounded-full px-2 py-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
              {FONT_SIZES.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`Font size ${n}px`}
                  title={`${n}px${n === DEFAULT_FONT_SIZE ? ' (default)' : ''}`}
                  onClick={() => setFontSize(n)}
                  className="flex h-8 w-8 items-center justify-center rounded-full font-bold transition"
                  style={{
                    fontSize: 12 + (n - 13),
                    backgroundColor: fontSize === n ? 'var(--accent-color)' : 'transparent',
                    color: fontSize === n ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {fontSize === n ? '●' : '○'}
                </button>
              ))}
            </div>
            <span className="text-[18px]" style={{ color: 'var(--text-secondary)' }}>Aa</span>
          </div>
        </div>

        <div className="mt-6">
          <p className="mb-2 text-[15px] font-bold">Color</p>
          <div className="flex gap-3 rounded-2xl p-3" style={{ backgroundColor: 'var(--bg-elevated)' }}>
            {ACCENTS.map((a) => (
              <button
                key={a.color}
                type="button"
                aria-label={`${a.name} accent`}
                title={a.name}
                onClick={() => setAccent(a.color, a.hover)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-xl font-bold transition"
                style={{
                  backgroundColor: a.color,
                  color: '#fff',
                  outline: accent === a.color ? '2px solid var(--text-primary)' : 'none',
                  outlineOffset: 2,
                }}
              >
                {accent === a.color ? '✓' : ''}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <p className="mb-2 text-[15px] font-bold">Background</p>
          <div className="grid grid-cols-3 gap-3">
            {BACKGROUNDS.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => setTheme(b.key)}
                className="flex items-center gap-2 rounded-xl p-3 text-left font-bold transition"
                style={{
                  backgroundColor: theme === b.key ? 'var(--bg-elevated)' : 'transparent',
                  border: `2px solid ${theme === b.key ? 'var(--accent-color)' : 'var(--border-color)'}`,
                  color: 'var(--text-primary)',
                }}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm"
                  style={{ backgroundColor: b.swatch, border: '1px solid var(--border-color)', color: '#1d9bf0' }}
                >
                  {theme === b.key ? '✓' : ''}
                </span>
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDisplayOpen(false)}
          className="mt-6 h-[44px] w-full rounded-full text-[15px] font-bold text-white transition"
          style={{ backgroundColor: 'var(--accent-color)' }}
        >
          Done
        </button>
      </div>
    </div>
  )
}
