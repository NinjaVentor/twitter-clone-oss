import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  safeExtractHashtags,
  safeExtractMentions,
  safeExtractUrls,
} from '../../lib/twitterText'
import { parse } from 'twemoji-parser'
import UserHoverCard from '../user/UserHoverCard'

const TWEMOJI_SVG_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/'

interface Props {
  text: string
  className?: string
}

interface Span {
  start: number
  end: number
  kind: 'hashtag' | 'mention' | 'url'
  value: string
}

function collectSpans(text: string): Span[] {
  const spans: Span[] = []
  try {
    for (const h of safeExtractHashtags(text)) {
      spans.push({ start: h.indices[0], end: h.indices[1], kind: 'hashtag', value: h.hashtag })
    }
  } catch {
    /* twitter-text edge case: fall through to plain text */
  }
  try {
    for (const m of safeExtractMentions(text)) {
      spans.push({ start: m.indices[0], end: m.indices[1], kind: 'mention', value: m.screenName })
    }
  } catch {
    /* ignore */
  }
  try {
    for (const u of safeExtractUrls(text)) {
      spans.push({ start: u.indices[0], end: u.indices[1], kind: 'url', value: u.url })
    }
  } catch {
    /* ignore */
  }
  spans.sort((a, b) => a.start - b.start)
  // Drop overlaps (keep earliest).
  const out: Span[] = []
  let lastEnd = 0
  for (const s of spans) {
    if (s.start < lastEnd) continue
    out.push(s)
    lastEnd = s.end
  }
  return out
}

function EmojiChunk({ text }: { text: string }) {
  const parts = useMemo(() => {
    const entities = parse(text, {
      assetType: 'svg',
      buildUrl: (codepoints: string, assetType: string) =>
        `${TWEMOJI_SVG_BASE}${codepoints}.${assetType}`,
    })
    if (entities.length === 0) return [{ key: 't0', text }]
    const out: { key: string; text?: string; url?: string; alt?: string }[] = []
    let last = 0
    entities.forEach((e, i) => {
      const start = text.indexOf(e.text, last)
      if (start === -1) return
      if (start > last) out.push({ key: `t${i}`, text: text.slice(last, start) })
      out.push({ key: `e${i}`, url: e.url, alt: e.text })
      last = start + e.text.length
    })
    if (last < text.length) out.push({ key: 'tend', text: text.slice(last) })
    return out
  }, [text])
  return (
    <>
      {parts.map((p) =>
        p.url ? (
          <img key={p.key} src={p.url} alt={p.alt ?? ''} className="twemoji" draggable={false} />
        ) : (
          <span key={p.key}>{p.text}</span>
        ),
      )}
    </>
  )
}

function stop(e: React.MouseEvent) {
  e.stopPropagation()
}

/** Tweet body with hashtag/mention/URL links and Twitter-SVG emojis. */
export default function RichTweetText({ text, className }: Props) {
  const nodes = useMemo(() => {
    const spans = collectSpans(text)
    if (spans.length === 0) return null
    const out: React.ReactNode[] = []
    let last = 0
    spans.forEach((s, i) => {
      if (s.start > last) out.push(<EmojiChunk key={`p${i}`} text={text.slice(last, s.start)} />)
      const label = text.slice(s.start, s.end)
      if (s.kind === 'hashtag') {
        out.push(
          <Link
            key={`s${i}`}
            to={`/explore?q=${encodeURIComponent(`#${s.value}`)}`}
            onClick={stop}
            className="text-[#1d9bf0] hover:underline"
          >
            {label}
          </Link>,
        )
      } else if (s.kind === 'mention') {
        out.push(
          <UserHoverCard key={`s${i}`} username={s.value}>
            <Link
              to={`/profile/${s.value}`}
              onClick={stop}
              className="text-[#1d9bf0] hover:underline"
            >
              {label}
            </Link>
          </UserHoverCard>,
        )
      } else {
        out.push(
          <a
            key={`s${i}`}
            href={s.value}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={stop}
            className="text-[#1d9bf0] hover:underline"
          >
            {label}
          </a>,
        )
      }
      last = s.end
    })
    if (last < text.length) out.push(<EmojiChunk key="ptail" text={text.slice(last)} />)
    return out
  }, [text])

  if (!nodes) return <EmojiChunk text={text} />
  return <span className={className}>{nodes}</span>
}
