import { useQuery } from '@tanstack/react-query'
import { AlertOctagon, AlertTriangle, ArrowLeft, CheckCircle2, Info, RefreshCw, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LEVEL_ORDER, runHealthCheck, type HealthLevel } from '../app/health'
import { useGrades, useSubjects } from '../app/queries'
import { useSession } from '../app/session'
import { errorText } from '../components/feedback'
import { Badge, Button, Callout, Card, CardHeader, EmptyState, LoadingBlock, PageHeader, Segmented, Select, StatCard, cx } from '../components/ui'
import { backend } from '../data'
import { SHIFT_LABEL, stageShort } from '../lib/labels'
import { canViewAll } from '../lib/perm'
import { NotFoundPage } from './NotFoundPage'

const LEVEL: Record<HealthLevel, { label: string; plural: string; tone: 'danger' | 'warning' | 'info'; icon: React.ReactNode; bar: string }> = {
  error: { label: 'خطأ', plural: 'أخطاء', tone: 'danger', icon: <AlertOctagon className="size-5" />, bar: 'bg-danger' },
  warning: { label: 'تنبيه', plural: 'تنبيهات', tone: 'warning', icon: <AlertTriangle className="size-5" />, bar: 'bg-warning' },
  info: { label: 'ملاحظة', plural: 'ملاحظات', tone: 'info', icon: <Info className="size-5" />, bar: 'bg-info' },
}

/**
 * فحص سلامة البيانات: قراءة فقط. يكشف قبل الاعتماد والنشر ما قد يجعل النتائج غير مكتملة أو غير صحيحة
 * (درجات ناقصة في قوائم معتمدة، أسماء أو أرقام جامعية مكررة، مواد بلا وحدات، …) مع رابط للإصلاح.
 */
export function HealthPage() {
  const s = useSession()
  const isHead = s.profile.role === 'head'
  const [dept, setDept] = useState(isHead ? (s.profile.department_id ?? '') : '')
  const [level, setLevel] = useState<HealthLevel | 'all'>('all')
  const subjectsQ = useSubjects({ year_id: s.yearId })
  const studentsQ = useQuery({ queryKey: ['year-students', s.yearId], queryFn: () => backend.listYearStudents(s.yearId), enabled: !!s.yearId })
  const subjects = useMemo(() => (subjectsQ.data ?? []).filter((x) => !dept || x.department_id === dept), [subjectsQ.data, dept])
  const gradesQ = useGrades(subjects.map((x) => x.id))
  const students = useMemo(() => (studentsQ.data ?? []).filter((x) => !dept || x.department_id === dept), [studentsQ.data, dept])
  const loading = subjectsQ.isLoading || studentsQ.isLoading || (subjects.length > 0 && gradesQ.isLoading)
  const error = subjectsQ.error ?? studentsQ.error ?? gradesQ.error

  const report = useMemo(
    () => (loading ? null : runHealthCheck({ subjects, students, grades: gradesQ.data ?? [], settings: s.settings })),
    [loading, subjects, students, gradesQ.data, s.settings],
  )

  if (!canViewAll(s.profile) && !isHead) return <NotFoundPage />

  const refetch = () => {
    void subjectsQ.refetch()
    void studentsQ.refetch()
    void gradesQ.refetch()
  }
  const busy = subjectsQ.isFetching || studentsQ.isFetching || gradesQ.isFetching
  const shown = (report?.issues ?? []).filter((i) => level === 'all' || i.level === level)
  const where = (i: { department_id: string; stage: number; shift: 'morning' | 'evening' }) =>
    `${dept ? '' : `${s.deptById(i.department_id)?.name ?? ''} — `}المرحلة ${stageShort(i.stage)} ${SHIFT_LABEL[i.shift]}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="فحص سلامة البيانات"
        subtitle="يكشف قبل الاعتماد والنشر ما قد يجعل النتائج غير مكتملة أو غير صحيحة، مع رابط للإصلاح. الفحص قراءة فقط ولا يغيّر أي بيانات."
        actions={
          <>
            {!isHead && (
              <Select aria-label="القسم" className="w-auto min-w-48" value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">كل الأقسام</option>
                {s.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
            <Button icon={<RefreshCw className={cx('size-4', busy && 'animate-spin')} />} onClick={refetch} disabled={busy}>
              إعادة الفحص
            </Button>
          </>
        }
      />

      {error ? (
        <Callout tone="danger">{errorText(error)}</Callout>
      ) : loading || !report ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {LEVEL_ORDER.map((l) => (
              <StatCard key={l} label={LEVEL[l].plural} value={report.counts[l]} icon={LEVEL[l].icon} tone={report.counts[l] ? LEVEL[l].tone : 'success'} />
            ))}
            <StatCard
              label="ما فُحص"
              value={report.checked.subjects}
              hint={`مادة — ${report.checked.students} طالب — ${report.checked.grades} درجة`}
              icon={<ShieldCheck className="size-5" />}
              tone="primary"
            />
          </div>

          <Card>
            <CardHeader
              title="النتائج"
              subtitle={report.issues.length ? 'ابدأ بالأخطاء: تجعل نتائج الطلبة غير مكتملة أو غير صحيحة' : undefined}
              icon={<ShieldCheck className="size-5" />}
              actions={
                report.issues.length > 0 && (
                  <Segmented<HealthLevel | 'all'>
                    size="sm"
                    value={level}
                    onChange={setLevel}
                    options={[{ value: 'all', label: `الكل (${report.issues.length})` }, ...LEVEL_ORDER.filter((l) => report.counts[l]).map((l) => ({ value: l, label: `${LEVEL[l].plural} (${report.counts[l]})` }))]}
                  />
                )
              }
            />
            {report.issues.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="size-6 text-success" />} title="لم تُكتشف أي مشكلة">
                البيانات المفحوصة سليمة: لا درجات ناقصة في القوائم المعتمدة، ولا أسماء أو أرقام جامعية مكررة.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {shown.map((i, k) => (
                  <li key={`${i.kind}-${i.link}-${k}`} className="relative flex items-start gap-3 px-5 py-3.5" data-health={i.kind}>
                    <span className={cx('absolute inset-y-0 start-0 w-1', LEVEL[i.level].bar)} />
                    <span className={cx('mt-0.5 shrink-0', i.level === 'error' ? 'text-danger' : i.level === 'warning' ? 'text-warning' : 'text-info')}>{LEVEL[i.level].icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="text-sm text-ink">{i.title}</b>
                        <Badge tone={LEVEL[i.level].tone}>{LEVEL[i.level].label}</Badge>
                        <span className="text-xs text-muted">{where(i)}</span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{i.detail}</p>
                    </div>
                    <Link to={i.link} className="shrink-0">
                      <Button size="sm" icon={<ArrowLeft className="size-4" />}>
                        فتح
                      </Button>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <p className="text-xs text-muted">
            يشمل الفحص السنة الدراسية المختارة من أعلى الصفحة. القوائم غير المعتمدة لا تُعد درجاتها الناقصة خطأً لأن الإدخال ما زال جارياً.
          </p>
        </>
      )}
    </div>
  )
}
