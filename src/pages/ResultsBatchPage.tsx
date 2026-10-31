import { ChevronLeft, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { parseShift, useGrades, useStudents, useSubjects } from '../app/queries'
import { buildStudentReport } from '../app/results'
import { useSession } from '../app/session'
import { ResultCard, scopeLabel, type ResultScope } from '../components/ResultCard'
import { Badge, Button, Card, LoadingBlock, PageHeader, Segmented } from '../components/ui'
import { backend } from '../data'
import type { ResultStatus } from '../lib/calc'
import { yearLabel } from '../lib/format'
import { SHIFT_LABEL, TERM_LABEL, stageLabel } from '../lib/labels'
import { canSeeDepartment } from '../lib/perm'
import type { ClassKey } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

type Filter = 'all' | 'pass' | 'carry' | 'fail'
const MATCH: Record<Filter, ResultStatus[]> = {
  all: ['pass', 'pass_r2', 'carry', 'fail', 'incomplete', 'none'],
  pass: ['pass', 'pass_r2'],
  carry: ['carry'],
  fail: ['fail'],
}

/** طباعة نتائج جميع طلبة الصف (نتيجة لكل طالب في صفحة مستقلة) */
export function ResultsBatchPage() {
  const params = useParams()
  const [sp, setSp] = useSearchParams()
  const s = useSession()
  const dept = s.deptById(params.deptId)
  const stage = Number(params.stage)
  const shift = parseShift(params.shift)
  const key: ClassKey = { year_id: s.yearId, department_id: dept?.id ?? '', stage, shift }
  const scopeParam = Number(sp.get('term') ?? '1')
  const scope: ResultScope = scopeParam === 0 ? 0 : scopeParam === 2 ? 2 : 1
  const [filter, setFilter] = useState<Filter>('all')
  const subjectsQ = useSubjects(key, !!dept)
  const studentsQ = useStudents(dept ? key : null)
  const subjects = useMemo(() => subjectsQ.data ?? [], [subjectsQ.data])
  const gradesQ = useGrades(subjects.map((x) => x.id))

  const reports = useMemo(
    () =>
      (studentsQ.data ?? [])
        .filter((st) => st.status === 'active')
        .map((st) => ({ student: st, report: buildStudentReport(subjects, gradesQ.data ?? [], st.id, s.settings) })),
    [studentsQ.data, subjects, gradesQ.data, s.settings],
  )

  if (!dept || !canSeeDepartment(s.profile, dept.id)) return <NotFoundPage />
  if (subjectsQ.isLoading || studentsQ.isLoading || gradesQ.isLoading) return <LoadingBlock />
  const year = yearLabel(s.year?.label)
  const statusOf = (r: (typeof reports)[number]['report']) => (scope === 0 ? r.annual : r.sections.find((x) => x.term === scope)?.summary)?.status ?? 'none'
  const shown = reports.filter((r) => MATCH[filter].includes(statusOf(r.report)))
  const count = (f: Filter) => reports.filter((r) => MATCH[f].includes(statusOf(r.report))).length

  return (
    <div>
      <div className="no-print">
        <PageHeader
          crumbs={
            <>
              <Link to={`/departments/${dept.id}`} className="hover:text-ink">
                {dept.name}
              </Link>
              <ChevronLeft className="size-3" />
              <Link to={`/class/${dept.id}/${stage}/${shift}?tab=master&term=${scope}`} className="hover:text-ink">
                {stageLabel(stage)} — {SHIFT_LABEL[shift]}
              </Link>
            </>
          }
          title="نتائج الطلبة للطباعة"
          subtitle={`${scopeLabel(scope)} — نتيجة لكل طالب في صفحة مستقلة (A4)`}
          actions={
            <Button
              variant="primary"
              icon={<Printer className="size-4" />}
              disabled={shown.length === 0}
              onClick={() => {
                void backend.logEvent('report.print', `طباعة نتائج ${shown.length} طالب — ${dept.name} — المرحلة ${stage}`)
                window.print()
              }}
            >
              طباعة {shown.length} نتيجة
            </Button>
          }
        />
        <Card className="mb-5 flex flex-wrap items-center gap-3 px-4 py-3">
          <Segmented<number>
            value={scope}
            onChange={(v) => {
              const next = new URLSearchParams(sp)
              next.set('term', String(v))
              setSp(next, { replace: true })
            }}
            options={[
              { value: 1, label: TERM_LABEL[1] },
              { value: 2, label: TERM_LABEL[2] },
              { value: 0, label: 'الفصلان معاً' },
            ]}
          />
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            size="sm"
            options={[
              { value: 'all', label: `الكل (${count('all')})` },
              { value: 'pass', label: `ناجح (${count('pass')})` },
              { value: 'carry', label: `مكمل (${count('carry')})` },
              { value: 'fail', label: `راسب (${count('fail')})` },
            ]}
          />
          {!dept.head_name && <Badge tone="warning">لم يُحدد اسم رئيس القسم (من الإعدادات ← الأقسام)</Badge>}
        </Card>
      </div>
      <div className="space-y-8 print:space-y-0">
        {shown.map(({ student, report }) => (
          <ResultCard key={student.id} student={student} dept={dept} yearLabel={year} settings={s.settings} report={report} scope={scope} />
        ))}
        {shown.length === 0 && <Card className="no-print p-10 text-center text-sm text-muted">لا توجد نتائج مطابقة</Card>}
      </div>
    </div>
  )
}
