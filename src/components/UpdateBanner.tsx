import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { applyUpdate, onUpdateAvailable } from '../app/pwa'
import { Button } from './ui'

export function UpdateBanner() {
  const [show, setShow] = useState(false)
  useEffect(() => onUpdateAvailable(() => setShow(true)), [])
  if (!show) return null
  return (
    <div className="no-print fixed inset-x-4 bottom-4 z-[70] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-primary/30 bg-surface px-4 py-3 shadow-pop sm:start-6 sm:end-auto">
      <RefreshCw className="size-5 shrink-0 text-primary-text" />
      <div className="flex-1 text-sm">
        <b>يتوفر إصدار جديد من النظام</b>
        <div className="text-xs text-muted">احفظ عملك ثم اضغط تحديث.</div>
      </div>
      <Button size="sm" variant="primary" onClick={() => void applyUpdate()}>
        تحديث
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setShow(false)}>
        لاحقاً
      </Button>
    </div>
  )
}
