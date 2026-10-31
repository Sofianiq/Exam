import { SHIFT_LABEL, stageLabel } from './labels'
import type { Department, Profile, Shift } from './types'

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return ''
  return Number(n.toFixed(digits)).toString()
}

export const fmtPct = (r: number | null | undefined) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`)

const dateFmt = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
const dateTimeFmt = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

export const fmtDate = (iso: string | Date | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '')
export const fmtTime = (iso: string | Date | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : '')
export const fmtDateTime = (iso: string | Date | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : '')

export function displayName(p: Pick<Profile, 'full_name' | 'title'> | null | undefined): string {
  if (!p) return ''
  return p.title ? `${p.title} ${p.full_name}` : p.full_name
}

export function classLabel(dept: Pick<Department, 'name'> | undefined, stage: number, shift: Shift) {
  return `${dept?.name ?? ''} — ${stageLabel(stage)} — ${SHIFT_LABEL[shift]}`
}

/** يعرض السنة بالترتيب الصحيح داخل النص العربي (عزل اتجاه النص) */
export const yearLabel = (label: string | undefined) => (label ? `\u2066${label.replace('-', ' - ')}\u2069` : '')

/** عدد الوحدات بصيغة عربية سليمة: وحدة واحدة، وحدتان، 3 وحدات، 11 وحدة */
export function unitsLabel(n: number | null | undefined): string {
  if (n == null) return ''
  if (n === 1) return 'وحدة واحدة'
  if (n === 2) return 'وحدتان'
  return n >= 3 && n <= 10 ? `${n} وحدات` : `${n} وحدة`
}
