import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import { api } from '../../lib/api'
import type { PollData, Tweet } from '../../types'

interface Props {
  tweet: Tweet
}

function patchPoll(queryClient: ReturnType<typeof useQueryClient>, id: string, poll: PollData, vote: number) {
  for (const key of [['feed', 'foryou'], ['feed', 'following']] as const) {
    queryClient.setQueryData<{ pages: { tweets: Tweet[] }[] }>(key, (old) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          tweets: p.tweets.map((t) =>
            t.id === id ? { ...t, poll_data: poll, my_poll_vote: vote } : t,
          ),
        })),
      }
    })
  }
  queryClient.setQueryData<{ tweet: Tweet }>(['thread', id], (old) => {
    if (!old) return old
    return { ...old, tweet: { ...old.tweet, poll_data: poll, my_poll_vote: vote } }
  })
}

export default function PollView({ tweet }: Props) {
  const queryClient = useQueryClient()
  const [voting, setVoting] = useState(false)
  const poll = tweet.poll_data
  const mutation = useMutation({
    mutationFn: async (optionIndex: number) => {
      const res = await api.post<{ poll_data: PollData; my_poll_vote: number }>(
        `/tweets/${tweet.id}/poll/vote`,
        { option_index: optionIndex },
      )
      return res.data
    },
    onSuccess: (data) => patchPoll(queryClient, tweet.id, data.poll_data, data.my_poll_vote),
    onSettled: () => setVoting(false),
  })

  if (!poll || poll.options.length === 0) return null
  const total = poll.options.reduce((a, o) => a + o.votes, 0)
  const voted = tweet.my_poll_vote != null
  // Wall-clock read once per render is intentional for expiry display.
  // eslint-disable-next-line react/purity
  const ended = poll.ends_at ? new Date(poll.ends_at).getTime() < Date.now() : false
  const showResults = voted || ended
  const remaining = poll.ends_at
    ? formatDistanceToNowStrict(new Date(poll.ends_at), { addSuffix: false })
    : null

  return (
    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
      {poll.options.map((opt, i) => {
        const pct = total > 0 ? Math.round((opt.votes / total) * 100) : 0
        if (!showResults) {
          return (
            <button
              key={i}
              type="button"
              disabled={voting}
              onClick={() => {
                setVoting(true)
                mutation.mutate(i)
              }}
              className="mb-1.5 w-full rounded-full border border-[#536471] px-4 py-1.5 text-left text-[15px] font-bold text-[#1d9bf0] transition hover:bg-[#1d9bf01a] disabled:opacity-50"
            >
              {opt.text}
            </button>
          )
        }
        return (
          <div key={i} className="relative mb-1.5 overflow-hidden rounded-md bg-[#2f3336]">
            <div className="absolute inset-y-0 left-0 bg-[#333639]" style={{ width: `${pct}%` }} />
            <div className="relative flex items-center justify-between px-3 py-1.5 text-[15px]">
              <span className="font-bold">
                {opt.text} {tweet.my_poll_vote === i && '✓'}
              </span>
              <span className="text-[#71767b]">{pct}%</span>
            </div>
          </div>
        )
      })}
      <p className="text-[13px] text-[#71767b]">
        {total} vote{total === 1 ? '' : 's'}
        {remaining && !ended ? ` · ${remaining} left` : ''}
        {ended ? ' · Final results' : ''}
      </p>
    </div>
  )
}
