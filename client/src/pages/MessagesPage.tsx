import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react'
import type { EmojiClickData } from 'emoji-picker-react'
import Lightbox from 'yet-another-react-lightbox'
import 'yet-another-react-lightbox/styles.css'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Heart,
  ImagePlus,
  MailPlus,
  Search,
  Settings,
  Smile,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'
import { wsClient } from '../lib/ws'
import { timeAgo } from '../lib/time'
import { useOutsideClick } from '../hooks/useDismiss'
import { useAuth } from '../context/useAuth'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useUnreadStore } from '../store/unread'
import RichTweetText from '../components/tweet/RichTweetText'
import TwemojiText from '../components/common/TwemojiText'
import { isEmojiOnly } from '../lib/emoji'
import UserHoverCard from '../components/user/UserHoverCard'
import { VerifiedBadge } from '../components/tweet/VerifiedBadge'
import type {
  Conversation,
  FollowUser,
  Message,
  TypeaheadResult,
  UnreadCount,
  User,
} from '../types'

const REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '👍', '🔥']

function Avatar({ user, size = 'h-10 w-10' }: { user?: User; size?: string }) {
  if (user?.avatar_url) {
    return <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" className={`${size} shrink-0 rounded-full object-cover`} />
  }
  return (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-full bg-[#333639] font-bold`}>
      {(user?.display_name || '?').slice(0, 1).toUpperCase()}
    </div>
  )
}

function NewMessageModal({ onClose, onPick }: { onClose: () => void; onPick: (u: FollowUser) => void }) {
  const [q, setQ] = useState('')
  const { data } = useQuery({
    queryKey: ['typeahead', 'dm', q.trim()],
    queryFn: async () => {
      const res = await api.get<TypeaheadResult>('/search/typeahead', { params: { q: q.trim() } })
      return res.data.users
    },
    enabled: q.trim().length > 0,
    staleTime: 30_000,
  })
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#5b708366] p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[600px] overflow-hidden rounded-2xl bg-black text-[#e7e9ea]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-6 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
          >
            <X className="h-5 w-5" />
          </button>
          <h2 className="text-[20px] font-extrabold">New message</h2>
        </div>
        <div className="border-y border-[#2f3336] px-4 py-3">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-[#71767b]"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto pb-3">
          {(data ?? []).map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => onPick(u)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-[#080808]"
            >
              <Avatar user={u} size="h-10 w-10" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate text-[15px] font-bold">
                  <TwemojiText text={u.display_name} />
                  {u.verified && <VerifiedBadge className="h-4 w-4 shrink-0" />}
                </span>
                <span className="block truncate text-[14px] text-[#71767b]">@{u.username}</span>
              </span>
            </button>
          ))}
          {q.trim() && (data ?? []).length === 0 && (
            <p className="py-6 text-center text-[15px] text-[#71767b]">No people found.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function ThreadView({ userId, onBack }: { userId: string; onBack: () => void }) {
  const { user: me } = useAuth()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [pendingMedia, setPendingMedia] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [reactFor, setReactFor] = useState<string | null>(null)
  const [typing, setTyping] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const typingTimer = useRef<number | null>(null)
  const lastTypingSent = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const reactPopRef = useOutsideClick<HTMLDivElement>(reactFor != null, () => setReactFor(null))
  const emojiPopRef = useOutsideClick<HTMLDivElement>(showEmoji, () => setShowEmoji(false))

  const { data: convos } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await api.get<{ conversations: Conversation[] }>('/messages/conversations')
      return res.data.conversations
    },
    staleTime: 15_000,
  })
  const cachedPartner = convos?.find((c) => c.partner?.id === userId)?.partner
  const partner = cachedPartner

  const thread = useQuery({
    queryKey: ['conversation', userId],
    queryFn: async () => {
      const res = await api.get<{ messages: Message[] }>(`/messages/conversations/${userId}`)
      const messages = res.data.messages
      // Server just marked incoming as read — refresh sidebar badges.
      void api
        .get<UnreadCount>('/notifications/unread-count')
        .then((r) => useUnreadStore.getState().setCounts(r.data.unread_notifications, r.data.unread_messages))
        .catch(() => {})
      return { messages }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const messages = thread.data?.messages ?? []

  // Typing indicator from the partner.
  useEffect(() => {
    const unsub = wsClient.subscribe((msg) => {
      if (msg.type === 'DM_TYPING' && msg.sender_id === userId) {
        setTyping(true)
        if (typingTimer.current != null) window.clearTimeout(typingTimer.current)
        typingTimer.current = window.setTimeout(() => setTyping(false), 3000)
      }
    })
    return () => {
      unsub()
      if (typingTimer.current != null) window.clearTimeout(typingTimer.current)
    }
  }, [userId])

  // Auto-scroll to the latest message.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, typing])

  const sendMutation = useMutation({
    mutationFn: async (body: { content: string; media_url?: string }) => {
      const res = await api.post<Message>(`/messages/conversations/${userId}`, body)
      return res.data
    },
    onSuccess: (m) => {
      queryClient.setQueryData<{ messages: Message[] }>(['conversation', userId], (old) => {
        if (!old) return { messages: [m] }
        if (old.messages.some((x) => x.id === m.id)) return old
        return { messages: [...old.messages, m] }
      })
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  const send = () => {
    const content = draft.trim()
    if ((!content && !pendingMedia) || sendMutation.isPending) return
    sendMutation.mutate({ content, media_url: pendingMedia ?? undefined })
    setDraft('')
    setPendingMedia(null)
    setShowEmoji(false)
  }

  const onType = (v: string) => {
    setDraft(v)
    const now = Date.now()
    if (now - lastTypingSent.current > 3000) {
      lastTypingSent.current = now
      void api.post(`/messages/conversations/${userId}/typing`).catch(() => {})
    }
  }

  const attach = async (files: FileList | null) => {
    const f = files?.[0]
    if (!f || !f.type.startsWith('image/')) return
    setUploading(true)
    try {
      const ext = f.name.split('.').pop() || 'jpg'
      const path = `${me?.id ?? 'anon'}/dm-${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('media').upload(path, f, { upsert: false })
      if (error) throw error
      const { data } = supabase.storage.from('media').getPublicUrl(path)
      setPendingMedia(data.publicUrl)
    } catch {
      /* keep composer usable on upload failure */
    } finally {
      setUploading(false)
    }
  }

  const react = (messageId: string, reaction: string) => {
    setReactFor(null)
    void api
      .post<Message>(`/messages/${messageId}/react`, { reaction })
      .then((res) => {
        const updated = res.data
        queryClient.setQueryData<{ messages: Message[] }>(['conversation', userId], (old) => {
          if (!old) return old
          return { messages: old.messages.map((x) => (x.id === messageId ? updated : x)) }
        })
        void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      })
      .catch(() => {})
  }

  const deleteMessage = (messageId: string) => {
    if (!window.confirm('Delete this message? This cannot be undone.')) return
    queryClient.setQueryData<{ messages: Message[] }>(['conversation', userId], (old) => {
      if (!old) return old
      return { messages: old.messages.filter((x) => x.id !== messageId) }
    })
    void api
      .delete(`/messages/${messageId}`)
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
      .catch(() => queryClient.invalidateQueries({ queryKey: ['conversation', userId] }))
  }

  const pickEmoji = (e: EmojiClickData) => setDraft((d) => `${d}${e.emoji}`)

  const lastOwn = [...messages].reverse().find((m) => m.sender_id === me?.id)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-4 border-b border-[#2f3336] bg-black/65 px-4 py-2 backdrop-blur-md">
        <button
          type="button"
          aria-label="Back to conversations"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a] md:hidden"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {partner ? (
          <UserHoverCard username={partner.username}>
            <Link to={`/profile/${partner.username}`} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar user={partner} />
              <span className="min-w-0">
                <span className="flex items-center gap-1 truncate text-[17px] font-extrabold hover:underline">
                  <TwemojiText text={partner.display_name} />
                  {partner.verified && <VerifiedBadge className="h-4 w-4 shrink-0" />}
                </span>
                <span className="block truncate text-[13px] text-[#71767b]">@{partner.username}</span>
              </span>
            </Link>
          </UserHoverCard>
        ) : (
          <p className="text-[17px] font-extrabold">New message</p>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {partner && (
          <Link
            to={`/profile/${partner.username}`}
            className="mx-auto mb-6 block max-w-[320px] rounded-2xl border border-[#2f3336] p-4 text-center transition hover:bg-[#080808]"
          >
            <div className="mx-auto mb-2 w-fit">
              <Avatar user={partner} size="h-16 w-16" />
            </div>
            <p className="flex items-center justify-center gap-1 text-[17px] font-extrabold">
              <TwemojiText text={partner.display_name} />
              {partner.verified && <VerifiedBadge className="h-4 w-4" />}
            </p>
            <p className="text-[15px] text-[#71767b]">@{partner.username}</p>
            {partner.bio && (
              <p className="mt-1 text-[14px]">
                <TwemojiText text={partner.bio} />
              </p>
            )}
            <p className="mt-1 text-[14px] text-[#71767b]">
              {partner.followers_count} Followers · {partner.following_count} Following
            </p>
          </Link>
        )}

        {thread.isLoading ? (
          <p className="animate-pulse py-8 text-center text-[15px] text-[#71767b]">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-[15px] text-[#71767b]">
            Say hi — messages you send will show up here.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === me?.id
            return (
              <div key={m.id} className={`group mb-1.5 flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`relative max-w-[75%] ${mine ? 'items-end' : 'items-start'}`}>
                  <div className="relative">
                    {m.media_url && (
                      <button type="button" onClick={() => setLightbox(m.media_url)} className="mb-1 block">
                        <img
                          src={m.media_url}
                          alt=""
                          className="max-h-64 rounded-2xl border border-[#2f3336] object-cover"
                        />
                      </button>
                    )}
                    {m.content && !m.media_url && isEmojiOnly(m.content) ? (
                      <div className="break-words px-1 py-1 text-[36px] leading-snug">
                        <TwemojiText text={m.content} imgClassName="twemoji-jumbo" />
                      </div>
                    ) : (
                      m.content && (
                        <div
                          className={`break-words px-4 py-2.5 text-[15px] leading-normal ${
                            mine
                              ? 'rounded-2xl rounded-br-md bg-[#1d9bf0] text-white'
                              : 'rounded-2xl rounded-bl-md bg-[#2f3336] text-[#e7e9ea]'
                          }`}
                        >
                          <RichTweetText text={m.content} />
                        </div>
                      )
                    )}
                    {m.reaction && (
                      <span
                        className={`absolute -bottom-2.5 inline-flex items-center gap-1 rounded-full border border-black bg-[#2f3336] px-2 py-px text-[13px] leading-none ${
                          mine ? 'left-1' : 'right-1'
                        } shadow`}
                      >
                        <TwemojiText text={m.reaction} imgClassName="twemoji-rxn" />
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="React"
                    title="React"
                    onClick={() => setReactFor(reactFor === m.id ? null : m.id)}
                    className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-black p-1.5 opacity-0 shadow-[0_0_10px_rgba(255,255,255,0.25)] transition group-hover:opacity-100 ${
                      mine ? '-left-9' : '-right-9'
                    }`}
                  >
                    <Heart className="h-4 w-4" color="#f91880" />
                  </button>
                  {mine && (
                    <button
                      type="button"
                      aria-label="Delete message"
                      title="Delete message"
                      onClick={() => deleteMessage(m.id)}
                      className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-black p-1.5 opacity-0 shadow-[0_0_10px_rgba(255,255,255,0.25)] transition group-hover:opacity-100 ${
                        mine ? '-left-16' : '-right-16'
                      }`}
                    >
                      <Trash2 className="h-4 w-4" color="#f4212e" />
                    </button>
                  )}
                  {reactFor === m.id && (
                    <div
                      ref={reactPopRef}
                      className={`absolute top-full z-40 mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#16181c] border border-[#2f3336] shadow-lg h-11 ${
                        mine ? 'right-0' : 'left-0'
                      }`}
                    >
                      {REACTIONS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => react(m.id, r)}
                          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 hover:scale-125 transition-transform text-[22px] leading-none"
                        >
                          <TwemojiText text={r} imgClassName="twemoji-rxn-lg" />
                        </button>
                      ))}
                    </div>
                  )}
                  <p
                    className={`${m.reaction ? 'mt-3.5' : 'mt-1'} flex items-center gap-1 text-[11px] text-[#71767b] ${
                      mine ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {timeAgo(m.created_at)}
                    {mine && lastOwn?.is_read && m.id === lastOwn.id && (
                      <>
                        <span aria-hidden="true">•</span>
                        <Check className="h-3 w-3" color="#1d9bf0" /> Seen
                      </>
                    )}
                  </p>
                </div>
              </div>
            )
          })
        )}
        {typing && (
          <p className="py-1 text-[14px] text-[#1d9bf0]">
            @{partner?.username ?? 'them'} is typing…
          </p>
        )}
      </div>

      <div className="border-t border-[#2f3336] p-3">
        {pendingMedia && (
          <div className="relative mb-2 w-fit">
            <img src={pendingMedia} alt="" className="h-20 rounded-xl border border-[#2f3336] object-cover" />
            <button
              type="button"
              aria-label="Remove attachment"
              onClick={() => setPendingMedia(null)}
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#333639] text-xs"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-1 rounded-2xl bg-[#202327] px-2 py-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void attach(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            aria-label="Attach image"
            title="Attach image"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#1d9bf0] transition hover:bg-[#1d9bf01a] disabled:opacity-40"
          >
            <ImagePlus className="h-5 w-5" />
          </button>
          <input
            value={draft}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Start a new message"
            className="max-h-32 min-w-0 flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-[#71767b]"
          />
          <div ref={emojiPopRef} className="relative shrink-0">
            <button
              type="button"
              aria-label="Emoji"
              title="Emoji"
              onClick={() => setShowEmoji((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#1d9bf0] transition hover:bg-[#1d9bf01a]"
            >
              <Smile className="h-5 w-5" />
            </button>
            {showEmoji && (
              <div className="absolute bottom-11 right-0 z-50">
                <EmojiPicker
                  emojiStyle={EmojiStyle.TWITTER}
                  theme={Theme.DARK}
                  onEmojiClick={pickEmoji}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={send}
            disabled={(!draft.trim() && !pendingMedia) || sendMutation.isPending || uploading}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#1d9bf0] transition hover:bg-[#1d9bf01a] disabled:opacity-40"
          >
            <span className="text-xl">➤</span>
          </button>
        </div>
      </div>
      <Lightbox open={lightbox != null} close={() => setLightbox(null)} slides={lightbox ? [{ src: lightbox }] : []} />
    </div>
  )
}

export default function MessagesPage() {
  useDocumentTitle('Messages')
  const [params, setParams] = useSearchParams()
  const activeUserId = params.get('user')
  const [filter, setFilter] = useState('')
  const [newOpen, setNewOpen] = useState(false)

  const { data: conversations, isLoading: convosLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const res = await api.get<{ conversations: Conversation[] }>('/messages/conversations')
      return res.data.conversations
    },
    staleTime: 15_000,
  })
  const list = conversations ?? []
  const needle = filter.trim().toLowerCase()
  const visible = needle
    ? list.filter((c) =>
        `${c.partner?.display_name ?? ''} @${c.partner?.username ?? ''}`.toLowerCase().includes(needle),
      )
    : list

  const openThread = (userId: string) => setParams({ user: userId })

  return (
    <div className="flex h-svh min-h-[600px]">
      <div
        className={`${activeUserId ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-[#2f3336] md:w-[320px] md:shrink-0`}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-[20px] font-extrabold">Messages</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Settings"
              title="Settings"
              className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
            >
              <Settings className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="New message"
              title="New message"
              onClick={() => setNewOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
            >
              <MailPlus className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="px-3 pb-2">
          <label className="flex items-center gap-2 rounded-full border border-transparent bg-[#202327] px-3.5 py-2 focus-within:border-[#1d9bf0] focus-within:bg-black">
            <Search className="h-4 w-4 shrink-0 text-[#71767b]" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search Direct Messages"
              className="w-full bg-transparent text-[14px] outline-none placeholder:text-[#71767b]"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {convosLoading ? (
            <div aria-hidden="true">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2.5">
                  <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-[#2f3336]" />
                  <span className="min-w-0 flex-1">
                    <span className="block h-3 w-2/5 animate-pulse rounded bg-[#2f3336]" />
                    <span className="mt-1.5 block h-3 w-3/5 animate-pulse rounded bg-[#2f3336]" />
                  </span>
                  <span className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-[#2f3336]" />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="px-8 py-12 text-center">
              <p className="text-[20px] font-extrabold">No messages yet</p>
              <p className="mt-1 text-[14px] text-[#71767b]">
                Start a conversation from someone&apos;s profile.
              </p>
            </div>
          ) : (
            visible.map((c) => (
              <button
                key={c.partner?.id ?? c.last_message?.id}
                type="button"
                onClick={() => c.partner && openThread(c.partner.id)}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-[#080808] ${
                  activeUserId === c.partner?.id ? 'bg-[#080808]' : ''
                }`}
              >
                <span className="relative shrink-0">
                  <Avatar user={c.partner} size="h-9 w-9" />
                  {c.unread_count > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-black bg-[#1d9bf0]" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1">
                    <span className="truncate text-[14px] font-bold">
                      <TwemojiText text={c.partner?.display_name ?? ''} />
                    </span>
                    <span className="truncate text-[13px] text-[#71767b]">@{c.partner?.username}</span>
                    {c.last_message && (
                      <span className="shrink-0 text-[12px] text-[#71767b]">
                        · {timeAgo(c.last_message.created_at)}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[13px] text-[#71767b]">
                    {c.last_message?.sender_id && c.last_message.sender_id !== c.partner?.id
                      ? 'You: '
                      : ''}
                    {c.last_message?.media_url && !c.last_message.content
                      ? '📷 Photo'
                      : c.last_message?.content}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#71767b]" />
              </button>
            ))
          )}
        </div>
      </div>

      <div className={`${activeUserId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {activeUserId ? (
          <ThreadView key={activeUserId} userId={activeUserId} onBack={() => setParams({})} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="text-[31px] font-extrabold">Select a message</p>
            <p className="max-w-[320px] text-[15px] text-[#71767b]">
              Choose from your existing conversations, or start a new one.
            </p>
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="mt-2 rounded-full bg-[#1d9bf0] px-6 py-2 font-bold text-white transition hover:bg-[#1a8cd8]"
            >
              New message
            </button>
          </div>
        )}
      </div>

      {newOpen && (
        <NewMessageModal
          onClose={() => setNewOpen(false)}
          onPick={(u) => {
            setNewOpen(false)
            setParams({ user: u.id })
          }}
        />
      )}
    </div>
  )
}
