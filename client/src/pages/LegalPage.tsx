import { useEffect } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../context/useAuth'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { TwitterBird } from '../components/icons'

export type LegalDoc = 'tos' | 'privacy' | 'cookies'

interface Section {
  id: string
  heading: string
  paragraphs: string[]
  bullets?: string[]
  /** Extra in-page anchors: paragraph index -> element id (footer deep-links). */
  anchors?: Record<number, string>
}

const DOCS: Record<LegalDoc, { title: string; docTitle: string; updated: string; sections: Section[] }> = {
  tos: {
    title: 'Twitter Terms of Service',
    docTitle: 'Terms of Service',
    updated: 'Effective September 29, 2026',
    sections: [
      {
        id: 'who-may-use',
        heading: '1. Who May Use the Services',
        paragraphs: [
          'You may use Twitter if you are at least 13 years old and have not been previously suspended. You must create an account with an accurate display name and handle, either directly or through Google OAuth, and you are responsible for safeguarding access to your account.',
          'If you accept these Terms on behalf of an organization, you represent that you have the authority to bind that organization.',
        ],
      },
      {
        id: 'privacy',
        heading: '2. Privacy',
        paragraphs: [
          'Our Privacy Policy describes what information we collect from you — including your profile, Tweets, and usage data — and how we use it. By using Twitter, you agree that we can use that data as described in the Privacy Policy.',
        ],
      },
      {
        id: 'content',
        heading: '3. Content on the Services',
        paragraphs: [
          'You retain your rights to any content you post, including 280-character Tweets, uploaded photos and video, Retweets, Quote Tweets, and polls. By posting, you grant Twitter a worldwide, non-exclusive, royalty-free license to display, distribute, and promote that content through the Services.',
          'You are responsible for the content you post. Do not post content that is unlawful, hateful, graphically violent without context, or that infringes the intellectual property of others.',
        ],
        bullets: [
          'Tweets are limited to 280 weighted characters.',
          'You may attach up to 4 photos or one video per Tweet.',
          'Polls support 2–4 choices and close automatically at the configured duration.',
        ],
      },
      {
        id: 'using',
        heading: '4. Using the Services',
        anchors: { 1: 'developers', 2: 'accessibility' },
        paragraphs: [
          'You may not spam, harass, impersonate others, manipulate trending topics, or interfere with other accounts’ use of the Services. Automated access, scraping, and bulk account creation are prohibited except through documented interfaces and rate limits.',
          'Developers building on Twitter must follow the published API and automation rules, identify bots clearly where required, and respect user privacy settings.',
          'Twitter is committed to accessibility: we aim to meet WCAG 2.1 AA for core flows, support keyboard navigation and screen readers, and honor reduced-motion preferences.',
        ],
      },
      {
        id: 'disclaimers',
        heading: '5. Disclaimers and Limitations of Liability',
        paragraphs: [
          'The Services are provided “as is” without warranties of any kind. Twitter does not endorse user content and is not responsible for the conduct, views, or data of third parties.',
          'To the maximum extent permitted by law, Twitter’s total liability for any claim arising from the Services is limited to the greater of one hundred US dollars or the amount you paid for the Services in the twelve months before the claim.',
        ],
      },
      {
        id: 'ending',
        heading: '6. Ending These Terms',
        paragraphs: [
          'You may end your agreement with Twitter at any time by deleting your account from Settings. Deletion removes your profile, Tweets, media, Likes, Bookmarks, and Direct Messages, and revokes your sign-in credentials.',
          'We may suspend or terminate accounts that violate these Terms, engage in severe abuse, or pose a security risk. If your account is terminated, these Terms’ provisions on content licensing, disclaimers, and liability survive.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Twitter Privacy Policy',
    docTitle: 'Privacy Policy',
    updated: 'Effective September 29, 2026',
    sections: [
      {
        id: 'info-you-share',
        heading: '1. Information You Share With Us',
        paragraphs: [
          'When you create an account — directly or with Google OAuth (name, email address, and avatar) — you share your display name, handle, biography, location, and website. Everything you publish or engage with is also information you share: Tweets, replies, Retweets, Quote Tweets, Likes, Bookmarks, polls and votes, follows, and Direct Messages, including message text, attachments, and reactions.',
        ],
      },
      {
        id: 'info-we-receive',
        heading: '2. Additional Information We Receive',
        paragraphs: [
          'We receive log data when you use the Services: device and browser details, IP address, pages visited, and interaction timestamps. We also record product signals such as Tweet view counts, search queries, trends you open, notification interactions, and WebSocket session state used to deliver realtime updates.',
        ],
      },
      {
        id: 'how-we-use',
        heading: '3. How We Use Information',
        paragraphs: [
          'We use information to operate and personalize Twitter: ranking your Home timeline, suggesting accounts to follow, computing trending hashtags, sending real-time notifications for Likes, Retweets, replies, mentions, follows, and Direct Messages, and keeping the Services safe from spam and abuse.',
        ],
      },
      {
        id: 'sharing',
        heading: '4. Sharing Information',
        anchors: { 1: 'ads' },
        paragraphs: [
          'Anything you Tweet, like publicly, or post to a non-protected profile is public by design. Direct Messages are private to their participants. We share data with service providers who process it on our behalf, and we may disclose information to comply with the law or protect safety.',
          'Advertising on Twitter is interest-based but never sells your private messages or contact details; ad preferences you set are honored across the Services.',
        ],
      },
      {
        id: 'retention',
        heading: '5. How Long We Keep Information & Deleting Your Account',
        paragraphs: [
          'We keep your account data while your account is active, and log data for a limited period for safety and debugging. When you delete your account, your profile, Tweets, media, Likes, Bookmarks, and messages are queued for permanent deletion, and cached copies expire shortly after. Some records may be retained where the law requires it.',
        ],
      },
    ],
  },
  cookies: {
    title: 'How Twitter uses cookies',
    docTitle: 'Cookie Use',
    updated: 'Effective September 29, 2026',
    sections: [
      {
        id: 'what-are',
        heading: '1. What are cookies and local storage?',
        paragraphs: [
          'Cookies are small text files stored by your browser; local storage lets web apps keep small amounts of data on your device. Both help Twitter remember you between visits without asking you to sign in every time.',
        ],
      },
      {
        id: 'how-we-use',
        heading: '2. How Twitter uses them',
        paragraphs: [
          'Twitter uses a small set of strictly necessary cookies and storage entries — and nothing else — to keep you signed in and to remember your preferences.',
        ],
        bullets: [
          'Authentication & session tokens: keeps you signed in and refreshes your session securely.',
          'Security: detects suspicious sign-in activity and prevents cross-site request forgery.',
          'Theme & Display preferences: remembers Lights Out, Dim, or Default Light mode and your display choices.',
          'Real-time WebSocket session state: reconnects your live timeline, notification, and message streams after reloads.',
        ],
      },
      {
        id: 'managing',
        heading: '3. Managing your preferences',
        paragraphs: [
          'You can clear cookies and site data at any time from your browser settings; doing so will sign you out of Twitter. Switching theme or display options updates your stored preferences immediately, and deleting your account removes preference data along with it.',
        ],
      },
    ],
  },
}

const TABS: { key: LegalDoc; to: string; label: string }[] = [
  { key: 'tos', to: '/tos', label: 'Terms' },
  { key: 'privacy', to: '/privacy', label: 'Privacy' },
  { key: 'cookies', to: '/cookies', label: 'Cookies' },
]

export default function LegalPage({ doc }: { doc: LegalDoc }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useAuth()
  const content = DOCS[doc]
  useDocumentTitle(content.docTitle)

  useEffect(() => {
    if (location.hash) {
      const el = document.querySelector(location.hash)
      if (el) {
        // Allow the route render to settle before jumping to the anchor.
        const t = window.setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 50)
        return () => window.clearTimeout(t)
      }
    } else {
      window.scrollTo(0, 0)
    }
  }, [location.hash, location.pathname])

  const goBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate(session ? '/home' : '/')
  }

  return (
    <div className="min-h-svh bg-black text-[#e7e9ea]">
      <header className="sticky top-0 z-20 border-b border-[#2f3336] bg-black/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1024px] items-center gap-4 px-4 py-3">
          <Link to={session ? '/home' : '/'} aria-label="Twitter home">
            <TwitterBird className="h-7 w-7 text-[#1d9bf0]" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-extrabold">{content.title}</h1>
          <button
            type="button"
            onClick={goBack}
            className="flex shrink-0 items-center gap-2 rounded-full border border-[#536471] px-4 py-1.5 text-[15px] font-bold transition hover:bg-[#e7e9ea1a]"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Twitter
          </button>
        </div>
        <nav className="mx-auto flex max-w-[1024px] gap-1 px-4">
          {TABS.map((t) => (
            <NavLink
              key={t.key}
              to={t.to}
              className={({ isActive }) =>
                `relative px-4 py-3 text-[15px] transition hover:bg-[#e7e9ea08] ${
                  isActive ? 'font-bold' : 'text-[#71767b]'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <div className="mx-auto flex max-w-[1024px] gap-8 px-4 py-8">
        <aside className="hidden w-64 shrink-0 md:block">
          <nav className="sticky top-32 flex flex-col gap-1">
            <p className="px-3 pb-2 text-[13px] font-bold uppercase tracking-wide text-[#71767b]">
              On this page
            </p>
            {content.sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="rounded-full px-3 py-2 text-[15px] text-[#e7e9ea] transition hover:bg-[#e7e9ea1a]"
              >
                {s.heading}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 max-w-[760px] flex-1 font-[TwitterChirp]">
          <p className="mb-6 text-[13px] text-[#71767b]">{content.updated}</p>
          {content.sections.map((s) => (
            <section key={s.id} id={s.id} className="mb-10 scroll-mt-32">
              <h2 className="mb-3 text-[23px] font-extrabold">{s.heading}</h2>
              {s.paragraphs.map((p, i) => (
                <p
                  key={i}
                  id={s.anchors?.[i]}
                  className="mb-3 scroll-mt-32 text-[15px] leading-relaxed text-[#e7e9ea]"
                >
                  {p}
                </p>
              ))}
              {s.bullets && (
                <ul className="mb-3 list-disc space-y-1.5 pl-6 text-[15px] leading-relaxed">
                  {s.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <footer className="border-t border-[#2f3336] py-4 text-[13px] text-[#71767b]">
            © 2026 Twitter, Inc.
          </footer>
        </main>
      </div>
    </div>
  )
}
