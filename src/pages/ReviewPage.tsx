import { CheckCircle2, ClipboardCheck, Eye } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInvalidate, useProgress, useSubjects } from '../app/queries'
import { useSession } from '../app/session'
import { useConfirm, useToast } from '../components/feedback'
import { Button, Card, EmptyState, LoadingBlock, PageHeader, ProgressBar, Segmented, Select, StatusBadge } from '../components/ui'
import { backend } from '../data'
import { displayName, fmtDateTime } from '../lib/format'
import { SHIFT_LABEL, STATUS_LABEL, TERM_LABEL, stageShort } from '../lib/labels'
import { canReview } from '../lib/perm'
import type { Round, SubjectStatus } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

export function ReviewPage() {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const invalidate = useInvalidate()
  const [status, setStatus] = useState<SubjectStatus | 'all'>('submitted')
  const [dept, setDept] = useState('')
  const [term, setTerm] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [round, setRound] = useState<Round>(1)
  const subjectsQ = useSubjects({ year_id: s.yearId })
  const progressQ = useProgress(s.yearId)
  const pmap = useMemo(() => new Map(progressQ.data?.map((p) => [p.subject_id, p])), [progressQ.data])
  if (!canReview(s.profile)) return <NotFoundPage />

  // في الدور الثاني: المواد المعتمدة في الدور الأول والتي فيها طلبة مكملون فقط
  const all = (subjectsQ.data ?? []).filter((x) => round === 1 || (x.status === 'approved' && (pmap.get(x.id)?.n_r2_needed ?? 0) > 0))
  const st = (x: (typeof all)[number]) => (round === 1 ? x.status : x.r2_status)
  const count = (v: SubjectStatus) => all.filter((x) => st(x) === v && (!dept || x.department_id === dept)).length
  const list = all
    .filter((x) => (status === 'all' || st(x) === status) && (!dept || x.department_id === dept) && (!term || x.term === term))
    .sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''))

  const approve = async (id: string, name: string, incomplete: number) => {
    const ok = await confirm({
      title: 'اعتماد القائمة',
      message: incomplete > 0 ? <span className="text-warning">تنبيه: يوجد {incomplete} طالب بدرجات ناقصة في «{name}». هل تريد الاعتماد؟</span> : <>اعتماد قائمة درجات «{name}»؟</>,
      confirmText: 'اعتماد',
    })
    if (!ok) return
    setBusy(id)
    try {
      await backend.setSubjectStatus(id, 'approved', null, round)
      toast.success('تم اعتماد القائمة')
      void invalidate()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <PageHeader title="التدقيق والاعتماد" subtitle="القوائم المرسلة من التدريسيين بانتظار تدقيق اللجنة الامتحانية" />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
          <Segmented<Round>
            value={round}
            onChange={setRound}
            options={[
              { value: 1, label: 'الدور الأول' },
              { value: 2, label: 'الدور الثاني' },
            ]}
          />
          <Segmented<SubjectStatus | 'all'>
            value={status}
            onChange={setStatus}
            options={[
              { value: 'submitted', label: `${STATUS_LABEL.submitted} (${count('submitted')})` },
              { value: 'returned', label: `معادة (${count('returned')})` },
              { value: 'approved', label: `معتمدة (${count('approved')})` },
              { value: 'draft', label: `مسودات (${count('draft')})` },
              { value: 'all', label: 'الكل' },
            ]}
          />
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto">
            <option value="">كل الأقسام</option>
            {s.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select value={term} onChange={(e) => setTerm(Number(e.target.value))} className="w-auto">
            <option value={0}>كلا الفصلين</option>
            <option value={1}>{TERM_LABEL[1]}</option>
            <option value={2}>{TERM_LABEL[2]}</option>
          </Select>
        </div>
        {subjectsQ.isLoading ? (
          <LoadingBlock />
        ) : list.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="size-6" />} title="لا توجد قوائم في هذا التصنيف" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>المادة</th>
                  <th>القسم</th>
                  <th>المرحلة / الدراسة / الفصل</th>
                  <th>التدريسي</th>
                  <th>تاريخ الإرسال</th>
                  <th className="min-w-32">الاكتمال</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((x) => {
                  const p = pmap.get(x.id)
                  const total = round === 1 ? (p?.n_students ?? 0) : (p?.n_r2_needed ?? 0)
                  const done = round === 1 ? (p?.n_complete ?? 0) : (p?.n_r2_done ?? 0)
                  const ratio = total ? done / total : 0
                  return (
                    <tr key={x.id}>
                      <td className="font-semibold">{x.name}</td>
                      <td className="text-sm">{s.deptById(x.department_id)?.name}</td>
                      <td className="text-sm whitespace-nowrap">
                        {stageShort(x.stage)} / {SHIFT_LABEL[x.shift]} / {TERM_LABEL[x.term]}
                      </td>
                      <td className="text-sm">{x.teacher_ids.map((id) => displayName(s.profileById(id))).join(' + ') || '—'}</td>
                      <td className="text-xs tabular-nums text-muted">{fmtDateTime(round === 1 ? x.submitted_at : x.r2_submitted_at)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <ProgressBar value={ratio} tone={ratio >= 1 ? 'success' : 'primary'} />
                          <span className="text-xs tabular-nums text-muted">
                            {done}/{total}
                          </span>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={st(x)} />
                      </td>
                      <td>
                        <div className="flex justify-end gap-2">
                          <Link to={`/subjects/${x.id}${round === 2 ? '?round=2' : ''}`}>
                            <Button size="sm" icon={<Eye className="size-4" />}>
                              تدقيق
                            </Button>
                          </Link>
                          {st(x) === 'submitted' && (
                            <Button size="sm" variant="success" icon={<CheckCircle2 className="size-4" />} loading={busy === x.id} onClick={() => void approve(x.id, x.name, total - done)}>
                              اعتماد
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
