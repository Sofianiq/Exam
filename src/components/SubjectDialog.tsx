import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSession } from '../app/session'
import { backend } from '../data'
import { finalMaxOf, round2 } from '../lib/calc'
import { displayName } from '../lib/format'
import { ROLE_LABEL, TERM_LABEL } from '../lib/labels'
import { normalizeArabic } from '../lib/parse'
import type { ClassKey, Subject, SubjectInput, Term } from '../lib/types'
import { errorText, useToast } from './feedback'
import { Button, Callout, Checkbox, Field, Input, Modal, Segmented, Select, cx } from './ui'

type Preset = 'practical' | 'theory' | 'ministerial' | 'custom'

const PRESETS: Record<Exclude<Preset, 'custom'>, { coursework_max: number; cw_practical_max: number; practical_max: number }> = {
  practical: { coursework_max: 40, cw_practical_max: 15, practical_max: 25 },
  theory: { coursework_max: 30, cw_practical_max: 0, practical_max: 0 },
  // المادة التقويمية (الوزارية): سعي 40 من القسم والكلية + امتحان نهائي وزاري 60
  ministerial: { coursework_max: 40, cw_practical_max: 0, practical_max: 0 },
}

/** الحد الأدنى الافتراضي للامتحان الوزاري: نصف درجة الامتحان النهائي (30 من 60) */
const defaultFinalMin = (coursework: number, practical: number) => round2((100 - coursework - practical) / 2)

function presetOf(s: { coursework_max: number; cw_practical_max: number; practical_max: number; ministerial?: boolean }): Preset {
  if (s.ministerial) return s.coursework_max === 40 && s.cw_practical_max === 0 && s.practical_max === 0 ? 'ministerial' : 'custom'
  for (const [k, v] of Object.entries(PRESETS)) {
    if (k === 'ministerial') continue
    if (v.coursework_max === s.coursework_max && v.cw_practical_max === s.cw_practical_max && v.practical_max === s.practical_max) return k as Preset
  }
  return 'custom'
}

export function SubjectDialog({
  open,
  onClose,
  classKey,
  term,
  subject,
  nextSort,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  classKey: ClassKey
  term: Term
  subject: Subject | null
  nextSort: number
  onSaved: () => void
}) {
  const s = useSession()
  const toast = useToast()
  const [form, setForm] = useState<SubjectInput>(() => blank())
  const [preset, setPreset] = useState<Preset>('practical')
  const [split, setSplit] = useState(true)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function blank(): SubjectInput {
    return { ...classKey, term, name: '', code: null, units: null, teacher_ids: [], ...PRESETS.practical, sort: nextSort, ministerial: false, final_min: null }
  }

  useEffect(() => {
    if (!open) return
    const f: SubjectInput = subject
      ? {
          id: subject.id,
          year_id: subject.year_id,
          department_id: subject.department_id,
          stage: subject.stage,
          shift: subject.shift,
          term: subject.term,
          name: subject.name,
          code: subject.code,
          units: subject.units,
          teacher_ids: [...subject.teacher_ids],
          coursework_max: subject.coursework_max,
          cw_practical_max: subject.cw_practical_max,
          practical_max: subject.practical_max,
          sort: subject.sort,
          ministerial: subject.ministerial,
          final_min: subject.final_min,
        }
      : blank()
    setForm(f)
    setPreset(presetOf(f))
    setSplit(f.cw_practical_max > 0)
    setErr(null)
    setQ('')
  }, [open, subject])

  const set = <K extends keyof SubjectInput>(k: K, v: SubjectInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const final = finalMaxOf(form.coursework_max, form.practical_max)
  const theoryPart = round2(form.coursework_max - form.cw_practical_max)

  const teachers = useMemo(() => {
    const list = s.profiles.filter((p) => p.active && (p.role === 'teacher' || p.role === 'head'))
    const t = normalizeArabic(q)
    return list
      .filter((p) => !t || normalizeArabic(`${p.full_name} ${p.username}`).includes(t) || form.teacher_ids.includes(p.id))
      .sort((a, b) => {
        const ad = a.department_id === classKey.department_id ? 0 : 1
        const bd = b.department_id === classKey.department_id ? 0 : 1
        return ad - bd || a.full_name.localeCompare(b.full_name, 'ar')
      })
  }, [s.profiles, q, form.teacher_ids, classKey.department_id])

  const applyPreset = (p: Preset) => {
    setPreset(p)
    if (p !== 'custom') {
      const v = PRESETS[p]
      const ministerial = p === 'ministerial'
      setForm((f) => ({ ...f, ...v, ministerial, final_min: ministerial ? defaultFinalMin(v.coursework_max, v.practical_max) : null }))
      setSplit(v.cw_practical_max > 0)
    }
  }

  const validate = (): string | null => {
    if (!form.name.trim()) return 'يرجى كتابة اسم المادة'
    const nums = [form.coursework_max, form.practical_max, form.cw_practical_max]
    if (nums.some((n) => Number.isNaN(n) || n < 0)) return 'قيم توزيع الدرجات غير صالحة'
    if (form.coursework_max + form.practical_max > 100) return 'مجموع السعي والعملي يتجاوز 100'
    if (split && (form.cw_practical_max <= 0 || form.cw_practical_max >= form.coursework_max)) return 'جزء العملي من السعي يجب أن يكون أكبر من صفر وأقل من درجة السعي'
    if (form.ministerial && (form.final_min == null || Number.isNaN(form.final_min) || form.final_min < 0 || form.final_min > 100 - form.coursework_max))
      return `الحد الأدنى للامتحان النهائي يجب أن يكون بين 0 و ${100 - form.coursework_max}`
    return null
  }

  const save = async () => {
    const v = validate()
    if (v) return setErr(v)
    setBusy(true)
    setErr(null)
    try {
      await backend.saveSubject({
        ...form,
        name: form.name.trim(),
        cw_practical_max: split ? form.cw_practical_max : 0,
        final_min: form.ministerial ? form.final_min : null,
      })
      toast.success(subject ? 'تم تحديث المادة' : 'تمت إضافة المادة')
      onSaved()
      onClose()
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const numInput = (value: number, onChange: (n: number) => void, disabled = false) => (
    <Input type="number" min={0} max={100} step={0.5} dir="ltr" className="text-center tabular-nums" value={Number.isNaN(value) ? '' : value} disabled={disabled} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={subject ? `تعديل المادة: ${subject.name}` : 'إضافة مادة دراسية'}
      footer={
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            حفظ المادة
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
          <Field label="اسم المادة">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="مثال: التشريح الشعاعي" />
          </Field>
          <Field label="الفصل">
            <Select value={form.term} onChange={(e) => set('term', Number(e.target.value) as Term)}>
              <option value={1}>{TERM_LABEL[1]}</option>
              <option value={2}>{TERM_LABEL[2]}</option>
            </Select>
          </Field>
          <Field label="الوحدات">
            <Input type="number" min={0} step={0.5} dir="ltr" className="w-24 text-center" value={form.units ?? ''} onChange={(e) => set('units', e.target.value === '' ? null : Number(e.target.value))} />
          </Field>
        </div>

        <div className="rounded-xl border border-line bg-surface-2/50 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold">توزيع الدرجة (من 100)</div>
            <Segmented<Preset>
              size="sm"
              value={preset}
              onChange={applyPreset}
              options={[
                { value: 'practical', label: 'نظري + عملي' },
                { value: 'theory', label: 'نظري فقط' },
                { value: 'ministerial', label: 'تقويمية (وزارية)' },
                { value: 'custom', label: 'مخصص' },
              ]}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="السعي الفصلي">{numInput(form.coursework_max, (n) => { setPreset('custom'); set('coursework_max', n) })}</Field>
            <Field label="العملي النهائي">{numInput(form.practical_max, (n) => { setPreset('custom'); set('practical_max', n) })}</Field>
            <Field label="الامتحان النهائي (النظري)">
              <div className={cx('field flex h-[38px] items-center justify-center font-bold tabular-nums', final < 0 ? 'text-danger' : 'text-primary-text')}>{final}</div>
            </Field>
            <Field label="المجموع">
              <div className="field flex h-[38px] items-center justify-center font-bold tabular-nums">100</div>
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Checkbox
              checked={split}
              disabled={form.coursework_max <= 0}
              onChange={(v) => {
                setPreset('custom')
                setSplit(v)
                if (v && form.cw_practical_max <= 0) set('cw_practical_max', Math.min(15, Math.max(1, form.coursework_max - 1)))
              }}
              label="تقسيم السعي إلى نظري وعملي"
            />
            {split && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted">السعي النظري</span>
                <b className="tabular-nums">{theoryPart}</b>
                <span className="text-muted">+ السعي العملي</span>
                <div className="w-20">{numInput(form.cw_practical_max, (n) => { setPreset('custom'); set('cw_practical_max', n) })}</div>
              </div>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            الدرجة النهائية = السعي ({form.coursework_max}) {form.practical_max > 0 && <>+ العملي النهائي ({form.practical_max}) </>}+ الامتحان النهائي ({final})
          </p>
          <div className="mt-4 rounded-lg border border-gold/40 bg-gold-soft/40 p-3">
            <Checkbox
              checked={form.ministerial}
              onChange={(v) => {
                setPreset(presetOf({ ...form, ministerial: v }))
                setForm((f) => ({ ...f, ministerial: v, final_min: v ? (f.final_min ?? defaultFinalMin(f.coursework_max, f.practical_max)) : null }))
              }}
              label="مادة تقويمية (وزارية) — الامتحان النهائي وزاري"
            />
            {form.ministerial && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span>يُشترط للنجاح الحصول على</span>
                <div className="w-20">{numInput(form.final_min ?? NaN, (n) => set('final_min', Number.isNaN(n) ? null : n))}</div>
                <span>
                  من {final} في الامتحان النهائي على الأقل، إضافة إلى بلوغ المجموع درجة النجاح ({s.settings.pass_mark}).
                </span>
                <p className="w-full text-xs text-muted">
                  مثال: سعي 35 + امتحان نهائي 29 = 64، لكن الطالب راسب لأن درجة الامتحان النهائي أقل من {form.final_min ?? '—'}.
                </p>
              </div>
            )}
          </div>
        </div>

        <Field label={`التدريسي / التدريسيون (${form.teacher_ids.length})`} hint="يرى التدريسي المادة ويُدخل درجاتها فقط بعد إسنادها إليه. يمكن إسناد أكثر من تدريسي.">
          <div className="rounded-lg border border-line-strong">
            <div className="relative border-b border-line">
              <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-faint" />
              <input className="w-full bg-transparent py-2 ps-9 pe-3 text-sm outline-none" placeholder="بحث بالاسم…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="max-h-48 overflow-y-auto p-1.5">
              {teachers.length === 0 && <p className="p-3 text-center text-sm text-muted">لا يوجد تدريسيون. أضفهم من صفحة المستخدمين.</p>}
              {teachers.map((p) => {
                const on = form.teacher_ids.includes(p.id)
                return (
                  <label key={p.id} className={cx('flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm', on ? 'bg-primary-soft' : 'hover:bg-surface-2')}>
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={on}
                      onChange={(e) => set('teacher_ids', e.target.checked ? [...form.teacher_ids, p.id] : form.teacher_ids.filter((x) => x !== p.id))}
                    />
                    <span className="flex-1">{displayName(p)}</span>
                    <span className="text-xs text-muted">
                      {ROLE_LABEL[p.role]}
                      {p.department_id && p.department_id !== classKey.department_id ? ` — ${s.deptById(p.department_id)?.name ?? ''}` : ''}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        </Field>
        {err && <Callout tone="danger">{err}</Callout>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
