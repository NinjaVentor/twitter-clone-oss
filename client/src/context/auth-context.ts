import { createContext } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { User } from '../types'

export interface AuthState {
  session: Session | null
  user: User | null
  loading: boolean
  syncing: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
  syncing: false,
  refresh: async () => {},
  signOut: async () => {},
})
