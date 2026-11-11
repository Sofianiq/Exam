import { describe, expect, it } from 'vitest'
import type { Grade, Settings, Student, Subject } from '../lib/types'
import { buildPortalSnapshots, isStalePublication, portalLoginUrl, publishBlocker } from './portal'

const settings: Settings = {
  university_name: '',
  college_name: '',
  entry_open: true,
  pass_mark: 50,
  rounding: 'round',
  grade_scale: [
    { min: 90, label: 'امتياز' },
    { min: 80, label: 'جيد جداً' },
    { min: 70, label: 'جيد' },
    { min: 60, label: 'متوسط' },
    { min: 50, label: 'مقبول' },
    { min: 0, label: 'ضعيف' },
  ],
  average_mode: 'weighted',
  idle_minutes: 60,
  current_year_id: null,
  second_round_cap: null,
  max_failed_subjects: 2,
  second_round_deduction: 10,
  hide_grades_when_closed: true,
  dean_name: null,
  committee_head_name: null,
}
const subject = (id: string, term: 1 | 2, extra: Partial<Subject> = {}): Subject => ({
  id,
  year_id: 'y',
  department_id: 'd',
  stage: 1,
  shift: 'morning',
  term,
  name: `مادة ${id}`,
  code: null,
  units: 3,
  teacher_ids: [],
  coursework_max: 40,
  cw_practical_max: 15,
  practical_max: 25,
  final_max: 35,
  status: 'approved',
  status_note: null,
  submitted_at: null,
  submitted_by: null,
  reviewed_at: null,
  reviewed_by: null,
  sort: 0,
  ministerial: false,
  final_min: null,
  r2_status: 'draft',
  r2_note: null,
  r2_submitted_at: null,
  r2_reviewed_at: null,
  r2_reviewed_by: null,
  ...extra,
})
const student = (id: string, seq: number, extra: Partial<Student> = {}): Student => ({
  id,
  year_id: 'y',
  department_id: 'd',
  stage: 1,
  shift: 'morning',
  seq,
  full_name: `طالب ${id}`,
  status: 'active',
  notes: null,
  verify_code: id,
  ...extra,
})
const g = (subject_id: string, student_id: string, cwT: number | null, cwP: number | null, fp: number | null, ft: number | null): Grade => ({
  subject_id,
  student_id,
  cw_theory: cwT,
  cw_practical: cwP,
  final_practical: fp,
  final_theory: ft,
  special: null,
  note: null,
  r2_final_practical: null,
  r2_final_theory: null,
  r2_special: null,
  updated_at: '',
  updated_by: null,
})

const subjects = [subject('a', 1), subject('b', 1, { status: 'draft' }), subject('c', 2)]
const students = [student('s1', 1), student('s2', 2), student('w', 3, { status: 'withdrawn' })]
const grades = [g('a', 's1', 20, 12, 20, 30), g('b', 's1', 18, null, null, null), g('a', 's2', 10, 5, 5, 10), g('c', 's1', 22, 13, 22, 33)]

describe('student portal snapshots', () => {
  it('publishes only the coursework total of each subject', () => {
    const snaps = buildPortalSnapshots('coursework', 1, subjects, students, grades, settings)
    // المنسحب لا يُنشر له شيء
    expect(snaps.map((x) => x.student_id)).toEqual(['s1', 's2'])
    expect(snaps[0].data).toEqual({
      v: 1,
      subjects: [
        // النظري 20 + العملي 12 ← يرى الطالب المجموع 32 فقط
        { name: 'مادة a', units: 3, cw: 32, max: 40 },
        // سعي ناقص لم يكتمل رصده
        { name: 'مادة b', units: 3, cw: null, max: 40 },
      ],
    })
    const text = JSON.stringify(snaps)
    expect(text).not.toMatch(/cw_theory|cw_practical|final_/)
  })

  it('publishes results as labels and status only, never marks', () => {
    const approved = subjects.map((x) => ({ ...x, status: 'approved' as const }))
    const snaps = buildPortalSnapshots('results', 1, approved, students, [...grades, g('b', 's1', 20, 10, 20, 30), g('b', 's2', 20, 10, 20, 30)], settings)
    const s1 = snaps[0].data
    if (!('sections' in s1)) throw new Error('expected a result snapshot')
    expect(s1).toMatchObject({ scope: 1, status: 'pass', statusText: 'ناجح', rank: 1, failed: [] })
    expect(s1.sections[0].rows.map((r) => [r.name, r.label, r.note])).toEqual([
      ['مادة a', 'جيد جداً', 'ناجح'],
      ['مادة b', 'جيد جداً', 'ناجح'],
    ])
    const s2 = snaps[1].data
    if (!('sections' in s2)) throw new Error('expected a result snapshot')
    expect(s2).toMatchObject({ status: 'carry', failed: ['مادة a'], rank: null })
    // لا درجات رقمية في أي نسخة منشورة
    expect(JSON.stringify(snaps)).not.toMatch(/"(total|average|finalTotal|cw|sum)"/)
  })

  it('blocks publishing results before every list of the term is approved', () => {
    const changes = [
      { term: 1 as const, subjects: 6, approved: 4 },
      { term: 2 as const, subjects: 5, approved: 5 },
    ]
    expect(publishBlocker('coursework', 1, changes)).toBeNull()
    expect(publishBlocker('results', 1, changes)).toBe('2 من قوائم الفصل الأول لم تُعتمد بعد')
    expect(publishBlocker('results', 2, changes)).toBeNull()
    expect(publishBlocker('results', 0, changes)).toBe('2 من قوائم الفصل الأول لم تُعتمد بعد')
    expect(publishBlocker('coursework', 1, [])).toBe('لا توجد مواد في الفصل الأول')
  })

  it('flags a publication as stale only when grades changed after it', () => {
    const base = { department_id: 'd', stage: 1, shift: 'morning' as const, subjects: 3, approved: 3 }
    const changes = [
      { ...base, term: 1 as const, changed_at: '2026-01-10T10:00:00Z' },
      { ...base, term: 2 as const, changed_at: '2026-06-01T10:00:00Z' },
    ]
    expect(isStalePublication({ term: 1, published_at: '2026-01-11T00:00:00Z' }, changes)).toBe(false)
    expect(isStalePublication({ term: 1, published_at: '2026-01-09T00:00:00Z' }, changes)).toBe(true)
    // النتيجة السنوية تتأثر بأي من الفصلين
    expect(isStalePublication({ term: 0, published_at: '2026-05-01T00:00:00Z' }, changes)).toBe(true)
    expect(isStalePublication({ term: 0, published_at: '2026-07-01T00:00:00Z' }, changes)).toBe(false)
    expect(isStalePublication(undefined, changes)).toBe(false)
    expect(isStalePublication({ term: 2, published_at: '2026-01-01T00:00:00Z' }, [{ ...base, term: 2 as const, changed_at: null }])).toBe(false)
  })

  it('builds the direct sign-in link for the card QR code', () => {
    expect(portalLoginUrl('https://x.github.io/student-results', '1234567', '11112222')).toBe('https://x.github.io/student-results/#/login?u=1234567&c=11112222')
    expect(portalLoginUrl('https://x.github.io/student-results/', '1234567', null)).toBe('https://x.github.io/student-results/#/login?u=1234567')
    expect(portalLoginUrl(null, '1', '2')).toBeNull()
  })
})
