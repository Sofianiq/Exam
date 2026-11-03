// اختبارات ترحيل بيانات النظام السابق على ملفات اصطناعية (أسماء ودرجات وهمية بالكامل)
import { describe, expect, it } from 'vitest'
import { computeRow } from './calc'
import { LEGACY_RULES, analyzeLegacy, matchDepartment, parseLegacyWorkbook, readWorkbook, settingsIssues, type Cell, type LegacyFile, type WorkbookData } from './legacy'
import type { Department } from './types'

const RECORD_HEADER = [
  'ت الطالب', 'رقم الطالب', 'اسم الطالب', 'ت المادة', 'اسم المادة', 'الوحدات', 'السعي',
  'نظري د1', 'عملي د1', 'حالة د1', 'قرار يدوي د1', 'منحة/تقريب د1', 'درجة القرار د1', 'المجموع د1',
  'نظري د2', 'عملي د2', 'حالة د2', 'قرار يدوي د2', 'منحة/تقريب د2', 'درجة القرار د2', 'المجموع د2',
  'نظري د3', 'عملي د3', 'حالة د3', 'قرار يدوي د3', 'منحة/تقريب د3', 'درجة القرار د3', 'المجموع د3',
  'الدرجة النهائية', 'دور النجاح', 'ناجح', 'ناجح بقرار', 'نتيجة المادة', 'التقدير', 'مادة محملة', 'ملاحظة القرار', 'ملاحظات',
]
const MASTER_TAIL = ['مجموع الوحدات', 'المجموع الموزون', 'المعدل', 'التسلسل', 'النتيجة', 'عدد المواد الناجحة', 'عدد المواد الراسبة', 'المواد الراسبة/المكملة', 'المواد الناجحة بقرار', 'المواد المؤجلة', 'آخر دور']

interface Rec {
  st: number
  sub: number
  cw: number
  th1?: number
  s1?: string
  dec1?: number
  th2?: number
  dec2?: number
  final: number
  result: string
  label: string
  round?: string
  notes?: string
  carried?: boolean
}
const STUDENTS = [
  { seq: 1, no: '9000000000000000001', name: 'طالب تجريبي أول', gender: 'ذكر' },
  { seq: 2, no: '9000000000000000002', name: 'طالبة تجريبية ثانية', gender: 'أنثى' },
  { seq: 3, no: '9000000000000000003', name: 'طالب تجريبي ثالث', gender: 'ذكر' },
  { seq: 4, no: '9000000000000000004', name: 'طالب تجريبي رابع', gender: 'ذكر', notes: 'طالب منقول' },
]

function termBook(opts: {
  term: 1 | 2
  subjects: { seq: number; name: string; units: number }[]
  recs: Rec[]
  master: { st: number; finals: number[]; units: number; weighted: number; avg: number; rank: number | null; result: string }[]
  dept?: string
}): WorkbookData {
  const name = (seq: number) => opts.subjects.find((s) => s.seq === seq)!
  const recRow = (r: Rec): Cell[] => {
    const st = STUDENTS[r.st - 1]
    const sub = name(r.sub)
    const t1 = r.cw + (r.th1 ?? 0) + (r.dec1 ?? 0)
    const t2 = r.th2 != null ? r.cw + r.th2 + (r.dec2 ?? 0) : null
    const v: Record<string, Cell> = {
      'ت الطالب': st.seq, 'رقم الطالب': st.no, 'اسم الطالب': st.name, 'ت المادة': sub.seq, 'اسم المادة': sub.name, 'الوحدات': sub.units,
      'السعي': r.cw, 'نظري د1': r.th1 ?? null, 'عملي د1': 0, 'حالة د1': r.s1 ?? null, 'قرار يدوي د1': r.dec1 ?? null, 'درجة القرار د1': r.dec1 ?? null, 'المجموع د1': t1,
      'نظري د2': r.th2 ?? null, 'قرار يدوي د2': r.dec2 ?? null, 'درجة القرار د2': r.dec2 ?? null, 'المجموع د2': t2,
      'الدرجة النهائية': r.final, 'دور النجاح': r.round ?? 'الدور الأول', 'ناجح': r.final >= 50 ? 'نعم' : 'لا', 'ناجح بقرار': r.result === 'ناجح بقرار' ? 'نعم' : 'لا',
      'نتيجة المادة': r.result, 'التقدير': r.label, 'مادة محملة': r.carried ? 'نعم' : 'لا', 'ملاحظة القرار': r.dec1 || r.dec2 ? 'قرار منقول من النظام القديم' : null, 'ملاحظات': r.notes ?? null,
    }
    return RECORD_HEADER.map((h) => v[h] ?? null)
  }
  return {
    fileName: `2024-2025_تقنيات الاشعة والسونار_الفصل ${opts.term === 1 ? 'الأول' : 'الثاني'}_المرحلة الأولى_صباحي.xlsx`,
    checksum: `t${opts.term}`,
    sheets: [
      {
        name: 'معلومات الملف',
        rows: [
          ['البيان', 'القيمة'],
          ['السنة الدراسية', '2024-2025'],
          ['القسم', opts.dept ?? 'تقنيات الاشعة والسونار'],
          ['رئيس القسم', 'م.د. رئيس قسم تجريبي'],
          ['الفصل الدراسي', opts.term === 1 ? 'الأول' : 'الثاني'],
          ['المرحلة', 'الأولى'],
          ['نوع الدراسة', 'صباحي'],
          ['عدد المواد', opts.subjects.length],
          ['عدد الطلبة', STUDENTS.length],
          ['عدد سجلات الدرجات', opts.recs.length],
          ['رقم الصف في النظام القديم', 100 + opts.term],
        ],
      },
      {
        name: 'المواد',
        rows: [
          ['ت', 'اسم المادة', 'اسم المادة بالإنجليزية', 'رمز المادة', 'الوحدات', 'درجة السعي القصوى', 'درجة النظري القصوى', 'درجة العملي القصوى', 'التدريسي', 'ملاحظات'],
          ...opts.subjects.map((s) => [s.seq, s.name, null, null, s.units, 40, 60, 60, 'م.م تدريسي تجريبي', null]),
        ],
      },
      {
        name: 'الطلبة',
        rows: [
          ['ت', 'رقم الطالب', 'اسم الطالب', 'الاسم بالإنجليزية', 'الجنس', 'نوع الدراسة', 'سنة القبول', 'المرحلة الحالية', 'حالة الطالب', 'نوع القيد', 'راسب/مكرر', 'ملاحظات'],
          ...STUDENTS.map((s) => [s.seq, s.no, s.name, null, s.gender, 'صباحي', '2024-2025', 1, 'مستمر', 'عادي', 'لا', s.notes ?? null]),
        ],
      },
      { name: 'الدرجات التفصيلية', rows: [RECORD_HEADER, ...opts.recs.map(recRow)] },
      {
        name: 'الكشف الشامل',
        rows: [
          ['ت', 'رقم الطالب', 'اسم الطالب', ...opts.subjects.map((s) => s.name), ...MASTER_TAIL],
          ...opts.master.map((m) => {
            const st = STUDENTS[m.st - 1]
            return [st.seq, st.no, st.name, ...m.finals, m.units, m.weighted, m.avg, m.rank, m.result, null, null, null, null, null, 'الدور الأول']
          }),
        ],
      },
    ],
  }
}

const T1_SUBJECTS = [
  { seq: 1, name: 'التشريح', units: 3 },
  { seq: 2, name: 'اللغة العربية', units: 2 },
]
const T2_SUBJECTS = [{ seq: 1, name: 'الفسلجة', units: 3 }]

const term1 = () =>
  termBook({
    term: 1,
    subjects: T1_SUBJECTS,
    recs: [
      { st: 1, sub: 1, cw: 30, th1: 40, final: 70, result: 'ناجح', label: 'جيد' },
      // اللغة العربية سعيها 30 ونهائيها 70 رغم أن ورقة المواد تقول 40/60
      { st: 1, sub: 2, cw: 25, th1: 65, final: 90, result: 'ناجح', label: 'امتياز' },
      { st: 2, sub: 1, cw: 20, th1: 25, dec1: 5, final: 50, result: 'ناجح بقرار', label: 'مقبول' },
      { st: 2, sub: 2, cw: 20, th1: 20, th2: 45, final: 55, result: 'ناجح', label: 'مقبول', round: 'الدور الثاني' },
      { st: 3, sub: 1, cw: 15, th1: 20, th2: 25, final: 40, result: 'راسب', label: 'ضعيف', round: 'لم يُقيّم', carried: true },
      { st: 3, sub: 2, cw: 28, th1: 60, final: 88, result: 'ناجح', label: 'جيد جداً' },
      { st: 4, sub: 1, cw: 0, th1: 0, final: 0, result: 'مكمل', label: 'ضعيف', round: 'لم يُقيّم' },
      { st: 4, sub: 2, cw: 0, th1: 0, final: 0, result: 'مكمل', label: 'ضعيف', round: 'لم يُقيّم' },
    ],
    master: [
      { st: 1, finals: [70, 90], units: 5, weighted: 390, avg: 78, rank: 1, result: 'ناجح' },
      { st: 2, finals: [50, 55], units: 5, weighted: 260, avg: 52, rank: 2, result: 'ناجح بقرار' },
      { st: 3, finals: [40, 88], units: 5, weighted: 296, avg: 59.2, rank: null, result: 'راسب' },
      { st: 4, finals: [0, 0], units: 5, weighted: 0, avg: 0, rank: null, result: 'مكمل' },
    ],
  })
const term2 = () =>
  termBook({
    term: 2,
    subjects: T2_SUBJECTS,
    recs: [
      { st: 1, sub: 1, cw: 35, th1: 50, final: 85, result: 'ناجح', label: 'جيد جداً' },
      // مؤجل بعذر: دوره الثاني بلا خصم
      { st: 2, sub: 1, cw: 30, s1: 'م - مؤجل', th2: 41, final: 71, result: 'ناجح', label: 'جيد', round: 'الدور الثاني' },
      // رسوب نهائي دون درجة دور ثانٍ
      { st: 3, sub: 1, cw: 20, th1: 15, final: 35, result: 'راسب', label: 'ضعيف', round: 'لم يُقيّم', carried: true },
      { st: 4, sub: 1, cw: 0, th1: 0, final: 0, result: 'مكمل', label: 'ضعيف', round: 'لم يُقيّم' },
    ],
    master: [
      { st: 1, finals: [85], units: 3, weighted: 255, avg: 85, rank: 1, result: 'ناجح' },
      { st: 2, finals: [71], units: 3, weighted: 213, avg: 71, rank: 2, result: 'ناجح' },
      { st: 3, finals: [35], units: 3, weighted: 105, avg: 35, rank: null, result: 'راسب' },
      { st: 4, finals: [0], units: 3, weighted: 0, avg: 0, rank: null, result: 'مكمل' },
    ],
  })
const annual = (): WorkbookData => ({
  fileName: '2024-2025_تقنيات الاشعة والسونار_النتيجة السنوية_المرحلة الأولى_صباحي.xlsx',
  checksum: 'a',
  sheets: [
    {
      name: 'النتيجة السنوية',
      rows: [
        ['ت', 'رقم الطالب', 'اسم الطالب', 'السنة الدراسية', 'القسم', 'المرحلة', 'نوع الدراسة', 'نوع القيد', 'مجموع الوحدات', 'المجموع الموزون', 'المعدل السنوي', 'التسلسل', 'النتيجة السنوية', 'عدد المواد الراسبة', 'عدد المواد المحملة', 'المواد المحملة', 'تم الترحيل للمرحلة التالية'],
        [1, STUDENTS[0].no, STUDENTS[0].name, '2024-2025', 'تقنيات الاشعة والسونار', 'الأولى', 'صباحي', 'عادي', 8, 645, 80.63, 1, 'ناجح', 0, 0, null, 'لا'],
        [2, STUDENTS[1].no, STUDENTS[1].name, '2024-2025', 'تقنيات الاشعة والسونار', 'الأولى', 'صباحي', 'عادي', 8, 473, 59.13, 2, 'ناجح بقرار', 0, 0, null, 'لا'],
        [3, STUDENTS[2].no, STUDENTS[2].name, '2024-2025', 'تقنيات الاشعة والسونار', 'الأولى', 'صباحي', 'عادي', 8, 401, 50.13, 3, 'ناجح بالتحميل', 2, 0, 'التشريح، الفسلجة', 'لا'],
        [4, STUDENTS[3].no, STUDENTS[3].name, '2024-2025', 'تقنيات الاشعة والسونار', 'الأولى', 'صباحي', 'عادي', 8, 0, 0, null, 'مكمل', 0, 0, null, 'لا'],
      ],
    },
  ],
})
const indexBook = (): WorkbookData => ({
  fileName: '00_الفهرس.xlsx',
  checksum: 'i',
  sheets: [
    {
      name: 'فهرس ملفات الفصول',
      rows: [
        ['ت', 'السنة الدراسية', 'القسم', 'الفصل', 'المرحلة', 'نوع الدراسة', 'عدد المواد', 'عدد الطلبة', 'عدد سجلات الدرجات', 'ناجحون', 'راسبون/مكملون', 'مسار الملف'],
        [1, '2024-2025', 'تقنيات الاشعة والسونار', 'الأول', 'الأولى', 'صباحي', 2, 4, 8, 2, 2, 'x'],
        [2, '2024-2025', 'تقنيات الاشعة والسونار', 'الثاني', 'الأولى', 'صباحي', 1, 4, 4, 2, 2, 'y'],
      ],
    },
    { name: 'فهرس النتائج السنوية', rows: [['ت', 'السنة الدراسية', 'القسم', 'المرحلة', 'نوع الدراسة', 'عدد الطلبة', 'مسار الملف'], [1, '2024-2025', 'تقنيات الاشعة والسونار', 'الأولى', 'صباحي', 4, 'z']] },
    { name: 'الإجماليات', rows: [['البيان', 'العدد'], ['إجمالي سجلات الدرجات', 12], ['إجمالي التسجيلات (طالب × فصل)', 8]] },
  ],
})

const departments: Department[] = [
  { id: 'd-rad', name: 'تقنيات الأشعة والسونار', code: 'RAD', has_evening: true, stages: 4, entry_open: true, sort: 1, head_name: null },
  { id: 'd-ans', name: 'تقنيات التخدير', code: 'ANS', has_evening: true, stages: 4, entry_open: true, sort: 2, head_name: null },
]
const settings = { pass_mark: 50, rounding: 'round' as const, grade_scale: LEGACY_RULES.scale, average_mode: 'weighted' as const, max_failed_subjects: 2, second_round_cap: null }
const parseAll = (...books: WorkbookData[]) => books.map((b) => parseLegacyWorkbook(b)).filter((f): f is LegacyFile => !!f)

describe('legacy migration', () => {
  const a = analyzeLegacy(parseAll(term1(), term2(), annual(), indexBook()), { departments, settings })
  const c = a.classes[0]

  it('reconciles every grade, term result, annual result and the index with no differences', () => {
    expect(a.classes).toHaveLength(1)
    expect(a.issues).toEqual([])
    expect(c.issues).toEqual([])
    expect(c.clean).toBe(true)
    expect(c.departmentId).toBe('d-rad')
    // 3 طلبة × فصلان + 3 طلبة في النتيجة السنوية (المستبعد لا يُقارن)
    expect(c.stats).toMatchObject({ students: 3, excluded: 1, subjects: 3, records: 12, checkedStudents: 6, checkedAnnual: 3, inferred: 1 })
  })

  it('excludes students whose every final mark is zero', () => {
    expect(c.excluded).toEqual([{ no: STUDENTS[3].no, name: STUDENTS[3].name, notes: 'طالب منقول' }])
    expect(c.payload!.students.map((s) => s.student_no)).toEqual([STUDENTS[0].no, STUDENTS[1].no, STUDENTS[2].no])
    expect(c.payload!.grades.every((g) => g.student !== `no:${STUDENTS[3].no}`)).toBe(true)
  })

  it('infers the 30/70 distribution from the data', () => {
    const ar = c.payload!.subjects.find((s) => s.name === 'اللغة العربية')!
    expect(ar).toMatchObject({ coursework_max: 30, r2_deduction: 10, meta: { inferred: true } })
    expect(c.payload!.subjects.find((s) => s.name === 'التشريح')!.coursework_max).toBe(40)
  })

  it('stores components so that this system reproduces each legacy final mark', () => {
    const p = c.payload!
    for (const g of p.grades) {
      const sub = p.subjects.find((s) => s.key === g.subject)!
      const scheme = { coursework_max: sub.coursework_max, cw_practical_max: 0, practical_max: 0, final_max: 100 - sub.coursework_max, r2_deduction: 10 }
      expect(computeRow(scheme, g, { pass_mark: 50, rounding: 'round', grade_scale: LEGACY_RULES.scale }).finalTotal).toBe(g.legacy.final)
    }
    const by = (st: number, name: string) => p.grades.find((g) => g.student === `no:${STUDENTS[st - 1].no}` && p.subjects.find((s) => s.key === g.subject)!.name === name)!
    expect(by(2, 'التشريح')).toMatchObject({ cw_theory: 20, final_theory: 25, decision: 5, final_override: null })
    expect(by(2, 'اللغة العربية')).toMatchObject({ final_theory: 20, r2_final_theory: 45, final_override: null })
    expect(by(2, 'الفسلجة')).toMatchObject({ special: 'postponed', final_theory: null, r2_final_theory: 41, final_override: null })
    // رسوب نهائي دون دور ثانٍ: تُثبت الدرجة كما هي حتى لا تبقى المادة «بانتظار الدور الثاني»
    expect(by(3, 'الفسلجة')).toMatchObject({ final_override: 35, legacy: { fixed: 'نتيجة نهائية دون درجة دور ثانٍ' } })
    expect(c.fixed).toEqual([expect.objectContaining({ subject: 'الفسلجة', reason: 'final_without_r2', legacyFinal: 35 })])
  })

  it('reports differences against the legacy master sheet', () => {
    const t = term1()
    const master = t.sheets.find((s) => s.name === 'الكشف الشامل')!
    master.rows[1][7] = 77 // معدل خاطئ
    master.rows[2][8] = 1 // تسلسل خاطئ
    const r = analyzeLegacy(parseAll(t, term2(), annual()), { departments, settings }).classes[0]
    expect(r.clean).toBe(false)
    expect(r.importable).toBe(true)
    expect(r.issues.filter((i) => i.level === 'mismatch').map((i) => i.message)).toEqual(['الفصل الأول: المعدل 78 بدل 77', 'الفصل الأول: التسلسل 2 بدل 1'])
  })

  it('blocks a class whose file counts are inconsistent or whose department is unknown', () => {
    const t = term1()
    t.sheets[0].rows[9][1] = 99 // عدد سجلات الدرجات
    const r = analyzeLegacy(parseAll(t, term2()), { departments, settings }).classes[0]
    expect(r.importable).toBe(false)
    expect(r.issues.some((i) => i.level === 'error' && i.message.includes('عدد سجلات الدرجات'))).toBe(true)

    const u = analyzeLegacy(parseAll(term1(), term2()), { departments: departments.slice(1), settings })
    expect(u.unmatchedDepartments).toEqual(['تقنيات الاشعة والسونار'])
    const mapped = analyzeLegacy(parseAll(term1(), term2()), { departments: departments.slice(1), settings, departmentMap: { 'تقنيات الاشعة والسونار': 'd-ans' } })
    expect(mapped.classes[0].payload?.department_id).toBe('d-ans')
  })

  it('matches department names written differently', () => {
    expect(matchDepartment('تقنيات الاشعة والسونار', departments)?.id).toBe('d-rad')
    expect(matchDepartment('قسم تقنيات التخدير', departments)?.id).toBe('d-ans')
    expect(matchDepartment('تقنيات التجميل', departments)).toBeNull()
  })

  it('flags settings that would display different results from the previous system', () => {
    expect(settingsIssues(settings)).toEqual([])
    expect(settingsIssues({ ...settings, average_mode: 'simple', max_failed_subjects: 3 }).map((i) => i.level)).toEqual(['error', 'error'])
  })

  it('reads real .xlsx files', async () => {
    const mod = await import('exceljs')
    const Excel = (mod as unknown as { default?: typeof import('exceljs') }).default ?? (mod as unknown as typeof import('exceljs'))
    const wb = new Excel.Workbook()
    for (const s of term1().sheets) {
      const ws = wb.addWorksheet(s.name)
      for (const r of s.rows) ws.addRow(r)
    }
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer
    const read = await readWorkbook('t1.xlsx', buf)
    expect(read.checksum).toMatch(/^[0-9a-f]{64}$/)
    const f = parseLegacyWorkbook(read)
    expect(f).toMatchObject({ kind: 'term', info: { year: '2024-2025', term: 1, stage: 1, shift: 'morning' } })
    if (f?.kind === 'term') expect(f.records).toHaveLength(8)
  })
})
