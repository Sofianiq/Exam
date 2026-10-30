import { useQueryClient } from '@tanstack/react-query'
import { Info, Lock, LockOpen, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useSession } from '../app/session'
import { useConfirm, useToast } from '../components/feedback'
import { Badge, Button, Callout, Card, CardHeader, PageHeader, Switch, cx } from '../components/ui'
import { backend } from '../data'
import { canToggleEntry } from '../lib/perm'
import { NotFoundPage } from './NotFoundPage'

export function ControlPage() {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  if (!canToggleEntry(s.profile)) return <NotFoundPage />
  const open = s.settings.entry_open

  const toggle = async (next: boolean, deptId?: string) => {
    const d = deptId ? s.deptById(deptId) : null
    const ok = await confirm({
      title: next ? 'فتح إدخال الدرجات' : 'غلق إدخال الدرجات',
      message: next
        ? `سيتمكن التدريسيون ومقررو الأقسام من إدخال وتعديل الدرجات ${d ? `في قسم ${d.name}` : 'في جميع الأقسام'}.`
        : `لن يتمكن أحد من إدخال أو تعديل الدرجات ${d ? `في قسم ${d.name}` : 'في جميع الأقسام'} باستثناء مدير النظام والعميد ومعاون العميد.`,
      confirmText: next ? 'فتح الإدخال' : 'غلق الإدخال',
      danger: !next,
    })
    if (!ok) return
    setBusy(deptId ?? 'all')
    try {
      await backend.setEntryOpen(next, deptId ?? null)
      await Promise.all([qc.invalidateQueries({ queryKey: ['settings'] }), qc.invalidateQueries({ queryKey: ['departments'] })])
      toast.success(next ? 'تم فتح إدخال الدرجات' : 'تم غلق إدخال الدرجات')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="التحكم بإدخال الدرجات" subtitle="فتح وغلق إدخال الدرجات بضغطة زر — صلاحية مدير النظام والعميد ومعاون العميد" />

      <Card className={cx('mb-6 overflow-hidden', open ? 'border-success/40' : 'border-danger/40')}>
        <div className={cx('flex flex-col items-center gap-5 px-6 py-8 text-center sm:flex-row sm:text-start', open ? 'bg-success-soft' : 'bg-danger-soft')}>
          <div className={cx('flex size-20 shrink-0 items-center justify-center rounded-full', open ? 'bg-success text-white' : 'bg-danger text-white')}>
            {open ? <LockOpen className="size-9" /> : <Lock className="size-9" />}
          </div>
          <div className="flex-1">
            <div className={cx('text-2xl font-bold', open ? 'text-success' : 'text-danger')}>{open ? 'إدخال الدرجات مفتوح' : 'إدخال الدرجات مغلق'}</div>
            <p className="mt-1 text-sm text-muted">
              {open ? 'التدريسيون ومقررو الأقسام يستطيعون إدخال الدرجات وتعديل القوائم غير المرسلة.' : 'جميع القوائم للعرض فقط لغير الإدارة العليا.'}
            </p>
          </div>
          <Button
            size="lg"
            variant={open ? 'danger' : 'success'}
            loading={busy === 'all'}
            icon={open ? <Lock className="size-5" /> : <LockOpen className="size-5" />}
            onClick={() => void toggle(!open)}
            className="min-w-48"
          >
            {open ? 'غلق الإدخال للجميع' : 'فتح الإدخال للجميع'}
          </Button>
        </div>
      </Card>

      <Card className="mb-6">
        <CardHeader title="التحكم حسب القسم" subtitle="يمكن غلق الإدخال لقسم معين مع إبقائه مفتوحاً لبقية الأقسام" />
        <ul className="divide-y divide-line">
          {s.departments.map((d) => {
            const effective = open && d.entry_open
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div>
                  <div className="font-medium">قسم {d.name}</div>
                  <div className="mt-0.5 text-xs">
                    {effective ? (
                      <Badge tone="success">مفتوح</Badge>
                    ) : !open ? (
                      <Badge tone="danger">مغلق (الغلق العام مفعل)</Badge>
                    ) : (
                      <Badge tone="danger">مغلق لهذا القسم</Badge>
                    )}
                  </div>
                </div>
                <Switch checked={d.entry_open} disabled={busy === d.id} onChange={(v) => void toggle(v, d.id)} label={`إدخال الدرجات — ${d.name}`} />
              </li>
            )
          })}
        </ul>
      </Card>

      <Callout tone="info" icon={<Info className="size-4.5" />} title="ماذا يحدث عند الغلق؟">
        <ul className="mt-1 list-disc space-y-1 ps-5">
          <li>لا يستطيع التدريسيون ومقررو الأقسام إدخال أو تعديل أي درجة، ولا إرسال القوائم.</li>
          <li>يبقى بإمكان مدير النظام والعميد ومعاون العميد التعديل، وتُسجَّل كل التعديلات في سجل العمليات.</li>
          <li>اللجنة الامتحانية تستطيع متابعة التدقيق والاعتماد بشكل طبيعي.</li>
          <li>
            <ShieldCheck className="inline size-4" /> القفل مطبق على مستوى قاعدة البيانات وليس الواجهة فقط.
          </li>
        </ul>
      </Callout>
    </div>
  )
}
