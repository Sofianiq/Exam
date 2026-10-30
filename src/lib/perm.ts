// قواعد الصلاحيات في الواجهة — مطابقة لما تفرضه قاعدة البيانات في supabase/schema.sql
import type { Department, Profile, Role, Settings, Subject } from './types'

type Who = Pick<Profile, 'id' | 'role' | 'department_id'>

export const SUPER_ROLES: Role[] = ['admin', 'dean', 'assistant_dean']
export const REVIEW_ROLES: Role[] = ['admin', 'dean', 'assistant_dean', 'committee']

export const isSuper = (p: Who | null | undefined) => !!p && SUPER_ROLES.includes(p.role)
export const canViewAll = (p: Who | null | undefined) => !!p && REVIEW_ROLES.includes(p.role)
export const canReview = canViewAll
export const canToggleEntry = isSuper
export const canEditSettings = (p: Who | null | undefined) => !!p && (p.role === 'admin' || p.role === 'dean')
export const canSeeAudit = (p: Who | null | undefined) => canViewAll(p) || p?.role === 'head'

export const canManageDepartment = (p: Who | null | undefined, departmentId: string) =>
  isSuper(p) || (p?.role === 'head' && p.department_id === departmentId)

export const canSeeDepartment = (p: Who | null | undefined, departmentId: string) =>
  canViewAll(p) || (p?.role === 'head' && p.department_id === departmentId)

export function manageableRoles(p: Who | null | undefined): Role[] {
  switch (p?.role) {
    case 'admin':
      return ['admin', 'dean', 'assistant_dean', 'committee', 'head', 'teacher']
    case 'dean':
      return ['dean', 'assistant_dean', 'committee', 'head', 'teacher']
    case 'assistant_dean':
      return ['committee', 'head', 'teacher']
    case 'head':
      return ['teacher']
    default:
      return []
  }
}

export const canManageUsers = (p: Who | null | undefined) => manageableRoles(p).length > 0

export function canManageRole(p: Who | null | undefined, role: Role, departmentId: string | null) {
  if (!p || !manageableRoles(p).includes(role)) return false
  if (p.role === 'head') return departmentId === p.department_id
  return true
}

export const canManageUser = (p: Who | null | undefined, target: Who) =>
  !!p && target.id !== p.id && canManageRole(p, target.role, target.department_id)

export const canDeleteUser = (p: Who | null | undefined, target: Who) =>
  !!p && (p.role === 'admin' || p.role === 'dean') && canManageUser(p, target)

export const canWriteSubject = (p: Who | null | undefined, s: Pick<Subject, 'department_id' | 'teacher_ids'>) =>
  isSuper(p) ||
  (p?.role === 'head' && p.department_id === s.department_id) ||
  (p?.role === 'teacher' && s.teacher_ids.includes(p.id))

export const entryOpenFor = (settings: Pick<Settings, 'entry_open'> | null | undefined, dept: Pick<Department, 'entry_open'> | null | undefined) =>
  (settings?.entry_open ?? true) && (dept?.entry_open ?? true)

/** سبب منع تعديل الدرجات أو null إذا كان التعديل مسموحاً */
export function gradeEditBlock(
  p: Who | null | undefined,
  s: Pick<Subject, 'department_id' | 'teacher_ids' | 'status'>,
  settings: Pick<Settings, 'entry_open'> | null | undefined,
  dept: Pick<Department, 'entry_open'> | null | undefined,
): string | null {
  if (!p) return 'غير مسجل الدخول'
  if (!canWriteSubject(p, s)) return 'ليست لديك صلاحية على درجات هذه المادة'
  if (isSuper(p)) return null
  if (!(settings?.entry_open ?? true)) return 'إدخال الدرجات مغلق حالياً من قبل الإدارة'
  if (!(dept?.entry_open ?? true)) return 'إدخال الدرجات مغلق لهذا القسم'
  if (s.status === 'submitted') return 'القائمة مرسلة إلى اللجنة الامتحانية ولا يمكن تعديلها'
  if (s.status === 'approved') return 'القائمة معتمدة ولا يمكن تعديلها'
  return null
}

export function workflowActions(
  p: Who | null | undefined,
  s: Pick<Subject, 'department_id' | 'teacher_ids' | 'status'>,
  settings: Pick<Settings, 'entry_open'> | null | undefined,
  dept: Pick<Department, 'entry_open'> | null | undefined,
) {
  const review = canReview(p)
  const sup = isSuper(p)
  return {
    submit: (s.status === 'draft' || s.status === 'returned') && gradeEditBlock(p, s, settings, dept) == null,
    approve: review && (s.status === 'submitted' || (sup && (s.status === 'draft' || s.status === 'returned'))),
    giveBack: review && (s.status === 'submitted' || (sup && s.status === 'approved')),
    toDraft: sup && s.status !== 'draft',
  }
}
