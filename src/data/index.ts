import type { Backend } from './backend'
import { DemoBackend } from './demoBackend'
import { SupabaseBackend } from './supabaseBackend'

// يقبل الرابط حتى لو نُسخ مع / أو /rest/v1 في نهايته
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/, '')
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** إذا لم تُضبط بيانات Supabase يعمل التطبيق في الوضع التجريبي داخل المتصفح */
export const backend: Backend = url && key ? new SupabaseBackend(url, key) : new DemoBackend()
export const isDemo = backend.mode === 'demo'
export { AppError } from './backend'
export type { Backend, SubjectFilter, StudentPatch } from './backend'
