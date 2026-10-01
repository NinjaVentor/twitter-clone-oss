/**
 * Crash-proof accessor for the `twitter-text` CommonJS module.
 *
 * `twitter-text` ships CJS; Vite/Rollup interop resolves its exports
 * differently between dev (esbuild prebundle) and build (Rollup). Named
 * imports (`import { parseTweet } from 'twitter-text'`) can therefore throw
 * at module evaluation time in the browser and white-screen the app.
 *
 * This module imports the namespace once, resolves
 * `(mod as any).default ?? mod`, and every export below falls back to a
 * small regex/weighted-length implementation, so NOTHING in here can ever
 * throw a SyntaxError or ReferenceError — worst case the fallback runs.
 */

import * as twitterTextModule from 'twitter-text'

interface HashtagHit {
  hashtag: string
  indices: [number, number]
}

interface MentionHit {
  screenName: string
  indices: [number, number]
}

interface UrlHit {
  url: string
  indices: [number, number]
}

interface WeightedResult {
  weightedLength: number
  valid: boolean
  permillage: number
}

type TwitterTextApi = {
  parseTweet?: (text: string) => WeightedResult
  extractHashtagsWithIndices?: (text: string) => HashtagHit[]
  extractMentionsWithIndices?: (text: string) => MentionHit[]
  extractUrlsWithIndices?: (text: string) => UrlHit[]
}

function resolveApi(): TwitterTextApi {
  try {
    const mod = twitterTextModule as unknown as { default?: unknown } & TwitterTextApi
    const api = (mod.default ?? mod) as TwitterTextApi
    if (api && typeof api === 'object') return api
  } catch {
    /* fall through to regex fallback */
  }
  return {}
}

const api = resolveApi()

const HASHTAG_RE = /#([A-Za-z0-9_]+)/g
const MENTION_RE = /(^|[^A-Za-z0-9_!#$%&*@＠/]|^RT:?)([@＠])([A-Za-z0-9_]{1,20})/g
const URL_RE = /https?:\/\/[^\s<>"']+/g

/** Weighted length per Twitter's v3 rules (most BMP chars weigh 1-2, emoji weigh 2). */
function fallbackWeightedLength(text: string): number {
  let length = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    length += code > 0xffff || code >= 0x1f300 ? 2 : 1
  }
  return length
}

function indicesOf(text: string, re: RegExp): [number, number][] {
  const out: [number, number][] = []
  re.lastIndex = 0
  let m = re.exec(text)
  while (m !== null) {
    const full = m[0]
    out.push([m.index, m.index + full.length])
    if (full.length === 0) re.lastIndex += 1
    m = re.exec(text)
  }
  return out
}

export function safeParseTweet(text: string): WeightedResult {
  try {
    if (typeof api.parseTweet === 'function') {
      const r = api.parseTweet(text)
      if (r && typeof r.weightedLength === 'number') return r
    }
  } catch {
    /* use fallback */
  }
  const weightedLength = fallbackWeightedLength(text)
  return { weightedLength, valid: weightedLength <= 280, permillage: Math.ceil((weightedLength / 280) * 1000) }
}

export function safeExtractHashtags(text: string): HashtagHit[] {
  try {
    if (typeof api.extractHashtagsWithIndices === 'function') {
      const r = api.extractHashtagsWithIndices(text)
      if (Array.isArray(r)) return r
    }
  } catch {
    /* use fallback */
  }
  return indicesOf(text, HASHTAG_RE).map(([s, e]) => ({
    hashtag: text.slice(s + 1, e),
    indices: [s, e] as [number, number],
  }))
}

export function safeExtractMentions(text: string): MentionHit[] {
  try {
    if (typeof api.extractMentionsWithIndices === 'function') {
      const r = api.extractMentionsWithIndices(text)
      if (Array.isArray(r)) return r
    }
  } catch {
    /* use fallback */
  }
  const out: MentionHit[] = []
  MENTION_RE.lastIndex = 0
  let m = MENTION_RE.exec(text)
  while (m !== null) {
    const at = m[2]
    const name = m[3]
    const start = m.index + m[1].length
    out.push({ screenName: name, indices: [start, start + at.length + name.length] })
    if (m[0].length === 0) MENTION_RE.lastIndex += 1
    m = MENTION_RE.exec(text)
  }
  return out
}

export function safeExtractUrls(text: string): UrlHit[] {
  try {
    if (typeof api.extractUrlsWithIndices === 'function') {
      const r = api.extractUrlsWithIndices(text)
      if (Array.isArray(r)) return r
    }
  } catch {
    /* use fallback */
  }
  return indicesOf(text, URL_RE).map(([s, e]) => ({ url: text.slice(s, e), indices: [s, e] as [number, number] }))
}
