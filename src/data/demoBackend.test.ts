import { beforeEach, describe, expect, it } from 'vitest'
import { DemoBackend } from './demoBackend'
import { DEMO_PASSWORD } from './demoSeed'

// يتحقق أن الوضع التجريبي يطبق نفس قواعد قاعدة البيانات
let b: DemoBackend
beforeEach(() => {
  b = new DemoBackend()
  b.resetDemo()
})
const login = (u: string) => b.signIn(u, DEMO_PASSWORD)

async function teacherSubject() {
  const me = await login('rad01')
  const subjects = await b.listSubjects({ year_id: 'y-2026', teacher_id: me.id })
  const draft = subjects.find((s) => s.status === 'draft' && s.term === 2)!
  const students = await b.listStudents(draft)
  return { me, draft, students }
}

describe('DemoBackend', () => {
  it('rejects wrong passwords', async () => {
    await expect(b.signIn('rad01', 'wrong')).rejects.toThrow(/غير صحيحة/)
  })

  it('shows teachers only their own subjects', async () => {
    const me = await login('rad01')
    const all = await b.listSubjects({ year_id: 'y-2026' })
    expect(all.length).toBeGreaterThan(0)
    expect(all.every((s) => s.teacher_ids.includes(me.id))).toBe(true)
  })

  it('saves grades, validates maxima and records the audit log', async () => {
    const { draft, students } = await teacherSubject()
    await b.saveGrades(draft.id, [{ student_id: students[0].id, cw_theory: 20, cw_practical: 12, final_practical: 20, final_theory: 30, special: null, note: null, r2_final_practical: null, r2_final_theory: null, r2_special: null }])
    const g = await b.getGrades([draft.id])
    expect(g).toHaveLength(1)
    await expect(
      b.saveGrades(draft.id, [{ student_id: students[1].id, cw_theory: 26, cw_practical: null, final_practical: null, final_theory: null, special: null, note: null, r2_final_practical: null, r2_final_theory: null, r2_special: null }]),
    ).rejects.toThrow(/بين 0 و 25/)
    await login('admin')
    const log = await b.listAudit({ action_prefix: 'grade.' })
    expect(log[0].action).toBe('grade.create')
  })

  it('enforces the entry lock for teachers but not for the assistant dean', async () => {
    const { draft, students } = await teacherSubject()
    await expect(b.setEntryOpen(false)).rejects.toThrow(/الإدارة العليا/)
    await login('vice')
    await b.setEntryOpen(false)
    await login('rad01')
    const row = { student_id: students[0].id, cw_theory: 10, cw_practical: null, final_practical: null, final_theory: null, special: null, note: null, r2_final_practical: null, r2_final_theory: null, r2_special: null }
    await expect(b.saveGrades(draft.id, [row])).rejects.toThrow(/مغلق/)
    await login('vice')
    await expect(b.saveGrades(draft.id, [row])).resolves.toBeTruthy()
  })

  it('runs the submit → return → approve workflow', async () => {
    const { draft, students } = await teacherSubject()
    await b.setSubjectStatus(draft.id, 'submitted')
    const row = { student_id: students[0].id, cw_theory: 10, cw_practical: null, final_practical: null, final_theory: null, special: null, note: null, r2_final_practical: null, r2_final_theory: null, r2_special: null }
    await expect(b.saveGrades(draft.id, [row])).rejects.toThrow(/مرسلة/)
    await login('committee')
    await expect(b.setSubjectStatus(draft.id, 'returned')).rejects.toThrow(/ملاحظة/)
    await b.setSubjectStatus(draft.id, 'returned', 'راجع الدرجات')
    await login('rad01')
    await b.saveGrades(draft.id, [row])
    await b.setSubjectStatus(draft.id, 'submitted')
    await login('committee')
    await b.setSubjectStatus(draft.id, 'approved')
    await login('dean')
    await expect(b.saveGrades(draft.id, [{ ...row, cw_theory: 11 }])).rejects.toThrow(/سبب/)
    await expect(b.saveGrades(draft.id, [{ ...row, cw_theory: 11 }], 'تصحيح')).resolves.toBeTruthy()
  })

  it('lets heads add students in paste order and skips duplicates', async () => {
    await login('rad.head')
    const k = { year_id: 'y-2026', department_id: 'd-rad', stage: 1, shift: 'morning' as const }
    const r = await b.addStudents(k, ['زيد علي', 'سارة كريم', 'زيد علي'])
    expect(r).toEqual({ added: 2, skipped: ['زيد علي'] })
    expect((await b.listStudents(k)).map((s) => [s.seq, s.full_name])).toEqual([
      [1, 'زيد علي'],
      [2, 'سارة كريم'],
    ])
    await expect(b.addStudents({ ...k, department_id: 'd-ans' }, ['x y'])).rejects.toThrow(/صلاحية/)
  })

  it('lets heads create teacher accounts only in their department', async () => {
    await login('rad.head')
    const id = await b.createAccount({ username: 'rad99', password: 'abcdef', full_name: 'تدريسي جديد', role: 'teacher', department_id: 'd-ans' })
    const p = (await b.listProfiles()).find((x) => x.id === id)!
    expect(p.department_id).toBe('d-rad')
    expect(p.must_change_password).toBe(true)
    await expect(b.createAccount({ username: 'rad98', password: 'abcdef', full_name: 'مقرر', role: 'head', department_id: 'd-rad' })).rejects.toThrow(/صلاحية/)
    await b.signOut()
    await expect(b.signIn('rad99', 'abcdef')).resolves.toMatchObject({ username: 'rad99' })
  })

  it('computes progress per subject', async () => {
    await login('admin')
    const prog = await b.listProgress('y-2026')
    const approved = prog.filter((p) => p.status === 'approved')
    expect(approved.length).toBeGreaterThan(0)
    expect(approved.every((p) => p.n_complete === p.n_students)).toBe(true)
  })

  it('enforces second-round rules', async () => {
    await login('cht.head')
    const subs = await b.listSubjects({ year_id: 'y-2026', department_id: 'd-cht', stage: 2, term: 1 })
    const draftR2 = subs.find((x) => x.status === 'approved' && x.r2_status === 'draft')!
    const students = await b.listStudents(draftR2)
    const grades = await b.getGrades([draftR2.id])
    const settings = await b.getSettings()
    const { computeRow } = await import('../lib/calc')
    const byStudent = new Map(grades.map((g) => [g.student_id, g]))
    const passer = students.find((st) => computeRow(draftR2, byStudent.get(st.id), settings).passed === true)!
    const failer = students.find((st) => computeRow(draftR2, byStudent.get(st.id), settings).needsR2)!
    const row = (id: string, extra: object) => ({ ...byStudent.get(id)!, student_id: id, ...extra })
    await expect(b.saveGrades(draftR2.id, [row(passer.id, { r2_final_theory: 20 })])).rejects.toThrow(/ناجح في الدور الأول/)
    await expect(b.saveGrades(draftR2.id, [row(failer.id, { cw_theory: 0 })])).rejects.toThrow(/معتمدة/)
    await expect(b.saveGrades(draftR2.id, [row(failer.id, { r2_special: 'absent' })])).resolves.toBeTruthy()
    await b.setSubjectStatus(draftR2.id, 'submitted', null, 2)
    await expect(b.saveGrades(draftR2.id, [row(failer.id, { r2_special: null })])).rejects.toThrow(/الدور الثاني مرسلة/)
  })

  it('ships the CHT study plan and lets heads edit only their department', async () => {
    await login('cht.head')
    const plan = await b.listCurriculum('d-cht')
    expect(plan).toHaveLength(31)
    expect(plan.filter((c) => c.stage === 2 && c.term === 1).reduce((a, c) => a + c.units, 0)).toBe(24)
    await b.saveCurriculum({ department_id: 'd-cht', stage: 3, term: 1, sort: 1, name: 'مادة جديدة', name_en: null, category: null, language: null, theory_hours: 2, practical_hours: 2, units: 3 })
    await expect(
      b.saveCurriculum({ department_id: 'd-rad', stage: 1, term: 1, sort: 1, name: 'x', name_en: null, category: null, language: null, theory_hours: 1, practical_hours: 0, units: 1 }),
    ).rejects.toThrow(/صلاحية/)
  })
})
