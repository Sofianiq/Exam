import { Megaphone, X } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { isActive, useAnnouncements, useSeenAnnouncements } from '../app/announcements'
import { useSession } from '../app/session'
import { cx } from './ui'

/** شريط بارز أعلى الصفحات لأحدث إعلان مهم أو عاجل لم يقرأه المستخدم */
export function AnnouncementBanner() {
  const s = useSession()
  const loc = useLocation()
  const q = useAnnouncements()
  const { seen, markSeen } = useSeenAnnouncements(s.profile.id)
  if (loc.pathname === '/announcements') return null
  // العاجل أولاً ثم المهم، والأحدث أولاً
  const rank = { urgent: 0, important: 1, info: 2 } as const
  const unread = (q.data ?? [])
    .filter((a) => isActive(a) && a.level !== 'info' && !seen.has(a.id))
    .sort((x, y) => rank[x.level] - rank[y.level] || y.created_at.localeCompare(x.created_at))
  const a = unread[0]
  if (!a) return null
  const urgent = a.level === 'urgent'
  return (
    <div
      role="status"
      data-announcement-banner
      className={cx(
        'no-print border-b px-4 py-2.5 sm:px-6',
        urgent ? 'border-danger/30 bg-danger text-white' : 'border-gold/40 bg-gradient-to-l from-[var(--gold)] to-[#c99a3c] text-white',
      )}
    >
      <div className="mx-auto flex max-w-[1500px] items-center gap-3">
        <Megaphone className="size-5 shrink-0" />
        <div className="min-w-0 flex-1 text-sm">
          <b className="me-2">{urgent ? 'إعلان عاجل:' : 'إعلان مهم:'}</b>
          <span className="font-semibold">{a.title}</span>
          {a.body && <span className="ms-2 hidden opacity-90 md:inline">— {a.body.length > 110 ? `${a.body.slice(0, 110)}…` : a.body}</span>}
        </div>
        {unread.length > 1 && <span dir="ltr" title="إعلانات أخرى غير مقروءة" className="hidden rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold sm:inline">+{unread.length - 1}</span>}
        <Link to="/announcements" className="shrink-0 rounded-md bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30">
          عرض
        </Link>
        <button className="shrink-0 rounded-md p-1 hover:bg-white/20" aria-label="إخفاء الإعلان" onClick={() => markSeen([a.id])}>
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
