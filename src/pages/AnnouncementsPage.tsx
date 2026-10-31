import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AUDIENCE_LABEL, LEVEL_LABEL, canEditAnnouncement, canPublishAnnouncements, isActive, useAnnouncements, useSeenAnnouncements } from '../app/announcements'
import { useSession } from '../app/session'
import { errorText, useConfirm, useToast } from '../components/feedback'
import { Badge, Button, Callout, Card, Checkbox, EmptyState, Field, IconButton, Input, LoadingBlock, Modal, PageHeader, Segmented, Select, Textarea, cx } from '../components/ui'
import { backend } from '../data'
import { fmtDate, fmtDateTime } from '../lib/format'
import { isSuper } from '../lib/perm'
import type { Announcement, AnnouncementAudience, AnnouncementInput, AnnouncementLevel } from '../lib/types'

export const LEVEL_STYLE: Record<AnnouncementLevel, { bar: string; tone: 'info' | 'gold' | 'danger' }> = {
  info: { bar: 'bg-primary', tone: 'info' },
  important: { bar: 'bg-gold', tone: 'gold' },
  urgent: { bar: 'bg-danger', tone: 'danger' },
}

export function AnnouncementsPage() {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const q = useAnnouncements()
  const { markSeen } = useSeenAnnouncements(s.profile.id)
  const [edit, setEdit] = useState<AnnouncementInput | null>(null)
  const list = q.data ?? []
  const canPublish = canPublishAnnouncements(s.profile)

  // فتح الصفحة يعني قراءة الإعلانات النافذة
  useEffect(() => {
    if (q.data?.length) markSeen(q.data.map((a) => a.id))
  }, [q.data, markSeen])

  const refresh = () => qc.invalidateQueries({ queryKey: ['announcements'] })
  const blank = (): AnnouncementInput => ({
    title: '',
    body: '',
    level: 'info',
    department_id: isSuper(s.profile) ? null : s.profile.department_id,
    audience: 'all',
    pinned: false,
    expires_at: null,
  })
  const remove = async (a: Announcement) => {
    if (!(await confirm({ title: 'حذف الإعلان', message: <>حذف الإعلان «{a.title}»؟</>, danger: true, confirmText: 'حذف' }))) return
    try {
      await backend.deleteAnnouncement(a.id)
      toast.success('تم حذف الإعلان')
      void refresh()
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <div>
      <PageHeader
        title="الإعلانات"
        subtitle="تعليمات وتنبيهات الإدارة والأقسام لمستخدمي النظام"
        actions={
          canPublish && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit(blank())}>
              إعلان جديد
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Megaphone className="size-6" />} title="لا توجد إعلانات حالياً">
            {canPublish ? 'اكتب إعلاناً ليظهر للمستخدمين بشكل بارز في أعلى الصفحات وفي لوحة المتابعة.' : ''}
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((a) => (
            <AnnouncementCard
              key={a.id}
              a={a}
              actions={
                canEditAnnouncement(s.profile, a) && (
                  <div className="flex gap-1">
                    <IconButton
                      label="تعديل"
                      onClick={() =>
                        setEdit({ id: a.id, title: a.title, body: a.body, level: a.level, department_id: a.department_id, audience: a.audience, pinned: a.pinned, expires_at: a.expires_at })
                      }
                    >
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label="حذف" className="hover:text-danger" onClick={() => void remove(a)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                )
              }
            />
          ))}
        </div>
      )}
      <AnnouncementDialog key={edit ? (edit.id ?? 'new') : 'closed'} item={edit} onClose={() => setEdit(null)} onSaved={() => void refresh()} />
    </div>
  )
}

export function AnnouncementCard({ a, actions, compact }: { a: Announcement; actions?: React.ReactNode; compact?: boolean }) {
  const s = useSession()
  const st = LEVEL_STYLE[a.level]
  const active = isActive(a)
  return (
    <Card className={cx('relative overflow-hidden', !active && 'opacity-60')}>
      <span className={cx('absolute inset-y-0 start-0 w-1.5', st.bar)} />
      <div className={cx('ps-6 pe-4', compact ? 'py-3' : 'py-4')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {a.pinned && <Pin className="size-4 text-gold-text" aria-label="مثبت" />}
            <h3 className={cx('font-bold text-ink', compact ? 'text-sm' : 'text-base')}>{a.title}</h3>
            {a.level !== 'info' && <Badge tone={st.tone}>{LEVEL_LABEL[a.level]}</Badge>}
            {!active && <Badge>منتهٍ</Badge>}
          </div>
          {actions}
        </div>
        {a.body && <p className={cx('mt-2 whitespace-pre-line leading-relaxed text-ink/90', compact ? 'line-clamp-2 text-sm' : 'text-[0.95rem]')}>{a.body}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>{a.created_by_name ?? '—'}</span>
          <span className="tabular-nums">{fmtDateTime(a.created_at)}</span>
          <span>{a.department_id ? `قسم ${s.deptById(a.department_id)?.name ?? ''}` : 'كل الأقسام'}</span>
          {!compact && <span>{AUDIENCE_LABEL[a.audience]}</span>}
          {a.expires_at && (
            <span className="flex items-center gap-1">
              <CalendarClock className="size-3.5" />
              حتى {fmtDate(a.expires_at)}
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}

function AnnouncementDialog({ item, onClose, onSaved }: { item: AnnouncementInput | null; onClose: () => void; onSaved: () => void }) {
  const s = useSession()
  const toast = useToast()
  const [f, setF] = useState<AnnouncementInput | null>(item)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const sup = isSuper(s.profile)
  if (!f) return null
  const set = <K extends keyof AnnouncementInput>(k: K, v: AnnouncementInput[K]) => setF((x) => (x ? { ...x, [k]: v } : x))

  const save = async () => {
    if (!f.title.trim()) return setErr('يرجى كتابة عنوان الإعلان')
    setBusy(true)
    setErr(null)
    try {
      await backend.saveAnnouncement(f)
      toast.success(f.id ? 'تم تحديث الإعلان' : 'تم نشر الإعلان')
      onSaved()
      onClose()
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      size="lg"
      title={f.id ? 'تعديل الإعلان' : 'إعلان جديد'}
      footer={
        <>
          <Button onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={busy} icon={<Megaphone className="size-4" />} onClick={save}>
            {f.id ? 'حفظ' : 'نشر الإعلان'}
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
        <Field label="العنوان">
          <Input value={f.title} maxLength={160} onChange={(e) => set('title', e.target.value)} placeholder="مثال: موعد تسليم درجات السعي الفصلي" />
        </Field>
        <Field label="نص الإعلان">
          <Textarea rows={5} value={f.body} onChange={(e) => set('body', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الأهمية">
            <Segmented<AnnouncementLevel>
              value={f.level}
              onChange={(v) => set('level', v)}
              options={(['info', 'important', 'urgent'] as const).map((v) => ({ value: v, label: LEVEL_LABEL[v] }))}
            />
          </Field>
          <Field label="الجهة">
            {sup ? (
              <Select value={f.department_id ?? ''} onChange={(e) => set('department_id', e.target.value || null)}>
                <option value="">كل الأقسام (إعلان عام للكلية)</option>
                {s.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    قسم {d.name}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="field flex h-[38px] items-center">قسم {s.deptById(f.department_id)?.name}</div>
            )}
          </Field>
          <Field label="يظهر لـ">
            <Select value={f.audience} onChange={(e) => set('audience', e.target.value as AnnouncementAudience)}>
              {(['all', 'teachers', 'heads'] as const).map((v) => (
                <option key={v} value={v}>
                  {AUDIENCE_LABEL[v]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ينتهي عرضه في (اختياري)">
            <Input
              type="date"
              dir="ltr"
              value={f.expires_at ? f.expires_at.slice(0, 10) : ''}
              onChange={(e) => set('expires_at', e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : null)}
            />
          </Field>
        </div>
        <Checkbox checked={f.pinned} onChange={(v) => set('pinned', v)} label="تثبيت الإعلان في أعلى القائمة" />
        <p className="text-xs text-muted">الإدارة واللجنة الامتحانية يرون كل الإعلانات. الإعلان «المهم» و«العاجل» يظهر في شريط بارز أعلى صفحات المستخدمين حتى يقرؤوه.</p>
        {err && <Callout tone="danger">{err}</Callout>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
