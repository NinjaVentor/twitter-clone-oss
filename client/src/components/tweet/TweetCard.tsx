import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  BarChart2,
  Link2,
  MoreHorizontal,
  Pin,
  PinOff,
  Repeat2,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { api } from '../../lib/api'
import { removeTweetEverywhere } from '../../lib/feed-cache'
import { timeAgo } from '../../lib/time'
import { useAuth } from '../../context/useAuth'
import { useOutsideClick } from '../../hooks/useDismiss'
import type { Tweet } from '../../types'
import PollView from './PollView'
import RichTweetText from './RichTweetText'
import TweetActions from './TweetActions'
import TweetMediaGrid from './TweetMediaGrid'
import TwemojiText from '../common/TwemojiText'
import UserHoverCard from '../user/UserHoverCard'
import { VerifiedBadge } from './VerifiedBadge'

interface Props {
  tweet: Tweet
  hideActions?: boolean
  /** Vertical connector below the avatar (ancestor chain in thread view). */
  threadLine?: boolean
  /** Pinned tweet id of the profile being viewed (enables Unpin label). */
  pinnedId?: string | null
  /** Called after a successful unbookmark. */
  onUnbookmarked?: (id: string) => void
}

export default function TweetCard({ tweet: initial, hideActions, threadLine, pinnedId, onUnbookmarked }: Props) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuPopRef = useOutsideClick<HTMLSpanElement>(menuOpen, () => setMenuOpen(false))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [followingAuthor, setFollowingAuthor] = useState<boolean | null>(null)

  // The displayed tweet is a pure repost wrapper: show the original with banner.
  const isRepost = !!initial.reposted_tweet
  const tweet = isRepost ? { ...initial.reposted_tweet!, reposted_by: initial.reposted_by } : initial
  const author = tweet.author
  const isOwner = !!author && !!user && author.id === user.id

  const deleteTweet = async () => {
    setMenuOpen(false)
    setConfirmDelete(true)
  }

  const confirmDeleteTweet = async () => {
    setConfirmDelete(false)
    try {
      await api.delete(`/tweets/${tweet.id}`)
      removeTweetEverywhere(queryClient, tweet.id)
      await queryClient.invalidateQueries({ queryKey: ['feed'] })
      await queryClient.invalidateQueries({ queryKey: ['thread'] })
      await queryClient.invalidateQueries({ queryKey: ['profile-tweets'] })
      if (window.location.pathname.startsWith('/status/')) navigate('/home')
    } catch {
      /* menu already closed */
    }
  }

  const copyLink = () => {
    setMenuOpen(false)
    void navigator.clipboard?.writeText(`${window.location.origin}/status/${tweet.id}`)
  }

  const toggleFollowAuthor = async () => {
    if (!author) return
    setMenuOpen(false)
    const next = !(followingAuthor ?? false)
    setFollowingAuthor(next)
    try {
      const res = await api.post<{ following: boolean }>(`/users/${author.id}/follow`)
      setFollowingAuthor(res.data.following)
    } catch {
      setFollowingAuthor(!next)
    }
  }

  const togglePin = async () => {
    setMenuOpen(false)
    try {
      await api.post(`/tweets/${tweet.id}/pin`)
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      await queryClient.invalidateQueries({ queryKey: ['profile-tweets'] })
    } catch {
      /* best effort */
    }
  }

  const open = () => navigate(`/status/${tweet.id}`)

  return (
    <article
      onClick={open}
      className="cursor-pointer border-b border-[#2f3336] px-4 pb-2 pt-3 transition hover:bg-[#080808]"
    >
      {isRepost && initial.reposted_by && (
        <p className="mb-1 ml-8 flex items-center gap-2 text-[13px] font-bold text-[#71767b]">
          <Repeat2 className="h-4 w-4" />
          {initial.reposted_by.display_name} Retweeted
        </p>
      )}
      <div className="flex gap-3">
        <div className="relative shrink-0">
          {author ? (
            <UserHoverCard username={author.username}>
              <Link to={`/profile/${author.username}`} onClick={(e) => e.stopPropagation()}>
                {author?.avatar_url ? (
                  <img src={author.avatar_url} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover hover:opacity-90" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#333639] font-bold">
                    {(author?.display_name || '?').slice(0, 1).toUpperCase()}
                  </div>
                )}
              </Link>
            </UserHoverCard>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#333639] font-bold">
              ?
            </div>
          )}
          {threadLine && (
            <span aria-hidden="true" className="absolute bottom-[-14px] left-1/2 top-11 w-0.5 -translate-x-1/2 bg-[#333639]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[15px]">
            {author ? (
              <UserHoverCard username={author.username}>
                <Link
                  to={`/profile/${author.username}`}
                  onClick={(e) => e.stopPropagation()}
                  className="truncate font-bold hover:underline"
                >
                  <TwemojiText text={author?.display_name ?? 'Unknown'} />
                </Link>
              </UserHoverCard>
            ) : (
              <span className="truncate font-bold">Unknown</span>
            )}
            {author?.verified && <VerifiedBadge className="h-[18px] w-[18px] shrink-0" />}
            <span className="truncate text-[#71767b]">@{author?.username}</span>
            <span className="shrink-0 text-[#71767b]">· {timeAgo(tweet.created_at)}</span>
            <span ref={menuPopRef} className="relative ml-auto">
              <button
                type="button"
                aria-label="More"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen((v) => !v)
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[#71767b] transition hover:bg-[#1d9bf01a] hover:text-[#1d9bf0]"
              >
                <MoreHorizontal className="h-[18px] w-[18px]" />
              </button>
              {menuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-8 z-30 w-[220px] overflow-hidden rounded-2xl bg-black py-2 shadow-[0_0_15px_rgba(255,255,255,0.25)]"
                >
                  <button
                    type="button"
                    onClick={copyLink}
                    className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold hover:bg-[#e7e9ea1a]"
                  >
                    <Link2 className="h-4 w-4" /> Copy link
                  </button>
                  {isOwner && !isRepost && (
                    <button
                      type="button"
                      onClick={() => void togglePin()}
                      className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold hover:bg-[#e7e9ea1a]"
                    >
                      {pinnedId === tweet.id ? (
                        <>
                          <PinOff className="h-4 w-4" /> Unpin from profile
                        </>
                      ) : (
                        <>
                          <Pin className="h-4 w-4" /> Pin to profile
                        </>
                      )}
                    </button>
                  )}
                  {author && !isOwner && (
                    <button
                      type="button"
                      onClick={() => void toggleFollowAuthor()}
                      className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold hover:bg-[#e7e9ea1a]"
                    >
                      {followingAuthor ? (
                        <>
                          <UserMinus className="h-4 w-4" /> Unfollow @{author.username}
                        </>
                      ) : (
                        <>
                          <UserPlus className="h-4 w-4" /> Follow @{author.username}
                        </>
                      )}
                    </button>
                  )}
                  {!isOwner && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuOpen(false)
                        navigate(`/status/${tweet.id}`)
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold hover:bg-[#e7e9ea1a]"
                    >
                      <BarChart2 className="h-4 w-4" /> View Tweet activity
                    </button>
                  )}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => void deleteTweet()}
                      className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold text-[#f4212e] hover:bg-[#e7e9ea1a]"
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </button>
                  )}
                </div>
              )}
              {confirmDelete && (
                <div
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmDelete(false)
                  }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-[#5b708366] p-4"
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-[320px] rounded-2xl bg-black p-8 text-[#e7e9ea]"
                  >
                    <p className="text-[20px] font-extrabold">Delete Tweet?</p>
                    <p className="mt-2 text-[15px] text-[#71767b]">
                      This can&apos;t be undone and it will be removed from your profile, the
                      timeline of any accounts that follow you, and from Twitter search results.
                    </p>
                    <button
                      type="button"
                      onClick={() => void confirmDeleteTweet()}
                      className="mt-6 h-[44px] w-full rounded-full bg-[#f4212e] text-[15px] font-bold text-white transition hover:bg-[#ba172c]"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="mt-3 h-[44px] w-full rounded-full border border-[#536471] text-[15px] font-bold transition hover:bg-[#e7e9ea1a]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </span>
          </div>

          {tweet.content && (
            <p className="whitespace-pre-wrap break-words text-[15px] leading-normal">
              <RichTweetText text={tweet.content} />
            </p>
          )}

          {tweet.quoted_tweet && (
            <div
              onClick={(e) => {
                e.stopPropagation()
                navigate(`/status/${tweet.quoted_tweet!.id}`)
              }}
              className="mt-2 rounded-2xl border border-[#2f3336] p-3 hover:bg-[#080808]"
            >
              <div className="flex items-center gap-1 text-[15px]">
                <span className="truncate font-bold">
                  <TwemojiText text={tweet.quoted_tweet.author?.display_name ?? ''} />
                </span>
                {tweet.quoted_tweet.author?.verified && (
                  <VerifiedBadge className="h-4 w-4 shrink-0" />
                )}
                <span className="truncate text-[#71767b]">
                  @{tweet.quoted_tweet.author?.username} · {timeAgo(tweet.quoted_tweet.created_at)}
                </span>
              </div>
              {tweet.quoted_tweet.content && (
                <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px]">
                  <RichTweetText text={tweet.quoted_tweet.content} />
                </p>
              )}
              {tweet.quoted_tweet.media_urls?.length > 0 && (
                <div className="mt-2">
                  <TweetMediaGrid urls={tweet.quoted_tweet.media_urls} />
                </div>
              )}
            </div>
          )}

          {tweet.media_urls?.length > 0 && (
            <div className="mt-2">
              <TweetMediaGrid urls={tweet.media_urls} />
            </div>
          )}

          {tweet.poll_data && <PollView tweet={tweet} />}

          {!hideActions && (
            <TweetActions
              tweet={tweet}
              wrapperId={isRepost ? initial.id : undefined}
              onUnbookmarked={onUnbookmarked}
            />
          )}
        </div>
      </div>
    </article>
  )
}
