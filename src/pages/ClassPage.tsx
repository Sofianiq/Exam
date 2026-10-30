import { BookOpen, ChevronLeft, Sheet, Users } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { parseShift } from '../app/queries'
import { useSession } from '../app/session'
import { MasterSheet } from '../components/MasterSheet'
import { StudentsTab } from '../components/StudentsTab'
import { SubjectsTab } from '../components/SubjectsTab'
import { PageHeader, Segmented, cx } from '../components/ui'
import { yearLabel } from '../lib/format'
import { SHIFT_LONG, TERM_LABEL, stageLabel } from '../lib/labels'
import { canSeeDepartment } from '../lib/perm'
import type { ClassKey, Term } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

type Tab = 'subjects' | 'students' | 'master'

export function ClassPage() {
  const params = useParams()
  const [sp, setSp] = useSearchParams()
  const s = useSession()
  const dept = s.deptById(params.deptId)
  const stage = Number(params.stage)
  const shift = parseShift(params.shift)
  const tab = (['subjects', 'students', 'master'].includes(sp.get('tab') ?? '') ? sp.get('tab') : 'subjects') as Tab
  const termParam = sp.get('term')
  const term: Term | 0 = termParam === '0' && tab === 'master' ? 0 : termParam === '2' ? 2 : 1

  if (!dept || !canSeeDepartment(s.profile, dept.id) || !(stage >= 1 && stage <= dept.stages) || (shift === 'evening' && !dept.has_evening)) {
    return <NotFoundPage />
  }
  const key: ClassKey = { year_id: s.yearId, department_id: dept.id, stage, shift }
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp)
    Object.entries(patch).forEach(([k, v]) => next.set(k, v))
    setSp(next, { replace: true })
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'subjects', label: 'المواد والدرجات', icon: <BookOpen className="size-4" /> },
    { id: 'students', label: 'قائمة الطلبة', icon: <Users className="size-4" /> },
    { id: 'master', label: 'الماستر شيت', icon: <Sheet className="size-4" /> },
  ]

  return (
    <div>
      <div className="no-print">
        <PageHeader
          crumbs={
            <>
              {s.profile.role !== 'head' && (
                <>
                  <Link to="/departments" className="hover:text-ink">
                    الأقسام
                  </Link>
                  <ChevronLeft className="size-3" />
                </>
              )}
              <Link to={`/departments/${dept.id}`} className="hover:text-ink">
                {dept.name}
              </Link>
              <ChevronLeft className="size-3" />
              <span>{stageLabel(stage)}</span>
            </>
          }
          title={`${stageLabel(stage)} — ${SHIFT_LONG[shift]}`}
          subtitle={`قسم ${dept.name} — السنة الدراسية ${yearLabel(s.year?.label)}`}
          actions={
            tab !== 'students' && (
              <Segmented<number>
                value={term}
                onChange={(v) => set({ term: String(v) })}
                options={[
                  { value: 1, label: TERM_LABEL[1] },
                  { value: 2, label: TERM_LABEL[2] },
                  ...(tab === 'master' ? [{ value: 0, label: 'السنوي' }] : []),
                ]}
              />
            )
          }
        />
        <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set({ tab: t.id, ...(t.id !== 'master' && term === 0 ? { term: '1' } : {}) })}
              className={cx(
                '-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition',
                tab === t.id ? 'border-primary text-primary-text' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'subjects' && <SubjectsTab classKey={key} term={(term || 1) as Term} />}
      {tab === 'students' && <StudentsTab classKey={key} />}
      {tab === 'master' && <MasterSheet classKey={key} term={term} />}
    </div>
  )
}
