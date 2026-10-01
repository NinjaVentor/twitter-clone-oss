import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { format } from 'date-fns'
import { api } from '../lib/api'
import TweetCard from '../components/tweet/TweetCard'
import { VerifiedBadge } from '../components/tweet/VerifiedBadge'
import TweetActions from '../components/tweet/TweetActions'
import TweetComposer from '../components/tweet/TweetComposer'
import TweetMediaGrid from '../components/tweet/TweetMediaGrid'
import PollView from '../components/tweet/PollView'
import RichTweetText from '../components/tweet/RichTweetText'
import TwemojiText from '../components/common/TwemojiText'
import { useViewBatching } from '../hooks/useFeed'
import type { ThreadResponse } from '../types'
import { formatCount } from '../lib/feed-cache'

export default function StatusPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['thread', id],
    queryFn: async () => {
      const res = await api.get<ThreadResponse>(`/tweets/${id}`)
      return res.data
    },
    enabled: !!id,
  })
  const viewRef = useViewBatching(!!data)

  // Opening a thread counts as viewing the focal tweet (dwell signal).
  useEffect(() => {
    if (!data?.tweet?.id) return
    const t = window.setTimeout(() => {
      void api.post('/tweets/views', { tweet_ids: [data.tweet.id] }).catch(() => {})
    }, 1500)
    return () => window.clearTimeout(t)
  }, [data?.tweet?.id])

  useEffect(() => {
    if (data?.tweet?.author) {
      document.title = `${data.tweet.author.display_name} on Twitter: "${data.tweet.content.slice(0, 60)}" / Twitter`
      return () => {
        document.title = "Twitter. It's what's happening"
      }
    }
  }, [data?.tweet?.author, data?.tweet?.content])

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <p className="animate-pulse text-[15px] text-[#71767b]">Loading Tweet…</p>
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="flex flex-col items-center gap-4 px-8 py-20 text-center">
        <p className="text-[#71767b] text-[15px] text-center">
          Hmm...this page doesn&apos;t exist. Try searching for something else.
        </p>
        <button
          type="button"
          onClick={() => navigate('/explore')}
          className="bg-[#1d9bf0] hover:bg-[#1a8cd8] text-white font-bold px-5 py-2.5 rounded-full transition"
        >
          Search
        </button>
      </div>
    )
  }

  const t = data.tweet
  const author = t.author

  return (
    <div ref={viewRef}>
      <div className="sticky top-0 z-10 flex items-center gap-6 bg-black/65 px-4 py-2 backdrop-blur-md">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[20px] font-extrabold">Tweet</h1>
      </div>

      {data.ancestors.map((a) => (
        <div key={a.id} data-tweet-id={a.id}>
          <TweetCard tweet={a} threadLine />
        </div>
      ))}

      {/* Focal tweet */}
      <article className="border-b border-[#2f3336] px-4 pt-3" data-tweet-id={t.id}>
        <div className="flex items-center gap-3">
          <Link to={author ? `/profile/${author.username}` : '#'} onClick={(e) => e.stopPropagation()}>
            {author?.avatar_url ? (
              <img src={author.avatar_url} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#333639] font-bold">
                {(author?.display_name || '?').slice(0, 1).toUpperCase()}
              </div>
            )}
          </Link>
          <div className="min-w-0">
            <p className="flex items-center gap-1 truncate text-[15px] font-bold">
              <TwemojiText text={author?.display_name ?? ''} />
              {author?.verified && <VerifiedBadge className="h-[18px] w-[18px] shrink-0" />}
            </p>
            <p className="truncate text-[15px] text-[#71767b]">@{author?.username}</p>
          </div>
        </div>

        {t.content && (
          <p className="mt-3 whitespace-pre-wrap break-words text-[17px] leading-snug">
            <RichTweetText text={t.content} />
          </p>
        )}
        {t.media_urls?.length > 0 && (
          <div className="mt-3">
            <TweetMediaGrid urls={t.media_urls} />
          </div>
        )}
        {t.poll_data && <PollView tweet={t} />}

        <p className="mt-3 border-b border-[#2f3336] pb-3 text-[15px] text-[#71767b]">
          {format(new Date(t.created_at), 'h:mm a · MMM d, yyyy')}
        </p>
        <p className="flex flex-wrap gap-x-5 gap-y-1 border-b border-[#2f3336] py-3 text-[15px] text-[#71767b]">
          <span>
            <strong className="text-white">{formatCount(t.reply_count)}</strong> Replies
          </span>
          <span>
            <strong className="text-white">{formatCount(t.retweet_count)}</strong> Retweets
          </span>
          <span>
            <strong className="text-white">{formatCount(t.quote_count)}</strong> Quotes
          </span>
          <span>
            <strong className="text-white">{formatCount(t.like_count)}</strong> Likes
          </span>
          <span>
            <strong className="text-white">{formatCount(t.bookmark_count)}</strong> Bookmarks
          </span>
          <span>
            <strong className="text-white">{formatCount(t.view_count)}</strong> Views
          </span>
        </p>
        <div className="border-b border-[#2f3336] py-1">
          <TweetActions tweet={t} />
        </div>
      </article>

      <TweetComposer
        replyToId={t.id}
        compact
          placeholder="Tweet your reply"
        onPosted={() => void refetch()}
      />

      <div>
        {data.replies.map((r) => (
          <div key={r.id} data-tweet-id={r.id}>
            <TweetCard tweet={r} />
          </div>
        ))}
        {data.replies.length === 0 && (
          <p className="px-4 py-8 text-center text-[15px] text-[#71767b]">
            No replies yet. Be the first to reply.
          </p>
        )}
      </div>
    </div>
  )
}
