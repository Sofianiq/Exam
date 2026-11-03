/// <reference types="node" />
// تحقق اختياري على ملفات النظام السابق الحقيقية (لا تُرفع إلى المستودع):
// LEGACY_DIR=/path/to/files npx vitest run src/lib/legacy.real.test.ts
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeLegacy, compactPayload, parseLegacyWorkbook, readWorkbook, LEGACY_RULES, type LegacyFile } from './legacy'
import type { Department } from './types'

const DIR = process.env.LEGACY_DIR
const dept = (id: string, name: string, code: string): Department => ({ id, name, code, has_evening: true, stages: 4, entry_open: true, sort: 0, head_name: null })
const departments = [
  dept('d-ans', 'تقنيات التخدير', 'ANS'),
  dept('d-rad', 'تقنيات الأشعة والسونار', 'RAD'),
  dept('d-den', 'تقنيات صناعة الأسنان', 'DEN'),
  dept('d-cht', 'تقنيات صحة المجتمع', 'CHT'),
  dept('d-cos', 'تقنيات التجميل والليزر', 'COS'),
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n: string) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.xlsx$/i.test(n) ? [p] : []
  })
}

describe.skipIf(!DIR)('legacy migration on real files', () => {
  it('parses, reconciles and builds payloads without mismatches', async () => {
    const files: LegacyFile[] = []
    for (const p of walk(DIR!)) {
      const b = readFileSync(p)
      const wb = await readWorkbook(p, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
      const f = parseLegacyWorkbook(wb)
      if (f) files.push(f)
    }
    const a = analyzeLegacy(files, {
      departments,
      settings: { pass_mark: 50, rounding: 'round', grade_scale: LEGACY_RULES.scale, average_mode: 'weighted', max_failed_subjects: 2, second_round_cap: null },
    })
    const out: string[] = [`files ${a.totals.files} classes ${a.classes.length} students ${a.totals.students} records ${a.totals.records} excluded ${a.totals.excluded} fixed ${a.totals.fixed}`]
    for (const i of a.issues) out.push(`  [global ${i.level}] ${i.message}`)
    for (const c of a.classes) {
      const by = (l: string) => c.issues.filter((i) => i.level === l).length
      out.push(`${c.key} st=${c.stats.students} ex=${c.stats.excluded} rec=${c.stats.records} dec=${c.stats.decisions} r2=${c.stats.r2} fix=${c.stats.fixed} inf=${c.stats.inferred} chk=${c.stats.checkedStudents}/${c.stats.checkedAnnual} E=${by('error')} M=${by('mismatch')} W=${by('warning')}`)
      const fixes = new Map<string, number>()
      for (const f of c.fixed) fixes.set(f.reason, (fixes.get(f.reason) ?? 0) + 1)
      if (fixes.size) out.push(`   fixes ${[...fixes].map(([k, v]) => `${k}:${v}`).join(' ')}`)
      for (const f of c.fixed.filter(() => process.env.LEGACY_FIXES)) out.push(`     fix ${f.reason} ${f.subject} legacy=${f.legacyFinal} computed=${f.computed}`)
      for (const i of c.issues.filter((x) => x.level !== 'info').slice(0, 12)) out.push(`   - ${i.level} ${i.subject ?? ''} ${i.message}`)
    }
    console.log(out.join('\n'))
    // LEGACY_DUMP=/path/payloads.json يحفظ حمولات الترحيل لاختبارها على قاعدة البيانات
    if (process.env.LEGACY_DUMP) writeFileSync(process.env.LEGACY_DUMP, JSON.stringify(a.classes.map((c) => c.payload && compactPayload(c.payload))))
    expect(a.classes.flatMap((c) => c.issues.filter((i) => i.level === 'error' || i.level === 'mismatch'))).toEqual([])
    expect(a.issues.filter((i) => i.level === 'error')).toEqual([])
  }, 120_000)
})
