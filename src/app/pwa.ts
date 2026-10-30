import { registerSW } from 'virtual:pwa-register'

// لا يُعاد تحميل الصفحة تلقائياً عند نشر إصدار جديد حتى لا تنقطع عملية إدخال الدرجات؛
// يظهر للمستخدم تنبيه ليحدّث متى شاء.
type Listener = () => void
const listeners = new Set<Listener>()
let available = false

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    available = true
    listeners.forEach((l) => l())
  },
})

export function onUpdateAvailable(cb: Listener): () => void {
  listeners.add(cb)
  if (available) cb()
  return () => listeners.delete(cb)
}

export const applyUpdate = () => updateSW(true)
