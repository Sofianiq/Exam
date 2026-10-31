import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { usernameToEmail } from '../lib/password'
import type {
  Announcement,
  AnnouncementInput,
  AcademicYear,
  AccountInput,
  AccountUpdate,
  AuditEntry,
  AuditFilter,
  ClassKey,
  CurriculumInput,
  CurriculumItem,
  Department,
  Grade,
  GradeRowInput,
  Profile,
  Round,
  Settings,
  Student,
  Subject,
  SubjectInput,
  SubjectProgress,
  SubjectStatus,
  Term,
} from '../lib/types'
import { AppError, type Backend, type StudentPatch, type SubjectFilter } from './backend'

interface PgError {
  message: string
  code?: string
  details?: string | null
  hint?: string | null
}

const ARABIC = /[\u0600-\u06FF]/

/** يحوّل أخطاء Supabase/PostgreSQL إلى رسائل عربية مفهومة */
export function translateError(e: PgError | Error | unknown): AppError {
  const err = (e ?? {}) as PgError
  const msg = String(err.message ?? e ?? '')
  if (ARABIC.test(msg)) return new AppError(msg)
  if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(msg)) {
    return new AppError('تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد المحاولة.')
  }
  if (/JWT expired|invalid JWT|refresh_token/i.test(msg)) {
    return new AppError('انتهت الجلسة. يرجى تسجيل الدخول مجدداً.')
  }
  if (/row-level security|permission denied/i.test(msg) || err.code === '42501') {
    return new AppError('ليست لديك صلاحية لتنفيذ هذه العملية.')
  }
  if (err.code === '23505') {
    if (/students/.test(msg + (err.details ?? ''))) return new AppError('يوجد طالب بنفس الاسم في هذا الصف.')
    if (/subjects/.test(msg + (err.details ?? ''))) return new AppError('توجد مادة بنفس الاسم في هذا الصف والفصل.')
    if (/academic_years/.test(msg + (err.details ?? ''))) return new AppError('هذه السنة الدراسية موجودة مسبقاً.')
    if (/departments/.test(msg + (err.details ?? ''))) return new AppError('يوجد قسم بنفس الاسم أو الرمز.')
    if (/curriculum/.test(msg + (err.details ?? ''))) return new AppError('توجد مادة بنفس الاسم في هذه المرحلة والفصل من الخطة.')
    return new AppError('القيمة موجودة مسبقاً.')
  }
  if (err.code === '23503') return new AppError('لا يمكن تنفيذ العملية لوجود بيانات مرتبطة.')
  if (err.code === '23514' || err.code === '22P02') return new AppError('قيمة غير صالحة. تحقق من البيانات المدخلة.')
  return new AppError(msg || 'حدث خطأ غير متوقع.')
}

type Res<T> = { data: T | null; error: PgError | null }

function must<T>(res: Res<T>): T {
  if (res.error) throw translateError(res.error)
  return res.data as T
}

const PAGE = 1000

/** يجلب كل الصفوف على دفعات لتجاوز حد 1000 صف في Supabase */
async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<Res<T[]>>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const rows = must(await make(from, from + PAGE - 1)) ?? []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

const SUBJECT_WRITABLE = [
  'year_id',
  'department_id',
  'stage',
  'shift',
  'term',
  'name',
  'code',
  'units',
  'teacher_ids',
  'coursework_max',
  'cw_practical_max',
  'practical_max',
  'sort',
  'ministerial',
  'final_min',
] as const

export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const
  private sb: SupabaseClient

  constructor(url: string, anonKey: string) {
    this.sb = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'exam.auth' },
    })
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    try {
      return must<T>(await this.sb.rpc(fn, args))
    } catch (e) {
      throw e instanceof AppError ? e : translateError(e)
    }
  }

  // ---------- الجلسة ----------
  async currentProfile(): Promise<Profile | null> {
    const { data } = await this.sb.auth.getSession()
    const uid = data.session?.user.id
    if (!uid) return null
    const res = await this.sb.from('profiles').select('*').eq('id', uid).maybeSingle()
    if (res.error) throw translateError(res.error)
    const p = res.data as Profile | null
    if (!p || !p.active) {
      await this.sb.auth.signOut()
      return null
    }
    return p
  }

  async signIn(username: string, password: string): Promise<Profile> {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: usernameToEmail(username), password })
    if (error) {
      if (/invalid login credentials/i.test(error.message)) throw new AppError('اسم المستخدم أو كلمة المرور غير صحيحة.')
      if (/banned/i.test(error.message)) throw new AppError('هذا الحساب موقوف. راجع إدارة النظام.')
      throw translateError(error)
    }
    const res = await this.sb.from('profiles').select('*').eq('id', data.user.id).maybeSingle()
    const p = res.data as Profile | null
    if (res.error || !p || !p.active) {
      await this.sb.auth.signOut()
      throw new AppError('الحساب غير مفعل. راجع إدارة النظام.')
    }
    void this.logEvent('auth.login', 'تسجيل دخول')
    return p
  }

  async signOut(): Promise<void> {
    await this.logEvent('auth.logout', 'تسجيل خروج')
    await this.sb.auth.signOut()
  }

  async changeOwnPassword(current: string, next: string): Promise<void> {
    await this.rpc('change_my_password', { p_current: current, p_new: next })
  }

  onAuthLost(cb: () => void): () => void {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') cb()
    })
    return () => data.subscription.unsubscribe()
  }

  // ---------- الإعدادات ----------
  async getSettings(): Promise<Settings> {
    const s = must(await this.sb.from('settings').select('*').eq('id', 1).single()) as Settings
    return {
      ...s,
      pass_mark: Number(s.pass_mark),
      second_round_cap: s.second_round_cap == null ? null : Number(s.second_round_cap),
      max_failed_subjects: s.max_failed_subjects ?? 2,
      hide_grades_when_closed: s.hide_grades_when_closed ?? true,
    }
  }

  async updateSettings(patch: Partial<Omit<Settings, 'entry_open'>>): Promise<void> {
    const rows = must(await this.sb.from('settings').update(patch).eq('id', 1).select('id'))
    if (!rows || rows.length === 0) throw new AppError('ليست لديك صلاحية تعديل الإعدادات.')
  }

  async setEntryOpen(open: boolean, departmentId?: string | null): Promise<void> {
    await this.rpc('set_entry_open', { p_open: open, p_department_id: departmentId ?? null })
  }

  // ---------- الأقسام والسنوات ----------
  async listDepartments(): Promise<Department[]> {
    return must(await this.sb.from('departments').select('*').order('sort').order('name')) as Department[]
  }

  async saveDepartment(d: Partial<Department> & Pick<Department, 'name' | 'code'>): Promise<void> {
    const payload = {
      name: d.name.trim(),
      code: d.code.trim().toUpperCase(),
      has_evening: d.has_evening ?? false,
      stages: d.stages ?? 4,
      sort: d.sort ?? 0,
      head_name: d.head_name?.trim() || null,
    }
    if (d.id) must(await this.sb.from('departments').update(payload).eq('id', d.id).select('id').single())
    else must(await this.sb.from('departments').insert(payload).select('id').single())
  }

  async deleteDepartment(id: string): Promise<void> {
    must(await this.sb.from('departments').delete().eq('id', id))
  }

  async listYears(): Promise<AcademicYear[]> {
    return must(await this.sb.from('academic_years').select('id,label').order('label')) as AcademicYear[]
  }

  async createYear(label: string): Promise<AcademicYear> {
    return must(await this.sb.from('academic_years').insert({ label }).select('id,label').single()) as AcademicYear
  }

  async deleteYear(id: string): Promise<void> {
    must(await this.sb.from('academic_years').delete().eq('id', id))
  }

  // ---------- الحسابات ----------
  async listProfiles(): Promise<Profile[]> {
    return fetchAll<Profile>((a, b) => this.sb.from('profiles').select('*').order('full_name').order('id').range(a, b))
  }

  async createAccount(a: AccountInput): Promise<string> {
    return this.rpc<string>('create_account', {
      p_username: a.username,
      p_password: a.password,
      p_full_name: a.full_name,
      p_role: a.role,
      p_department_id: a.department_id,
      p_title: a.title ?? null,
    })
  }

  async updateAccount(a: AccountUpdate): Promise<void> {
    await this.rpc('update_account', {
      p_user_id: a.id,
      p_full_name: a.full_name,
      p_title: a.title,
      p_role: a.role,
      p_department_id: a.department_id,
      p_active: a.active,
    })
  }

  async resetPassword(userId: string, password: string): Promise<void> {
    await this.rpc('reset_password', { p_user_id: userId, p_password: password })
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.rpc('delete_account', { p_user_id: userId })
  }

  // ---------- الطلبة ----------
  async listStudents(k: ClassKey): Promise<Student[]> {
    return fetchAll<Student>((a, b) =>
      this.sb
        .from('students')
        .select('*')
        .eq('year_id', k.year_id)
        .eq('department_id', k.department_id)
        .eq('stage', k.stage)
        .eq('shift', k.shift)
        .order('seq')
        .order('id')
        .range(a, b),
    )
  }

  async getStudent(id: string): Promise<Student | null> {
    return must(await this.sb.from('students').select('*').eq('id', id).maybeSingle()) as Student | null
  }

  async searchStudents(yearId: string, query: string): Promise<Student[]> {
    const term = query.replace(/[,()%*\\]/g, ' ').trim()
    if (term.length < 2) return []
    return must(
      await this.sb
        .from('students')
        .select('*')
        .eq('year_id', yearId)
        .ilike('full_name', `%${term}%`)
        .order('full_name')
        .limit(60),
    ) as Student[]
  }

  async addStudents(k: ClassKey, names: string[]) {
    return this.rpc<{ added: number; skipped: string[] }>('add_students', {
      p_year_id: k.year_id,
      p_department_id: k.department_id,
      p_stage: k.stage,
      p_shift: k.shift,
      p_names: names,
    })
  }

  async updateStudent(id: string, patch: StudentPatch): Promise<void> {
    const rows = must(await this.sb.from('students').update(patch).eq('id', id).select('id'))
    if (!rows || rows.length === 0) throw new AppError('ليست لديك صلاحية تعديل هذا الطالب.')
  }

  async deleteStudent(id: string): Promise<void> {
    const rows = must(await this.sb.from('students').delete().eq('id', id).select('id'))
    if (!rows || rows.length === 0) throw new AppError('ليست لديك صلاحية حذف هذا الطالب.')
  }

  async reorderStudents(ids: string[]): Promise<void> {
    await this.rpc('reorder_students', { p_ids: ids })
  }

  // ---------- المواد ----------
  async listSubjects(f: SubjectFilter): Promise<Subject[]> {
    return fetchAll<Subject>((a, b) => {
      let q = this.sb.from('subjects').select('*').eq('year_id', f.year_id)
      if (f.department_id) q = q.eq('department_id', f.department_id)
      if (f.stage) q = q.eq('stage', f.stage)
      if (f.shift) q = q.eq('shift', f.shift)
      if (f.term) q = q.eq('term', f.term)
      if (f.teacher_id) q = q.contains('teacher_ids', [f.teacher_id])
      return q.order('term').order('sort').order('name').order('id').range(a, b)
    }).then((rows) => rows.map(normalizeSubject))
  }

  async getSubject(id: string): Promise<Subject | null> {
    const s = must(await this.sb.from('subjects').select('*').eq('id', id).maybeSingle()) as Subject | null
    return s ? normalizeSubject(s) : null
  }

  async saveSubject(s: SubjectInput): Promise<Subject> {
    const payload: Record<string, unknown> = {}
    for (const k of SUBJECT_WRITABLE) payload[k] = s[k]
    const res = s.id
      ? await this.sb.from('subjects').update(payload).eq('id', s.id).select('*').single()
      : await this.sb.from('subjects').insert(payload).select('*').single()
    return normalizeSubject(must(res) as Subject)
  }

  async deleteSubject(id: string): Promise<void> {
    const rows = must(await this.sb.from('subjects').delete().eq('id', id).select('id'))
    if (!rows || rows.length === 0) throw new AppError('ليست لديك صلاحية حذف هذه المادة.')
  }

  async copySubjects(from: ClassKey & { term: Term }, to: ClassKey & { term: Term }, withTeachers: boolean) {
    return this.rpc<number>('copy_subjects', {
      p_from_year: from.year_id,
      p_from_dept: from.department_id,
      p_from_stage: from.stage,
      p_from_shift: from.shift,
      p_from_term: from.term,
      p_to_year: to.year_id,
      p_to_dept: to.department_id,
      p_to_stage: to.stage,
      p_to_shift: to.shift,
      p_to_term: to.term,
      p_with_teachers: withTeachers,
    })
  }

  async setSubjectStatus(id: string, status: SubjectStatus, note?: string | null, round: Round = 1): Promise<void> {
    await this.rpc('set_subject_status', { p_subject_id: id, p_status: status, p_note: note ?? null, p_round: round })
  }

  // ---------- الخطة الدراسية ----------
  async listCurriculum(departmentId: string): Promise<CurriculumItem[]> {
    const rows = await fetchAll<CurriculumItem>((a, b) =>
      this.sb
        .from('curriculum')
        .select('*')
        .eq('department_id', departmentId)
        .order('stage')
        .order('term')
        .order('sort')
        .order('id')
        .range(a, b),
    )
    return rows.map((c) => ({
      ...c,
      theory_hours: Number(c.theory_hours),
      practical_hours: Number(c.practical_hours),
      units: Number(c.units),
      ministerial: !!c.ministerial,
    }))
  }

  async saveCurriculum(c: CurriculumInput): Promise<void> {
    const payload = {
      department_id: c.department_id,
      stage: c.stage,
      term: c.term,
      sort: c.sort,
      name: c.name.trim(),
      name_en: c.name_en?.trim() || null,
      category: c.category?.trim() || null,
      language: c.language?.trim() || null,
      theory_hours: c.theory_hours,
      practical_hours: c.practical_hours,
      units: c.units,
      ministerial: !!c.ministerial,
    }
    const res = c.id
      ? await this.sb.from('curriculum').update(payload).eq('id', c.id).select('id')
      : await this.sb.from('curriculum').insert(payload).select('id')
    const rows = must(res)
    if (!rows || rows.length === 0) throw new AppError('ليست لديك صلاحية تعديل الخطة الدراسية لهذا القسم.')
  }

  async deleteCurriculum(id: string): Promise<void> {
    const rows = must(await this.sb.from('curriculum').delete().eq('id', id).select('id'))
    if (!rows || rows.length === 0) throw new AppError('ليست لديك صلاحية تعديل الخطة الدراسية لهذا القسم.')
  }

  // ---------- الإعلانات ----------
  async listAnnouncements(): Promise<Announcement[]> {
    return must(await this.sb.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(200)) as Announcement[]
  }

  async saveAnnouncement(a: AnnouncementInput): Promise<void> {
    const payload = {
      title: a.title.trim(),
      body: a.body.trim(),
      level: a.level,
      department_id: a.department_id,
      audience: a.audience,
      pinned: a.pinned,
      expires_at: a.expires_at,
    }
    const res = a.id
      ? await this.sb.from('announcements').update(payload).eq('id', a.id).select('id')
      : await this.sb.from('announcements').insert(payload).select('id')
    const rows = must(res)
    if (!rows || rows.length === 0) throw new AppError('ليست لديك صلاحية تعديل هذا الإعلان.')
  }

  async deleteAnnouncement(id: string): Promise<void> {
    const rows = must(await this.sb.from('announcements').delete().eq('id', id).select('id'))
    if (!rows || rows.length === 0) throw new AppError('ليست لديك صلاحية حذف هذا الإعلان.')
  }

  // ---------- الدرجات ----------
  async getGrades(subjectIds: string[]): Promise<Grade[]> {
    const out: Grade[] = []
    for (let i = 0; i < subjectIds.length; i += 60) {
      const chunk = subjectIds.slice(i, i + 60)
      const rows = await fetchAll<Grade>((a, b) =>
        this.sb.from('grades').select('*').in('subject_id', chunk).order('subject_id').order('student_id').range(a, b),
      )
      out.push(...rows.map(normalizeGrade))
    }
    return out
  }

  async saveGrades(subjectId: string, rows: GradeRowInput[], reason?: string | null): Promise<string> {
    return this.rpc<string>('save_grades', { p_subject_id: subjectId, p_rows: rows, p_reason: reason ?? null })
  }

  // ---------- المتابعة والسجل ----------
  async listProgress(yearId: string): Promise<SubjectProgress[]> {
    const rows = await fetchAll<SubjectProgress>((a, b) =>
      this.sb.from('subject_progress').select('*').eq('year_id', yearId).order('subject_id').range(a, b),
    )
    return rows.map((r) => ({
      ...r,
      avg_total: r.avg_total == null ? null : Number(r.avg_total),
      n_r2_needed: r.n_r2_needed ?? 0,
      n_r2_done: r.n_r2_done ?? 0,
      r2_status: r.r2_status ?? 'draft',
    }))
  }

  async listAudit(f: AuditFilter): Promise<AuditEntry[]> {
    let q = this.sb.from('audit_log').select('*').order('id', { ascending: false }).limit(f.limit ?? 100)
    if (f.department_id) q = q.eq('department_id', f.department_id)
    if (f.action_prefix) q = q.like('action', `${f.action_prefix}%`)
    if (f.before_id) q = q.lt('id', f.before_id)
    const term = f.search?.replace(/[,()%*\\]/g, ' ').trim()
    if (term) q = q.or(`summary.ilike.*${term}*,user_name.ilike.*${term}*`)
    return must(await q) as AuditEntry[]
  }

  async exportSnapshot(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), source: 'supabase' }
    for (const [t, keys] of SNAPSHOT_TABLES) {
      out[t] = await fetchAll<unknown>((a, b) => {
        let q = this.sb.from(t).select('*')
        for (const k of keys) q = q.order(k)
        return q.range(a, b)
      })
    }
    await this.logEvent('backup.export', 'تصدير نسخة احتياطية كاملة')
    return out
  }

  async logEvent(action: string, summary?: string | null, details?: Record<string, unknown> | null): Promise<void> {
    try {
      await this.sb.rpc('log_client_event', { p_action: action, p_summary: summary ?? null, p_details: details ?? null })
    } catch {
      /* لا يُعطّل التسجيل عمل المستخدم */
    }
  }
}

// كل جدول مع مفتاح ترتيب ثابت حتى لا تتكرر أو تُفقد صفوف عند الجلب على دفعات
const SNAPSHOT_TABLES: [string, string[]][] = [
  ['settings', ['id']],
  ['departments', ['id']],
  ['academic_years', ['id']],
  ['profiles', ['id']],
  ['students', ['id']],
  ['subjects', ['id']],
  ['grades', ['subject_id', 'student_id']],
  ['curriculum', ['id']],
]

const num = (v: unknown) => (v == null ? null : Number(v))

function normalizeSubject(s: Subject): Subject {
  return {
    ...s,
    units: num(s.units),
    coursework_max: Number(s.coursework_max),
    cw_practical_max: Number(s.cw_practical_max),
    practical_max: Number(s.practical_max),
    final_max: Number(s.final_max),
    final_min: num(s.final_min),
    ministerial: !!s.ministerial,
    teacher_ids: s.teacher_ids ?? [],
  }
}

function normalizeGrade(g: Grade): Grade {
  return {
    ...g,
    cw_theory: num(g.cw_theory),
    cw_practical: num(g.cw_practical),
    final_practical: num(g.final_practical),
    final_theory: num(g.final_theory),
    r2_final_practical: num(g.r2_final_practical),
    r2_final_theory: num(g.r2_final_theory),
    r2_special: g.r2_special ?? null,
  }
}
