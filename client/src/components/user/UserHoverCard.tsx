import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  FloatingPortal,
  safePolygon,
  useFloating,
  useHover,
  useInteractions,
} from '@floating-ui/react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../context/useAuth'
import { useFollowUser } from '../../hooks/useFollow'
import TwemojiText from '../common/TwemojiText'
import { VerifiedBadge } from '../tweet/VerifiedBadge'
import type { ProfileUser } from '../../types'

interface Props {
  username: string
  children: ReactNode
}

function FollowButton({ profile }: { profile: ProfileUser }) {
  const { user } = useAuth()
  const follow = useFollowUser()
  const [hover, setHover] = useState(false)
  if (user?.id === profile.id) return null
  return (
    <button
      type="button"
      disabled={follow.isPending}
      onMouseEnter={() => profile.is_following && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        e.stopPropagation()
        follow.mutate(profile.id)
      }}
      className={`shrink-0 rounded-full px-4 py-1.5 text-[14px] font-bold transition disabled:opacity-50 ${
        profile.is_following
          ? 'border border-[#536471] text-white hover:border-[#f4212e] hover:text-[#f4212e]'
          : 'bg-[#eff3f4] text-black hover:bg-[#d7dbdc]'
      }`}
    >
      {profile.is_following ? (hover ? 'Unfollow' : 'Following') : 'Follow'}
    </button>
  )
}

/** Twitter-style hover profile card (300ms open delay) around avatars/names/handles. */
export default function UserHoverCard({ username, children }: Props) {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
  })
  const hover = useHover(context, {
    handleClose: safePolygon(),
    delay: { open: 300, close: 100 },
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover])

  const { data: profile } = useQuery({
    queryKey: ['profile', username],
    queryFn: async () => {
      const res = await api.get<ProfileUser>(`/users/by-username/${username}`)
      return res.data
    },
    enabled: open,
    staleTime: 60_000,
  })

  return (
    <>
      <span
        ref={(node) => {
          // display:contents creates no box of its own, so anchor to the real
          // child node — otherwise floating-ui measures a zero rect and the
          // card lands at the viewport's top-left corner.
          refs.setReference((node?.firstElementChild as Element | null) ?? node)
        }}
        {...getReferenceProps()}
        className="contents"
      >
        {children}
      </span>
      {open && (
        <FloatingPortal>
          <div
            ref={(node) => {
              refs.setFloating(node)
            }}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-[300px] rounded-2xl border border-[#2f3336] bg-black p-4 shadow-[0_0_15px_rgba(255,255,255,0.2)]"
            onClick={(e) => e.stopPropagation()}
          >
            {!profile ? (
              <p className="animate-pulse py-4 text-center text-[14px] text-[#71767b]">
                Loading…
              </p>
            ) : (
              <>
                <div className="mb-3 flex items-start justify-between">
                  <Link to={`/profile/${profile.username}`}>
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="h-16 w-16 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#333639] text-2xl font-bold">
                        {(profile.display_name || '?').slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </Link>
                  <FollowButton profile={profile} />
                </div>
                <Link to={`/profile/${profile.username}`} className="hover:underline">
                  <p className="flex items-center gap-1 text-[17px] font-extrabold">
                    <TwemojiText text={profile.display_name} />
                    {profile.verified && <VerifiedBadge className="h-[18px] w-[18px]" />}
                  </p>
                </Link>
                <p className="text-[15px] text-[#71767b]">@{profile.username}</p>
                {profile.bio && (
                  <p className="mt-2 text-[15px]">
                    <TwemojiText text={profile.bio} />
                  </p>
                )}
                <p className="mt-2 flex gap-4 text-[14px] text-[#71767b]">
                  <span>
                    <strong className="text-white">{profile.following_count}</strong> Following
                  </span>
                  <span>
                    <strong className="text-white">{profile.followers_count}</strong>{' '}
                    {profile.followers_count === 1 ? 'Follower' : 'Followers'}
                  </span>
                </p>
              </>
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
