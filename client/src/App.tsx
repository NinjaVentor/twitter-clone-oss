import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import LandingPage from './components/auth/LandingPage'
import AppShell from './components/layout/AppShell'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './context/useAuth'
import CallbackPage from './pages/CallbackPage'
import BookmarksPage from './pages/BookmarksPage'
import ExplorePage from './pages/ExplorePage'
import HomePage from './pages/HomePage'
import MessagesPage from './pages/MessagesPage'
import NotificationsPage from './pages/NotificationsPage'
import ProfilePage from './pages/ProfilePage'
import StatusPage from './pages/StatusPage'
import LegalPage from './pages/LegalPage'
import NotFoundPage from './pages/NotFoundPage'
import { TwitterBird } from './components/icons'

const queryClient = new QueryClient()

/** Dark splash: shown while auth resolves — never a blank white page. */
function BirdSplash() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-black">
      <TwitterBird className="h-16 w-16 animate-pulse text-[#1d9bf0]" />
    </div>
  )
}

function RootRoute() {
  const { session, loading } = useAuth()
  if (loading) return <BirdSplash />
  return session ? <Navigate to="/home" replace /> : <LandingPage />
}

function RequireSession({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!loading && !session) navigate('/', { replace: true })
  }, [loading, session, navigate])
  if (loading) return <BirdSplash />
  if (!session) return <BirdSplash />
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RootRoute />} />
            <Route path="/auth/callback" element={<CallbackPage />} />
            <Route path="/tos" element={<LegalPage doc="tos" />} />
            <Route path="/privacy" element={<LegalPage doc="privacy" />} />
            <Route path="/cookies" element={<LegalPage doc="cookies" />} />
            <Route path="/rules-and-policies/twitter-cookies" element={<Navigate to="/cookies" replace />} />
            <Route
              element={
                <RequireSession>
                  <AppShell />
                </RequireSession>
              }
            >
              <Route path="/home" element={<HomePage />} />
              <Route path="/explore" element={<ExplorePage />} />
              <Route path="/status/:id" element={<StatusPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/bookmarks" element={<BookmarksPage />} />
              <Route path="/profile/:username" element={<ProfilePage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
