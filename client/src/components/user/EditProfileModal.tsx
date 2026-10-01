import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, X } from 'lucide-react'
import { api } from '../../lib/api'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/useAuth'
import type { User } from '../../types'

interface Props {
  onClose: () => void
}

async function uploadImage(file: File, userId: string): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${userId}/profile-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('media').upload(path, file, {
    cacheControl: '31536000',
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl
}

export default function EditProfileModal({ onClose }: Props) {
  const { user, refresh } = useAuth()
  const queryClient = useQueryClient()
  const [name, setName] = useState(user?.display_name ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [location, setLocation] = useState(user?.location ?? '')
  const [website, setWebsite] = useState(user?.website ?? '')
  const [avatar, setAvatar] = useState(user?.avatar_url ?? '')
  const [banner, setBanner] = useState(user?.banner_url ?? '')
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const avatarRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLInputElement>(null)

  if (!user) return null

  const pick = async (files: FileList | null, which: 'avatar' | 'banner') => {
    const f = files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('Image must be under 10 MB.')
      return
    }
    setUploading(which)
    setError(null)
    try {
      const url = await uploadImage(f, user.id)
      if (which === 'avatar') setAvatar(url)
      else setBanner(url)
    } catch (e) {
      setError(e instanceof Error ? `Upload failed: ${e.message}` : 'Upload failed')
    } finally {
      setUploading(null)
    }
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await api.patch<User>('/users/me', {
        display_name: name.trim(),
        bio: bio.trim(),
        location: location.trim(),
        website: website.trim(),
        avatar_url: avatar,
        banner_url: banner,
      })
      if (!res.data) throw new Error('Save failed')
      await refresh()
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      onClose()
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string } } }).response?.data?.error ??
        (err instanceof Error ? err.message : 'Save failed')
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#5b708366] p-4 pt-[5vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[600px] overflow-hidden rounded-2xl bg-black text-[#e7e9ea]"
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
          <h2 className="flex-1 text-[20px] font-extrabold">Edit profile</h2>
          <button
            type="button"
            onClick={(e) => void save(e as unknown as FormEvent)}
            disabled={saving || uploading != null || !name.trim()}
            className="rounded-full bg-[#eff3f4] px-4 py-1.5 text-[14px] font-bold text-black transition hover:bg-[#d7dbdc] disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        <div className="relative">
          {banner ? (
            <img src={banner} alt="" referrerPolicy="no-referrer" className="aspect-[3/1] w-full object-cover" />
          ) : (
            <div className="aspect-[3/1] w-full bg-[#333639]" />
          )}
          <button
            type="button"
            aria-label="Change banner"
            onClick={() => bannerRef.current?.click()}
            className="absolute inset-0 m-auto flex h-11 w-11 items-center justify-center rounded-full bg-black/60 transition hover:bg-black/40"
          >
            <Camera className="h-5 w-5" />
          </button>
          <input
            ref={bannerRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files, 'banner')
              e.target.value = ''
            }}
          />
        </div>

        <div className="-mt-[34px] px-4">
          <div className="relative w-fit">
            {avatar ? (
              <img
                src={avatar}
                alt=""
                referrerPolicy="no-referrer"
                className="h-[68px] w-[68px] rounded-full border-4 border-black object-cover"
              />
            ) : (
              <div className="flex h-[68px] w-[68px] items-center justify-center rounded-full border-4 border-black bg-[#333639] text-2xl font-bold">
                {(name || '?').slice(0, 1).toUpperCase()}
              </div>
            )}
            <button
              type="button"
              aria-label="Change avatar"
              onClick={() => avatarRef.current?.click()}
              className="absolute inset-0 m-auto flex h-9 w-9 items-center justify-center rounded-full bg-black/60 transition hover:bg-black/40"
            >
              <Camera className="h-4 w-4" />
            </button>
            <input
              ref={avatarRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void pick(e.target.files, 'avatar')
                e.target.value = ''
              }}
            />
          </div>
          {uploading && (
            <p className="mt-1 text-[13px] text-[#1d9bf0]">Uploading {uploading}…</p>
          )}
        </div>

        <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4 p-4">
          <label className="rounded border border-[#333639] p-2 focus-within:border-[#1d9bf0]">
            <span className="text-[13px] text-[#71767b]">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={50}
              className="w-full bg-transparent text-[17px] outline-none"
            />
          </label>
          <label className="rounded border border-[#333639] p-2 focus-within:border-[#1d9bf0]">
            <span className="text-[13px] text-[#71767b]">Bio</span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={160}
              rows={2}
              className="w-full resize-none bg-transparent text-[17px] outline-none"
            />
          </label>
          <label className="rounded border border-[#333639] p-2 focus-within:border-[#1d9bf0]">
            <span className="text-[13px] text-[#71767b]">Location</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={30}
              className="w-full bg-transparent text-[17px] outline-none"
            />
          </label>
          <label className="rounded border border-[#333639] p-2 focus-within:border-[#1d9bf0]">
            <span className="text-[13px] text-[#71767b]">Website</span>
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              maxLength={100}
              placeholder="https://example.com"
              className="w-full bg-transparent text-[17px] outline-none"
            />
          </label>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </form>
      </div>
    </div>
  )
}
