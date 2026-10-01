import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import SearchBox from '../search/SearchBox'
import TwemojiText from '../common/TwemojiText'
import UserHoverCard from '../user/UserHoverCard'
import { VerifiedBadge } from '../tweet/VerifiedBadge'
import type { FollowUser, Trend } from '../../types'

export default function RightSidebar() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [hoverUnfollow, setHoverUnfollow] = useState<string | null>(null)

  const { data: trends } = useQuery({
    queryKey: ['trends'],
    queryFn: async () => {
      const res = await api.get<{ trends: Trend[] }>('/trends')
      return res.data.trends
    },
    staleTime: 60_000,
  })

  const { data: suggestions } = useQuery({
    queryKey: ['who-to-follow'],
    queryFn: async () => {
      const res = await api.get<{ users: FollowUser[] }>('/users/who-to-follow')
      return res.data.users
    },
    staleTime: 60_000,
  })

  const followMutation = useMutation({
    mutationFn: async ({ id, following }: { id: string; following: boolean }) => {
      const res = await api.post<{ following: boolean; followers_count: number }>(
        `/users/${id}/follow`,
      )
      return { id, following: res.data.following, prev: following }
    },
    onMutate: async ({ id, following }) => {
      await queryClient.cancelQueries({ queryKey: ['who-to-follow'] })
      const prev = queryClient.getQueryData<FollowUser[]>(['who-to-follow'])
      queryClient.setQueryData<FollowUser[]>(['who-to-follow'], (old) =>
        old?.map((u) =>
          u.id === id
            ? {
                ...u,
                is_following: !following,
                followers_count: u.followers_count + (following ? -1 : 1),
              }
            : u,
        ),
      )
      return { prev }
    },
    onError: (_e, _v, context) => {
      if (context?.prev) queryClient.setQueryData(['who-to-follow'], context.prev)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['who-to-follow'] })
    },
  })

  const submitSearch = (v: string) => {
    navigate(`/explore?q=${encodeURIComponent(v)}&tab=top`)
  }

  return (
    <aside className="ml-7 hidden w-[350px] shrink-0 py-2 lg:block">
      <div className="sticky top-0 z-10 bg-black pb-2 pt-1">
        <SearchBox onSubmit={submitSearch} />
      </div>

      <div className="mb-4 overflow-hidden rounded-2xl bg-[#16181c]">
        <p className="px-4 pb-2 pt-3 text-[20px] font-extrabold">What&apos;s happening</p>
        {!trends || trends.length === 0 ? (
          <p className="px-4 pb-4 text-[15px] text-[#71767b]">
            No trends yet — Tweet with a #hashtag to start one.
          </p>
        ) : (
          trends.map((t) => (
            <Link
              key={t.tag}
              to={`/explore?q=${encodeURIComponent(t.tag)}`}
              className="block px-4 py-2.5 transition hover:bg-[#e7e9ea08]"
            >
              <p className="text-[13px] text-[#71767b]">Trending</p>
              <p className="text-[15px] font-bold">{t.tag}</p>
              <p className="text-[13px] text-[#71767b]">
                {t.count.toLocaleString()} Tweet{t.count === 1 ? '' : 's'}
              </p>
            </Link>
          ))
        )}
      </div>

      <div className="mb-4 overflow-hidden rounded-2xl bg-[#16181c]">
        <p className="px-4 pb-2 pt-3 text-[20px] font-extrabold">Who to follow</p>
        {!suggestions || suggestions.length === 0 ? (
          <p className="px-4 pb-4 text-[15px] text-[#71767b]">
            You&apos;re following everyone worth following. 🎉
          </p>
        ) : (
          suggestions.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-[#e7e9ea08]"
            >
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
              <UserHoverCard username={u.username}>
                <Link to={`/profile/${u.username}`} className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-[15px] font-bold hover:underline">
                    <TwemojiText text={u.display_name} />
                    {u.verified && <VerifiedBadge className="h-4 w-4 shrink-0" />}
                  </p>
                  <p className="truncate text-[14px] text-[#71767b]">@{u.username}</p>
                </Link>
              </UserHoverCard>
              <button
                type="button"
                disabled={followMutation.isPending}
                onMouseEnter={() => u.is_following && setHoverUnfollow(u.id)}
                onMouseLeave={() => setHoverUnfollow(null)}
                onClick={() => followMutation.mutate({ id: u.id, following: u.is_following })}
                className={`shrink-0 rounded-full px-4 py-1.5 text-[14px] font-bold transition disabled:opacity-50 ${
                  u.is_following
                    ? 'border border-[#536471] text-white hover:border-[#f4212e] hover:text-[#f4212e]'
                    : 'bg-[#eff3f4] text-black hover:bg-[#d7dbdc]'
                }`}
              >
                {u.is_following
                  ? hoverUnfollow === u.id
                    ? 'Unfollow'
                    : 'Following'
                  : 'Follow'}
              </button>
            </div>
          ))
        )}
      </div>

      <nav className="flex flex-wrap gap-x-3 px-4 py-3 text-[13px] text-[#71767b]">
        <Link to="/tos" className="hover:underline">
          Terms of Service
        </Link>
        <Link to="/privacy" className="hover:underline">
          Privacy Policy
        </Link>
        <Link to="/cookies" className="hover:underline">
          Cookie Policy
        </Link>
        <Link to="/tos#accessibility" className="hover:underline">
          Accessibility
        </Link>
        <Link to="/privacy#ads" className="hover:underline">
          Ads info
        </Link>
        <span>© Twitter, Inc.</span>
      </nav>
    </aside>
  )
}
