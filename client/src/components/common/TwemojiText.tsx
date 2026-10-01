import { useMemo } from 'react'
import { parse } from 'twemoji-parser'

const TWEMOJI_SVG_BASE = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/'

interface Props {
  text: string
  className?: string
  /** Override class applied to every rendered emoji <img> (default "twemoji"). */
  imgClassName?: string
}

/** Renders emojis in any string as crisp Twitter SVG images. */
export default function TwemojiText({ text, className, imgClassName }: Props) {
  const imgCls = imgClassName ?? 'twemoji'
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
      if (start > last) out.push({ key: `t${i}`, text: text.slice(last, start) })
      out.push({ key: `e${i}`, url: e.url, alt: e.text })
      last = start + e.text.length
    })
    if (last < text.length) out.push({ key: 'tend', text: text.slice(last) })
    return out
  }, [text])

  return (
    <span className={className}>
      {parts.map((p) =>
        p.url ? (
          <img key={p.key} src={p.url} alt={p.alt ?? ''} className={imgCls} draggable={false} />
        ) : (
          <span key={p.key}>{p.text}</span>
        ),
      )}
    </span>
  )
}
