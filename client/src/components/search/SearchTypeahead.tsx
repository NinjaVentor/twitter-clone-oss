import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import TwemojiText from '../common/TwemojiText'
import { VerifiedBadge } from '../tweet/VerifiedBadge'
import type { TypeaheadResult } from '../../types'

interface Props {
  query: string
  onNavigate?: () => void
}

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/** Live search dropdown: top hashtags + users, 200ms debounced. */
export default function SearchTypeahead({ query, onNavigate }: Props) {
  const navigate = useNavigate()
  const debounced = useDebounced(query.trim(), 200)

  const { data } = useQuery({
    queryKey: ['typeahead', debounced],
    queryFn: async () => {
      const res = await api.get<TypeaheadResult>('/search/typeahead', {
        params: { q: debounced },
      })
      return res.data
    },
    enabled: debounced.length > 0,
    staleTime: 30_000,
  })

  if (!debounced || !data) return null
  if (data.hashtags.length === 0 && data.users.length === 0) {
    return (
      <div className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-2xl bg-black py-2 shadow-[0_0_15px_rgba(255,255,255,0.2)]">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            navigate(`/explore?q=${encodeURIComponent(query.trim())}`)
            onNavigate?.()
          }}
          className="w-full px-4 py-3 text-left text-[15px] hover:bg-[#e7e9ea1a]"
        >
          Search for <strong>“{query.trim()}”</strong>
        </button>
      </div>
    )
  }

  const go = (to: string) => {
    navigate(to)
    onNavigate?.()
  }

  return (
    <div className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-2xl bg-black py-2 shadow-[0_0_15px_rgba(255,255,255,0.2)]">
      {data.hashtags.map((h) => (
        <button
          key={h.tag}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => go(`/explore?q=${encodeURIComponent(h.tag)}&tab=top`)}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#e7e9ea1a]"
        >
          <span className="text-[#71767b]">⌕</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-bold">{h.tag}</span>
            <span className="block text-[13px] text-[#71767b]">
                {h.count.toLocaleString()} Tweet{h.count === 1 ? '' : 's'}
            </span>
          </span>
        </button>
      ))}
      {data.users.map((u) => (
        <button
          key={u.id}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => go(`/profile/${u.username}`)}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#e7e9ea1a]"
        >
          {u.avatar_url ? (
            <img src={u.avatar_url} alt="" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#333639] font-bold">
              {(u.display_name || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 truncate text-[15px] font-bold">
              <TwemojiText text={u.display_name} />
              {u.verified && <VerifiedBadge className="h-4 w-4 shrink-0" />}
            </span>
            <span className="block truncate text-[13px] text-[#71767b]">@{u.username}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
