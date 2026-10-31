import { Award, CheckCircle2, CircleSlash, Eye, Hourglass, Printer, Search, Users, XCircle } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { parseShift, useGrades, useStudents, useSubjects } from '../app/queries'
import { buildStudentReport } from '../app/results'
import { useSession } from '../app/session'
import { ResultSheets, scopeLabel, type ResultScope, type SlipProps } from '../components/ResultSlip'
import { Badge, Button, Callout, Card, EmptyState, LoadingBlock, PageHeader, Segmented, Select, StatCard, cx } from '../components/ui'
import { backend } from '../data'
import type { ResultStatus, StudentSummary } from '../lib/calc'
import { fmtNum, fmtPct, yearLabel } from '../lib/format'
import { SHIFT_LABEL, STUDENT_STATUS_LABEL, TERM_LABEL, stageShort } from '../lib/labels'
import { normalizeArabic } from '../lib/parse'
import { canSeeAudit, canSeeDepartment } from '../lib/perm'
import type { ClassKey, Shift } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

type Filter = 'all' | 'pass' | 'carry' | 'fail' | 'incomplete'
const MATCH: Record<Filter, ResultStatus[]> = {
  all: ['pass', 'pass_r2', 'carry', 'fail', 'incomplete', 'none'],
  pass: ['pass', 'pass_r2'],
  carry: ['carry'],
  fail: ['fail'],
  incomplete: ['incomplete', 'none'],
}
const STATUS_TONE: Record<ResultStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pass: 'success',
  pass_r2: 'success',
  carry: 'warning',
  fail: 'danger',
  incomplete: 'neutral',
  none: 'neutral',
}
const STATUS_SHORT: Record<ResultStatus, string> = {
  pass: 'ناجح',
  pass_r2: 'ناجح (د2)',
  carry: 'مكمل',
  fail: 'راسب',
  incomplete: 'غير مكتملة',
  none: 'لم تُرصد',
}

/** صفحة النتائج: نتائج طلبة كل قسم ومرحلة ودراسة، مع طباعة النتيجة الرسمية (نتيجتان في كل صفحة A4 أفقية) */
export function ResultsPage() {
  const s = useSession()
  const [sp, setSp] = useSearchParams()
  const isHead = s.profile.role === 'head'
  const deptId = isHead ? (s.profile.department_id ?? '') : (sp.get('dept') ?? s.departments[0]?.id ?? '')
  const dept = s.deptById(deptId)
  const stage = Math.min(Math.max(Number(sp.get('stage') ?? '1') || 1, 1), dept?.stages ?? 4)
  const shift: Shift = dept?.has_evening ? parseShift(sp.get('shift') ?? undefined) : 'morning'
  const termParam = Number(sp.get('term') ?? '1')
  const scope: ResultScope = termParam === 0 ? 0 : termParam === 2 ? 2 : 1
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  // التحديد يخص الصف والفصل المعروضين فقط، ويُلغى عند تغيير أي منهما (ولو بأزرار الرجوع في المتصفح)
  const selKey = `${deptId}|${stage}|${shift}|${scope}`
  const [sel, setSel] = useState<{ key: string; ids: Set<string> }>({ key: selKey, ids: new Set() })
  const picked = sel.key === selKey ? sel.ids : new Set<string>()
  const setPicked = (f: Set<string> | ((p: Set<string>) => Set<string>)) => setSel({ key: selKey, ids: typeof f === 'function' ? f(picked) : f })

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp)
    next.set(k, v)
    setSp(next, { replace: true })
  }

  const key: ClassKey = { year_id: s.yearId, department_id: deptId, stage, shift }
  const subjectsQ = useSubjects(key, !!dept)
  const studentsQ = useStudents(dept ? key : null)
  const subjects = useMemo(() => subjectsQ.data ?? [], [subjectsQ.data])
  const gradesQ = useGrades(subjects.map((x) => x.id))

  const rows = useMemo(
    () =>
      (studentsQ.data ?? []).map((st) => {
        // النتيجة الرسمية: المعتمد من اللجنة الامتحانية فقط (تطابق صفحة التحقق برمز QR)
        const report = buildStudentReport(subjects, gradesQ.data ?? [], st.id, s.settings, true)
        const summary: StudentSummary | undefined = scope === 0 ? report.annual : report.sections.find((x) => x.term === scope)?.summary
        return { student: st, report, summary, status: (summary?.status ?? 'none') as ResultStatus }
      }),
    [studentsQ.data, subjects, gradesQ.data, s.settings, scope],
  )

  if (!canSeeAudit(s.profile)) return <NotFoundPage />
  if (dept && !canSeeDepartment(s.profile, dept.id)) return <NotFoundPage />

  const active = rows.filter((r) => r.student.status === 'active')
  const count = (f: Filter) => active.filter((r) => MATCH[f].includes(r.status)).length
  const t = normalizeArabic(q)
  const shown = rows.filter((r) => (filter === 'all' || (r.student.status === 'active' && MATCH[filter].includes(r.status))) && (!t || normalizeArabic(r.student.full_name).includes(t)))
  const shownActive = shown.filter((r) => r.student.status === 'active')
  const toPrint = picked.size ? shown.filter((r) => picked.has(r.student.id)) : shownActive
  const year = yearLabel(s.year?.label)
  const slips: SlipProps[] = toPrint.map((r) => ({ student: r.student, dept, yearLabel: year, settings: s.settings, report: r.report, scope }))
  const passed = count('pass')
  const decided = passed + count('carry') + count('fail')
  const allPicked = shownActive.length > 0 && shownActive.every((r) => picked.has(r.student.id))
  const pendingSubjects = subjects.filter((x) => (scope === 0 || x.term === scope) && (x.status !== 'approved' || (x.r2_status !== 'approved' && x.r2_status !== 'draft'))).length
  const loading = subjectsQ.isLoading || studentsQ.isLoading || (subjects.length > 0 && gradesQ.isLoading)

  const print = () => {
    void backend.logEvent('report.print', `طباعة ${toPrint.length} نتيجة — ${dept?.name ?? ''} — المرحلة ${stageShort(stage)} — ${scopeLabel(scope)}`)
    window.print()
  }

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="النتائج"
          subtitle="نتائج الطلبة حسب القسم والمرحلة والدراسة، وطباعة النتيجة الرسمية بنموذج A4 أفقي (نتيجتان في كل صفحة)"
          actions={
            <Button variant="primary" icon={<Printer className="size-4" />} disabled={toPrint.length === 0} onClick={print} data-print-results>
              {picked.size ? `طباعة المحدد (${toPrint.length})` : `طباعة النتائج (${toPrint.length})`}
            </Button>
          }
        />

        <Card className="mb-5 space-y-3 px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={deptId} disabled={isHead} onChange={(e) => setParam('dept', e.target.value)} className="w-auto min-w-52" aria-label="القسم">
              {s.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  قسم {d.name}
                </option>
              ))}
            </Select>
            <Segmented<number>
              value={stage}
              onChange={(v) => setParam('stage', String(v))}
              options={Array.from({ length: dept?.stages ?? 4 }, (_, i) => ({ value: i + 1, label: `المرحلة ${stageShort(i + 1)}` }))}
            />
            {dept?.has_evening && (
              <Segmented<Shift>
                value={shift}
                onChange={(v) => setParam('shift', v)}
                options={[
                  { value: 'morning', label: SHIFT_LABEL.morning },
                  { value: 'evening', label: SHIFT_LABEL.evening },
                ]}
              />
            )}
            <Segmented<number>
              value={scope}
              onChange={(v) => setParam('term', String(v))}
              options={[
                { value: 1, label: TERM_LABEL[1] },
                { value: 2, label: TERM_LABEL[2] },
                { value: 0, label: 'الفصلان معاً' },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented<Filter>
              value={filter}
              onChange={(v) => {
                setFilter(v)
                setPicked(new Set())
              }}
              size="sm"
              options={[
                { value: 'all', label: `الكل (${active.length})` },
                { value: 'pass', label: `ناجح (${count('pass')})` },
                { value: 'carry', label: `مكمل (${count('carry')})` },
                { value: 'fail', label: `راسب (${count('fail')})` },
                { value: 'incomplete', label: `غير مكتملة (${count('incomplete')})` },
              ]}
            />
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-faint" />
              <input className="field ps-9" placeholder="بحث باسم الطالب…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {!dept?.head_name && <Badge tone="warning">لم يُحدد اسم رئيس القسم (الإعدادات ← الأقسام)</Badge>}
          </div>
        </Card>

        {pendingSubjects > 0 && (
          <Callout tone="warning" className="mb-5" title={`${pendingSubjects} من مواد ${scope === 0 ? 'الصف' : TERM_LABEL[scope]} غير معتمدة بعد`}>
            النتيجة الرسمية تعتمد على القوائم المعتمدة من اللجنة الامتحانية فقط (وكذلك صفحة التحقق برمز QR)، لذلك تظهر هذه المواد «غير مكتملة» حتى اعتمادها.
            ودرجات الدور الثاني تظهر بعد اعتماد قائمة الدور الثاني.
          </Callout>
        )}

        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <StatCard label="عدد الطلبة" value={active.length} icon={<Users className="size-5" />} />
          <StatCard label="الناجحون" value={passed} hint={decided ? `نسبة النجاح ${fmtPct(passed / decided)}` : undefined} icon={<CheckCircle2 className="size-5" />} tone="success" />
          <StatCard label="المكملون" value={count('carry')} icon={<Hourglass className="size-5" />} tone="warning" />
          <StatCard label="الراسبون" value={count('fail')} icon={<XCircle className="size-5" />} tone="danger" />
          <StatCard label="نتائج غير مكتملة" value={count('incomplete')} icon={<CircleSlash className="size-5" />} tone="neutral" />
        </div>

        <Card className="mb-6">
          {loading ? (
            <LoadingBlock />
          ) : !dept ? (
            <EmptyState icon={<Award className="size-6" />} title="اختر قسماً لعرض نتائجه" />
          ) : rows.length === 0 ? (
            <EmptyState icon={<Users className="size-6" />} title="لا يوجد طلبة في هذا الصف" />
          ) : subjects.length === 0 ? (
            <EmptyState icon={<Award className="size-6" />} title="لا توجد مواد لهذا الصف في السنة الحالية" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        aria-label="تحديد الكل"
                        checked={allPicked}
                        onChange={(e) => setPicked(e.target.checked ? new Set(shownActive.map((r) => r.student.id)) : new Set())}
                      />
                    </th>
                    <th className="w-12">ت</th>
                    <th>اسم الطالب</th>
                    <th className="text-center">المعدل</th>
                    <th className="text-center">التقدير العام</th>
                    <th className="text-center">النتيجة</th>
                    <th>المواد غير المجتازة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const failed =
                      r.status === 'fail' ? (r.summary?.finalFailed.length ? r.summary.finalFailed : (r.summary?.r1Failed ?? [])) : r.status === 'carry' ? (r.summary?.pendingR2 ?? []) : []
                    const inactive = r.student.status !== 'active'
                    return (
                      <tr key={r.student.id} className={cx(inactive && 'opacity-55')}>
                        <td>
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--primary)]"
                            aria-label={`تحديد ${r.student.full_name}`}
                            checked={picked.has(r.student.id)}
                            onChange={(e) =>
                              setPicked((p) => {
                                const n = new Set(p)
                                if (e.target.checked) n.add(r.student.id)
                                else n.delete(r.student.id)
                                return n
                              })
                            }
                          />
                        </td>
                        <td className="tabular-nums text-muted">{r.student.seq}</td>
                        <td className="font-medium">
                          <Link to={`/student/${r.student.id}`} className="hover:text-primary-text hover:underline">
                            {r.student.full_name}
                          </Link>
                        </td>
                        <td className="text-center tabular-nums">{fmtNum(r.summary?.average) || '—'}</td>
                        <td className="text-center font-semibold text-primary-text">{r.summary?.averageLabel ?? '—'}</td>
                        <td className="text-center">
                          {inactive ? <Badge tone="warning">{STUDENT_STATUS_LABEL[r.student.status]}</Badge> : <Badge tone={STATUS_TONE[r.status]}>{STATUS_SHORT[r.status]}</Badge>}
                        </td>
                        <td className="max-w-80 text-sm text-danger">{failed.join('، ')}</td>
                        <td>
                          <Link to={`/student/${r.student.id}`}>
                            <Button size="sm" icon={<Eye className="size-4" />}>
                              عرض
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {slips.length > 0 && (
          <>
            <h2 className="mb-3 flex flex-wrap items-baseline gap-2 font-semibold">
              معاينة الطباعة
              <span className="text-sm font-normal text-muted">
                — {scopeLabel(scope)} — {slips.length} نتيجة في {Math.ceil(slips.length / 2)} صفحة A4 أفقية (تُعرض الصفحة الأولى)
              </span>
            </h2>
            <ScaledPreview>
              <ResultSheets items={slips.slice(0, 2)} className="slip-preview" />
            </ScaledPreview>
          </>
        )}
      </div>
      <ResultSheets items={slips} className="print-only" />
    </div>
  )
}

/** يصغّر صفحة A4 الأفقية لتناسب عرض الشاشة مع بقاء قياساتها الحقيقية للطباعة */
export function ScaledPreview({ children, pages = 1 }: { children: ReactNode; pages?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.7)
  const W = 1123 // 297mm بالبكسل
  const H = 794 // 210mm
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setScale(Math.min(1, el.clientWidth / W))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className="w-full overflow-hidden">
      <div style={{ height: H * scale * pages + 8 }}>
        <div style={{ width: W, transform: `scale(${scale})`, transformOrigin: 'top right' }}>{children}</div>
      </div>
    </div>
  )
}
