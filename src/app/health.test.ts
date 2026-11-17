import { describe, expect, it } from 'vitest'
import type { Grade, Settings, Student, Subject } from '../lib/types'
import { nameKey, runHealthCheck } from './health'

const settings = {
  pass_mark: 50,
  rounding: 'round',
  grade_scale: [
    { min: 50, label: 'مقبول' },
    { min: 0, label: 'ضعيف' },
  ],
  average_mode: 'weighted',
  max_failed_subjects: 2,
  second_round_deduction: 0,
  second_round_cap: null,
} as unknown as Settings

const subject = (id: string, extra: Partial<Subject> = {}): Subject =>
  ({
    id,
    year_id: 'y',
    department_id: 'd1',
    stage: 1,
    shift: 'morning',
    term: 1,
    name: `مادة ${id}`,
    units: 3,
    teacher_ids: ['t'],
    coursework_max: 40,
    cw_practical_max: 0,
    practical_max: 0,
    final_max: 60,
    status: 'approved',
    r2_status: 'draft',
    ministerial: false,
    final_min: null,
    sort: 0,
    ...extra,
  }) as Subject

const student = (id: string, name: string, extra: Partial<Student> = {}): Student =>
  ({ id, full_name: name, status: 'active', year_id: 'y', department_id: 'd1', stage: 1, shift: 'morning', seq: 1, notes: null, ...extra }) as Student

const grade = (subject_id: string, student_id: string, v: Partial<Grade>): Grade =>
  ({ subject_id, student_id, cw_theory: null, cw_practical: null, final_practical: null, final_theory: null, special: null, note: null, r2_final_practical: null, r2_final_theory: null, r2_special: null, updated_at: '', updated_by: null, ...v }) as Grade

describe('data health check', () => {
  it('normalizes names like the database (عبد الله = عبدالله، أ = ا، ة = ه)', () => {
    expect(nameKey('أحمد عبد الله  فاطمة')).toBe(nameKey('احمد عبدالله فاطمه'))
  })

  it('reports nothing for clean data', () => {
    const r = runHealthCheck({
      subjects: [subject('a')],
      students: [student('s1', 'علي حسن'), student('s2', 'زينب علي')],
      grades: [grade('a', 's1', { cw_theory: 30, final_theory: 40 }), grade('a', 's2', { cw_theory: 20, final_theory: 40 })],
      settings,
    })
    expect(r.issues).toEqual([])
    expect(r.checked).toEqual({ subjects: 1, students: 2, grades: 2 })
  })

  it('finds missing grades in approved lists, pending round 2 and duplicate students', () => {
    const r = runHealthCheck({
      subjects: [subject('a', { r2_status: 'approved' }), subject('b', { status: 'draft' })],
      students: [student('s1', 'علي حسن', { student_no: '100' }), student('s2', 'زينب علي'), student('s3', 'علي  حسن'), student('s4', 'منسحب', { status: 'withdrawn' }), student('s5', 'سارة', { student_no: '100', stage: 2 })],
      grades: [grade('a', 's1', { cw_theory: 10, final_theory: 20 }), grade('a', 's2', { cw_theory: 30, final_theory: 40 })],
      settings,
    })
    const kinds = r.issues.map((i) => i.kind)
    // قائمة معتمدة: الطالب الثالث بلا درجات (المنسحب لا يُحسب، والمادة غير المعتمدة لا تُفحص)
    const missing = r.issues.find((i) => i.kind === 'missing_grades')!
    expect(missing).toMatchObject({ level: 'error', names: ['علي  حسن'], link: '/subjects/a' })
    // الدور الثاني معتمد والطالب الأول راسب بلا درجة دور ثانٍ
    expect(r.issues.find((i) => i.kind === 'missing_r2')).toMatchObject({ level: 'warning', names: ['علي حسن'] })
    // الاسم نفسه مرتين في الصف، والرقم الجامعي نفسه لطالبين
    expect(r.issues.find((i) => i.kind === 'dup_name')).toMatchObject({ level: 'error', link: '/class/d1/1/morning?tab=students' })
    expect(r.issues.find((i) => i.kind === 'dup_no')?.names).toEqual(['علي حسن', 'سارة'])
    // صف المرحلة الثانية فيه طالب بلا مواد
    expect(kinds).toContain('class_no_subjects')
    // الأخطاء أولاً
    expect(r.issues[0].level).toBe('error')
    expect(r.counts.error).toBe(3)
  })

  it('flags subjects without units, ministerial subjects without a minimum, unassigned subjects and settlements that hide a failure', () => {
    const r = runHealthCheck({
      subjects: [subject('a', { units: null }), subject('b', { ministerial: true }), subject('c', { teacher_ids: [] }), subject('d', { final_min: 30 }), subject('e', { teacher_ids: [], legacy: true })],
      students: [student('s1', 'علي حسن')],
      grades: [
        grade('a', 's1', { cw_theory: 30, final_theory: 40 }),
        grade('b', 's1', { cw_theory: 30, final_theory: 40 }),
        grade('c', 's1', { cw_theory: 30, final_theory: 40 }),
        // امتحان الدور الثاني 22 < 30 لكن الدرجة المثبتة 52 تُظهره ناجحاً
        grade('d', 's1', { cw_theory: 30, final_theory: 20, r2_final_theory: 22, final_override: 52 }),
        grade('e', 's1', { cw_theory: 30, final_theory: 40 }),
      ],
      settings,
    })
    const by = (k: string) => r.issues.filter((i) => i.kind === k)
    expect(by('no_units')).toHaveLength(1)
    expect(by('no_units')[0].level).toBe('warning')
    expect(by('ministerial_min')).toHaveLength(1)
    // المادة المرحّلة من النظام السابق لا تحتاج تدريسياً
    expect(by('no_teacher').map((i) => i.link)).toEqual(['/class/d1/1/morning?tab=subjects&term=1'])
    expect(by('override_below_min')[0]).toMatchObject({ level: 'warning', names: ['علي حسن'] })
  })
})
