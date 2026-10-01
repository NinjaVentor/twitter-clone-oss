import axios from 'axios'
import { supabase } from './supabase'

export const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL as string) || 'http://localhost:8080/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})
