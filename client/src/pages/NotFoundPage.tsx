import { Link, useNavigate } from 'react-router-dom'
import Sidebar from '../components/layout/Sidebar'
import RightSidebar from '../components/layout/RightSidebar'
import { useAuth } from '../context/useAuth'
import { TwitterBird } from '../components/icons'

/** Twitter's exact 404 body: gray line + blue Search pill. */
export function NotFoundBody() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center gap-4 px-8 py-20 text-center">
      <p className="text-[#71767b] text-[15px] text-center">
        Hmm...this page doesn’t exist. Try searching for something else.
      </p>
      <button
        type="button"
        onClick={() => navigate('/explore')}
        className="bg-[#1d9bf0] hover:bg-[#1a8cd8] text-white font-bold px-5 py-2.5 rounded-full transition"
      >
        Search
      </button>
    </div>
  )
}

/**
 * Context-aware 404: inside the 3-column App Shell when authenticated
 * (sidebars stay visible, like real Twitter), otherwise a minimal top bar
 * with the bird plus Sign in / Sign up.
 */
export default function NotFoundPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-black">
        <TwitterBird className="h-16 w-16 animate-pulse text-[#1d9bf0]" />
      </div>
    )
  }

  if (session) {
    return (
      <div className="mx-auto flex min-h-svh max-w-[1265px] justify-center bg-black text-[#e7e9ea]">
        <Sidebar />
        <main className="min-h-svh w-full max-w-[600px] shrink-0 border-x border-[#2f3336]">
          <NotFoundBody />
        </main>
        <RightSidebar />
      </div>
    )
  }

  return (
    <div className="min-h-svh bg-black text-[#e7e9ea]">
      <header className="flex items-center justify-between border-b border-[#2f3336] px-4 py-2">
        <Link to="/" aria-label="Twitter home">
          <TwitterBird className="h-7 w-7 text-[#1d9bf0]" />
        </Link>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate('/?auth=signin')}
            className="rounded-full border border-[#536471] px-4 py-1.5 text-[15px] font-bold text-[#1d9bf0] transition hover:bg-[#1d9bf01a]"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => navigate('/?auth=signup')}
            className="rounded-full bg-[#eff3f4] px-4 py-1.5 text-[15px] font-bold text-black transition hover:bg-[#d7dbdc]"
          >
            Sign up
          </button>
        </div>
      </header>
      <NotFoundBody />
    </div>
  )
}
