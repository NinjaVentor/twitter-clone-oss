import { useEffect, useRef, useState } from 'react'
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react'
import type { EmojiClickData } from 'emoji-picker-react'
import { CalendarClock } from 'lucide-react'
import {
  TwitterEmojiIcon,
  TwitterGifIcon,
  TwitterMediaIcon,
  TwitterPollIcon,
} from '../twitter-icons'
import { safeParseTweet } from '../../lib/twitterText'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { prependTweetsToFeed, patchTweetEverywhere, appendThreadReply } from '../../lib/feed-cache'
import { supabase } from '../../lib/supabase'
import { toast } from '../../store/toast'
import { useAuth } from '../../context/useAuth'
import { useOutsideClick } from '../../hooks/useDismiss'
import GifPickerModal from './GifPickerModal'
import ProgressRing from './ProgressRing'
import TweetMediaGrid from './TweetMediaGrid'
import type { Tweet } from '../../types'

interface Props {
  replyToId?: string
  quoteOfId?: string
  onPosted?: (tweet: Tweet) => void
  autoFocus?: boolean
  placeholder?: string
  compact?: boolean
}

const POLL_DURATIONS = [
  { label: '1 hour', minutes: 60 },
  { label: '6 hours', minutes: 360 },
  { label: '12 hours', minutes: 720 },
  { label: '1 day', minutes: 1440 },
  { label: '3 days', minutes: 4320 },
  { label: '7 days', minutes: 10080 },
]

function isVideo(url: string) {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)
}

export default function TweetComposer({
  replyToId,
  quoteOfId,
  onPosted,
  autoFocus,
  placeholder,
  compact,
}: Props) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [media, setMedia] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showPoll, setShowPoll] = useState(false)
  const [pollOptions, setPollOptions] = useState<string[]>(['', ''])
  const [pollDuration, setPollDuration] = useState(1440)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showGif, setShowGif] = useState(false)
  const emojiPopRef = useOutsideClick<HTMLDivElement>(showEmoji, () => setShowEmoji(false))
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const weighted = safeParseTweet(text).weightedLength
  const hasPoll = showPoll && pollOptions.filter((o) => o.trim()).length >= 2
  const canPost =
    !posting &&
    !uploading &&
    weighted <= 280 &&
    (text.trim().length > 0 || media.length > 0 || hasPoll)

  useEffect(() => {
    if (autoFocus) areaRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])

  const pickEmoji = (e: EmojiClickData) => {
    setText((t) => `${t}${e.emoji}`)
    areaRef.current?.focus()
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploadError(null)
    if (media.length + files.length > 4) {
      setUploadError('You can attach up to 4 photos or videos.')
      return
    }
    const list = Array.from(files)
    if (list.some((f) => f.type.startsWith('video/')) && (media.length > 0 || list.length > 1)) {
      setUploadError('A video must be posted on its own.')
      return
    }
    for (const f of list) {
      if (f.size > 15 * 1024 * 1024) {
        setUploadError(`"${f.name}" is over 15 MB.`)
        return
      }
    }
    setUploading(true)
    try {
      const urls: string[] = []
      for (const f of list) {
        const ext = f.name.split('.').pop() || 'bin'
        const path = `${user?.id ?? 'anon'}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { error: upErr } = await supabase.storage.from('media').upload(path, f, {
          cacheControl: '31536000',
          upsert: false,
        })
        if (upErr) throw new Error(upErr.message)
        const { data } = supabase.storage.from('media').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
      setMedia((m) => [...m, ...urls].slice(0, 4))
    } catch (e) {
      setUploadError(
        e instanceof Error
          ? `Upload failed: ${e.message} (the "media" storage bucket may not exist yet)`
          : 'Upload failed',
      )
    } finally {
      setUploading(false)
    }
  }

  const post = async () => {
    if (!canPost) return
    setPosting(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = { content: text.trim() }
      if (replyToId) payload.parent_id = replyToId
      if (quoteOfId) payload.quote_of_id = quoteOfId
      if (media.length > 0) payload.media_urls = media
      if (hasPoll) {
        payload.poll_data = {
          options: pollOptions.map((o) => o.trim()).filter(Boolean),
          duration_minutes: pollDuration,
        }
      }
      const res = await api.post<Tweet>('/tweets/', payload)
      const sent = res.data
      setText('')
      setMedia([])
      setPollOptions(['', ''])
      setShowPoll(false)
      setShowEmoji(false)
      // Immediate prepend into both feeds (+ profile tabs) so the tweet is
      // visible instantly, then refetch in the background for consistency.
      if (!replyToId) {
        prependTweetsToFeed(queryClient, [sent])
        queryClient.setQueriesData<{ pages: { tweets: Tweet[] }[] }>(
          { predicate: (q) => q.queryKey[0] === 'profile-tweets' },
          (old) => {
            if (!old || old.pages.length === 0) return old
            const [first, ...rest] = old.pages
            if (first.tweets.some((t) => t.id === sent.id)) return old
            return { ...old, pages: [{ ...first, tweets: [sent, ...first.tweets] }, ...rest] }
          },
        )
      }
      await queryClient.invalidateQueries({ queryKey: ['feed'] })
      if (replyToId) {
        // Replies never enter the top-level feed: bump the parent counter,
        // merge into cached thread replies, then refetch for consistency.
        patchTweetEverywhere(queryClient, replyToId, (t) => ({
          ...t,
          reply_count: t.reply_count + 1,
        }))
        appendThreadReply(queryClient, replyToId, sent)
        await queryClient.invalidateQueries({ queryKey: ['thread', replyToId] })
        await queryClient.invalidateQueries({ queryKey: ['tweet', replyToId] })
        toast('Your reply was sent.', {
          actionLabel: 'View',
          actionTo: `/status/${replyToId}`,
        })
      }
      if (!replyToId) {
        toast('Your Tweet was sent.', { actionLabel: 'View', actionTo: `/status/${sent.id}` })
      }
      onPosted?.(sent)
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } }).response?.data?.error ??
        (e instanceof Error ? e.message : 'Post failed')
      setError(msg)
      toast(msg, { tone: 'dark' })
    } finally {
      setPosting(false)
    }
  }

  const pickGif = (url: string) => {
    setShowGif(false)
    setShowPoll(false)
    setMedia((m) => (m.includes(url) ? m : [...m, url].slice(0, 4)))
  }

  return (
    <div className={compact ? '' : 'border-b border-[#2f3336] p-4'}>
      <div className="flex gap-3">
        {user?.avatar_url ? (
          <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#333639] font-bold">
            {(user?.display_name || '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <textarea
            ref={areaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canPost) void post()
            }}
            rows={1}
            placeholder={placeholder ?? (replyToId ? 'Tweet your reply' : "What's happening?")}
            className="max-h-[50vh] w-full resize-none overflow-hidden bg-transparent text-[20px] outline-none placeholder:text-[#71767b]"
          />

          {media.length > 0 && (
            <div className="relative mt-2">
              <TweetMediaGrid urls={media} />
              <div className="pointer-events-none absolute inset-0" />
              <div className="absolute right-2 top-2 flex gap-1.5">
                {media.map((u) => (
                  <button
                    key={u}
                    type="button"
                    aria-label="Remove media"
                    onClick={() => setMedia((m) => m.filter((x) => x !== u))}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-sm font-bold hover:bg-black"
                  >
                    ✕
                  </button>
                ))}
              </div>
            </div>
          )}

          {showPoll && (
            <div className="mt-2 rounded-2xl border border-[#2f3336] p-3">
              {pollOptions.map((opt, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <input
                    value={opt}
                    onChange={(e) =>
                      setPollOptions((arr) => arr.map((v, j) => (j === i ? e.target.value : v)))
                    }
                    placeholder={`Choice ${i + 1}`}
                    maxLength={60}
                    className="w-full rounded border border-[#333639] bg-transparent px-3 py-2 text-[15px] outline-none focus:border-[#1d9bf0]"
                  />
                  {pollOptions.length > 2 && (
                    <button
                      type="button"
                      aria-label="Remove choice"
                      onClick={() => setPollOptions((arr) => arr.filter((_, j) => j !== i))}
                      className="text-[#71767b] hover:text-white"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between">
                {pollOptions.length < 4 ? (
                  <button
                    type="button"
                    onClick={() => setPollOptions((arr) => [...arr, ''])}
                    className="text-[15px] text-[#1d9bf0] hover:underline"
                  >
                    + Add a choice
                  </button>
                ) : (
                  <span />
                )}
                <label className="flex items-center gap-2 text-[14px] text-[#71767b]">
                  <CalendarClock className="h-4 w-4" />
                  <select
                    value={pollDuration}
                    onChange={(e) => setPollDuration(Number(e.target.value))}
                    className="bg-black text-white outline-none"
                  >
                    {POLL_DURATIONS.map((d) => (
                      <option key={d.minutes} value={d.minutes}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}

          {(uploadError || error) && (
            <p className="mt-2 text-sm text-red-500">{uploadError ?? error}</p>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-[#2f3336] pt-2">
            <div className="flex items-center">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void uploadFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                title="Media"
                onClick={() => fileRef.current?.click()}
                disabled={showPoll || uploading}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#1d9bf0] transition hover:bg-[#1d9bf01a] disabled:opacity-40"
              >
                <TwitterMediaIcon className="h-[18px] w-[18px]" />
              </button>
              <button
                type="button"
                title="GIF"
                onClick={() => setShowGif(true)}
                disabled={showPoll || uploading || media.length >= 4}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#1d9bf0] transition hover:bg-[#1d9bf01a] disabled:opacity-40"
              >
                <TwitterGifIcon className="h-[18px] w-[18px]" />
              </button>
              {showGif && (
                <GifPickerModal onPick={pickGif} onClose={() => setShowGif(false)} />
              )}
              <button
                type="button"
                title="Poll"
                onClick={() => setShowPoll((v) => !v)}
                disabled={media.length > 0}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#1d9bf01a] disabled:opacity-40 ${
                  showPoll ? 'text-[#1d9bf0]' : 'text-[#1d9bf0]'
                }`}
              >
                <TwitterPollIcon className="h-[18px] w-[18px]" />
              </button>
              <div ref={emojiPopRef} className="relative">
                <button
                  type="button"
                  title="Emoji"
                  onClick={() => setShowEmoji((v) => !v)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#1d9bf0] transition hover:bg-[#1d9bf01a]"
                >
                  <TwitterEmojiIcon className="h-[18px] w-[18px]" />
                </button>
                {showEmoji && (
                  <div className="absolute bottom-10 left-0 z-50">
                    <EmojiPicker
                      emojiStyle={EmojiStyle.TWITTER}
                      theme={Theme.DARK}
                      onEmojiClick={pickEmoji}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {(text.length > 0 || weighted > 259) && <ProgressRing weightedLength={weighted} />}
              {weighted > 0 && <span className="h-6 w-px bg-[#2f3336]" />}
              <button
                type="button"
                onClick={() => void post()}
                disabled={!canPost}
                className="rounded-full bg-[#1d9bf0] px-5 py-1.5 text-[15px] font-bold text-white transition hover:bg-[#1a8cd8] disabled:opacity-40"
              >
                {posting || uploading ? 'Tweeting…' : replyToId ? 'Reply' : 'Tweet'}
              </button>
            </div>
          </div>
          {media.length > 0 && (
            <p className="mt-1 text-[12px] text-[#71767b]">
              {media.some(isVideo) ? 'Video attached' : `${media.length} photo${media.length > 1 ? 's' : ''} attached`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
