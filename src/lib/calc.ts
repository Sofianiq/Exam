import type { GradeBand, GradeComponent, GradeValues, R2Component, Rounding, Settings, SpecialCode, Subject } from './types'

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

/** توزيع الدرجة المقترح من الخطة الدراسية: مادة فيها ساعات عملية ← 40/25/35، وإلا ← نظري فقط 30/70 */
export function schemeForPlan(c: { practical_hours: number }) {
  return c.practical_hours > 0
    ? { coursework_max: 40, cw_practical_max: 15, practical_max: 25, label: 'نظري وعملي — 40/25/35' }
    : { coursework_max: 30, cw_practical_max: 0, practical_max: 0, label: 'نظري فقط — 30/70' }
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

/** مكوّن الدور الثاني المقابل لكل مكوّن من الامتحان النهائي */
export const R2_OF: Partial<Record<GradeComponent, R2Component>> = {
  final_practical: 'r2_final_practical',
  final_theory: 'r2_final_theory',
}

export interface RowResult {
  coursework: number | null
  finalSum: number | null
  /** مجموع الدور الأول */
  total: number | null
  complete: boolean
  missing: GradeComponent[]
  special: SpecialCode | null
  label: string | null
  passed: boolean | null
  /** الطالب غير ناجح في الدور الأول (رسوب أو حالة خاصة) فيحق له الدور الثاني */
  needsR2: boolean
  r2FinalSum: number | null
  r2Total: number | null
  r2Special: SpecialCode | null
  r2Complete: boolean
  /** النتيجة النهائية للمادة بعد الدور الثاني إن وُجد */
  finalTotal: number | null
  finalRound: 1 | 2
  finalSpecial: SpecialCode | null
  finalLabel: string | null
  finalPassed: boolean | null
}

type CalcSettings = Pick<Settings, 'pass_mark' | 'rounding' | 'grade_scale'> & Partial<Pick<Settings, 'second_round_cap'>>

export function computeRow(subject: Scheme, v: Partial<GradeValues> | undefined, settings: CalcSettings): RowResult {
  const comps = componentsOf(subject)
  const val = (k: GradeComponent | R2Component) => (v?.[k] ?? null) as number | null
  const missing = comps.filter((c) => val(c.key) == null).map((c) => c.key)
  const sumGroup = (g: 'coursework' | 'final', round: 1 | 2 = 1) => {
    const parts = comps.filter((c) => c.group === g)
    if (parts.length === 0) return 0
    const key = (c: ComponentDef) => (round === 2 ? (R2_OF[c.key] as R2Component) : c.key)
    if (parts.some((c) => val(key(c)) == null)) return null
    return round2(parts.reduce((acc, c) => acc + (val(key(c)) as number), 0))
  }
  const coursework = sumGroup('coursework')
  const finalSum = sumGroup('final')
  const special = v?.special ?? null
  const complete = special != null || missing.length === 0
  let total: number | null = null
  if (special == null && missing.length === 0 && coursework != null && finalSum != null) {
    total = applyRounding(coursework + finalSum, settings.rounding)
  }
  const passed = total != null ? total >= settings.pass_mark : special != null ? false : null

  // الدور الثاني: السعي ثابت ويُعاد الامتحان النهائي فقط
  const needsR2 = special != null || (total != null && total < settings.pass_mark)
  const r2Special = v?.r2_special ?? null
  const r2FinalSum = sumGroup('final', 2)
  const hasR2Values = comps.some((c) => c.group === 'final' && val(R2_OF[c.key] as R2Component) != null)
  let r2Total: number | null = null
  if (r2Special == null && coursework != null && r2FinalSum != null && hasR2Values) {
    const cap = special === 'postponed' ? 100 : (settings.second_round_cap ?? 100)
    r2Total = Math.min(applyRounding(coursework + r2FinalSum, settings.rounding), cap)
  }
  const r2Complete = r2Special != null || r2Total != null
  const useR2 = needsR2 && r2Complete
  const finalTotal = useR2 ? r2Total : total
  const finalSpecial = useR2 ? r2Special : special
  return {
    coursework: comps.some((c) => c.group === 'coursework') ? coursework : null,
    finalSum: comps.some((c) => c.group === 'final') ? finalSum : null,
    total,
    complete,
    missing: special != null ? [] : missing,
    special,
    label: total != null ? gradeLabel(total, settings.grade_scale) : null,
    passed,
    needsR2,
    r2FinalSum: hasR2Values ? r2FinalSum : null,
    r2Total,
    r2Special,
    r2Complete,
    finalTotal,
    finalRound: useR2 ? 2 : 1,
    finalSpecial,
    finalLabel: finalTotal != null ? gradeLabel(finalTotal, settings.grade_scale) : null,
    finalPassed: finalTotal != null ? finalTotal >= settings.pass_mark : finalSpecial != null ? false : null,
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

export type ResultStatus = 'none' | 'incomplete' | 'pass' | 'pass_r2' | 'carry' | 'fail'

export interface StudentSummary {
  /** مجموع الدرجات النهائية لكل المواد */
  sum: number | null
  /** المعدل: Σ(درجة × وحدات) ÷ Σ الوحدات، أو متوسط بسيط حسب الإعدادات */
  average: number | null
  averageLabel: string | null
  units: number
  passedCount: number
  /** المواد غير المجتازة في الدور الأول */
  r1Failed: string[]
  /** المواد غير المجتازة بعد الدور الثاني */
  finalFailed: string[]
  /** مواد ما زالت بانتظار نتيجة الدور الثاني */
  pendingR2: string[]
  missing: number
  status: ResultStatus
  statusText: string
}

type SummarySettings = Pick<Settings, 'pass_mark' | 'average_mode' | 'grade_scale'> & Partial<Pick<Settings, 'max_failed_subjects'>>

/**
 * نتيجة الطالب في مجموعة مواد (فصل أو سنة):
 * ناجح — أو مكمل (رسوب في عدد مواد لا يتجاوز الحد المسموح، مع ذكرها) — أو راسب (أكثر من الحد).
 */
export function summarizeStudent(
  subjects: { name: string; units: number | null }[],
  results: RowResult[],
  settings: SummarySettings,
): StudentSummary {
  const maxFailed = settings.max_failed_subjects ?? 2
  const nums: { v: number; u: number }[] = []
  results.forEach((r, i) => {
    if (r.finalTotal != null) nums.push({ v: r.finalTotal, u: subjects[i]?.units && subjects[i].units! > 0 ? subjects[i].units! : 1 })
  })
  const sum = nums.length ? round2(nums.reduce((a, n) => a + n.v, 0)) : null
  let average: number | null = null
  let units = 0
  if (nums.length) {
    units = nums.reduce((a, n) => a + n.u, 0)
    average =
      settings.average_mode === 'weighted'
        ? round2(nums.reduce((a, n) => a + n.v * n.u, 0) / units)
        : round2(nums.reduce((a, n) => a + n.v, 0) / nums.length)
  }
  const name = (i: number) => subjects[i]?.name ?? ''
  const r1Failed = results.flatMap((r, i) => (r.complete && r.needsR2 ? [name(i)] : []))
  const finalFailed = results.flatMap((r, i) => (r.complete && r.finalPassed === false ? [name(i)] : []))
  const pendingR2 = results.flatMap((r, i) => (r.needsR2 && !r.r2Complete ? [name(i)] : []))
  const missing = results.filter((r) => !r.complete).length
  const passedCount = results.filter((r) => r.finalPassed === true).length
  const any = results.some((r) => r.complete)

  let status: ResultStatus = 'none'
  let statusText = ''
  if (!any) status = 'none'
  else if (missing > 0) {
    status = 'incomplete'
    statusText = `النتيجة غير مكتملة (${missing} ${missing === 1 ? 'مادة' : 'مواد'})`
  } else if (r1Failed.length === 0) {
    status = 'pass'
    statusText = 'ناجح'
  } else if (r1Failed.length > maxFailed) {
    status = 'fail'
    statusText = 'راسب'
  } else if (pendingR2.length > 0) {
    status = 'carry'
    statusText = `مكمل في: ${r1Failed.join('، ')}`
  } else if (finalFailed.length === 0) {
    status = 'pass_r2'
    statusText = 'ناجح (الدور الثاني)'
  } else {
    status = 'fail'
    statusText = 'راسب'
  }
  return {
    sum,
    average,
    averageLabel: average != null ? gradeLabel(average, settings.grade_scale) : null,
    units,
    passedCount,
    r1Failed,
    finalFailed,
    pendingR2,
    missing,
    status,
    statusText,
  }
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
