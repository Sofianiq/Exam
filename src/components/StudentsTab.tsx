import { ArrowDown, ArrowUp, ClipboardPaste, Pencil, Printer, Trash2, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useInvalidate, useStudents } from '../app/queries'
import { useSession } from '../app/session'
import { backend } from '../data'
import { STUDENT_STATUS_LABEL } from '../lib/labels'
import { parseNameList, splitDuplicates } from '../lib/parse'
import { canManageDepartment } from '../lib/perm'
import type { ClassKey, Student, StudentStatus } from '../lib/types'
import { useConfirm, useToast } from './feedback'
import { PrintHeader, PrintSignatures } from './PrintParts'
import { Badge, Button, Callout, Card, EmptyState, Field, IconButton, Input, LoadingBlock, Modal, Select, Textarea, cx } from './ui'

export function StudentsTab({ classKey }: { classKey: ClassKey }) {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const invalidate = useInvalidate()
  const q = useStudents(classKey)
  const list = q.data ?? []
  const manage = canManageDepartment(s.profile, classKey.department_id)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [edit, setEdit] = useState<Student | null>(null)
  const [busyMove, setBusyMove] = useState(false)
  const active = list.filter((x) => x.status === 'active').length

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= list.length) return
    const ids = list.map((x) => x.id)
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    setBusyMove(true)
    try {
      await backend.reorderStudents(ids)
      await invalidate('students', 'grades')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusyMove(false)
    }
  }

  const remove = async (st: Student) => {
    const ok = await confirm({
      title: 'حذف طالب',
      message: (
        <>
          هل تريد حذف الطالب <b>{st.full_name}</b> من القائمة؟ إذا كانت لديه درجات مسجلة فالأفضل تغيير حالته إلى «منسحب».
        </>
      ),
      confirmText: 'حذف',
      danger: true,
    })
    if (!ok) return
    try {
      await backend.deleteStudent(st.id)
      toast.success('تم حذف الطالب')
      void invalidate('students', 'progress', 'grades')
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <>
      <Card className="no-print">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            <h3 className="font-semibold">قائمة الطلبة</h3>
            <p className="text-xs text-muted">
              {list.length} طالب — {active} مستمر. التسلسل ثابت كما أُدخل ولا يتغير تلقائياً.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {list.length > 0 && (
              <Button size="sm" icon={<Printer className="size-4" />} onClick={() => window.print()}>
                طباعة القائمة
              </Button>
            )}
            {manage && (
              <Button size="sm" variant="primary" icon={<ClipboardPaste className="size-4" />} onClick={() => setPasteOpen(true)}>
                إضافة طلبة (نسخ ولصق)
              </Button>
            )}
          </div>
        </div>
        {q.isLoading ? (
          <LoadingBlock />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title="لا يوجد طلبة في هذا الصف"
            action={
              manage && (
                <Button variant="primary" icon={<ClipboardPaste className="size-4" />} onClick={() => setPasteOpen(true)}>
                  لصق أسماء الطلبة
                </Button>
              )
            }
          >
            انسخ عمود الأسماء من ملف Excel أو Google Sheets أو Word والصقه دفعة واحدة. يُحفظ الترتيب كما هو.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-12 text-center">ت</th>
                  <th>اسم الطالب</th>
                  <th>الحالة</th>
                  <th>ملاحظات</th>
                  {manage && <th className="w-40" />}
                </tr>
              </thead>
              <tbody>
                {list.map((st, i) => (
                  <tr key={st.id} className={cx(st.status !== 'active' && 'opacity-60')}>
                    <td className="text-center tabular-nums text-muted">{i + 1}</td>
                    <td className="font-medium">{st.full_name}</td>
                    <td>
                      <Badge tone={st.status === 'active' ? 'success' : st.status === 'withdrawn' ? 'danger' : 'warning'}>{STUDENT_STATUS_LABEL[st.status]}</Badge>
                    </td>
                    <td className="text-sm text-muted">{st.notes}</td>
                    {manage && (
                      <td>
                        <div className="flex justify-end">
                          <IconButton label="نقل للأعلى" disabled={busyMove || i === 0} onClick={() => void move(i, -1)}>
                            <ArrowUp className="size-4" />
                          </IconButton>
                          <IconButton label="نقل للأسفل" disabled={busyMove || i === list.length - 1} onClick={() => void move(i, 1)}>
                            <ArrowDown className="size-4" />
                          </IconButton>
                          <IconButton label="تعديل" onClick={() => setEdit(st)}>
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton label="حذف" className="hover:text-danger" onClick={() => void remove(st)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* نسخة الطباعة */}
      <div className="print-only">
        <PrintHeader classKey={classKey} title="قائمة أسماء الطلبة" />
        <table className="print-table">
          <thead>
            <tr>
              <th style={{ width: '8%' }}>ت</th>
              <th>اسم الطالب</th>
              <th style={{ width: '15%' }}>الحالة</th>
              <th style={{ width: '25%' }}>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {list.map((st, i) => (
              <tr key={st.id}>
                <td>{i + 1}</td>
                <td className="name">{st.full_name}</td>
                <td>{STUDENT_STATUS_LABEL[st.status]}</td>
                <td>{st.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <PrintSignatures labels={['مقرر القسم', 'رئيس القسم']} />
      </div>

      <PasteStudentsDialog open={pasteOpen} onClose={() => setPasteOpen(false)} classKey={classKey} existing={list.map((x) => x.full_name)} />
      <EditStudentDialog student={edit} onClose={() => setEdit(null)} />
    </>
  )
}

function PasteStudentsDialog({ open, onClose, classKey, existing }: { open: boolean; onClose: () => void; classKey: ClassKey; existing: string[] }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const parsed = useMemo(() => splitDuplicates(parseNameList(text), existing), [text, existing])

  const save = async () => {
    if (parsed.fresh.length === 0) return
    setBusy(true)
    try {
      const r = await backend.addStudents(classKey, parsed.fresh)
      toast.success(`تمت إضافة ${r.added} طالب${r.skipped.length ? ` (تم تجاهل ${r.skipped.length} مكرر)` : ''}`)
      setText('')
      void invalidate('students', 'progress')
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
      size="xl"
      title="إضافة طلبة بالنسخ واللصق"
      footer={
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={busy} disabled={parsed.fresh.length === 0} onClick={save}>
            إضافة {parsed.fresh.length || ''} طالب
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Field label="الصق أسماء الطلبة هنا (اسم في كل سطر)" hint="يمكن لصق عمود الأسماء مباشرة من Excel أو Google Sheets، أو عمودين (التسلسل + الاسم). تُحذف الأرقام والفراغات الزائدة تلقائياً.">
            <Textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-80 font-medium"
              placeholder={'احمد علي حسين كاظم\nزينب محمد جاسم عبد الله\n…'}
            />
          </Field>
        </div>
        <div>
          <div className="label">المعاينة — سيُضاف الطلبة بهذا الترتيب بعد آخر طالب ({existing.length})</div>
          <div className="h-80 overflow-y-auto rounded-lg border border-line bg-surface-2/50">
            {parsed.fresh.length === 0 && parsed.dup.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">ستظهر الأسماء هنا بعد اللصق</p>
            ) : (
              <ol className="divide-y divide-line text-sm">
                {parsed.fresh.map((n, i) => (
                  <li key={`f${i}`} className="flex gap-3 px-3 py-1.5">
                    <span className="w-8 text-end tabular-nums text-muted">{existing.length + i + 1}</span>
                    <span>{n}</span>
                  </li>
                ))}
                {parsed.dup.map((n, i) => (
                  <li key={`d${i}`} className="flex gap-3 bg-warning-soft px-3 py-1.5 text-warning">
                    <span className="w-8 text-end">—</span>
                    <span className="flex-1">{n}</span>
                    <span className="text-xs">مكرر — سيتم تجاهله</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {parsed.dup.length > 0 && (
            <Callout tone="warning" className="mt-3">
              {parsed.dup.length} اسم مكرر (موجود في القائمة أو مكتوب مرتين) ولن يُضاف.
            </Callout>
          )}
        </div>
      </div>
    </Modal>
  )
}

function EditStudentDialog({ student, onClose }: { student: Student | null; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const [name, setName] = useState('')
  const [status, setStatus] = useState<StudentStatus>('active')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  if (student && loadedFor !== student.id) {
    setLoadedFor(student.id)
    setName(student.full_name)
    setStatus(student.status)
    setNotes(student.notes ?? '')
  }
  if (!student && loadedFor) setLoadedFor(null)

  const save = async () => {
    if (!student) return
    setBusy(true)
    try {
      await backend.updateStudent(student.id, { full_name: name, status, notes: notes.trim() || null })
      toast.success('تم حفظ بيانات الطالب')
      void invalidate('students', 'progress')
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!student}
      onClose={onClose}
      size="sm"
      title="تعديل بيانات الطالب"
      footer={
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            حفظ
          </Button>
        </>
      }
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Field label="الاسم الرباعي">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="الحالة" hint="الطالب المنسحب أو المؤجل لا يُحتسب في نسب الإنجاز والنجاح">
          <Select value={status} onChange={(e) => setStatus(e.target.value as StudentStatus)}>
            {Object.entries(STUDENT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ملاحظات">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
