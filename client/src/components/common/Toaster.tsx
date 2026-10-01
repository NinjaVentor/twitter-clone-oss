import { Link } from 'react-router-dom'
import { useToastStore } from '../../store/toast'

/** Bottom-centered Twitter toasts. Mount once near the app root. */
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] shadow-[0_0_15px_rgba(255,255,255,0.2)] transition ${
            t.tone === 'dark' ? 'bg-[#16181c] text-[#e7e9ea]' : 'bg-[#1d9bf0] text-white'
          }`}
        >
          <span>{t.message}</span>
          {t.actionLabel && t.actionTo && (
            <Link
              to={t.actionTo}
              onClick={(e) => e.stopPropagation()}
              className="font-bold underline"
            >
              {t.actionLabel}
            </Link>
          )}
        </button>
      ))}
    </div>
  )
}
