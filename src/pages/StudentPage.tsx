import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, History, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { classKeyOf, useGrades, useSubjects } from '../app/queries'
import { buildStudentReport, type ReportSection } from '../app/results'
import { useSession } from '../app/session'
import { ResultSheets, scopeLabel, type ResultScope, type SlipProps } from '../components/ResultSlip'
import { Badge, Button, Card, CardHeader, LoadingBlock, PageHeader, Segmented, cx } from '../components/ui'
import { backend } from '../data'
import type { StudentSummary } from '../lib/calc'
import { fmtNum, unitsLabel, yearLabel } from '../lib/format'
import { SHIFT_LABEL, SPECIAL_LABEL, STUDENT_STATUS_LABEL, TERM_LABEL, stageLabel } from '../lib/labels'
import { canSeeDepartment } from '../lib/perm'
import { NotFoundPage } from './NotFoundPage'
import { ScaledPreview } from './ResultsPage'

export const STATUS_TONE = { pass: 'success', pass_r2: 'success', pass_carry: 'success', carry: 'warning', fail: 'danger', incomplete: 'neutral', none: 'neutral' } as const

export function StudentPage() {
  const { studentId } = useParams()
  const s = useSession()
  const [scope, setScope] = useState<ResultScope | null>(null)
  const [copies, setCopies] = useState<1 | 2>(2)
  const studentQ = useQuery({ queryKey: ['student', studentId], queryFn: () => backend.getStudent(studentId!), enabled: !!studentId })
  const student = studentQ.data ?? undefined
  const subjectsQ = useSubjects(student ? classKeyOf(student) : { year_id: '' }, !!student)
  const subjects = useMemo(() => subjectsQ.data ?? [], [subjectsQ.data])
  const gradesQ = useGrades(subjects.map((x) => x.id))
  const report = useMemo(
    () => (student ? buildStudentReport(subjects, gradesQ.data ?? [], student.id, s.settings) : null),
    [student, subjects, gradesQ.data, s.settings],
  )
  // النتيجة الرسمية المطبوعة: المعتمد فقط، لتطابق صفحة التحقق برمز QR
  const official = useMemo(
    () => (student ? buildStudentReport(subjects, gradesQ.data ?? [], student.id, s.settings, true) : null),
    [student, subjects, gradesQ.data, s.settings],
  )

  if (studentQ.isLoading || subjectsQ.isLoading || gradesQ.isLoading) return <LoadingBlock />
  if (!student || !report || !canSeeDepartment(s.profile, student.department_id)) return <NotFoundPage title="الطالب غير موجود" />
  const dept = s.deptById(student.department_id)
  const year = yearLabel(s.years.find((y) => y.id === student.year_id)?.label)
  const scopes: { value: ResultScope; label: string }[] = [
    ...report.sections.map((x) => ({ value: x.term as ResultScope, label: TERM_LABEL[x.term] })),
    ...(report.sections.length > 1 ? [{ value: 0 as ResultScope, label: 'الفصلان معاً' }] : []),
  ]
  // الافتراضي: الفصلان معاً إذا كان لكليهما نتائج، وإلا آخر فصل فيه نتائج
  const withData = report.sections.filter((x) => x.summary.status !== 'none')
  const defaultScope: ResultScope = withData.length > 1 ? 0 : (withData[withData.length - 1]?.term ?? scopes[0]?.value ?? 1)
  const effectiveScope = scope != null && scopes.some((x) => x.value === scope) ? scope : defaultScope
  // نسختان في الصفحة الأفقية: نسخة للطالب ونسخة لأرشيف القسم
  const slip: SlipProps = { student, dept, yearLabel: year, settings: s.settings, report: official ?? report, scope: effectiveScope }
  const unapproved = subjects.filter((x) => (effectiveScope === 0 || x.term === effectiveScope) && x.status !== 'approved').length
  const slips: SlipProps[] = copies === 2 ? [{ ...slip, copy: 'نسخة الطالب' }, { ...slip, copy: 'نسخة القسم' }] : [slip]

  return (
    <div>
      <div className="no-print">
        <PageHeader
          crumbs={
            <>
              <Link to={`/departments/${student.department_id}`} className="hover:text-ink">
                {dept?.name}
              </Link>
              <ChevronLeft className="size-3" />
              <Link to={`/class/${student.department_id}/${student.stage}/${student.shift}?tab=master`} className="hover:text-ink">
                {stageLabel(student.stage)} — {SHIFT_LABEL[student.shift]}
              </Link>
            </>
          }
          title={student.full_name}
          subtitle={
            <span className="flex flex-wrap items-center gap-2">
              قسم {dept?.name} — {stageLabel(student.stage)} — {SHIFT_LABEL[student.shift]} — {year}
              {student.student_no && (
                <span className="text-muted">
                  — الرقم الجامعي: <span dir="ltr" className="tabular-nums">{student.student_no}</span>
                </span>
              )}
              {student.status !== 'active' && <Badge tone="warning">{STUDENT_STATUS_LABEL[student.status]}</Badge>}
              {student.legacy_import_id && <Badge tone="info">مرحّل من النظام السابق</Badge>}
            </span>
          }
          actions={
            scopes.length > 0 && (
              <>
                <Segmented value={effectiveScope} onChange={setScope} options={scopes} size="sm" />
                <Segmented<1 | 2>
                  value={copies}
                  onChange={setCopies}
                  size="sm"
                  options={[
                    { value: 2, label: 'نسختان' },
                    { value: 1, label: 'نسخة واحدة' },
                  ]}
                />
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Printer className="size-4" />}
                  onClick={() => {
                    void backend.logEvent('report.print', `طباعة نتيجة — ${student.full_name}`)
                    window.print()
                  }}
                >
                  طباعة النتيجة
                </Button>
              </>
            )
          }
        />

        <div className="space-y-4">
          {report.sections.map((sec) => (
            <SectionDetails key={sec.term} section={sec} />
          ))}
          {report.sections.length > 1 && <SummaryCard title="النتيجة السنوية (الفصلان معاً)" summary={report.annual} />}
          {report.sections.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted">لا توجد مواد مسجلة لصف هذا الطالب بعد.</Card>
          )}
          {student.student_no && <AcademicHistory studentNo={student.student_no} currentId={student.id} />}
        </div>

        {report.sections.length > 0 && (
          <>
            <h2 className="mt-8 mb-3 font-semibold">
              معاينة النتيجة للطباعة — <span className="text-gold-text">{scopeLabel(effectiveScope)}</span>
              <span className="ms-2 text-sm font-normal text-muted">(A4 أفقية)</span>
            </h2>
            {unapproved > 0 && (
              <p className="mb-3 text-sm text-warning">
                تتضمن النتيجة الرسمية المواد المعتمدة فقط؛ {unapproved} {unapproved === 1 ? 'مادة غير معتمدة' : 'مواد غير معتمدة'} بعد وستظهر «غير مكتملة» حتى اعتمادها.
              </p>
            )}
            <ScaledPreview>
              <ResultSheets items={slips} className="slip-preview" />
            </ScaledPreview>
          </>
        )}
      </div>
      {report.sections.length > 0 && <ResultSheets items={slips} className="print-only" />}
    </div>
  )
}

function SectionDetails({ section }: { section: ReportSection }) {
  const anyR2 = section.items.some((x) => x.result.complete && x.result.needsR2)
  return (
    <Card>
      <CardHeader title={TERM_LABEL[section.term]} subtitle={`${section.items.length} مادة — ${unitsLabel(section.summary.units)}`} />
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>المادة</th>
              <th className="text-center">الوحدات</th>
              <th className="text-center">السعي</th>
              <th className="text-center">النهائي</th>
              <th className="text-center">المجموع</th>
              {anyR2 && <th className="text-center">الدور الثاني</th>}
              <th className="text-center">الدرجة النهائية</th>
              <th className="text-center">التقدير</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map(({ subject, result: r }) => (
              <tr key={subject.id}>
                <td className="font-medium">
                  <Link to={`/subjects/${subject.id}`} className="hover:text-primary-text hover:underline">
                    {subject.name}
                  </Link>
                </td>
                <td className="text-center tabular-nums text-muted">{subject.units ?? '—'}</td>
                <td className="text-center tabular-nums">{fmtNum(r.coursework)}</td>
                <td className="text-center tabular-nums">{r.special ? <span className="text-warning">{SPECIAL_LABEL[r.special]}</span> : fmtNum(r.finalSum)}</td>
                <td className={cx('text-center font-semibold tabular-nums', r.total != null && r.passed === false && 'text-danger')}>
                  {fmtNum(r.total)}
                  {r.finalRound === 1 && !!r.decision && <span className="ms-1 text-xs font-medium text-gold-text">(قرار +{fmtNum(r.decision)})</span>}
                </td>
                {anyR2 && (
                  <td className="text-center tabular-nums">
                    {r.complete && r.needsR2 ? (
                      r.r2Special ? (
                        <span className="text-warning">{SPECIAL_LABEL[r.r2Special]}</span>
                      ) : r.r2Total != null ? (
                        <span
                          className={cx('font-semibold', r.finalPassed === false ? 'text-danger' : 'text-success')}
                          title={r.r2Raw != null && r.r2Raw !== r.r2Total ? `المجموع قبل خصم الدور الثاني: ${fmtNum(r.r2Raw)}` : undefined}
                        >
                          {fmtNum(r.r2FinalSum)} ← {fmtNum(r.r2Total)}
                          {r.finalRound === 2 && !!r.decision && <span className="ms-1 text-xs font-medium text-gold-text">(قرار +{fmtNum(r.decision)})</span>}
                        </span>
                      ) : (
                        <Badge tone="warning">بانتظار الدور الثاني</Badge>
                      )
                    ) : (
                      ''
                    )}
                  </td>
                )}
                <td className={cx('text-center text-base font-bold tabular-nums', r.finalPassed === false && 'text-danger')}>
                  {r.finalSpecial ? <span className="text-sm text-warning">{SPECIAL_LABEL[r.finalSpecial]}</span> : fmtNum(r.finalTotal)}
                  {r.overridden && (
                    <span className="ms-1 align-middle text-[0.65rem] font-medium text-info" title="الدرجة النهائية مثبتة كما وردت من النظام السابق">
                      مثبتة
                    </span>
                  )}
                </td>
                <td className={cx('text-center text-sm font-medium', r.finalPassed === false ? 'text-danger' : 'text-primary-text')}>{r.finalLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SummaryBar summary={section.summary} />
    </Card>
  )
}

function SummaryBar({ summary }: { summary: StudentSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line bg-surface-2/50 px-5 py-3 text-sm">
      <span>
        مجموع الدرجات: <b className="tabular-nums">{fmtNum(summary.sum) || '—'}</b>
      </span>
      <span>
        المعدل: <b className="tabular-nums">{fmtNum(summary.average) || '—'}</b>
        {summary.averageLabel && <span className="text-muted"> ({summary.averageLabel})</span>}
      </span>
      <span className="flex items-center gap-2">
        النتيجة: <Badge tone={STATUS_TONE[summary.status]}>{summary.statusText || '—'}</Badge>
      </span>
    </div>
  )
}

function SummaryCard({ title, summary }: { title: string; summary: StudentSummary }) {
  return (
    <Card>
      <CardHeader title={title} />
      <SummaryBar summary={summary} />
    </Card>
  )
}

/** السجل الأكاديمي للطالب في كل السنوات (يربطها الرقم الجامعي) */
function AcademicHistory({ studentNo, currentId }: { studentNo: string; currentId: string }) {
  const s = useSession()
  const q = useQuery({
    queryKey: ['history', studentNo],
    queryFn: async () => {
      const records = await backend.findStudentsByNo(studentNo)
      const rows = []
      for (const st of records) {
        const subjects = await backend.listSubjects({ year_id: st.year_id, department_id: st.department_id, stage: st.stage, shift: st.shift })
        const grades = await backend.getGrades(subjects.map((x) => x.id))
        const rep = buildStudentReport(subjects, grades, st.id, s.settings)
        rows.push({ st, year: s.years.find((y) => y.id === st.year_id)?.label ?? '', annual: rep.annual, terms: rep.sections.length })
      }
      return rows.sort((a, b) => a.year.localeCompare(b.year) || a.st.stage - b.st.stage)
    },
  })
  const rows = q.data ?? []
  if (rows.length < 2) return null
  return (
    <Card>
      <CardHeader title="السجل الأكاديمي" subtitle="نتائج الطالب في كل السنوات الدراسية (بالرقم الجامعي)" icon={<History className="size-5" />} />
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>السنة الدراسية</th>
              <th>القسم والمرحلة</th>
              <th className="text-center">المعدل السنوي</th>
              <th className="text-center">النتيجة</th>
              <th>المواد المحملة / الراسبة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ st, year, annual }) => (
              <tr key={st.id} className={cx(st.id === currentId && 'bg-primary-soft/40')}>
                <td className="font-medium tabular-nums">
                  <Link to={`/student/${st.id}`} className="hover:text-primary-text hover:underline">
                    {yearLabel(year)}
                  </Link>
                </td>
                <td>
                  {s.deptById(st.department_id)?.name} — {stageLabel(st.stage)} — {SHIFT_LABEL[st.shift]}
                </td>
                <td className="text-center font-semibold tabular-nums">
                  {fmtNum(annual.average) || '—'}
                  {annual.averageLabel && <span className="ms-1 text-xs font-normal text-muted">({annual.averageLabel})</span>}
                </td>
                <td className="text-center">
                  <Badge tone={STATUS_TONE[annual.status]}>{annual.statusText || '—'}</Badge>
                </td>
                <td className="text-sm text-muted">{annual.finalFailed.join('، ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
