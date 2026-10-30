import type { GradeBand, GradeComponent, GradeValues, Rounding, Settings, SpecialCode, Subject } from './types'

export type Scheme = Pick<Subject, 'coursework_max' | 'cw_practical_max' | 'practical_max' | 'final_max'>

export interface ComponentDef {
  key: GradeComponent
  label: string
  group: 'coursework' | 'final'
  max: number
}

export const cwTheoryMax = (s: Scheme) => round2(s.coursework_max - s.cw_practical_max)

/** المكونات الفعالة لمادة ما بالترتيب المعروض في الجدول */
export function componentsOf(s: Scheme): ComponentDef[] {
  const out: ComponentDef[] = []
  const split = s.cw_practical_max > 0
  if (cwTheoryMax(s) > 0) {
    out.push({ key: 'cw_theory', label: split ? 'السعي النظري' : 'السعي الفصلي', group: 'coursework', max: cwTheoryMax(s) })
  }
  if (split) out.push({ key: 'cw_practical', label: 'السعي العملي', group: 'coursework', max: s.cw_practical_max })
  if (s.practical_max > 0) {
    out.push({ key: 'final_practical', label: 'العملي النهائي', group: 'final', max: s.practical_max })
  }
  if (s.final_max > 0) {
    out.push({
      key: 'final_theory',
      label: s.practical_max > 0 ? 'النظري النهائي' : 'الامتحان النهائي',
      group: 'final',
      max: s.final_max,
    })
  }
  return out
}

export const finalMaxOf = (coursework: number, practical: number) => round2(100 - coursework - practical)

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100
}

export function applyRounding(x: number, mode: Rounding): number {
  const v = round2(x)
  if (mode === 'round') return Math.round(v)
  if (mode === 'ceil') return Math.ceil(v)
  return v
}

export function gradeLabel(total: number | null, scale: GradeBand[]): string | null {
  if (total == null) return null
  const sorted = [...scale].sort((a, b) => b.min - a.min)
  for (const band of sorted) if (total >= band.min) return band.label
  return sorted[sorted.length - 1]?.label ?? null
}

export interface RowResult {
  coursework: number | null
  finalSum: number | null
  total: number | null
  complete: boolean
  missing: GradeComponent[]
  special: SpecialCode | null
  label: string | null
  passed: boolean | null
}

type CalcSettings = Pick<Settings, 'pass_mark' | 'rounding' | 'grade_scale'>

export function computeRow(subject: Scheme, v: Partial<GradeValues> | undefined, settings: CalcSettings): RowResult {
  const comps = componentsOf(subject)
  const val = (k: GradeComponent) => (v?.[k] ?? null) as number | null
  const missing = comps.filter((c) => val(c.key) == null).map((c) => c.key)
  const sumGroup = (g: 'coursework' | 'final') => {
    const parts = comps.filter((c) => c.group === g)
    if (parts.length === 0) return 0
    if (parts.some((c) => val(c.key) == null)) return null
    return round2(parts.reduce((acc, c) => acc + (val(c.key) as number), 0))
  }
  const coursework = sumGroup('coursework')
  const finalSum = sumGroup('final')
  const special = v?.special ?? null
  const complete = special != null || missing.length === 0
  let total: number | null = null
  if (special == null && missing.length === 0 && coursework != null && finalSum != null) {
    total = applyRounding(coursework + finalSum, settings.rounding)
  }
  return {
    coursework: comps.some((c) => c.group === 'coursework') ? coursework : null,
    finalSum: comps.some((c) => c.group === 'final') ? finalSum : null,
    total,
    complete,
    missing: special != null ? [] : missing,
    special,
    label: total != null ? gradeLabel(total, settings.grade_scale) : null,
    passed: total != null ? total >= settings.pass_mark : special != null ? false : null,
  }
}

export interface SheetStats {
  count: number
  complete: number
  graded: number
  pass: number
  fail: number
  special: number
  max: number | null
  min: number | null
  avg: number | null
  passRate: number | null
}

export function sheetStats(results: RowResult[], passMark: number): SheetStats {
  const totals = results.map((r) => r.total).filter((t): t is number => t != null)
  const pass = totals.filter((t) => t >= passMark).length
  return {
    count: results.length,
    complete: results.filter((r) => r.complete).length,
    graded: totals.length,
    pass,
    fail: totals.length - pass,
    special: results.filter((r) => r.special != null).length,
    max: totals.length ? Math.max(...totals) : null,
    min: totals.length ? Math.min(...totals) : null,
    avg: totals.length ? round2(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
    passRate: totals.length ? pass / totals.length : null,
  }
}

/** ترتيب تنافسي (1، 2، 2، 4) تنازلياً — القيم الفارغة بلا ترتيب */
export function rankDescending(values: (number | null)[]): (number | null)[] {
  return values.map((v) => (v == null ? null : values.filter((o) => o != null && o > v).length + 1))
}

export type MasterCell = { total: number | null; special: SpecialCode | null; complete: boolean }

export interface MasterRow {
  cells: MasterCell[]
  average: number | null
  passed: number
  failed: number
  specials: number
  missing: number
  status: string
}

export function masterRow(
  cells: MasterCell[],
  units: (number | null)[],
  settings: Pick<Settings, 'pass_mark' | 'average_mode'>,
): MasterRow {
  const nums: { v: number; u: number | null }[] = []
  cells.forEach((c, i) => {
    if (c.total != null) nums.push({ v: c.total, u: units[i] ?? null })
  })
  let average: number | null = null
  if (nums.length) {
    const weighted = settings.average_mode === 'weighted' && nums.every((n) => n.u != null && n.u > 0)
    if (weighted) {
      const w = nums.reduce((a, n) => a + (n.u as number), 0)
      average = round2(nums.reduce((a, n) => a + n.v * (n.u as number), 0) / w)
    } else {
      average = round2(nums.reduce((a, n) => a + n.v, 0) / nums.length)
    }
  }
  const passed = nums.filter((n) => n.v >= settings.pass_mark).length
  const failed = nums.length - passed
  const specials = cells.filter((c) => c.special != null).length
  const missing = cells.filter((c) => !c.complete).length
  let status = ''
  if (nums.length || specials) {
    const parts: string[] = []
    if (failed > 0) parts.push(`راسب في ${failed} ${failed === 1 ? 'مادة' : 'مواد'}`)
    if (specials > 0) parts.push(`حالة خاصة (${specials})`)
    if (missing > 0) parts.push(`غير مكتمل (${missing})`)
    status = parts.length ? parts.join('، ') : 'ناجح في جميع المواد'
  }
  return { cells, average, passed, failed, specials, missing, status }
}

export function bandCounts(values: (number | null)[], scale: GradeBand[]) {
  const sorted = [...scale].sort((a, b) => b.min - a.min)
  return sorted.map((band, i) => {
    const upper = i === 0 ? Infinity : sorted[i - 1].min
    return {
      ...band,
      upper: i === 0 ? 100 : upper - 1,
      count: values.filter((v) => v != null && v >= band.min && v < upper).length,
    }
  })
}
