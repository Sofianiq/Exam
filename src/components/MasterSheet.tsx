import { Award, FileSpreadsheet, IdCard, Printer, Sheet } from 'lucide-react'
import { printPage, usePrinting } from '../app/print'
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInvalidate } from '../app/queries'
import { useClassResults, type StudentResultRow } from '../app/results'
import { useSession } from '../app/session'
import { backend } from '../data'
import { bandCounts } from '../lib/calc'
import { displayName, fmtDate, fmtNum, fmtPct, unitsLabel, yearLabel } from '../lib/format'
import { SHIFT_LONG, STATUS_LABEL, TERM_LABEL, stageShort } from '../lib/labels'
import { canManageDepartment } from '../lib/perm'
import type { ClassKey, SpecialCode, Subject, Term } from '../lib/types'
import { useConfirm, useToast } from './feedback'
import { PrintSignatures } from './PrintParts'
import { Badge, Button, Callout, Card, CardHeader, EmptyState, LoadingBlock, Segmented, cx } from './ui'

/** لون خانة النتيجة حسب حالة الطالب */
const STATUS_CLASS: Record<string, string> = {
  pass: 'ms-st-pass',
  pass_r2: 'ms-st-pass',
  pass_carry: 'ms-st-pass',
  carry: 'ms-st-carry',
  fail: 'ms-st-fail',
  incomplete: 'ms-st-muted',
  none: 'ms-st-muted',
}

/** الحالات الخاصة برمز مختصر داخل الأعمدة الضيقة (كما تُكتب عند إدخال الدرجات) */
const SPECIAL_SHORT: Record<SpecialCode, string> = { absent: 'غ', banned: 'ح', postponed: 'م' }

/** ورقة الطباعة: A3 أفقية (الأوضح) أو A4 أفقية */
type Paper = 'a3' | 'a4'
const PAPER_KEY = 'exam.master.paper'
const readPaper = (): Paper => {
  try {
    return localStorage.getItem(PAPER_KEY) === 'a4' ? 'a4' : 'a3'
  } catch {
    return 'a3'
  }
}

export function MasterSheet({ classKey, term }: { classKey: ClassKey; term: Term | 0 }) {
  const printing = usePrinting()
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const invalidate = useInvalidate()
  const [paper, setPaperState] = useState<Paper>(readPaper)
  const setPaper = (p: Paper) => {
    setPaperState(p)
    try {
      localStorage.setItem(PAPER_KEY, p)
    } catch {
      /* التخزين معطل: يبقى الاختيار للجلسة الحالية */
    }
  }
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
  const passAll = active.filter((r) => r.summary.status === 'pass' || r.summary.status === 'pass_r2' || r.summary.status === 'pass_carry').length
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
                <Segmented<Paper>
                  size="sm"
                  value={paper}
                  onChange={setPaper}
                  options={[
                    { value: 'a3', label: 'ورق A3' },
                    { value: 'a4', label: 'ورق A4' },
                  ]}
                />
                <Button
                  size="sm"
                  icon={<Printer className="size-4" />}
                  onClick={() => {
                    void backend.logEvent('report.print', `طباعة الماستر شيت (${paper.toUpperCase()}) — ${dept?.name} — المرحلة ${classKey.stage}`)
                    printPage()
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
          <MasterLegend compact={compact} />
          <div className="max-h-[74vh] overflow-auto scrollbar-thin">
            <MasterTable subjects={subjects} rows={rows} compact={compact} subjectStats={subjectStats} onNote={manage ? editNote : undefined} />
          </div>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="ملخص النتائج" />
            <dl className="divide-y divide-line text-sm">
              <Kpi label="ناجحون" value={`${passAll} طالب (${fmtPct(active.length ? passAll / active.length : null)})`} tone="text-success" />
              <Kpi label="مكملون (دور ثانٍ)" value={`${carry} طالب`} tone="text-warning" />
              <Kpi label="راسبون (بعد الدور الثاني)" value={`${failCount} طالب`} tone="text-danger" />
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

      {/* نسخة الطباعة (أفقي) — تُرسم عند الطباعة فقط */}
      {printing && (
        <div className={cx('print-only', paper === 'a3' ? 'print-ms-a3' : 'print-ms-a4')} data-master-print={paper}>
          {/* ترويسة مضغوطة: تترك أكبر مساحة ممكنة للجدول */}
          <header className="ms-print-head">
            <div className="ms-print-side">
              <b>{s.settings.university_name}</b>
              <span>{s.settings.college_name}</span>
              <span>قسم {dept?.name}</span>
            </div>
            <div className="ms-print-title">
              <img src="./logo.png" alt="" />
              <div>
                <h1>الماستر شيت لدرجات الطلبة</h1>
                <p>
                  المرحلة {stageShort(classKey.stage)} — {SHIFT_LONG[classKey.shift]} — {termLabel}
                </p>
              </div>
            </div>
            <div className="ms-print-side ms-print-end">
              <b>اللجنة الامتحانية</b>
              <span>العام الدراسي: {yearLabel(s.years.find((y) => y.id === classKey.year_id)?.label)}</span>
              <span>تاريخ الطباعة: {fmtDate(new Date())}</span>
            </div>
          </header>
          <div className="ms-print-meta">
            <span>عدد الطلبة: {rows.length}</span>
            <span>عدد المواد: {n}</span>
            <span>مجموع الوحدات: {totalUnits}</span>
            <span>درجة النجاح: {s.settings.pass_mark}</span>
            <span>
              المواد المعتمدة: {approved} من {n}
            </span>
            <span>المعدل: {s.settings.average_mode === 'weighted' ? 'موزون بالوحدات' : 'حسابي بسيط'}</span>
          </div>
          <MasterTable subjects={subjects} rows={rows} compact={compact} subjectStats={subjectStats} print paper={paper} />
          <MasterLegend compact={compact} print />
          <PrintSignatures
            compact
            labels={['مقرر القسم', 'المدقق', 'رئيس القسم', 'رئيس اللجنة الامتحانية', 'عميد الكلية']}
            names={[null, null, dept?.head_name, s.settings.committee_head_name, s.settings.dean_name]}
          />
        </div>
      )}
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

/** مفتاح قراءة ألوان ورموز الماستر شيت (على الشاشة وفي الطباعة) */
function MasterLegend({ compact, print }: { compact: boolean; print?: boolean }) {
  return (
    <div className={cx('ms-legend', print ? 'ms-legend-print' : 'border-b border-line px-5 py-2.5')}>
      <b>مفتاح القراءة:</b>
      {!compact && (
        <>
          <span>
            <i className="ms-chip ms-chip-cw" /> السعي
          </span>
          <span>
            <i className="ms-chip ms-chip-fin" /> الامتحان النهائي
          </span>
        </>
      )}
      <span>
        <i className="ms-chip ms-chip-tot" /> {compact ? 'الدرجة النهائية للمادة' : 'المجموع'}
      </span>
      <span>
        <i className="ms-chip ms-chip-fail" /> درجة راسبة
      </span>
      {!compact && (
        <span>
          <i className="ms-chip ms-chip-r2" /> الدور الثاني (د2)
        </span>
      )}
      <span>غ = غائب</span>
      <span>ح = محروم</span>
      <span>م = مؤجل</span>
      <span>ق = ناجح بقرار</span>
    </div>
  )
}

/**
 * جدول الماستر شيت: أسماء المواد ووحداتها عمودية لتضييق الأعمدة، وأعمدة السعي والنهائي والمجموع
 * ملوّنة بألوان ثابتة لتسهيل التدقيق، مع فاصل سميك بين المواد وبعد كل خمسة طلبة.
 */
function MasterTable({
  subjects,
  rows,
  compact,
  subjectStats,
  print,
  paper = 'a3',
  onNote,
}: {
  subjects: Subject[]
  rows: StudentResultRow[]
  compact: boolean
  subjectStats: ReturnType<typeof useClassResults>['subjectStats']
  print?: boolean
  paper?: Paper
  onNote?: (r: StudentResultRow) => void
}) {
  const per = compact ? 1 : 3
  const cols = subjects.length * per
  // حجم خط الطباعة حسب الورقة وعدد أعمدة الدرجات
  const fontSize = !print ? undefined : paper === 'a3' ? (cols > 45 ? '6.6pt' : cols > 33 ? '7.6pt' : '8.8pt') : cols > 36 ? '5.4pt' : cols > 24 ? '6.3pt' : '7.4pt'
  // في النتيجة السنوية تُجمع المواد تحت عنوان فصلها
  const termGroups = compact ? [1, 2].map((t) => ({ term: t as Term, count: subjects.filter((x) => x.term === t).length })).filter((g) => g.count > 0) : []
  const grouped = termGroups.length > 1
  const headRows = grouped || !compact ? 2 : 1
  const startsGroup = (j: number) => !compact || j === 0 || subjects[j].term !== subjects[j - 1].term

  const subjectHead = (x: Subject, j: number) => (
    <th key={x.id} colSpan={per} className={cx('ms-subject', startsGroup(j) && 'ms-g0')}>
      <span className="ms-v">
        <span className="ms-subject-name">{x.name}</span>
        <span className="ms-subject-units">
          {unitsLabel(x.units)}
          {x.ministerial ? ' · وزارية' : ''}
        </span>
      </span>
      {!print && (
        <span className="mt-1 flex justify-center">
          <StatusDot status={x.status} />
        </span>
      )}
    </th>
  )

  return (
    <table className={cx('ms', print ? 'ms-print' : 'ms-screen', compact && 'ms-compact')} style={fontSize ? { fontSize } : undefined}>
      <thead>
        <tr>
          <th rowSpan={headRows} className="ms-seq">
            ت
          </th>
          <th rowSpan={headRows} className="ms-name">
            اسم الطالب
          </th>
          {grouped
            ? termGroups.map((g) => (
                <th key={g.term} colSpan={g.count} className="ms-term ms-g0">
                  {TERM_LABEL[g.term]}
                </th>
              ))
            : subjects.map(subjectHead)}
          <th rowSpan={headRows} className="ms-sum ms-g0">
            <span className="ms-v">مجموع الدرجات</span>
          </th>
          <th rowSpan={headRows} className="ms-avg">
            <span className="ms-v">المعدل</span>
          </th>
          <th rowSpan={headRows} className="ms-rank">
            <span className="ms-v">الترتيب</span>
          </th>
          <th rowSpan={headRows} className="ms-result">
            النتيجة
          </th>
          <th rowSpan={headRows} className="ms-notes">
            الملاحظات
          </th>
        </tr>
        {grouped && <tr>{subjects.map(subjectHead)}</tr>}
        {!compact && (
          <tr>
            {subjects.map((x) => (
              <Fragment key={x.id}>
                <th className="ms-sub ms-cw ms-g0">
                  <span className="ms-v">السعي</span>
                  <b>{x.coursework_max}</b>
                </th>
                <th className="ms-sub ms-fin">
                  <span className="ms-v">النهائي</span>
                  <b>{x.final_max + x.practical_max}</b>
                </th>
                <th className="ms-sub ms-tot">
                  <span className="ms-v">المجموع</span>
                  <b>100</b>
                </th>
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
          // فاصل سميك بعد كل خمسة طلبة لتسهيل تتبع الصفوف عند التدقيق
          const five = (i + 1) % 5 === 0
          const b5 = five && 'ms-b5'
          return (
            <Fragment key={row.student.id}>
              <tr className={cx(inactive && 'ms-inactive', five && !hasR2 && 'ms-five')}>
                <td rowSpan={span} className={cx('ms-seq', b5)}>
                  {i + 1}
                </td>
                <td rowSpan={span} className={cx('ms-name', b5)}>
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
                    <td key={j} className={cx('ms-tot', startsGroup(j) && 'ms-g0', r.finalPassed === false && r.finalTotal != null && 'ms-fail print-fail', r.finalSpecial && 'ms-special')}>
                      {r.finalSpecial ? SPECIAL_SHORT[r.finalSpecial] : fmtNum(r.finalTotal)}
                      {r.finalRound === 2 && <sup className="ms-mark-r2">د2</sup>}
                      {r.byDecision && (
                        <sup className="ms-mark-dec" title="ناجح بقرار">
                          ق
                        </sup>
                      )}
                    </td>
                  ) : (
                    <Fragment key={j}>
                      <td className="ms-cw ms-g0">{fmtNum(r.coursework)}</td>
                      <td className={cx('ms-fin', r.special && 'ms-special')}>{r.special ? SPECIAL_SHORT[r.special] : fmtNum(r.finalSum)}</td>
                      <td className={cx('ms-tot', r.passed === false && r.total != null && 'ms-fail print-fail')}>
                        {fmtNum(r.total)}
                        {r.byDecision && r.finalRound === 1 && (
                          <sup className="ms-mark-dec" title="ناجح بقرار">
                            ق
                          </sup>
                        )}
                      </td>
                    </Fragment>
                  ),
                )}
                <td rowSpan={span} className={cx('ms-sum ms-g0', b5)}>
                  {fmtNum(sum.sum)}
                </td>
                <td rowSpan={span} className={cx('ms-avg', b5)}>
                  {fmtNum(sum.average)}
                </td>
                <td rowSpan={span} className={cx('ms-rank', b5)}>
                  {row.rank ?? ''}
                </td>
                <td rowSpan={span} className={cx('ms-result', inactive ? 'ms-st-muted' : STATUS_CLASS[sum.status], b5)}>
                  {inactive ? (row.student.status === 'withdrawn' ? 'منسحب' : 'مؤجل') : sum.statusText}
                </td>
                <td rowSpan={span} className={cx('ms-notes', b5)}>
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
                <tr className={cx('ms-r2', inactive && 'ms-inactive', five && 'ms-five')}>
                  {row.results.map((r, j) => {
                    const show = r.complete && r.needsR2
                    return (
                      <Fragment key={j}>
                        <td className="ms-g0 ms-r2-tag">{show ? 'د2' : ''}</td>
                        <td className={cx(show && r.r2Special && 'ms-special')}>{show ? (r.r2Special ? SPECIAL_SHORT[r.r2Special] : fmtNum(r.r2FinalSum)) : ''}</td>
                        <td className={cx('ms-r2-total', show && r.r2Total != null && r.finalPassed === false && 'ms-fail print-fail', show && r.r2Total != null && r.finalPassed === true && 'ms-ok')}>
                          {show ? fmtNum(r.r2Total) : ''}
                          {show && r.byDecision && r.finalRound === 2 && (
                            <sup className="ms-mark-dec" title="ناجح بقرار">
                              ق
                            </sup>
                          )}
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
      <tbody className="ms-foot">
        {[
          { label: 'المعدل العام', f: (j: number) => fmtNum(subjectStats[j].avg) },
          { label: 'أعلى درجة', f: (j: number) => fmtNum(subjectStats[j].max) },
          { label: 'أدنى درجة', f: (j: number) => fmtNum(subjectStats[j].min) },
          { label: 'عدد الناجحين', f: (j: number) => String(subjectStats[j].pass) },
          { label: 'عدد الراسبين', f: (j: number) => String(subjectStats[j].fail) },
          { label: 'نسبة النجاح', f: (j: number) => fmtPct(subjectStats[j].passRate) },
        ].map((r) => (
          <tr key={r.label}>
            <td colSpan={2} className="ms-foot-label">
              {r.label}
            </td>
            {subjects.map((_, j) => (
              <td key={j} colSpan={per} className={cx(startsGroup(j) && 'ms-g0')}>
                {r.f(j)}
              </td>
            ))}
            <td colSpan={5} className="ms-g0" />
          </tr>
        ))}
      </tbody>
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
