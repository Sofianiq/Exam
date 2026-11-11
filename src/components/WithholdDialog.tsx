import { EyeOff, Eye } from 'lucide-react'
import { useState } from 'react'
import { useInvalidate } from '../app/queries'
import { backend } from '../data'
import { useToast } from './feedback'
import { Button, Callout, Field, Modal, Textarea } from './ui'

/** حجب نتيجة طالب مؤقتاً عن بوابة الطالب وصفحة التحقق، أو رفع الحجب */
export function WithholdDialog({
  student,
  onClose,
  onDone,
}: {
  student: { id: string; full_name: string; result_withheld?: boolean; withheld_reason?: string | null }
  onClose: () => void
  onDone?: () => unknown
}) {
  const toast = useToast()
  const invalidate = useInvalidate()
  const lifting = !!student.result_withheld
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      await backend.setResultWithheld(student.id, !lifting, lifting ? null : note)
      toast.success(lifting ? 'رُفع الحجب — عادت النتيجة ظاهرة للطالب' : 'حُجبت النتيجة عن بوابة الطالب وصفحة التحقق')
      await invalidate('student', 'students', 'portal', 'audit')
      await onDone?.()
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={lifting ? 'رفع حجب النتيجة' : 'حجب النتيجة مؤقتاً'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            إلغاء
          </Button>
          <Button variant={lifting ? 'primary' : 'danger'} icon={lifting ? <Eye className="size-4" /> : <EyeOff className="size-4" />} loading={busy} onClick={submit}>
            {lifting ? 'رفع الحجب' : 'حجب النتيجة'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          الطالب: <b>{student.full_name}</b>
        </p>
        {lifting ? (
          <>
            <p className="text-muted">ستعود نتيجة الطالب ورمز التحقق منها للظهور في بوابة الطالب وصفحة التحقق فوراً.</p>
            {student.withheld_reason && (
              <Callout tone="neutral" title="الملاحظة الظاهرة للطالب حالياً">
                {student.withheld_reason}
              </Callout>
            )}
          </>
        ) : (
          <>
            <ul className="list-disc space-y-1 ps-5 text-muted">
              <li>لا يرى الطالب نتيجته في بوابة الطالب، وتظهر له عبارة «النتيجة محجوبة مؤقتاً».</li>
              <li>صفحة التحقق برمز QR لا تعرض النتيجة.</li>
              <li>السعي المنشور يبقى ظاهراً، والدرجات داخل النظام لا تتغير.</li>
              <li>الأثر فوري دون إعادة نشر، ويمكن رفع الحجب في أي وقت.</li>
            </ul>
            <Field label="ملاحظة تظهر للطالب (اختياري)" hint="مثال: يرجى مراجعة اللجنة الامتحانية. لا تكتب ما لا تريد أن يقرأه الطالب.">
              <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="يرجى مراجعة اللجنة الامتحانية." />
            </Field>
          </>
        )}
      </div>
    </Modal>
  )
}
