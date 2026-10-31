import type {
  AcademicYear,
  AccountInput,
  Announcement,
  AnnouncementInput,
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
  StudentStatus,
  Subject,
  SubjectInput,
  SubjectProgress,
  SubjectStatus,
  Term,
  VerifiedResult,
} from '../lib/types'

export interface SubjectFilter {
  year_id: string
  department_id?: string
  stage?: number
  shift?: ClassKey['shift']
  term?: Term
  teacher_id?: string
}

export interface StudentPatch {
  full_name?: string
  status?: StudentStatus
  notes?: string | null
}

/** طبقة الوصول للبيانات — لها تنفيذان: Supabase (الإنتاج) والوضع التجريبي المحلي */
export interface Backend {
  readonly mode: 'supabase' | 'demo'

  currentProfile(): Promise<Profile | null>
  signIn(username: string, password: string): Promise<Profile>
  signOut(): Promise<void>
  changeOwnPassword(current: string, next: string): Promise<void>
  onAuthLost(cb: () => void): () => void

  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Omit<Settings, 'entry_open'>>): Promise<void>
  setEntryOpen(open: boolean, departmentId?: string | null): Promise<void>

  listDepartments(): Promise<Department[]>
  saveDepartment(d: Partial<Department> & Pick<Department, 'name' | 'code'>): Promise<void>
  deleteDepartment(id: string): Promise<void>

  listYears(): Promise<AcademicYear[]>
  createYear(label: string): Promise<AcademicYear>
  deleteYear(id: string): Promise<void>

  listProfiles(): Promise<Profile[]>
  createAccount(a: AccountInput): Promise<string>
  updateAccount(a: AccountUpdate): Promise<void>
  resetPassword(userId: string, password: string): Promise<void>
  deleteAccount(userId: string): Promise<void>

  listStudents(k: ClassKey): Promise<Student[]>
  getStudent(id: string): Promise<Student | null>
  searchStudents(yearId: string, query: string): Promise<Student[]>
  addStudents(k: ClassKey, names: string[]): Promise<{ added: number; skipped: string[] }>
  updateStudent(id: string, patch: StudentPatch): Promise<void>
  deleteStudent(id: string): Promise<void>
  reorderStudents(ids: string[]): Promise<void>

  listSubjects(f: SubjectFilter): Promise<Subject[]>
  getSubject(id: string): Promise<Subject | null>
  saveSubject(s: SubjectInput): Promise<Subject>
  deleteSubject(id: string): Promise<void>
  copySubjects(from: ClassKey & { term: Term }, to: ClassKey & { term: Term }, withTeachers: boolean): Promise<number>
  setSubjectStatus(id: string, status: SubjectStatus, note?: string | null, round?: Round): Promise<void>

  listCurriculum(departmentId: string): Promise<CurriculumItem[]>
  saveCurriculum(c: CurriculumInput): Promise<void>
  deleteCurriculum(id: string): Promise<void>

  /** الأقسام الإضافية التي يدرّس فيها التدريسي (المقرر يربط قسمه أو يلغيه فقط) */
  setTeacherDepartments(userId: string, departmentIds: string[]): Promise<void>

  /** التحقق العام من نتيجة طالب برمز QR (لا يتطلب تسجيل الدخول) — null إذا كان الرمز غير صحيح */
  verifyResult(code: string): Promise<VerifiedResult | null>

  // الإعلانات (تُعاد الإعلانات التي يحق للمستخدم قراءتها فقط، الأحدث أولاً)
  listAnnouncements(): Promise<Announcement[]>
  saveAnnouncement(a: AnnouncementInput): Promise<void>
  deleteAnnouncement(id: string): Promise<void>

  getGrades(subjectIds: string[]): Promise<Grade[]>
  saveGrades(subjectId: string, rows: GradeRowInput[], reason?: string | null): Promise<string>

  listProgress(yearId: string): Promise<SubjectProgress[]>
  listAudit(f: AuditFilter): Promise<AuditEntry[]>
  logEvent(action: string, summary?: string | null, details?: Record<string, unknown> | null): Promise<void>

  /** نسخة احتياطية كاملة لكل البيانات المسموح للمستخدم برؤيتها */
  exportSnapshot(): Promise<Record<string, unknown>>
}

export class AppError extends Error {}
