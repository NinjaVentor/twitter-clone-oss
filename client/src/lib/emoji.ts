import { parse } from 'twemoji-parser'

const VS16 = String.fromCodePoint(0xfe0f)
const ZWJ = String.fromCodePoint(0x200d)

/** True when text is only 1-max emojis and nothing else (jumbo-emoji rendering). */
export function isEmojiOnly(text: string, max = 3): boolean {
  const t = text.trim()
  if (!t) return false
  const entities = parse(t, { assetType: 'svg' })
  if (entities.length === 0 || entities.length > max) return false
  let rest = t
  for (const e of entities) {
    rest = rest.split(e.text).join('')
  }
  rest = rest.split(VS16).join('').split(ZWJ).join('').replace(/\s/g, '')
  return rest === ''
}
