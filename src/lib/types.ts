export type Role = 'admin' | 'dean' | 'assistant_dean' | 'committee' | 'head' | 'teacher'
export type Shift = 'morning' | 'evening'
export type Term = 1 | 2
export type SubjectStatus = 'draft' | 'submitted' | 'returned' | 'approved'
export type SpecialCode = 'absent' | 'postponed' | 'banned'
export type StudentStatus = 'active' | 'withdrawn' | 'postponed'
export type Rounding = 'none' | 'round' | 'ceil'

export interface Department {
  id: string
  name: string
  code: string
  has_evening: boolean
  stages: number
  entry_open: boolean
  sort: number
  /** اسم رئيس القسم (يُطبع في نتيجة الطالب) */
  head_name: string | null
}

export interface AcademicYear {
  id: string
  label: string
}

export interface Profile {
  id: string
  username: string
  full_name: string
  title: string | null
  role: Role
  department_id: string | null
  /** أقسام أخرى يدرّس فيها التدريسي (غير قسمه الأساسي) */
  extra_department_ids: string[]
  active: boolean
  must_change_password: boolean
  created_at: string
}

export interface GradeBand {
  min: number
  label: string
}

export interface Settings {
  university_name: string
  college_name: string
  entry_open: boolean
  pass_mark: number
  rounding: Rounding
  grade_scale: GradeBand[]
  average_mode: 'simple' | 'weighted'
  idle_minutes: number
  current_year_id: string | null
  /** سقف درجة الدور الثاني (null = بدون سقف) */
  second_round_cap: number | null
  /** أقصى عدد مواد يُسمح بتحميلها في النتيجة السنوية بعد الدور الثاني (ناجح بالتحميل)؛ أكثر منها = راسب */
  max_failed_subjects: number
  /** الدرجات المخصومة من مجموع الدور الثاني للناجح فيه (بحد أدنى درجة النجاح)، ولا تُخصم للمؤجل بعذر */
  second_round_deduction: number
  /** حجب الدرجات عن التدريسيين عند غلق الإدخال */
  hide_grades_when_closed: boolean
  /** أسماء الموقعين على النتيجة الرسمية */
  dean_name: string | null
  committee_head_name: string | null
}

/** صف دراسي: سنة + قسم + مرحلة + دراسة */
export interface ClassKey {
  year_id: string
  department_id: string
  stage: number
  shift: Shift
}

export interface Student extends ClassKey {
  id: string
  seq: number
  full_name: string
  status: StudentStatus
  notes: string | null
  /** رمز التحقق من النتيجة (يُطبع مع رمز QR) */
  verify_code: string
  /** الرقم الجامعي للطالب (يربط سجلاته عبر السنوات) */
  student_no?: string | null
  gender?: 'male' | 'female' | null
  /** عملية الترحيل التي أنشأت الطالب (للتراجع) */
  legacy_import_id?: string | null
  /** النتيجة محجوبة مؤقتاً عن بوابة الطالب وصفحة التحقق (الدرجات لا تتغير) */
  result_withheld?: boolean
  /** ملاحظة تظهر للطالب في البوابة */
  withheld_reason?: string | null
  withheld_at?: string | null
  withheld_by_name?: string | null
}

export interface Subject extends ClassKey {
  id: string
  term: Term
  name: string
  code: string | null
  units: number | null
  teacher_ids: string[]
  coursework_max: number
  cw_practical_max: number
  practical_max: number
  final_max: number
  status: SubjectStatus
  status_note: string | null
  submitted_at: string | null
  submitted_by: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  sort: number
  /** مادة تقويمية (وزارية): الامتحان النهائي وزاري */
  ministerial: boolean
  /** الحد الأدنى لدرجة الامتحان النهائي للنجاح في المادة (null = بلا شرط) */
  final_min: number | null
  /** خصم الدور الثاني لهذه المادة (null = حسب الإعدادات العامة) */
  r2_deduction?: number | null
  /** مادة مرحّلة من النظام السابق (نتائج نهائية معتمدة) */
  legacy?: boolean
  legacy_meta?: LegacySubjectMeta | null
  legacy_import_id?: string | null
  r2_status: SubjectStatus
  r2_note: string | null
  r2_submitted_at: string | null
  r2_reviewed_at: string | null
  r2_reviewed_by: string | null
}

/** معلومات المادة كما وردت في النظام السابق */
export interface LegacySubjectMeta {
  teacher?: string | null
  name_en?: string | null
  file?: string | null
  /** توزيع الدرجات مستنتج من البيانات (السعي/النهائي) */
  inferred?: boolean
  notes?: string | null
}

export type SubjectInput = Omit<
  Subject,
  | 'id'
  | 'legacy'
  | 'legacy_meta'
  | 'legacy_import_id'
  | 'final_max'
  | 'status'
  | 'status_note'
  | 'submitted_at'
  | 'submitted_by'
  | 'reviewed_at'
  | 'reviewed_by'
  | 'r2_status'
  | 'r2_note'
  | 'r2_submitted_at'
  | 'r2_reviewed_at'
  | 'r2_reviewed_by'
> & { id?: string }

export type Round = 1 | 2

export interface GradeValues {
  cw_theory: number | null
  cw_practical: number | null
  final_practical: number | null
  final_theory: number | null
  special: SpecialCode | null
  note: string | null
  /** الدور الثاني: يُعاد الامتحان النهائي فقط والسعي ثابت */
  r2_final_practical: number | null
  r2_final_theory: number | null
  r2_special: SpecialCode | null
  /** درجات القرار (قرار اللجنة/المجلس) المضافة إلى مجموع الدور الأول والثاني */
  decision?: number | null
  r2_decision?: number | null
  /** درجة نهائية مثبتة يدوياً (تسوية) تتقدم على الحساب — تُستخدم للبيانات المرحّلة */
  final_override?: number | null
}

export interface Grade extends GradeValues {
  subject_id: string
  student_id: string
  updated_at: string
  updated_by: string | null
  /** السجل الأصلي كما ورد من النظام السابق (للمراجعة) */
  legacy?: LegacyGradeRaw | null
}

/** سجل درجة كما ورد في ملف النظام السابق */
export interface LegacyGradeRaw {
  cw?: number | null
  /** المجاميع في الأدوار الثلاثة */
  t1?: number | null
  t2?: number | null
  t3?: number | null
  final?: number | null
  round?: string | null
  result?: string | null
  label?: string | null
  carried?: boolean
  status1?: string | null
  decision_note?: string | null
  notes?: string | null
  /** سبب تثبيت الدرجة النهائية كما هي (إن وُجد) */
  fixed?: string | null
}

export interface GradeRowInput extends GradeValues {
  student_id: string
}

export interface SubjectProgress {
  subject_id: string
  year_id: string
  department_id: string
  stage: number
  shift: Shift
  term: Term
  status: SubjectStatus
  n_students: number
  n_complete: number
  n_pass: number
  n_fail: number
  n_special: number
  avg_total: number | null
  r2_status: SubjectStatus
  n_r2_needed: number
  n_r2_done: number
}

/** مادة في الخطة الدراسية للقسم (تُستورد منها مواد كل سنة) */
export interface CurriculumItem {
  id: string
  department_id: string
  stage: number
  term: Term
  sort: number
  name: string
  name_en: string | null
  category: string | null
  language: string | null
  theory_hours: number
  practical_hours: number
  units: number
  ministerial: boolean
}

export type CurriculumInput = Omit<CurriculumItem, 'id'> & { id?: string }

export interface AuditEntry {
  id: number
  at: string
  user_id: string | null
  user_name: string | null
  action: string
  entity: string | null
  entity_id: string | null
  department_id: string | null
  summary: string | null
  details: Record<string, unknown> | null
}

export interface AuditFilter {
  department_id?: string | null
  action_prefix?: string | null
  search?: string | null
  limit?: number
  before_id?: number | null
}

export interface AccountInput {
  username: string
  password: string
  full_name: string
  title?: string | null
  role: Role
  department_id: string | null
}

export interface AccountUpdate {
  id: string
  full_name: string
  title: string | null
  role: Role
  department_id: string | null
  active: boolean
}

export type GradeComponent = 'cw_theory' | 'cw_practical' | 'final_practical' | 'final_theory'
export type R2Component = 'r2_final_practical' | 'r2_final_theory'

export type AnnouncementLevel = 'info' | 'important' | 'urgent'
export type AnnouncementAudience = 'all' | 'teachers' | 'heads' | 'students'

export interface Announcement {
  id: string
  title: string
  body: string
  level: AnnouncementLevel
  /** null = لكل الأقسام */
  department_id: string | null
  audience: AnnouncementAudience
  pinned: boolean
  expires_at: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
}

export type AnnouncementInput = Pick<Announcement, 'title' | 'body' | 'level' | 'department_id' | 'audience' | 'pinned' | 'expires_at'> & { id?: string }

/** بيانات التحقق من نتيجة طالب (عبر رمز QR) — تُعاد للمواد المعتمدة فقط */
export interface VerifiedSubject {
  name: string
  term: Term
  units: number | null
  ministerial: boolean
  approved: boolean
  special: SpecialCode | null
  total: number | null
  passed: boolean | null
  r2_approved: boolean
  r2_special: SpecialCode | null
  r2_total: number | null
  r2_passed: boolean | null
  /** الدرجة النهائية المثبتة (بيانات مرحّلة) */
  override?: number | null
  by_decision?: boolean
  r2_by_decision?: boolean
}

export interface VerifiedResult {
  code: string
  student: Pick<Student, 'full_name' | 'stage' | 'shift' | 'status' | 'seq'>
  department: { name: string; head_name: string | null } | null
  year: string | null
  settings: Pick<Settings, 'university_name' | 'college_name' | 'pass_mark' | 'grade_scale' | 'average_mode' | 'max_failed_subjects'>
  subjects: VerifiedSubject[]
  /** النتيجة محجوبة مؤقتاً: لا تُعرض موادها في صفحة التحقق */
  withheld?: boolean
}

// ---------------------------------------------------------------------
// بوابة الطالب (تطبيق مستقل): الإدارة من نظام اللجنة
// ---------------------------------------------------------------------

export interface PortalSettings {
  enabled: boolean
  /** رابط تطبيق بوابة الطالب (يُطبع في البطاقات ورمز QR) */
  portal_url: string | null
  /** رابط نظام اللجنة (لصفحة التحقق من النتيجة) */
  exam_url: string | null
  /** رسالة تظهر للطلبة في الصفحة الرئيسية للبوابة */
  notice: string | null
}

export type PortalKind = 'coursework' | 'results'
/** 0 = النتيجة السنوية */
export type PortalTerm = 0 | 1 | 2

export interface PortalClassInfo {
  department_id: string
  stage: number
  shift: Shift
  students: number
  accounts: number
  logged_in: number
}

export interface PortalPublication {
  year_id: string
  department_id: string
  stage: number
  shift: Shift
  term: PortalTerm
  kind: PortalKind
  students: number
  published_at: string
  published_by_name: string | null
}

/** حالة مواد كل صف وفصل: عددها، المعتمد منها، وآخر تعديل على درجاتها */
export interface PortalChange {
  department_id: string
  stage: number
  shift: Shift
  term: Term
  subjects: number
  approved: number
  changed_at: string | null
}

/** طالب حُجبت نتيجته مؤقتاً */
export interface PortalWithheld {
  student_id: string
  full_name: string
  department_id: string
  stage: number
  shift: Shift
  reason: string | null
  at: string | null
  by_name: string | null
}

export interface PortalOverview {
  settings: PortalSettings
  classes: PortalClassInfo[]
  publications: PortalPublication[]
  changes: PortalChange[]
  /** النتائج المحجوبة في السنة (غير موجودة قبل تحديث قاعدة البيانات إلى الإصدار 7) */
  withheld?: PortalWithheld[]
}

export interface PortalCard {
  student_id: string
  seq: number
  full_name: string
  login_id: string
  /** الرمز المطبوع؛ null إذا غيّره الطالب */
  code: string | null
  changed: boolean
  last_login_at: string | null
  login_count: number
}

/** سعي الطالب كما يُنشر: مجموع السعي لكل مادة فقط (دون تفصيل النظري والعملي) */
export interface PortalCourseworkSnapshot {
  v: 1
  subjects: { name: string; units: number | null; cw: number | null; max: number }[]
}

/** نتيجة الطالب كما تُنشر: التقديرات والحالة فقط (دون درجات) */
export interface PortalResultSnapshot {
  v: 1
  scope: PortalTerm
  sections: {
    term: Term
    label: string | null
    units: number
    rows: { name: string; units: number | null; label: string; note: string; tone: 'ok' | 'carry' | 'fail' | 'muted' }[]
  }[]
  overallLabel: string | null
  units: number
  status: string
  statusText: string
  failedTitle: string
  failed: string[]
  round: string
  /** ترتيب الطالب إذا كان ضمن العشرة الأوائل الناجحين */
  rank: number | null
}

export interface PortalPublishPayload extends ClassKey {
  term: PortalTerm
  kind: PortalKind
  exam_url?: string | null
  snapshots: { student_id: string; data: PortalCourseworkSnapshot | PortalResultSnapshot }[]
}
