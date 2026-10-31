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
  /** أقصى عدد مواد يُسمح بإكمالها؛ الرسوب في أكثر منها = راسب */
  max_failed_subjects: number
  /** حجب الدرجات عن التدريسيين عند غلق الإدخال */
  hide_grades_when_closed: boolean
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
  r2_status: SubjectStatus
  r2_note: string | null
  r2_submitted_at: string | null
  r2_reviewed_at: string | null
  r2_reviewed_by: string | null
}

export type SubjectInput = Omit<
  Subject,
  | 'id'
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
}

export interface Grade extends GradeValues {
  subject_id: string
  student_id: string
  updated_at: string
  updated_by: string | null
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
export type AnnouncementAudience = 'all' | 'teachers' | 'heads'

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
