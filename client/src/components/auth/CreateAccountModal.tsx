import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { TwitterBird } from '../icons'

interface Props {
  onClose: () => void
}

export default function CreateAccountModal({ onClose }: Props) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: name.trim(), name: name.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (err) {
        setError(err.message)
        return
      }
      // If email confirmation is off, session exists immediately → go home to sync.
      navigate('/home')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#5b708366] p-4" onClick={onClose}>
      <div
        className="w-full max-w-[600px] rounded-2xl bg-black p-4 text-[#e7e9ea] sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative mb-6 flex items-center justify-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full text-xl transition hover:bg-[#e7e9ea1a]"
          >
            ✕
          </button>
          <TwitterBird className="h-7 w-7 text-[#1d9bf0]" />
        </div>
        <h2 className="mb-6 text-[31px] font-extrabold">Create your account</h2>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="rounded border border-[#333639] p-2 focus-within:border-[#1d9bf0]">
            <span className="text-[13px] text-[#71767b]">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={50}
              className="w-full bg-transparent text-[17px] outline-none"
              autoComplete="name"
            />
          </label>
          <label className="rounded border border-[#333639] p-2 focus-within:border-[#1d9bf0]">
            <span className="text-[13px] text-[#71767b]">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              type="email"
              className="w-full bg-transparent text-[17px] outline-none"
              autoComplete="email"
            />
          </label>
          <label className="rounded border border-[#333639] p-2 focus-within:border-[#1d9bf0]">
            <span className="text-[13px] text-[#71767b]">Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              type="password"
              className="w-full bg-transparent text-[17px] outline-none"
              autoComplete="new-password"
            />
          </label>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 h-[52px] rounded-full bg-[#eff3f4] text-[17px] font-bold text-black transition hover:bg-[#d7dbdc] disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Sign up'}
          </button>
        </form>
      </div>
    </div>
  )
}

