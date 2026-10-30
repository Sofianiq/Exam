import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, BookOpen, CheckCircle2, ClipboardCheck, GraduationCap, History, Hourglass, Layers, Lock, LockOpen, Undo2 } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { completionOf, studentCount, useProgress, useSubjects } from '../app/queries'
import { useSession } from '../app/session'
import { SubjectCard } from '../components/SubjectCard'
import { Badge, Button, Card, CardHeader, EmptyState, LoadingBlock, PageHeader, ProgressBar, StatCard, cx } from '../components/ui'
import { backend } from '../data'
import { displayName, fmtDateTime, fmtPct, yearLabel } from '../lib/format'
import { ACTION_LABEL, ROLE_LABEL } from '../lib/labels'
import { canSeeAudit, canToggleEntry, canViewAll, entryOpenFor } from '../lib/perm'
import type { SubjectProgress } from '../lib/types'

export function DashboardPage() {
  const s = useSession()
  if (s.profile.role === 'teacher') return <TeacherDashboard />
  return <OverviewDashboard />
}

function Greeting() {
  const s = useSession()
  const h = new Date().getHours()
  const hello = h < 12 ? 'صباح الخير' : 'مساء الخير'
  return (
    <PageHeader
      title={`${hello}، ${displayName(s.profile)}`}
      subtitle={`${ROLE_LABEL[s.profile.role]} — السنة الدراسية ${yearLabel(s.year?.label)}`}
    />
  )
}

function TeacherDashboard() {
  const s = useSession()
  const subjectsQ = useSubjects({ year_id: s.yearId, teacher_id: s.profile.id })
  const progressQ = useProgress(s.yearId)
  const pmap = useMemo(() => new Map(progressQ.data?.map((p) => [p.subject_id, p])), [progressQ.data])
  const subjects = subjectsQ.data ?? []
  const count = (st: string) => subjects.filter((x) => x.status === st).length
  const returned = subjects.filter((x) => x.status === 'returned')

  return (
    <div>
      <Greeting />
      <EntryNotice />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="موادي هذه السنة" value={subjects.length} icon={<BookOpen className="size-5" />} />
        <StatCard label="قيد الإدخال" value={count('draft')} icon={<Hourglass className="size-5" />} tone="neutral" />
        <StatCard label="بانتظار التدقيق" value={count('submitted')} icon={<ClipboardCheck className="size-5" />} tone="info" />
        <StatCard label="معتمدة" value={count('approved')} icon={<CheckCircle2 className="size-5" />} tone="success" />
      </div>
      {returned.length > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
          <Undo2 className="mt-0.5 size-5 shrink-0" />
          <div>
            <b>لديك {returned.length} قائمة معادة للتعديل من اللجنة الامتحانية.</b> راجع الملاحظات المرفقة ثم أعد الإرسال.
          </div>
        </div>
      )}
      <h2 className="mb-3 font-semibold">موادي الدراسية</h2>
      {subjectsQ.isLoading ? (
        <LoadingBlock />
      ) : subjects.length === 0 ? (
        <Card>
          <EmptyState icon={<BookOpen className="size-6" />} title="لا توجد مواد مسندة إليك في هذه السنة">
            يقوم مقرر القسم بإسناد المواد إلى التدريسيين. تأكد من اختيار السنة الدراسية الصحيحة من الأعلى.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((x) => (
            <SubjectCard key={x.id} subject={x} progress={pmap.get(x.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function EntryNotice() {
  const s = useSession()
  const dept = s.deptById(s.profile.department_id)
  if (entryOpenFor(s.settings, dept)) return null
  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      <Lock className="size-5 shrink-0" />
      <span>
        <b>إدخال الدرجات مغلق حالياً</b> بقرار من إدارة الكلية. يمكنك الاطلاع على القوائم دون تعديلها.
      </span>
    </div>
  )
}

function OverviewDashboard() {
  const s = useSession()
  const progressQ = useProgress(s.yearId)
  const all = progressQ.data ?? []
  const scopeDept = s.profile.role === 'head' ? s.profile.department_id : null
  const rows = scopeDept ? all.filter((r) => r.department_id === scopeDept) : all
  const comp = completionOf(rows)
  const by = (st: string) => rows.filter((r) => r.status === st).length
  const depts = scopeDept ? s.departments.filter((d) => d.id === scopeDept) : s.departments

  return (
    <div>
      <Greeting />
      {s.profile.role === 'head' && <EntryNotice />}
      {progressQ.isLoading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label={scopeDept ? 'المراحل والدراسات' : 'الأقسام العلمية'} value={scopeDept ? new Set(rows.map((r) => `${r.stage}${r.shift}`)).size : s.departments.length} icon={<Layers className="size-5" />} />
            <StatCard label="المواد الدراسية" value={rows.length} icon={<BookOpen className="size-5" />} />
            <StatCard label="الطلبة" value={studentCount(rows)} icon={<GraduationCap className="size-5" />} tone="gold" />
            <StatCard label="نسبة إنجاز الإدخال" value={fmtPct(comp.ratio)} icon={<Hourglass className="size-5" />} tone="info" />
            <StatCard label="بانتظار التدقيق" value={by('submitted')} icon={<ClipboardCheck className="size-5" />} tone="warning" />
            <StatCard label="قوائم معتمدة" value={by('approved')} hint={`من أصل ${rows.length}`} icon={<CheckCircle2 className="size-5" />} tone="success" />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader
                title="متابعة الإنجاز حسب القسم"
                subtitle="نسبة اكتمال إدخال الدرجات وحالة القوائم"
                actions={
                  <Link to="/progress">
                    <Button size="sm" variant="ghost">
                      التقرير المفصل
                    </Button>
                  </Link>
                }
              />
              <div className="divide-y divide-line">
                {depts.map((d) => {
                  const dr = rows.filter((r) => r.department_id === d.id)
                  const c = completionOf(dr)
                  const n = (st: string) => dr.filter((r) => r.status === st).length
                  return (
                    <Link key={d.id} to={`/departments/${d.id}`} className="block px-5 py-3.5 transition hover:bg-surface-2/60">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{d.name}</span>
                          {!d.entry_open && <Badge tone="danger" icon={<Lock className="size-3" />}>مغلق</Badge>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <Badge>{dr.length} مادة</Badge>
                          {n('submitted') > 0 && <Badge tone="info">{n('submitted')} بانتظار التدقيق</Badge>}
                          {n('returned') > 0 && <Badge tone="warning">{n('returned')} معادة</Badge>}
                          <Badge tone="success">{n('approved')} معتمدة</Badge>
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center gap-3">
                        <ProgressBar value={c.ratio} tone={c.ratio >= 1 ? 'success' : 'primary'} />
                        <span className="w-12 text-end text-xs font-semibold tabular-nums">{Math.round(c.ratio * 100)}%</span>
                      </div>
                    </Link>
                  )
                })}
                {depts.length === 0 && <EmptyState title="لا توجد أقسام" />}
              </div>
            </Card>

            <div className="space-y-6">
              {canToggleEntry(s.profile) && <EntryCard />}
              <AttentionCard rows={rows} />
              {canSeeAudit(s.profile) && <RecentActivity departmentId={scopeDept} />}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function EntryCard() {
  const s = useSession()
  const open = s.settings.entry_open
  const closedDepts = s.departments.filter((d) => !d.entry_open)
  return (
    <Card className={cx('overflow-hidden', open ? '' : 'border-danger/40')}>
      <div className={cx('flex items-center gap-3 px-5 py-4', open ? 'bg-success-soft' : 'bg-danger-soft')}>
        {open ? <LockOpen className="size-6 text-success" /> : <Lock className="size-6 text-danger" />}
        <div className="flex-1">
          <div className={cx('font-semibold', open ? 'text-success' : 'text-danger')}>{open ? 'إدخال الدرجات مفتوح' : 'إدخال الدرجات مغلق'}</div>
          <div className="text-xs text-muted">
            {open
              ? closedDepts.length
                ? `مغلق لـ ${closedDepts.length} ${closedDepts.length === 1 ? 'قسم' : 'أقسام'}`
                : 'لجميع الأقسام'
              : 'لا يستطيع التدريسيون ومقررو الأقسام التعديل'}
          </div>
        </div>
        <Link to="/control">
          <Button size="sm" variant={open ? 'secondary' : 'primary'}>
            إدارة
          </Button>
        </Link>
      </div>
    </Card>
  )
}

function AttentionCard({ rows }: { rows: SubjectProgress[] }) {
  const s = useSession()
  const subjectsQ = useSubjects({ year_id: s.yearId }, canViewAll(s.profile) || s.profile.role === 'head')
  const names = new Map(subjectsQ.data?.map((x) => [x.id, x]))
  const returned = rows.filter((r) => r.status === 'returned')
  const submitted = rows.filter((r) => r.status === 'submitted')
  const notStarted = rows.filter((r) => r.n_students > 0 && r.n_complete === 0 && r.status === 'draft')
  const items = [
    ...submitted.map((r) => ({ r, tone: 'info' as const, text: 'بانتظار التدقيق' })),
    ...returned.map((r) => ({ r, tone: 'warning' as const, text: 'معادة للتعديل' })),
  ].slice(0, 6)
  return (
    <Card>
      <CardHeader title="يتطلب انتباهك" icon={<AlertTriangle className="size-4.5" />} subtitle={`${notStarted.length} مادة لم يبدأ إدخال درجاتها بعد`} />
      {items.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-muted">لا توجد قوائم بانتظار إجراء 👌</div>
      ) : (
        <ul className="divide-y divide-line">
          {items.map(({ r, tone, text }) => {
            const sub = names.get(r.subject_id)
            return (
              <li key={r.subject_id}>
                <Link to={`/subjects/${r.subject_id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-surface-2/60">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{sub?.name ?? '…'}</span>
                    <span className="block truncate text-xs text-muted">{s.deptById(r.department_id)?.name}</span>
                  </span>
                  <Badge tone={tone}>{text}</Badge>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function RecentActivity({ departmentId }: { departmentId: string | null }) {
  const q = useQuery({
    queryKey: ['audit', 'recent', departmentId],
    queryFn: () => backend.listAudit({ limit: 8, department_id: departmentId, action_prefix: null }),
  })
  return (
    <Card>
      <CardHeader
        title="آخر العمليات"
        icon={<History className="size-4.5" />}
        actions={
          <Link to="/audit">
            <Button size="sm" variant="ghost">
              السجل الكامل
            </Button>
          </Link>
        }
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : (
        <ul className="divide-y divide-line">
          {(q.data ?? []).map((a) => (
            <li key={a.id} className="px-5 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span>
                <span className="text-xs tabular-nums text-faint">{fmtDateTime(a.at)}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted">
                {a.user_name} — {a.summary}
              </div>
            </li>
          ))}
          {q.data?.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">لا توجد عمليات بعد</li>}
        </ul>
      )}
    </Card>
  )
}
