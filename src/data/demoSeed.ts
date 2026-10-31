// بيانات تجريبية وهمية بالكامل (أسماء مولّدة عشوائياً) لعرض النظام دون خادم
import plansJson from './plans.json'
import { computeRow, cwTheoryMax, finalMaxOf } from '../lib/calc'
import type {
  Announcement,
  AcademicYear,
  AuditEntry,
  CurriculumItem,
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
  curriculum: CurriculumItem[]
  announcements: Announcement[]
  auditSeq: number
  sessionUserId: string | null
}

export const DEMO_VERSION = 5
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
  /** مادة تقويمية (وزارية): 40/60 بشرط 30 من 60 في الامتحان النهائي */
  ministerial?: boolean
  units?: number
  status: SubjectStatus
  fill: number
  note?: string
  /** حالة قائمة الدور الثاني ونسبة من أُدخلت درجاتهم من المكملين */
  r2Status?: SubjectStatus
  r2Fill?: number
}

// الخطط الدراسية الرسمية لكل الأقسام — نفس بيانات supabase/schema.sql (المصدر: scripts/plans_data.py)
type PlanRow = [stage: number, term: Term, name: string, nameEn: string, category: string, language: string, th: number, pr: number, units: number]
export const PLANS = plansJson as unknown as Record<string, PlanRow[]>
export const CHT_PLAN: PlanRow[] = PLANS.CHT

export function createDemoDB(): DemoDB {
  const rand = mulberry32(20262027)
  const now = new Date()
  const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60000).toISOString()

  const years: AcademicYear[] = [
    { id: 'y-2025', label: '2025-2026' },
    { id: 'y-2026', label: '2026-2027' },
  ]
  const departments: Department[] = [
    { id: 'd-ans', name: 'تقنيات التخدير', code: 'ANS', has_evening: true, stages: 4, entry_open: true, sort: 1, head_name: 'أ.م.د. فراس عبد الأمير الحلي' },
    { id: 'd-rad', name: 'تقنيات الأشعة والسونار', code: 'RAD', has_evening: true, stages: 4, entry_open: true, sort: 2, head_name: 'م.د. سعد جبار الحسني' },
    { id: 'd-den', name: 'تقنيات صناعة الأسنان', code: 'DEN', has_evening: false, stages: 4, entry_open: true, sort: 3, head_name: 'م.د. هالة عدنان القيسي' },
    { id: 'd-cht', name: 'تقنيات صحة المجتمع', code: 'CHT', has_evening: true, stages: 4, entry_open: true, sort: 4, head_name: 'أ.م.د. وسام كريم العزاوي' },
    { id: 'd-cos', name: 'تقنيات التجميل والليزر', code: 'COS', has_evening: false, stages: 4, entry_open: true, sort: 5, head_name: 'م.د. ريم ماجد الطائي' },
  ]
  const settings: Settings = {
    university_name: 'جامعة السراج الأهلية',
    college_name: 'كلية التقنيات الصحية والطبية',
    entry_open: true,
    pass_mark: 50,
    rounding: 'round',
    grade_scale: [
      { min: 90, label: 'امتياز' },
      { min: 80, label: 'جيد جداً' },
      { min: 70, label: 'جيد' },
      { min: 60, label: 'متوسط' },
      { min: 50, label: 'مقبول' },
      { min: 0, label: 'ضعيف' },
    ],
    average_mode: 'weighted',
    idle_minutes: 60,
    hide_grades_when_closed: true,
    current_year_id: 'y-2026',
    second_round_cap: null,
    max_failed_subjects: 2,
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
    // طلبة على حافة النجاح ليظهر في البيانات التجريبية «المكمل» في مادة أو مادتين
    ;[4, 9, 15].forEach((i) => cls[i] && ability.set(cls[i].id, 56))

    subs.forEach((seed, idx) => {
      const coursework_max = seed.ministerial ? 40 : seed.theoryOnly ? 30 : 40
      const cw_practical_max = seed.theoryOnly || seed.ministerial ? 0 : 15
      const practical_max = seed.theoryOnly || seed.ministerial ? 0 : 25
      const subj: Subject = {
        id: demoId('sb'),
        year_id: 'y-2026',
        department_id: dept,
        stage,
        shift,
        term: seed.term,
        name: seed.name,
        code: null,
        units: seed.units ?? (seed.theoryOnly ? 2 : 3),
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
        ministerial: !!seed.ministerial,
        final_min: seed.ministerial ? 30 : null,
        r2_status: seed.r2Status ?? 'draft',
        r2_note: null,
        r2_submitted_at: seed.r2Status && seed.r2Status !== 'draft' ? iso(60 * 3) : null,
        r2_reviewed_at: seed.r2Status === 'approved' ? iso(60 * 2) : null,
        r2_reviewed_by: seed.r2Status === 'approved' ? 'u-cmt' : null,
      }
      subjects.push(subj)
      const filled = Math.round(cls.length * seed.fill)
      cls.slice(0, filled).forEach((st, i) => {
        const a = (ability.get(st.id) ?? 70) / 100
        const v = (max: number) => (max > 0 ? Math.max(0, Math.min(max, Math.round(max * (a + (rand() - 0.5) * 0.25)))) : null)
        let special: SpecialCode | null = null
        if (seed.fill === 1 && i === 7 && idx % 2 === 0) special = 'absent'
        if (seed.fill === 1 && i === 15 && idx === 1) special = 'banned'
        const g: Grade = {
          subject_id: subj.id,
          student_id: st.id,
          cw_theory: v(cwTheoryMax(subj)),
          cw_practical: v(subj.cw_practical_max),
          final_practical: special ? null : v(subj.practical_max),
          final_theory: special ? null : v(subj.final_max),
          special,
          note: null,
          r2_final_practical: null,
          r2_final_theory: null,
          r2_special: null,
          updated_at: iso(60 * 24 + i),
          updated_by: seed.teachers[0] ?? null,
        }
        // الدور الثاني للمكملين (السعي ثابت، أداء أفضل قليلاً في الامتحان الثاني)
        if (seed.r2Fill && computeRow(subj, g, settings).needsR2 && rand() < seed.r2Fill) {
          const b = Math.min(0.95, a + 0.2)
          const r2 = (max: number) => (max > 0 ? Math.max(0, Math.min(max, Math.round(max * (b + (rand() - 0.5) * 0.2)))) : null)
          g.r2_final_practical = r2(subj.practical_max)
          g.r2_final_theory = r2(subj.final_max)
        }
        grades.push(g)
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
  // قسم صحة المجتمع — المرحلة الثانية: مواد الخطة الدراسية الرسمية، الفصل الأول معتمد مع دور ثانٍ
  const chtTeacher = (name: string) => (/اللغة|البعث|الحاسوب|حقوق/.test(name) ? ['u-gen1'] : ['u-cht1'])
  addClass(
    'd-cht',
    2,
    'morning',
    24,
    CHT_PLAN.filter(([stage]) => stage === 2).map<SubjectSeed>(([, term, name, , , , , pr, units], i) => ({
      name,
      term,
      units,
      theoryOnly: pr === 0,
      // للعرض فقط: مادة تقويمية (وزارية) في البيانات التجريبية
      ministerial: name.startsWith('علم الوبائيات'),
      teachers: chtTeacher(name),
      status: term === 1 ? 'approved' : 'draft',
      fill: term === 1 ? 1 : 0,
      r2Status: term === 1 ? (i < 4 ? 'approved' : 'draft') : undefined,
      r2Fill: term === 1 ? (i < 4 ? 1 : 0) : undefined,
    })),
  )

  const curriculum: CurriculumItem[] = departments.flatMap((d) => {
    const sort = new Map<string, number>()
    return (PLANS[d.code ?? ''] ?? []).map(([stage, term, name, name_en, category, language, th, pr, units], i) => {
      const k = `${stage}-${term}`
      sort.set(k, (sort.get(k) ?? 0) + 1)
      return {
        id: `cur-${d.code}-${i + 1}`,
        department_id: d.id,
        stage,
        term,
        sort: sort.get(k)!,
        name,
        name_en,
        category,
        language,
        theory_hours: th,
        practical_hours: pr,
        units,
        ministerial: false,
      }
    })
  })

  const announcements: Announcement[] = [
    {
      id: 'an-1',
      title: 'موعد تسليم درجات السعي الفصلي',
      body: 'يرجى من السادة التدريسيين إكمال إدخال درجات السعي الفصلي وإرسال القوائم إلى اللجنة الامتحانية قبل نهاية الأسبوع الحالي، إذ سيُغلق الإدخال بعدها.',
      level: 'important',
      department_id: null,
      audience: 'all',
      pinned: true,
      expires_at: null,
      created_by: 'u-dean',
      created_by_name: 'أ.د. خالد عبد الرحمن السامرائي',
      created_at: iso(60 * 6),
      updated_at: iso(60 * 6),
    },
    {
      id: 'an-2',
      title: 'اجتماع اللجنة الامتحانية لقسم صحة المجتمع',
      body: 'يُعقد اجتماع لتدريسيي القسم يوم الأحد الساعة العاشرة صباحاً في قاعة القسم لمناقشة نتائج الفصل الأول.',
      level: 'info',
      department_id: 'd-cht',
      audience: 'teachers',
      pinned: false,
      expires_at: null,
      created_by: 'u-cht-h',
      created_by_name: 'م.م. حسين كاظم الزبيدي',
      created_at: iso(60 * 2),
      updated_at: iso(60 * 2),
    },
  ]

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
    curriculum,
    announcements,
    auditSeq: audit.length,
    sessionUserId: null,
  }
}

export const DEMO_ACCOUNTS: { username: string; role: Role; hint: string }[] = [
  { username: 'admin', role: 'admin', hint: 'كل الصلاحيات' },
  { username: 'dean', role: 'dean', hint: 'كل الأقسام' },
  { username: 'vice', role: 'assistant_dean', hint: 'فتح وغلق الإدخال' },
  { username: 'committee', role: 'committee', hint: 'تدقيق واعتماد' },
  { username: 'cht.head', role: 'head', hint: 'قسم صحة المجتمع' },
  { username: 'rad01', role: 'teacher', hint: 'إدخال درجات مواده' },
]
