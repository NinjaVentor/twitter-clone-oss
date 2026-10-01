import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { api } from '../../lib/api'
import { useFollowUser } from '../../hooks/useFollow'
import TwemojiText from '../common/TwemojiText'
import UserHoverCard from './UserHoverCard'
import { VerifiedBadge } from '../tweet/VerifiedBadge'
import type { FollowUser } from '../../types'

interface Props {
  userId: string
  mode: 'followers' | 'following'
  onClose: () => void
}

function Row({ u, onNavigate }: { u: FollowUser; onNavigate: () => void }) {
  const follow = useFollowUser()
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition hover:bg-[#080808]">
      <UserHoverCard username={u.username}>
        <Link to={`/profile/${u.username}`} onClick={onNavigate} className="shrink-0">
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
            onClick={onNavigate}
            className="flex items-center gap-1 truncate text-[15px] font-bold hover:underline"
          >
            <TwemojiText text={u.display_name} />
            {u.verified && <VerifiedBadge className="h-4 w-4 shrink-0" />}
          </Link>
        </UserHoverCard>
        <p className="truncate text-[14px] text-[#71767b]">@{u.username}</p>
        {u.bio && (
          <p className="truncate text-[14px] text-[#e7e9ea]">
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
  )
}

export default function FollowListModal({ userId, mode, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['follow-list', userId, mode],
    queryFn: async () => {
      const res = await api.get<{ users: FollowUser[] }>(`/users/${userId}/${mode}`, {
        params: { limit: 50 },
      })
      return res.data.users
    },
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#5b708366] p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-[600px] overflow-hidden rounded-2xl bg-black text-[#e7e9ea]"
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
          <h2 className="text-[20px] font-extrabold">
            {mode === 'followers' ? 'Followers' : 'Following'}
          </h2>
        </div>
        <div className="overflow-y-auto pb-4">
          {isLoading ? (
            <p className="animate-pulse py-8 text-center text-[15px] text-[#71767b]">Loading…</p>
          ) : !data || data.length === 0 ? (
            <p className="py-8 text-center text-[15px] text-[#71767b]">
              {mode === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
            </p>
          ) : (
            data.map((u) => <Row key={u.id} u={u} onNavigate={onClose} />)
          )}
        </div>
      </div>
    </div>
  )
}
