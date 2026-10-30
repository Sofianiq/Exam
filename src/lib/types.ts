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
}

export type SubjectInput = Omit<
  Subject,
  'id' | 'final_max' | 'status' | 'status_note' | 'submitted_at' | 'submitted_by' | 'reviewed_at' | 'reviewed_by'
> & { id?: string }

export interface GradeValues {
  cw_theory: number | null
  cw_practical: number | null
  final_practical: number | null
  final_theory: number | null
  special: SpecialCode | null
  note: string | null
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
}

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
