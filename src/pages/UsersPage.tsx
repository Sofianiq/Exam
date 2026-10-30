import { useQueryClient } from '@tanstack/react-query'
import { Copy, FileSpreadsheet, KeyRound, Pencil, Printer, RefreshCw, Search, Trash2, UserCheck, UserPlus, Users, UserX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSession } from '../app/session'
import { useConfirm, useToast } from '../components/feedback'
import { Badge, Button, Callout, Card, EmptyState, Field, IconButton, Input, Modal, PageHeader, Select, Textarea, cx } from '../components/ui'
import { backend, isDemo } from '../data'
import { displayName, fmtDate } from '../lib/format'
import { ROLE_LABEL, ROLE_ORDER, TITLES } from '../lib/labels'
import { normalizeArabic, parseNameList } from '../lib/parse'
import { USERNAME_RE, generatePassword, suggestUsername } from '../lib/password'
import { canDeleteUser, canManageUser, canManageUsers, manageableRoles } from '../lib/perm'
import type { Profile, Role } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

interface Credential {
  full_name: string
  role: Role
  department: string
  username: string
  password: string
}

export function UsersPage() {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [dept, setDept] = useState(s.profile.role === 'head' ? (s.profile.department_id ?? '') : '')
  const [createOpen, setCreateOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [edit, setEdit] = useState<Profile | null>(null)
  const [creds, setCreds] = useState<Credential[] | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['profiles'] })

  const list = useMemo(() => {
    const t = normalizeArabic(q)
    return s.profiles
      .filter((p) => (!role || p.role === role) && (!dept || p.department_id === dept))
      .filter((p) => !t || normalizeArabic(`${p.full_name} ${p.username}`).includes(t))
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.full_name.localeCompare(b.full_name, 'ar'))
  }, [s.profiles, q, role, dept])

  if (!canManageUsers(s.profile)) return <NotFoundPage />
  const deptName = (id: string | null) => s.deptById(id)?.name ?? ''

  const resetPw = async (p: Profile) => {
    const ok = await confirm({ title: 'إعادة تعيين كلمة المرور', message: <>سيتم توليد كلمة مرور مؤقتة جديدة للحساب <b>{displayName(p)}</b> ويُطلب منه تغييرها عند الدخول.</>, confirmText: 'توليد كلمة مرور' })
    if (!ok) return
    const pw = generatePassword()
    try {
      await backend.resetPassword(p.id, pw)
      setCreds([{ full_name: displayName(p), role: p.role, department: deptName(p.department_id), username: p.username, password: pw }])
      void refresh()
    } catch (e) {
      toast.error(e)
    }
  }

  const toggleActive = async (p: Profile) => {
    const ok = await confirm({
      title: p.active ? 'إيقاف الحساب' : 'تفعيل الحساب',
      message: p.active ? 'لن يتمكن المستخدم من الدخول حتى يُعاد تفعيل الحساب. تبقى بياناته وسجلاته محفوظة.' : 'سيتمكن المستخدم من الدخول مجدداً.',
      confirmText: p.active ? 'إيقاف' : 'تفعيل',
      danger: p.active,
    })
    if (!ok) return
    try {
      await backend.updateAccount({ id: p.id, full_name: p.full_name, title: p.title, role: p.role, department_id: p.department_id, active: !p.active })
      toast.success(p.active ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب')
      void refresh()
    } catch (e) {
      toast.error(e)
    }
  }

  const remove = async (p: Profile) => {
    const ok = await confirm({
      title: 'حذف الحساب نهائياً',
      message: 'يُفضّل إيقاف الحساب بدلاً من حذفه. الحذف يزيل التدريسي من المواد المسندة إليه ولا يمكن التراجع عنه.',
      confirmText: 'حذف نهائي',
      danger: true,
      typeToConfirm: p.username,
    })
    if (!ok) return
    try {
      await backend.deleteAccount(p.id)
      toast.success('تم حذف الحساب')
      void refresh()
      void qc.invalidateQueries({ queryKey: ['subjects'] })
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <div>
      <div className="no-print">
        <PageHeader
          title="المستخدمون والحسابات"
          subtitle="إنشاء حسابات التدريسيين ومقرري الأقسام واللجنة الامتحانية وتوليد كلمات المرور"
          actions={
            <>
              <Button icon={<Users className="size-4" />} onClick={() => setBulkOpen(true)}>
                إنشاء حسابات جماعية
              </Button>
              <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setCreateOpen(true)}>
                حساب جديد
              </Button>
            </>
          }
        />
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-faint" />
              <input className="field ps-9" placeholder="بحث بالاسم أو اسم المستخدم…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role | '')} className="w-auto">
              <option value="">كل الأدوار</option>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
            <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto">
              <option value="">كل الأقسام</option>
              {s.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <span className="ms-auto text-xs text-muted">{list.length} حساب</span>
          </div>
          {list.length === 0 ? (
            <EmptyState icon={<Users className="size-6" />} title="لا توجد حسابات مطابقة" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>اسم المستخدم</th>
                    <th>الدور</th>
                    <th>القسم</th>
                    <th>الحالة</th>
                    <th>تاريخ الإنشاء</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const can = canManageUser(s.profile, p)
                    return (
                      <tr key={p.id} className={cx(!p.active && 'opacity-60')}>
                        <td className="font-medium">
                          {displayName(p)}
                          {p.id === s.profile.id && <Badge tone="gold" className="ms-2">أنت</Badge>}
                        </td>
                        <td dir="ltr" className="text-end font-mono text-sm">
                          {p.username}
                        </td>
                        <td>
                          <Badge tone={p.role === 'teacher' ? 'neutral' : p.role === 'head' ? 'primary' : 'gold'}>{ROLE_LABEL[p.role]}</Badge>
                        </td>
                        <td className="text-sm">{deptName(p.department_id) || '—'}</td>
                        <td>
                          {!p.active ? (
                            <Badge tone="danger">موقوف</Badge>
                          ) : p.must_change_password ? (
                            <Badge tone="warning">لم يغيّر كلمة المرور</Badge>
                          ) : (
                            <Badge tone="success">فعال</Badge>
                          )}
                        </td>
                        <td className="text-xs tabular-nums text-muted">{fmtDate(p.created_at)}</td>
                        <td>
                          {can && (
                            <div className="flex justify-end">
                              <IconButton label="تعديل" onClick={() => setEdit(p)}>
                                <Pencil className="size-4" />
                              </IconButton>
                              <IconButton label="إعادة تعيين كلمة المرور" onClick={() => void resetPw(p)}>
                                <KeyRound className="size-4" />
                              </IconButton>
                              <IconButton label={p.active ? 'إيقاف الحساب' : 'تفعيل الحساب'} onClick={() => void toggleActive(p)}>
                                {p.active ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
                              </IconButton>
                              {canDeleteUser(s.profile, p) && (
                                <IconButton label="حذف" className="hover:text-danger" onClick={() => void remove(p)}>
                                  <Trash2 className="size-4" />
                                </IconButton>
                              )}
                            </div>
                          )}
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

      <AccountDialog
        open={createOpen || !!edit}
        profile={edit}
        onClose={() => {
          setCreateOpen(false)
          setEdit(null)
        }}
        onCreated={(c) => {
          setCreds([c])
          void refresh()
        }}
        onUpdated={() => void refresh()}
      />
      <BulkDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onDone={(c) => {
          setCreds(c)
          void refresh()
        }}
      />
      <CredentialsDialog creds={creds} onClose={() => setCreds(null)} />
    </div>
  )
}

function useRoleOptions() {
  const s = useSession()
  return manageableRoles(s.profile)
}

function AccountDialog({
  open,
  profile,
  onClose,
  onCreated,
  onUpdated,
}: {
  open: boolean
  profile: Profile | null
  onClose: () => void
  onCreated: (c: Credential) => void
  onUpdated: () => void
}) {
  const s = useSession()
  const toast = useToast()
  const roles = useRoleOptions()
  const isHead = s.profile.role === 'head'
  const [loaded, setLoaded] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [title, setTitle] = useState('')
  const [role, setRole] = useState<Role>('teacher')
  const [dept, setDept] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const taken = useMemo(() => new Set(s.profiles.map((p) => p.username)), [s.profiles])

  const key = open ? (profile?.id ?? 'new') : null
  if (key !== loaded) {
    setLoaded(key)
    setErr(null)
    if (profile) {
      setFullName(profile.full_name)
      setTitle(profile.title ?? '')
      setRole(profile.role)
      setDept(profile.department_id ?? '')
    } else if (key) {
      const d = isHead ? (s.profile.department_id ?? '') : ''
      setFullName('')
      setTitle('')
      setRole('teacher')
      setDept(d)
      setUsername(suggestUsername(s.deptById(d)?.code ?? 't', taken))
      setPassword(generatePassword())
    }
  }

  const save = async () => {
    setErr(null)
    if (fullName.trim().length < 3) return setErr('يرجى كتابة الاسم الكامل')
    if (role === 'head' && !dept) return setErr('يجب تحديد القسم لمقرر القسم')
    setBusy(true)
    try {
      if (profile) {
        await backend.updateAccount({ id: profile.id, full_name: fullName, title: title || null, role, department_id: dept || null, active: profile.active })
        toast.success('تم تحديث الحساب')
        onUpdated()
      } else {
        const u = username.trim().toLowerCase()
        if (!USERNAME_RE.test(u)) throw new Error('اسم المستخدم: 3–32 حرفاً إنجليزياً صغيراً أو رقماً (يسمح بـ . _ -)')
        if (password.length < 6) throw new Error('كلمة المرور يجب أن لا تقل عن 6 أحرف')
        await backend.createAccount({ username: u, password, full_name: fullName, title: title || null, role, department_id: dept || null })
        onCreated({ full_name: `${title ? `${title} ` : ''}${fullName.trim()}`, role, department: s.deptById(dept)?.name ?? '', username: u, password })
      }
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={profile ? 'تعديل الحساب' : 'إنشاء حساب جديد'}
      footer={
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {profile ? 'حفظ' : 'إنشاء الحساب'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <Field label="اللقب العلمي">
            <Select value={title} onChange={(e) => setTitle(e.target.value)}>
              <option value="">—</option>
              {TITLES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="الاسم الكامل">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="الاسم الثلاثي أو الرباعي" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الدور / الصلاحية">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={roles.length <= 1}>
              {(roles.includes(role) ? roles : [role, ...roles]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="القسم" hint={role === 'teacher' ? 'اختياري للتدريسيين (مثل مدرسي اللغات)' : undefined}>
            <Select
              value={dept}
              disabled={isHead}
              onChange={(e) => {
                setDept(e.target.value)
                if (!profile) setUsername(suggestUsername(s.deptById(e.target.value)?.code ?? 't', taken))
              }}
            >
              <option value="">— بدون قسم —</option>
              {s.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {!profile && (
          <div className="grid gap-3 rounded-xl border border-line bg-surface-2/50 p-4 sm:grid-cols-2">
            <Field label="اسم المستخدم" hint="أحرف إنجليزية صغيرة وأرقام">
              <Input dir="ltr" className="font-mono" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} />
            </Field>
            <Field label="كلمة المرور المؤقتة">
              <div className="flex gap-2">
                <Input dir="ltr" className="font-mono" value={password} onChange={(e) => setPassword(e.target.value)} />
                <IconButton label="توليد كلمة مرور جديدة" className="border border-line-strong" onClick={() => setPassword(generatePassword())}>
                  <RefreshCw className="size-4" />
                </IconButton>
              </div>
            </Field>
          </div>
        )}
        {err && <Callout tone="danger">{err}</Callout>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

function BulkDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (c: Credential[]) => void }) {
  const s = useSession()
  const toast = useToast()
  const roles = useRoleOptions()
  const isHead = s.profile.role === 'head'
  const [text, setText] = useState('')
  const [role, setRole] = useState<Role>('teacher')
  const [dept, setDept] = useState(isHead ? (s.profile.department_id ?? '') : '')
  const [prefix, setPrefix] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [seed, setSeed] = useState(0)
  const taken = useMemo(() => new Set(s.profiles.map((p) => p.username)), [s.profiles])
  const effectivePrefix = (prefix.trim() || s.deptById(dept)?.code || 't').toLowerCase()

  const preview = useMemo(() => {
    const used = new Set(taken)
    return parseNameList(text).map((line) => {
      const t = TITLES.find((x) => line.startsWith(`${x} `) || line.startsWith(x.replace(/\.$/, '') + ' '))
      const full = t ? line.slice(line.indexOf(' ') + 1).trim() : line
      const username = suggestUsername(effectivePrefix, used)
      used.add(username)
      return { title: t ?? null, full_name: full, username, password: generatePassword() }
    })
    // seed يعيد توليد كلمات المرور عند الطلب
  }, [text, effectivePrefix, taken, seed])

  const run = async () => {
    setBusy(true)
    setProgress(0)
    const done: Credential[] = []
    const failed: string[] = []
    for (const [i, p] of preview.entries()) {
      try {
        await backend.createAccount({ username: p.username, password: p.password, full_name: p.full_name, title: p.title, role, department_id: dept || null })
        done.push({ full_name: `${p.title ? `${p.title} ` : ''}${p.full_name}`, role, department: s.deptById(dept)?.name ?? '', username: p.username, password: p.password })
      } catch (e) {
        failed.push(`${p.full_name}: ${e instanceof Error ? e.message : e}`)
      }
      setProgress(i + 1)
    }
    setBusy(false)
    if (failed.length) toast.error(`تعذر إنشاء ${failed.length} حساب: ${failed.slice(0, 2).join(' | ')}`)
    if (done.length) {
      toast.success(`تم إنشاء ${done.length} حساب`)
      setText('')
      onClose()
      onDone(done)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      size="xl"
      title="إنشاء حسابات جماعية من قائمة أسماء"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            إلغاء
          </Button>
          <Button variant="primary" loading={busy} disabled={preview.length === 0} onClick={run}>
            {busy ? `جارٍ الإنشاء ${progress}/${preview.length}` : `إنشاء ${preview.length || ''} حساب`}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="الدور">
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="القسم">
              <Select value={dept} disabled={isHead} onChange={(e) => setDept(e.target.value)}>
                <option value="">— بدون قسم —</option>
                {s.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="بادئة اسم المستخدم" hint={`مثال: ${effectivePrefix}01، ${effectivePrefix}02 …`}>
            <Input dir="ltr" className="font-mono" placeholder={s.deptById(dept)?.code?.toLowerCase() ?? 't'} value={prefix} onChange={(e) => setPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} />
          </Field>
          <Field label="الأسماء (اسم في كل سطر)" hint="يمكن كتابة اللقب قبل الاسم، مثل: م.م. أحمد علي">
            <Textarea className="min-h-56" value={text} onChange={(e) => setText(e.target.value)} placeholder={'م.د. أحمد علي حسين\nم.م. زينب كاظم جواد'} />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label mb-0">المعاينة ({preview.length})</span>
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => setSeed((x) => x + 1)}>
              توليد كلمات مرور أخرى
            </Button>
          </div>
          <div className="max-h-96 overflow-auto rounded-lg border border-line">
            <table className="table-base">
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>اسم المستخدم</th>
                  <th>كلمة المرور</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={p.username}>
                    <td className="text-sm">
                      {p.title && <span className="text-muted">{p.title} </span>}
                      {p.full_name}
                    </td>
                    <td dir="ltr" className="text-end font-mono text-xs">
                      {p.username}
                    </td>
                    <td dir="ltr" className="text-end font-mono text-xs">
                      {p.password}
                    </td>
                  </tr>
                ))}
                {preview.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-10 text-center text-sm text-muted">
                      الصق الأسماء لتظهر هنا
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function CredentialsDialog({ creds, onClose }: { creds: Credential[] | null; onClose: () => void }) {
  const s = useSession()
  const toast = useToast()
  const appUrl = `${window.location.origin}${window.location.pathname}`
  const text = (creds ?? []).map((c) => `${c.full_name}\nاسم المستخدم: ${c.username}\nكلمة المرور: ${c.password}`).join('\n\n')
  const exportExcel = async () => {
    if (!creds) return
    const { exportTableXlsx } = await import('../lib/excel')
    await exportTableXlsx({
      settings: s.settings,
      title: 'بيانات الدخول للحسابات الجديدة',
      subtitle: `رابط النظام: ${appUrl} — يُطلب تغيير كلمة المرور عند أول دخول`,
      sheet: 'الحسابات',
      headers: ['ت', 'الاسم', 'الدور', 'القسم', 'اسم المستخدم', 'كلمة المرور'],
      widths: [5, 34, 16, 24, 18, 16],
      rows: creds.map((c, i) => [i + 1, c.full_name, ROLE_LABEL[c.role], c.department, c.username, c.password]),
      filename: `بيانات الدخول - ${fmtDate(new Date()).replace(/\//g, '-')}.xlsx`,
    })
  }
  return (
    <>
      <Modal
        open={!!creds}
        onClose={onClose}
        size="lg"
        title="بيانات الدخول"
        footer={
          <>
            <Button icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success('تم النسخ'))}>
              نسخ
            </Button>
            <Button icon={<FileSpreadsheet className="size-4" />} onClick={() => void exportExcel()}>
              Excel
            </Button>
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>
              طباعة البطاقات
            </Button>
            <Button variant="primary" onClick={onClose}>
              تم
            </Button>
          </>
        }
      >
        <Callout tone="warning" className="mb-4">
          احفظ أو اطبع كلمات المرور الآن — لن تظهر مرة أخرى. سيُطلب من المستخدم تغييرها عند أول دخول.
          {isDemo && ' (في الوضع التجريبي تبقى كلمات المرور محلية في هذا المتصفح.)'}
        </Callout>
        <div className="max-h-96 overflow-auto rounded-lg border border-line">
          <table className="table-base">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>اسم المستخدم</th>
                <th>كلمة المرور</th>
              </tr>
            </thead>
            <tbody>
              {(creds ?? []).map((c) => (
                <tr key={c.username}>
                  <td>
                    {c.full_name}
                    <div className="text-xs text-muted">
                      {ROLE_LABEL[c.role]}
                      {c.department && ` — ${c.department}`}
                    </div>
                  </td>
                  <td dir="ltr" className="text-end font-mono font-semibold">
                    {c.username}
                  </td>
                  <td dir="ltr" className="text-end font-mono font-semibold">
                    {c.password}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
      {creds && (
        <div className="print-only">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {creds.map((c) => (
              <div key={c.username} style={{ border: '1.5px solid #0b5a3a', borderRadius: '10px', padding: '10px 12px', breakInside: 'avoid', fontSize: '10.5pt' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #ccc', paddingBottom: '6px', marginBottom: '6px' }}>
                  <img src="./logo.png" alt="" style={{ width: '36px', height: '36px' }} />
                  <div>
                    <div style={{ fontWeight: 700 }}>نظام اللجنة الامتحانية</div>
                    <div style={{ fontSize: '8.5pt' }}>{s.settings.college_name}</div>
                  </div>
                </div>
                <div style={{ fontWeight: 700 }}>{c.full_name}</div>
                <div style={{ fontSize: '9pt' }}>
                  {ROLE_LABEL[c.role]}
                  {c.department && ` — ${c.department}`}
                </div>
                <div style={{ marginTop: '6px' }}>
                  اسم المستخدم: <b dir="ltr" style={{ fontFamily: 'monospace' }}>{c.username}</b>
                </div>
                <div>
                  كلمة المرور: <b dir="ltr" style={{ fontFamily: 'monospace' }}>{c.password}</b>
                </div>
                <div style={{ fontSize: '8pt', marginTop: '6px', color: '#444' }} dir="ltr">
                  {appUrl}
                </div>
                <div style={{ fontSize: '8pt', color: '#444' }}>يرجى تغيير كلمة المرور عند أول دخول</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
