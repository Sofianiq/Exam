import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Award, BarChart3, FileSpreadsheet, GraduationCap, Printer, RotateCcw, TrendingDown, TrendingUp, UserX, Users } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { printPage, usePrinting } from '../app/print'
import { useGrades, useSubjects } from '../app/queries'
import { useSession } from '../app/session'
import { SCOPE_LABEL, buildStatistics, type Band, type ClassStat, type CollegeStat, type Counts, type DeptStat, type GroupStat, type StatScope } from '../app/statistics'
import { useToast } from '../components/feedback'
import { PrintHeader, PrintSignatures } from '../components/PrintParts'
import { Badge, Button, Callout, Card, CardHeader, Checkbox, EmptyState, LoadingBlock, PageHeader, Segmented, Select, StatCard, cx } from '../components/ui'
import { backend } from '../data'
import { fmtNum, fmtPct } from '../lib/format'
import { SHIFT_LABEL, stageLabel } from '../lib/labels'
import { canViewAll } from '../lib/perm'
import { NotFoundPage } from './NotFoundPage'

type View = 'college' | 'department'

export function StatisticsPage() {
  const s = useSession()
  if (!canViewAll(s.profile) && s.profile.role !== 'head') return <NotFoundPage />
  return <Statistics />
}

function Statistics() {
  const s = useSession()
  const toast = useToast()
  const printing = usePrinting()
  const isHead = s.profile.role === 'head'
  const [scope, setScope] = useState<StatScope>(1)
  const [view, setView] = useState<View>(isHead ? 'department' : 'college')
  const [deptPick, setDeptPick] = useState<string>(isHead ? (s.profile.department_id ?? '') : '')
  const [official, setOfficial] = useState(true)
  const [withDepts, setWithDepts] = useState(true)
  const [exporting, setExporting] = useState(false)

  const subjectsQ = useSubjects({ year_id: s.yearId })
  const studentsQ = useQuery({ queryKey: ['students-year', s.yearId], queryFn: () => backend.listYearStudents(s.yearId), enabled: !!s.yearId })
  const subjects = useMemo(() => subjectsQ.data ?? [], [subjectsQ.data])
  const gradesQ = useGrades(subjects.map((x) => x.id))
  const loading = subjectsQ.isLoading || studentsQ.isLoading || (subjects.length > 0 && gradesQ.isLoading)

  const stats = useMemo<CollegeStat | null>(
    () =>
      loading
        ? null
        : buildStatistics({ subjects, students: studentsQ.data ?? [], grades: gradesQ.data ?? [], settings: s.settings, departments: s.departments, scope, official }),
    [loading, subjects, studentsQ.data, gradesQ.data, s.settings, s.departments, scope, official],
  )

  const deptStat = stats?.departments.find((d) => d.department.id === deptPick) ?? (view === 'department' ? stats?.departments[0] : undefined)
  const openDept = (id: string) => {
    setDeptPick(id)
    setView('department')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const exportXlsx = async () => {
    if (!stats) return
    setExporting(true)
    try {
      const m = await import('../lib/statsExcel')
      await m.exportStatistics(stats, {
        university: s.settings.university_name,
        college: s.settings.college_name,
        year: s.year?.label ?? '',
        onlyDepartment: isHead ? deptStat?.department.id : undefined,
        official,
      })
      void backend.logEvent('report.export', `تصدير إحصائيات اللجنة الامتحانية — ${SCOPE_LABEL[scope]}`)
    } catch (e) {
      toast.error(e)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <div className="no-print space-y-6">
        <PageHeader
          title="إحصائيات اللجنة الامتحانية"
          subtitle={`العام الدراسي ${s.year?.label ?? ''} — ${SCOPE_LABEL[scope]}${official ? ' (النتائج المعتمدة)' : ' (كل الدرجات المدخلة)'}`}
          actions={
            stats && (
              <>
                <Button icon={<FileSpreadsheet className="size-4" />} loading={exporting} onClick={exportXlsx}>
                  تصدير Excel
                </Button>
                <Button
                  variant="primary"
                  icon={<Printer className="size-4" />}
                  onClick={() => {
                    void backend.logEvent('report.print', `طباعة إحصائيات اللجنة الامتحانية — ${SCOPE_LABEL[scope]}`)
                    printPage()
                  }}
                >
                  طباعة / PDF
                </Button>
              </>
            )
          }
        />

        <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Segmented<StatScope>
            value={scope}
            onChange={setScope}
            options={[
              { value: 1, label: 'الفصل الأول' },
              { value: 2, label: 'الفصل الثاني' },
              { value: 0, label: 'النتيجة السنوية' },
            ]}
          />
          {!isHead && (
            <Segmented<View>
              value={view}
              onChange={setView}
              options={[
                { value: 'college', label: 'الكلية' },
                { value: 'department', label: 'قسم محدد' },
              ]}
            />
          )}
          {view === 'department' && !isHead && stats && (
            <Select aria-label="القسم" className="w-auto min-w-56" value={deptStat?.department.id ?? ''} onChange={(e) => setDeptPick(e.target.value)}>
              {stats.departments.map((d) => (
                <option key={d.department.id} value={d.department.id}>
                  {d.department.name}
                </option>
              ))}
            </Select>
          )}
          <div className="ms-auto flex flex-wrap items-center gap-4">
            <Checkbox checked={official} onChange={setOfficial} label="النتائج المعتمدة فقط" />
            {view === 'college' && !isHead && <Checkbox checked={withDepts} onChange={setWithDepts} label="تضمين تفاصيل الأقسام في الطباعة" />}
          </div>
        </Card>

        {loading && <LoadingBlock label="جارٍ احتساب الإحصائيات…" />}
        {stats && stats.unapproved > 0 && official && (
          <Callout tone="warning" icon={<AlertTriangle className="size-5" />}>
            {stats.unapproved} {stats.unapproved === 1 ? 'قائمة لم تُعتمد' : 'قوائم لم تُعتمد'} بعد في {SCOPE_LABEL[scope]}؛ طلبتها يظهرون «غير مكتملة» في الإحصائية الرسمية. ألغِ
            خيار «النتائج المعتمدة فقط» لرؤية الإحصائية الأولية بكل الدرجات المدخلة.
          </Callout>
        )}
        {stats && stats.departments.length === 0 && (
          <Card>
            <EmptyState icon={<BarChart3 className="size-6" />} title="لا توجد بيانات لهذا النطاق">
              لا توجد مواد أو طلبة في {SCOPE_LABEL[scope]} للعام الدراسي المختار.
            </EmptyState>
          </Card>
        )}
        {stats && stats.departments.length > 0 && view === 'college' && <CollegeView st={stats} onOpen={openDept} />}
        {stats && deptStat && view === 'department' && <DepartmentView d={deptStat} scope={scope} />}
      </div>

      {printing && stats && (
        <div className="print-only print-landscape">
          {view === 'college' ? (
            <>
              <CollegePrint st={stats} official={official} />
              {withDepts &&
                stats.departments.map((d) => (
                  <div key={d.department.id} style={{ breakBefore: 'page' }}>
                    <DeptPrint d={d} scope={scope} official={official} />
                  </div>
                ))}
            </>
          ) : (
            deptStat && <DeptPrint d={deptStat} scope={scope} official={official} />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// الرسوم: شريط نسبة (لون واحد) وشريط تركيب النتيجة (ناجح/مكمل/راسب/غير مكتمل)
// ---------------------------------------------------------------------

function RateBar({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <div className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`نسبة النجاح ${fmtPct(value)}`}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${(value ?? 0) * 100}%` }} />
      </div>
      <span className="w-12 shrink-0 text-end text-xs font-semibold tabular-nums">{fmtPct(value)}</span>
    </div>
  )
}

const PARTS: { k: 'pass' | 'carry' | 'fail' | 'incomplete'; label: string; cls: string }[] = [
  { k: 'pass', label: 'ناجح', cls: 'bg-success' },
  { k: 'carry', label: 'مكمل', cls: 'bg-warning' },
  { k: 'fail', label: 'راسب', cls: 'bg-danger' },
  { k: 'incomplete', label: 'غير مكتمل', cls: 'bg-faint' },
]

function OutcomeBar({ c }: { c: Counts }) {
  const total = c.students || 1
  return (
    <div className="flex h-2.5 min-w-28 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={PARTS.map((p) => `${p.label} ${c[p.k]}`).join('، ')}>
      {PARTS.filter((p) => c[p.k] > 0).map((p) => (
        <div key={p.k} className={cx('h-full first:rounded-s-full last:rounded-e-full', p.cls)} style={{ width: `${(c[p.k] / total) * 100}%` }} title={`${p.label}: ${c[p.k]}`} />
      ))}
    </div>
  )
}

function OutcomeLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {PARTS.map((p) => (
        <span key={p.k} className="inline-flex items-center gap-1.5">
          <span className={cx('size-2.5 rounded-sm', p.cls)} />
          {p.label}
        </span>
      ))}
    </div>
  )
}

function Kpis({ c, extra }: { c: Counts; extra?: ReactNode }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <StatCard label="الطلبة" value={c.students} hint={c.incomplete ? `${c.incomplete} نتيجة غير مكتملة` : 'كل النتائج مكتملة'} icon={<Users className="size-5" />} />
      <StatCard label="نسبة النجاح" value={fmtPct(c.passRate)} hint={`من ${c.decided} طالب حُسمت نتيجتهم أو مكملين`} icon={<TrendingUp className="size-5" />} tone="success" />
      <StatCard
        label="الناجحون"
        value={c.pass}
        hint={[c.passR2 && `${c.passR2} بالدور الثاني`, c.byDecision && `${c.byDecision} بقرار`, c.passCarry && `${c.passCarry} بالتحميل`].filter(Boolean).join(' · ') || '—'}
        icon={<GraduationCap className="size-5" />}
        tone="success"
      />
      <StatCard label="المكملون" value={c.carry} hint="بانتظار الدور الثاني" icon={<RotateCcw className="size-5" />} tone="warning" />
      <StatCard label="الراسبون" value={c.fail} hint="بعد الدور الثاني" icon={<UserX className="size-5" />} tone="danger" />
      <StatCard label="المعدل العام" value={fmtNum(c.average) || '—'} hint={c.highest != null ? `أعلى معدل ${fmtNum(c.highest)}` : undefined} icon={<Award className="size-5" />} tone="gold" />
      {extra}
    </div>
  )
}

function BandsChart({ bands, title = 'توزيع معدلات الطلبة حسب التقدير' }: { bands: Band[]; title?: string }) {
  const total = bands.reduce((a, b) => a + b.count, 0)
  const max = Math.max(1, ...bands.map((b) => b.count))
  const ordered = [...bands].sort((a, b) => a.min - b.min)
  return (
    <Card>
      <CardHeader title={title} subtitle={`${total} طالب`} icon={<BarChart3 className="size-5" />} />
      {total === 0 ? (
        <EmptyState title="لا توجد معدلات بعد">تظهر بعد اكتمال درجات الطلبة في كل المواد.</EmptyState>
      ) : (
        <>
      <div className="flex h-52 items-end gap-3 px-5 pt-6 pb-2" role="img" aria-label={ordered.map((b) => `${b.label} ${b.count}`).join('، ')}>
        {ordered.map((b) => (
          <div key={b.label} className="group flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${b.label} (${b.min}–${b.upper}): ${b.count} طالب`}>
            <span className="text-xs font-semibold tabular-nums">{b.count}</span>
            <div className="w-full max-w-14 rounded-t bg-primary transition group-hover:opacity-80" style={{ height: `${(b.count / max) * 75}%`, minHeight: b.count ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-3 border-t border-line px-5 py-2">
        {ordered.map((b) => (
          <div key={b.label} className="flex-1 text-center text-xs">
            <div className="font-medium">{b.label}</div>
            <div className="text-muted tabular-nums">{fmtPct(total ? b.count / total : null)}</div>
          </div>
        ))}
      </div>
        </>
      )}
    </Card>
  )
}

function CountCells({ c }: { c: Counts }) {
  return (
    <>
      <td className="text-center tabular-nums">{c.students}</td>
      <td className="text-center tabular-nums text-success">{c.pass}</td>
      <td className="text-center tabular-nums text-warning">{c.carry}</td>
      <td className="text-center tabular-nums text-danger">{c.fail}</td>
      <td className="text-center tabular-nums text-muted">{c.incomplete || '—'}</td>
      <td className="min-w-40">
        <RateBar value={c.passRate} />
      </td>
      <td className="min-w-32">
        <OutcomeBar c={c} />
      </td>
      <td className="text-center font-semibold tabular-nums">{fmtNum(c.average) || '—'}</td>
    </>
  )
}

const COUNT_HEADS = ['الطلبة', 'ناجح', 'مكمل', 'راسب', 'غير مكتمل', 'نسبة النجاح', 'تركيب النتيجة', 'المعدل']

function GroupTable({ title, rows }: { title: string; rows: GroupStat[] }) {
  if (!rows.length) return null
  return (
    <Card>
      <CardHeader title={title} />
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>الفئة</th>
              {COUNT_HEADS.map((h) => (
                <th key={h} className="text-center">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.label}>
                <td className="font-medium whitespace-nowrap">{g.label}</td>
                <CountCells c={g.counts} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------
// إحصائيات الكلية
// ---------------------------------------------------------------------

function CollegeView({ st, onOpen }: { st: CollegeStat; onOpen: (id: string) => void }) {
  return (
    <div className="space-y-6">
      <Kpis c={st.counts} />
      <Card>
        <CardHeader title="النتائج حسب القسم" subtitle="اضغط اسم القسم لعرض إحصائياته التفصيلية" icon={<BarChart3 className="size-5" />} actions={<OutcomeLegend />} />
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>القسم</th>
                {COUNT_HEADS.map((h) => (
                  <th key={h} className="text-center">
                    {h}
                  </th>
                ))}
                <th className="text-center">أعلى معدل</th>
              </tr>
            </thead>
            <tbody>
              {[...st.departments]
                .sort((a, b) => (b.counts.passRate ?? -1) - (a.counts.passRate ?? -1))
                .map((d) => (
                  <tr key={d.department.id}>
                    <td className="font-medium whitespace-nowrap">
                      <button type="button" className="hover:text-primary-text hover:underline" onClick={() => onOpen(d.department.id)}>
                        {d.department.name}
                      </button>
                    </td>
                    <CountCells c={d.counts} />
                    <td className="text-center tabular-nums text-muted">{fmtNum(d.counts.highest) || '—'}</td>
                  </tr>
                ))}
              <tr className="bg-surface-2/60 font-semibold">
                <td>الكلية</td>
                <CountCells c={st.counts} />
                <td className="text-center tabular-nums">{fmtNum(st.counts.highest) || '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <GroupTable title="حسب المرحلة الدراسية" rows={st.byStage} />
        <div className="space-y-6">
          <GroupTable title="حسب نوع الدراسة" rows={st.byShift} />
          <GroupTable title="حسب الجنس" rows={st.byGender} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <BandsChart bands={st.bands} />
        <RoundTwoCard depts={st.departments} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="المواد الأقل نسبة نجاح" subtitle="المواد التي فيها 5 طلبة على الأقل حُسمت نتيجتهم" icon={<TrendingDown className="size-5" />} />
          {st.hardest.length === 0 ? (
            <EmptyState title="لا توجد بيانات كافية" />
          ) : (
            <table className="table-base">
              <thead>
                <tr>
                  <th>المادة</th>
                  <th className="text-center">ناجح / راسب</th>
                  <th className="text-center">نسبة النجاح</th>
                  <th className="text-center">المعدل</th>
                </tr>
              </thead>
              <tbody>
                {st.hardest.map((x) => (
                  <tr key={x.subject.id}>
                    <td>
                      <div className="font-medium">{x.subject.name}</div>
                      <div className="text-xs text-muted">
                        {x.department.name} — {stageLabel(x.subject.stage)} — {SHIFT_LABEL[x.subject.shift]}
                      </div>
                    </td>
                    <td className="text-center tabular-nums">
                      {x.pass} / <span className="text-danger">{x.fail}</span>
                    </td>
                    <td className="min-w-36">
                      <RateBar value={x.passRate} />
                    </td>
                    <td className="text-center tabular-nums">{fmtNum(x.average)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <TopCard
          title="أوائل الكلية"
          rows={st.top.map((t) => ({ name: t.student.full_name, sub: `${t.department.name} — ${stageLabel(t.cls.stage)} — ${SHIFT_LABEL[t.cls.shift]}`, average: t.average, label: t.label }))}
        />
      </div>
    </div>
  )
}

function RoundTwoCard({ depts }: { depts: DeptStat[] }) {
  const rows = depts.map((d) => {
    const need = d.subjects.reduce((a, x) => a + x.needR2, 0)
    const sat = d.subjects.reduce((a, x) => a + x.satR2, 0)
    const passed = d.subjects.reduce((a, x) => a + x.passR2, 0)
    const dec = d.subjects.reduce((a, x) => a + x.byDecision, 0)
    return { d, need, sat, passed, dec }
  })
  const need = rows.reduce((a, r) => a + r.need, 0)
  const sat = rows.reduce((a, r) => a + r.sat, 0)
  const passed = rows.reduce((a, r) => a + r.passed, 0)
  return (
    <Card>
      <CardHeader title="الدور الثاني ودرجات القرار" subtitle="عدد حالات المواد (طالب × مادة)" icon={<RotateCcw className="size-5" />} />
      <table className="table-base">
        <thead>
          <tr>
            <th>القسم</th>
            <th className="text-center">مكمل في مادة</th>
            <th className="text-center">امتحن</th>
            <th className="text-center">نجح</th>
            <th className="text-center">نسبة النجاح فيه</th>
            <th className="text-center">نجاح بقرار</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.d.department.id}>
              <td className="font-medium whitespace-nowrap">{r.d.department.name}</td>
              <td className="text-center tabular-nums">{r.need}</td>
              <td className="text-center tabular-nums">{r.sat}</td>
              <td className="text-center tabular-nums">{r.passed}</td>
              <td className="min-w-32">
                <RateBar value={r.sat ? r.passed / r.sat : null} />
              </td>
              <td className="text-center tabular-nums">{r.dec}</td>
            </tr>
          ))}
          <tr className="bg-surface-2/60 font-semibold">
            <td>الكلية</td>
            <td className="text-center tabular-nums">{need}</td>
            <td className="text-center tabular-nums">{sat}</td>
            <td className="text-center tabular-nums">{passed}</td>
            <td className="min-w-32">
              <RateBar value={sat ? passed / sat : null} />
            </td>
            <td className="text-center tabular-nums">{rows.reduce((a, r) => a + r.dec, 0)}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  )
}

function TopCard({ title, rows }: { title: string; rows: { name: string; sub: string; average: number; label: string | null }[] }) {
  return (
    <Card>
      <CardHeader title={title} icon={<Award className="size-5" />} />
      {rows.length === 0 ? (
        <EmptyState title="لا توجد معدلات بعد" />
      ) : (
        <ol className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-center gap-3 px-5 py-2.5">
              <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', i < 3 ? 'bg-gold-soft text-gold-text' : 'bg-surface-2 text-muted')}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.name}</div>
                <div className="truncate text-xs text-muted">{r.sub}</div>
              </div>
              <div className="text-end">
                <div className="font-bold tabular-nums">{fmtNum(r.average)}</div>
                <div className="text-xs text-muted">{r.label}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------
// إحصائيات القسم
// ---------------------------------------------------------------------

const classTitle = (c: ClassStat) => `${stageLabel(c.stage)} — ${SHIFT_LABEL[c.shift]}`

function DepartmentView({ d, scope }: { d: DeptStat; scope: StatScope }) {
  const [cls, setCls] = useState<string>('all')
  const failing = d.failing.filter((f) => cls === 'all' || f.cls.key === cls)
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-ink">قسم {d.department.name}</h2>
      <Kpis c={d.counts} />
      <Card>
        <CardHeader title="النتائج حسب المرحلة والدراسة" icon={<BarChart3 className="size-5" />} actions={<OutcomeLegend />} />
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>المرحلة والدراسة</th>
                {COUNT_HEADS.map((h) => (
                  <th key={h} className="text-center">
                    {h}
                  </th>
                ))}
                <th>الأول على الصف</th>
              </tr>
            </thead>
            <tbody>
              {d.classes.map((c) => (
                <tr key={c.key}>
                  <td className="font-medium whitespace-nowrap">{classTitle(c)}</td>
                  <CountCells c={c.counts} />
                  <td className="text-xs whitespace-nowrap">{c.top[0] ? `${c.top[0].student.full_name} (${fmtNum(c.top[0].average)})` : '—'}</td>
                </tr>
              ))}
              {d.classes.length > 1 && (
                <tr className="bg-surface-2/60 font-semibold">
                  <td>القسم</td>
                  <CountCells c={d.counts} />
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {d.classes.map((c) => (
        <SubjectsCard key={c.key} c={c} scope={scope} />
      ))}

      <Card>
        <CardHeader
          title={`الطلبة الراسبون والمكملون (${failing.length})`}
          subtitle="مع المواد التي لم يجتزها كل طالب"
          icon={<UserX className="size-5" />}
          actions={
            d.classes.length > 1 && (
              <Select aria-label="الصف" className="w-auto" value={cls} onChange={(e) => setCls(e.target.value)}>
                <option value="all">كل المراحل</option>
                {d.classes.map((c) => (
                  <option key={c.key} value={c.key}>
                    {classTitle(c)}
                  </option>
                ))}
              </Select>
            )
          }
        />
        {failing.length === 0 ? (
          <EmptyState icon={<GraduationCap className="size-6" />} title="لا يوجد طلبة راسبون أو مكملون" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-10 text-center">ت</th>
                  <th>اسم الطالب</th>
                  <th>المرحلة والدراسة</th>
                  <th className="text-center">الحالة</th>
                  <th className="text-center">عدد المواد</th>
                  <th>المواد</th>
                  <th className="text-center">المعدل</th>
                </tr>
              </thead>
              <tbody>
                {failing.map((f, i) => (
                  <tr key={f.student.id}>
                    <td className="text-center text-xs tabular-nums text-muted">{i + 1}</td>
                    <td className="font-medium whitespace-nowrap">
                      <a href={`#/student/${f.student.id}`} className="hover:text-primary-text hover:underline">
                        {f.student.full_name}
                      </a>
                    </td>
                    <td className="text-xs whitespace-nowrap text-muted">{classTitle(f.cls)}</td>
                    <td className="text-center">
                      <Badge tone={f.status === 'fail' ? 'danger' : f.status === 'carry' ? 'warning' : 'info'}>{STATUS_TEXT[f.status]}</Badge>
                    </td>
                    <td className="text-center font-semibold tabular-nums">{f.subjects.length}</td>
                    <td className="text-sm">{f.subjects.join('، ')}</td>
                    <td className="text-center tabular-nums">{fmtNum(f.average) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <BandsChart bands={d.bands} title={`توزيع معدلات طلبة القسم`} />
        <TopCard title="أوائل القسم" rows={d.top.map((t) => ({ name: t.student.full_name, sub: classTitle(t.cls), average: t.average, label: t.label }))} />
      </div>
    </div>
  )
}

const STATUS_TEXT: Record<string, string> = { fail: 'راسب', carry: 'مكمل', pass_carry: 'ناجح بالتحميل' }

function SubjectsCard({ c, scope }: { c: ClassStat; scope: StatScope }) {
  return (
    <Card>
      <CardHeader title={`نسبة النجاح في كل مادة — ${classTitle(c)}`} subtitle={`${c.subjects.length} مادة · ${c.counts.students} طالب · ${SCOPE_LABEL[scope]}`} />
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {scope === 0 && <th className="text-center">الفصل</th>}
              <th>المادة</th>
              <th className="text-center">الوحدات</th>
              <th className="text-center">الطلبة</th>
              <th className="text-center">ناجح</th>
              <th className="text-center">راسب</th>
              <th className="text-center" title="غائب / محروم / مؤجل">غ / ح / م</th>
              <th className="text-center">نسبة النجاح</th>
              <th className="text-center">المعدل</th>
              <th className="text-center">الأعلى</th>
              <th className="text-center">الأدنى</th>
              <th className="text-center" title="الناجحون في الدور الثاني من الذين امتحنوا فيه">الدور الثاني</th>
            </tr>
          </thead>
          <tbody>
            {c.subjects.map((x) => (
              <tr key={x.subject.id}>
                {scope === 0 && <td className="text-center text-xs text-muted">{x.subject.term === 1 ? 'الأول' : 'الثاني'}</td>}
                <td className="font-medium">
                  <a href={`#/subjects/${x.subject.id}`} className="hover:text-primary-text hover:underline">
                    {x.subject.name}
                  </a>
                  {x.subject.status !== 'approved' && (
                    <Badge tone="warning" className="ms-2">
                      غير معتمدة
                    </Badge>
                  )}
                </td>
                <td className="text-center tabular-nums text-muted">{x.subject.units ?? '—'}</td>
                <td className="text-center tabular-nums">{x.students}</td>
                <td className="text-center tabular-nums text-success">{x.pass}</td>
                <td className="text-center tabular-nums text-danger">{x.fail}</td>
                <td className="text-center text-xs tabular-nums text-muted">
                  {x.absent} / {x.banned} / {x.postponed}
                </td>
                <td className="min-w-36">
                  <RateBar value={x.passRate} />
                </td>
                <td className="text-center font-semibold tabular-nums">{fmtNum(x.average) || '—'}</td>
                <td className="text-center tabular-nums">{fmtNum(x.max) || '—'}</td>
                <td className="text-center tabular-nums">{fmtNum(x.min) || '—'}</td>
                <td className="text-center text-xs tabular-nums" title={x.needR2 ? `مكمل: ${x.needR2} · امتحن: ${x.satR2} · نجح: ${x.passR2}` : undefined}>
                  {x.satR2 ? `${x.passR2} / ${x.satR2}` : x.needR2 ? `بانتظار (${x.needR2})` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------
// نسخة الطباعة (PDF): جداول أكاديمية بترويسة الكلية وتواقيع اللجنة
// ---------------------------------------------------------------------

const P = {
  h2: { fontSize: '12pt', fontWeight: 700, margin: '12px 0 4px', color: '#0b5a3a', breakAfter: 'avoid', pageBreakAfter: 'avoid' } as const,
  note: { fontSize: '9pt', color: '#555', margin: '2px 0 6px' } as const,
}

function PrintCounts({ c }: { c: Counts }) {
  return (
    <>
      <td>{c.students}</td>
      <td>{c.pass}</td>
      <td>{c.carry}</td>
      <td>{c.fail}</td>
      <td>{c.incomplete}</td>
      <td style={{ fontWeight: 700 }}>{fmtPct(c.passRate)}</td>
      <td>{fmtNum(c.average) || '—'}</td>
      <td>{fmtNum(c.highest) || '—'}</td>
    </>
  )
}
const PRINT_HEADS = ['الطلبة', 'ناجح', 'مكمل', 'راسب', 'غير مكتمل', 'نسبة النجاح', 'المعدل', 'أعلى معدل']

function PrintGroup({ title, rows }: { title: string; rows: { label: string; c: Counts }[] }) {
  if (!rows.length) return null
  return (
    <>
      <div style={P.h2}>{title}</div>
      <table className="print-table">
        <thead>
          <tr>
            <th style={{ width: '22%' }}>الفئة</th>
            {PRINT_HEADS.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="name">{r.label}</td>
              <PrintCounts c={r.c} />
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function CollegePrint({ st, official }: { st: CollegeStat; official: boolean }) {
  return (
    <>
      <PrintHeader title={`إحصائيات اللجنة الامتحانية — ${SCOPE_LABEL[st.scope]}`} extra={<PrintBasis official={official} st={st} />} />
      <PrintGroup
        title="أولاً: النتائج حسب القسم"
        rows={[...st.departments.map((d) => ({ label: d.department.name, c: d.counts })), { label: 'الكلية', c: st.counts }]}
      />
      <PrintGroup title="ثانياً: النتائج حسب المرحلة الدراسية" rows={st.byStage.map((g) => ({ label: g.label, c: g.counts }))} />
      <PrintGroup title="ثالثاً: النتائج حسب نوع الدراسة" rows={st.byShift.map((g) => ({ label: g.label, c: g.counts }))} />
      <PrintGroup title="رابعاً: النتائج حسب الجنس" rows={st.byGender.map((g) => ({ label: g.label, c: g.counts }))} />
      <PrintBands bands={st.bands} title="خامساً: توزيع معدلات الطلبة حسب التقدير" />
      {st.hardest.length > 0 && (
        <>
          <div style={P.h2}>سادساً: المواد الأقل نسبة نجاح</div>
          <table className="print-table">
            <thead>
              <tr>
                <th>ت</th>
                <th>المادة</th>
                <th>القسم</th>
                <th>المرحلة والدراسة</th>
                <th>ناجح</th>
                <th>راسب</th>
                <th>نسبة النجاح</th>
                <th>المعدل</th>
              </tr>
            </thead>
            <tbody>
              {st.hardest.map((x, i) => (
                <tr key={x.subject.id}>
                  <td>{i + 1}</td>
                  <td className="name">{x.subject.name}</td>
                  <td className="name">{x.department.name}</td>
                  <td>
                    {stageLabel(x.subject.stage)} — {SHIFT_LABEL[x.subject.shift]}
                  </td>
                  <td>{x.pass}</td>
                  <td>{x.fail}</td>
                  <td>{fmtPct(x.passRate)}</td>
                  <td>{fmtNum(x.average)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {st.top.length > 0 && (
        <>
          <div style={P.h2}>سابعاً: أوائل الكلية</div>
          <PrintTop rows={st.top.map((t) => ({ name: t.student.full_name, sub: `${t.department.name} — ${stageLabel(t.cls.stage)} — ${SHIFT_LABEL[t.cls.shift]}`, average: t.average, label: t.label }))} />
        </>
      )}
      <PrintSignatures labels={['رئيس اللجنة الامتحانية', 'معاون العميد', 'عميد الكلية']} />
    </>
  )
}

function PrintBasis({ official, st }: { official: boolean; st: CollegeStat }) {
  return (
    <span>
      أساس الاحتساب: {official ? 'النتائج المعتمدة فقط' : 'كل الدرجات المدخلة'} · المواد: {st.subjects} · سجلات الدرجات: {st.records}
      {official && st.unapproved > 0 ? ` · قوائم غير معتمدة: ${st.unapproved}` : ''}
    </span>
  )
}

function PrintBands({ bands, title }: { bands: Band[]; title: string }) {
  const total = bands.reduce((a, b) => a + b.count, 0)
  const ordered = [...bands].sort((a, b) => b.min - a.min)
  return (
    <>
      <div style={P.h2}>{title}</div>
      <table className="print-table">
        <thead>
          <tr>
            {ordered.map((b) => (
              <th key={b.label}>
                {b.label} ({b.min}–{b.upper})
              </th>
            ))}
            <th>المجموع</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {ordered.map((b) => (
              <td key={b.label}>
                {b.count} ({fmtPct(total ? b.count / total : null)})
              </td>
            ))}
            <td>{total}</td>
          </tr>
        </tbody>
      </table>
    </>
  )
}

function PrintTop({ rows }: { rows: { name: string; sub: string; average: number; label: string | null }[] }) {
  return (
    <table className="print-table">
      <thead>
        <tr>
          <th style={{ width: '6%' }}>ت</th>
          <th>اسم الطالب</th>
          <th>القسم / المرحلة</th>
          <th>المعدل</th>
          <th>التقدير</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.name}-${i}`}>
            <td>{i + 1}</td>
            <td className="name">{r.name}</td>
            <td className="name">{r.sub}</td>
            <td>{fmtNum(r.average)}</td>
            <td>{r.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DeptPrint({ d, scope, official }: { d: DeptStat; scope: StatScope; official: boolean }) {
  return (
    <>
      <PrintHeader
        title={`إحصائيات قسم ${d.department.name} — ${SCOPE_LABEL[scope]}`}
        extra={`أساس الاحتساب: ${official ? 'النتائج المعتمدة فقط' : 'كل الدرجات المدخلة'}`}
      />
      <PrintGroup title="أولاً: النتائج حسب المرحلة والدراسة" rows={[...d.classes.map((c) => ({ label: classTitle(c), c: c.counts })), ...(d.classes.length > 1 ? [{ label: 'القسم', c: d.counts }] : [])]} />
      <div style={P.h2}>ثانياً: نسبة النجاح في كل مادة</div>
      {d.classes.map((c) => (
        <div key={c.key} style={{ breakInside: 'avoid' }}>
          <div style={{ ...P.note, fontWeight: 700, color: '#222' }}>{classTitle(c)}</div>
          <table className="print-table">
            <thead>
              <tr>
                {scope === 0 && <th>الفصل</th>}
                <th style={{ width: '26%' }}>المادة</th>
                <th>الوحدات</th>
                <th>الطلبة</th>
                <th>ناجح</th>
                <th>راسب</th>
                <th>غ / ح / م</th>
                <th>نسبة النجاح</th>
                <th>المعدل</th>
                <th>الأعلى</th>
                <th>الأدنى</th>
                <th>ناجح د2 / امتحن</th>
              </tr>
            </thead>
            <tbody>
              {c.subjects.map((x) => (
                <tr key={x.subject.id}>
                  {scope === 0 && <td>{x.subject.term === 1 ? 'الأول' : 'الثاني'}</td>}
                  <td className="name">{x.subject.name}</td>
                  <td>{x.subject.units ?? '—'}</td>
                  <td>{x.students}</td>
                  <td>{x.pass}</td>
                  <td>{x.fail}</td>
                  <td>
                    {x.absent} / {x.banned} / {x.postponed}
                  </td>
                  <td style={{ fontWeight: 700 }}>{fmtPct(x.passRate)}</td>
                  <td>{fmtNum(x.average) || '—'}</td>
                  <td>{fmtNum(x.max) || '—'}</td>
                  <td>{fmtNum(x.min) || '—'}</td>
                  <td>{x.satR2 ? `${x.passR2} / ${x.satR2}` : x.needR2 ? `بانتظار (${x.needR2})` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div style={P.h2}>ثالثاً: الطلبة الراسبون والمكملون ({d.failing.length})</div>
      {d.failing.length === 0 ? (
        <div style={P.note}>لا يوجد طلبة راسبون أو مكملون.</div>
      ) : (
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: '5%' }}>ت</th>
              <th style={{ width: '22%' }}>اسم الطالب</th>
              <th>المرحلة والدراسة</th>
              <th>الحالة</th>
              <th>العدد</th>
              <th style={{ width: '38%' }}>المواد</th>
            </tr>
          </thead>
          <tbody>
            {d.failing.map((f, i) => (
              <tr key={f.student.id}>
                <td>{i + 1}</td>
                <td className="name">{f.student.full_name}</td>
                <td>{classTitle(f.cls)}</td>
                <td>{STATUS_TEXT[f.status]}</td>
                <td>{f.subjects.length}</td>
                <td className="name">{f.subjects.join('، ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PrintBands bands={d.bands} title="رابعاً: توزيع معدلات الطلبة حسب التقدير" />
      {d.top.length > 0 && (
        <>
          <div style={P.h2}>خامساً: أوائل القسم</div>
          <PrintTop rows={d.top.map((t) => ({ name: t.student.full_name, sub: classTitle(t.cls), average: t.average, label: t.label }))} />
        </>
      )}
      <PrintSignatures labels={['مقرر القسم', 'رئيس القسم', 'رئيس اللجنة الامتحانية', 'عميد الكلية']} />
    </>
  )
}

