import type { Backend } from './backend'
import { DemoBackend } from './demoBackend'
import { SupabaseBackend } from './supabaseBackend'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** إذا لم تُضبط بيانات Supabase يعمل التطبيق في الوضع التجريبي داخل المتصفح */
export const backend: Backend = url && key ? new SupabaseBackend(url, key) : new DemoBackend()
export const isDemo = backend.mode === 'demo'
export { AppError } from './backend'
export type { Backend, SubjectFilter, StudentPatch } from './backend'
