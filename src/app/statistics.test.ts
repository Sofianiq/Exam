import { describe, expect, it } from 'vitest'
import type { Department, Grade, Settings, Student, Subject } from '../lib/types'
import { buildStatistics, pct } from './statistics'

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

const dept = (id: string, name: string, sort: number): Department => ({ id, name, code: id, has_evening: true, stages: 4, entry_open: true, sort, head_name: null })
const departments = [dept('a', 'قسم أ', 1), dept('b', 'قسم ب', 2)]

const subject = (id: string, department_id: string, term: 1 | 2, extra: Partial<Subject> = {}): Subject => ({
  id,
  year_id: 'y',
  department_id,
  stage: 1,
  shift: 'morning',
  term,
  name: `مادة ${id}`,
  code: null,
  units: 2,
  teacher_ids: [],
  coursework_max: 40,
  cw_practical_max: 0,
  practical_max: 0,
  final_max: 60,
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
const student = (id: string, department_id: string, seq: number, extra: Partial<Student> = {}): Student => ({
  id,
  year_id: 'y',
  department_id,
  stage: 1,
  shift: 'morning',
  seq,
  full_name: `طالب ${id}`,
  status: 'active',
  notes: null,
  verify_code: id.padEnd(16, '0'),
  ...extra,
})
const g = (subject_id: string, student_id: string, cw: number, fin: number, extra: Partial<Grade> = {}): Grade => ({
  subject_id,
  student_id,
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

// القسم أ: ثلاثة طلبة ومادتان في الفصل الأول ومادة في الثاني؛ القسم ب: طالب واحد
const subjects = [subject('s1', 'a', 1), subject('s2', 'a', 1), subject('s3', 'a', 2), subject('t1', 'b', 1), subject('draft', 'b', 1, { status: 'draft' })]
const students = [student('x1', 'a', 1, { gender: 'male' }), student('x2', 'a', 2, { gender: 'female' }), student('x3', 'a', 3, { gender: 'female' }), student('z1', 'b', 1), student('w', 'a', 4, { status: 'withdrawn' })]
const grades = [
  g('s1', 'x1', 35, 55), // 90
  g('s2', 'x1', 30, 50), // 80
  g('s3', 'x1', 30, 40), // 70
  g('s1', 'x2', 20, 20), // 40 → مكمل
  g('s2', 'x2', 25, 30), // 55
  g('s3', 'x2', 10, 20, { r2_final_theory: 15 }), // 30 ثم 25 في الدور الثاني → راسب
  g('s1', 'x3', 30, 30), // 60
  g('s2', 'x3', 30, 30), // 60
  g('s3', 'x3', 20, 20, { r2_final_theory: 40 }), // 40 ثم 60 − 10 = 50 في الدور الثاني
  g('t1', 'z1', 30, 40), // 70
  g('draft', 'z1', 10, 10),
]

describe('committee statistics', () => {
  it('computes college, department and class counts for the first term', () => {
    const st = buildStatistics({ subjects, students, grades, settings, departments, scope: 1, official: true })
    // المسودة لا تدخل في الإحصائية الرسمية
    expect(st.unapproved).toBe(1)
    // طالب القسم ب نتيجته غير مكتملة لأن إحدى مواده غير معتمدة
    expect(st.counts).toMatchObject({ students: 4, pass: 2, carry: 1, fail: 0, incomplete: 1 })
    expect(pct(st.counts.passRate)).toBe('66.67%')
    const a = st.departments[0]
    expect(a.department.id).toBe('a')
    expect(a.counts).toMatchObject({ students: 3, pass: 2, carry: 1 })
    // الطالب المكمل مع اسم المادة
    expect(a.failing.map((f) => [f.student.id, f.status, f.subjects])).toEqual([['x2', 'carry', ['مادة s1']]])
    // نسبة النجاح في كل مادة
    expect(a.subjects.map((x) => [x.subject.id, x.pass, x.fail, x.passRate])).toEqual([
      ['s1', 2, 1, 2 / 3],
      ['s2', 3, 0, 1],
    ])
    expect(a.top[0]).toMatchObject({ rank: 1, average: 85 })
    expect(st.byGender.map((x) => [x.label, x.counts.students])).toEqual([
      ['الذكور', 1],
      ['الإناث', 2],
    ])
  })

  it('includes unapproved lists when not restricted to official results', () => {
    const st = buildStatistics({ subjects, students, grades, settings, departments, scope: 1, official: false })
    const b = st.departments.find((d) => d.department.id === 'b')!
    expect(b.subjects.find((x) => x.subject.id === 'draft')).toMatchObject({ pass: 0, fail: 1 })
    expect(b.counts.carry).toBe(1)
  })

  it('decides راسب / ناجح بالتحميل in the annual result and tracks round 2', () => {
    const st = buildStatistics({ subjects, students, grades, settings, departments, scope: 0, official: true })
    const a = st.departments[0]
    const x2 = a.failing.find((f) => f.student.id === 'x2')!
    // مادة الفصل الأول ما زالت بانتظار الدور الثاني → مكمل في النتيجة السنوية
    expect(x2.status).toBe('carry')
    const s3 = buildStatistics({ subjects, students, grades, settings, departments, scope: 2, official: true }).departments[0].subjects[0]
    expect(s3).toMatchObject({ needR2: 2, satR2: 2, passR2: 1, pass: 2, fail: 1 })
    // قائمة المواد الأصعب تستبعد المواد التي فيها أقل من 5 طلبة (لتجنب نسب مضللة)
    expect(st.hardest).toEqual([])
  })
})
