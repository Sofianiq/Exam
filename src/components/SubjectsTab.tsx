import { BookOpen, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInvalidate, useProgress, useSubjects } from '../app/queries'
import { useSession } from '../app/session'
import { backend } from '../data'
import { displayName } from '../lib/format'
import { SHIFT_LABEL, TERM_LABEL, stageLabel } from '../lib/labels'
import { canManageDepartment } from '../lib/perm'
import type { ClassKey, Shift, Subject, Term } from '../lib/types'
import { useConfirm, useToast } from './feedback'
import { SubjectDialog } from './SubjectDialog'
import { Button, Card, Checkbox, EmptyState, Field, IconButton, LoadingBlock, Modal, ProgressBar, Select, StatusBadge } from './ui'

export function SubjectsTab({ classKey, term }: { classKey: ClassKey; term: Term }) {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const invalidate = useInvalidate()
  const subjectsQ = useSubjects({ ...classKey, term })
  const progressQ = useProgress(s.yearId)
  const pmap = useMemo(() => new Map(progressQ.data?.map((p) => [p.subject_id, p])), [progressQ.data])
  const [editing, setEditing] = useState<Subject | null>(null)
  const [dlg, setDlg] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const manage = canManageDepartment(s.profile, classKey.department_id)
  const list = subjectsQ.data ?? []

  const remove = async (x: Subject) => {
    const ok = await confirm({
      title: 'حذف المادة',
      message: (
        <>
          هل تريد حذف مادة <b>{x.name}</b>؟ لا يمكن حذف مادة تحتوي على درجات إلا من قبل الإدارة العليا.
        </>
      ),
      confirmText: 'حذف',
      danger: true,
    })
    if (!ok) return
    try {
      await backend.deleteSubject(x.id)
      toast.success('تم حذف المادة')
      void invalidate()
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h3 className="font-semibold">مواد {TERM_LABEL[term]}</h3>
          <p className="text-xs text-muted">اضغط على المادة لفتح قائمة الدرجات</p>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Copy className="size-4" />} onClick={() => setCopyOpen(true)}>
              نسخ مواد
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => {
                setEditing(null)
                setDlg(true)
              }}
            >
              إضافة مادة
            </Button>
          </div>
        )}
      </div>
      {subjectsQ.isLoading ? (
        <LoadingBlock />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="size-6" />}
          title={`لا توجد مواد في ${TERM_LABEL[term]}`}
          action={
            manage && (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDlg(true)}>
                إضافة أول مادة
              </Button>
            )
          }
        >
          {manage ? 'أضف المواد الدراسية وحدد التدريسي وتوزيع الدرجات لكل مادة، أو انسخها من الدراسة الأخرى أو من سنة سابقة.' : 'لم يضف مقرر القسم مواد لهذا الفصل بعد.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th className="w-10">ت</th>
                <th className="min-w-48">المادة</th>
                <th className="min-w-40">التدريسي</th>
                <th className="text-center">السعي</th>
                <th className="text-center">العملي</th>
                <th className="text-center">النهائي</th>
                <th className="min-w-36">الإنجاز</th>
                <th>الحالة</th>
                {manage && <th className="w-24" />}
              </tr>
            </thead>
            <tbody>
              {list.map((x, i) => {
                const p = pmap.get(x.id)
                const ratio = p && p.n_students ? p.n_complete / p.n_students : 0
                return (
                  <tr key={x.id}>
                    <td className="tabular-nums text-muted">{i + 1}</td>
                    <td>
                      <Link to={`/subjects/${x.id}`} className="font-semibold text-primary-text hover:underline">
                        {x.name}
                      </Link>
                      {x.units != null && <span className="ms-2 text-xs text-muted">({x.units} وحدات)</span>}
                    </td>
                    <td className="text-sm">
                      {x.teacher_ids.length ? x.teacher_ids.map((id) => displayName(s.profileById(id))).join(' + ') : <span className="text-warning">غير محدد</span>}
                    </td>
                    <td className="text-center tabular-nums">
                      {x.coursework_max}
                      {x.cw_practical_max > 0 && <span className="block text-[0.7rem] text-muted">({x.coursework_max - x.cw_practical_max}+{x.cw_practical_max})</span>}
                    </td>
                    <td className="text-center tabular-nums">{x.practical_max || '—'}</td>
                    <td className="text-center tabular-nums">{x.final_max}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <ProgressBar value={ratio} tone={ratio >= 1 ? 'success' : 'primary'} />
                        <span className="w-14 text-xs tabular-nums text-muted">
                          {p?.n_complete ?? 0}/{p?.n_students ?? 0}
                        </span>
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={x.status} />
                    </td>
                    {manage && (
                      <td>
                        <div className="flex justify-end">
                          <IconButton
                            label="تعديل"
                            onClick={() => {
                              setEditing(x)
                              setDlg(true)
                            }}
                          >
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton label="حذف" className="hover:text-danger" onClick={() => void remove(x)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <SubjectDialog
        open={dlg}
        onClose={() => setDlg(false)}
        classKey={classKey}
        term={term}
        subject={editing}
        nextSort={(list[list.length - 1]?.sort ?? 0) + 1}
        onSaved={() => void invalidate()}
      />
      <CopySubjectsDialog open={copyOpen} onClose={() => setCopyOpen(false)} target={{ ...classKey, term }} />
    </Card>
  )
}

function CopySubjectsDialog({ open, onClose, target }: { open: boolean; onClose: () => void; target: ClassKey & { term: Term } }) {
  const s = useSession()
  const toast = useToast()
  const invalidate = useInvalidate()
  const dept = s.deptById(target.department_id)
  const [yearId, setYearId] = useState(target.year_id)
  const [stage, setStage] = useState(target.stage)
  const [shift, setShift] = useState<Shift>(target.shift === 'morning' && dept?.has_evening ? 'evening' : 'morning')
  const [term, setTerm] = useState<Term>(target.term)
  const [withTeachers, setWithTeachers] = useState(true)
  const [busy, setBusy] = useState(false)
  const same = yearId === target.year_id && stage === target.stage && shift === target.shift && term === target.term

  const run = async () => {
    setBusy(true)
    try {
      const n = await backend.copySubjects({ year_id: yearId, department_id: target.department_id, stage, shift, term }, target, withTeachers)
      toast.success(n ? `تم نسخ ${n} مادة` : 'لا توجد مواد جديدة للنسخ (المواد موجودة مسبقاً أو المصدر فارغ)')
      void invalidate()
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="نسخ المواد من صف آخر"
      footer={
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={busy} disabled={same} onClick={run}>
            نسخ المواد
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          تُنسخ أسماء المواد وتوزيع درجاتها (دون الدرجات) إلى: <b className="text-ink">{stageLabel(target.stage)} — {SHIFT_LABEL[target.shift]} — {TERM_LABEL[target.term]}</b>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="من السنة الدراسية">
            <Select value={yearId} onChange={(e) => setYearId(e.target.value)}>
              {s.years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="المرحلة">
            <Select value={stage} onChange={(e) => setStage(Number(e.target.value))}>
              {Array.from({ length: dept?.stages ?? 4 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {stageLabel(i + 1)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الدراسة">
            <Select value={shift} onChange={(e) => setShift(e.target.value as Shift)}>
              <option value="morning">صباحي</option>
              {dept?.has_evening && <option value="evening">مسائي</option>}
            </Select>
          </Field>
          <Field label="الفصل">
            <Select value={term} onChange={(e) => setTerm(Number(e.target.value) as Term)}>
              <option value={1}>{TERM_LABEL[1]}</option>
              <option value={2}>{TERM_LABEL[2]}</option>
            </Select>
          </Field>
        </div>
        <Checkbox checked={withTeachers} onChange={setWithTeachers} label="نسخ التدريسيين المسندين أيضاً" />
        {same && <p className="text-xs text-danger">اختر صفاً مختلفاً عن الصف الحالي.</p>}
      </div>
    </Modal>
  )
}
