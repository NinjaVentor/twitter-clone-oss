import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { User } from '../types'
import { AuthContext, type AuthState } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const syncUser = useCallback(async () => {
    // Never hang the boot sequence: any auth step may stall when the
    // backend is unreachable, so race everything against a 3s timeout.
    const withTimeout = async <T,>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, reject) =>
          window.setTimeout(() => reject(new Error('auth timeout')), 3000),
        ),
      ])
    let s: Session | null = null
    try {
      const { data } = await withTimeout(supabase.auth.getSession())
      s = data.session
    } catch {
      s = null
    }
    setSession(s)
    if (!s) {
      setUser(null)
      setLoading(false)
      return
    }
    setSyncing(true)
    // Send the Supabase session identity in the body as well, so sync can
    // enrich sparse claims and never fail on missing JWT metadata. The
    // Google picture lives in several possible locations — check them all.
    const getFreshUser = async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getUser())
        return data.user ?? s.user ?? null
      } catch {
        return s.user ?? null
      }
    }
    const freshUser = await getFreshUser()
    const meta = (freshUser?.user_metadata ?? {}) as Record<string, unknown>
    const identities = (freshUser as unknown as { identities?: { identity_data?: Record<string, unknown> }[] } | null)?.identities ?? []
    const idData = identities[0]?.identity_data ?? {}
    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    const identity = {
      auth_id: freshUser?.id ?? '',
      email: freshUser?.email ?? '',
      full_name: str(meta['full_name'] ?? meta['name']),
      avatar_url:
        str(meta['avatar_url']) ||
        str(meta['picture']) ||
        str(idData['avatar_url']) ||
        str(idData['picture']),
    }
    try {
      const res = await withTimeout(
        api.post<User>('/auth/sync', identity, { timeout: 3000 }),
      )
      setUser(res.data)
    } catch {
      try {
        const me = await withTimeout(api.get<User>('/auth/me', { timeout: 3000 }))
        setUser(me.data)
      } catch {
        setUser(null)
      }
    } finally {
      setSyncing(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Sync with the external Supabase auth system on mount.
    // eslint-disable-next-line react/set-state-in-effect
    void syncUser()
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (next) void syncUser()
      else {
        setUser(null)
        setLoading(false)
      }
    })
    return () => {
      sub.subscription.unsubscribe()
    }
  }, [syncUser])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
  }, [])

  const value = useMemo<AuthState>(
    () => ({ session, user, loading, syncing, refresh: syncUser, signOut }),
    [session, user, loading, syncing, syncUser, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
