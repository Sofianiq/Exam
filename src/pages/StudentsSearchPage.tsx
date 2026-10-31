import { useQuery } from '@tanstack/react-query'
import { Search, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../app/session'
import { Card, EmptyState, LoadingBlock, PageHeader } from '../components/ui'
import { backend } from '../data'
import { yearLabel } from '../lib/format'
import { SHIFT_LABEL, STUDENT_STATUS_LABEL, stageLabel } from '../lib/labels'
import { canSeeAudit } from '../lib/perm'
import { NotFoundPage } from './NotFoundPage'

/** البحث عن طالب لعرض درجاته في جميع المواد */
export function StudentsSearchPage() {
  const s = useSession()
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  const resultsQ = useQuery({
    queryKey: ['student-search', s.yearId, term],
    queryFn: () => backend.searchStudents(s.yearId, term),
    enabled: term.length >= 2,
  })
  if (!canSeeAudit(s.profile)) return <NotFoundPage />
  const list = resultsQ.data ?? []

  return (
    <div className="max-w-4xl">
      <PageHeader title="البحث عن طالب" subtitle={`اعرض درجات الطالب في جميع المواد واطبع نتيجته — السنة الدراسية ${yearLabel(s.year?.label)}`} />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute inset-y-0 start-4 my-auto size-5 text-faint" />
        <input autoFocus className="field h-12 ps-12 text-base" placeholder="اكتب جزءاً من اسم الطالب (حرفان على الأقل)…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card>
        {term.length < 2 ? (
          <EmptyState icon={<Search className="size-6" />} title="ابدأ بكتابة اسم الطالب" />
        ) : resultsQ.isLoading ? (
          <LoadingBlock />
        ) : list.length === 0 ? (
          <EmptyState icon={<UserRound className="size-6" />} title="لا توجد نتائج">
            تأكد من السنة الدراسية المختارة في الأعلى.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((st) => (
              <li key={st.id}>
                <Link to={`/student/${st.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 transition hover:bg-surface-2/60">
                  <span className="font-medium">{st.full_name}</span>
                  <span className="text-xs text-muted">
                    {s.deptById(st.department_id)?.name} — {stageLabel(st.stage)} — {SHIFT_LABEL[st.shift]}
                    {st.status !== 'active' && ` — ${STUDENT_STATUS_LABEL[st.status]}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
