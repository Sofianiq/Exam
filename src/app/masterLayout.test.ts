import { describe, expect, it } from 'vitest'
import type { Grade, Settings, Student, Subject } from '../lib/types'
import { masterCell, masterGroups, masterTotals } from './masterLayout'
import { buildClassResults } from './results'

const settings: Settings = {
  university_name: 'جامعة',
  college_name: 'كلية',
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
  second_round_deduction: 0,
  hide_grades_when_closed: true,
  dean_name: null,
  committee_head_name: null,
}

const subject = (id: string, name: string, units: number, extra: Partial<Subject> = {}): Subject => ({
  id,
  year_id: 'y',
  department_id: 'd',
  stage: 1,
  shift: 'morning',
  term: 1,
  name,
  code: null,
  units,
  teacher_ids: [],
  coursework_max: 40,
  cw_practical_max: 0,
  practical_max: 20,
  final_max: 40,
  status: 'approved',
  status_note: null,
  submitted_at: null,
  submitted_by: null,
  reviewed_at: null,
  reviewed_by: null,
  sort: 0,
  ministerial: false,
  final_min: null,
  r2_status: 'approved',
  r2_note: null,
  r2_submitted_at: null,
  r2_reviewed_at: null,
  r2_reviewed_by: null,
  ...extra,
})

const student = (id: string, name: string): Student =>
  ({ id, full_name: name, status: 'active', year_id: 'y', department_id: 'd', stage: 1, shift: 'morning', seq: 1, notes: null }) as Student

const grade = (subject_id: string, student_id: string, v: Partial<Grade>): Grade => ({
  subject_id,
  student_id,
  cw_theory: null,
  cw_practical: null,
  final_practical: null,
  final_theory: null,
  special: null,
  note: null,
  r2_final_practical: null,
  r2_final_theory: null,
  r2_special: null,
  updated_at: '',
  updated_by: null,
  ...v,
})

// تشريح: سعي 40 + عملي 20 + نظري 40 (فيها دور ثانٍ) — مصطلحات: سعي 40 + نظري 60 (بلا دور ثانٍ) — مادة مرحّلة
const anat = subject('a', 'تشريح', 3, { sort: 1 })
const terms = subject('b', 'مصطلحات', 2, { practical_max: 0, final_max: 60, sort: 2 })
const legacy = subject('c', 'كيمياء', 1, { practical_max: 0, final_max: 60, legacy: true, sort: 3 })
const students = [student('s1', 'الطالب الأول'), student('s2', 'الطالب الثاني'), student('s3', 'الطالب الثالث')]
const grades = [
  // الأول: ناجح في كل المواد، ومصطلحات بقرار (48 + 2)
  grade('a', 's1', { cw_theory: 30, final_practical: 15, final_theory: 30 }),
  grade('b', 's1', { cw_theory: 20, final_theory: 28, decision: 2 }),
  grade('c', 's1', { cw_theory: 30, final_theory: 40 }),
  // الثاني: راسب في التشريح في الدور الأول ثم ناجح في الدور الثاني، وغائب في الكيمياء ثم راسب فيها (محمل)
  grade('a', 's2', { cw_theory: 20, final_practical: 5, final_theory: 10, r2_final_practical: 12, r2_final_theory: 25 }),
  grade('b', 's2', { cw_theory: 30, final_theory: 40 }),
  grade('c', 's2', { cw_theory: 10, special: 'absent', r2_final_theory: 20 }),
  // الثالث: راسب في ثلاث مواد بعد الدور الثاني
  grade('a', 's3', { cw_theory: 10, final_practical: 5, final_theory: 10, r2_final_practical: 5, r2_final_theory: 10 }),
  grade('b', 's3', { cw_theory: 10, final_theory: 10, r2_final_theory: 20 }),
  grade('c', 's3', { cw_theory: 10, final_theory: 10, r2_final_theory: 20 }),
]
const data = buildClassResults([anat, terms, legacy], students, grades, settings)

describe('master sheet layout (order of the committee program)', () => {
  it('lists round 1 → round 2 (only when someone sat it) → final grade per subject', () => {
    const groups = masterGroups(data.subjects, data.rows, false)
    const kinds = groups.map((g) => [g.subject.name, g.cols.map((c) => c.kind)])
    expect(kinds).toEqual([
      ['تشريح', ['cw', 'prac', 'theory', 'r2prac', 'r2theory', 'final']],
      ['مصطلحات', ['cw', 'theory', 'r2theory', 'final']],
      ['كيمياء', ['cw', 'theory', 'r2theory', 'final']],
    ])
    expect(groups[0].cols.map((c) => [c.label, c.max])).toEqual([
      ['السعي', 40],
      ['العملي النهائي', 20],
      ['النظري', 40],
      ['العملي النهائي', 20],
      ['النظري', 40],
      ['الدرجة النهائية', 100],
    ])
    // المادة المرحّلة: الامتحان النهائي في عمود واحد
    expect(groups[2].r1[1].label).toBe('الامتحان النهائي')
    // بلا دور ثانٍ لأحد = بلا أعمدة دور ثانٍ
    const onlyFirst = buildClassResults([anat], [students[0]], [grades[0]], settings)
    expect(masterGroups(onlyFirst.subjects, onlyFirst.rows, false)[0].cols.map((c) => c.kind)).toEqual(['cw', 'prac', 'theory', 'final'])
  })

  it('shows only the final grade per subject in the annual result', () => {
    const groups = masterGroups(data.subjects, data.rows, true)
    expect(groups.map((g) => g.cols.map((c) => c.kind))).toEqual([['final'], ['final'], ['final']])
  })

  it('fills each cell and marks decision, round 2, carried and failed grades', () => {
    const groups = masterGroups(data.subjects, data.rows, false)
    const [g1, g2, g3] = groups
    const [r1, r2, r3] = data.rows
    const cells = (g: (typeof groups)[number], row: (typeof data.rows)[number]) => g.cols.map((c) => masterCell(g, c, row, false))
    // الأول: 30 | 15 | 30 | — | — | 75
    expect(cells(g1, r1).map((c) => c.text)).toEqual(['30', '15', '30', '', '', '75'])
    // درجة القرار: الدرجة النهائية 50 مظللة بلون القرار مع «ق»
    expect(cells(g2, r1).at(-1)).toMatchObject({ text: '50', tone: 'decision', mark: 'ق' })
    // الثاني: درجات الدور الثاني مظللة، والنهائية 57 (20 + 12 + 25)
    const c2 = cells(g1, r2)
    expect(c2.map((c) => c.text)).toEqual(['20', '5', '10', '12', '25', '57'])
    expect(c2[3].tone).toBe('r2')
    // الغائب في الدور الأول: «غ» في عمود الامتحان، ثم راسب في الدور الثاني وهو ناجح بالتحميل = مادة محمل بها
    const c3 = cells(g3, r2)
    expect(c3[1]).toMatchObject({ text: 'غ', tone: 'special' })
    expect(r2.summary.status).toBe('pass_carry')
    expect(c3.at(-1)).toMatchObject({ text: '30', tone: 'carried' })
    // الثالث: راسب في ثلاث مواد = راسب، والدرجة الراسبة بلون الرسوب
    expect(r3.summary.status).toBe('fail')
    expect(cells(g1, r3).at(-1)).toMatchObject({ tone: 'fail' })
    // النتيجة السنوية: علامة «د2» لما حُسم في الدور الثاني
    const compact = masterGroups(data.subjects, data.rows, true)
    expect(masterCell(compact[0], compact[0].final, r2, true)).toMatchObject({ text: '57', mark: 'د2' })
  })

  it('totals = Σ(final × units) and average = total ÷ units (weighted system)', () => {
    const r1 = data.rows[0]
    // 75×3 + 50×2 + 70×1 = 395 ؛ 395 ÷ 6 = 65.83
    expect(masterTotals(r1.summary, settings)).toMatchObject({ total: 395, average: 65.83, units: 6 })
    // المتوسط البسيط: مجموع الدرجات ÷ عدد المواد
    const simple = buildClassResults([anat, terms, legacy], students, grades, { ...settings, average_mode: 'simple' })
    expect(masterTotals(simple.rows[0].summary, { average_mode: 'simple' })).toMatchObject({ total: 195, average: 65 })
  })
})
