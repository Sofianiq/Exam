import { useState } from 'react'
import { useSession } from '../app/session'
import { backend } from '../data'
import { errorText, useToast } from './feedback'
import { Button, Callout, Field, Input, Modal } from './ui'

export function ChangePasswordDialog({ open, forced, onClose }: { open: boolean; forced: boolean; onClose: () => void }) {
  const s = useSession()
  const toast = useToast()
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setErr(null)
    if (next.length < 6) return setErr('كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف')
    if (next !== again) return setErr('كلمتا المرور غير متطابقتين')
    if (next === cur) return setErr('اختر كلمة مرور مختلفة عن الحالية')
    setBusy(true)
    try {
      await backend.changeOwnPassword(cur, next)
      s.setProfile({ ...s.profile, must_change_password: false })
      toast.success('تم تغيير كلمة المرور بنجاح')
      setCur('')
      setNext('')
      setAgain('')
      onClose()
    } catch (e) {
      setErr(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={!forced}
      size="sm"
      title={forced ? 'تعيين كلمة مرور جديدة' : 'تغيير كلمة المرور'}
      footer={
        <>
          {forced ? (
            <Button variant="ghost" onClick={() => void s.signOut()}>
              تسجيل الخروج
            </Button>
          ) : (
            <Button onClick={onClose}>إلغاء</Button>
          )}
          <Button variant="primary" loading={busy} onClick={submit}>
            حفظ كلمة المرور
          </Button>
        </>
      }
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {forced && (
          <Callout tone="gold" title="مرحباً بك">
            لحماية حسابك يرجى تغيير كلمة المرور المؤقتة التي استلمتها قبل المتابعة.
          </Callout>
        )}
        <Field label="كلمة المرور الحالية">
          <Input type="password" autoComplete="current-password" dir="ltr" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label="كلمة المرور الجديدة" hint="6 أحرف على الأقل، ويفضل مزيج من الأحرف والأرقام">
          <Input type="password" autoComplete="new-password" dir="ltr" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="تأكيد كلمة المرور الجديدة" error={err}>
          <Input type="password" autoComplete="new-password" dir="ltr" value={again} onChange={(e) => setAgain(e.target.value)} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
