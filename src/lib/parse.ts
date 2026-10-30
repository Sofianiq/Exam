import type { SpecialCode } from './types'

const toLatinDigits = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))

export const collapseSpaces = (s: string) => s.replace(/[\s\u00a0\u200e\u200f]+/g, ' ').trim()

/** تطبيع الاسم العربي لاكتشاف التكرار (لا يغيّر الاسم المحفوظ) */
export function normalizeArabic(s: string): string {
  return collapseSpaces(
    s
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // التشكيل والتطويل
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي'),
  )
}

const HAS_LETTERS = /[\p{L}]/u
const HEADER_WORDS = new Set(['ت', 'التسلسل', 'الاسم', 'الأسماء', 'اسم الطالب', 'اسم الطالبة', 'الاسم الرباعي', 'اسم الطالب الرباعي', 'name'])
const LEADING_NUMBER = /^[\s\d٠-٩۰-۹]+[\s.\-–)\]:،]*/

/**
 * يحوّل نصاً ملصوقاً (من Excel أو Word أو Google Sheets) إلى قائمة أسماء
 * مع الحفاظ على الترتيب كما هو. يقبل عموداً واحداً أو عمودين (ت + الاسم).
 */
export function parseNameList(text: string): string[] {
  const out: string[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const cells = rawLine.split('\t').map((c) => collapseSpaces(c))
    const named = cells.filter((c) => HAS_LETTERS.test(c))
    if (named.length === 0) continue
    let name = named.reduce((a, b) => (b.length > a.length ? b : a))
    name = collapseSpaces(name.replace(LEADING_NUMBER, ''))
    if (name && HAS_LETTERS.test(name) && !HEADER_WORDS.has(name.toLowerCase())) out.push(name)
  }
  return out
}

/** يقسم القائمة إلى أسماء جديدة ومكررة (ضمن القائمة نفسها أو موجودة مسبقاً) */
export function splitDuplicates(names: string[], existing: string[]) {
  const seen = new Set(existing.map(normalizeArabic))
  const fresh: string[] = []
  const dup: string[] = []
  for (const n of names) {
    const key = normalizeArabic(n)
    if (seen.has(key)) dup.push(n)
    else {
      seen.add(key)
      fresh.push(n)
    }
  }
  return { fresh, dup }
}

const SPECIAL_WORDS: Record<string, SpecialCode> = {
  غ: 'absent',
  غائب: 'absent',
  غياب: 'absent',
  'غ.': 'absent',
  abs: 'absent',
  absent: 'absent',
  م: 'postponed',
  مؤجل: 'postponed',
  مؤجلة: 'postponed',
  ح: 'banned',
  محروم: 'banned',
  محرومة: 'banned',
}

export type CellParse =
  | { kind: 'empty' }
  | { kind: 'number'; value: number }
  | { kind: 'special'; code: SpecialCode }
  | { kind: 'error'; message: string }

export function parseGradeInput(raw: string, max: number): CellParse {
  const s = toLatinDigits(collapseSpaces(raw)).replace('٫', '.').replace(',', '.')
  if (s === '' || s === '-' || s === '—') return { kind: 'empty' }
  const sp = SPECIAL_WORDS[s.toLowerCase()]
  if (sp) return { kind: 'special', code: sp }
  if (!/^\d+(\.\d+)?$/.test(s)) return { kind: 'error', message: 'قيمة غير رقمية' }
  const value = Number(s)
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return { kind: 'error', message: 'منزلتان عشريتان كحد أقصى' }
  if (value > max) return { kind: 'error', message: `الحد الأقصى ${max}` }
  return { kind: 'number', value }
}

/** يحوّل نص الحافظة (أعمدة مفصولة بـ Tab) إلى مصفوفة */
export function parseClipboardGrid(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, '\n').split('\n')
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop()
  return rows.map((r) => r.split('\t'))
}

export { toLatinDigits }
