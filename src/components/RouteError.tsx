import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useEffect } from 'react'
import { useRouteError } from 'react-router-dom'

const RELOAD_KEY = 'exam.chunk-reload'
const isChunkError = (e: unknown) => /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|Loading chunk/i.test(String((e as Error)?.message ?? e))

/** صفحة خطأ ودية بدل شاشة الخطأ الافتراضية. عند فشل تحميل جزء من التطبيق (بعد نشر إصدار جديد) يُعاد التحميل تلقائياً مرة واحدة */
export function RouteError() {
  const error = useRouteError()
  const chunk = isChunkError(error)
  useEffect(() => {
    if (!chunk) return
    try {
      if (sessionStorage.getItem(RELOAD_KEY)) return
      sessionStorage.setItem(RELOAD_KEY, '1')
    } catch {
      return
    }
    window.location.reload()
  }, [chunk])
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="card max-w-md p-6 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-warning-soft text-warning">
          <AlertTriangle className="size-6" />
        </div>
        <h2 className="text-lg font-semibold">{chunk ? 'يتوفر إصدار أحدث من النظام' : 'حدث خطأ غير متوقع في هذه الصفحة'}</h2>
        <p className="mt-1 text-sm text-muted">
          {chunk ? 'يُعاد تحميل الصفحة لتحديث النظام…' : 'لم تتأثر بياناتك. أعد تحميل الصفحة، وإذا تكرر الخطأ أبلغ مدير النظام.'}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-hover"
        >
          <RotateCcw className="size-4" />
          إعادة التحميل
        </button>
      </div>
    </div>
  )
}

/** يُستدعى بعد نجاح تحميل التطبيق ليسمح بإعادة تحميل تلقائية لاحقاً عند الحاجة */
export function clearChunkReloadFlag() {
  try {
    sessionStorage.removeItem(RELOAD_KEY)
  } catch {
    /* ignore */
  }
}
