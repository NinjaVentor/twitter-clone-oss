import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

function isUsableUrl(value: string | undefined): value is string {
  if (!value) return false
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

function buildStub(): SupabaseClient {
  const authError = { message: 'Sign-in is currently unavailable. Please try again later.' }
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInWithOAuth: async () => ({ data: null, error: authError }),
      signUp: async () => ({ data: { user: null, session: null }, error: authError }),
      signInWithPassword: async () => ({ data: { user: null, session: null }, error: authError }),
      signOut: async () => ({ error: null }),
      exchangeCodeForSession: async () => ({ data: { user: null, session: null }, error: authError }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: authError }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  } as unknown as SupabaseClient
}

/**
 * Never throws at module evaluation time: with missing/malformed env the app
 * still boots (landing page renders) and every auth call fails gracefully.
 */
function initClient(): SupabaseClient {
  if (!isUsableUrl(rawUrl) || !anonKey) {
    return buildStub()
  }
  try {
    return createClient(rawUrl, anonKey)
  } catch (err) {
    console.error('Failed to initialise Supabase client, using offline stub.', err)
    return buildStub()
  }
}

export const supabase: SupabaseClient = initClient()
