import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { GoogleG } from '../icons'
import { COPIES, buildScene } from './landingScene'
import CreateAccountModal from './CreateAccountModal'
import SignInModal from './SignInModal'
import './LandingPage.css'

export default function LandingPage() {
  const [params] = useSearchParams()
  const initial = params.get('auth') === 'signup' || params.get('auth') === 'signin' ? params.get('auth') : null
  const [mode, setMode] = useState<'signup' | 'signin' | null>(initial as 'signup' | 'signin' | null)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const sceneRef = useRef<HTMLElement>(null)
  const markup = useMemo(() => buildScene(), [])

  // Rotating tweet-card copy (same 3.6s + 5.2s cadence as the design script).
  useEffect(() => {
    const root = sceneRef.current
    if (!root) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let cancelled = false
    const timeouts: number[] = []
    const intervals: number[] = []
    COPIES.forEach((copy, i) => {
      const g = root.querySelector<SVGGElement>('#t' + i)
      if (!g) return
      const texts = g.querySelectorAll('text')
      if (texts.length < 2) return
      let n = 0
      const step = () => {
        if (cancelled) return
        g.style.opacity = '0'
        g.style.transform = 'translateY(6px)'
        timeouts.push(
          window.setTimeout(() => {
            if (cancelled) return
            n = (n + 1) % copy.length
            texts[0].textContent = copy[n][0]
            texts[1].textContent = copy[n][1]
            g.style.transform = 'translateY(-6px)'
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (cancelled) return
                g.style.opacity = '1'
                g.style.transform = 'none'
              }),
            )
          }, 280),
        )
      }
      timeouts.push(
        window.setTimeout(() => {
          if (cancelled) return
          step()
          intervals.push(window.setInterval(step, 5200))
        }, 3600 + i * 1300),
      )
    })
    return () => {
      cancelled = true
      timeouts.forEach((t) => window.clearTimeout(t))
      intervals.forEach((t) => window.clearInterval(t))
    }
  }, [])

  const continueWithGoogle = async () => {
    setGoogleBusy(true)
    setGoogleError(null)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) setGoogleError(error.message)
    } catch (e) {
      setGoogleError(e instanceof Error ? e.message : 'Google sign-in failed')
    } finally {
      setGoogleBusy(false)
    }
  }

  return (
    <div className="min-h-svh bg-black text-[#e7e9ea]">
      <div className="tw-landing">
        <section className="twl-art" aria-hidden="true" ref={sceneRef}>
          <svg
            viewBox="0 0 720 760"
            preserveAspectRatio="xMidYMax meet"
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        </section>
        <main className="twl-panel">
          <div className="twl-box">
            <h1>Happening now</h1>
            <h2>Join Twitter today.</h2>
            <button type="button" className="twl-btn twl-g" onClick={continueWithGoogle} disabled={googleBusy}>
              <GoogleG className="h-[18px] w-[18px]" />
              {googleBusy ? 'Connecting…' : 'Continue with Google'}
            </button>
            {googleError && <p className="twl-err">{googleError}</p>}
            <div className="twl-or">or</div>
            <button type="button" className="twl-btn twl-c" onClick={() => setMode('signup')}>
              Create account
            </button>
            <small>
              By signing up, you agree to the <Link to="/tos">Terms of Service</Link> and{' '}
              <Link to="/privacy">Privacy Policy</Link>, including <Link to="/cookies">Cookie Use</Link>.
            </small>
            <h3>Already have an account?</h3>
            <button type="button" className="twl-btn twl-s" onClick={() => setMode('signin')}>
              Sign in
            </button>
          </div>
        </main>
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-3 text-[13px] text-[#71767b]">
        {[
          { label: 'About', to: '/tos' },
          { label: 'Help Center', to: '/privacy' },
          { label: 'Terms of Service', to: '/tos' },
          { label: 'Privacy Policy', to: '/privacy' },
          { label: 'Cookie Policy', to: '/cookies' },
          { label: 'Accessibility', to: '/tos#accessibility' },
          { label: 'Ads info', to: '/privacy#ads' },
          { label: 'Blog', to: '/explore' },
          { label: 'Careers', to: '/tos' },
          { label: 'Brand Resources', to: '/tos' },
          { label: 'Marketing', to: '/privacy#ads' },
          { label: 'Twitter for Business', to: '/privacy#ads' },
          { label: 'Developers', to: '/tos#developers' },
          { label: 'Directory', to: '/explore' },
          { label: 'Settings', to: '/privacy' },
        ].map((l) => (
          <Link key={l.label} to={l.to} className="cursor-pointer hover:underline">
            {l.label}
          </Link>
        ))}
        <span>© 2026 Twitter, Inc.</span>
      </footer>

      {mode === 'signup' && <CreateAccountModal onClose={() => setMode(null)} />}
      {mode === 'signin' && <SignInModal onClose={() => setMode(null)} />}
    </div>
  )
}
