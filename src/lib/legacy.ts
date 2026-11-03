// ترحيل بيانات النظام السابق (ExamData): قراءة ملفات التصدير، التحقق الذاتي منها، وبناء حمولة الترحيل.
// كل درجة تُحسب بمحرك هذا النظام نفسه ثم تُقارن بالدرجة النهائية في النظام السابق، وكل نتيجة طالب
// (المعدل، النتيجة، التسلسل) تُقارن بالكشف الشامل والنتيجة السنوية وملف الفهرس قبل السماح بالترحيل.
import { RANKED_STATUSES, computeRow, gradeLabel, rankDescending, round2, summarizeStudent, type RowResult, type Scheme, type StudentSummary } from './calc'
import { normalizeArabic } from './parse'
import type { Department, LegacyClassPayload, LegacyGradeRaw, Settings, Shift, SpecialCode, Term } from './types'

export type Cell = string | number | boolean | null
export interface SheetData {
  name: string
  rows: Cell[][]
}
export interface WorkbookData {
  fileName: string
  checksum: string
  sheets: SheetData[]
}

// ---------------------------------------------------------------------
// قراءة الملفات
// ---------------------------------------------------------------------

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function cellValue(v: unknown): Cell {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown; error?: unknown }
    if (o.richText) return cellValue(o.richText.map((x) => x.text).join(''))
    if ('result' in o) return cellValue(o.result)
    if ('text' in o) return cellValue(o.text)
    if ('error' in o) return null
  }
  return String(v)
}

/** يقرأ ملف Excel إلى جداول بسيطة (القيم فقط) */
export async function readWorkbook(fileName: string, buf: ArrayBuffer): Promise<WorkbookData> {
  const mod = await import('exceljs')
  const Excel = (mod as unknown as { default?: typeof import('exceljs') }).default ?? (mod as unknown as typeof import('exceljs'))
  const wb = new Excel.Workbook()
  await wb.xlsx.load(buf)
  const sheets: SheetData[] = []
  wb.eachSheet((ws) => {
    const rows: Cell[][] = []
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = row.values as unknown[]
      const out: Cell[] = []
      for (let c = 1; c < vals.length; c++) out.push(cellValue(vals[c]))
      rows[n - 1] = out
    })
    for (let i = 0; i < rows.length; i++) rows[i] ??= []
    sheets.push({ name: ws.name.trim(), rows })
  })
  return { fileName, checksum: await sha256(buf), sheets }
}

// ---------------------------------------------------------------------
// أدوات مساعدة
// ---------------------------------------------------------------------

const norm = (s: unknown) => normalizeArabic(String(s ?? '')).replace(/\s+/g, ' ').trim()
const numOf = (v: Cell): number | null => {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = String(v).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).trim()
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null
  return Number(t)
}
const strOf = (v: Cell): string | null => (v == null ? null : String(v).trim() || null)
const yes = (v: Cell) => norm(v) === 'نعم'

const ORDINALS: Record<string, number> = { الاولي: 1, الثانيه: 2, الثالثه: 3, الرابعه: 4, الخامسه: 5, السادسه: 6 }
export function stageOf(v: Cell): number | null {
  const n = numOf(v)
  if (n != null) return n
  const t = norm(v).replace(/^المرحله\s*/, '')
  return ORDINALS[t] ?? null
}
const termOf = (v: Cell): Term | null => {
  const t = norm(v).replace(/^الفصل\s*/, '')
  return t === 'الاول' || t === '1' ? 1 : t === 'الثاني' || t === '2' ? 2 : null
}
const shiftOf = (v: Cell): Shift | null => {
  const t = norm(v)
  return t === norm('صباحي') ? 'morning' : t === norm('مسائي') ? 'evening' : null
}
const genderOf = (v: Cell): 'male' | 'female' | null => {
  const t = norm(v)
  return t === 'ذكر' ? 'male' : t === 'انثي' ? 'female' : null
}

/** رمز الحالة في النظام السابق: «غ - غائب»، «م - مؤجل»، «ح - محروم»، «ع - معفى»، «ش - غش» */
type LegacyStatus = SpecialCode | 'exempt' | 'cheat'
function statusOf(v: Cell): LegacyStatus | null | undefined {
  const t = norm(v)
  if (!t) return null
  const c = t.charAt(0)
  if (c === 'غ') return 'absent'
  if (c === 'م') return 'postponed'
  if (c === 'ح') return 'banned'
  if (c === 'ع') return 'exempt'
  if (c === 'ش') return 'cheat'
  return undefined
}

class Table {
  readonly header: string[]
  private idx = new Map<string, number>()
  constructor(
    readonly sheet: SheetData,
    headerRow = 0,
  ) {
    this.header = (sheet.rows[headerRow] ?? []).map((h) => String(h ?? '').trim())
    this.header.forEach((h, i) => {
      if (h && !this.idx.has(norm(h))) this.idx.set(norm(h), i)
    })
    this.body = sheet.rows.slice(headerRow + 1).filter((r) => r.some((c) => c != null))
  }
  readonly body: Cell[][]
  has(name: string) {
    return this.idx.has(norm(name))
  }
  col(name: string) {
    return this.idx.get(norm(name)) ?? -1
  }
  get(row: Cell[], name: string): Cell {
    const i = this.col(name)
    return i < 0 ? null : (row[i] ?? null)
  }
  missing(names: string[]) {
    return names.filter((n) => !this.has(n))
  }
}

const findSheet = (wb: WorkbookData, name: string) => wb.sheets.find((s) => norm(s.name) === norm(name))

// ---------------------------------------------------------------------
// بنية ملفات النظام السابق
// ---------------------------------------------------------------------

export interface LegacyInfo {
  year: string
  department: string
  head: string | null
  term: Term
  stage: number
  shift: Shift
  classId: string | null
  counts: { subjects: number | null; students: number | null; records: number | null }
}

export interface LegacySubject {
  seq: number
  name: string
  nameEn: string | null
  code: string | null
  units: number | null
  /** القيم المذكورة في الملف (غالباً 40/60/60 لكل المواد) */
  cwMax: number | null
  teacher: string | null
  notes: string | null
}

export interface LegacyStudent {
  seq: number
  no: string | null
  name: string
  gender: 'male' | 'female' | null
  admission: string | null
  status: string | null
  enrolment: string | null
  notes: string | null
}

export interface LegacyRound {
  theory: number | null
  practical: number | null
  status: LegacyStatus | null
  decision: number | null
  grant: number | null
  total: number | null
}

export interface LegacyRecord {
  row: number
  studentSeq: number | null
  studentNo: string | null
  studentName: string
  subjectSeq: number | null
  subjectName: string
  units: number | null
  cw: number | null
  rounds: [LegacyRound, LegacyRound, LegacyRound]
  final: number | null
  round: string | null
  passed: boolean
  byDecision: boolean
  result: string | null
  label: string | null
  carried: boolean
  decisionNote: string | null
  notes: string | null
}

export interface LegacyMasterRow {
  no: string | null
  name: string
  finals: Map<string, number | null>
  units: number | null
  weighted: number | null
  average: number | null
  rank: number | null
  result: string | null
}

export interface LegacyTermFile {
  kind: 'term'
  fileName: string
  checksum: string
  info: LegacyInfo
  subjects: LegacySubject[]
  students: LegacyStudent[]
  records: LegacyRecord[]
  master: LegacyMasterRow[]
}

export interface LegacyAnnualRow {
  no: string | null
  name: string
  units: number | null
  weighted: number | null
  average: number | null
  rank: number | null
  result: string | null
  failedCount: number | null
  carried: string | null
}

export interface LegacyAnnualFile {
  kind: 'annual'
  fileName: string
  checksum: string
  year: string
  department: string
  stage: number
  shift: Shift
  rows: LegacyAnnualRow[]
}

export interface LegacyIndexEntry {
  year: string
  department: string
  term: Term | null
  stage: number | null
  shift: Shift | null
  subjects: number | null
  students: number | null
  records: number | null
  passed: number | null
  notPassed: number | null
  path: string | null
}

export interface LegacyIndexFile {
  kind: 'index'
  fileName: string
  checksum: string
  terms: LegacyIndexEntry[]
  annual: LegacyIndexEntry[]
  totals: Map<string, number>
}

export type LegacyFile = LegacyTermFile | LegacyAnnualFile | LegacyIndexFile

export class LegacyFormatError extends Error {}

const TERM_SHEETS = ['معلومات الملف', 'المواد', 'الطلبة', 'الدرجات التفصيلية', 'الكشف الشامل']
const RECORD_COLS = ['رقم الطالب', 'اسم الطالب', 'اسم المادة', 'السعي', 'المجموع د1', 'الدرجة النهائية', 'نتيجة المادة']
const MASTER_TAIL = ['مجموع الوحدات', 'المجموع الموزون', 'المعدل', 'التسلسل', 'النتيجة']

/** يتعرّف على نوع الملف ويقرأه؛ يُعيد null للملفات التي ليست من تصدير النظام السابق */
export function parseLegacyWorkbook(wb: WorkbookData): LegacyFile | null {
  if (TERM_SHEETS.every((n) => findSheet(wb, n))) return parseTermFile(wb)
  if (findSheet(wb, 'النتيجة السنوية')) return parseAnnualFile(wb)
  if (wb.sheets.some((s) => norm(s.name).includes('فهرس'))) return parseIndexFile(wb)
  return null
}

function parseTermFile(wb: WorkbookData): LegacyTermFile {
  const bad = (m: string): never => {
    throw new LegacyFormatError(`${wb.fileName}: ${m}`)
  }
  const kv = new Map<string, Cell>()
  for (const r of findSheet(wb, 'معلومات الملف')!.rows) if (r[0] != null) kv.set(norm(r[0]), r[1] ?? null)
  const info: LegacyInfo = {
    year: strOf(kv.get(norm('السنة الدراسية')) ?? null) ?? bad('السنة الدراسية غير محددة'),
    department: strOf(kv.get(norm('القسم')) ?? null) ?? bad('القسم غير محدد'),
    head: strOf(kv.get(norm('رئيس القسم')) ?? null),
    term: termOf(kv.get(norm('الفصل الدراسي')) ?? null) ?? bad('الفصل الدراسي غير محدد'),
    stage: stageOf(kv.get(norm('المرحلة')) ?? null) ?? bad('المرحلة غير محددة'),
    shift: shiftOf(kv.get(norm('نوع الدراسة')) ?? null) ?? bad('نوع الدراسة غير محدد'),
    classId: strOf(kv.get(norm('رقم الصف في النظام القديم')) ?? null),
    counts: {
      subjects: numOf(kv.get(norm('عدد المواد')) ?? null),
      students: numOf(kv.get(norm('عدد الطلبة')) ?? null),
      records: numOf(kv.get(norm('عدد سجلات الدرجات')) ?? null),
    },
  }
  if (!/^\d{4}-\d{4}$/.test(info.year)) bad(`صيغة السنة الدراسية غير صحيحة: ${info.year}`)

  const st = new Table(findSheet(wb, 'المواد')!)
  const subjects: LegacySubject[] = st.body
    .filter((r) => strOf(st.get(r, 'اسم المادة')))
    .map((r, i) => ({
      seq: numOf(st.get(r, 'ت')) ?? i + 1,
      name: strOf(st.get(r, 'اسم المادة'))!.replace(/\s+/g, ' '),
      nameEn: strOf(st.get(r, 'اسم المادة بالإنجليزية')),
      code: strOf(st.get(r, 'رمز المادة')),
      units: numOf(st.get(r, 'الوحدات')),
      cwMax: numOf(st.get(r, 'درجة السعي القصوى')),
      teacher: strOf(st.get(r, 'التدريسي')),
      notes: strOf(st.get(r, 'ملاحظات')),
    }))

  const pt = new Table(findSheet(wb, 'الطلبة')!)
  if (pt.missing(['رقم الطالب', 'اسم الطالب']).length) bad('ورقة الطلبة لا تحتوي على رقم الطالب واسمه')
  const students: LegacyStudent[] = pt.body
    .filter((r) => strOf(pt.get(r, 'اسم الطالب')))
    .map((r, i) => ({
      seq: numOf(pt.get(r, 'ت')) ?? i + 1,
      no: strOf(pt.get(r, 'رقم الطالب')),
      name: strOf(pt.get(r, 'اسم الطالب'))!.replace(/\s+/g, ' '),
      gender: genderOf(pt.get(r, 'الجنس')),
      admission: strOf(pt.get(r, 'سنة القبول')),
      status: strOf(pt.get(r, 'حالة الطالب')),
      enrolment: strOf(pt.get(r, 'نوع القيد')),
      notes: strOf(pt.get(r, 'ملاحظات')),
    }))

  const rt = new Table(findSheet(wb, 'الدرجات التفصيلية')!)
  const miss = rt.missing(RECORD_COLS)
  if (miss.length) bad(`أعمدة ناقصة في ورقة الدرجات التفصيلية: ${miss.join('، ')}`)
  const round = (r: Cell[], k: 1 | 2 | 3): LegacyRound => {
    const manual = numOf(rt.get(r, `قرار يدوي د${k}`))
    const mark = numOf(rt.get(r, `درجة القرار د${k}`))
    return {
      theory: numOf(rt.get(r, `نظري د${k}`)),
      practical: numOf(rt.get(r, `عملي د${k}`)),
      status: statusOf(rt.get(r, `حالة د${k}`)) ?? null,
      decision: mark ?? manual,
      grant: numOf(rt.get(r, `منحة/تقريب د${k}`)),
      total: numOf(rt.get(r, `المجموع د${k}`)),
    }
  }
  const records: LegacyRecord[] = rt.body.map((r, i) => {
    for (const k of [1, 2, 3] as const) {
      if (statusOf(rt.get(r, `حالة د${k}`)) === undefined) bad(`رمز حالة غير معروف «${rt.get(r, `حالة د${k}`)}» في الصف ${i + 2}`)
    }
    return {
      row: i + 2,
      studentSeq: numOf(rt.get(r, 'ت الطالب')),
      studentNo: strOf(rt.get(r, 'رقم الطالب')),
      studentName: strOf(rt.get(r, 'اسم الطالب')) ?? '',
      subjectSeq: numOf(rt.get(r, 'ت المادة')),
      subjectName: (strOf(rt.get(r, 'اسم المادة')) ?? '').replace(/\s+/g, ' '),
      units: numOf(rt.get(r, 'الوحدات')),
      cw: numOf(rt.get(r, 'السعي')),
      rounds: [round(r, 1), round(r, 2), round(r, 3)],
      final: numOf(rt.get(r, 'الدرجة النهائية')),
      round: strOf(rt.get(r, 'دور النجاح')),
      passed: yes(rt.get(r, 'ناجح')),
      byDecision: yes(rt.get(r, 'ناجح بقرار')),
      result: strOf(rt.get(r, 'نتيجة المادة')),
      label: strOf(rt.get(r, 'التقدير')),
      carried: yes(rt.get(r, 'مادة محملة')),
      decisionNote: strOf(rt.get(r, 'ملاحظة القرار')),
      notes: strOf(rt.get(r, 'ملاحظات')),
    }
  })

  const mt = new Table(findSheet(wb, 'الكشف الشامل')!)
  const mm = mt.missing(MASTER_TAIL)
  if (mm.length) bad(`أعمدة ناقصة في الكشف الشامل: ${mm.join('، ')}`)
  const firstTail = mt.col('مجموع الوحدات')
  const subjectCols = mt.header.slice(3, firstTail)
  const master: LegacyMasterRow[] = mt.body
    .filter((r) => strOf(mt.get(r, 'اسم الطالب')))
    .map((r) => ({
      no: strOf(mt.get(r, 'رقم الطالب')),
      name: strOf(mt.get(r, 'اسم الطالب'))!,
      finals: new Map(subjectCols.map((h, j) => [norm(h), numOf(r[3 + j] ?? null)])),
      units: numOf(mt.get(r, 'مجموع الوحدات')),
      weighted: numOf(mt.get(r, 'المجموع الموزون')),
      average: numOf(mt.get(r, 'المعدل')),
      rank: numOf(mt.get(r, 'التسلسل')),
      result: strOf(mt.get(r, 'النتيجة')),
    }))
  return { kind: 'term', fileName: wb.fileName, checksum: wb.checksum, info, subjects, students, records, master }
}

/** يستخرج بيانات الصف من اسم ملف النتيجة السنوية عند خلوه من الصفوف */
function classFromName(fileName: string) {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.xlsx$/i, '')
  const parts = base.split('_')
  if (parts.length < 5) return null
  const [year, department, , stageText, shiftText] = parts
  return { year, department, stage: stageOf(stageText), shift: shiftOf(shiftText) }
}

function parseAnnualFile(wb: WorkbookData): LegacyAnnualFile {
  const t = new Table(findSheet(wb, 'النتيجة السنوية')!)
  const miss = t.missing(['رقم الطالب', 'اسم الطالب', 'المعدل السنوي', 'النتيجة السنوية'])
  if (miss.length) throw new LegacyFormatError(`${wb.fileName}: أعمدة ناقصة في النتيجة السنوية: ${miss.join('، ')}`)
  const first = t.body[0]
  const fromName = classFromName(wb.fileName)
  const year = (first && strOf(t.get(first, 'السنة الدراسية'))) || fromName?.year
  const department = (first && strOf(t.get(first, 'القسم'))) || fromName?.department
  const stage = (first && stageOf(t.get(first, 'المرحلة'))) || fromName?.stage
  const shift = (first && shiftOf(t.get(first, 'نوع الدراسة'))) || fromName?.shift
  if (!year || !department || !stage || !shift) throw new LegacyFormatError(`${wb.fileName}: تعذر تحديد الصف الدراسي للنتيجة السنوية`)
  return {
    kind: 'annual',
    fileName: wb.fileName,
    checksum: wb.checksum,
    year,
    department,
    stage,
    shift,
    rows: t.body
      .filter((r) => strOf(t.get(r, 'اسم الطالب')))
      .map((r) => ({
        no: strOf(t.get(r, 'رقم الطالب')),
        name: strOf(t.get(r, 'اسم الطالب'))!,
        units: numOf(t.get(r, 'مجموع الوحدات')),
        weighted: numOf(t.get(r, 'المجموع الموزون')),
        average: numOf(t.get(r, 'المعدل السنوي')),
        rank: numOf(t.get(r, 'التسلسل')),
        result: strOf(t.get(r, 'النتيجة السنوية')),
        failedCount: numOf(t.get(r, 'عدد المواد الراسبة')),
        carried: strOf(t.get(r, 'المواد المحملة')),
      })),
  }
}

function parseIndexFile(wb: WorkbookData): LegacyIndexFile {
  const entries = (sheet: SheetData | undefined, withTerm: boolean): LegacyIndexEntry[] => {
    if (!sheet) return []
    const t = new Table(sheet)
    return t.body
      .filter((r) => strOf(t.get(r, 'السنة الدراسية')))
      .map((r) => ({
        year: strOf(t.get(r, 'السنة الدراسية'))!,
        department: strOf(t.get(r, 'القسم')) ?? '',
        term: withTerm ? termOf(t.get(r, 'الفصل')) : null,
        stage: stageOf(t.get(r, 'المرحلة')),
        shift: shiftOf(t.get(r, 'نوع الدراسة')),
        subjects: numOf(t.get(r, 'عدد المواد')),
        students: numOf(t.get(r, 'عدد الطلبة')),
        records: numOf(t.get(r, 'عدد سجلات الدرجات')),
        passed: numOf(t.get(r, 'ناجحون')),
        notPassed: numOf(t.get(r, 'راسبون/مكملون')),
        path: strOf(t.get(r, 'مسار الملف')),
      }))
  }
  const termSheet = wb.sheets.find((s) => norm(s.name).includes('ملفات الفصول')) ?? wb.sheets.find((s) => new Table(s).has('الفصل') && new Table(s).has('مسار الملف'))
  const annualSheet = wb.sheets.find((s) => norm(s.name).includes('النتائج السنويه'))
  const totals = new Map<string, number>()
  const tot = wb.sheets.find((s) => norm(s.name).includes('الاجماليات'))
  if (tot) for (const r of tot.rows.slice(1)) if (r[0] != null && numOf(r[1] ?? null) != null) totals.set(norm(r[0]), numOf(r[1] ?? null)!)
  return { kind: 'index', fileName: wb.fileName, checksum: wb.checksum, terms: entries(termSheet, true), annual: entries(annualSheet, false), totals }
}

// ---------------------------------------------------------------------
// التحليل والتحقق
// ---------------------------------------------------------------------

export type IssueLevel = 'error' | 'mismatch' | 'warning' | 'info'
export interface Issue {
  level: IssueLevel
  message: string
  file?: string
  student?: string
  subject?: string
}

export type FixReason = 'settlement' | 'as_is' | 'carried_no_deduction' | 'final_without_r2' | 'out_of_range' | 'unsupported_status' | 'calc'
export const FIX_REASON_LABEL: Record<FixReason, string> = {
  settlement: 'تسوية درجة منقولة من النظام السابق',
  as_is: 'درجة الدور الثاني منقولة كما هي',
  carried_no_deduction: 'مادة محملة: درجة الدور الثاني دون خصم',
  final_without_r2: 'نتيجة نهائية دون درجة دور ثانٍ',
  out_of_range: 'مكوّنات خارج توزيع الدرجات',
  unsupported_status: 'حالة غير مستخدمة في هذا النظام (معفى/غش)',
  calc: 'اختلاف في طريقة الحساب',
}

export interface FixedGrade {
  student: string
  subject: string
  term: Term
  legacyFinal: number | null
  computed: number | null
  reason: FixReason
}

export interface ExcludedStudent {
  no: string | null
  name: string
  notes: string | null
}

export interface ClassStats {
  students: number
  excluded: number
  subjects: number
  records: number
  decisions: number
  r2: number
  specials: number
  fixed: number
  inferred: number
  checkedStudents: number
  checkedAnnual: number
}

export interface LegacyClassAnalysis {
  key: string
  year: string
  departmentName: string
  departmentId: string | null
  stage: number
  shift: Shift
  terms: Partial<Record<Term, LegacyTermFile>>
  annual: LegacyAnnualFile | null
  issues: Issue[]
  fixed: FixedGrade[]
  excluded: ExcludedStudent[]
  stats: ClassStats
  payload: LegacyClassPayload | null
  /** لا أخطاء ولا فروقات */
  clean: boolean
  /** يمكن ترحيله (لا أخطاء مانعة) */
  importable: boolean
}

export interface LegacyAnalysis {
  classes: LegacyClassAnalysis[]
  issues: Issue[]
  index: LegacyIndexFile | null
  totals: { files: number; termFiles: number; annualFiles: number; students: number; records: number; excluded: number; fixed: number }
  /** أسماء أقسام النظام السابق التي لم تُطابق مع أقسام هذا النظام */
  unmatchedDepartments: string[]
}

export type AnalysisSettings = Pick<Settings, 'pass_mark' | 'rounding' | 'grade_scale' | 'average_mode' | 'max_failed_subjects' | 'second_round_cap'>

/** القواعد التي اعتمدها النظام السابق (تحققنا منها على الملفات) */
export const LEGACY_RULES = {
  passMark: 50,
  averageMode: 'weighted' as const,
  maxCarry: 2,
  r2Deduction: 10,
  scale: [
    { min: 90, label: 'امتياز' },
    { min: 80, label: 'جيد جداً' },
    { min: 70, label: 'جيد' },
    { min: 60, label: 'متوسط' },
    { min: 50, label: 'مقبول' },
    { min: 0, label: 'ضعيف' },
  ],
}

/** يتحقق من توافق إعدادات النظام مع قواعد النظام السابق (وإلا ستختلف النتائج المعروضة) */
export function settingsIssues(s: AnalysisSettings): Issue[] {
  const out: Issue[] = []
  if (s.pass_mark !== LEGACY_RULES.passMark) out.push({ level: 'error', message: `درجة النجاح في الإعدادات ${s.pass_mark} بينما هي ${LEGACY_RULES.passMark} في النظام السابق` })
  if (s.average_mode !== LEGACY_RULES.averageMode) out.push({ level: 'error', message: 'المعدل في الإعدادات «متوسط بسيط» بينما يحسبه النظام السابق موزوناً بالوحدات' })
  if (s.max_failed_subjects !== LEGACY_RULES.maxCarry)
    out.push({ level: 'error', message: `الحد الأقصى لمواد التحميل في الإعدادات ${s.max_failed_subjects} بينما هو ${LEGACY_RULES.maxCarry} في النظام السابق` })
  const scale = [...s.grade_scale].sort((a, b) => b.min - a.min)
  const same = scale.length === LEGACY_RULES.scale.length && scale.every((b, i) => b.min === LEGACY_RULES.scale[i].min && norm(b.label) === norm(LEGACY_RULES.scale[i].label))
  if (!same) out.push({ level: 'warning', message: 'جدول التقديرات في الإعدادات يختلف عن النظام السابق؛ ستظهر تقديرات مختلفة لنفس الدرجات' })
  return out
}

/** يطابق اسم القسم في النظام السابق مع أقسام هذا النظام */
export function matchDepartment(name: string, departments: Department[]): Department | null {
  const n = norm(name).replace(/^قسم\s+/, '')
  const exact = departments.find((d) => norm(d.name).replace(/^قسم\s+/, '') === n)
  if (exact) return exact
  const strip = (s: string) => s.replace(/^تقنيات\s+/, '').replace(/\s+/g, '')
  const loose = departments.filter((d) => strip(norm(d.name).replace(/^قسم\s+/, '')) === strip(n))
  return loose.length === 1 ? loose[0] : null
}

const CW_CANDIDATES = [40, 30, 20, 50]

interface Mapped {
  rec: LegacyRecord
  values: {
    cw_theory: number | null
    final_theory: number | null
    decision: number | null
    special: SpecialCode | null
    r2_final_theory: number | null
    r2_decision: number | null
    r2_special: SpecialCode | null
    final_override: number | null
  }
  result: RowResult
  fix: FixReason | null
  raw: LegacyGradeRaw
  /** مادة «مكمل» في النظام السابق لا تطابق حالتها هنا */
  pendingMismatch: boolean
  term: Term
}

/** درجات الدور الأول والثاني كما تُخزن في هذا النظام (المجموع هو المرجع، والمكوّنات تُشتق منه) */
function splitRecord(rec: LegacyRecord) {
  const [r1, r2, r3] = rec.rounds
  // الدور الثالث في النظام السابق نسخة من الدور الثاني؛ يُعتمد الأحدث
  const rr = r3.total != null || r3.status ? r3 : r2
  const cw = rec.cw
  const dec1 = r1.decision && r1.decision > 0 ? r1.decision : null
  const decR2 = rr.decision && rr.decision > 0 ? rr.decision : null
  const fin1 = r1.total != null && cw != null ? round2(r1.total - cw - (dec1 ?? 0)) : r1.total != null && cw == null ? r1.total : null
  const finR2 = rr.total != null && cw != null ? round2(rr.total - cw - (decR2 ?? 0)) : null
  return { r1, rr, cw, dec1, decR2, fin1, finR2, usedR3: rr === r3 }
}

function feasibleCw(recs: LegacyRecord[]): number[] {
  return CW_CANDIDATES.filter((c) =>
    recs.every((rec) => {
      if (norm(rec.notes).includes(norm('تسوية'))) return true
      const { cw, fin1, finR2, r1 } = splitRecord(rec)
      const inR = (v: number | null, max: number) => v == null || (v >= 0 && v <= max)
      return inR(cw, c) && (r1.status ? true : inR(fin1, 100 - c)) && inR(finR2, 100 - c)
    }),
  )
}

function mapRecord(rec: LegacyRecord, scheme: Scheme, settings: AnalysisSettings): Mapped {
  const { r1, rr, cw, dec1, decR2, fin1, finR2, usedR3 } = splitRecord(rec)
  const cwMax = scheme.coursework_max
  const finMax = scheme.final_max
  const inR = (v: number | null, max: number) => v == null || (v >= 0 && v <= max)
  let fix: FixReason | null = null
  const special = (s: LegacyStatus | null): SpecialCode | null => (s === 'exempt' || s === 'cheat' ? null : s)
  const values = {
    cw_theory: inR(cw, cwMax) ? cw : null,
    final_theory: r1.status ? null : inR(fin1, finMax) ? fin1 : null,
    decision: r1.status ? null : dec1,
    special: special(r1.status),
    r2_final_theory: rr.status ? null : inR(finR2, finMax) ? finR2 : null,
    r2_decision: rr.status ? null : decR2,
    r2_special: special(rr.status),
    final_override: null as number | null,
  }
  if (r1.status === 'exempt' || r1.status === 'cheat' || rr.status === 'exempt' || rr.status === 'cheat') fix = 'unsupported_status'
  else if (!inR(cw, cwMax) || (!r1.status && !inR(fin1, finMax)) || (!rr.status && !inR(finR2, finMax))) fix = 'out_of_range'
  let result = computeRow(scheme, values, settings)
  // درجات دور ثانٍ لطالب ناجح في الدور الأول لا أثر لها في النتيجة؛ تبقى في السجل الأصلي فقط
  if (!result.needsR2 && (values.r2_final_theory != null || values.r2_special || values.r2_decision)) {
    values.r2_final_theory = null
    values.r2_special = null
    values.r2_decision = null
    result = computeRow(scheme, values, settings)
  }
  const legacyPending = norm(rec.result) === 'مكمل'
  const enginePending = result.needsR2 && !result.r2Complete
  const legacyPassed = rec.passed || ['ناجح', 'ناجح بقرار'].includes(norm(rec.result))
  let pendingMismatch = false
  if (legacyPending) {
    // المادة ما زالت بانتظار الدور الثاني: لا تُثبت درجتها حتى لا تُحسم نتيجتها، بل تُمثَّل درجة الدور الأول
    // المنقولة (التسوية) بمكوّنات ضمن التوزيع مجموعها يساوي المجموع المنقول
    if (rec.final != null && (!enginePending || result.finalTotal !== rec.final) && !r1.status) {
      const target = round2(rec.final - (values.decision ?? 0))
      const cw2 = Math.max(0, Math.min(cw ?? 0, cwMax, target))
      const fin2 = round2(target - cw2)
      if (target >= 0 && fin2 >= 0 && fin2 <= finMax) {
        values.cw_theory = cw2
        values.final_theory = fin2
        result = computeRow(scheme, values, settings)
        fix = 'settlement'
      }
    }
    pendingMismatch = !(result.needsR2 && !result.r2Complete) || result.finalTotal !== rec.final
  } else if (rec.final != null) {
    const ok = result.finalTotal === rec.final && result.finalPassed === legacyPassed && !enginePending
    if (!ok || fix) {
      const note = norm(rec.notes)
      fix = note.includes(norm('تسوية'))
        ? 'settlement'
        : note.includes(norm('كما هي'))
          ? 'as_is'
          : rec.carried && result.r2Raw != null && result.r2Raw === rec.final
            ? 'carried_no_deduction'
            : (fix ?? (enginePending ? 'final_without_r2' : 'calc'))
      values.final_override = rec.final
      result = computeRow(scheme, values, settings)
    }
  }
  const raw: LegacyGradeRaw = {
    cw: rec.cw,
    t1: r1.total,
    t2: rec.rounds[1].total,
    t3: rec.rounds[2].total,
    final: rec.final,
    round: rec.round,
    result: rec.result,
    label: rec.label,
    carried: rec.carried,
    status1: r1.status,
    decision_note: rec.decisionNote,
    notes: [rec.notes, usedR3 ? 'اعتُمد الدور الثالث' : null].filter(Boolean).join(' — ') || null,
    fixed: fix ? FIX_REASON_LABEL[fix] : null,
  }
  return { rec, values, result, fix, raw, pendingMismatch, term: 1 }
}

const studentKey = (no: string | null, name: string) => (no ? `no:${no}` : `name:${norm(name)}`)

const RESULT_TEXT = (s: StudentSummary): string => {
  switch (s.status) {
    case 'pass':
    case 'pass_r2':
      return s.byDecision.length ? 'ناجح بقرار' : 'ناجح'
    case 'pass_carry':
      return 'ناجح بالتحميل'
    case 'carry':
      return 'مكمل'
    case 'fail':
      return 'راسب'
    default:
      return 'غير مكتمل'
  }
}
const close = (a: number | null, b: number | null, eps = 0.011) => (a == null || b == null ? a === b : Math.abs(a - b) <= eps)

export interface AnalyzeOptions {
  departments: Department[]
  settings: AnalysisSettings
  /** مطابقة يدوية لأسماء الأقسام: الاسم في النظام السابق ← معرّف القسم */
  departmentMap?: Record<string, string>
}

/** يحلل كل الملفات المختارة ويتحقق منها ويبني حمولة الترحيل لكل صف دراسي */
export function analyzeLegacy(files: LegacyFile[], opts: AnalyzeOptions): LegacyAnalysis {
  const issues: Issue[] = []
  const termFiles = files.filter((f): f is LegacyTermFile => f.kind === 'term')
  const annualFiles = files.filter((f): f is LegacyAnnualFile => f.kind === 'annual')
  const index = (files.find((f) => f.kind === 'index') as LegacyIndexFile | undefined) ?? null
  const settings = { ...opts.settings }
  const ckey = (year: string, dept: string, stage: number, shift: Shift) => `${year}|${norm(dept)}|${stage}|${shift}`

  // 1) تجميع الملفات حسب الصف الدراسي
  const groups = new Map<string, { year: string; dept: string; stage: number; shift: Shift; terms: Partial<Record<Term, LegacyTermFile>>; annual: LegacyAnnualFile | null }>()
  for (const f of termFiles) {
    const k = ckey(f.info.year, f.info.department, f.info.stage, f.info.shift)
    const g = groups.get(k) ?? { year: f.info.year, dept: f.info.department, stage: f.info.stage, shift: f.info.shift, terms: {}, annual: null }
    if (g.terms[f.info.term]) issues.push({ level: 'error', file: f.fileName, message: `ملف مكرر للفصل نفسه (${g.terms[f.info.term]!.fileName})` })
    else g.terms[f.info.term] = f
    groups.set(k, g)
  }
  for (const a of annualFiles) {
    const g = groups.get(ckey(a.year, a.department, a.stage, a.shift))
    if (!g) issues.push({ level: 'warning', file: a.fileName, message: 'نتيجة سنوية لا تقابلها ملفات فصول ضمن الملفات المختارة' })
    else g.annual = a
  }

  // 2) توزيع الدرجات لكل مادة: يُستنتج من البيانات نفسها مع توحيده للمادة ذاتها عبر الملفات
  const feasible = new Map<string, number[]>()
  const byName = new Map<string, number[][]>()
  for (const f of termFiles) {
    for (const s of f.subjects) {
      const recs = f.records.filter((r) => norm(r.subjectName) === norm(s.name))
      const fs = feasibleCw(recs)
      feasible.set(`${f.fileName}|${norm(s.name)}`, fs)
      const list = byName.get(norm(s.name)) ?? []
      list.push(fs)
      byName.set(norm(s.name), list)
    }
  }
  const chooseCw = (file: LegacyTermFile, s: LegacySubject) => {
    const own = feasible.get(`${file.fileName}|${norm(s.name)}`) ?? []
    const all = byName.get(norm(s.name)) ?? []
    const common = CW_CANDIDATES.filter((c) => all.every((fs) => fs.length === 0 || fs.includes(c)))
    return own.find((c) => common.includes(c)) ?? own[0] ?? 40
  }

  const deptOf = (name: string) => {
    const id = opts.departmentMap?.[name]
    if (id) return opts.departments.find((d) => d.id === id) ?? null
    return matchDepartment(name, opts.departments)
  }

  const classes: LegacyClassAnalysis[] = []
  for (const [key, g] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const ci: Issue[] = []
    const fixed: FixedGrade[] = []
    const dept = deptOf(g.dept)
    if (!dept) ci.push({ level: 'error', message: `القسم «${g.dept}» غير موجود في هذا النظام. حدّد القسم المقابل.` })
    if (!g.terms[1] || !g.terms[2]) ci.push({ level: 'warning', message: `ملف الفصل ${g.terms[1] ? 'الثاني' : 'الأول'} غير موجود ضمن الملفات المختارة` })
    if (!g.annual && g.terms[1] && g.terms[2]) ci.push({ level: 'warning', message: 'ملف النتيجة السنوية غير موجود؛ لن يُتحقق من النتيجة السنوية' })
    const terms = ([1, 2] as Term[]).filter((t) => g.terms[t])

    // الطلبة: اتحاد طلبة الفصلين بالرقم الجامعي
    const students = new Map<string, { st: LegacyStudent; order: number }>()
    for (const t of terms) {
      const f = g.terms[t]!
      const seen = new Set<string>()
      for (const s of f.students) {
        const k = studentKey(s.no, s.name)
        if (seen.has(k)) ci.push({ level: 'error', file: f.fileName, student: s.name, message: 'طالب مكرر في ورقة الطلبة' })
        seen.add(k)
        const prev = students.get(k)
        if (prev && norm(prev.st.name) !== norm(s.name)) {
          ci.push({ level: 'warning', student: s.name, message: `اختلاف الاسم بين الفصلين («${prev.st.name}» ← «${s.name}»)؛ اعتُمد اسم الفصل الأحدث` })
        }
        students.set(k, { st: prev ? { ...prev.st, name: s.name, notes: s.notes ?? prev.st.notes } : s, order: prev?.order ?? t * 100000 + s.seq })
      }
    }
    const names = new Map<string, string>()
    for (const [k, { st }] of students) {
      const n = norm(st.name)
      if (names.has(n) && names.get(n) !== k) ci.push({ level: 'error', student: st.name, message: 'اسم مكرر لطالبين مختلفين في الصف نفسه' })
      names.set(n, k)
    }

    // ربط سجلات الدرجات بالمواد والطلبة + التحقق من الأعداد
    const mappedByTerm = new Map<Term, Mapped[]>()
    const subjectScheme = new Map<string, { term: Term; subject: LegacySubject; scheme: Scheme; inferred: boolean }>()
    let decisions = 0
    let r2 = 0
    let specials = 0
    let inferred = 0
    for (const t of terms) {
      const f = g.terms[t]!
      const fileIssue = (level: IssueLevel, message: string) => ci.push({ level, file: f.fileName, message })
      if (f.info.counts.subjects != null && f.info.counts.subjects !== f.subjects.length) fileIssue('error', `عدد المواد ${f.subjects.length} لا يطابق المذكور في الملف (${f.info.counts.subjects})`)
      if (f.info.counts.students != null && f.info.counts.students !== f.students.length) fileIssue('error', `عدد الطلبة ${f.students.length} لا يطابق المذكور في الملف (${f.info.counts.students})`)
      if (f.info.counts.records != null && f.info.counts.records !== f.records.length) fileIssue('error', `عدد سجلات الدرجات ${f.records.length} لا يطابق المذكور في الملف (${f.info.counts.records})`)
      const subjNames = new Set<string>()
      for (const s of f.subjects) {
        if (subjNames.has(norm(s.name))) fileIssue('error', `مادة مكررة: ${s.name}`)
        subjNames.add(norm(s.name))
        const cw = chooseCw(f, s)
        const isInferred = cw !== (s.cwMax ?? 40)
        if (isInferred) inferred++
        subjectScheme.set(`${t}|${norm(s.name)}`, {
          term: t,
          subject: s,
          scheme: { coursework_max: cw, cw_practical_max: 0, practical_max: 0, final_max: 100 - cw, r2_deduction: LEGACY_RULES.r2Deduction },
          inferred: isInferred,
        })
      }
      const studentKeys = new Set(f.students.map((s) => studentKey(s.no, s.name)))
      const pairs = new Set<string>()
      const mapped: Mapped[] = []
      for (const rec of f.records) {
        const sk = studentKey(rec.studentNo, rec.studentName)
        const sub = subjectScheme.get(`${t}|${norm(rec.subjectName)}`)
        if (!sub) {
          fileIssue('error', `سجل درجة لمادة غير موجودة في ورقة المواد: ${rec.subjectName} (الصف ${rec.row})`)
          continue
        }
        if (!studentKeys.has(sk)) {
          fileIssue('error', `سجل درجة لطالب غير موجود في ورقة الطلبة: ${rec.studentName} (الصف ${rec.row})`)
          continue
        }
        const pk = `${sk}|${norm(rec.subjectName)}`
        if (pairs.has(pk)) {
          fileIssue('error', `سجل درجة مكرر: ${rec.studentName} — ${rec.subjectName}`)
          continue
        }
        pairs.add(pk)
        if (rec.units != null && sub.subject.units != null && rec.units !== sub.subject.units) {
          fileIssue('error', `وحدات المادة ${rec.subjectName} في سجل الدرجة (${rec.units}) تخالف ورقة المواد (${sub.subject.units})`)
        }
        const m = { ...mapRecord(rec, sub.scheme, settings), term: t }
        if (m.pendingMismatch) {
          ci.push({ level: 'mismatch', file: f.fileName, student: rec.studentName, subject: rec.subjectName, message: `مادة «مكمل» في النظام السابق (الدرجة ${rec.final ?? '—'}) ولا تطابق حالتها هنا` })
        }
        if (m.values.decision || m.values.r2_decision) decisions++
        if (m.values.r2_final_theory != null || m.values.r2_special) r2++
        if (m.values.special || m.values.r2_special) specials++
        if (m.fix) fixed.push({ student: rec.studentName, subject: rec.subjectName, term: t, legacyFinal: rec.final, computed: computeRow(sub.scheme, { ...m.values, final_override: null }, settings).finalTotal, reason: m.fix })
        if (m.fix === 'unsupported_status') ci.push({ level: 'warning', file: f.fileName, student: rec.studentName, subject: rec.subjectName, message: 'حالة «معفى/غش» غير مستخدمة في هذا النظام؛ ثُبتت الدرجة النهائية كما هي' })
        if (rec.final == null && !['مكمل', ''].includes(norm(rec.result)) && rec.result != null) {
          ci.push({ level: 'mismatch', file: f.fileName, student: rec.studentName, subject: rec.subjectName, message: `لا توجد درجة نهائية والنتيجة «${rec.result}»` })
        }
        // التقدير والنتيجة كما في النظام السابق
        const label = m.result.finalSpecial ? null : m.result.finalLabel
        if (rec.label && rec.final != null && label && norm(label) !== norm(rec.label)) {
          ci.push({ level: 'mismatch', file: f.fileName, student: rec.studentName, subject: rec.subjectName, message: `التقدير «${label}» بدل «${rec.label}»` })
        }
        if (rec.final != null && m.result.byDecision !== rec.byDecision && m.result.finalPassed) {
          ci.push({ level: 'mismatch', file: f.fileName, student: rec.studentName, subject: rec.subjectName, message: m.result.byDecision ? 'محسوب «ناجح بقرار» والنظام السابق «ناجح»' : 'النظام السابق «ناجح بقرار» والمحسوب «ناجح»' })
        }
        mapped.push(m)
      }
      if (pairs.size !== f.students.length * f.subjects.length) {
        fileIssue('warning', `عدد سجلات الدرجات ${pairs.size} أقل من (الطلبة × المواد = ${f.students.length * f.subjects.length})`)
      }
      mappedByTerm.set(t, mapped)
    }

    // 3) الطلبة المستبعدون: كل درجاتهم النهائية صفر أو فارغة في كل الفصول
    const excluded: ExcludedStudent[] = []
    const excludedKeys = new Set<string>()
    for (const [k, { st }] of students) {
      const recs = terms.flatMap((t) => (mappedByTerm.get(t) ?? []).filter((m) => studentKey(m.rec.studentNo, m.rec.studentName) === k))
      if (recs.every((m) => !m.rec.final)) {
        excluded.push({ no: st.no, name: st.name, notes: st.notes })
        excludedKeys.add(k)
      }
    }

    // 4) مطابقة نتائج الطلبة (الكشف الشامل لكل فصل + النتيجة السنوية) بإعادة حسابها بمحرك هذا النظام
    const summarize = (list: Mapped[], scope: 'term' | 'annual') => {
      const meta = list.map((m) => ({ name: m.rec.subjectName, units: subjectScheme.get(`${m.term}|${norm(m.rec.subjectName)}`)?.subject.units ?? m.rec.units }))
      return summarizeStudent(meta, list.map((m) => m.result), settings, scope)
    }
    let checkedStudents = 0
    const compareRanks = (rows: { k: string; name: string; s: StudentSummary; legacyRank: number | null }[], label: string, file: string) => {
      const ranks = rankDescending(rows.map((r) => (RANKED_STATUSES.includes(r.s.status) ? r.s.average : null)))
      rows.forEach((r, i) => {
        if (ranks[i] !== r.legacyRank) ci.push({ level: 'mismatch', file, student: r.name, message: `${label}: التسلسل ${ranks[i] ?? '—'} بدل ${r.legacyRank ?? '—'}` })
      })
    }
    for (const t of terms) {
      const f = g.terms[t]!
      const mapped = mappedByTerm.get(t) ?? []
      const rows: { k: string; name: string; s: StudentSummary; legacyRank: number | null }[] = []
      for (const mr of f.master) {
        const k = studentKey(mr.no, mr.name)
        const recs = mapped.filter((m) => studentKey(m.rec.studentNo, m.rec.studentName) === k)
        for (const m of recs) {
          const mf = mr.finals.get(norm(m.rec.subjectName))
          if (mr.finals.has(norm(m.rec.subjectName)) && (mf ?? null) !== m.rec.final) {
            ci.push({ level: 'mismatch', file: f.fileName, student: mr.name, subject: m.rec.subjectName, message: `الدرجة في الكشف الشامل (${mf ?? '—'}) تخالف سجل الدرجات (${m.rec.final ?? '—'})` })
          }
        }
        if (excludedKeys.has(k)) continue
        const s = summarize(recs, 'term')
        checkedStudents++
        const where = `${f.info.term === 1 ? 'الفصل الأول' : 'الفصل الثاني'}`
        if (!close(s.average, mr.average)) ci.push({ level: 'mismatch', file: f.fileName, student: mr.name, message: `${where}: المعدل ${s.average ?? '—'} بدل ${mr.average ?? '—'}` })
        if (mr.units != null && s.units !== mr.units && s.average != null) ci.push({ level: 'mismatch', file: f.fileName, student: mr.name, message: `${where}: مجموع الوحدات ${s.units} بدل ${mr.units}` })
        const txt = RESULT_TEXT(s)
        if (mr.result && norm(txt) !== norm(mr.result)) ci.push({ level: 'mismatch', file: f.fileName, student: mr.name, message: `${where}: النتيجة «${txt}» بدل «${mr.result}»` })
        rows.push({ k, name: mr.name, s, legacyRank: mr.rank })
      }
      compareRanks(rows, t === 1 ? 'الفصل الأول' : 'الفصل الثاني', f.fileName)
    }
    let checkedAnnual = 0
    if (g.annual && terms.length === 2) {
      const all = [...(mappedByTerm.get(1) ?? []), ...(mappedByTerm.get(2) ?? [])]
      const rows: { k: string; name: string; s: StudentSummary; legacyRank: number | null }[] = []
      for (const ar of g.annual.rows) {
        const k = studentKey(ar.no, ar.name)
        if (excludedKeys.has(k)) continue
        if (!students.has(k)) {
          ci.push({ level: 'mismatch', file: g.annual.fileName, student: ar.name, message: 'طالب في النتيجة السنوية غير موجود في ملفات الفصلين' })
          continue
        }
        const s = summarize(
          all.filter((m) => studentKey(m.rec.studentNo, m.rec.studentName) === k),
          'annual',
        )
        checkedAnnual++
        if (!close(s.average, ar.average)) ci.push({ level: 'mismatch', file: g.annual.fileName, student: ar.name, message: `السنوي: المعدل ${s.average ?? '—'} بدل ${ar.average ?? '—'}` })
        const txt = RESULT_TEXT(s)
        if (ar.result && norm(txt) !== norm(ar.result)) ci.push({ level: 'mismatch', file: g.annual.fileName, student: ar.name, message: `السنوي: النتيجة «${txt}» بدل «${ar.result}»` })
        rows.push({ k, name: ar.name, s, legacyRank: ar.rank })
      }
      compareRanks(rows, 'السنوي', g.annual.fileName)
      const listed = new Set(g.annual.rows.map((r) => studentKey(r.no, r.name)))
      for (const [k, { st }] of students) if (!listed.has(k) && !excludedKeys.has(k)) ci.push({ level: 'mismatch', file: g.annual.fileName, student: st.name, message: 'الطالب غير موجود في النتيجة السنوية' })
    }

    // 5) حمولة الترحيل
    const recordCount = terms.reduce((a, t) => a + (mappedByTerm.get(t)?.length ?? 0), 0)
    const included = [...students.entries()].filter(([k]) => !excludedKeys.has(k)).sort((a, b) => a[1].order - b[1].order)
    const hasError = ci.some((x) => x.level === 'error')
    let payload: LegacyClassPayload | null = null
    const subjectKeys = new Map([...subjectScheme.keys()].map((k, i) => [k, `${subjectScheme.get(k)!.term}:${i + 1}`]))
    if (dept && !hasError) {
      const files = terms.map((t) => ({ name: g.terms[t]!.fileName.replace(/^.*[\\/]/, ''), term: t, checksum: g.terms[t]!.checksum }))
      payload = {
        year: g.year,
        department_id: dept.id,
        stage: g.stage,
        shift: g.shift,
        checksum: files.map((f) => `${f.term}:${f.checksum}`).join('|'),
        files,
        students: included.map(([k, { st }], i) => ({ key: k, student_no: st.no, full_name: st.name, gender: st.gender, seq: i + 1, notes: st.notes })),
        subjects: [...subjectScheme.values()].map(({ term, subject, scheme, inferred: inf }) => ({
          key: subjectKeys.get(`${term}|${norm(subject.name)}`)!,
          term,
          name: subject.name,
          code: subject.code,
          units: subject.units,
          sort: subject.seq,
          coursework_max: scheme.coursework_max,
          r2_deduction: LEGACY_RULES.r2Deduction,
          meta: { teacher: subject.teacher, name_en: subject.nameEn, file: g.terms[term]!.fileName.replace(/^.*[\\/]/, ''), inferred: inf, notes: subject.notes },
        })),
        grades: terms.flatMap((t) =>
          (mappedByTerm.get(t) ?? [])
            .filter((m) => !excludedKeys.has(studentKey(m.rec.studentNo, m.rec.studentName)))
            .map((m) => ({
              subject: subjectKeys.get(`${t}|${norm(m.rec.subjectName)}`)!,
              student: studentKey(m.rec.studentNo, m.rec.studentName),
              ...m.values,
              note: null,
              legacy: m.raw,
            })),
        ),
        report: {
          head: g.terms[1]?.info.head ?? g.terms[2]?.info.head ?? null,
          legacy_class_ids: terms.map((t) => g.terms[t]!.info.classId),
          excluded: excluded.length,
          fixed: fixed.length,
          mismatches: ci.filter((x) => x.level === 'mismatch').length,
        },
      }
    }
    const stats: ClassStats = {
      students: included.length,
      excluded: excluded.length,
      subjects: subjectScheme.size,
      records: recordCount,
      decisions,
      r2,
      specials,
      fixed: fixed.length,
      inferred,
      checkedStudents,
      checkedAnnual,
    }
    classes.push({
      key,
      year: g.year,
      departmentName: g.dept,
      departmentId: dept?.id ?? null,
      stage: g.stage,
      shift: g.shift,
      terms: g.terms,
      annual: g.annual,
      issues: ci,
      fixed,
      excluded,
      stats,
      payload,
      clean: !ci.some((x) => x.level === 'error' || x.level === 'mismatch'),
      importable: payload != null,
    })
  }

  // 6) مطابقة ملف الفهرس
  if (index) {
    const findTerm = (e: LegacyIndexEntry) => termFiles.find((f) => f.info.year === e.year && norm(f.info.department) === norm(e.department) && f.info.term === e.term && f.info.stage === e.stage && f.info.shift === e.shift)
    for (const e of index.terms) {
      const f = findTerm(e)
      const label = `${e.year} — ${e.department} — المرحلة ${e.stage} — ${e.shift === 'evening' ? 'مسائي' : 'صباحي'} — الفصل ${e.term === 1 ? 'الأول' : 'الثاني'}`
      if (!f) {
        issues.push({ level: 'warning', message: `ملف مذكور في الفهرس غير موجود ضمن الملفات المختارة: ${label}` })
        continue
      }
      const cmp = (what: string, a: number | null, b: number) => {
        if (a != null && a !== b) issues.push({ level: 'error', file: f.fileName, message: `${what} في الفهرس ${a} والملف ${b}` })
      }
      cmp('عدد المواد', e.subjects, f.subjects.length)
      cmp('عدد الطلبة', e.students, f.students.length)
      cmp('عدد سجلات الدرجات', e.records, f.records.length)
      const passed = f.master.filter((m) => ['ناجح', 'ناجح بقرار'].includes(norm(m.result))).length
      cmp('عدد الناجحين', e.passed, passed)
      cmp('عدد غير الناجحين', e.notPassed, f.master.length - passed)
    }
    for (const e of index.annual) {
      if (!annualFiles.some((a) => a.year === e.year && norm(a.department) === norm(e.department) && a.stage === e.stage && a.shift === e.shift)) {
        issues.push({ level: 'warning', message: `نتيجة سنوية مذكورة في الفهرس غير موجودة: ${e.year} — ${e.department} — المرحلة ${e.stage}` })
      }
    }
    const total = (k: string) => index.totals.get(norm(k))
    const allFiles = index.terms.length === termFiles.length
    if (allFiles) {
      const rec = termFiles.reduce((a, f) => a + f.records.length, 0)
      const enr = termFiles.reduce((a, f) => a + f.students.length, 0)
      const chk = (k: string, v: number) => {
        const t = total(k)
        if (t != null && t !== v) issues.push({ level: 'error', message: `${k}: في الفهرس ${t} والمقروء ${v}` })
      }
      chk('إجمالي سجلات الدرجات', rec)
      chk('إجمالي التسجيلات (طالب × فصل)', enr)
    }
  }

  const unmatched = [...new Set(classes.filter((c) => !c.departmentId).map((c) => c.departmentName))]
  return {
    classes,
    issues,
    index,
    totals: {
      files: files.length,
      termFiles: termFiles.length,
      annualFiles: annualFiles.length,
      students: classes.reduce((a, c) => a + c.stats.students, 0),
      records: classes.reduce((a, c) => a + c.stats.records, 0),
      excluded: classes.reduce((a, c) => a + c.stats.excluded, 0),
      fixed: classes.reduce((a, c) => a + c.stats.fixed, 0),
    },
    unmatchedDepartments: unmatched,
  }
}

const dropEmpty = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== false)) as T

/** يحذف القيم الفارغة من الحمولة لتصغير حجمها عند الإرسال (القيم الغائبة تُعدّ فارغة في قاعدة البيانات) */
export function compactPayload(p: LegacyClassPayload): LegacyClassPayload {
  return {
    ...p,
    students: p.students.map((s) => dropEmpty(s)),
    subjects: p.subjects.map((s) => ({ ...dropEmpty(s), meta: s.meta && dropEmpty(s.meta) })),
    grades: p.grades.map((g) => ({ ...dropEmpty(g), legacy: dropEmpty(g.legacy) })),
  }
}

/** نص قصير للصف الدراسي */
const STAGE_WORD = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة']
export function classLabel(c: Pick<LegacyClassAnalysis, 'year' | 'departmentName' | 'stage' | 'shift'>) {
  return `${c.year} — ${c.departmentName} — المرحلة ${STAGE_WORD[c.stage] ?? c.stage} — ${c.shift === 'evening' ? 'مسائي' : 'صباحي'}`
}

export { gradeLabel }
