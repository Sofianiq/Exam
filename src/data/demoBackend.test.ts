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
    expect(plan).toHaveLength(56)
    expect(plan.filter((c) => c.stage === 2 && c.term === 1).reduce((a, c) => a + c.units, 0)).toBe(24)
    await b.saveCurriculum({ department_id: 'd-cht', stage: 3, term: 1, sort: 1, name: 'مادة جديدة', name_en: null, category: null, language: null, theory_hours: 2, practical_hours: 2, units: 3, ministerial: true })
    await expect(
      b.saveCurriculum({ department_id: 'd-rad', stage: 1, term: 1, sort: 1, name: 'x', name_en: null, category: null, language: null, theory_hours: 1, practical_hours: 0, units: 1, ministerial: false }),
    ).rejects.toThrow(/صلاحية/)
  })

  it('ships the study plans of the four departments with official unit totals', async () => {
    await login('dean')
    const total = (await Promise.all(['d-ans', 'd-rad', 'd-den', 'd-cht'].map((d) => b.listCurriculum(d)))).map((x) => x.length)
    expect(total).toEqual([56, 55, 51, 56])
    const den = await b.listCurriculum('d-den')
    expect(den.filter((c) => c.stage === 4 && c.term === 2).reduce((a, c) => a + c.units, 0)).toBe(26)
  })

  it('hides all grades from teachers while entry is closed', async () => {
    const me = await login('rad01')
    const mine = await b.listSubjects({ year_id: 'y-2026', teacher_id: me.id })
    const withGrades = mine.find((s) => s.status === 'approved')!
    expect((await b.getGrades([withGrades.id])).length).toBeGreaterThan(0)
    await login('vice')
    await b.setEntryOpen(false)
    await login('rad01')
    expect(await b.getGrades([withGrades.id])).toHaveLength(0)
    expect((await b.listProgress('y-2026')).every((p) => p.n_complete === 0)).toBe(true)
    await login('rad.head')
    expect((await b.getGrades([withGrades.id])).length).toBeGreaterThan(0)
    await login('admin')
    await b.updateSettings({ hide_grades_when_closed: false })
    await login('rad01')
    expect((await b.getGrades([withGrades.id])).length).toBeGreaterThan(0)
  })

  it('publishes announcements to the right audience', async () => {
    await login('dean')
    await b.saveAnnouncement({ title: 'عام', body: '', level: 'urgent', department_id: null, audience: 'all', pinned: false, expires_at: null })
    await login('cht.head')
    await expect(b.saveAnnouncement({ title: 'للكلية', body: '', level: 'info', department_id: null, audience: 'all', pinned: false, expires_at: null })).rejects.toThrow(/صلاحية/)
    await b.saveAnnouncement({ title: 'لقسم صحة المجتمع', body: '', level: 'info', department_id: 'd-cht', audience: 'teachers', pinned: false, expires_at: null })
    await login('ans01')
    const titles = (await b.listAnnouncements()).map((a) => a.title)
    expect(titles).toContain('عام')
    expect(titles).not.toContain('لقسم صحة المجتمع')
    await expect(b.deleteAnnouncement((await b.listAnnouncements())[0].id)).rejects.toThrow(/صلاحية/)
    // تدريسي الأشعة المرتبط بقسم صحة المجتمع تصله إعلانات القسم
    await login('rad01')
    expect((await b.listAnnouncements()).map((a) => a.title)).toContain('لقسم صحة المجتمع')
  })

  it('applies the ministerial (تقويمية) rule in the demo data', async () => {
    await login('dean')
    const subs = await b.listSubjects({ year_id: 'y-2026', department_id: 'd-cht' })
    const m = subs.find((s) => s.ministerial && s.term === 1)!
    expect(m).toMatchObject({ coursework_max: 40, practical_max: 0, final_max: 60, final_min: 30 })
  })

  it('links a teacher to several departments and lists their subjects there', async () => {
    const me = await login('rad01')
    const mine = await b.listSubjects({ year_id: 'y-2026', teacher_id: me.id })
    expect(new Set(mine.map((x) => x.department_id))).toEqual(new Set(['d-rad', 'd-cht']))
    await login('cht.head')
    const profiles = await b.listProfiles()
    const rad02 = profiles.find((p) => p.username === 'rad02')!
    await b.setTeacherDepartments(rad02.id, [...rad02.extra_department_ids, 'd-cht'])
    expect((await b.listProfiles()).find((p) => p.id === rad02.id)!.extra_department_ids).toEqual(['d-cht'])
    // المقرر لا يربط تدريسياً بقسم آخر غير قسمه
    await expect(b.setTeacherDepartments(rad02.id, ['d-cht', 'd-ans'])).rejects.toThrow(/صلاحية/)
    await b.setTeacherDepartments(rad02.id, [])
    expect((await b.listProfiles()).find((p) => p.id === rad02.id)!.extra_department_ids).toEqual([])
  })

  it('assigning a subject to a teacher from another department links them automatically', async () => {
    await login('cht.head')
    const rad03 = (await b.listProfiles()).find((p) => p.username === 'rad03')!
    await b.saveSubject({
      year_id: 'y-2026',
      department_id: 'd-cht',
      stage: 1,
      shift: 'morning',
      term: 1,
      name: 'مادة مشتركة',
      code: null,
      units: 2,
      teacher_ids: [rad03.id],
      coursework_max: 30,
      cw_practical_max: 0,
      practical_max: 0,
      sort: 1,
      ministerial: false,
      final_min: null,
    })
    expect((await b.listProfiles()).find((p) => p.id === rad03.id)!.extra_department_ids).toContain('d-cht')
  })

  it('verifies a printed result by its code without signing in, revealing approved subjects only', async () => {
    await login('dean')
    const st = (await b.listStudents({ year_id: 'y-2026', department_id: 'd-cht', stage: 2, shift: 'morning' }))[0]
    await b.signOut()
    const v = await b.verifyResult(st.verify_code.toLowerCase().replace(/(.{4})/g, '$1-'))
    expect(v?.student.full_name).toBe(st.full_name)
    const approved = v!.subjects.filter((x) => x.approved)
    expect(approved.length).toBeGreaterThan(0)
    expect(approved.every((x) => x.total != null || x.special != null)).toBe(true)
    expect(v!.subjects.filter((x) => !x.approved).every((x) => x.total == null && x.passed == null)).toBe(true)
    expect(await b.verifyResult('0000000000000000')).toBeNull()
  })
})
