import { describe, expect, it } from 'vitest'
import { formatCode, slipModel } from '../components/ResultSlip'
import type { Grade, Settings, Student, Subject, VerifiedResult, VerifiedSubject } from '../lib/types'
import { buildStudentReport, buildVerifiedReport, officialGrade, rowFromVerified } from './results'

const settings: Settings = {
  university_name: 'جامعة السراج الأهلية',
  college_name: 'كلية التقنيات الصحية والطبية',
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
  hide_grades_when_closed: true,
  dean_name: null,
  committee_head_name: null,
}

const subject = (id: string, name: string, term: 1 | 2, units: number, extra: Partial<Subject> = {}): Subject => ({
  id,
  year_id: 'y',
  department_id: 'd',
  stage: 2,
  shift: 'morning',
  term,
  name,
  code: null,
  units,
  teacher_ids: [],
  coursework_max: 30,
  cw_practical_max: 0,
  practical_max: 0,
  final_max: 70,
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

const grade = (subject_id: string, cw: number, fin: number, extra: Partial<Grade> = {}): Grade => ({
  subject_id,
  student_id: 'st',
  cw_theory: cw,
  cw_practical: null,
  final_practical: null,
  final_theory: fin,
  special: null,
  note: null,
  r2_final_practical: null,
  r2_final_theory: null,
  r2_special: null,
  updated_at: '',
  updated_by: null,
  ...extra,
})

const student = { status: 'active' } as Pick<Student, 'status'>

describe('result slip (labels only)', () => {
  const subs = [subject('a', 'تشريح', 1, 3), subject('b', 'فسلجة', 1, 2), subject('c', 'كيمياء', 2, 4)]

  it('shows grade labels, units and the overall label for one term', () => {
    const report = buildStudentReport(subs, [grade('a', 25, 60), grade('b', 20, 45), grade('c', 28, 64)], 'st', settings)
    const m = slipModel(student, report, 1)
    expect(m.sections).toHaveLength(1)
    expect(m.sections[0].rows.map((r) => [r.name, r.label, r.note])).toEqual([
      ['تشريح', 'جيد جداً', 'ناجح'],
      ['فسلجة', 'متوسط', 'ناجح'],
    ])
    expect(m).toMatchObject({ units: 5, status: 'pass', statusText: 'ناجح', failed: [], round: 'الأول' })
    // (85×3 + 65×2) / 5 = 77 → جيد
    expect(m.overallLabel).toBe('جيد')
  })

  it('names the subjects of a carried student and of a failed student', () => {
    const carry = buildStudentReport(subs, [grade('a', 10, 20), grade('b', 20, 45), grade('c', 28, 64)], 'st', settings)
    const m = slipModel(student, carry, 0)
    expect(m).toMatchObject({ status: 'carry', statusText: 'مكمل', failed: ['تشريح'], failedTitle: 'المواد المكمل فيها' })
    expect(m.sections).toHaveLength(2)
    expect(m.sections[0].rows[0]).toMatchObject({ label: 'ضعيف', note: 'مكمل', tone: 'carry' })

    const fail = buildStudentReport(subs, [grade('a', 10, 20), grade('b', 5, 20), grade('c', 10, 30)], 'st', settings)
    const f = slipModel(student, fail, 0)
    expect(f).toMatchObject({ status: 'fail', statusText: 'راسب', failedTitle: 'المواد الراسب فيها' })
    expect(f.failed).toEqual(['تشريح', 'فسلجة', 'كيمياء'])
    expect(f.sections[0].rows[0]).toMatchObject({ note: 'راسب', tone: 'fail' })
  })

  it('marks subjects passed in the second round', () => {
    const subsR2 = [subject('a', 'تشريح', 1, 3, { r2_status: 'approved' })]
    const report = buildStudentReport(subsR2, [grade('a', 10, 20, { r2_final_theory: 50 })], 'st', settings)
    const m = slipModel(student, report, 1)
    // السعي 10 ثابت + نهائي الدور الثاني 50 = 60
    expect(m.sections[0].rows[0]).toMatchObject({ label: 'متوسط', note: 'ناجح (د2)', tone: 'ok' })
    expect(m).toMatchObject({ status: 'pass_r2', round: 'الأول والثاني' })
  })

  it('prints approved grades only (like the QR verification page)', () => {
    const draft = subject('d', 'مسودة', 1, 2, { status: 'submitted' })
    const r2Pending = subject('e', 'دور ثانٍ غير معتمد', 1, 2, { r2_status: 'submitted' })
    expect(officialGrade(draft, grade('d', 25, 60))).toBeUndefined()
    expect(officialGrade(r2Pending, grade('e', 10, 20, { r2_final_theory: 50 }))).toMatchObject({ final_theory: 20, r2_final_theory: null })
    const report = buildStudentReport([draft, r2Pending], [grade('d', 25, 60), grade('e', 10, 20, { r2_final_theory: 50 })], 'st', settings, true)
    const m = slipModel(student, report, 1)
    // الترتيب أبجدي عند تساوي التسلسل: «دور ثانٍ…» قبل «مسودة»
    expect(m.sections[0].rows.map((r) => r.label)).toEqual(['ضعيف', '—'])
    expect(m.status).toBe('incomplete')
  })

  it('shows withdrawn students as such', () => {
    const report = buildStudentReport(subs, [], 'st', settings)
    expect(slipModel({ status: 'withdrawn' }, report, 0)).toMatchObject({ status: 'withdrawn', statusText: 'منسحب', failed: [] })
  })

  it('formats the verification code in groups of four', () => {
    expect(formatCode('8843DAD56288CB68')).toBe('8843-DAD5-6288-CB68')
  })
})

describe('public verification', () => {
  const vs = (name: string, term: 1 | 2, extra: Partial<VerifiedSubject>): VerifiedSubject => ({
    name,
    term,
    units: 3,
    ministerial: false,
    approved: true,
    special: null,
    total: null,
    passed: null,
    r2_approved: false,
    r2_special: null,
    r2_total: null,
    r2_passed: null,
    ...extra,
  })
  const v: VerifiedResult = {
    code: 'ABCDABCDABCDABCD',
    student: { full_name: 'طالب', stage: 2, shift: 'morning', status: 'active', seq: 1 },
    department: { name: 'قسم', head_name: null },
    year: '2026-2027',
    settings,
    subjects: [
      vs('أ', 1, { total: 80, passed: true }),
      // تقويمية: المجموع 64 لكنه راسب لعدم بلوغ حد الامتحان الوزاري
      vs('ب', 1, { total: 64, passed: false, ministerial: true }),
      vs('ج', 2, { approved: false }),
    ],
  }

  it('rebuilds labels and statuses from approved totals', () => {
    const r = buildVerifiedReport(v)
    expect(r.sections).toHaveLength(2)
    const [a, b] = r.sections[0].items.map((x) => x.result)
    expect(a).toMatchObject({ finalLabel: 'جيد جداً', finalPassed: true })
    expect(b).toMatchObject({ finalLabel: 'ضعيف', finalPassed: false, needsR2: true })
    expect(r.sections[0].summary).toMatchObject({ status: 'carry', r1Failed: ['ب'] })
    // مادة الفصل الثاني لم تُعتمد بعد ← النتيجة السنوية غير مكتملة
    expect(r.annual.status).toBe('incomplete')
  })

  it('uses the approved second round as the final result', () => {
    const row = rowFromVerified(vs('ب', 1, { total: 40, passed: false, r2_approved: true, r2_total: 58, r2_passed: true }), settings)
    expect(row).toMatchObject({ finalRound: 2, finalTotal: 58, finalPassed: true, finalLabel: 'مقبول' })
  })
})
