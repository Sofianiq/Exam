import { Award, FileSpreadsheet, Printer, Sheet } from 'lucide-react'
import { useMemo } from 'react'
import { useGrades, useStudents, useSubjects } from '../app/queries'
import { useSession } from '../app/session'
import { backend } from '../data'
import { bandCounts, computeRow, masterRow, rankDescending, sheetStats, type MasterCell, type RowResult } from '../lib/calc'
import { displayName, fmtNum, fmtPct, yearLabel } from '../lib/format'
import { SHIFT_LONG, SPECIAL_LABEL, STATUS_LABEL, TERM_LABEL } from '../lib/labels'
import type { ClassKey, Grade, Subject, Term } from '../lib/types'
import { useToast } from './feedback'
import { PrintHeader, PrintSignatures } from './PrintParts'
import { Badge, Button, Callout, Card, CardHeader, EmptyState, LoadingBlock, cx } from './ui'

export function MasterSheet({ classKey, term }: { classKey: ClassKey; term: Term | 0 }) {
  const s = useSession()
  const toast = useToast()
  const subjectsQ = useSubjects({ ...classKey, term: term || undefined })
  const studentsQ = useStudents(classKey)
  const subjects = useMemo(() => subjectsQ.data ?? [], [subjectsQ.data])
  const gradesQ = useGrades(subjects.map((x) => x.id))
  const dept = s.deptById(classKey.department_id)
  const termLabel = term === 0 ? 'النتيجة السنوية' : TERM_LABEL[term]

  const data = useMemo(() => {
    const students = studentsQ.data ?? []
    const gmap = new Map<string, Grade>()
    for (const g of gradesQ.data ?? []) gmap.set(`${g.subject_id}|${g.student_id}`, g)
    const results: RowResult[][] = students.map((st) => subjects.map((sub) => computeRow(sub, gmap.get(`${sub.id}|${st.id}`), s.settings)))
    const rows = results.map((rs) =>
      masterRow(
        rs.map<MasterCell>((r) => ({ total: r.total, special: r.special, complete: r.complete })),
        subjects.map((x) => x.units),
        s.settings,
      ),
    )
    const activeIdx = students.map((st, i) => (st.status === 'active' ? i : -1)).filter((i) => i >= 0)
    const ranksActive = rankDescending(activeIdx.map((i) => rows[i].average))
    const ranks: (number | null)[] = students.map(() => null)
    activeIdx.forEach((i, k) => (ranks[i] = ranksActive[k]))
    const subjectStats = subjects.map((_, j) => sheetStats(activeIdx.map((i) => results[i][j]), s.settings.pass_mark))
    const subjectResults = subjects.map((_, j) => Object.fromEntries(students.map((st, i) => [st.id, results[i][j]])))
    return { students, rows, ranks, subjectStats, activeIdx, results, subjectResults }
  }, [studentsQ.data, gradesQ.data, subjects, s.settings])

  if (subjectsQ.isLoading || studentsQ.isLoading || gradesQ.isLoading) return <LoadingBlock />
  if (subjects.length === 0 || data.students.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Sheet className="size-6" />} title="لا تتوفر بيانات للماستر شيت">
          يجب إضافة الطلبة والمواد لهذا الصف أولاً.
        </EmptyState>
      </Card>
    )
  }

  const { students, rows, ranks, subjectStats, activeIdx } = data
  const n = subjects.length
  const approved = subjects.filter((x) => x.status === 'approved').length
  const active = activeIdx.map((i) => ({ st: students[i], row: rows[i], rank: ranks[i] }))
  const allPass = active.filter((a) => a.row.cells.every((c) => c.total != null && c.total >= s.settings.pass_mark)).length
  const atRisk = active.filter((a) => a.row.failed >= 3).length
  const bands = bandCounts(active.map((a) => a.row.average), s.settings.grade_scale)
  const top = [...active].filter((a) => a.rank != null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).slice(0, 5)
  const withRate = subjects.map((x, j) => ({ x, st: subjectStats[j] })).filter((v) => v.st.passRate != null)
  const best = withRate.reduce<(typeof withRate)[number] | null>((m, v) => (!m || (v.st.passRate ?? 0) > (m.st.passRate ?? 0) ? v : m), null)
  const worst = withRate.reduce<(typeof withRate)[number] | null>((m, v) => (!m || (v.st.passRate ?? 1) < (m.st.passRate ?? 1) ? v : m), null)
  const bestAvg = withRate.reduce<(typeof withRate)[number] | null>((m, v) => (!m || (v.st.avg ?? 0) > (m.st.avg ?? 0) ? v : m), null)
  const worstAvg = withRate.reduce<(typeof withRate)[number] | null>((m, v) => (!m || (v.st.avg ?? 100) < (m.st.avg ?? 100) ? v : m), null)

  const exportExcel = async () => {
    try {
      const { exportMasterXlsx } = await import('../lib/excel')
      const year = yearLabel(s.years.find((y) => y.id === classKey.year_id)?.label)
      await exportMasterXlsx({
        settings: s.settings,
        deptName: dept?.name ?? '',
        yearLabel: year,
        stage: classKey.stage,
        shift: classKey.shift,
        termLabel,
        subjects,
        students,
        rows,
        ranks,
        subjectStats,
        subjectSheets: subjects.map((sub, j) => ({
          settings: s.settings,
          deptName: dept?.name ?? '',
          yearLabel: year,
          subject: sub,
          teachers: sub.teacher_ids.map((id) => displayName(s.profileById(id))).join(' + '),
          students,
          rows: Object.fromEntries(
            students.map((st, i) => {
              const g = gradesQ.data?.find((x) => x.subject_id === sub.id && x.student_id === st.id)
              return [st.id, { values: g ?? { cw_theory: null, cw_practical: null, final_practical: null, final_theory: null, special: null, note: null }, result: data.results[i][j] }]
            }),
          ),
          stats: subjectStats[j],
        })),
      })
      void backend.logEvent('report.export', `تصدير الماستر شيت — ${dept?.name} — المرحلة ${classKey.stage}`)
    } catch (e) {
      toast.error(e)
    }
  }

  const cellText = (c: MasterCell) => (c.special ? SPECIAL_LABEL[c.special] : fmtNum(c.total))
  const isFail = (c: MasterCell) => c.total != null && c.total < s.settings.pass_mark

  return (
    <>
      <div className="no-print space-y-4">
        {approved < n && (
          <Callout tone="warning" title="النتائج غير نهائية">
            {approved} من {n} مواد معتمدة من اللجنة الامتحانية. تُعرض الدرجات الحالية لجميع المواد.
          </Callout>
        )}
        <Card>
          <CardHeader
            title={`الماستر شيت — ${termLabel}`}
            subtitle={`${n} مادة — ${active.length} طالب مستمر`}
            actions={
              <>
                <Button
                  size="sm"
                  icon={<Printer className="size-4" />}
                  onClick={() => {
                    void backend.logEvent('report.print', `طباعة الماستر شيت — ${dept?.name} — المرحلة ${classKey.stage}`)
                    window.print()
                  }}
                >
                  طباعة / PDF
                </Button>
                <Button size="sm" variant="primary" icon={<FileSpreadsheet className="size-4" />} onClick={() => void exportExcel()}>
                  تصدير Excel (كامل)
                </Button>
              </>
            }
          />
          <div className="max-h-[70vh] overflow-auto scrollbar-thin">
            <table className="grade-grid w-full min-w-[900px] text-sm">
              <thead>
                <tr>
                  <th className="sticky-col start-0 w-11 px-2 py-2 text-center text-xs text-muted">ت</th>
                  <th className="sticky-col start-11 min-w-52 px-3 py-2 text-start text-xs text-muted">اسم الطالب</th>
                  {subjects.map((x) => (
                    <th key={x.id} className="max-w-28 min-w-24 px-1.5 py-2 text-center align-bottom text-[0.72rem] font-semibold leading-tight text-ink">
                      <div className="mb-1 flex justify-center">
                        <StatusDot status={x.status} />
                      </div>
                      {x.name}
                      {term === 0 && <span className="mt-0.5 block font-normal text-faint">ف{x.term}</span>}
                    </th>
                  ))}
                  <th className="w-16 bg-gold-soft! px-2 py-2 text-center text-xs font-bold">المعدل</th>
                  <th className="w-16 px-2 py-2 text-center text-xs text-muted">النجاح (من {n})</th>
                  <th className="w-14 px-2 py-2 text-center text-xs text-muted">الترتيب</th>
                  <th className="min-w-44 px-2 py-2 text-start text-xs text-muted">الحالة العامة</th>
                </tr>
              </thead>
              <tbody>
                {students.map((st, i) => {
                  const r = rows[i]
                  const inactive = st.status !== 'active'
                  return (
                    <tr key={st.id} className={cx(inactive && 'opacity-50')}>
                      <td className="sticky-col start-0 px-2 py-1.5 text-center text-xs tabular-nums text-muted">{i + 1}</td>
                      <td className="sticky-col start-11 px-3 py-1.5 font-medium whitespace-nowrap">{st.full_name}</td>
                      {r.cells.map((c, j) => (
                        <td key={j} className={cx('px-1 text-center tabular-nums', isFail(c) && 'font-bold text-danger', c.special && 'text-xs text-warning')}>
                          {cellText(c)}
                        </td>
                      ))}
                      <td className="bg-gold-soft/50 px-2 text-center font-bold tabular-nums">{fmtNum(r.average)}</td>
                      <td className="px-2 text-center tabular-nums">{r.cells.some((c) => c.total != null) ? r.passed : ''}</td>
                      <td className="px-2 text-center font-semibold tabular-nums">{ranks[i] ?? ''}</td>
                      <td className={cx('px-2 text-xs whitespace-nowrap', r.failed > 0 ? 'text-danger' : r.status ? 'text-success' : 'text-muted')}>{inactive ? (st.status === 'withdrawn' ? 'منسحب' : 'مؤجل') : r.status}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                {[
                  { label: 'المعدل العام', f: (j: number) => fmtNum(subjectStats[j].avg) },
                  { label: 'عدد الناجحين', f: (j: number) => subjectStats[j].pass },
                  { label: 'عدد الراسبين', f: (j: number) => subjectStats[j].fail },
                  { label: 'نسبة النجاح', f: (j: number) => fmtPct(subjectStats[j].passRate) },
                ].map((row) => (
                  <tr key={row.label} className="bg-surface-2 font-semibold">
                    <td className="sticky-col start-0 bg-surface-2!" />
                    <td className="sticky-col start-11 bg-surface-2! px-3 py-2 text-xs">{row.label}</td>
                    {subjects.map((_, j) => (
                      <td key={j} className="px-1 py-2 text-center text-xs tabular-nums">
                        {row.f(j)}
                      </td>
                    ))}
                    <td colSpan={4} />
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="مؤشرات الأداء" />
            <dl className="divide-y divide-line text-sm">
              <Kpi label="أعلى نسبة نجاح" value={best ? `${best.x.name} — ${fmtPct(best.st.passRate)}` : '—'} />
              <Kpi label="أدنى نسبة نجاح" value={worst ? `${worst.x.name} — ${fmtPct(worst.st.passRate)}` : '—'} />
              <Kpi label="أعلى متوسط درجات" value={bestAvg ? `${bestAvg.x.name} — ${fmtNum(bestAvg.st.avg)}` : '—'} />
              <Kpi label="أدنى متوسط درجات" value={worstAvg ? `${worstAvg.x.name} — ${fmtNum(worstAvg.st.avg)}` : '—'} />
              <Kpi label="الناجحون في جميع المواد" value={`${allPass} طالب (${fmtPct(active.length ? allPass / active.length : null)})`} />
              <Kpi label="الرسوب في 3 مواد أو أكثر" value={`${atRisk} طالب`} danger={atRisk > 0} />
            </dl>
          </Card>
          <Card>
            <CardHeader title="توزيع التقديرات حسب المعدل" />
            <div className="space-y-2.5 px-5 py-4">
              {bands.map((b) => {
                const ratio = active.length ? b.count / active.length : 0
                return (
                  <div key={b.label} className="flex items-center gap-3 text-sm">
                    <span className="w-20 shrink-0">{b.label}</span>
                    <div className="h-5 flex-1 overflow-hidden rounded bg-surface-3">
                      <div className={cx('h-full rounded', b.min >= s.settings.pass_mark ? 'bg-primary' : 'bg-danger')} style={{ width: `${ratio * 100}%` }} />
                    </div>
                    <span className="w-16 text-end text-xs tabular-nums text-muted">
                      {b.count} ({Math.round(ratio * 100)}%)
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>
          <Card>
            <CardHeader title="الأوائل على المرحلة" icon={<Award className="size-4.5" />} />
            <ol className="divide-y divide-line">
              {top.map((a) => (
                <li key={a.st.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className={cx('flex size-7 items-center justify-center rounded-full text-xs font-bold', a.rank === 1 ? 'bg-gold text-white' : 'bg-gold-soft text-gold-text')}>{a.rank}</span>
                  <span className="flex-1 truncate font-medium">{a.st.full_name}</span>
                  <Badge tone="primary">{fmtNum(a.row.average)}</Badge>
                </li>
              ))}
              {top.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">لا توجد معدلات بعد</li>}
            </ol>
          </Card>
        </div>
      </div>

      {/* نسخة الطباعة (أفقي) */}
      <div className="print-only print-landscape">
        <PrintHeader classKey={classKey} term={term} title={`الماستر شيت لدرجات الطلبة — ${SHIFT_LONG[classKey.shift]}`} />
        <table className="print-table" style={{ fontSize: n > 8 ? '8pt' : '9.5pt' }}>
          <thead>
            <tr>
              <th>ت</th>
              <th>اسم الطالب</th>
              {subjects.map((x) => (
                <th key={x.id} style={{ maxWidth: '70px' }}>
                  {x.name}
                </th>
              ))}
              <th>المعدل</th>
              <th>النجاح</th>
              <th>الترتيب</th>
              <th>الحالة العامة</th>
            </tr>
          </thead>
          <tbody>
            {students.map((st, i) => (
              <tr key={st.id}>
                <td>{i + 1}</td>
                <td className="name">{st.full_name}</td>
                {rows[i].cells.map((c, j) => (
                  <td key={j} className={isFail(c) ? 'print-fail' : ''}>
                    {cellText(c)}
                  </td>
                ))}
                <td style={{ fontWeight: 700 }}>{fmtNum(rows[i].average)}</td>
                <td>{rows[i].cells.some((c) => c.total != null) ? rows[i].passed : ''}</td>
                <td>{ranks[i] ?? ''}</td>
                <td style={{ fontSize: '8pt' }}>{st.status !== 'active' ? (st.status === 'withdrawn' ? 'منسحب' : 'مؤجل') : rows[i].status}</td>
              </tr>
            ))}
            {[
              ['المعدل العام', (j: number) => fmtNum(subjectStats[j].avg)],
              ['نسبة النجاح', (j: number) => fmtPct(subjectStats[j].passRate)],
            ].map(([label, f]) => (
              <tr key={label as string}>
                <th colSpan={2}>{label as string}</th>
                {subjects.map((_, j) => (
                  <th key={j}>{(f as (j: number) => string)(j)}</th>
                ))}
                <th colSpan={4} />
              </tr>
            ))}
          </tbody>
        </table>
        <PrintSignatures labels={['مقرر القسم', 'رئيس القسم', 'رئيس اللجنة الامتحانية', 'العميد']} />
      </div>
    </>
  )
}

function StatusDot({ status }: { status: Subject['status'] }) {
  const color = { draft: 'bg-faint', submitted: 'bg-info', returned: 'bg-warning', approved: 'bg-success' }[status]
  return <span title={STATUS_LABEL[status]} aria-label={STATUS_LABEL[status]} className={cx('inline-block size-2 rounded-full', color)} />
}

function Kpi({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className={cx('text-end font-medium', danger && 'text-danger')}>{value}</dd>
    </div>
  )
}
