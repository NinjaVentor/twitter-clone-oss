import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'

export default function CallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        // PKCE / implicit exchange: supabase-js reads the URL automatically.
        const { error: exchErr } = await supabase.auth.exchangeCodeForSession(window.location.href)
        if (exchErr) {
          // Implicit flow may already have a session; fall through and check.
          const { data } = await supabase.auth.getSession()
          if (!data.session) throw exchErr
        }
        await api.post('/auth/sync')
        if (!cancelled) navigate('/home', { replace: true })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Sign-in failed')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (error) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-black text-[#e7e9ea]">
        <p className="text-lg">Something went wrong signing you in.</p>
        <p className="text-sm text-red-500">{error}</p>
        <a href="/" className="rounded-full bg-[#1d9bf0] px-6 py-2 font-bold text-white">
          Back to Twitter
        </a>
      </div>
    )
  }
  return (
    <div className="flex min-h-svh items-center justify-center bg-black text-[#e7e9ea]">
      <p className="animate-pulse text-[17px]">Finishing sign-in…</p>
    </div>
  )
}
