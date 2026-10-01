import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { formatCount, patchTweetEverywhere, removeTweetFromLists } from '../../lib/feed-cache'
import { toast } from '../../store/toast'
import { useComposerStore } from '../../store/composer'
import { useOutsideClick } from '../../hooks/useDismiss'
import {
  TwitterBookmarkActionIcon,
  TwitterLikeIcon,
  TwitterReplyIcon,
  TwitterRetweetIcon,
  TwitterShareIcon,
  TwitterViewsIcon,
} from '../twitter-icons'
import type { Tweet } from '../../types'

interface Props {
  tweet: Tweet
  /** Pure-repost wrapper id to keep in sync when patching the original. */
  wrapperId?: string
  /** Called after a successful unbookmark (e.g. bookmarks page removes the card). */
  onUnbookmarked?: (id: string) => void
}

/** 5-button action bar: Reply / Retweet+Quote / Like / Views / Bookmark+Share. */
export default function TweetActions({ tweet, wrapperId, onUnbookmarked }: Props) {
  const queryClient = useQueryClient()
  const openReply = useComposerStore((s) => s.openReply)
  const openQuote = useComposerStore((s) => s.openQuote)
  const [rtOpen, setRtOpen] = useState(false)
  const [likePop, setLikePop] = useState(false)
  const rtPopRef = useOutsideClick<HTMLSpanElement>(rtOpen, () => setRtOpen(false))

  const doPatch = (patch: Partial<Tweet>) => {
    patchTweetEverywhere(queryClient, tweet.id, patch)
    if (wrapperId) patchTweetEverywhere(queryClient, wrapperId, patch)
  }

  const toggleLike = async () => {
    const next = !tweet.liked_by_me
    setLikePop(next)
    doPatch({ liked_by_me: next, like_count: tweet.like_count + (next ? 1 : -1) })
    try {
      const res = await api.post<{ liked: boolean; like_count: number }>(
        `/tweets/${tweet.id}/like`,
      )
      doPatch({ liked_by_me: res.data.liked, like_count: res.data.like_count })
    } catch {
      doPatch({ liked_by_me: tweet.liked_by_me, like_count: tweet.like_count })
    } finally {
      window.setTimeout(() => setLikePop(false), 300)
    }
  }

  const toggleRetweet = async () => {
    const next = !tweet.retweeted_by_me
    doPatch({ retweeted_by_me: next, retweet_count: tweet.retweet_count + (next ? 1 : -1) })
    try {
      const res = await api.post<{ retweeted: boolean; retweet_count: number }>(
        `/tweets/${tweet.id}/retweet`,
      )
      doPatch({ retweeted_by_me: res.data.retweeted, retweet_count: res.data.retweet_count })
      await queryClient.invalidateQueries({ queryKey: ['feed'] })
    } catch {
      doPatch({ retweeted_by_me: tweet.retweeted_by_me, retweet_count: tweet.retweet_count })
    }
  }

  const toggleBookmark = async () => {
    const next = !tweet.bookmarked_by_me
    doPatch({ bookmarked_by_me: next, bookmark_count: tweet.bookmark_count + (next ? 1 : -1) })
    try {
      const res = await api.post<{ bookmarked: boolean; bookmark_count: number }>(
        `/tweets/${tweet.id}/bookmark`,
      )
      doPatch({ bookmarked_by_me: res.data.bookmarked, bookmark_count: res.data.bookmark_count })
      toast(
        res.data.bookmarked ? 'Added to your Bookmarks' : 'Removed from your Bookmarks',
        { tone: 'dark' },
      )
      if (!res.data.bookmarked) {
        removeTweetFromLists(queryClient, tweet.id)
        onUnbookmarked?.(tweet.id)
      }
    } catch {
      doPatch({ bookmarked_by_me: tweet.bookmarked_by_me, bookmark_count: tweet.bookmark_count })
    }
  }

  const copyLink = () => {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}/status/${tweet.id}`)
      .then(
        () => toast('Copied to clipboard', { tone: 'dark' }),
        () => toast('Copy failed', { tone: 'dark' }),
      )
  }

  return (
    <div
      className="mt-1 flex max-w-[425px] items-center justify-between"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Reply"
        title="Reply"
        onClick={() => openReply(tweet)}
        className="group flex items-center gap-1 text-[#71767b] transition hover:text-[#1d9bf0]"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full transition group-hover:bg-[#1d9bf01a]">
          <TwitterReplyIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="text-[13px]">{tweet.reply_count > 0 ? formatCount(tweet.reply_count) : ''}</span>
      </button>

      <span ref={rtPopRef} className="relative">
        <button
          type="button"
          aria-label="Retweet"
          title="Retweet"
          onClick={() => setRtOpen((v) => !v)}
          className={`group flex items-center gap-1 transition ${
            tweet.retweeted_by_me ? 'text-[#00ba7c]' : 'text-[#71767b] hover:text-[#00ba7c]'
          }`}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full transition group-hover:bg-[#00ba7c1a]">
            <TwitterRetweetIcon active={tweet.retweeted_by_me} className="h-5 w-5" />
          </span>
          <span className="text-[13px]">
            {tweet.retweet_count > 0 ? formatCount(tweet.retweet_count) : ''}
          </span>
        </button>
        {rtOpen && (
          <div className="absolute bottom-9 left-0 z-30 w-[180px] overflow-hidden rounded-2xl bg-black py-2 shadow-[0_0_15px_rgba(255,255,255,0.25)]">
            <button
              type="button"
              onClick={() => {
                setRtOpen(false)
                void toggleRetweet()
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold hover:bg-[#e7e9ea1a]"
            >
              <TwitterRetweetIcon active={tweet.retweeted_by_me} className="h-4 w-4" /> {tweet.retweeted_by_me ? 'Undo Retweet' : 'Retweet'}
            </button>
            <button
              type="button"
              onClick={() => {
                setRtOpen(false)
                openQuote(tweet)
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-[15px] font-bold hover:bg-[#e7e9ea1a]"
            >
              ✍️ Quote Tweet
            </button>
          </div>
        )}
      </span>

      <button
        type="button"
        aria-label="Like"
        title="Like"
        onClick={() => void toggleLike()}
        className={`group flex items-center gap-1 transition ${
          tweet.liked_by_me ? 'text-[#f91880]' : 'text-[#71767b] hover:text-[#f91880]'
        }`}
      >
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full transition group-hover:bg-[#f918801a] ${
            likePop ? 'scale-125' : ''
          }`}
        >
          <TwitterLikeIcon filled={tweet.liked_by_me} className="h-[18px] w-[18px] transition-transform" />
        </span>
        <span className="text-[13px]">{tweet.like_count > 0 ? formatCount(tweet.like_count) : ''}</span>
      </button>

      <span className="group flex cursor-default items-center gap-1 text-[#71767b]" title="Views">
        <span className="flex h-8 w-8 items-center justify-center rounded-full">
          <TwitterViewsIcon className="h-[18px] w-[18px]" />
        </span>
        <span className="text-[13px]">{tweet.view_count > 0 ? formatCount(tweet.view_count) : ''}</span>
      </span>

      <span className="flex items-center">
        <button
          type="button"
          aria-label="Bookmark"
          title="Bookmark"
          onClick={() => void toggleBookmark()}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
            tweet.bookmarked_by_me
              ? 'text-[#1d9bf0]'
              : 'text-[#71767b] hover:bg-[#1d9bf01a] hover:text-[#1d9bf0]'
          }`}
        >
          <TwitterBookmarkActionIcon filled={tweet.bookmarked_by_me} className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          aria-label="Share"
          title="Copy link to Tweet"
          onClick={copyLink}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[#71767b] transition hover:bg-[#1d9bf01a] hover:text-[#1d9bf0]"
        >
          <TwitterShareIcon className="h-[18px] w-[18px]" />
        </button>
      </span>
    </div>
  )
}
