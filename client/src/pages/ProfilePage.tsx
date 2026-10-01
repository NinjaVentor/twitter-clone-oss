import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, ExternalLink, Link2, MapPin, Pin } from 'lucide-react'
import Lightbox from 'yet-another-react-lightbox'
import 'yet-another-react-lightbox/styles.css'
import { format } from 'date-fns'
import { api } from '../lib/api'
import { formatCount } from '../lib/feed-cache'
import { useAuth } from '../context/useAuth'
import { useFollowUser } from '../hooks/useFollow'
import { useViewBatching } from '../hooks/useFeed'
import EditProfileModal from '../components/user/EditProfileModal'
import FollowListModal from '../components/user/FollowListModal'
import UserHoverCard from '../components/user/UserHoverCard'
import RichTweetText from '../components/tweet/RichTweetText'
import TweetCard from '../components/tweet/TweetCard'
import { TwitterMessagesIcon } from '../components/twitter-icons'
import { VerifiedBadge } from '../components/tweet/VerifiedBadge'
import TwemojiText from '../components/common/TwemojiText'
import type { FeedResponse, ProfileUser } from '../types'

type ProfileTab = 'posts' | 'replies' | 'media' | 'likes'

const TABS: { key: ProfileTab; label: string }[] = [
  { key: 'posts', label: 'Tweets' },
  { key: 'replies', label: 'Replies' },
  { key: 'media', label: 'Media' },
  { key: 'likes', label: 'Likes' },
]

function websiteHref(raw: string) {
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://${raw}`
}

export default function ProfilePage() {
  const { username } = useParams<{ username: string }>()
  const navigate = useNavigate()
  const { user: me } = useAuth()
  const follow = useFollowUser()
  const [tab, setTab] = useState<ProfileTab>('posts')
  const [editing, setEditing] = useState(false)
  const [followMode, setFollowMode] = useState<'followers' | 'following' | null>(null)
  const [hoverUnfollow, setHoverUnfollow] = useState(false)
  const [lightbox, setLightbox] = useState<'avatar' | 'banner' | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ['profile', username],
    queryFn: async () => {
      const res = await api.get<ProfileUser>(`/users/by-username/${username}`)
      return res.data
    },
    enabled: !!username,
  })

  const tweetsQuery = useInfiniteQuery({
    queryKey: ['profile-tweets', username, tab],
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const res = await api.get<FeedResponse>(`/users/${profile!.id}/tweets`, {
        params: { tab, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
      })
      return res.data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!profile,
  })

  const listRef = useViewBatching(!!profile && !tweetsQuery.isLoading)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          tweetsQuery.hasNextPage &&
          !tweetsQuery.isFetchingNextPage
        ) {
          void tweetsQuery.fetchNextPage()
        }
      },
      { rootMargin: '600px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [tweetsQuery])

  useEffect(() => {
    if (profile) {
      document.title = `${profile.display_name} (@${profile.username}) / Twitter`
      return () => {
        document.title = "Twitter. It's what's happening"
      }
    }
  }, [profile])

  if (isLoading) {
    return <p className="animate-pulse py-16 text-center text-[15px] text-[#71767b]">Loading profile…</p>
  }
  if (isError || !profile) {
    return (
      <div className="flex flex-col items-center gap-3 px-8 py-20 text-center">
        <p className="text-[31px] font-extrabold">This account doesn&apos;t exist</p>
        <p className="text-[15px] text-[#71767b]">Try searching for another.</p>
        <button
          type="button"
          onClick={() => navigate('/home')}
          className="mt-2 rounded-full bg-[#1d9bf0] px-6 py-2 font-bold text-white"
        >
          Back home
        </button>
      </div>
    )
  }

  const isSelf = me?.id === profile.id
  const tweets = tweetsQuery.data?.pages.flatMap((p) => p.tweets) ?? []
  const pinned = tab === 'posts' ? profile.pinned_tweet : undefined
  const visibleTweets = pinned ? tweets.filter((t) => t.id !== pinned.id) : tweets
  const slides = [
    ...(profile.banner_url ? [{ src: profile.banner_url }] : []),
    ...(profile.avatar_url ? [{ src: profile.avatar_url }] : []),
  ]
  const lightboxIndex =
    lightbox == null ? -1 : lightbox === 'banner' ? 0 : profile.banner_url ? 1 : 0

  return (
    <div ref={listRef}>
      <div className="sticky top-0 z-10 flex items-center gap-6 bg-black/65 px-4 py-2 backdrop-blur-md">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <h1 className="flex items-center gap-1 truncate text-[20px] font-extrabold">
            <TwemojiText text={profile.display_name} />
            {profile.verified && <VerifiedBadge className="h-[18px] w-[18px] shrink-0" />}
          </h1>
          <p className="text-[13px] text-[#71767b]">
            {profile.tweets_count} Tweet{profile.tweets_count === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {profile.banner_url ? (
        <button type="button" onClick={() => setLightbox('banner')} className="block w-full">
          <img src={profile.banner_url} alt="" referrerPolicy="no-referrer" className="aspect-[3/1] w-full object-cover" />
        </button>
      ) : (
        <div className="aspect-[3/1] w-full bg-[#333639]" />
      )}

      <div className="border-b border-[#2f3336] px-4 pb-4">
        <div className="-mt-[67px] mb-3 flex items-end justify-between">
          {profile.avatar_url ? (
            <button type="button" onClick={() => setLightbox('avatar')}>
              <img
                src={profile.avatar_url}
                alt=""
                referrerPolicy="no-referrer"
                className="h-[134px] w-[134px] rounded-full border-4 border-black object-cover"
              />
            </button>
          ) : (
            <div className="flex h-[134px] w-[134px] items-center justify-center rounded-full border-4 border-black bg-[#333639] text-5xl font-bold">
              {(profile.display_name || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="flex items-center gap-2 pb-1">
            {isSelf ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-full border border-[#536471] px-4 py-1.5 text-[15px] font-bold transition hover:bg-[#e7e9ea1a]"
              >
                Edit profile
              </button>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="Message"
                  title="Message"
                  onClick={() => navigate(`/messages?user=${profile.id}`)}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[#536471] transition hover:bg-[#e7e9ea1a]"
                >
                  <TwitterMessagesIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={follow.isPending}
                  onMouseEnter={() => profile.is_following && setHoverUnfollow(true)}
                  onMouseLeave={() => setHoverUnfollow(false)}
                  onClick={() => follow.mutate(profile.id)}
                  className={`rounded-full px-4 py-1.5 text-[15px] font-bold transition disabled:opacity-50 ${
                    profile.is_following
                      ? 'border border-[#536471] text-white hover:border-[#f4212e] hover:text-[#f4212e]'
                      : 'bg-[#eff3f4] text-black hover:bg-[#d7dbdc]'
                  }`}
                >
                  {profile.is_following ? (hoverUnfollow ? 'Unfollow' : 'Following') : 'Follow'}
                </button>
              </>
            )}
          </div>
        </div>

        <p className="flex items-center gap-1 text-[20px] font-extrabold">
          <TwemojiText text={profile.display_name} />
          {profile.verified && <VerifiedBadge className="h-5 w-5 shrink-0" />}
        </p>
        <p className="flex items-center gap-2 text-[15px] text-[#71767b]">
          @{profile.username}
          {profile.is_followed_by && (
            <span className="rounded bg-[#2f3336] px-1.5 py-0.5 text-[12px]">Follows you</span>
          )}
        </p>

        {profile.bio && (
          <p className="mt-2 whitespace-pre-wrap break-words text-[15px]">
            <RichTweetText text={profile.bio} />
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[15px] text-[#71767b]">
          {profile.location && (
            <span className="flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              <TwemojiText text={profile.location} />
            </span>
          )}
          {profile.website && (
            <a
              href={websiteHref(profile.website)}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex items-center gap-1 text-[#1d9bf0] hover:underline"
            >
              <Link2 className="h-4 w-4" />
              {profile.website.replace(/^https?:\/\//i, '')}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <span className="flex items-center gap-1">
            <CalendarDays className="h-4 w-4" />
            Joined {format(new Date(profile.created_at), 'MMMM yyyy')}
          </span>
        </div>

        <div className="mt-2 flex gap-5 text-[15px]">
          <button type="button" onClick={() => setFollowMode('following')} className="hover:underline">
            <strong>{formatCount(profile.following_count)}</strong>{' '}
            <span className="text-[#71767b]">Following</span>
          </button>
          <button type="button" onClick={() => setFollowMode('followers')} className="hover:underline">
            <strong>{formatCount(profile.followers_count)}</strong>{' '}
            <span className="text-[#71767b]">
              {profile.followers_count === 1 ? 'Follower' : 'Followers'}
            </span>
          </button>
        </div>
      </div>

      <div className="sticky top-[53px] z-10 flex border-b border-[#2f3336] bg-black/65 backdrop-blur-md">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="relative flex-1 py-4 text-[15px] transition hover:bg-[#e7e9ea08]"
          >
            <span className={tab === t.key ? 'font-bold' : 'text-[#71767b]'}>{t.label}</span>
            {tab === t.key && (
              <span className="absolute bottom-0 left-1/2 h-1 w-14 -translate-x-1/2 rounded-full bg-[#1d9bf0]" />
            )}
          </button>
        ))}
      </div>

      {pinned && (
        <div>
          <p className="flex items-center gap-2 px-4 pb-1 pt-3 text-[13px] font-bold text-[#71767b]">
            <Pin className="h-4 w-4" /> Pinned
          </p>
          <div data-tweet-id={pinned.id}>
            <TweetCard tweet={pinned} pinnedId={profile.pinned_tweet_id} />
          </div>
        </div>
      )}

      {tweetsQuery.isLoading ? (
        <p className="animate-pulse py-12 text-center text-[15px] text-[#71767b]">Loading Tweets…</p>
      ) : visibleTweets.length === 0 && !pinned ? (
        <div className="px-8 py-16 text-center">
          <p className="text-[31px] font-extrabold">
            {tab === 'posts' && `@${profile.username} hasn't Tweeted yet`}
            {tab === 'replies' && 'No replies yet'}
            {tab === 'media' && 'No media yet'}
            {tab === 'likes' && 'No likes yet'}
          </p>
          <p className="mt-2 text-[15px] text-[#71767b]">
            {tab === 'likes' ? 'Liked Tweets will show up here.' : 'Tweets will show up here.'}
          </p>
        </div>
      ) : (
        visibleTweets.map((t) => (
          <div key={t.id} data-tweet-id={t.id}>
            {tab === 'replies' && t.parent_id && (
              <div className="block px-4 pb-1 pt-3 text-[13px] text-[#71767b]">
                Replying to{' '}
                {t.parent_tweet?.author ? (
                  <UserHoverCard username={t.parent_tweet.author.username}>
                    <Link
                      to={`/status/${t.parent_id}`}
                      className="text-[#1d9bf0] hover:underline"
                    >
                      @{t.parent_tweet.author.username}
                    </Link>
                  </UserHoverCard>
                ) : (
                  <Link
                    to={`/status/${t.parent_id}`}
                    className="text-[#1d9bf0] hover:underline"
                  >
                    the original post
                  </Link>
                )}
              </div>
            )}
            <TweetCard tweet={t} pinnedId={profile.pinned_tweet_id} />
          </div>
        ))
      )}
      <div ref={sentinelRef} className="py-6 text-center text-[14px] text-[#71767b]">
        {tweetsQuery.isFetchingNextPage ? 'Loading more…' : ''}
      </div>

      {editing && <EditProfileModal onClose={() => setEditing(false)} />}
      {followMode && (
        <FollowListModal userId={profile.id} mode={followMode} onClose={() => setFollowMode(null)} />
      )}
      <Lightbox
        open={lightboxIndex >= 0 && slides.length > 0}
        index={Math.max(lightboxIndex, 0)}
        close={() => setLightbox(null)}
        slides={slides}
      />
    </div>
  )
}
