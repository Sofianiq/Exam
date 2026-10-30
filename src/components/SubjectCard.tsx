import { ArrowLeft, MessageSquareWarning } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSession } from '../app/session'
import { displayName } from '../lib/format'
import { SHIFT_LABEL, TERM_LABEL, stageLabel } from '../lib/labels'
import type { Subject, SubjectProgress } from '../lib/types'
import { ProgressBar, StatusBadge, cx } from './ui'

export function SubjectCard({ subject, progress }: { subject: Subject; progress?: SubjectProgress }) {
  const s = useSession()
  const dept = s.deptById(subject.department_id)
  const total = progress?.n_students ?? 0
  const done = progress?.n_complete ?? 0
  const ratio = total ? done / total : 0
  const teachers = subject.teacher_ids.map((id) => displayName(s.profileById(id))).filter(Boolean)
  return (
    <Link
      to={`/subjects/${subject.id}`}
      className={cx(
        'card group flex flex-col p-4 transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-pop',
        subject.status === 'returned' && 'border-warning/50',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug text-ink">{subject.name}</h3>
          <p className="mt-1 text-xs text-muted">
            {dept?.name} — {stageLabel(subject.stage)} — {SHIFT_LABEL[subject.shift]} — {TERM_LABEL[subject.term]}
          </p>
        </div>
        <StatusBadge status={subject.status} />
      </div>
      {subject.status === 'returned' && subject.status_note && (
        <div className="mt-3 flex gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs leading-6 text-warning">
          <MessageSquareWarning className="mt-0.5 size-4 shrink-0" />
          <span>
            <b>ملاحظة اللجنة:</b> {subject.status_note}
          </span>
        </div>
      )}
      <div className="mt-auto pt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
          <span>
            الإنجاز: <b className="tabular-nums text-ink">{done}</b> من <span className="tabular-nums">{total}</span> طالب
          </span>
          <span className="tabular-nums">{Math.round(ratio * 100)}%</span>
        </div>
        <ProgressBar value={ratio} tone={ratio >= 1 ? 'success' : 'primary'} />
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <span className="truncate text-muted">{teachers.join(' + ') || 'لم يُحدد تدريسي'}</span>
          <span className="inline-flex items-center gap-1 font-medium text-primary-text group-hover:gap-2 transition-all">
            فتح القائمة <ArrowLeft className="size-3.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}
