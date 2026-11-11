// التحميل المسبق لصفحات القائمة: تُجلب ملفات الصفحة قبل فتحها (عند المرور على الرابط، ثم في وقت الفراغ)
// فيفتح التبويب فوراً دون شاشة انتظار
export const pages = {
  announcements: () => import('../pages/AnnouncementsPage'),
  audit: () => import('../pages/AuditPage'),
  control: () => import('../pages/ControlPage'),
  curriculum: () => import('../pages/CurriculumPage'),
  progress: () => import('../pages/ProgressPage'),
  resultsBatch: () => import('../pages/ResultsBatchPage'),
  results: () => import('../pages/ResultsPage'),
  settings: () => import('../pages/SettingsPage'),
  student: () => import('../pages/StudentPage'),
  studentsSearch: () => import('../pages/StudentsSearchPage'),
  users: () => import('../pages/UsersPage'),
  statistics: () => import('../pages/StatisticsPage'),
  portal: () => import('../pages/PortalPage'),
  verify: () => import('../pages/VerifyPage'),
}

const BY_PATH: Record<string, () => Promise<unknown>> = {
  '/announcements': pages.announcements,
  '/audit': pages.audit,
  '/control': pages.control,
  '/progress': pages.progress,
  '/results': pages.results,
  '/settings': pages.settings,
  '/students': pages.studentsSearch,
  '/users': pages.users,
  '/statistics': pages.statistics,
  '/portal': pages.portal,
}

const started = new Set<string>()

/** يجلب ملفات صفحة من القائمة مرة واحدة (لا أثر له إن كانت محمّلة أو ليست صفحة مؤجلة) */
export function preloadRoute(path: string): Promise<unknown> {
  const load = BY_PATH[path]
  if (!load || started.has(path)) return Promise.resolve()
  started.add(path)
  return load().catch(() => {
    started.delete(path)
  })
}

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
const whenIdle = (cb: () => void) => {
  const w = window as IdleWindow
  if (w.requestIdleCallback) w.requestIdleCallback(cb, { timeout: 4000 })
  else setTimeout(cb, 600)
}

/** يحمّل صفحات القائمة واحدة تلو الأخرى في وقت فراغ المتصفح (يُتجاوز عند تفعيل توفير البيانات) */
export function preloadWhenIdle(paths: string[]): () => void {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
  if (saveData) return () => {}
  let cancelled = false
  const queue = paths.filter((p) => BY_PATH[p] && !started.has(p))
  const next = () => {
    if (cancelled) return
    const p = queue.shift()
    if (!p) return
    whenIdle(() => {
      if (!cancelled) void preloadRoute(p).then(next)
    })
  }
  const t = setTimeout(next, 2500)
  return () => {
    cancelled = true
    clearTimeout(t)
  }
}
