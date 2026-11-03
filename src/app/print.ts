// محتوى الطباعة (النتائج الرسمية، الماستر شيت، سجل الدرجات) ثقيل، فلا يُرسم إلا عند الطباعة فعلاً.
// يُرسم بشكل متزامن في حدث beforeprint (زر الطباعة أو Ctrl+P) ويُزال بعد انتهاء الطباعة.
import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

let printing = false
const listeners = new Set<() => void>()
const set = (v: boolean) => {
  if (printing === v) return
  printing = v
  listeners.forEach((l) => l())
}

let installed = false
function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('beforeprint', () => flushSync(() => set(true)))
  window.addEventListener('afterprint', () => set(false))
  // احتياط للمتصفحات التي لا تطلق beforeprint/afterprint
  window.matchMedia?.('print').addEventListener?.('change', (e) => (e.matches ? flushSync(() => set(true)) : set(false)))
}

const subscribe = (l: () => void) => {
  install()
  listeners.add(l)
  return () => listeners.delete(l)
}

/** true أثناء الطباعة فقط */
export function usePrinting(): boolean {
  return useSyncExternalStore(subscribe, () => printing, () => false)
}

/** يطبع الصفحة بعد رسم محتوى الطباعة */
export function printPage() {
  install()
  flushSync(() => set(true))
  window.print()
}
