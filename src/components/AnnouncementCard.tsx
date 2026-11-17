import { CalendarClock, Pin } from 'lucide-react'
import { AUDIENCE_LABEL, LEVEL_LABEL, isActive } from '../app/announcements'
import { useSession } from '../app/session'
import { fmtDate, fmtDateTime } from '../lib/format'
import type { Announcement, AnnouncementLevel } from '../lib/types'
import { Badge, Card, cx } from './ui'

// بطاقة الإعلان مستقلة عن صفحة الإعلانات حتى تبقى الصفحة في ملف يُحمَّل عند فتحها فقط
export const LEVEL_STYLE: Record<AnnouncementLevel, { bar: string; tone: 'info' | 'gold' | 'danger' }> = {
  info: { bar: 'bg-primary', tone: 'info' },
  important: { bar: 'bg-gold', tone: 'gold' },
  urgent: { bar: 'bg-danger', tone: 'danger' },
}

export function AnnouncementCard({ a, actions, compact }: { a: Announcement; actions?: React.ReactNode; compact?: boolean }) {
  const s = useSession()
  const st = LEVEL_STYLE[a.level]
  const active = isActive(a)
  return (
    <Card className={cx('relative overflow-hidden', !active && 'opacity-60')}>
      <span className={cx('absolute inset-y-0 start-0 w-1.5', st.bar)} />
      <div className={cx('ps-6 pe-4', compact ? 'py-3' : 'py-4')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {a.pinned && <Pin className="size-4 text-gold-text" aria-label="مثبت" />}
            <h3 className={cx('font-bold text-ink', compact ? 'text-sm' : 'text-base')}>{a.title}</h3>
            {a.level !== 'info' && <Badge tone={st.tone}>{LEVEL_LABEL[a.level]}</Badge>}
            {!active && <Badge>منتهٍ</Badge>}
          </div>
          {actions}
        </div>
        {a.body && <p className={cx('mt-2 whitespace-pre-line leading-relaxed text-ink/90', compact ? 'line-clamp-2 text-sm' : 'text-[0.95rem]')}>{a.body}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>{a.created_by_name ?? '—'}</span>
          <span className="tabular-nums">{fmtDateTime(a.created_at)}</span>
          <span>{a.department_id ? `قسم ${s.deptById(a.department_id)?.name ?? ''}` : 'كل الأقسام'}</span>
          {!compact && <span>{AUDIENCE_LABEL[a.audience]}</span>}
          {a.expires_at && (
            <span className="flex items-center gap-1">
              <CalendarClock className="size-3.5" />
              حتى {fmtDate(a.expires_at)}
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}

