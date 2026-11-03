import { describe, expect, it } from 'vitest'
import { bandCounts, componentsOf, computeRow, rankDescending, sheetStats, summarizeStudent, type RowResult } from './calc'
import type { Settings } from './types'

const settings: Settings = {
  university_name: '',
  college_name: '',
  entry_open: true,
  pass_mark: 50,
  rounding: 'none',
  grade_scale: [
    { min: 90, label: 'امتياز' },
    { min: 80, label: 'جيد جداً' },
    { min: 70, label: 'جيد' },
    { min: 60, label: 'متوسط' },
    { min: 50, label: 'مقبول' },
    { min: 0, label: 'راسب' },
  ],
  average_mode: 'simple',
  idle_minutes: 60,
  hide_grades_when_closed: true,
  dean_name: null,
  committee_head_name: null,
  current_year_id: null,
  second_round_cap: null,
  max_failed_subjects: 2,
  second_round_deduction: 0,
}

// نفس توزيع سجل الدرجات الأصلي: السعي 40 (25 نظري + 15 عملي) + العملي النهائي 25 + النظري النهائي 35
const practical = { coursework_max: 40, cw_practical_max: 15, practical_max: 25, final_max: 35 }
// مادة نظرية فقط: السعي 30 + الامتحان النهائي 70
const theory = { coursework_max: 30, cw_practical_max: 0, practical_max: 0, final_max: 70 }
const g = (cw_theory: number | null, cw_practical: number | null, final_practical: number | null, final_theory: number | null) => ({
  cw_theory,
  cw_practical,
  final_practical,
  final_theory,
  special: null,
  note: null,
})

describe('componentsOf', () => {
  it('lists the four components of a practical subject with correct maxima', () => {
    expect(componentsOf(practical).map((c) => [c.key, c.max])).toEqual([
      ['cw_theory', 25],
      ['cw_practical', 15],
      ['final_practical', 25],
      ['final_theory', 35],
    ])
  })
  it('lists only coursework and final exam for theory-only subjects', () => {
    expect(componentsOf(theory).map((c) => [c.key, c.max, c.label])).toEqual([
      ['cw_theory', 30, 'السعي الفصلي'],
      ['final_theory', 70, 'الامتحان النهائي'],
    ])
  })
})

describe('computeRow', () => {
  it('matches the spreadsheet formulas (row 1 of the sample sheet)', () => {
    const r = computeRow(practical, g(21, 15, 21, 27), settings)
    expect(r.coursework).toBe(36)
    expect(r.finalSum).toBe(48)
    expect(r.total).toBe(84)
    expect(r.label).toBe('جيد جداً')
    expect(r.passed).toBe(true)
  })
  it('shows partial coursework while the final is still missing', () => {
    const r = computeRow(practical, g(17, 13, null, null), settings)
    expect(r.coursework).toBe(30)
    expect(r.finalSum).toBeNull()
    expect(r.total).toBeNull()
    expect(r.complete).toBe(false)
    expect(r.missing).toEqual(['final_practical', 'final_theory'])
  })
  it('handles theory-only subjects (30 + 70)', () => {
    const r = computeRow(theory, g(30, null, null, 57), settings)
    expect(r.total).toBe(87)
    expect(r.label).toBe('جيد جداً')
  })
  it('marks failures below the pass mark', () => {
    const r = computeRow(theory, g(10, null, null, 39), settings)
    expect(r.total).toBe(49)
    expect(r.passed).toBe(false)
    expect(r.label).toBe('راسب')
  })
  it('applies rounding modes', () => {
    expect(computeRow(theory, g(10.5, null, null, 39), { ...settings, rounding: 'round' }).total).toBe(50)
    expect(computeRow(theory, g(10.25, null, null, 39), { ...settings, rounding: 'ceil' }).total).toBe(50)
    expect(computeRow(theory, g(10.25, null, null, 39), settings).total).toBe(49.25)
  })
  it('avoids floating point drift', () => {
    expect(computeRow(theory, g(10.1, null, null, 39.2), settings).total).toBe(49.3)
  })
  it('does not convert special cases to zero', () => {
    const r = computeRow(theory, { ...g(20, null, null, null), special: 'absent' }, settings)
    expect(r.total).toBeNull()
    expect(r.complete).toBe(true)
    expect(r.special).toBe('absent')
    expect(r.passed).toBe(false)
  })
})

describe('ministerial subjects (تقويمية)', () => {
  const ministerial = { coursework_max: 40, cw_practical_max: 0, practical_max: 0, final_max: 60, final_min: 30 }
  it('fails a student below 30/60 in the final even when the total is ≥ 50', () => {
    const r = computeRow(ministerial, g(35, null, null, 29), settings)
    expect(r.total).toBe(64)
    expect(r.passed).toBe(false)
    expect(r.belowFinalMin).toBe(true)
    expect(r.label).toBe('راسب')
    expect(r.needsR2).toBe(true)
    expect(r.finalPassed).toBe(false)
  })
  it('passes with exactly 30/60 in the final', () => {
    const r = computeRow(ministerial, g(20, null, null, 30), settings)
    expect(r).toMatchObject({ total: 50, passed: true, belowFinalMin: false, label: 'مقبول' })
  })
  it('applies the same condition in the second round', () => {
    const r = computeRow(ministerial, { ...g(35, null, null, 29), r2_final_theory: 28 }, settings)
    expect(r).toMatchObject({ finalRound: 2, finalTotal: 63, finalPassed: false, finalBelowMin: true })
    const ok = computeRow(ministerial, { ...g(35, null, null, 29), r2_final_theory: 31 }, settings)
    expect(ok).toMatchObject({ finalTotal: 66, finalPassed: true, finalLabel: 'متوسط' })
  })
  it('counts a ministerial failure as a failed subject in the summary and statistics', () => {
    const r = computeRow(ministerial, g(35, null, null, 29), settings)
    expect(sheetStats([r])).toMatchObject({ pass: 0, fail: 1 })
    const sum = summarizeStudent([{ name: 'وزارية', units: 3 }], [r], settings)
    expect(sum.r1Failed).toEqual(['وزارية'])
  })
})

describe('statistics', () => {
  it('computes sheet statistics', () => {
    const rows = [g(20, null, null, 60), g(10, null, null, 30), g(25, null, null, 70), g(null, null, null, null)].map((v) => computeRow(theory, v, settings))
    const s = sheetStats(rows)
    expect(s).toMatchObject({ count: 4, complete: 3, graded: 3, pass: 2, fail: 1, max: 95, min: 40, avg: 71.67 })
  })
  it('ranks with ties like Excel RANK', () => {
    expect(rankDescending([80, 90, 80, null, 70])).toEqual([2, 1, 2, null, 4])
  })
  it('counts grade bands', () => {
    const b = bandCounts([95, 85, 72, 50, 49, null], settings.grade_scale)
    expect(b.map((x) => x.count)).toEqual([1, 1, 1, 0, 1, 1])
    expect(b[0].upper).toBe(100)
    expect(b[1].upper).toBe(89)
  })
})

describe('second round (coursework fixed)', () => {
  const failed = { ...g(10, 5, 10, 15), r2_final_practical: 18, r2_final_theory: 25, r2_special: null }
  it('replaces only the final exam and keeps the coursework', () => {
    const r = computeRow(practical, failed, settings)
    expect(r.total).toBe(40)
    expect(r.needsR2).toBe(true)
    expect(r.r2Total).toBe(15 + 18 + 25)
    expect(r.finalTotal).toBe(58)
    expect(r.finalRound).toBe(2)
    expect(r.finalPassed).toBe(true)
    expect(r.finalLabel).toBe('مقبول')
  })
  it('ignores round-2 values for students who passed round 1', () => {
    const r = computeRow(practical, { ...g(20, 12, 20, 30), r2_final_theory: 10, r2_final_practical: 10 }, settings)
    expect(r.needsR2).toBe(false)
    expect(r.finalTotal).toBe(82)
    expect(r.finalRound).toBe(1)
  })
  it('lets absent students sit round 2 and applies the optional cap', () => {
    const absent = { ...g(20, null, null, null), special: 'absent' as const, r2_final_theory: 60 }
    expect(computeRow(theory, absent, settings).finalTotal).toBe(80)
    expect(computeRow(theory, absent, { ...settings, second_round_cap: 50 }).finalTotal).toBe(50)
    const postponed = { ...absent, special: 'postponed' as const }
    expect(computeRow(theory, postponed, { ...settings, second_round_cap: 50 }).finalTotal).toBe(80)
  })
})

describe('decision marks, round-2 deduction and overrides (legacy rules)', () => {
  const ded = { ...settings, second_round_deduction: 10 }
  const legacy = { coursework_max: 40, cw_practical_max: 0, practical_max: 0, final_max: 60 }
  it('adds decision marks to the total and flags the pass as «بقرار»', () => {
    const r = computeRow(legacy, { cw_theory: 30, final_theory: 17, decision: 3 }, settings)
    expect(r).toMatchObject({ total: 50, passed: true, finalPassed: true, decision: 3, byDecision: true })
    const plain = computeRow(legacy, { cw_theory: 30, final_theory: 25 }, settings)
    expect(plain).toMatchObject({ total: 55, byDecision: false, decision: null })
  })
  it('deducts 10 marks from round-2 passers without going below the pass mark', () => {
    const base = { cw_theory: 20, final_theory: 10 }
    expect(computeRow(legacy, { ...base, r2_final_theory: 50 }, ded)).toMatchObject({ r2Raw: 70, r2Total: 60, finalTotal: 60, finalPassed: true })
    expect(computeRow(legacy, { ...base, r2_final_theory: 35 }, ded)).toMatchObject({ r2Raw: 55, r2Total: 50, finalTotal: 50 })
    // الراسب في الدور الثاني لا يُخصم منه
    expect(computeRow(legacy, { ...base, r2_final_theory: 20 }, ded)).toMatchObject({ r2Raw: 40, r2Total: 40, finalPassed: false })
    // خصم خاص بالمادة يتقدم على الإعداد العام
    expect(computeRow({ ...legacy, r2_deduction: 0 }, { ...base, r2_final_theory: 50 }, ded).finalTotal).toBe(70)
  })
  it('does not deduct from postponed students (their round 2 counts as round 1)', () => {
    const r = computeRow(legacy, { cw_theory: 20, special: 'postponed', r2_final_theory: 50 }, ded)
    expect(r).toMatchObject({ r2Total: 70, finalTotal: 70, finalRound: 2 })
  })
  it('applies round-2 decision marks and the deduction to absent/banned students', () => {
    const r = computeRow(legacy, { cw_theory: 20, special: 'banned', r2_final_theory: 28, r2_decision: 2 }, ded)
    expect(r).toMatchObject({ r2Raw: 50, r2Total: 50, finalPassed: true, byDecision: true, decision: 2 })
  })
  it('uses a fixed final mark (settlement) over the computed one', () => {
    const r = computeRow(legacy, { cw_theory: 20, final_theory: 10, final_override: 64 }, ded)
    expect(r).toMatchObject({ total: 30, finalTotal: 64, finalPassed: true, overridden: true, finalLabel: 'متوسط' })
    const z = computeRow(legacy, { special: 'absent', final_override: 0 }, ded)
    expect(z).toMatchObject({ finalTotal: 0, finalSpecial: null, finalPassed: false })
  })
})

describe('student result', () => {
  const R = (finalTotal: number | null, opts: Partial<RowResult> = {}): RowResult =>
    ({
      complete: true,
      needsR2: finalTotal != null && finalTotal < 50,
      r2Complete: false,
      finalTotal,
      finalPassed: finalTotal == null ? null : finalTotal >= 50,
      ...opts,
    }) as RowResult
  const subs = [
    { name: 'المادة أ', units: 3 },
    { name: 'المادة ب', units: 2 },
    { name: 'المادة ج', units: 4 },
  ]
  it('computes the weighted average exactly as in the example (82.22)', () => {
    const s = summarizeStudent(subs, [R(80), R(70), R(90)], { ...settings, average_mode: 'weighted' })
    expect(s.sum).toBe(240)
    expect(s.average).toBe(82.22)
    expect(s.averageLabel).toBe('جيد جداً')
    expect(s.status).toBe('pass')
    expect(s.statusText).toBe('ناجح')
  })
  it('supports a simple average when configured', () => {
    expect(summarizeStudent(subs, [R(80), R(70), R(90)], { ...settings, average_mode: 'simple' }).average).toBe(80)
  })
  it('marks مكمل with the subject names when failing up to two subjects', () => {
    const s = summarizeStudent(subs, [R(80), R(40), R(45)], settings)
    expect(s.status).toBe('carry')
    expect(s.statusText).toBe('مكمل في: المادة ب، المادة ج')
  })
  it('keeps the student مكمل after round 1 whatever the number of failed subjects (as in the previous system)', () => {
    const four = [...subs, { name: 'المادة د', units: 1 }]
    const s = summarizeStudent(four, [R(30), R(40), R(45), R(90)], settings)
    expect(s.status).toBe('carry')
    expect(s.statusText).toBe('مكمل في: المادة أ، المادة ب، المادة ج')
  })
  it('decides راسب / ناجح بالتحميل only after round 2', () => {
    const still = (t: number) => R(t, { needsR2: true, r2Complete: true, finalPassed: false })
    const four = [...subs, { name: 'المادة د', units: 1 }]
    // فصل دراسي: أي رسوب بعد الدور الثاني = راسب
    expect(summarizeStudent(subs, [still(40), R(70), R(90)], settings).status).toBe('fail')
    // النتيجة السنوية: مادتان أو أقل = ناجح بالتحميل
    const two = summarizeStudent(four, [still(40), still(30), R(70), R(90)], settings, 'annual')
    expect(two.status).toBe('pass_carry')
    expect(two.statusText).toBe('ناجح بالتحميل (المادة أ، المادة ب)')
    // أكثر من الحد = راسب
    expect(summarizeStudent(four, [still(40), still(30), still(20), R(90)], settings, 'annual').status).toBe('fail')
    expect(summarizeStudent(four, [still(40), still(30), still(20), R(90)], { ...settings, max_failed_subjects: 3 }, 'annual').status).toBe('pass_carry')
  })
  it('labels students who passed by decision marks', () => {
    const s = summarizeStudent(subs, [R(80), R(50, { byDecision: true }), R(90)], settings)
    expect(s).toMatchObject({ status: 'pass', statusText: 'ناجح بقرار', byDecision: ['المادة ب'] })
  })
  it('passes after round 2 when the carried subjects are passed', () => {
    const viaR2 = R(60, { needsR2: true, r2Complete: true, finalRound: 2 })
    const s = summarizeStudent(subs, [R(80), viaR2, R(90)], settings)
    expect(s.status).toBe('pass_r2')
    expect(s.statusText).toBe('ناجح (الدور الثاني)')
  })
  it('fails after round 2 when a carried subject is still failed', () => {
    const stillFail = R(40, { needsR2: true, r2Complete: true, finalPassed: false })
    expect(summarizeStudent(subs, [R(80), stillFail, R(90)], settings).status).toBe('fail')
  })
  it('reports incomplete results', () => {
    const s = summarizeStudent(subs, [R(80), R(null, { complete: false, needsR2: false }), R(90)], settings)
    expect(s.status).toBe('incomplete')
  })
})
