import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../context/useAuth'
import TwemojiText from '../common/TwemojiText'
import { TwitterBird } from '../icons'
import type { User } from '../../types'

const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/

interface CheckedResult {
  name: string
  available: boolean
}

export default function OnboardingModal() {
  const { user, refresh } = useAuth()
  // HomePage only mounts this modal once the synced user is loaded,
  // so lazy initializers capture the Google-synced profile without effects.
  const [username, setUsername] = useState(() => (user?.username ?? '').replace(/^@/, ''))
  const [displayName, setDisplayName] = useState(() => user?.display_name ?? '')
  const [bio, setBio] = useState(() => user?.bio ?? '')
  const [checked, setChecked] = useState<CheckedResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const clean = username.trim().replace(/^@/, '')
  const formatValid = USERNAME_RE.test(clean)
  // Only trust the server result when it was checked for the current input.
  const available = formatValid && checked && checked.name === clean ? checked.available : null

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    const current = username.trim().replace(/^@/, '')
    if (!current || !USERNAME_RE.test(current)) return
    // Debounced live availability check; state updates happen in async
    // callbacks (never synchronously in the effect body).
    timer.current = window.setTimeout(() => {
      setChecking(true)
      api
        .get<{ available: boolean }>('/users/check-username', { params: { username: current } })
        .then((r) => setChecked({ name: current, available: r.data.available }))
        .catch(() => setChecked(null))
        .finally(() => setChecking(false))
    }, 350)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [username])

  if (!user || user.onboarded) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await api.patch<User>('/users/me/onboarding', {
        username: username.trim().replace(/^@/, ''),
        display_name: displayName.trim(),
        bio: bio.trim(),
      })
      if (!res.data.onboarded) setError('Could not finish onboarding, try again.')
      await refresh()
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } }).response?.data?.error ??
        (e instanceof Error ? e.message : 'Save failed')
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  const canSave = formatValid && available === true && displayName.trim().length > 0 && !saving

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#5b708366] p-4">
      <div className="w-full max-w-[600px] rounded-2xl bg-black p-6 text-[#e7e9ea] sm:p-8">
        <TwitterBird className="h-7 w-7 text-[#1d9bf0]" />
        <h2 className="mb-1 mt-4 text-[31px] font-extrabold">What should we call you?</h2>
        <p className="mb-6 text-[15px] text-[#71767b]">
          Your @username is unique. You can always change it later.
        </p>

        <div className="mb-5 flex items-center gap-3">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#333639] text-lg font-bold">
              {(displayName || user.email || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold">
              <TwemojiText text={displayName || user.display_name || user.email} />
            </p>
            <p className="truncate text-[15px] text-[#71767b]">{user.email}</p>
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="rounded border border-[#333639] p-2 focus-within:border-[#1d9bf0]">
            <span className="text-[13px] text-[#71767b]">Username</span>
            <div className="flex items-center gap-1">
              <span className="text-[17px] text-[#71767b]">@</span>
              <input
                value={username.replace(/^@/, '')}
                onChange={(e) => setUsername(e.target.value)}
                required
                maxLength={15}
                className="w-full bg-transparent text-[17px] outline-none"
                autoComplete="username"
              />
            </div>
          </label>
          <div className="-mt-2 min-h-[20px] text-[13px]">
            {checking && <span className="text-[#71767b]">Checking availability…</span>}
            {!checking && available === true && formatValid && (
              <span className="text-green-500">@{clean} is available 🎉</span>
            )}
            {!checking && available === false && (
              <span className="text-red-500">That username is taken.</span>
            )}
            {!checking && clean && !formatValid && (
              <span className="text-[#71767b]">
                Usernames are 1–15 chars: letters, numbers, underscore.
              </span>
            )}
          </div>

          <label className="rounded border border-[#333639] p-2 focus-within:border-[#1d9bf0]">
            <span className="text-[13px] text-[#71767b]">Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={50}
              className="w-full bg-transparent text-[17px] outline-none"
            />
          </label>

          <label className="rounded border border-[#333639] p-2 focus-within:border-[#1d9bf0]">
            <span className="text-[13px] text-[#71767b]">Bio (optional)</span>
            <input
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={160}
              className="w-full bg-transparent text-[17px] outline-none"
            />
          </label>

          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={!canSave}
            className="mt-2 h-[52px] rounded-full bg-[#eff3f4] text-[17px] font-bold text-black transition hover:bg-[#d7dbdc] disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}

