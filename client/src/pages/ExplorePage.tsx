import { Link, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { api } from '../lib/api'
import { useFollowUser } from '../hooks/useFollow'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useViewBatching } from '../hooks/useFeed'
import SearchBox from '../components/search/SearchBox'
import TweetCard from '../components/tweet/TweetCard'
import UserHoverCard from '../components/user/UserHoverCard'
import TwemojiText from '../components/common/TwemojiText'
import { VerifiedBadge } from '../components/tweet/VerifiedBadge'
import type { FeedResponse, FollowUser, SearchTab, Trend } from '../types'

const SEARCH_TABS: { key: SearchTab; label: string }[] = [
  { key: 'top', label: 'Top' },
  { key: 'latest', label: 'Latest' },
  { key: 'people', label: 'People' },
  { key: 'media', label: 'Media' },
]

function PeopleResults({ q }: { q: string }) {
  const follow = useFollowUser()
  const { data, isLoading } = useQuery({
    queryKey: ['search-people', q],
    queryFn: async () => {
      const res = await api.get<{ users: FollowUser[] }>('/search', {
        params: { q, tab: 'people' },
      })
      return res.data.users
    },
  })
  if (isLoading) return <p className="py-12 text-center text-[15px] text-[#71767b]">Searching people…</p>
  if (!data || data.length === 0) {
    return (
      <div className="px-8 py-16 text-center">
        <p className="text-[31px] font-extrabold">No people found for “{q}”</p>
        <p className="mt-2 text-[15px] text-[#71767b]">Try a different name or username.</p>
      </div>
    )
  }
  return (
    <div>
      {data.map((u) => (
        <div key={u.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-[#080808]">
          <UserHoverCard username={u.username}>
            <Link to={`/profile/${u.username}`} className="shrink-0">
              {u.avatar_url ? (
                <img src={u.avatar_url} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#333639] font-bold">
                  {(u.display_name || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
            </Link>
          </UserHoverCard>
          <div className="min-w-0 flex-1">
            <UserHoverCard username={u.username}>
              <Link
                to={`/profile/${u.username}`}
                className="flex items-center gap-1 truncate text-[15px] font-bold hover:underline"
              >
                <TwemojiText text={u.display_name} />
                {u.verified && <VerifiedBadge className="h-4 w-4 shrink-0" />}
              </Link>
            </UserHoverCard>
            <p className="truncate text-[14px] text-[#71767b]">@{u.username}</p>
            {u.bio && (
              <p className="truncate text-[14px]">
                <TwemojiText text={u.bio} />
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={follow.isPending}
            onClick={() => follow.mutate(u.id)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-[14px] font-bold transition disabled:opacity-50 ${
              u.is_following
                ? 'border border-[#536471] text-white hover:border-[#f4212e] hover:text-[#f4212e]'
                : 'bg-[#eff3f4] text-black hover:bg-[#d7dbdc]'
            }`}
          >
            {u.is_following ? 'Following' : 'Follow'}
          </button>
        </div>
      ))}
    </div>
  )
}

function TweetResults({ q, tab }: { q: string; tab: SearchTab }) {
  const search = useInfiniteQuery({
    queryKey: ['search-tweets', q, tab],
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const res = await api.get<FeedResponse>('/search', {
        params: { q, tab, limit: 20, ...(pageParam ? { cursor: pageParam } : {}) },
      })
      return res.data
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  })
  const tweets = search.data?.pages.flatMap((p) => p.tweets) ?? []
  if (search.isLoading) {
    return <p className="py-12 text-center text-[15px] text-[#71767b]">Searching…</p>
  }
  if (tweets.length === 0) {
    return (
      <div className="px-8 py-16 text-center">
        <p className="text-[31px] font-extrabold">No results for “{q}”</p>
        <p className="mt-2 text-[15px] text-[#71767b]">Try a different hashtag or keyword.</p>
      </div>
    )
  }
  return (
    <div>
      {tweets.map((t) => (
        <div key={t.id} data-tweet-id={t.id}>
          <TweetCard tweet={t} />
        </div>
      ))}
      {search.hasNextPage && (
        <button
          type="button"
          disabled={search.isFetchingNextPage}
          onClick={() => void search.fetchNextPage()}
          className="mx-auto my-4 block rounded-full border border-[#536471] px-6 py-2 text-[15px] font-bold transition hover:bg-[#e7e9ea1a] disabled:opacity-50"
        >
          {search.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  )
}

export default function ExplorePage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const tab = (params.get('tab') as SearchTab) || 'top'
  useDocumentTitle('Explore')
  const listRef = useViewBatching(true)

  const { data: trends } = useQuery({
    queryKey: ['trends'],
    queryFn: async () => {
      const res = await api.get<{ trends: Trend[] }>('/trends')
      return res.data.trends
    },
    staleTime: 60_000,
  })

  const setTab = (t: SearchTab) => setParams({ q, tab: t })

  return (
    <div ref={listRef}>
      <div className="sticky top-0 z-10 flex items-center gap-4 bg-black/65 px-4 py-2 backdrop-blur-md">
        <Link
          to="/home"
          aria-label="Back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-[#e7e9ea1a]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <SearchBox
          key={q}
          initial={q}
          formClassName="flex-1"
          onSubmit={(v) => setParams({ q: v, tab: 'top' })}
        />
      </div>

      {!q ? (
        <div>
          <p className="px-4 pb-1 pt-3 text-[20px] font-extrabold">Trends for you</p>
          {!trends || trends.length === 0 ? (
            <p className="px-4 py-6 text-[15px] text-[#71767b]">
              No trends yet — Tweet with a #hashtag to start one.
            </p>
          ) : (
            trends.map((t, i) => (
              <Link
                key={t.tag}
                to={`/explore?q=${encodeURIComponent(t.tag)}&tab=top`}
                className="block px-4 py-3 transition hover:bg-[#080808]"
              >
                <p className="text-[13px] text-[#71767b]">{i + 1} · Trending</p>
                <p className="text-[15px] font-bold">{t.tag}</p>
                <p className="text-[13px] text-[#71767b]">
                  {t.count.toLocaleString()} Tweet{t.count === 1 ? '' : 's'}
                </p>
              </Link>
            ))
          )}
        </div>
      ) : (
        <div>
          <div className="flex border-b border-[#2f3336]">
            {SEARCH_TABS.map((t) => (
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
          {tab === 'people' ? (
            <PeopleResults q={q} />
          ) : (
            <TweetResults q={q} tab={tab} />
          )}
        </div>
      )}
    </div>
  )
}
