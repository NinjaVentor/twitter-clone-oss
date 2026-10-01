import { Outlet, useLocation } from 'react-router-dom'
import ComposerModal from '../tweet/ComposerModal'
import DisplayModal from '../common/DisplayModal'
import ShortcutsModal from '../common/ShortcutsModal'
import Toaster from '../common/Toaster'
import RightSidebar from './RightSidebar'
import Sidebar from './Sidebar'
import { useAuth } from '../../context/useAuth'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useRealtime } from '../../hooks/useRealtime'

function RealtimeBootstrap() {
  const { session, user } = useAuth()
  useRealtime(user?.id ?? null, session?.access_token ?? null)
  useKeyboardShortcuts()
  return null
}

export default function AppShell() {
  const { pathname } = useLocation()
  // Messages gets a wide two-pane layout like x.com — no trends rail.
  const hideRightRail = pathname.startsWith('/messages')
  return (
    <div className="mx-auto flex min-h-svh max-w-[1265px] justify-center bg-black text-[#e7e9ea]">
      <RealtimeBootstrap />
      <Sidebar />

      <main
        className={`min-h-svh w-full shrink-0 border-x border-[#2f3336] ${
          hideRightRail ? 'max-w-[990px]' : 'max-w-[600px]'
        }`}
      >
        <Outlet />
      </main>

      {!hideRightRail && <RightSidebar />}
      <ComposerModal />
      <ShortcutsModal />
      <DisplayModal />
      <Toaster />
    </div>
  )
}
