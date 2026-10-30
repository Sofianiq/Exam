// بيانات تجريبية وهمية بالكامل (أسماء مولّدة عشوائياً) لعرض النظام دون خادم
import { cwTheoryMax, finalMaxOf } from '../lib/calc'
import type {
  AcademicYear,
  AuditEntry,
  Department,
  Grade,
  Profile,
  Role,
  Settings,
  Shift,
  SpecialCode,
  Student,
  Subject,
  SubjectStatus,
  Term,
} from '../lib/types'

export type DemoProfile = Profile & { password: string }

export interface DemoDB {
  version: number
  settings: Settings
  departments: Department[]
  years: AcademicYear[]
  profiles: DemoProfile[]
  students: Student[]
  subjects: Subject[]
  grades: Grade[]
  audit: AuditEntry[]
  auditSeq: number
  sessionUserId: string | null
}

export const DEMO_VERSION = 3
export const DEMO_PASSWORD = '123456'

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let idCounter = 0
export function demoId(prefix = 'id'): string {
  idCounter += 1
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${rand}`
}

const MALE = ['احمد', 'محمد', 'علي', 'حسين', 'حسن', 'مصطفى', 'عباس', 'يوسف', 'عمر', 'كرار', 'مرتضى', 'سجاد', 'منتظر', 'حيدر', 'علاء', 'ياسر', 'مهدي', 'زيد', 'طه', 'عبد الله', 'امير', 'باقر', 'جعفر', 'ليث']
const FEMALE = ['زينب', 'فاطمة', 'مريم', 'نور', 'سارة', 'رقية', 'حوراء', 'اية', 'دعاء', 'هبة', 'رسل', 'تبارك', 'زهراء', 'بنين', 'يقين', 'اسراء', 'شهد', 'ملاك', 'غدير', 'سجى']
const FATHERS = ['كريم', 'جواد', 'كاظم', 'سعد', 'فاضل', 'جاسم', 'حميد', 'رحيم', 'عادل', 'ماجد', 'نبيل', 'قاسم', 'صالح', 'هادي', 'رعد', 'فلاح', 'نوري', 'شاكر', 'عبد الحسين', 'عبد الكريم', 'طالب', 'ستار', 'سلمان', 'خليل', 'جبار', 'ناصر', 'رزاق', 'مجيد', 'حامد', 'لطيف', 'محسن', 'عدنان']

function makeNames(rand: () => number, count: number): string[] {
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]
  const set = new Set<string>()
  while (set.size < count) {
    const first = rand() < 0.5 ? pick(MALE) : pick(FEMALE)
    set.add(`${first} ${pick(FATHERS)} ${pick(FATHERS)} ${pick(FATHERS)}`)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ar'))
}

interface SubjectSeed {
  name: string
  term: Term
  teachers: string[]
  theoryOnly?: boolean
  status: SubjectStatus
  fill: number
  note?: string
}

export function createDemoDB(): DemoDB {
  const rand = mulberry32(20262027)
  const now = new Date()
  const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60000).toISOString()

  const years: AcademicYear[] = [
    { id: 'y-2025', label: '2025-2026' },
    { id: 'y-2026', label: '2026-2027' },
  ]
  const departments: Department[] = [
    { id: 'd-ans', name: 'تقنيات التخدير', code: 'ANS', has_evening: true, stages: 4, entry_open: true, sort: 1 },
    { id: 'd-rad', name: 'تقنيات الأشعة والسونار', code: 'RAD', has_evening: true, stages: 4, entry_open: true, sort: 2 },
    { id: 'd-den', name: 'تقنيات صناعة الأسنان', code: 'DEN', has_evening: false, stages: 4, entry_open: true, sort: 3 },
    { id: 'd-cht', name: 'تقنيات صحة المجتمع', code: 'CHT', has_evening: true, stages: 4, entry_open: true, sort: 4 },
    { id: 'd-cos', name: 'تقنيات التجميل والليزر', code: 'COS', has_evening: false, stages: 4, entry_open: true, sort: 5 },
  ]
  const settings: Settings = {
    university_name: 'جامعة السراج الأهلية',
    college_name: 'كلية التقنيات الصحية والطبية',
    entry_open: true,
    pass_mark: 50,
    rounding: 'none',
    grade_scale: [
      { min: 90, label: 'امتياز' },
      { min: 80, label: 'جيد جداً' },
      { min: 70, label: 'جيد' },
      { min: 60, label: 'متوسط' },
      { min: 50, label: 'مقبول' },
      { min: 0, label: 'راسب' },
    ],
    average_mode: 'simple',
    idle_minutes: 60,
    current_year_id: 'y-2026',
  }

  const person = (id: string, username: string, full_name: string, role: Role, department_id: string | null, title: string | null): DemoProfile => ({
    id,
    username,
    full_name,
    title,
    role,
    department_id,
    active: true,
    must_change_password: false,
    created_at: iso(60 * 24 * 30),
    password: DEMO_PASSWORD,
  })
  const profiles: DemoProfile[] = [
    person('u-admin', 'admin', 'مدير النظام', 'admin', null, null),
    person('u-dean', 'dean', 'خالد عبد الرحمن السامرائي', 'dean', null, 'أ.د.'),
    person('u-vice', 'vice', 'ليث حميد الدليمي', 'assistant_dean', null, 'أ.م.د.'),
    person('u-cmt', 'committee', 'سارة نبيل العاني', 'committee', null, 'م.د.'),
    person('u-ans-h', 'ans.head', 'علي حسن الربيعي', 'head', 'd-ans', 'م.م.'),
    person('u-rad-h', 'rad.head', 'أحمد ياسين العبيدي', 'head', 'd-rad', 'م.م.'),
    person('u-den-h', 'den.head', 'مروة فاضل الجبوري', 'head', 'd-den', 'م.د.'),
    person('u-cht-h', 'cht.head', 'حسين كاظم الزبيدي', 'head', 'd-cht', 'م.م.'),
    person('u-cos-h', 'cos.head', 'نور الهدى صالح', 'head', 'd-cos', 'م.م.'),
    person('u-rad1', 'rad01', 'عمار رعد الشمري', 'teacher', 'd-rad', 'م.د.'),
    person('u-rad2', 'rad02', 'هدى سلمان الكبيسي', 'teacher', 'd-rad', 'م.م.'),
    person('u-rad3', 'rad03', 'ياسر خليل النعيمي', 'teacher', 'd-rad', 'م.م.'),
    person('u-rad4', 'rad04', 'رنا جبار الحديثي', 'teacher', 'd-rad', 'م.'),
    person('u-gen1', 'gen01', 'عبد الله ناصر الجنابي', 'teacher', null, 'د.'),
    person('u-ans1', 'ans01', 'زيد طالب الموسوي', 'teacher', 'd-ans', 'م.د.'),
    person('u-ans2', 'ans02', 'شهد مجيد التميمي', 'teacher', 'd-ans', 'م.م.'),
    person('u-cht1', 'cht01', 'منتظر عادل الخفاجي', 'teacher', 'd-cht', 'م.م.'),
  ]

  const students: Student[] = []
  const subjects: Subject[] = []
  const grades: Grade[] = []
  const audit: AuditEntry[] = []
  let auditSeq = 0
  const log = (minutesAgo: number, userId: string, action: string, deptId: string | null, summary: string, details: Record<string, unknown> | null = null) => {
    const u = profiles.find((p) => p.id === userId)
    audit.push({
      id: ++auditSeq,
      at: iso(minutesAgo),
      user_id: userId,
      user_name: u?.full_name ?? null,
      action,
      entity: 'subject',
      entity_id: null,
      department_id: deptId,
      summary,
      details,
    })
  }

  const addClass = (dept: string, stage: number, shift: Shift, count: number, subs: SubjectSeed[]) => {
    const names = makeNames(rand, count)
    const cls = names.map<Student>((full_name, i) => ({
      id: demoId('st'),
      year_id: 'y-2026',
      department_id: dept,
      stage,
      shift,
      seq: i + 1,
      full_name,
      status: 'active',
      notes: null,
    }))
    students.push(...cls)
    const ability = new Map(cls.map((s) => [s.id, Math.max(30, Math.min(98, 72 + (rand() + rand() + rand() - 1.5) * 30))]))

    subs.forEach((seed, idx) => {
      const coursework_max = seed.theoryOnly ? 30 : 40
      const cw_practical_max = seed.theoryOnly ? 0 : 15
      const practical_max = seed.theoryOnly ? 0 : 25
      const subj: Subject = {
        id: demoId('sb'),
        year_id: 'y-2026',
        department_id: dept,
        stage,
        shift,
        term: seed.term,
        name: seed.name,
        code: null,
        units: seed.theoryOnly ? 2 : 3,
        teacher_ids: seed.teachers,
        coursework_max,
        cw_practical_max,
        practical_max,
        final_max: finalMaxOf(coursework_max, practical_max),
        status: seed.status,
        status_note: seed.note ?? null,
        submitted_at: seed.status !== 'draft' ? iso(60 * 20 + idx * 30) : null,
        submitted_by: seed.status !== 'draft' ? seed.teachers[0] ?? null : null,
        reviewed_at: seed.status === 'approved' || seed.status === 'returned' ? iso(60 * 5 + idx * 20) : null,
        reviewed_by: seed.status === 'approved' || seed.status === 'returned' ? 'u-cmt' : null,
        sort: idx + 1,
      }
      subjects.push(subj)
      const filled = Math.round(cls.length * seed.fill)
      cls.slice(0, filled).forEach((st, i) => {
        const a = (ability.get(st.id) ?? 70) / 100
        const v = (max: number) => (max > 0 ? Math.max(0, Math.min(max, Math.round(max * (a + (rand() - 0.5) * 0.25)))) : null)
        let special: SpecialCode | null = null
        if (seed.fill === 1 && i === 7 && idx % 2 === 0) special = 'absent'
        if (seed.fill === 1 && i === 15 && idx === 1) special = 'banned'
        grades.push({
          subject_id: subj.id,
          student_id: st.id,
          cw_theory: v(cwTheoryMax(subj)),
          cw_practical: v(subj.cw_practical_max),
          final_practical: special ? null : v(subj.practical_max),
          final_theory: special ? null : v(subj.final_max),
          special,
          note: null,
          updated_at: iso(60 * 24 + i),
          updated_by: seed.teachers[0] ?? null,
        })
      })
      if (seed.status !== 'draft') log(60 * 20 + idx * 30, seed.teachers[0] ?? 'u-rad-h', 'subject.submitted', dept, `${seed.name} — إرسال إلى اللجنة`)
      if (seed.status === 'approved') log(60 * 5 + idx * 20, 'u-cmt', 'subject.approved', dept, `${seed.name} — اعتماد`)
      if (seed.status === 'returned') log(60 * 5 + idx * 20, 'u-cmt', 'subject.returned', dept, `${seed.name} — إعادة للتعديل`, { note: seed.note })
    })
  }

  addClass('d-rad', 2, 'morning', 30, [
    { name: 'الفيزياء الشعاعية', term: 1, teachers: ['u-rad1'], status: 'approved', fill: 1 },
    { name: 'التشريح الشعاعي للصدر والبطن', term: 1, teachers: ['u-rad2'], status: 'approved', fill: 1 },
    { name: 'تقنيات التصوير الشعاعي للأطراف السفلى', term: 1, teachers: ['u-rad1'], status: 'submitted', fill: 1 },
    { name: 'أجهزة الأشعة التقليدية', term: 1, teachers: ['u-rad2'], status: 'returned', fill: 1, note: 'يرجى مراجعة درجات العملي النهائي للطلبة من 10 إلى 15' },
    { name: 'حقوق الإنسان والديمقراطية', term: 1, teachers: ['u-gen1'], theoryOnly: true, status: 'draft', fill: 0.6 },
    { name: 'اللغة الإنجليزية', term: 1, teachers: ['u-gen1'], theoryOnly: true, status: 'draft', fill: 0 },
    { name: 'التشريح الشعاعي للرأس والأطراف العليا', term: 2, teachers: ['u-rad1'], status: 'draft', fill: 0 },
    { name: 'تقنيات التصوير الشعاعي للأطراف العليا', term: 2, teachers: ['u-rad2'], status: 'draft', fill: 0 },
    { name: 'فحوصات شعاعية للجهاز الصفراوي والتناسلي', term: 2, teachers: ['u-rad1'], status: 'draft', fill: 0 },
    { name: 'فيزياء التصوير المحوسب', term: 2, teachers: ['u-rad3', 'u-rad4'], status: 'draft', fill: 0 },
    { name: 'اللغة العربية', term: 2, teachers: ['u-gen1'], theoryOnly: true, status: 'draft', fill: 0 },
  ])
  addClass('d-ans', 1, 'morning', 26, [
    { name: 'مبادئ التخدير', term: 1, teachers: ['u-ans1'], status: 'approved', fill: 1 },
    { name: 'التشريح البشري', term: 1, teachers: ['u-ans2'], status: 'submitted', fill: 1 },
    { name: 'الكيمياء الحياتية', term: 1, teachers: ['u-ans2'], status: 'draft', fill: 0.5 },
    { name: 'علم الحاسوب', term: 1, teachers: ['u-ans1'], status: 'draft', fill: 0 },
    { name: 'اللغة العربية', term: 1, teachers: ['u-gen1'], theoryOnly: true, status: 'draft', fill: 1 },
  ])
  addClass('d-cht', 3, 'evening', 18, [
    { name: 'علم الأوبئة', term: 1, teachers: ['u-cht1'], status: 'draft', fill: 0.4 },
    { name: 'الإحصاء الحيوي', term: 1, teachers: ['u-cht1'], status: 'approved', fill: 1 },
    { name: 'صحة البيئة', term: 1, teachers: ['u-cht1'], status: 'draft', fill: 0 },
    { name: 'التغذية العلاجية', term: 1, teachers: ['u-cht1'], theoryOnly: true, status: 'submitted', fill: 1 },
  ])

  audit.sort((a, b) => a.at.localeCompare(b.at))
  audit.forEach((a, i) => (a.id = i + 1))

  return {
    version: DEMO_VERSION,
    settings,
    departments,
    years,
    profiles,
    students,
    subjects,
    grades,
    audit,
    auditSeq: audit.length,
    sessionUserId: null,
  }
}

export const DEMO_ACCOUNTS: { username: string; role: Role; hint: string }[] = [
  { username: 'admin', role: 'admin', hint: 'كل الصلاحيات' },
  { username: 'dean', role: 'dean', hint: 'كل الأقسام' },
  { username: 'vice', role: 'assistant_dean', hint: 'فتح وغلق الإدخال' },
  { username: 'committee', role: 'committee', hint: 'تدقيق واعتماد' },
  { username: 'rad.head', role: 'head', hint: 'قسم الأشعة والسونار' },
  { username: 'rad01', role: 'teacher', hint: 'إدخال درجات مواده' },
]
