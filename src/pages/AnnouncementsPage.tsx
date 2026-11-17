import { useQueryClient } from '@tanstack/react-query'
import { Megaphone, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AUDIENCE_LABEL, LEVEL_LABEL, canEditAnnouncement, canPublishAnnouncements, useAnnouncements, useSeenAnnouncements } from '../app/announcements'
import { useSession } from '../app/session'
import { errorText, useConfirm, useToast } from '../components/feedback'
import { Button, Callout, Card, Checkbox, EmptyState, Field, IconButton, Input, LoadingBlock, Modal, PageHeader, Segmented, Select, Textarea } from '../components/ui'
import { backend } from '../data'
import { isSuper } from '../lib/perm'
import type { Announcement, AnnouncementAudience, AnnouncementInput, AnnouncementLevel } from '../lib/types'
import { AnnouncementCard } from '../components/AnnouncementCard'


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
              {(['all', 'teachers', 'heads', 'students'] as const).map((v) => (
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
