// تنفيذ تجريبي يعمل بالكامل داخل المتصفح (localStorage) ويطبق نفس قواعد قاعدة البيانات
import { computeRow, cwTheoryMax, finalMaxOf, round2 } from '../lib/calc'
import { SHIFT_LABEL } from '../lib/labels'
import { normalizeArabic } from '../lib/parse'
import { USERNAME_RE } from '../lib/password'
import {
  canManageDepartment,
  canManageRole,
  canManageUser,
  canReview,
  canViewAll,
  canWriteSubject,
  gradeEditBlock,
  isSuper,
} from '../lib/perm'
import type {
  AcademicYear,
  AccountInput,
  AccountUpdate,
  AuditEntry,
  AuditFilter,
  ClassKey,
  Department,
  Grade,
  GradeRowInput,
  Profile,
  Settings,
  Student,
  Subject,
  SubjectInput,
  SubjectProgress,
  SubjectStatus,
  Term,
} from '../lib/types'
import { AppError, type Backend, type StudentPatch, type SubjectFilter } from './backend'
import { createDemoDB, DEMO_VERSION, demoId, type DemoDB, type DemoProfile } from './demoSeed'

const KEY = 'exam.demo.db'
const clone = <T,>(v: T): T => structuredClone(v)
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms))
const sameClass = (a: ClassKey, b: ClassKey) =>
  a.year_id === b.year_id && a.department_id === b.department_id && a.stage === b.stage && a.shift === b.shift
const hasValues = (g: Grade) =>
  g.cw_theory != null || g.cw_practical != null || g.final_practical != null || g.final_theory != null || g.special != null
const fail = (msg: string): never => {
  throw new AppError(msg)
}

export class DemoBackend implements Backend {
  readonly mode = 'demo' as const
  private db: DemoDB
  private authListeners = new Set<() => void>()

  constructor() {
    this.db = this.load()
  }

  private load(): DemoDB {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as DemoDB
        if (parsed.version === DEMO_VERSION) return parsed
      }
    } catch {
      /* بيانات تالفة — يعاد إنشاؤها */
    }
    const fresh = createDemoDB()
    this.persist(fresh)
    return fresh
  }

  private persist(db = this.db) {
    try {
      localStorage.setItem(KEY, JSON.stringify(db))
    } catch {
      /* التخزين ممتلئ أو معطل — تبقى البيانات في الذاكرة */
    }
  }

  resetDemo() {
    const session = this.db.sessionUserId
    this.db = createDemoDB()
    this.db.sessionUserId = session
    this.persist()
  }

  private me(): DemoProfile {
    const p = this.db.profiles.find((x) => x.id === this.db.sessionUserId)
    if (!p || !p.active) {
      this.db.sessionUserId = null
      this.persist()
      this.authListeners.forEach((cb) => cb())
      return fail('انتهت الجلسة. يرجى تسجيل الدخول مجدداً.')
    }
    return p
  }

  private audit(action: string, entity: string | null, entityId: string | null, deptId: string | null, summary: string, details: Record<string, unknown> | null = null) {
    const u = this.db.profiles.find((x) => x.id === this.db.sessionUserId)
    this.db.audit.push({
      id: ++this.db.auditSeq,
      at: new Date().toISOString(),
      user_id: u?.id ?? null,
      user_name: u?.full_name ?? 'النظام',
      action,
      entity,
      entity_id: entityId,
      department_id: deptId,
      summary,
      details,
    })
    if (this.db.audit.length > 5000) this.db.audit.splice(0, this.db.audit.length - 5000)
  }

  private dept(id: string) {
    return this.db.departments.find((d) => d.id === id)
  }

  private canSeeSubject(p: Profile, s: Subject) {
    return canViewAll(p) || (p.role === 'head' && p.department_id === s.department_id) || s.teacher_ids.includes(p.id)
  }

  private canSeeClass(p: Profile, k: ClassKey) {
    return (
      canViewAll(p) ||
      (p.role === 'head' && p.department_id === k.department_id) ||
      this.db.subjects.some((s) => sameClass(s, k) && s.teacher_ids.includes(p.id))
    )
  }

  private strip(p: DemoProfile): Profile {
    const out: Partial<DemoProfile> = clone(p)
    delete out.password
    return out as Profile
  }

  // ---------- الجلسة ----------
  async currentProfile(): Promise<Profile | null> {
    await wait(10)
    const p = this.db.profiles.find((x) => x.id === this.db.sessionUserId)
    return p && p.active ? this.strip(p) : null
  }

  async signIn(username: string, password: string): Promise<Profile> {
    await wait(250)
    const p = this.db.profiles.find((x) => x.username === username.trim().toLowerCase())
    if (!p || p.password !== password) fail('اسم المستخدم أو كلمة المرور غير صحيحة.')
    if (!p!.active) fail('هذا الحساب موقوف. راجع إدارة النظام.')
    this.db.sessionUserId = p!.id
    this.audit('auth.login', 'session', null, p!.department_id, 'تسجيل دخول')
    this.persist()
    return this.strip(p!)
  }

  async signOut(): Promise<void> {
    if (this.db.sessionUserId) this.audit('auth.logout', 'session', null, null, 'تسجيل خروج')
    this.db.sessionUserId = null
    this.persist()
  }

  async changeOwnPassword(current: string, next: string): Promise<void> {
    await wait()
    const p = this.me()
    if (next.length < 6) fail('كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف')
    if (p.password !== current) fail('كلمة المرور الحالية غير صحيحة')
    p.password = next
    p.must_change_password = false
    this.audit('user.change_password', 'profile', p.id, p.department_id, 'تغيير كلمة المرور الشخصية')
    this.persist()
  }

  onAuthLost(cb: () => void): () => void {
    this.authListeners.add(cb)
    return () => this.authListeners.delete(cb)
  }

  // ---------- الإعدادات ----------
  async getSettings(): Promise<Settings> {
    await wait(10)
    return clone(this.db.settings)
  }

  async updateSettings(patch: Partial<Omit<Settings, 'entry_open'>>): Promise<void> {
    await wait()
    const p = this.me()
    if (p.role !== 'admin' && p.role !== 'dean') fail('ليست لديك صلاحية تعديل الإعدادات.')
    const old = clone(this.db.settings)
    Object.assign(this.db.settings, patch)
    this.audit('settings.update', 'settings', null, null, 'تعديل إعدادات النظام', { old, new: clone(this.db.settings) })
    this.persist()
  }

  async setEntryOpen(open: boolean, departmentId?: string | null): Promise<void> {
    await wait()
    const p = this.me()
    if (!isSuper(p)) fail('فتح وغلق الإدخال من صلاحية الإدارة العليا فقط')
    if (departmentId) {
      const d = this.dept(departmentId) ?? fail('القسم غير موجود')
      if (d.entry_open !== open) {
        d.entry_open = open
        this.audit(open ? 'entry.open' : 'entry.close', 'department', d.id, d.id, `${open ? 'فتح' : 'غلق'} إدخال الدرجات — ${d.name}`)
      }
    } else if (this.db.settings.entry_open !== open) {
      this.db.settings.entry_open = open
      this.audit(open ? 'entry.open' : 'entry.close', 'settings', null, null, `${open ? 'فتح' : 'غلق'} إدخال الدرجات لجميع الأقسام`)
    }
    this.persist()
  }

  // ---------- الأقسام والسنوات ----------
  async listDepartments(): Promise<Department[]> {
    await wait(10)
    return clone([...this.db.departments].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ar')))
  }

  async saveDepartment(d: Partial<Department> & Pick<Department, 'name' | 'code'>): Promise<void> {
    await wait()
    if (!isSuper(this.me())) fail('ليست لديك صلاحية لتنفيذ هذه العملية.')
    const name = d.name.trim()
    const code = d.code.trim().toUpperCase()
    if (!name || !code) fail('يرجى كتابة اسم القسم ورمزه')
    if (this.db.departments.some((x) => x.id !== d.id && (x.name === name || x.code === code))) fail('يوجد قسم بنفس الاسم أو الرمز.')
    if (d.id) {
      const cur = this.dept(d.id) ?? fail('القسم غير موجود')
      Object.assign(cur, { name, code, has_evening: d.has_evening ?? cur.has_evening, stages: d.stages ?? cur.stages, sort: d.sort ?? cur.sort })
      this.audit('department.update', 'department', cur.id, null, name)
    } else {
      const nd: Department = { id: demoId('d'), name, code, has_evening: d.has_evening ?? false, stages: d.stages ?? 4, entry_open: true, sort: d.sort ?? this.db.departments.length + 1 }
      this.db.departments.push(nd)
      this.audit('department.create', 'department', nd.id, null, name)
    }
    this.persist()
  }

  async deleteDepartment(id: string): Promise<void> {
    await wait()
    if (!isSuper(this.me())) fail('ليست لديك صلاحية لتنفيذ هذه العملية.')
    const d = this.dept(id) ?? fail('القسم غير موجود')
    this.cascadeDelete((s) => s.department_id === id, (st) => st.department_id === id)
    this.db.departments = this.db.departments.filter((x) => x.id !== id)
    this.db.profiles.forEach((p) => {
      if (p.department_id === id) p.department_id = null
    })
    this.audit('department.delete', 'department', id, null, d.name)
    this.persist()
  }

  private cascadeDelete(subjectPred: (s: Subject) => boolean, studentPred: (s: Student) => boolean) {
    const sIds = new Set(this.db.subjects.filter(subjectPred).map((s) => s.id))
    const stIds = new Set(this.db.students.filter(studentPred).map((s) => s.id))
    this.db.grades = this.db.grades.filter((g) => !sIds.has(g.subject_id) && !stIds.has(g.student_id))
    this.db.subjects = this.db.subjects.filter((s) => !sIds.has(s.id))
    this.db.students = this.db.students.filter((s) => !stIds.has(s.id))
  }

  async listYears(): Promise<AcademicYear[]> {
    await wait(10)
    return clone([...this.db.years].sort((a, b) => a.label.localeCompare(b.label)))
  }

  async createYear(label: string): Promise<AcademicYear> {
    await wait()
    if (!isSuper(this.me())) fail('ليست لديك صلاحية لتنفيذ هذه العملية.')
    if (!/^\d{4}-\d{4}$/.test(label)) fail('صيغة السنة الدراسية غير صحيحة (مثال: 2026-2027)')
    if (this.db.years.some((y) => y.label === label)) fail('هذه السنة الدراسية موجودة مسبقاً.')
    const y = { id: demoId('y'), label }
    this.db.years.push(y)
    this.persist()
    return clone(y)
  }

  async deleteYear(id: string): Promise<void> {
    await wait()
    if (!isSuper(this.me())) fail('ليست لديك صلاحية لتنفيذ هذه العملية.')
    this.cascadeDelete((s) => s.year_id === id, (st) => st.year_id === id)
    this.db.years = this.db.years.filter((y) => y.id !== id)
    if (this.db.settings.current_year_id === id) this.db.settings.current_year_id = this.db.years[this.db.years.length - 1]?.id ?? null
    this.persist()
  }

  // ---------- الحسابات ----------
  async listProfiles(): Promise<Profile[]> {
    await wait(10)
    this.me()
    return this.db.profiles.map((p) => this.strip(p)).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'))
  }

  async createAccount(a: AccountInput): Promise<string> {
    await wait()
    const me = this.me()
    const dept = me.role === 'head' ? me.department_id : a.department_id
    if (!canManageRole(me, a.role, dept)) fail('ليست لديك صلاحية إنشاء هذا النوع من الحسابات')
    const username = a.username.trim().toLowerCase()
    if (!USERNAME_RE.test(username)) fail('اسم المستخدم يجب أن يتكون من 3 إلى 32 حرفاً إنجليزياً أو رقماً (يسمح بـ . _ -)')
    if (a.password.length < 6) fail('كلمة المرور يجب أن لا تقل عن 6 أحرف')
    if (a.full_name.trim().length < 3) fail('يرجى كتابة الاسم الكامل')
    if (a.role === 'head' && !dept) fail('يجب تحديد القسم لحساب مقرر القسم')
    if (this.db.profiles.some((p) => p.username === username)) fail(`اسم المستخدم "${username}" مستخدم مسبقاً`)
    const p: DemoProfile = {
      id: demoId('u'),
      username,
      full_name: a.full_name.trim().replace(/\s+/g, ' '),
      title: a.title?.trim() || null,
      role: a.role,
      department_id: dept,
      active: true,
      must_change_password: true,
      created_at: new Date().toISOString(),
      password: a.password,
    }
    this.db.profiles.push(p)
    this.audit('user.create', 'profile', p.id, dept, `إنشاء حساب: ${p.full_name} (${username})`, { role: a.role })
    this.persist()
    return p.id
  }

  async updateAccount(a: AccountUpdate): Promise<void> {
    await wait()
    const me = this.me()
    const target = this.db.profiles.find((p) => p.id === a.id) ?? fail('الحساب غير موجود')
    const dept = me.role === 'head' ? me.department_id : a.department_id
    if (!canManageUser(me, target) || !canManageRole(me, a.role, dept)) fail('ليست لديك صلاحية تعديل هذا الحساب')
    if (a.role === 'head' && !dept) fail('يجب تحديد القسم لحساب مقرر القسم')
    if (target.role === 'admin' && (a.role !== 'admin' || !a.active) && this.db.profiles.filter((p) => p.role === 'admin' && p.active).length <= 1) {
      fail('لا يمكن إلغاء آخر حساب مدير نظام')
    }
    const old = this.strip(target)
    Object.assign(target, { full_name: a.full_name.trim().replace(/\s+/g, ' '), title: a.title?.trim() || null, role: a.role, department_id: dept, active: a.active })
    this.audit('user.update', 'profile', target.id, dept ?? old.department_id, `تعديل حساب: ${old.full_name}`, { old, new: a })
    this.persist()
  }

  async resetPassword(userId: string, password: string): Promise<void> {
    await wait()
    const me = this.me()
    const target = this.db.profiles.find((p) => p.id === userId) ?? fail('الحساب غير موجود')
    if (!canManageUser(me, target)) fail('ليست لديك صلاحية على هذا الحساب')
    if (password.length < 6) fail('كلمة المرور يجب أن لا تقل عن 6 أحرف')
    target.password = password
    target.must_change_password = true
    this.audit('user.reset_password', 'profile', target.id, target.department_id, `إعادة تعيين كلمة مرور: ${target.full_name}`)
    this.persist()
  }

  async deleteAccount(userId: string): Promise<void> {
    await wait()
    const me = this.me()
    const target = this.db.profiles.find((p) => p.id === userId) ?? fail('الحساب غير موجود')
    if ((me.role !== 'admin' && me.role !== 'dean') || !canManageUser(me, target)) fail('حذف الحسابات من صلاحية مدير النظام والعميد فقط')
    if (target.role === 'admin' && this.db.profiles.filter((p) => p.role === 'admin' && p.active).length <= 1) fail('لا يمكن حذف آخر حساب مدير نظام')
    this.db.subjects.forEach((s) => (s.teacher_ids = s.teacher_ids.filter((t) => t !== userId)))
    this.db.profiles = this.db.profiles.filter((p) => p.id !== userId)
    this.audit('user.delete', 'profile', userId, target.department_id, `حذف حساب: ${target.full_name} (${target.username})`)
    this.persist()
  }

  // ---------- الطلبة ----------
  async listStudents(k: ClassKey): Promise<Student[]> {
    await wait(15)
    const me = this.me()
    if (!this.canSeeClass(me, k)) return []
    return clone(this.db.students.filter((s) => sameClass(s, k)).sort((a, b) => a.seq - b.seq))
  }

  async addStudents(k: ClassKey, names: string[]) {
    await wait()
    const me = this.me()
    if (!canManageDepartment(me, k.department_id)) fail('ليست لديك صلاحية إضافة طلبة لهذا القسم')
    const cls = this.db.students.filter((s) => sameClass(s, k))
    const existing = new Set(cls.map((s) => s.full_name))
    let seq = cls.reduce((m, s) => Math.max(m, s.seq), 0)
    let added = 0
    const skipped: string[] = []
    for (const raw of names) {
      const name = raw.trim().replace(/\s+/g, ' ')
      if (!name) continue
      if (existing.has(name)) {
        skipped.push(name)
        continue
      }
      existing.add(name)
      this.db.students.push({ id: demoId('st'), ...k, seq: ++seq, full_name: name, status: 'active', notes: null })
      added++
    }
    if (added) {
      this.audit('student.import', 'class', null, k.department_id, `إضافة ${added} طالب — المرحلة ${k.stage} — ${SHIFT_LABEL[k.shift]}`, { ...k, count: added })
    }
    this.persist()
    return { added, skipped }
  }

  async updateStudent(id: string, patch: StudentPatch): Promise<void> {
    await wait()
    const me = this.me()
    const st = this.db.students.find((s) => s.id === id) ?? fail('الطالب غير موجود')
    if (!canManageDepartment(me, st.department_id)) fail('ليست لديك صلاحية تعديل هذا الطالب.')
    const name = patch.full_name?.trim().replace(/\s+/g, ' ')
    if (name !== undefined) {
      if (!name) fail('اسم الطالب مطلوب')
      if (this.db.students.some((s) => s.id !== id && sameClass(s, st) && s.full_name === name)) fail('يوجد طالب بنفس الاسم في هذا الصف.')
    }
    const old = clone(st)
    Object.assign(st, { ...patch, ...(name !== undefined ? { full_name: name } : {}) })
    this.audit('student.update', 'student', id, st.department_id, old.full_name, { old, new: clone(st) })
    this.persist()
  }

  async deleteStudent(id: string): Promise<void> {
    await wait()
    const me = this.me()
    const st = this.db.students.find((s) => s.id === id) ?? fail('الطالب غير موجود')
    if (!canManageDepartment(me, st.department_id)) fail('ليست لديك صلاحية حذف هذا الطالب.')
    if (!isSuper(me) && this.db.grades.some((g) => g.student_id === id && hasValues(g))) {
      fail('لا يمكن حذف طالب لديه درجات مسجلة. يمكنك تغيير حالته إلى منسحب أو مؤجل.')
    }
    this.db.grades = this.db.grades.filter((g) => g.student_id !== id)
    this.db.students = this.db.students.filter((s) => s.id !== id)
    this.audit('student.delete', 'student', id, st.department_id, st.full_name)
    this.persist()
  }

  async reorderStudents(ids: string[]): Promise<void> {
    await wait()
    const me = this.me()
    ids.forEach((id, i) => {
      const st = this.db.students.find((s) => s.id === id)
      if (st && canManageDepartment(me, st.department_id)) st.seq = i + 1
    })
    this.persist()
  }

  // ---------- المواد ----------
  async listSubjects(f: SubjectFilter): Promise<Subject[]> {
    await wait(15)
    const me = this.me()
    return clone(
      this.db.subjects
        .filter(
          (s) =>
            s.year_id === f.year_id &&
            (!f.department_id || s.department_id === f.department_id) &&
            (!f.stage || s.stage === f.stage) &&
            (!f.shift || s.shift === f.shift) &&
            (!f.term || s.term === f.term) &&
            (!f.teacher_id || s.teacher_ids.includes(f.teacher_id)) &&
            this.canSeeSubject(me, s),
        )
        .sort((a, b) => a.term - b.term || a.sort - b.sort || a.name.localeCompare(b.name, 'ar')),
    )
  }

  async getSubject(id: string): Promise<Subject | null> {
    await wait(10)
    const me = this.me()
    const s = this.db.subjects.find((x) => x.id === id)
    return s && this.canSeeSubject(me, s) ? clone(s) : null
  }

  async saveSubject(input: SubjectInput): Promise<Subject> {
    await wait()
    const me = this.me()
    if (!canManageDepartment(me, input.department_id)) fail('ليست لديك صلاحية لتنفيذ هذه العملية.')
    const name = input.name.trim()
    if (!name) fail('اسم المادة مطلوب')
    const cw = round2(input.coursework_max)
    const cwp = round2(input.cw_practical_max)
    const pr = round2(input.practical_max)
    if (cw < 0 || pr < 0 || cw + pr > 100 || cwp < 0 || cwp > cw) fail('قيمة غير صالحة. تحقق من البيانات المدخلة.')
    if (this.db.subjects.some((s) => s.id !== input.id && sameClass(s, input) && s.term === input.term && s.name === name)) {
      fail('توجد مادة بنفس الاسم في هذا الصف والفصل.')
    }
    const next = { ...input, name, coursework_max: cw, cw_practical_max: cwp, practical_max: pr, final_max: finalMaxOf(cw, pr) }
    if (input.id) {
      const cur = this.db.subjects.find((s) => s.id === input.id) ?? fail('المادة غير موجودة')
      if (!canManageDepartment(me, cur.department_id)) fail('ليست لديك صلاحية لتنفيذ هذه العملية.')
      const gs = this.db.grades.filter((g) => g.subject_id === cur.id)
      const withValues = gs.some(hasValues)
      if (!sameClass(cur, next) && withValues) fail('لا يمكن نقل مادة تحتوي على درجات إلى صف آخر')
      const schemeChanged = cur.coursework_max !== cw || cur.cw_practical_max !== cwp || cur.practical_max !== pr
      if (schemeChanged) {
        if ((cur.status === 'submitted' || cur.status === 'approved') && !isSuper(me)) fail('لا يمكن تعديل توزيع الدرجات لقائمة مرسلة أو معتمدة')
        const tmax = cwTheoryMax(next)
        const bad = gs.some(
          (g) =>
            (g.cw_theory ?? 0) > tmax ||
            (cwp === 0 && g.cw_practical != null) ||
            (g.cw_practical ?? 0) > cwp ||
            (pr === 0 && g.final_practical != null) ||
            (g.final_practical ?? 0) > pr ||
            (g.final_theory ?? 0) > next.final_max,
        )
        if (bad) fail('توزيع الدرجات الجديد لا يتوافق مع درجات مُدخلة مسبقاً. عدّل الدرجات أولاً.')
      }
      const old = clone(cur)
      Object.assign(cur, next)
      this.audit('subject.update', 'subject', cur.id, cur.department_id, cur.name, { old, new: clone(cur) })
      this.persist()
      return clone(cur)
    }
    const s: Subject = {
      ...next,
      id: demoId('sb'),
      status: 'draft',
      status_note: null,
      submitted_at: null,
      submitted_by: null,
      reviewed_at: null,
      reviewed_by: null,
    }
    this.db.subjects.push(s)
    this.audit('subject.create', 'subject', s.id, s.department_id, s.name)
    this.persist()
    return clone(s)
  }

  async deleteSubject(id: string): Promise<void> {
    await wait()
    const me = this.me()
    const s = this.db.subjects.find((x) => x.id === id) ?? fail('المادة غير موجودة')
    if (!canManageDepartment(me, s.department_id)) fail('ليست لديك صلاحية حذف هذه المادة.')
    if (!isSuper(me) && this.db.grades.some((g) => g.subject_id === id && hasValues(g))) {
      fail('لا يمكن حذف مادة تحتوي على درجات. تواصل مع الإدارة.')
    }
    this.db.grades = this.db.grades.filter((g) => g.subject_id !== id)
    this.db.subjects = this.db.subjects.filter((x) => x.id !== id)
    this.audit('subject.delete', 'subject', id, s.department_id, s.name)
    this.persist()
  }

  async copySubjects(from: ClassKey & { term: Term }, to: ClassKey & { term: Term }, withTeachers: boolean): Promise<number> {
    await wait()
    const me = this.me()
    if (!canManageDepartment(me, to.department_id)) fail('ليست لديك صلاحية على القسم الهدف')
    const src = this.db.subjects.filter((s) => sameClass(s, from) && s.term === from.term)
    let n = 0
    for (const s of src) {
      if (this.db.subjects.some((x) => sameClass(x, to) && x.term === to.term && x.name === s.name)) continue
      const c: Subject = {
        ...clone(s),
        ...{ year_id: to.year_id, department_id: to.department_id, stage: to.stage, shift: to.shift, term: to.term },
        id: demoId('sb'),
        teacher_ids: withTeachers ? [...s.teacher_ids] : [],
        status: 'draft',
        status_note: null,
        submitted_at: null,
        submitted_by: null,
        reviewed_at: null,
        reviewed_by: null,
      }
      this.db.subjects.push(c)
      this.audit('subject.create', 'subject', c.id, c.department_id, c.name)
      n++
    }
    this.persist()
    return n
  }

  async setSubjectStatus(id: string, status: SubjectStatus, note?: string | null): Promise<void> {
    await wait()
    const me = this.me()
    const s = this.db.subjects.find((x) => x.id === id) ?? fail('المادة غير موجودة')
    const n = note?.trim() || null
    const sup = isSuper(me)
    if (status === 'submitted') {
      if (s.status !== 'draft' && s.status !== 'returned') fail('لا يمكن إرسال القائمة في حالتها الحالية')
      const block = gradeEditBlock(me, s, this.db.settings, this.dept(s.department_id))
      if (block) fail(block)
    } else if (status === 'approved' || status === 'returned') {
      if (!canReview(me)) fail('التدقيق والاعتماد من صلاحية اللجنة الامتحانية والإدارة')
      if (status === 'approved' && s.status === 'approved') fail('القائمة معتمدة مسبقاً')
      if (status === 'approved' && s.status !== 'submitted' && me.role === 'committee') fail('لا يمكن اعتماد قائمة لم تُرسل بعد')
      if (status === 'returned' && s.status === 'approved' && !sup) fail('إعادة فتح قائمة معتمدة من صلاحية الإدارة العليا فقط')
      if (status === 'returned' && s.status !== 'submitted' && s.status !== 'approved') fail('لا يمكن إعادة قائمة لم تُرسل')
      if (status === 'returned' && !n) fail('يرجى كتابة ملاحظة توضح سبب الإعادة')
    } else if (status === 'draft') {
      if (!sup) fail('إعادة القائمة إلى مسودة من صلاحية الإدارة العليا فقط')
    }
    const from = s.status
    const now = new Date().toISOString()
    s.status = status
    if (status === 'submitted') {
      s.submitted_at = now
      s.submitted_by = me.id
    } else {
      s.status_note = n
    }
    if (status === 'approved' || status === 'returned') {
      s.reviewed_at = now
      s.reviewed_by = me.id
    }
    const suffix = { submitted: ' — إرسال إلى اللجنة', approved: ' — اعتماد', returned: ' — إعادة للتعديل', draft: ' — إعادة إلى مسودة' }[status]
    this.audit(`subject.${status}`, 'subject', s.id, s.department_id, s.name + suffix, { from, to: status, note: n })
    this.persist()
  }

  // ---------- الدرجات ----------
  async getGrades(subjectIds: string[]): Promise<Grade[]> {
    await wait(20)
    const me = this.me()
    const visible = new Set(
      this.db.subjects.filter((s) => subjectIds.includes(s.id) && this.canSeeSubject(me, s)).map((s) => s.id),
    )
    return clone(this.db.grades.filter((g) => visible.has(g.subject_id)))
  }

  async saveGrades(subjectId: string, rows: GradeRowInput[], reason?: string | null): Promise<string> {
    await wait(120)
    const me = this.me()
    const s = this.db.subjects.find((x) => x.id === subjectId) ?? fail('المادة غير موجودة')
    const block = gradeEditBlock(me, s, this.db.settings, this.dept(s.department_id))
    if (block) fail(block)
    if (!canWriteSubject(me, s)) fail('ليست لديك صلاحية على درجات هذه المادة')
    const why = reason?.trim() || null
    if (s.status === 'approved' && !why) fail('تعديل قائمة معتمدة يتطلب ذكر سبب التعديل')
    const tmax = cwTheoryMax(s)
    const check = (v: number | null, max: number, label: string) => {
      if (v != null && (v < 0 || v > max)) fail(`درجة ${label} يجب أن تكون بين 0 و ${max}`)
    }
    // تحقق كامل قبل أي كتابة (كالمعاملة في قاعدة البيانات)
    const prepared = rows.map((r) => {
      const st = this.db.students.find((x) => x.id === r.student_id)
      if (!st || !sameClass(st, s)) fail('الطالب لا ينتمي إلى صف هذه المادة')
      const v = {
        cw_theory: tmax > 0 ? r.cw_theory : null,
        cw_practical: s.cw_practical_max > 0 ? r.cw_practical : null,
        final_practical: s.practical_max > 0 ? r.final_practical : null,
        final_theory: s.final_max > 0 ? r.final_theory : null,
        special: r.special || null,
        note: r.note?.trim() || null,
      }
      check(v.cw_theory, tmax, 'السعي (النظري)')
      check(v.cw_practical, s.cw_practical_max, 'السعي (العملي)')
      check(v.final_practical, s.practical_max, 'العملي النهائي')
      check(v.final_theory, s.final_max, 'الامتحان النهائي')
      return { st: st!, v }
    })
    const now = new Date().toISOString()
    for (const { st, v } of prepared) {
      const cur = this.db.grades.find((g) => g.subject_id === subjectId && g.student_id === st.id)
      const fields = ['cw_theory', 'cw_practical', 'final_practical', 'final_theory', 'special', 'note'] as const
      if (cur) {
        if (fields.every((f) => cur[f] === v[f])) continue
        const old = Object.fromEntries(fields.map((f) => [f, cur[f]]))
        Object.assign(cur, v, { updated_at: now, updated_by: me.id })
        this.audit('grade.update', 'grade', subjectId, s.department_id, `${s.name} — ${st.full_name}`, { subject_id: subjectId, student_id: st.id, old, new: v, reason: why })
      } else {
        this.db.grades.push({ subject_id: subjectId, student_id: st.id, ...v, updated_at: now, updated_by: me.id })
        this.audit('grade.create', 'grade', subjectId, s.department_id, `${s.name} — ${st.full_name}`, { subject_id: subjectId, student_id: st.id, old: null, new: v, reason: why })
      }
    }
    this.persist()
    return now
  }

  // ---------- المتابعة والسجل ----------
  async listProgress(yearId: string): Promise<SubjectProgress[]> {
    await wait(20)
    const me = this.me()
    const st = this.db.settings
    return this.db.subjects
      .filter((s) => s.year_id === yearId && this.canSeeSubject(me, s))
      .map((s) => {
        const cls = this.db.students.filter((x) => sameClass(x, s) && x.status === 'active')
        const gmap = new Map(this.db.grades.filter((g) => g.subject_id === s.id).map((g) => [g.student_id, g]))
        const rs = cls.map((x) => computeRow(s, gmap.get(x.id), st))
        const totals = rs.map((r) => r.total).filter((t): t is number => t != null)
        return {
          subject_id: s.id,
          year_id: s.year_id,
          department_id: s.department_id,
          stage: s.stage,
          shift: s.shift,
          term: s.term,
          status: s.status,
          n_students: cls.length,
          n_complete: rs.filter((r) => r.complete).length,
          n_pass: totals.filter((t) => t >= st.pass_mark).length,
          n_fail: totals.filter((t) => t < st.pass_mark).length,
          n_special: rs.filter((r) => r.special != null).length,
          avg_total: totals.length ? round2(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
        }
      })
  }

  async listAudit(f: AuditFilter): Promise<AuditEntry[]> {
    await wait(20)
    const me = this.me()
    const term = f.search ? normalizeArabic(f.search) : ''
    return clone(
      this.db.audit
        .filter(
          (a) =>
            (canViewAll(me) || (me.role === 'head' && a.department_id === me.department_id)) &&
            (!f.department_id || a.department_id === f.department_id) &&
            (!f.action_prefix || a.action.startsWith(f.action_prefix)) &&
            (!f.before_id || a.id < f.before_id) &&
            (!term || normalizeArabic(`${a.summary ?? ''} ${a.user_name ?? ''}`).includes(term)),
        )
        .sort((a, b) => b.id - a.id)
        .slice(0, f.limit ?? 100),
    )
  }

  async exportSnapshot(): Promise<Record<string, unknown>> {
    await wait()
    const me = this.me()
    if (me.role !== 'admin' && me.role !== 'dean') fail('النسخ الاحتياطي من صلاحية مدير النظام والعميد')
    this.audit('backup.export', 'session', null, null, 'تصدير نسخة احتياطية كاملة')
    this.persist()
    return {
      exported_at: new Date().toISOString(),
      source: 'demo',
      settings: [clone(this.db.settings)],
      departments: clone(this.db.departments),
      academic_years: clone(this.db.years),
      profiles: this.db.profiles.map((p) => this.strip(p)),
      students: clone(this.db.students),
      subjects: clone(this.db.subjects),
      grades: clone(this.db.grades),
    }
  }

  async logEvent(action: string, summary?: string | null, details?: Record<string, unknown> | null): Promise<void> {
    if (!this.db.sessionUserId) return
    const me = this.db.profiles.find((p) => p.id === this.db.sessionUserId)
    this.audit(action, 'session', null, me?.department_id ?? null, summary ?? action, details ?? null)
    this.persist()
  }
}
