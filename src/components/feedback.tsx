import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Field, Input, Modal, Textarea, cx } from './ui'

// ---------------- التنبيهات المنبثقة ----------------
type ToastKind = 'success' | 'error' | 'info' | 'warning'
interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}
interface ToastApi {
  success: (t: string) => void
  error: (t: string | unknown) => void
  info: (t: string) => void
  warning: (t: string) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : 'حدث خطأ غير متوقع.'

// ---------------- مربعات التأكيد ----------------
export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  /** يطلب نصاً من المستخدم (مثل سبب الإعادة أو التعديل) */
  input?: { label: string; placeholder?: string; required?: boolean; multiline?: boolean; initial?: string }
  /** يطلب كتابة عبارة محددة لتأكيد العمليات الخطرة */
  typeToConfirm?: string
}
type ConfirmFn = (o: ConfirmOptions) => Promise<string | boolean>

const ConfirmCtx = createContext<ConfirmFn | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(0)
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-3), { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3800)
  }, [])
  const api = useMemo<ToastApi>(
    () => ({
      success: (t) => push('success', t),
      error: (t) => push('error', errorText(t)),
      info: (t) => push('info', t),
      warning: (t) => push('warning', t),
    }),
    [push],
  )

  const [dlg, setDlg] = useState<(ConfirmOptions & { resolve: (v: string | boolean) => void }) | null>(null)
  const [value, setValue] = useState('')
  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise((resolve) => {
        setValue(o.input?.initial ?? '')
        setDlg({ ...o, resolve })
      }),
    [],
  )
  const close = (v: string | boolean) => {
    dlg?.resolve(v)
    setDlg(null)
  }
  const needsValue = !!dlg?.input?.required && value.trim() === ''
  const typedOk = !dlg?.typeToConfirm || value.trim() === dlg.typeToConfirm
  const submit = () => {
    if (!dlg || needsValue || !typedOk) return
    close(dlg.input ? value.trim() : true)
  }

  return (
    <ToastCtx.Provider value={api}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <Modal
          open={!!dlg}
          onClose={() => close(false)}
          title={dlg?.title ?? ''}
          size="sm"
          footer={
            <>
              <Button onClick={() => close(false)}>{dlg?.cancelText ?? 'إلغاء'}</Button>
              <Button variant={dlg?.danger ? 'danger' : 'primary'} disabled={needsValue || !typedOk} onClick={submit} data-autofocus={!dlg?.input && !dlg?.typeToConfirm ? true : undefined}>
                {dlg?.confirmText ?? 'تأكيد'}
              </Button>
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
            className="space-y-3"
          >
            {dlg?.message && <div className="text-sm leading-7 text-muted">{dlg.message}</div>}
            {dlg?.input && (
              <Field label={dlg.input.label}>
                {dlg.input.multiline ? (
                  <Textarea value={value} placeholder={dlg.input.placeholder} onChange={(e) => setValue(e.target.value)} />
                ) : (
                  <Input value={value} placeholder={dlg.input.placeholder} onChange={(e) => setValue(e.target.value)} />
                )}
              </Field>
            )}
            {dlg?.typeToConfirm && (
              <Field label={<>للتأكيد اكتب: <b className="text-danger">{dlg.typeToConfirm}</b></>}>
                <Input value={value} onChange={(e) => setValue(e.target.value)} />
              </Field>
            )}
          </form>
        </Modal>
        <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:end-6 sm:w-96 no-print" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cx(
                'animate-toast pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-pop',
                'bg-surface border-line text-ink',
              )}
            >
              {t.kind === 'success' && <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-success" />}
              {t.kind === 'error' && <XCircle className="mt-0.5 size-4.5 shrink-0 text-danger" />}
              {t.kind === 'info' && <Info className="mt-0.5 size-4.5 shrink-0 text-info" />}
              {t.kind === 'warning' && <AlertTriangle className="mt-0.5 size-4.5 shrink-0 text-warning" />}
              <span className="leading-6">{t.text}</span>
            </div>
          ))}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastApi {
  const v = useContext(ToastCtx)
  if (!v) throw new Error('FeedbackProvider missing')
  return v
}

export function useConfirm(): ConfirmFn {
  const v = useContext(ConfirmCtx)
  if (!v) throw new Error('FeedbackProvider missing')
  return v
}
