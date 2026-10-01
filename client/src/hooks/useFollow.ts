import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { FollowUser, ProfileUser } from '../types'

interface FollowResponse {
  following: boolean
  followers_count: number
}

/** Shared optimistic follow/unfollow mutation. */
export function useFollowUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<FollowResponse>(`/users/${id}/follow`)
      return { id, ...res.data }
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['who-to-follow'] })
      queryClient.setQueryData<FollowUser[]>(['who-to-follow'], (old) =>
        old?.map((u) =>
          u.id === id
            ? {
                ...u,
                is_following: !u.is_following,
                followers_count: u.followers_count + (u.is_following ? -1 : 1),
              }
            : u,
        ),
      )
      queryClient.setQueriesData<ProfileUser>({ queryKey: ['profile'] }, (old) => {
        if (!old || old.id !== id) return old
        const following = !old.is_following
        return {
          ...old,
          is_following: following,
          followers_count: old.followers_count + (following ? 1 : -1),
        }
      })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['who-to-follow'] })
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
      void queryClient.invalidateQueries({ queryKey: ['user'] })
      void queryClient.invalidateQueries({ queryKey: ['users', 'who-to-follow'] })
      void queryClient.invalidateQueries({ queryKey: ['followers'] })
      void queryClient.invalidateQueries({ queryKey: ['following'] })
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      void queryClient.invalidateQueries({ queryKey: ['tweets', 'feed'] })
      void queryClient.invalidateQueries({ queryKey: ['feed'] })
    },
  })
}
