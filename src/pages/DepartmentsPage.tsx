import { ArrowLeft, BookMarked, Building2, ChevronLeft, GraduationCap, Lock, Moon, Sun } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { completionOf, studentCount, useProgress } from '../app/queries'
import { useSession } from '../app/session'
import { Badge, Button, LoadingBlock, PageHeader, ProgressBar, cx } from '../components/ui'
import { yearLabel } from '../lib/format'
import { SHIFT_LABEL, stageLabel } from '../lib/labels'
import { canSeeDepartment, entryOpenFor } from '../lib/perm'
import type { Shift } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

export function DepartmentsPage() {
  const s = useSession()
  const progressQ = useProgress(s.yearId)
  const rows = progressQ.data ?? []
  const visible = s.departments.filter((d) => canSeeDepartment(s.profile, d.id))
  return (
    <div>
      <PageHeader title="الأقسام العلمية" subtitle={`${s.settings.college_name} — السنة الدراسية ${yearLabel(s.year?.label)}`} />
      {progressQ.isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((d) => {
            const dr = rows.filter((r) => r.department_id === d.id)
            const c = completionOf(dr)
            return (
              <Link key={d.id} to={`/departments/${d.id}`} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-pop">
                <div className="flex items-start gap-3">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-text">
                    <Building2 className="size-5.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold leading-snug">قسم {d.name}</h3>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge tone="gold" icon={<Sun className="size-3" />}>
                        صباحي
                      </Badge>
                      {d.has_evening && (
                        <Badge tone="info" icon={<Moon className="size-3" />}>
                          مسائي
                        </Badge>
                      )}
                      {!entryOpenFor(s.settings, d) && (
                        <Badge tone="danger" icon={<Lock className="size-3" />}>
                          الإدخال مغلق
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                  <Metric label="المواد" value={dr.length} />
                  <Metric label="الطلبة" value={studentCount(dr)} />
                  <Metric label="معتمدة" value={dr.filter((r) => r.status === 'approved').length} />
                </div>
                <div className="mt-4">
                  <div className="mb-1.5 flex justify-between text-xs text-muted">
                    <span>إنجاز إدخال الدرجات</span>
                    <span className="tabular-nums">{Math.round(c.ratio * 100)}%</span>
                  </div>
                  <ProgressBar value={c.ratio} tone={c.ratio >= 1 ? 'success' : 'primary'} />
                </div>
                <div className="mt-4 flex items-center justify-end gap-1 text-sm font-medium text-primary-text">
                  عرض المراحل <ArrowLeft className="size-4 transition-all group-hover:-translate-x-1" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-2 py-2">
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className="text-[0.7rem] text-muted">{label}</div>
    </div>
  )
}

export function DepartmentPage() {
  const { deptId } = useParams()
  const s = useSession()
  const dept = s.deptById(deptId)
  const progressQ = useProgress(s.yearId)
  if (!dept || !canSeeDepartment(s.profile, dept.id)) return <NotFoundPage />
  const rows = (progressQ.data ?? []).filter((r) => r.department_id === dept.id)
  const shifts: Shift[] = dept.has_evening ? ['morning', 'evening'] : ['morning']
  const stages = Array.from({ length: dept.stages }, (_, i) => i + 1)

  return (
    <div>
      <PageHeader
        crumbs={
          <>
            <Link to="/departments" className="hover:text-ink">
              الأقسام
            </Link>
            <ChevronLeft className="size-3" />
            <span>{dept.name}</span>
          </>
        }
        title={`قسم ${dept.name}`}
        subtitle={`اختر المرحلة ونوع الدراسة لإدارة المواد والطلبة والدرجات — ${yearLabel(s.year?.label)}`}
        actions={
          <>
            {!entryOpenFor(s.settings, dept) && <Badge tone="danger" icon={<Lock className="size-3.5" />}>إدخال الدرجات مغلق لهذا القسم</Badge>}
            <Link to={`/departments/${dept.id}/plan`}>
              <Button icon={<BookMarked className="size-4" />}>الخطة الدراسية</Button>
            </Link>
          </>
        }
      />
      {progressQ.isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-6">
          {stages.map((stage) => (
            <section key={stage}>
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <span className="flex size-7 items-center justify-center rounded-lg bg-gold-soft text-sm font-bold text-gold-text">{stage}</span>
                {stageLabel(stage)}
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {shifts.map((shift) => {
                  const cr = rows.filter((r) => r.stage === stage && r.shift === shift)
                  const c = completionOf(cr)
                  const t1 = cr.filter((r) => r.term === 1).length
                  const t2 = cr.filter((r) => r.term === 2).length
                  const students = studentCount(cr)
                  return (
                    <Link
                      key={shift}
                      to={`/class/${dept.id}/${stage}/${shift}`}
                      className={cx('card group p-4 transition hover:border-primary/50 hover:shadow-pop', cr.length === 0 && 'border-dashed')}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 font-semibold">
                          {shift === 'morning' ? <Sun className="size-4.5 text-gold" /> : <Moon className="size-4.5 text-info" />}
                          الدراسة {SHIFT_LABEL[shift] === 'صباحي' ? 'الصباحية' : 'المسائية'}
                        </div>
                        <span className="flex items-center gap-1 text-xs text-muted">
                          <GraduationCap className="size-4" /> {students || '—'} طالب
                        </span>
                      </div>
                      {cr.length === 0 ? (
                        <p className="mt-3 text-sm text-muted">لم تُضف مواد بعد — اضغط لإضافة المواد والطلبة</p>
                      ) : (
                        <>
                          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                            <Badge>الفصل الأول: {t1} مادة</Badge>
                            <Badge>الفصل الثاني: {t2} مادة</Badge>
                            {cr.some((r) => r.status === 'submitted') && <Badge tone="info">{cr.filter((r) => r.status === 'submitted').length} بانتظار التدقيق</Badge>}
                            {cr.some((r) => r.status === 'returned') && <Badge tone="warning">{cr.filter((r) => r.status === 'returned').length} معادة</Badge>}
                            <Badge tone="success">{cr.filter((r) => r.status === 'approved').length} معتمدة</Badge>
                          </div>
                          <div className="mt-3 flex items-center gap-3">
                            <ProgressBar value={c.ratio} tone={c.ratio >= 1 ? 'success' : 'primary'} />
                            <span className="w-10 text-end text-xs tabular-nums">{Math.round(c.ratio * 100)}%</span>
                          </div>
                        </>
                      )}
                    </Link>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
