import { FileSpreadsheet, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProgress, useSubjects } from '../app/queries'
import { useSession } from '../app/session'
import { useToast } from '../components/feedback'
import { PrintHeader, PrintSignatures } from '../components/PrintParts'
import { Button, Card, LoadingBlock, PageHeader, ProgressBar, Segmented, Select, StatusBadge } from '../components/ui'
import { backend } from '../data'
import { displayName, fmtNum, fmtPct, yearLabel } from '../lib/format'
import { SHIFT_LABEL, STATUS_LABEL, TERM_LABEL, stageShort } from '../lib/labels'
import { canViewAll } from '../lib/perm'
import type { SubjectProgress } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

export function ProgressPage() {
  const s = useSession()
  const toast = useToast()
  const isHead = s.profile.role === 'head'
  const [dept, setDept] = useState(isHead ? (s.profile.department_id ?? '') : '')
  const [term, setTerm] = useState(0)
  const [view, setView] = useState<'subjects' | 'teachers'>('subjects')
  const subjectsQ = useSubjects({ year_id: s.yearId })
  const progressQ = useProgress(s.yearId)
  const pmap = useMemo(() => new Map(progressQ.data?.map((p) => [p.subject_id, p])), [progressQ.data])
  const list = (subjectsQ.data ?? [])
    .filter((x) => (!dept || x.department_id === dept) && (!term || x.term === term))
    .sort(
      (a, b) =>
        (s.deptById(a.department_id)?.sort ?? 0) - (s.deptById(b.department_id)?.sort ?? 0) ||
        a.stage - b.stage ||
        a.shift.localeCompare(b.shift) ||
        a.term - b.term ||
        a.sort - b.sort,
    )
  const empty: SubjectProgress = { subject_id: '', year_id: '', department_id: '', stage: 1, shift: 'morning', term: 1, status: 'draft', n_students: 0, n_complete: 0, n_pass: 0, n_fail: 0, n_special: 0, avg_total: null, r2_status: 'draft', n_r2_needed: 0, n_r2_done: 0 }
  const prog = (id: string) => pmap.get(id) ?? empty

  const teacherRows = useMemoTeachers(list, prog)
  if (!canViewAll(s.profile) && !isHead) return <NotFoundPage />

  const exportExcel = async () => {
    try {
      const { exportTableXlsx } = await import('../lib/excel')
      if (view === 'subjects') {
        await exportTableXlsx({
          settings: s.settings,
          title: 'تقرير إنجاز إدخال الدرجات',
          subtitle: `العام الدراسي ${yearLabel(s.year?.label)}${dept ? ` — قسم ${s.deptById(dept)?.name}` : ''}`,
          sheet: 'تقرير الإنجاز',
          headers: ['القسم', 'المرحلة', 'الدراسة', 'الفصل', 'المادة', 'التدريسي', 'الطلبة', 'المكتمل', 'الناجحون', 'الراسبون', 'المعدل', 'الحالة'],
          widths: [22, 9, 9, 12, 32, 28, 9, 9, 9, 9, 9, 16],
          rows: list.map((x) => {
            const p = prog(x.id)
            return [s.deptById(x.department_id)?.name ?? '', stageShort(x.stage), SHIFT_LABEL[x.shift], TERM_LABEL[x.term], x.name, x.teacher_ids.map((id) => displayName(s.profileById(id))).join(' + '), p.n_students, p.n_complete, p.n_pass, p.n_fail, p.avg_total, STATUS_LABEL[x.status]]
          }),
          filename: `تقرير الإنجاز - ${yearLabel(s.year?.label)}.xlsx`,
        })
      } else {
        await exportTableXlsx({
          settings: s.settings,
          title: 'تقرير التدريسيين',
          subtitle: `العام الدراسي ${yearLabel(s.year?.label)}`,
          sheet: 'التدريسيون',
          headers: ['التدريسي', 'عدد المواد', 'نسبة الإكمال', 'مسودة', 'بانتظار التدقيق', 'معادة', 'معتمدة'],
          widths: [32, 12, 14, 10, 16, 10, 10],
          rows: teacherRows.map((t) => [t.name, t.subjects, fmtPct(t.ratio), t.draft, t.submitted, t.returned, t.approved]),
          filename: `تقرير التدريسيين - ${yearLabel(s.year?.label)}.xlsx`,
        })
      }
      void backend.logEvent('report.export', 'تصدير تقرير الإنجاز')
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="تقرير الإنجاز"
          subtitle="متابعة إدخال الدرجات وحالة القوائم لكل مادة وتدريسي"
          actions={
            <>
              <Button size="sm" icon={<Printer className="size-4" />} onClick={() => window.print()}>
                طباعة / PDF
              </Button>
              <Button size="sm" icon={<FileSpreadsheet className="size-4" />} onClick={() => void exportExcel()}>
                Excel
              </Button>
            </>
          }
        />
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'subjects', label: 'حسب المادة' },
                { value: 'teachers', label: 'حسب التدريسي' },
              ]}
            />
            {!isHead && (
              <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto">
                <option value="">كل الأقسام</option>
                {s.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
            <Select value={term} onChange={(e) => setTerm(Number(e.target.value))} className="w-auto">
              <option value={0}>كلا الفصلين</option>
              <option value={1}>{TERM_LABEL[1]}</option>
              <option value={2}>{TERM_LABEL[2]}</option>
            </Select>
          </div>
          {subjectsQ.isLoading || progressQ.isLoading ? (
            <LoadingBlock />
          ) : view === 'subjects' ? (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>القسم</th>
                    <th>المرحلة</th>
                    <th>الفصل</th>
                    <th>المادة</th>
                    <th>التدريسي</th>
                    <th className="min-w-36">الإنجاز</th>
                    <th className="text-center">النجاح</th>
                    <th className="text-center">المعدل</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((x) => {
                    const p = prog(x.id)
                    const ratio = p.n_students ? p.n_complete / p.n_students : 0
                    const graded = p.n_pass + p.n_fail
                    return (
                      <tr key={x.id}>
                        <td className="text-sm">{s.deptById(x.department_id)?.name}</td>
                        <td className="text-sm whitespace-nowrap">
                          {stageShort(x.stage)} — {SHIFT_LABEL[x.shift]}
                        </td>
                        <td className="text-sm whitespace-nowrap">{TERM_LABEL[x.term]}</td>
                        <td>
                          <Link to={`/subjects/${x.id}`} className="font-medium text-primary-text hover:underline">
                            {x.name}
                          </Link>
                        </td>
                        <td className="text-sm">{x.teacher_ids.map((id) => displayName(s.profileById(id))).join(' + ') || <span className="text-warning">غير محدد</span>}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <ProgressBar value={ratio} tone={ratio >= 1 ? 'success' : 'primary'} />
                            <span className="text-xs tabular-nums text-muted">
                              {p.n_complete}/{p.n_students}
                            </span>
                          </div>
                        </td>
                        <td className="text-center text-sm tabular-nums">{graded ? fmtPct(p.n_pass / graded) : '—'}</td>
                        <td className="text-center text-sm tabular-nums">{fmtNum(p.avg_total) || '—'}</td>
                        <td>
                          <StatusBadge status={x.status} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <TeacherTable rows={teacherRows} />
          )}
        </Card>
      </div>

      <div className="print-only print-landscape">
        <PrintHeader title={view === 'subjects' ? 'تقرير إنجاز إدخال الدرجات' : 'تقرير التدريسيين'} extra={dept ? `قسم ${s.deptById(dept)?.name}` : 'جميع الأقسام'} />
        {view === 'subjects' ? (
          <table className="print-table">
            <thead>
              <tr>
                <th>القسم</th>
                <th>المرحلة</th>
                <th>الفصل</th>
                <th>المادة</th>
                <th>التدريسي</th>
                <th>المكتمل</th>
                <th>النجاح</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => {
                const p = prog(x.id)
                const graded = p.n_pass + p.n_fail
                return (
                  <tr key={x.id}>
                    <td>{s.deptById(x.department_id)?.name}</td>
                    <td>
                      {stageShort(x.stage)} — {SHIFT_LABEL[x.shift]}
                    </td>
                    <td>{TERM_LABEL[x.term]}</td>
                    <td className="name">{x.name}</td>
                    <td>{x.teacher_ids.map((id) => displayName(s.profileById(id))).join(' + ')}</td>
                    <td>
                      {p.n_complete}/{p.n_students}
                    </td>
                    <td>{graded ? fmtPct(p.n_pass / graded) : '—'}</td>
                    <td>{STATUS_LABEL[x.status]}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <TeacherTable rows={teacherRows} print />
        )}
        <PrintSignatures labels={['رئيس اللجنة الامتحانية', 'معاون العميد', 'العميد']} />
      </div>
    </div>
  )
}

interface TeacherRow {
  id: string
  name: string
  subjects: number
  ratio: number
  draft: number
  submitted: number
  returned: number
  approved: number
}

function useMemoTeachers(list: { id: string; teacher_ids: string[]; status: string }[], prog: (id: string) => SubjectProgress): TeacherRow[] {
  const s = useSession()
  const map = new Map<string, TeacherRow & { cells: number; done: number }>()
  for (const x of list) {
    const ids = x.teacher_ids.length ? x.teacher_ids : ['—']
    for (const id of ids) {
      const row = map.get(id) ?? { id, name: id === '—' ? 'غير محدد' : displayName(s.profileById(id)) || '—', subjects: 0, ratio: 0, draft: 0, submitted: 0, returned: 0, approved: 0, cells: 0, done: 0 }
      const p = prog(x.id)
      row.subjects++
      row.cells += p.n_students
      row.done += p.n_complete
      row[x.status as 'draft' | 'submitted' | 'returned' | 'approved']++
      map.set(id, row)
    }
  }
  return [...map.values()].map((r) => ({ ...r, ratio: r.cells ? r.done / r.cells : 0 })).sort((a, b) => a.ratio - b.ratio)
}

function TeacherTable({ rows, print }: { rows: TeacherRow[]; print?: boolean }) {
  return (
    <div className={print ? '' : 'overflow-x-auto'}>
      <table className={print ? 'print-table' : 'table-base'}>
        <thead>
          <tr>
            <th>التدريسي</th>
            <th>المواد</th>
            <th className={print ? '' : 'min-w-36'}>نسبة الإكمال</th>
            <th>مسودة</th>
            <th>بانتظار التدقيق</th>
            <th>معادة</th>
            <th>معتمدة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={print ? 'name' : 'font-medium'}>{r.name}</td>
              <td className="text-center tabular-nums">{r.subjects}</td>
              <td>
                {print ? (
                  fmtPct(r.ratio)
                ) : (
                  <div className="flex items-center gap-2">
                    <ProgressBar value={r.ratio} tone={r.ratio >= 1 ? 'success' : 'primary'} />
                    <span className="w-12 text-xs tabular-nums">{fmtPct(r.ratio)}</span>
                  </div>
                )}
              </td>
              <td className="text-center tabular-nums">{r.draft}</td>
              <td className="text-center tabular-nums">{r.submitted}</td>
              <td className="text-center tabular-nums">{r.returned}</td>
              <td className="text-center tabular-nums">{r.approved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
