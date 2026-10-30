import type { Role, Shift, SpecialCode, StudentStatus, SubjectStatus } from './types'

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'مدير النظام',
  dean: 'العميد',
  assistant_dean: 'معاون العميد',
  committee: 'اللجنة الامتحانية',
  head: 'مقرر القسم',
  teacher: 'تدريسي',
}

export const ROLE_ORDER: Role[] = ['admin', 'dean', 'assistant_dean', 'committee', 'head', 'teacher']

export const SHIFT_LABEL: Record<Shift, string> = { morning: 'صباحي', evening: 'مسائي' }
export const SHIFT_LONG: Record<Shift, string> = { morning: 'الدراسة الصباحية', evening: 'الدراسة المسائية' }

export const TERM_LABEL: Record<1 | 2, string> = { 1: 'الفصل الأول', 2: 'الفصل الثاني' }

const STAGES = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة']
export const stageLabel = (n: number) => `المرحلة ${STAGES[n - 1] ?? n}`
export const stageShort = (n: number) => STAGES[n - 1] ?? String(n)

export const STATUS_LABEL: Record<SubjectStatus, string> = {
  draft: 'مسودة',
  submitted: 'بانتظار التدقيق',
  returned: 'معادة للتعديل',
  approved: 'معتمدة',
}

export const SPECIAL_LABEL: Record<SpecialCode, string> = {
  absent: 'غائب',
  postponed: 'مؤجل',
  banned: 'محروم',
}

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  active: 'مستمر',
  withdrawn: 'منسحب',
  postponed: 'مؤجل',
}

export const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'تسجيل دخول',
  'auth.logout': 'تسجيل خروج',
  'grade.create': 'إدخال درجة',
  'grade.update': 'تعديل درجة',
  'grade.delete': 'حذف درجة',
  'subject.create': 'إضافة مادة',
  'subject.update': 'تعديل مادة',
  'subject.delete': 'حذف مادة',
  'subject.submitted': 'إرسال قائمة للجنة',
  'subject.returned': 'إعادة قائمة للتعديل',
  'subject.approved': 'اعتماد قائمة',
  'subject.draft': 'إعادة قائمة إلى مسودة',
  'student.import': 'إضافة طلبة',
  'student.update': 'تعديل طالب',
  'student.delete': 'حذف طالب',
  'entry.open': 'فتح الإدخال',
  'entry.close': 'غلق الإدخال',
  'settings.update': 'تعديل الإعدادات',
  'department.create': 'إضافة قسم',
  'department.update': 'تعديل قسم',
  'department.delete': 'حذف قسم',
  'user.create': 'إنشاء حساب',
  'user.update': 'تعديل حساب',
  'user.delete': 'حذف حساب',
  'user.reset_password': 'إعادة تعيين كلمة مرور',
  'user.change_password': 'تغيير كلمة المرور',
  'report.export': 'تصدير تقرير',
  'report.print': 'طباعة تقرير',
  'backup.export': 'نسخة احتياطية',
}

export const TITLES = ['أ.د.', 'أ.م.د.', 'م.د.', 'م.م.', 'م.', 'د.', 'أ.']
