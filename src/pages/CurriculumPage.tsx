import { useQueryClient } from '@tanstack/react-query'
import { BookMarked, ChevronLeft, ClipboardPaste, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useCurriculum } from '../app/queries'
import { useSession } from '../app/session'
import { useConfirm, useToast } from '../components/feedback'
import { Button, Callout, Card, EmptyState, Field, IconButton, Input, LoadingBlock, Modal, PageHeader, Segmented, Textarea } from '../components/ui'
import { backend } from '../data'
import { stageLabel, TERM_LABEL } from '../lib/labels'
import { schemeForPlan } from '../lib/calc'
import { parsePlanRows } from '../lib/parse'
import { canManageDepartment, canSeeDepartment } from '../lib/perm'
import type { CurriculumInput, CurriculumItem, Term } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

export function CurriculumPage() {
  const { deptId } = useParams()
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const dept = s.deptById(deptId)
  const [stage, setStage] = useState(1)
  const [term, setTerm] = useState<Term>(1)
  const [edit, setEdit] = useState<CurriculumInput | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const q = useCurriculum(dept?.id)
  const list = useMemo(() => (q.data ?? []).filter((c) => c.stage === stage && c.term === term), [q.data, stage, term])

  if (!dept || !canSeeDepartment(s.profile, dept.id)) return <NotFoundPage />
  const manage = canManageDepartment(s.profile, dept.id)
  const refresh = () => qc.invalidateQueries({ queryKey: ['curriculum', dept.id] })
  const totals = list.reduce((a, c) => ({ th: a.th + c.theory_hours, pr: a.pr + c.practical_hours, u: a.u + c.units }), { th: 0, pr: 0, u: 0 })
  const blank = (): CurriculumInput => ({
    department_id: dept.id,
    stage,
    term,
    sort: (list[list.length - 1]?.sort ?? 0) + 1,
    name: '',
    name_en: null,
    category: null,
    language: null,
    theory_hours: 2,
    practical_hours: 0,
    units: 2,
  })

  const remove = async (c: CurriculumItem) => {
    if (!(await confirm({ title: 'حذف من الخطة الدراسية', message: <>حذف مادة «{c.name}» من الخطة؟ لا يؤثر ذلك على المواد المضافة سابقاً للسنوات الدراسية.</>, danger: true, confirmText: 'حذف' }))) return
    try {
      await backend.deleteCurriculum(c.id)
      void refresh()
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <div>
      <PageHeader
        crumbs={
          <>
            <Link to={`/departments/${dept.id}`} className="hover:text-ink">
              {dept.name}
            </Link>
            <ChevronLeft className="size-3" />
            <span>الخطة الدراسية</span>
          </>
        }
        title={`الخطة الدراسية — قسم ${dept.name}`}
        subtitle="المواد المعتمدة لكل مرحلة وفصل مع الساعات والوحدات. تُستورد منها مواد كل سنة دراسية بضغطة زر."
        actions={
          manage && (
            <>
              <Button icon={<ClipboardPaste className="size-4" />} onClick={() => setPasteOpen(true)}>
                لصق جدول من Word
              </Button>
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit(blank())}>
                إضافة مادة
              </Button>
            </>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
          <Segmented<number> value={stage} onChange={setStage} options={Array.from({ length: dept.stages }, (_, i) => ({ value: i + 1, label: stageLabel(i + 1) }))} />
          <Segmented<Term>
            value={term}
            onChange={setTerm}
            options={[
              { value: 1, label: TERM_LABEL[1] },
              { value: 2, label: TERM_LABEL[2] },
            ]}
          />
        </div>
        {q.isLoading ? (
          <LoadingBlock />
        ) : list.length === 0 ? (
          <EmptyState icon={<BookMarked className="size-6" />} title="لا توجد مواد في الخطة لهذه المرحلة والفصل">
            {manage ? 'أضف المواد يدوياً أو الصق جدول المفردات الدراسية من ملف Word مباشرة.' : ''}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-10">ت</th>
                  <th>اسم المادة</th>
                  <th>Lecture name</th>
                  <th>نوعها</th>
                  <th>لغة التدريس</th>
                  <th className="text-center">ن</th>
                  <th className="text-center">ع</th>
                  <th className="text-center">المجموع</th>
                  <th className="text-center">الوحدات</th>
                  <th>توزيع الدرجة عند الاستيراد</th>
                  {manage && <th className="w-24" />}
                </tr>
              </thead>
              <tbody>
                {list.map((c, i) => (
                  <tr key={c.id}>
                    <td className="tabular-nums text-muted">{i + 1}</td>
                    <td className="font-medium">{c.name}</td>
                    <td dir="ltr" className="text-end text-sm text-muted">
                      {c.name_en}
                    </td>
                    <td className="text-sm">{c.category}</td>
                    <td className="text-sm">{c.language}</td>
                    <td className="text-center tabular-nums">{c.theory_hours || '—'}</td>
                    <td className="text-center tabular-nums">{c.practical_hours || '—'}</td>
                    <td className="text-center tabular-nums">{c.theory_hours + c.practical_hours}</td>
                    <td className="text-center font-semibold tabular-nums">{c.units}</td>
                    <td className="text-xs text-muted">{schemeForPlan(c).label}</td>
                    {manage && (
                      <td>
                        <div className="flex justify-end">
                          <IconButton label="تعديل" onClick={() => setEdit(c)}>
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton label="حذف" className="hover:text-danger" onClick={() => void remove(c)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <td colSpan={5} className="px-3 py-2.5 text-sm">
                    المجموع
                  </td>
                  <td className="text-center tabular-nums">{totals.th}</td>
                  <td className="text-center tabular-nums">{totals.pr}</td>
                  <td className="text-center tabular-nums">{totals.th + totals.pr}</td>
                  <td className="text-center tabular-nums">{totals.u}</td>
                  <td colSpan={manage ? 2 : 1} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <PlanItemDialog key={edit ? (edit.id ?? `new-${edit.sort}`) : 'closed'} item={edit} onClose={() => setEdit(null)} onSaved={() => void refresh()} />
      <PastePlanDialog open={pasteOpen} onClose={() => setPasteOpen(false)} departmentId={dept.id} stage={stage} term={term} existing={list} onSaved={() => void refresh()} />
    </div>
  )
}

function PlanItemDialog({ item, onClose, onSaved }: { item: CurriculumInput | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  // يُعاد تركيب المكوّن (key) عند فتح مادة أخرى، فتبدأ الحالة من المادة المختارة
  const [f, setForm] = useState<CurriculumInput | null>(item)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof CurriculumInput>(k: K, v: CurriculumInput[K]) => setForm((x) => (x ? { ...x, [k]: v } : x))
  const save = async () => {
    if (!f) return
    if (!f.name.trim()) return toast.error('اسم المادة مطلوب')
    setBusy(true)
    try {
      await backend.saveCurriculum(f)
      toast.success('تم الحفظ')
      onSaved()
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }
  const n = (v: string) => (v === '' ? 0 : Number(v))
  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={item?.id ? 'تعديل مادة في الخطة' : 'إضافة مادة إلى الخطة'}
      footer={
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            حفظ
          </Button>
        </>
      }
    >
      {f && (
        <form
          className="space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Field label="اسم المادة">
            <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="الاسم بالإنجليزية (Lecture name)">
            <Input dir="ltr" value={f.name_en ?? ''} onChange={(e) => set('name_en', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="نوعها">
              <Input value={f.category ?? ''} placeholder="تخصصية / اساسية" onChange={(e) => set('category', e.target.value)} />
            </Field>
            <Field label="لغة التدريس">
              <Input value={f.language ?? ''} placeholder="English" onChange={(e) => set('language', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="ساعات نظري">
              <Input type="number" min={0} dir="ltr" className="text-center" value={f.theory_hours} onChange={(e) => set('theory_hours', n(e.target.value))} />
            </Field>
            <Field label="ساعات عملي">
              <Input type="number" min={0} dir="ltr" className="text-center" value={f.practical_hours} onChange={(e) => set('practical_hours', n(e.target.value))} />
            </Field>
            <Field label="الوحدات">
              <Input type="number" min={0} step={0.5} dir="ltr" className="text-center" value={f.units} onChange={(e) => set('units', n(e.target.value))} />
            </Field>
          </div>
          <p className="text-xs text-muted">عند الاستيراد: {schemeForPlan(f).label}</p>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  )
}

function PastePlanDialog({
  open,
  onClose,
  departmentId,
  stage,
  term,
  existing,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  departmentId: string
  stage: number
  term: Term
  existing: CurriculumItem[]
  onSaved: () => void
}) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const rows = useMemo(() => parsePlanRows(text), [text])
  const names = new Set(existing.map((c) => c.name))
  const fresh = rows.filter((r) => !names.has(r.name))

  const save = async () => {
    setBusy(true)
    let sort = (existing[existing.length - 1]?.sort ?? 0) + 1
    try {
      for (const r of fresh) await backend.saveCurriculum({ department_id: departmentId, stage, term, sort: sort++, ...r })
      toast.success(`تمت إضافة ${fresh.length} مادة إلى الخطة`)
      setText('')
      onSaved()
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
      title={`لصق جدول المفردات الدراسية — ${stageLabel(stage)} / ${TERM_LABEL[term]}`}
      footer={
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={busy} disabled={fresh.length === 0} onClick={save}>
            إضافة {fresh.length || ''} مادة
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Callout tone="info">
          افتح ملف المفردات الدراسية في Word، وحدد صفوف جدول المواد (ت، اسم المادة، Lecture name، نوعها، لغة التدريس، ن، ع، المجموع، عدد الوحدات) ثم انسخها والصقها هنا. صفوف العناوين والمجاميع تُتجاهل تلقائياً.
        </Callout>
        <Textarea className="min-h-40 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="الصق الجدول هنا…" />
        {rows.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            <table className="table-base">
              <thead>
                <tr>
                  <th>اسم المادة</th>
                  <th>English</th>
                  <th className="text-center">ن</th>
                  <th className="text-center">ع</th>
                  <th className="text-center">الوحدات</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={names.has(r.name) ? 'opacity-50' : ''}>
                    <td className="font-medium">{r.name}</td>
                    <td dir="ltr" className="text-end text-xs text-muted">
                      {r.name_en}
                    </td>
                    <td className="text-center tabular-nums">{r.theory_hours}</td>
                    <td className="text-center tabular-nums">{r.practical_hours || '—'}</td>
                    <td className="text-center font-semibold tabular-nums">{r.units}</td>
                    <td className="text-xs text-muted">{names.has(r.name) ? 'موجودة مسبقاً' : schemeForPlan(r).label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {text && rows.length === 0 && <Callout tone="warning">لم يُتعرف على صفوف. تأكد من نسخ صفوف الجدول نفسها (وليس النص فقط).</Callout>}
      </div>
    </Modal>
  )
}

