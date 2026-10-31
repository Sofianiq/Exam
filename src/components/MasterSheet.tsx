import { Award, FileSpreadsheet, IdCard, Printer, Sheet } from 'lucide-react'
import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useInvalidate } from '../app/queries'
import { useClassResults, type StudentResultRow } from '../app/results'
import { useSession } from '../app/session'
import { backend } from '../data'
import { bandCounts, type RowResult } from '../lib/calc'
import { displayName, fmtNum, fmtPct, unitsLabel, yearLabel } from '../lib/format'
import { SHIFT_LONG, SPECIAL_LABEL, STATUS_LABEL, TERM_LABEL } from '../lib/labels'
import { canManageDepartment } from '../lib/perm'
import type { ClassKey, Subject, Term } from '../lib/types'
import { useConfirm, useToast } from './feedback'
import { PrintHeader, PrintSignatures } from './PrintParts'
import { Badge, Button, Callout, Card, CardHeader, EmptyState, LoadingBlock, cx } from './ui'

const STATUS_COLOR: Record<string, string> = {
  pass: 'text-success',
  pass_r2: 'text-success',
  carry: 'text-warning',
  fail: 'text-danger',
  incomplete: 'text-muted',
  none: 'text-muted',
}

export function MasterSheet({ classKey, term }: { classKey: ClassKey; term: Term | 0 }) {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const invalidate = useInvalidate()
  const data = useClassResults(classKey, term, s.settings)
  const dept = s.deptById(classKey.department_id)
  const termLabel = term === 0 ? 'النتيجة السنوية' : TERM_LABEL[term]
  const manage = canManageDepartment(s.profile, classKey.department_id)
  // في عرض السنة كاملة تُعرض الدرجة النهائية فقط لكل مادة لتبقى الورقة مقروءة
  const compact = term === 0

  if (data.loading) return <LoadingBlock />
  const { subjects, rows, subjectStats } = data
  if (subjects.length === 0 || rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Sheet className="size-6" />} title="لا تتوفر بيانات للماستر شيت">
          يجب إضافة الطلبة والمواد لهذا الصف أولاً.
        </EmptyState>
      </Card>
    )
  }

  const n = subjects.length
  const approved = subjects.filter((x) => x.status === 'approved').length
  const active = rows.filter((r) => r.student.status === 'active')
  const passAll = active.filter((r) => r.summary.status === 'pass' || r.summary.status === 'pass_r2').length
  const carry = active.filter((r) => r.summary.status === 'carry').length
  const failCount = active.filter((r) => r.summary.status === 'fail').length
  const bands = bandCounts(active.map((r) => r.summary.average), s.settings.grade_scale)
  const top = [...active].filter((r) => r.rank != null).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).slice(0, 5)
  const totalUnits = subjects.reduce((a, x) => a + (x.units ?? 0), 0)
  const missingUnits = subjects.some((x) => !x.units)

  const editNote = async (r: StudentResultRow) => {
    const v = await confirm({
      title: `ملاحظات — ${r.student.full_name}`,
      input: { label: 'الملاحظات', multiline: true, initial: r.student.notes ?? '' },
      confirmText: 'حفظ',
    })
    if (typeof v !== 'string') return
    try {
      await backend.updateStudent(r.student.id, { notes: v || null })
      toast.success('تم حفظ الملاحظة')
      void invalidate('students')
    } catch (e) {
      toast.error(e)
    }
  }

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
        compact,
        data,
        subjectSheets: subjects.map((sub, j) => ({
          settings: s.settings,
          deptName: dept?.name ?? '',
          yearLabel: year,
          subject: sub,
          teachers: sub.teacher_ids.map((id) => displayName(s.profileById(id))).join(' + '),
          students: rows.map((r) => r.student),
          rows: Object.fromEntries(rows.map((r) => [r.student.id, { values: r.grades[j] ?? EMPTY_VALUES, result: r.results[j] }])),
          stats: subjectStats[j],
        })),
      })
      void backend.logEvent('report.export', `تصدير الماستر شيت — ${dept?.name} — المرحلة ${classKey.stage}`)
    } catch (e) {
      toast.error(e)
    }
  }

  const resultsLink = `/results?dept=${classKey.department_id}&stage=${classKey.stage}&shift=${classKey.shift}&term=${term}`

  return (
    <>
      <div className="no-print space-y-4">
        {approved < n && (
          <Callout tone="warning" title="النتائج غير نهائية">
            {approved} من {n} مواد معتمدة من اللجنة الامتحانية. تُعرض الدرجات الحالية لجميع المواد.
          </Callout>
        )}
        {missingUnits && s.settings.average_mode === 'weighted' && (
          <Callout tone="info" title="وحدات بعض المواد غير محددة">
            يُحسب المعدل بضرب درجة كل مادة في وحداتها. المواد التي لم تُحدد وحداتها تُحتسب بوحدة واحدة؛ حدّد الوحدات من «تعديل المادة».
          </Callout>
        )}
        <Card>
          <CardHeader
            title={`الماستر شيت — ${termLabel}`}
            subtitle={`${n} مادة — ${unitsLabel(totalUnits)} — ${active.length} طالب مستمر — المعدل ${s.settings.average_mode === 'weighted' ? 'موزون بالوحدات' : 'حسابي بسيط'}`}
            actions={
              <>
                <Link to={resultsLink}>
                  <Button size="sm" icon={<IdCard className="size-4" />}>
                    نتائج الطلبة (طباعة)
                  </Button>
                </Link>
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
          <div className="max-h-[72vh] overflow-auto scrollbar-thin">
            <MasterTable subjects={subjects} rows={rows} compact={compact} subjectStats={subjectStats} term={term} onNote={manage ? editNote : undefined} />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="ملخص النتائج" />
            <dl className="divide-y divide-line text-sm">
              <Kpi label="ناجحون" value={`${passAll} طالب (${fmtPct(active.length ? passAll / active.length : null)})`} tone="text-success" />
              <Kpi label="مكملون (دور ثانٍ)" value={`${carry} طالب`} tone="text-warning" />
              <Kpi label={`راسبون (أكثر من ${s.settings.max_failed_subjects} مواد)`} value={`${failCount} طالب`} tone="text-danger" />
              <Kpi label="أعلى معدل" value={top[0] ? fmtNum(top[0].summary.average) : '—'} />
              <Kpi label="مجموع وحدات الفصل" value={`${totalUnits}`} />
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
              {top.map((r) => (
                <li key={r.student.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className={cx('flex size-7 items-center justify-center rounded-full text-xs font-bold', r.rank === 1 ? 'bg-gold text-white' : 'bg-gold-soft text-gold-text')}>{r.rank}</span>
                  <Link to={`/student/${r.student.id}`} className="flex-1 truncate font-medium hover:text-primary-text">
                    {r.student.full_name}
                  </Link>
                  <Badge tone="primary">{fmtNum(r.summary.average)}</Badge>
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
        <MasterTable subjects={subjects} rows={rows} compact={compact} subjectStats={subjectStats} term={term} print />
        <PrintSignatures labels={['مقرر القسم', 'رئيس القسم', 'رئيس اللجنة الامتحانية', 'العميد']} />
      </div>
    </>
  )
}

const EMPTY_VALUES = {
  cw_theory: null,
  cw_practical: null,
  final_practical: null,
  final_theory: null,
  special: null,
  note: null,
  r2_final_practical: null,
  r2_final_theory: null,
  r2_special: null,
}

function MasterTable({
  subjects,
  rows,
  compact,
  subjectStats,
  term,
  print,
  onNote,
}: {
  subjects: Subject[]
  rows: StudentResultRow[]
  compact: boolean
  subjectStats: ReturnType<typeof useClassResults>['subjectStats']
  term: Term | 0
  print?: boolean
  onNote?: (r: StudentResultRow) => void
}) {
  const per = compact ? 1 : 3
  const finalText = (r: RowResult) => (r.special ? SPECIAL_LABEL[r.special] : fmtNum(r.finalSum))
  const th = print ? '' : 'px-1.5 py-2 text-center text-[0.72rem] font-semibold text-muted'
  const td = print ? '' : 'px-1 text-center tabular-nums'
  const sticky0 = print ? '' : 'sticky-col start-0'
  const sticky1 = print ? '' : 'sticky-col start-11'

  return (
    <table className={print ? 'print-table master-print' : 'grade-grid w-full min-w-[1000px] text-sm'} style={print ? { fontSize: subjects.length * per > 24 ? '7pt' : '8.5pt' } : undefined}>
      <thead>
        <tr>
          <th rowSpan={compact ? 1 : 2} className={cx(sticky0, !print && 'w-11 px-2 text-xs text-muted')}>
            ت
          </th>
          <th rowSpan={compact ? 1 : 2} className={cx(sticky1, !print && 'min-w-52 px-3 text-start text-xs text-muted')}>
            اسم الطالب
          </th>
          {subjects.map((x) => (
            <th key={x.id} colSpan={per} className={cx(!print && 'min-w-28 border-b px-1.5 py-2 text-center align-bottom text-[0.72rem] font-bold leading-tight text-ink')}>
              {!print && (
                <span className="mb-1 flex justify-center">
                  <StatusDot status={x.status} />
                </span>
              )}
              {x.name}
              <span className={cx('block font-normal', !print && 'text-faint')}>
                {unitsLabel(x.units)}
                {term === 0 ? ` — ف${x.term}` : ''}
                {x.ministerial ? ' — وزارية' : ''}
              </span>
            </th>
          ))}
          <th rowSpan={compact ? 1 : 2} className={cx(!print && 'w-16 bg-surface-3! px-2 text-center text-xs font-bold')}>
            مجموع الدرجات
          </th>
          <th rowSpan={compact ? 1 : 2} className={cx(!print && 'w-16 bg-gold-soft! px-2 text-center text-xs font-bold')}>
            المعدل
          </th>
          {!print && (
            <th rowSpan={compact ? 1 : 2} className="w-12 px-2 text-center text-xs text-muted">
              الترتيب
            </th>
          )}
          <th rowSpan={compact ? 1 : 2} className={cx(!print && 'min-w-36 px-2 text-start text-xs text-muted')}>
            النتيجة
          </th>
          <th rowSpan={compact ? 1 : 2} className={cx(!print && 'min-w-32 px-2 text-start text-xs text-muted')}>
            الملاحظات
          </th>
        </tr>
        {!compact && (
          <tr>
            {subjects.map((x) => (
              <Fragment key={x.id}>
                <th className={th}>سعي ({x.coursework_max})</th>
                <th className={th}>نهائي ({x.final_max + x.practical_max})</th>
                <th className={th}>المجموع</th>
              </Fragment>
            ))}
          </tr>
        )}
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const inactive = row.student.status !== 'active'
          const hasR2 = !compact && row.results.some((r) => r.complete && r.needsR2)
          const span = hasR2 ? 2 : 1
          const sum = row.summary
          return (
            <Fragment key={row.student.id}>
              <tr className={cx(inactive && 'opacity-50')}>
                <td rowSpan={span} className={cx(sticky0, !print && 'px-2 py-1.5 text-center text-xs tabular-nums text-muted')}>
                  {i + 1}
                </td>
                <td rowSpan={span} className={cx(sticky1, print ? 'name' : 'px-3 py-1.5 font-medium whitespace-nowrap')}>
                  {print ? (
                    row.student.full_name
                  ) : (
                    <Link to={`/student/${row.student.id}`} className="hover:text-primary-text hover:underline">
                      {row.student.full_name}
                    </Link>
                  )}
                </td>
                {row.results.map((r, j) =>
                  compact ? (
                    <td key={j} className={cx(td, r.finalPassed === false && r.finalTotal != null && 'font-bold text-danger print-fail', r.finalSpecial && 'text-xs text-warning')}>
                      {r.finalSpecial ? SPECIAL_LABEL[r.finalSpecial] : fmtNum(r.finalTotal)}
                      {r.finalRound === 2 && <sup className="ms-0.5 text-gold-text">د2</sup>}
                    </td>
                  ) : (
                    <Fragment key={j}>
                      <td className={cx(td, !print && 'text-muted')}>{fmtNum(r.coursework)}</td>
                      <td className={cx(td, r.special && 'text-xs text-warning')}>{finalText(r)}</td>
                      <td className={cx(td, 'font-semibold', r.passed === false && r.total != null && 'text-danger print-fail')}>{fmtNum(r.total)}</td>
                    </Fragment>
                  ),
                )}
                <td rowSpan={span} className={cx(td, !print && 'bg-surface-2/70 font-semibold')}>
                  {fmtNum(sum.sum)}
                </td>
                <td rowSpan={span} className={cx(td, !print && 'bg-gold-soft/50 font-bold')} style={print ? { fontWeight: 700 } : undefined}>
                  {fmtNum(sum.average)}
                </td>
                {!print && (
                  <td rowSpan={span} className="px-2 text-center font-semibold tabular-nums">
                    {row.rank ?? ''}
                  </td>
                )}
                <td rowSpan={span} className={cx(!print && 'px-2 text-xs font-semibold', STATUS_COLOR[sum.status])} style={print ? { fontSize: '7.5pt', whiteSpace: 'normal' } : undefined}>
                  {inactive ? (row.student.status === 'withdrawn' ? 'منسحب' : 'مؤجل') : sum.statusText}
                </td>
                <td rowSpan={span} className={cx(!print && 'px-2 text-xs text-muted')} style={print ? { fontSize: '7.5pt', whiteSpace: 'normal' } : undefined}>
                  {onNote ? (
                    <button className="w-full text-start hover:text-primary-text" title="تعديل الملاحظة" onClick={() => onNote(row)}>
                      {row.student.notes || <span className="text-faint">+ ملاحظة</span>}
                    </button>
                  ) : (
                    row.student.notes
                  )}
                </td>
              </tr>
              {hasR2 && (
                <tr className={cx('text-xs', inactive && 'opacity-50')}>
                  {row.results.map((r, j) => {
                    const show = r.complete && r.needsR2
                    return (
                      <Fragment key={j}>
                        <td className={cx(td, !print && 'bg-gold-soft/40 text-[0.65rem] font-semibold text-gold-text')}>{show ? 'د2' : ''}</td>
                        <td className={cx(td, !print && 'bg-gold-soft/40', r.r2Special && 'text-warning')}>
                          {show ? (r.r2Special ? SPECIAL_LABEL[r.r2Special] : fmtNum(r.r2FinalSum)) : ''}
                        </td>
                        <td className={cx(td, !print && 'bg-gold-soft/40 font-semibold', show && r.r2Total != null && r.finalPassed === false && 'text-danger print-fail', show && r.r2Total != null && r.finalPassed === true && 'text-success')}>
                          {show ? fmtNum(r.r2Total) : ''}
                        </td>
                      </Fragment>
                    )
                  })}
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
      <tfoot>
        {[
          { label: 'المعدل العام', f: (j: number) => fmtNum(subjectStats[j].avg) },
          { label: 'عدد الناجحين', f: (j: number) => String(subjectStats[j].pass) },
          { label: 'عدد الراسبين', f: (j: number) => String(subjectStats[j].fail) },
          { label: 'نسبة النجاح', f: (j: number) => fmtPct(subjectStats[j].passRate) },
        ].map((r) => (
          <tr key={r.label} className={cx(!print && 'bg-surface-2 font-semibold')}>
            <td className={cx(sticky0, !print && 'bg-surface-2!')} />
            <td className={cx(sticky1, !print && 'bg-surface-2! px-3 py-2 text-xs')}>{r.label}</td>
            {subjects.map((_, j) => (
              <td key={j} colSpan={per} className={cx(!print && 'px-1 py-2 text-center text-xs tabular-nums')}>
                {r.f(j)}
              </td>
            ))}
            <td colSpan={print ? 4 : 5} />
          </tr>
        ))}
      </tfoot>
    </table>
  )
}

function StatusDot({ status }: { status: Subject['status'] }) {
  const color = { draft: 'bg-faint', submitted: 'bg-info', returned: 'bg-warning', approved: 'bg-success' }[status]
  return <span title={STATUS_LABEL[status]} aria-label={STATUS_LABEL[status]} className={cx('inline-block size-2 rounded-full', color)} />
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className={cx('text-end font-medium', tone)}>{value}</dd>
    </div>
  )
}
