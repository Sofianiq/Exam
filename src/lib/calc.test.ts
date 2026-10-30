import { describe, expect, it } from 'vitest'
import { bandCounts, componentsOf, computeRow, masterRow, rankDescending, sheetStats } from './calc'
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
  current_year_id: null,
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

describe('statistics', () => {
  it('computes sheet statistics', () => {
    const rows = [g(20, null, null, 60), g(10, null, null, 30), g(25, null, null, 70), g(null, null, null, null)].map((v) => computeRow(theory, v, settings))
    const s = sheetStats(rows, 50)
    expect(s).toMatchObject({ count: 4, complete: 3, graded: 3, pass: 2, fail: 1, max: 95, min: 40, avg: 71.67 })
  })
  it('ranks with ties like Excel RANK', () => {
    expect(rankDescending([80, 90, 80, null, 70])).toEqual([2, 1, 2, null, 4])
  })
  it('builds master rows with status text', () => {
    const m = masterRow(
      [
        { total: 70, special: null, complete: true },
        { total: 40, special: null, complete: true },
        { total: null, special: 'absent', complete: true },
      ],
      [3, 3, 2],
      settings,
    )
    expect(m.average).toBe(55)
    expect(m.passed).toBe(1)
    expect(m.failed).toBe(1)
    expect(m.status).toBe('راسب في 1 مادة، حالة خاصة (1)')
    expect(masterRow([{ total: 70, special: null, complete: true }], [2], settings).status).toBe('ناجح في جميع المواد')
  })
  it('supports unit-weighted averages', () => {
    const m = masterRow(
      [
        { total: 90, special: null, complete: true },
        { total: 60, special: null, complete: true },
      ],
      [3, 1],
      { ...settings, average_mode: 'weighted' },
    )
    expect(m.average).toBe(82.5)
  })
  it('counts grade bands', () => {
    const b = bandCounts([95, 85, 72, 50, 49, null], settings.grade_scale)
    expect(b.map((x) => x.count)).toEqual([1, 1, 1, 0, 1, 1])
    expect(b[0].upper).toBe(100)
    expect(b[1].upper).toBe(89)
  })
})
