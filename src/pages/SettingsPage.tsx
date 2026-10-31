import { useQueryClient } from '@tanstack/react-query'
import { Building2, CalendarRange, DatabaseBackup, GraduationCap, Pencil, Plus, RotateCcw, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useSession } from '../app/session'
import { useConfirm, useToast } from '../components/feedback'
import { Badge, Button, Callout, Card, CardHeader, Checkbox, Field, IconButton, Input, Modal, PageHeader, Select } from '../components/ui'
import { backend, isDemo } from '../data'
import type { DemoBackend } from '../data/demoBackend'
import { fmtDate, yearLabel } from '../lib/format'
import { canEditSettings } from '../lib/perm'
import type { Department, GradeBand, Settings } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

export function SettingsPage() {
  const s = useSession()
  if (!canEditSettings(s.profile)) return <NotFoundPage />
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="الإعدادات" subtitle="إعدادات الكلية وقواعد احتساب النتائج والسنوات الدراسية والأقسام" />
      <GeneralSettings />
      <div className="grid gap-6 lg:grid-cols-2">
        <YearsCard />
        <BackupCard />
      </div>
      <DepartmentsCard />
    </div>
  )
}

function GeneralSettings() {
  const s = useSession()
  const toast = useToast()
  const qc = useQueryClient()
  const [form, setForm] = useState<Settings>(() => structuredClone(s.settings))
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => ({ ...f, [k]: v }))
  const scale = [...form.grade_scale].sort((a, b) => b.min - a.min)
  const setBand = (i: number, patch: Partial<GradeBand>) => set('grade_scale', scale.map((b, j) => (j === i ? { ...b, ...patch } : b)))

  const save = async () => {
    if (form.grade_scale.some((b) => !b.label.trim() || Number.isNaN(b.min))) return toast.error('أكمل جدول التقديرات')
    if (!form.grade_scale.some((b) => b.min === 0)) return toast.error('يجب أن يبدأ أدنى تقدير من الصفر')
    setBusy(true)
    try {
      await backend.updateSettings({
        university_name: form.university_name.trim(),
        college_name: form.college_name.trim(),
        pass_mark: Number(form.pass_mark),
        rounding: form.rounding,
        average_mode: form.average_mode,
        idle_minutes: Number(form.idle_minutes),
        second_round_cap: form.second_round_cap == null || Number.isNaN(form.second_round_cap) ? null : Number(form.second_round_cap),
        max_failed_subjects: Number(form.max_failed_subjects),
        grade_scale: scale.map((b) => ({ min: Number(b.min), label: b.label.trim() })),
      })
      await qc.invalidateQueries({ queryKey: ['settings'] })
      void qc.invalidateQueries({ queryKey: ['progress'] })
      toast.success('تم حفظ الإعدادات')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="الإعدادات العامة وقواعد الاحتساب"
        icon={<GraduationCap className="size-4.5" />}
        actions={
          <Button variant="primary" size="sm" icon={<Save className="size-4" />} loading={busy} onClick={save}>
            حفظ الإعدادات
          </Button>
        }
      />
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="اسم الجامعة">
            <Input value={form.university_name} onChange={(e) => set('university_name', e.target.value)} />
          </Field>
          <Field label="اسم الكلية">
            <Input value={form.college_name} onChange={(e) => set('college_name', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="درجة النجاح">
              <Input type="number" min={0} max={100} dir="ltr" className="text-center" value={form.pass_mark} onChange={(e) => set('pass_mark', Number(e.target.value))} />
            </Field>
            <Field label="تقريب الدرجة النهائية">
              <Select value={form.rounding} onChange={(e) => set('rounding', e.target.value as Settings['rounding'])}>
                <option value="none">بدون تقريب (منزلتان)</option>
                <option value="round">تقريب لأقرب عدد صحيح (49.5 ← 50)</option>
                <option value="ceil">جبر الكسر للأعلى (49.1 ← 50)</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="معدل الماستر شيت">
              <Select value={form.average_mode} onChange={(e) => set('average_mode', e.target.value as Settings['average_mode'])}>
                <option value="simple">متوسط حسابي بسيط</option>
                <option value="weighted">موزون بعدد الوحدات</option>
              </Select>
            </Field>
            <Field label="الخروج التلقائي بعد خمول (دقيقة)">
              <Input type="number" min={5} max={600} dir="ltr" className="text-center" value={form.idle_minutes} onChange={(e) => set('idle_minutes', Number(e.target.value))} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الحد الأقصى لمواد الإكمال" hint="الرسوب في أكثر من هذا العدد = راسب، وإلا = مكمل">
              <Input type="number" min={0} max={10} dir="ltr" className="text-center" value={form.max_failed_subjects} onChange={(e) => set('max_failed_subjects', Number(e.target.value))} />
            </Field>
            <Field label="سقف درجة الدور الثاني" hint="اتركه فارغاً بدون سقف (لا يطبق على المؤجل بعذر)">
              <Input
                type="number"
                min={0}
                max={100}
                dir="ltr"
                className="text-center"
                placeholder="بدون سقف"
                value={form.second_round_cap ?? ''}
                onChange={(e) => set('second_round_cap', e.target.value === '' ? null : Number(e.target.value))}
              />
            </Field>
          </div>
        </div>
        <div>
          <div className="label">جدول التقديرات</div>
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="table-base">
              <thead>
                <tr>
                  <th>التقدير</th>
                  <th className="w-28 text-center">من درجة</th>
                  <th className="w-24 text-center">إلى</th>
                </tr>
              </thead>
              <tbody>
                {scale.map((b, i) => (
                  <tr key={i}>
                    <td className="p-1.5">
                      <Input value={b.label} onChange={(e) => setBand(i, { label: e.target.value })} />
                    </td>
                    <td className="p-1.5">
                      <Input type="number" min={0} max={100} dir="ltr" className="text-center" value={b.min} onChange={(e) => setBand(i, { min: Number(e.target.value) })} />
                    </td>
                    <td className="text-center tabular-nums text-muted">{i === 0 ? 100 : scale[i - 1].min - 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">تُطبق التعديلات فوراً على كل الشاشات والتقارير. القوائم المعتمدة لا تتغير درجاتها، وإنما طريقة عرض التقدير فقط.</p>
        </div>
      </div>
    </Card>
  )
}

function YearsCard() {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [label, setLabel] = useState(() => {
    const last = s.years[s.years.length - 1]?.label
    const y = last ? Number(last.slice(5)) : new Date().getFullYear()
    return `${y}-${y + 1}`
  })
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['years'] }), qc.invalidateQueries({ queryKey: ['settings'] })])

  const add = async () => {
    if (!/^\d{4}-\d{4}$/.test(label) || Number(label.slice(5)) !== Number(label.slice(0, 4)) + 1) return toast.error('الصيغة الصحيحة مثل: 2026-2027')
    try {
      await backend.createYear(label)
      toast.success('تمت إضافة السنة الدراسية')
      await refresh()
    } catch (e) {
      toast.error(e)
    }
  }

  const setCurrent = async (id: string) => {
    try {
      await backend.updateSettings({ current_year_id: id })
      toast.success('تم تعيين السنة الحالية')
      await refresh()
    } catch (e) {
      toast.error(e)
    }
  }

  const remove = async (id: string, l: string) => {
    const ok = await confirm({
      title: 'حذف سنة دراسية',
      message: 'سيتم حذف كل الطلبة والمواد والدرجات المسجلة في هذه السنة نهائياً. يُنصح بأخذ نسخة احتياطية أولاً.',
      danger: true,
      confirmText: 'حذف نهائي',
      typeToConfirm: l,
    })
    if (!ok) return
    try {
      await backend.deleteYear(id)
      toast.success('تم حذف السنة الدراسية')
      await refresh()
      void qc.invalidateQueries()
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <Card>
      <CardHeader title="السنوات الدراسية" icon={<CalendarRange className="size-4.5" />} subtitle="السنة الحالية هي التي تظهر افتراضياً لكل المستخدمين" />
      <ul className="divide-y divide-line">
        {s.years.map((y) => (
          <li key={y.id} className="flex items-center gap-3 px-5 py-2.5">
            <span className="flex-1 font-semibold tabular-nums">{yearLabel(y.label)}</span>
            {s.settings.current_year_id === y.id ? (
              <Badge tone="success">السنة الحالية</Badge>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => void setCurrent(y.id)}>
                تعيين كحالية
              </Button>
            )}
            <IconButton label="حذف" className="hover:text-danger" onClick={() => void remove(y.id, y.label)}>
              <Trash2 className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-line px-5 py-3">
        <Input dir="ltr" className="text-center tabular-nums" value={label} onChange={(e) => setLabel(e.target.value.trim())} placeholder="2027-2028" />
        <Button icon={<Plus className="size-4" />} onClick={() => void add()}>
          إضافة
        </Button>
      </div>
    </Card>
  )
}

function BackupCard() {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const download = async () => {
    setBusy(true)
    try {
      const snap = await backend.exportSnapshot()
      const blob = new Blob([JSON.stringify(snap, null, 1)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `نسخة-احتياطية-اللجنة-الامتحانية-${fmtDate(new Date()).replace(/\//g, '-')}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      toast.success('تم تنزيل النسخة الاحتياطية')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <CardHeader title="النسخ الاحتياطي" icon={<DatabaseBackup className="size-4.5" />} />
      <div className="space-y-4 p-5">
        <p className="text-sm text-muted">
          تنزيل نسخة كاملة من البيانات (الأقسام، الطلبة، المواد، الدرجات، الحسابات بدون كلمات المرور) بصيغة JSON للأرشفة. احتفظ بها في مكان آمن لأنها تحتوي بيانات الطلبة.
        </p>
        <Button variant="primary" loading={busy} icon={<DatabaseBackup className="size-4" />} onClick={() => void download()}>
          تنزيل نسخة احتياطية الآن
        </Button>
        <Callout tone="info" icon={<ShieldCheck className="size-4.5" />}>
          يتضمن المشروع أيضاً نسخاً احتياطياً يومياً مشفراً لقاعدة البيانات عبر GitHub Actions (راجع دليل التشغيل).
        </Callout>
        {isDemo && (
          <Button
            variant="danger-soft"
            icon={<RotateCcw className="size-4" />}
            onClick={async () => {
              if (await confirm({ title: 'إعادة البيانات التجريبية', message: 'ستُحذف كل التعديلات المحلية وتعود البيانات التجريبية الأصلية.', danger: true, confirmText: 'إعادة التعيين' })) {
                ;(backend as DemoBackend).resetDemo()
                window.location.reload()
              }
            }}
          >
            إعادة تعيين البيانات التجريبية
          </Button>
        )}
      </div>
    </Card>
  )
}

function DepartmentsCard() {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [edit, setEdit] = useState<Partial<Department> | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['departments'] })

  const save = async () => {
    if (!edit?.name?.trim() || !edit.code?.trim()) return toast.error('اسم القسم ورمزه مطلوبان')
    setBusy(true)
    try {
      await backend.saveDepartment({ ...edit, name: edit.name, code: edit.code })
      toast.success('تم حفظ القسم')
      setEdit(null)
      await refresh()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (d: Department) => {
    const ok = await confirm({
      title: 'حذف قسم',
      message: 'سيتم حذف كل طلبة ومواد ودرجات هذا القسم في جميع السنوات نهائياً.',
      danger: true,
      confirmText: 'حذف نهائي',
      typeToConfirm: d.name,
    })
    if (!ok) return
    try {
      await backend.deleteDepartment(d.id)
      toast.success('تم حذف القسم')
      await refresh()
      void qc.invalidateQueries()
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <Card>
      <CardHeader
        title="الأقسام العلمية"
        icon={<Building2 className="size-4.5" />}
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ name: '', code: '', has_evening: false, stages: 4, sort: s.departments.length + 1 })}>
            إضافة قسم
          </Button>
        }
      />
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>القسم</th>
              <th>الرمز</th>
              <th>الدراسة</th>
              <th className="text-center">المراحل</th>
              <th>رئيس القسم</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.departments.map((d) => (
              <tr key={d.id}>
                <td className="font-medium">{d.name}</td>
                <td dir="ltr" className="text-end font-mono text-sm">
                  {d.code}
                </td>
                <td>
                  <div className="flex gap-1">
                    <Badge tone="gold">صباحي</Badge>
                    {d.has_evening && <Badge tone="info">مسائي</Badge>}
                  </div>
                </td>
                <td className="text-center tabular-nums">{d.stages}</td>
                <td className="text-sm">{d.head_name || <span className="text-warning">غير محدد</span>}</td>
                <td>
                  <div className="flex justify-end">
                    <IconButton label="تعديل" onClick={() => setEdit(d)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label="حذف" className="hover:text-danger" onClick={() => void remove(d)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        size="sm"
        title={edit?.id ? 'تعديل القسم' : 'إضافة قسم'}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>إلغاء</Button>
            <Button variant="primary" loading={busy} onClick={save}>
              حفظ
            </Button>
          </>
        }
      >
        {edit && (
          <form
            className="space-y-3.5"
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
          >
            <Field label="اسم القسم">
              <Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="تقنيات …" />
            </Field>
            <Field label="اسم رئيس القسم (مع اللقب العلمي)" hint="يُطبع أسفل نتيجة الطالب مكان التوقيع">
              <Input value={edit.head_name ?? ''} onChange={(e) => setEdit({ ...edit, head_name: e.target.value })} placeholder="أ.م.د. …" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="الرمز (إنجليزي)">
                <Input dir="ltr" className="font-mono uppercase" value={edit.code ?? ''} maxLength={6} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
              </Field>
              <Field label="عدد المراحل">
                <Input type="number" min={1} max={6} dir="ltr" className="text-center" value={edit.stages ?? 4} onChange={(e) => setEdit({ ...edit, stages: Number(e.target.value) })} />
              </Field>
              <Field label="الترتيب">
                <Input type="number" min={0} dir="ltr" className="text-center" value={edit.sort ?? 0} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) })} />
              </Field>
            </div>
            <Checkbox checked={!!edit.has_evening} onChange={(v) => setEdit({ ...edit, has_evening: v })} label="يوجد دراسة مسائية في هذا القسم" />
            <button type="submit" hidden />
          </form>
        )}
      </Modal>
    </Card>
  )
}
