import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Feather, Moon } from 'lucide-react'
import { useAuth } from '../../context/useAuth'
import { useThemeStore } from '../../store/theme'
import { useComposerStore } from '../../store/composer'
import { useUnreadStore } from '../../store/unread'
import TwemojiText from '../common/TwemojiText'
import { TwitterBird } from '../icons'
import {
  TwitterBookmarksIcon,
  TwitterExploreIcon,
  TwitterHomeIcon,
  TwitterMessagesIcon,
  TwitterNotificationsIcon,
  TwitterProfileIcon,
} from '../twitter-icons'

interface Props {
  unreadNotifications?: number
  unreadMessages?: number
}

function NavItem({
  to,
  label,
  badge,
  renderIcon,
}: {
  to: string
  label: string
  badge?: number
  renderIcon: (active: boolean) => React.ReactNode
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `group flex w-fit items-center gap-4 rounded-full p-3 text-[20px] transition hover:bg-[#e7e9ea1a] xl:pr-6 ${
          isActive ? 'font-extrabold' : ''
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className="relative">
            {renderIcon(isActive)}
            {badge != null && badge > 0 && (
              <span className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#1d9bf0] px-1 text-[11px] font-bold text-white">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </span>
          <span className="hidden text-[20px] leading-6 xl:inline">{label}</span>
        </>
      )}
    </NavLink>
  )
}

const iconCls = 'h-[22px] w-[22px]'

export default function Sidebar({ unreadNotifications, unreadMessages }: Props) {
  const { user, signOut } = useAuth()
  const setDisplayOpen = useThemeStore((s) => s.setDisplayOpen)
  const openPost = useComposerStore((s) => s.openPost)
  const storeNotifications = useUnreadStore((s) => s.notifications)
  const storeMessages = useUnreadStore((s) => s.messages)
  // Live store badges win; explicit props remain as an override for tests/embeds.
  const notifBadge = unreadNotifications ?? storeNotifications
  const msgBadge = unreadMessages ?? storeMessages
  const [pillOpen, setPillOpen] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Close the logout popover on any outside click/tap or Escape.
  useEffect(() => {
    if (!pillOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
        setPillOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPillOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pillOpen])

  const logout = async () => {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <header className="sticky top-0 flex h-svh w-[68px] shrink-0 flex-col items-center overflow-y-hidden px-1 py-1 xl:w-[275px] xl:items-stretch xl:px-3">
      <nav className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto xl:items-start">
        <NavLink
          to="/home"
          aria-label="Twitter home"
          className="flex items-center gap-2 rounded-full p-2 pr-3 transition hover:bg-[#e7e9ea1a]"
        >
          <span className="flex h-[36px] w-[36px] items-center justify-center">
            <TwitterBird className="h-6 w-6 text-[#1d9bf0]" />
          </span>
          <span className="xl:inline hidden font-extrabold text-[21px] tracking-tight">Twitter</span>
        </NavLink>

        <NavItem
          to="/home"
          label="Home"
          renderIcon={(active) => <TwitterHomeIcon active={active} className={iconCls} />}
        />
        <NavItem
          to="/explore"
          label="Explore"
          renderIcon={(active) => <TwitterExploreIcon active={active} className={iconCls} />}
        />
        <NavItem
          to="/notifications"
          label="Notifications"
          badge={notifBadge}
          renderIcon={(active) => <TwitterNotificationsIcon active={active} className={iconCls} />}
        />
        <NavItem
          to="/messages"
          label="Messages"
          badge={msgBadge}
          renderIcon={(active) => <TwitterMessagesIcon active={active} className={iconCls} />}
        />
        <NavItem
          to="/bookmarks"
          label="Bookmarks"
          renderIcon={(active) => <TwitterBookmarksIcon active={active} className={iconCls} />}
        />
        <NavItem
          to={user ? `/profile/${user.username}` : '/home'}
          label="Profile"
          renderIcon={(active) => <TwitterProfileIcon active={active} className={iconCls} />}
        />

        <button
          type="button"
          onClick={() => setDisplayOpen(true)}
          className="flex w-fit items-center gap-4 rounded-full p-3 text-[20px] transition hover:bg-[#e7e9ea1a] xl:pr-6"
          title="Display settings"
        >
          <Moon className={iconCls} />
          <span className="hidden xl:inline">Display</span>
        </button>

        <button
          type="button"
          onClick={openPost}
          className="mt-4 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#eff3f4] text-black shadow transition hover:bg-[#d7dbdc] xl:h-[52px] xl:w-[90%] xl:gap-2"
          title="Tweet"
        >
          <Feather className="h-6 w-6 xl:hidden" />
          <span className="hidden text-[17px] font-bold xl:inline">Tweet</span>
        </button>
      </nav>

      {/* Account pill pinned to the screen bottom, like x.com */}
      <div ref={pillRef} className="relative mt-3 flex w-full shrink-0 justify-center pb-1 xl:mt-4 xl:block">
        {pillOpen && (
          <div className="absolute bottom-full left-0 z-40 mb-2 w-[260px] rounded-2xl bg-black py-3 shadow-[0_0_15px_rgba(255,255,255,0.2)]">
            <button
              type="button"
              onClick={logout}
              className="w-full px-4 py-3 text-left text-[15px] font-bold transition hover:bg-[#e7e9ea1a]"
            >
              Log out @{user?.username}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setPillOpen((v) => !v)}
          className="flex items-center gap-3 rounded-full p-2 transition hover:bg-[#e7e9ea1a] xl:w-full xl:p-3"
        >
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#333639] font-bold">
              {(user?.display_name || user?.email || '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <span className="hidden min-w-0 flex-1 text-left xl:block">
            <span className="block truncate text-[15px] font-bold">
              <TwemojiText text={user?.display_name || ''} />
            </span>
            <span className="block truncate text-[15px] text-[#71767b]">@{user?.username}</span>
          </span>
          <span className="hidden font-bold xl:block">···</span>
        </button>
      </div>
    </header>
  )
}

