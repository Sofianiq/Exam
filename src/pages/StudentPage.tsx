import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { classKeyOf, useGrades, useSubjects } from '../app/queries'
import { buildStudentReport, type ReportSection } from '../app/results'
import { useSession } from '../app/session'
import { ResultCard, scopeLabel, type ResultScope } from '../components/ResultCard'
import { Badge, Button, Card, CardHeader, LoadingBlock, PageHeader, Segmented, cx } from '../components/ui'
import { backend } from '../data'
import type { StudentSummary } from '../lib/calc'
import { fmtNum, unitsLabel, yearLabel } from '../lib/format'
import { SHIFT_LABEL, SPECIAL_LABEL, STUDENT_STATUS_LABEL, TERM_LABEL, stageLabel } from '../lib/labels'
import { canSeeDepartment } from '../lib/perm'
import { NotFoundPage } from './NotFoundPage'

export const STATUS_TONE = { pass: 'success', pass_r2: 'success', carry: 'warning', fail: 'danger', incomplete: 'neutral', none: 'neutral' } as const

export function StudentPage() {
  const { studentId } = useParams()
  const s = useSession()
  const [scope, setScope] = useState<ResultScope | null>(null)
  const studentQ = useQuery({ queryKey: ['student', studentId], queryFn: () => backend.getStudent(studentId!), enabled: !!studentId })
  const student = studentQ.data ?? undefined
  const subjectsQ = useSubjects(student ? classKeyOf(student) : { year_id: '' }, !!student)
  const subjects = useMemo(() => subjectsQ.data ?? [], [subjectsQ.data])
  const gradesQ = useGrades(subjects.map((x) => x.id))
  const report = useMemo(
    () => (student ? buildStudentReport(subjects, gradesQ.data ?? [], student.id, s.settings) : null),
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
              {student.status !== 'active' && <Badge tone="warning">{STUDENT_STATUS_LABEL[student.status]}</Badge>}
            </span>
          }
          actions={
            scopes.length > 0 && (
              <>
                <Segmented value={effectiveScope} onChange={setScope} options={scopes} size="sm" />
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
        </div>

        {report.sections.length > 0 && (
          <h2 className="mt-8 mb-3 font-semibold">
            معاينة النتيجة للطباعة — <span className="text-gold-text">{scopeLabel(effectiveScope)}</span>
          </h2>
        )}
      </div>
      {report.sections.length > 0 && <ResultCard student={student} dept={dept} yearLabel={year} settings={s.settings} report={report} scope={effectiveScope} />}
    </div>
  )
}

function SectionDetails({ section }: { section: ReportSection }) {
  const s = useSession()
  const pass = s.settings.pass_mark
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
                <td className={cx('text-center font-semibold tabular-nums', r.total != null && r.total < pass && 'text-danger')}>{fmtNum(r.total)}</td>
                {anyR2 && (
                  <td className="text-center tabular-nums">
                    {r.complete && r.needsR2 ? (
                      r.r2Special ? (
                        <span className="text-warning">{SPECIAL_LABEL[r.r2Special]}</span>
                      ) : r.r2Total != null ? (
                        <span className={cx('font-semibold', r.r2Total < pass ? 'text-danger' : 'text-success')}>
                          {fmtNum(r.r2FinalSum)} ← {fmtNum(r.r2Total)}
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
