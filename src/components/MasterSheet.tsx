import { Award, FileSpreadsheet, IdCard, Printer, Sheet } from 'lucide-react'
import { printPage, usePrinting } from '../app/print'
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInvalidate } from '../app/queries'
import { useClassResults, type StudentResultRow } from '../app/results'
import { groupTitle, groupUnits, masterCell, masterGroups, masterTotals, totalsCaption, type MsGroup, type MsTone } from '../app/masterLayout'
import { useSession } from '../app/session'
import { backend } from '../data'
import { bandCounts } from '../lib/calc'
import { displayName, fmtDate, fmtNum, fmtPct, unitsLabel, yearLabel } from '../lib/format'
import { SHIFT_LONG, STATUS_LABEL, TERM_LABEL, stageShort } from '../lib/labels'
import { canManageDepartment } from '../lib/perm'
import type { ClassKey, Settings, Subject, Term } from '../lib/types'
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
  const weighted = s.settings.average_mode === 'weighted'

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
          <MasterLegend compact={compact} weighted={weighted} />
          <div className="max-h-[74vh] overflow-auto scrollbar-thin">
            <MasterTable subjects={subjects} rows={rows} compact={compact} subjectStats={subjectStats} settings={s.settings} onNote={manage ? editNote : undefined} />
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
          <MasterTable subjects={subjects} rows={rows} compact={compact} subjectStats={subjectStats} settings={s.settings} print paper={paper} />
          <MasterLegend compact={compact} print weighted={weighted} />
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
function MasterLegend({ compact, print, weighted }: { compact: boolean; print?: boolean; weighted: boolean }) {
  return (
    <div className={cx('ms-legend', print ? 'ms-legend-print' : 'border-b border-line px-5 py-2.5')}>
      <b>مفتاح القراءة:</b>
      {!compact && (
        <>
          <span>
            <i className="ms-chip ms-chip-r1" /> الدور الأول
          </span>
          <span>
            <i className="ms-chip ms-chip-r2" /> الدور الثاني
          </span>
        </>
      )}
      <span>
        <i className="ms-chip ms-chip-final" /> الدرجة النهائية
      </span>
      <span>
        <i className="ms-chip ms-chip-dec" /> درجة نهائية معدلة بقرار (ق)
      </span>
      <span>
        <i className="ms-chip ms-chip-carry" /> مادة محمل بها الطالب
      </span>
      <span>
        <i className="ms-chip ms-chip-fail" /> درجة راسبة
      </span>
      {compact && <span>د2 = حُسمت في الدور الثاني</span>}
      <span>غ = غائب · ح = محروم · م = مؤجل</span>
      <span className="ms-legend-formula">
        {weighted ? 'مجموع الدرجات = Σ (الدرجة النهائية × وحدات المادة) · المعدل = مجموع الدرجات ÷ مجموع الوحدات' : 'المعدل = مجموع الدرجات ÷ عدد المواد'}
      </span>
    </div>
  )
}

const TONE_CLASS: Record<MsTone, string> = {
  r2: 'ms-t-r2',
  decision: 'ms-t-dec',
  carried: 'ms-t-carry',
  fail: 'ms-t-fail',
  special: 'ms-t-special',
}

/** حجم خط الطباعة حسب الورقة وعدد أعمدة الدرجات حتى يتسع الجدول لعرض الصفحة */
function printFont(paper: Paper, cols: number) {
  if (paper === 'a3') return cols > 54 ? '6pt' : cols > 44 ? '6.6pt' : cols > 34 ? '7.3pt' : cols > 24 ? '8pt' : '8.8pt'
  return cols > 40 ? '4.8pt' : cols > 30 ? '5.4pt' : cols > 20 ? '6.2pt' : '7.2pt'
}

/**
 * جدول الماستر شيت بترتيب سجل درجات برنامج اللجنة: لكل مادة الدور الأول (السعي، العملي النهائي، النظري)
 * ثم الدور الثاني لمن امتحن فيه ثم الدرجة النهائية؛ وبعد المواد مجموع الدرجات الموزون والمعدل والترتيب
 * والنتيجة والملاحظات. فاصل سميك بين المواد وبعد كل خمسة طلبة.
 */
function MasterTable({
  subjects,
  rows,
  compact,
  subjectStats,
  settings,
  print,
  paper = 'a3',
  onNote,
}: {
  subjects: Subject[]
  rows: StudentResultRow[]
  compact: boolean
  subjectStats: ReturnType<typeof useClassResults>['subjectStats']
  settings: Settings
  print?: boolean
  paper?: Paper
  onNote?: (r: StudentResultRow) => void
}) {
  const groups = masterGroups(subjects, rows, compact)
  const cols = groups.reduce((a, g) => a + g.cols.length, 0)
  const caption = totalsCaption(settings)
  // في النتيجة السنوية تُجمع المواد تحت عنوان فصلها
  const termGroups = compact ? [1, 2].map((t) => ({ term: t as Term, count: subjects.filter((x) => x.term === t).length })).filter((g) => g.count > 0) : []
  const grouped = termGroups.length > 1
  const headRows = compact ? (grouped ? 2 : 1) : 3
  const startsTerm = (j: number) => j === 0 || subjects[j].term !== subjects[j - 1].term

  const subjectHead = (g: MsGroup) =>
    compact ? (
      <th key={g.subject.id} className={cx('ms-subject ms-subject-v', (!grouped || startsTerm(g.index)) && 'ms-g0')}>
        <span className="ms-v">
          <span className="ms-subject-name">{groupTitle(g.subject)}</span>
          <span className="ms-subject-units">{groupUnits(g.subject)}</span>
        </span>
        {!print && (
          <span className="mt-1 flex justify-center">
            <StatusDot status={g.subject.status} />
          </span>
        )}
      </th>
    ) : (
      <th key={g.subject.id} colSpan={g.cols.length} className={cx('ms-subject ms-g0', g.index % 2 ? 'ms-subj-b' : 'ms-subj-a')}>
        <span className="ms-subject-name">{groupTitle(g.subject)}</span>
        <span className="ms-subject-units">
          ({groupUnits(g.subject)})
          {!print && (
            <span className="ms-dot">
              <StatusDot status={g.subject.status} />
            </span>
          )}
        </span>
      </th>
    )

  const endHead = (cls: string, label: string, sub?: string) => (
    <th rowSpan={headRows} className={cls}>
      <span className="ms-v">
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </span>
    </th>
  )

  return (
    <table className={cx('ms', print ? 'ms-print' : 'ms-screen', compact && 'ms-compact')} style={print ? { fontSize: printFont(paper, cols) } : undefined}>
      <thead>
        <tr>
          <th rowSpan={headRows} className="ms-seq">
            ت
          </th>
          <th rowSpan={headRows} className="ms-name">
            اسم الطالب
          </th>
          {grouped
            ? termGroups.map((t) => (
                <th key={t.term} colSpan={t.count} className="ms-term ms-g0">
                  {TERM_LABEL[t.term]}
                </th>
              ))
            : groups.map(subjectHead)}
          {endHead('ms-sum ms-g0', 'مجموع الدرجات', caption.total)}
          {endHead('ms-avg', 'المعدل', caption.average)}
          {endHead('ms-rank', 'الترتيب')}
          <th rowSpan={headRows} className="ms-result">
            النتيجة
          </th>
          <th rowSpan={headRows} className="ms-notes">
            الملاحظات
          </th>
        </tr>
        {grouped && <tr>{groups.map(subjectHead)}</tr>}
        {!compact && (
          <tr>
            {groups.map((g) => (
              <Fragment key={g.subject.id}>
                {g.r1.length > 0 && (
                  <th colSpan={g.r1.length} className={cx('ms-round ms-r1h ms-g0', g.r1.length === 1 && 'ms-round-v')}>
                    {g.r1.length === 1 ? <span className="ms-v">الدور الأول</span> : 'الدور الأول'}
                  </th>
                )}
                {g.r2.length > 0 && (
                  <th colSpan={g.r2.length} className={cx('ms-round ms-r2h', g.r2.length === 1 && 'ms-round-v')}>
                    {g.r2.length === 1 ? <span className="ms-v">الدور الثاني</span> : 'الدور الثاني'}
                  </th>
                )}
                <th rowSpan={2} className={cx('ms-sub ms-finh', g.r1.length === 0 && 'ms-g0')}>
                  <span className="ms-v">الدرجة النهائية</span>
                  <b>100</b>
                </th>
              </Fragment>
            ))}
          </tr>
        )}
        {!compact && (
          <tr>
            {groups.map((g) => (
              <Fragment key={g.subject.id}>
                {[...g.r1, ...g.r2].map((c, k) => (
                  <th key={k} className={cx('ms-sub', k < g.r1.length ? 'ms-r1h' : 'ms-r2h', k === 0 && 'ms-g0')}>
                    <span className="ms-v">{c.label}</span>
                    <b>{c.max}</b>
                  </th>
                ))}
              </Fragment>
            ))}
          </tr>
        )}
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const inactive = row.student.status !== 'active'
          const totals = masterTotals(row.summary, settings)
          // فاصل سميك بعد كل خمسة طلبة لتسهيل تتبع الصفوف عند التدقيق
          return (
            <tr key={row.student.id} className={cx(inactive && 'ms-inactive', (i + 1) % 5 === 0 && 'ms-five', i % 2 === 1 && 'ms-zebra')}>
              <td className="ms-seq">{i + 1}</td>
              <td className="ms-name">
                {print ? (
                  row.student.full_name
                ) : (
                  <Link to={`/student/${row.student.id}`} className="hover:text-primary-text hover:underline">
                    {row.student.full_name}
                  </Link>
                )}
              </td>
              {groups.map((g) =>
                g.cols.map((c, k) => {
                  const cell = masterCell(g, c, row, compact)
                  const g0 = compact ? !grouped || startsTerm(g.index) : k === 0
                  return (
                    <td key={`${g.subject.id}-${k}`} className={cx(`ms-c-${c.kind}`, g0 && 'ms-g0', cell.tone && TONE_CLASS[cell.tone], cell.tone === 'fail' && 'print-fail')}>
                      {cell.text}
                      {cell.mark && <sup className={cell.mark === 'ق' ? 'ms-mark-dec' : 'ms-mark-r2'}>{cell.mark}</sup>}
                    </td>
                  )
                }),
              )}
              <td className="ms-sum ms-g0">{fmtNum(totals.total)}</td>
              <td className="ms-avg">{fmtNum(totals.average)}</td>
              <td className="ms-rank">{row.rank ?? ''}</td>
              <td className={cx('ms-result', inactive ? 'ms-st-muted' : STATUS_CLASS[row.summary.status])}>
                {inactive ? (row.student.status === 'withdrawn' ? 'منسحب' : 'مؤجل') : row.summary.statusText}
              </td>
              <td className="ms-notes">
                {onNote ? (
                  <button className="w-full text-start hover:text-primary-text" title="تعديل الملاحظة" onClick={() => onNote(row)}>
                    {row.student.notes || <span className="text-faint">+ ملاحظة</span>}
                  </button>
                ) : (
                  row.student.notes
                )}
              </td>
            </tr>
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
            {groups.map((g) => (
              <td key={g.subject.id} colSpan={g.cols.length} className={cx((!compact || !grouped || startsTerm(g.index)) && 'ms-g0')}>
                {r.f(g.index)}
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
