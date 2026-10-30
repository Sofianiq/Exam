// تصدير ملفات Excel بنفس تنسيق سجلات الدرجات المعتمدة في الكلية (يُحمَّل عند الطلب فقط)
import type * as ExcelJS from 'exceljs'
import { componentsOf, type MasterRow, type RowResult, type SheetStats } from './calc'
import { SHIFT_LONG, SPECIAL_LABEL, TERM_LABEL, stageShort } from './labels'
import type { GradeValues, Settings, Student, Subject } from './types'

const GREEN = 'FF0B5A3A'
const LIGHT = 'FFE7F0EA'
const GOLD = 'FFF6EDD8'
const thin = { style: 'thin' as const, color: { argb: 'FF888888' } }
const box = { top: thin, left: thin, bottom: thin, right: thin }

async function workbook(): Promise<ExcelJS.Workbook> {
  const mod = await import('exceljs')
  const Excel = (mod as unknown as { default?: typeof ExcelJS }).default ?? (mod as unknown as typeof ExcelJS)
  const wb = new Excel.Workbook()
  wb.creator = 'نظام اللجنة الامتحانية'
  wb.created = new Date()
  return wb
}

export async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.replace(/[\u2066-\u2069]/g, '').replace(/[\\/:*?"<>|]/g, '-')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const safeSheetName = (name: string, used: Set<string>) => {
  let base = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'ورقة'
  let n = base
  let i = 2
  while (used.has(n)) n = `${base.slice(0, 25)} ${i++}`
  used.add(n)
  base = n
  return base
}

function newSheet(wb: ExcelJS.Workbook, name: string, landscape = false) {
  return wb.addWorksheet(name, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 7 }],
    pageSetup: { paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  })
}

function titleRow(ws: ExcelJS.Worksheet, row: number, cols: number, text: string, size = 13, fill = GREEN, color = 'FFFFFFFF') {
  ws.mergeCells(row, 1, row, cols)
  const c = ws.getCell(row, 1)
  c.value = text
  c.font = { bold: true, size, color: { argb: color } }
  c.alignment = { horizontal: 'center', vertical: 'middle' }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
  ws.getRow(row).height = size + 9
}

function infoRow(ws: ExcelJS.Worksheet, row: number, cols: number, pairs: [string, string][]) {
  const per = Math.max(2, Math.floor(cols / pairs.length))
  pairs.forEach(([k, v], i) => {
    const start = 1 + i * per
    const end = i === pairs.length - 1 ? cols : start + per - 1
    ws.mergeCells(row, start, row, end)
    const c = ws.getCell(row, start)
    c.value = `${k}: ${v}`
    c.font = { bold: true, size: 11 }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } }
  })
  ws.getRow(row).height = 20
}

function headerCell(c: ExcelJS.Cell, text: string) {
  c.value = text
  c.font = { bold: true, size: 10.5, color: { argb: 'FFFFFFFF' } }
  c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } }
  c.border = box
}

function bodyCell(c: ExcelJS.Cell, v: ExcelJS.CellValue, opts: { bold?: boolean; red?: boolean; left?: boolean; zebra?: boolean } = {}) {
  c.value = v
  c.font = { bold: opts.bold, size: 11, color: opts.red ? { argb: 'FFB42318' } : undefined }
  c.alignment = { horizontal: opts.left ? 'right' : 'center', vertical: 'middle' }
  c.border = box
  if (opts.zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F4' } }
}

function signatures(ws: ExcelJS.Worksheet, row: number, cols: number, labels: string[]) {
  const per = Math.floor(cols / labels.length)
  labels.forEach((l, i) => {
    const start = 1 + i * per
    const end = i === labels.length - 1 ? cols : start + per - 1
    ws.mergeCells(row, start, row, end)
    const c = ws.getCell(row, start)
    c.value = l
    c.font = { bold: true, size: 11 }
    c.alignment = { horizontal: 'center' }
    ws.mergeCells(row + 2, start, row + 2, end)
    const s = ws.getCell(row + 2, start)
    s.value = '..............................'
    s.alignment = { horizontal: 'center' }
  })
}

export interface SubjectExport {
  settings: Settings
  deptName: string
  yearLabel: string
  subject: Subject
  teachers: string
  students: Student[]
  rows: Record<string, { values: GradeValues; result: RowResult }>
  stats: SheetStats
}

function writeSubjectSheet(ws: ExcelJS.Worksheet, e: SubjectExport) {
  const { subject: s } = e
  const comps = componentsOf(s)
  const cw = comps.filter((c) => c.group === 'coursework')
  const fin = comps.filter((c) => c.group === 'final')
  const cwSum = cw.length > 1
  const finSum = fin.length > 1
  const cols = 2 + cw.length + (cwSum ? 1 : 0) + fin.length + (finSum ? 1 : 0) + 3
  ws.columns = [{ width: 5 }, { width: 34 }, ...Array.from({ length: cols - 3 }, () => ({ width: 11 })), { width: 22 }]

  titleRow(ws, 1, cols, `${e.settings.university_name} — ${e.settings.college_name}`)
  titleRow(ws, 2, cols, `قسم ${e.deptName}`, 12, LIGHT, GREEN)
  titleRow(ws, 3, cols, `اسم المادة: ${s.name}`, 12, LIGHT, 'FF000000')
  infoRow(ws, 4, cols, [
    ['التدريسي', e.teachers || '—'],
    ['العام الدراسي', e.yearLabel],
    ['المرحلة', stageShort(s.stage)],
  ])
  infoRow(ws, 5, cols, [
    ['نوع الدراسة', SHIFT_LONG[s.shift]],
    ['الفصل', TERM_LABEL[s.term]],
    ['عدد الطلبة', String(e.students.length)],
  ])

  // ترويسة من صفين
  ws.mergeCells(6, 1, 7, 1)
  headerCell(ws.getCell(6, 1), 'ت')
  ws.mergeCells(6, 2, 7, 2)
  headerCell(ws.getCell(6, 2), 'اسم الطالب')
  let col = 3
  const group = (label: string, list: typeof comps, sum: boolean, sumMax: number) => {
    const span = list.length + (sum ? 1 : 0)
    if (span === 0) return
    if (span > 1) ws.mergeCells(6, col, 6, col + span - 1)
    headerCell(ws.getCell(6, col), label)
    list.forEach((c) => headerCell(ws.getCell(7, col++), `${list.length > 1 ? c.label : 'الدرجة'}\n(${c.max})`))
    if (sum) headerCell(ws.getCell(7, col++), `المجموع\n(${sumMax})`)
  }
  group(`السعي الفصلي (${s.coursework_max}%)`, cw, cwSum, s.coursework_max)
  group(`الامتحان النهائي (${100 - s.coursework_max}%)`, fin, finSum, 100 - s.coursework_max)
  for (const t of ['الدرجة النهائية (100)', 'التقدير', 'ملاحظات']) {
    ws.mergeCells(6, col, 7, col)
    headerCell(ws.getCell(6, col++), t)
  }
  ws.getRow(6).height = 22
  ws.getRow(7).height = 32

  e.students.forEach((st, i) => {
    const r = 8 + i
    const row = e.rows[st.id]
    const v = row?.values
    const res = row?.result
    const zebra = i % 2 === 1
    const fail = res?.total != null && res.total < e.settings.pass_mark
    let c = 1
    bodyCell(ws.getCell(r, c++), i + 1, { zebra })
    bodyCell(ws.getCell(r, c++), st.full_name, { left: true, zebra })
    cw.forEach((k) => bodyCell(ws.getCell(r, c++), v?.[k.key] ?? null, { zebra }))
    if (cwSum) bodyCell(ws.getCell(r, c++), res?.coursework ?? null, { bold: true, zebra })
    fin.forEach((k) => bodyCell(ws.getCell(r, c++), v?.[k.key] ?? null, { zebra }))
    if (finSum) bodyCell(ws.getCell(r, c++), res?.finalSum ?? null, { bold: true, zebra })
    bodyCell(ws.getCell(r, c++), res?.special ? SPECIAL_LABEL[res.special] : res?.total ?? null, { bold: true, red: fail, zebra })
    bodyCell(ws.getCell(r, c++), res?.label ?? '', { red: fail, zebra })
    bodyCell(ws.getCell(r, c++), [st.status !== 'active' ? (st.status === 'withdrawn' ? 'منسحب' : 'مؤجل') : '', v?.note ?? ''].filter(Boolean).join(' — '), { left: true, zebra })
  })

  let r = 8 + e.students.length + 1
  titleRow(ws, r++, cols, 'إحصائيات المادة', 11, LIGHT, GREEN)
  const st = e.stats
  const pairs: [string, string | number][] = [
    ['عدد الطلبة', st.count],
    ['الناجحون', st.pass],
    ['الراسبون', st.fail],
    ['حالات خاصة', st.special],
    ['أعلى درجة', st.max ?? '—'],
    ['أدنى درجة', st.min ?? '—'],
    ['المعدل العام', st.avg ?? '—'],
    ['نسبة النجاح', st.passRate == null ? '—' : `${(st.passRate * 100).toFixed(1)}%`],
  ]
  for (let i = 0; i < pairs.length; i += 2) {
    infoRow(ws, r++, cols, [pairs[i], pairs[i + 1]].filter(Boolean).map(([k, v]) => [k, String(v)]))
  }
  signatures(ws, r + 1, cols, ['توقيع التدريسي', 'رئيس القسم', 'رئيس اللجنة الامتحانية'])
}

export async function exportSubjectXlsx(e: SubjectExport) {
  const wb = await workbook()
  const ws = newSheet(wb, safeSheetName(e.subject.name, new Set()))
  writeSubjectSheet(ws, e)
  await downloadWorkbook(wb, `درجات ${e.subject.name} - ${e.deptName} - ${e.yearLabel}.xlsx`)
}

export interface MasterExport {
  settings: Settings
  deptName: string
  yearLabel: string
  stage: number
  shift: Student['shift']
  termLabel: string
  subjects: Subject[]
  students: Student[]
  rows: MasterRow[]
  ranks: (number | null)[]
  subjectStats: SheetStats[]
  subjectSheets?: SubjectExport[]
}

export async function exportMasterXlsx(e: MasterExport) {
  const wb = await workbook()
  const used = new Set<string>()
  const ws = newSheet(wb, safeSheetName('الماستر شيت', used), true)
  const n = e.subjects.length
  const cols = 2 + n + 4
  ws.columns = [{ width: 5 }, { width: 32 }, ...e.subjects.map(() => ({ width: 13 })), { width: 10 }, { width: 10 }, { width: 8 }, { width: 26 }]
  titleRow(ws, 1, cols, `${e.settings.university_name} — ${e.settings.college_name}`)
  titleRow(ws, 2, cols, `قسم ${e.deptName}`, 12, LIGHT, GREEN)
  titleRow(ws, 3, cols, `الماستر شيت لدرجات الطلبة — جميع المواد — المرحلة ${stageShort(e.stage)} / ${e.termLabel}`, 12, LIGHT, 'FF000000')
  infoRow(ws, 4, cols, [
    ['نوع الدراسة', SHIFT_LONG[e.shift]],
    ['العام الدراسي', e.yearLabel],
    ['عدد المواد', String(n)],
  ])
  ws.mergeCells(6, 1, 7, 1)
  headerCell(ws.getCell(6, 1), 'ت')
  ws.mergeCells(6, 2, 7, 2)
  headerCell(ws.getCell(6, 2), 'اسم الطالب')
  if (n > 0) {
    if (n > 1) ws.mergeCells(6, 3, 6, 2 + n)
    headerCell(ws.getCell(6, 3), 'درجات المواد الدراسية (من 100)')
    e.subjects.forEach((s, i) => headerCell(ws.getCell(7, 3 + i), s.name))
  }
  ws.mergeCells(6, 3 + n, 6, cols)
  headerCell(ws.getCell(6, 3 + n), 'ملخص الأداء')
  ;['المعدل', `عدد النجاح (من ${n})`, 'الترتيب', 'الحالة العامة'].forEach((t, i) => headerCell(ws.getCell(7, 3 + n + i), t))
  ws.getRow(7).height = 48

  e.students.forEach((st, i) => {
    const r = 8 + i
    const m = e.rows[i]
    const zebra = i % 2 === 1
    bodyCell(ws.getCell(r, 1), i + 1, { zebra })
    bodyCell(ws.getCell(r, 2), st.full_name, { left: true, zebra })
    m.cells.forEach((c, j) =>
      bodyCell(ws.getCell(r, 3 + j), c.special ? SPECIAL_LABEL[c.special] : c.total, { red: c.total != null && c.total < e.settings.pass_mark, zebra }),
    )
    bodyCell(ws.getCell(r, 3 + n), m.average, { bold: true, zebra })
    bodyCell(ws.getCell(r, 4 + n), m.cells.some((c) => c.total != null) ? m.passed : null, { zebra })
    bodyCell(ws.getCell(r, 5 + n), e.ranks[i], { zebra })
    bodyCell(ws.getCell(r, 6 + n), m.status, { red: m.failed > 0, zebra, left: true })
  })

  let r = 8 + e.students.length + 1
  titleRow(ws, r++, cols, 'إحصائيات المواد الدراسية', 11, LIGHT, GREEN)
  const statRow = (label: string, f: (s: SheetStats) => ExcelJS.CellValue) => {
    ws.mergeCells(r, 1, r, 2)
    bodyCell(ws.getCell(r, 1), label, { bold: true })
    e.subjectStats.forEach((s, i) => bodyCell(ws.getCell(r, 3 + i), f(s)))
    r++
  }
  statRow('المعدل العام', (s) => s.avg)
  statRow('عدد الناجحين', (s) => s.pass)
  statRow('عدد الراسبين', (s) => s.fail)
  statRow('نسبة النجاح', (s) => (s.passRate == null ? '—' : `${(s.passRate * 100).toFixed(1)}%`))
  signatures(ws, r + 2, cols, ['مقرر القسم', 'رئيس القسم', 'رئيس اللجنة الامتحانية', 'العميد'])

  for (const sub of e.subjectSheets ?? []) {
    writeSubjectSheet(newSheet(wb, safeSheetName(sub.subject.name, used)), sub)
  }
  await downloadWorkbook(wb, `الماستر شيت - ${e.deptName} - المرحلة ${stageShort(e.stage)} - ${SHIFT_LONG[e.shift]} - ${e.termLabel} - ${e.yearLabel}.xlsx`)
}

export async function exportTableXlsx(opts: { title: string; subtitle?: string; sheet: string; headers: string[]; rows: ExcelJS.CellValue[][]; widths?: number[]; filename: string; settings: Settings }) {
  const wb = await workbook()
  const ws = newSheet(wb, safeSheetName(opts.sheet, new Set()), opts.headers.length > 7)
  const cols = opts.headers.length
  ws.columns = opts.headers.map((_, i) => ({ width: opts.widths?.[i] ?? 18 }))
  titleRow(ws, 1, cols, `${opts.settings.university_name} — ${opts.settings.college_name}`)
  titleRow(ws, 2, cols, opts.title, 12, LIGHT, GREEN)
  titleRow(ws, 3, cols, opts.subtitle ?? '', 10, 'FFFFFFFF', 'FF555555')
  ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 5 }]
  opts.headers.forEach((h, i) => headerCell(ws.getCell(5, i + 1), h))
  opts.rows.forEach((row, ri) => row.forEach((v, ci) => bodyCell(ws.getCell(6 + ri, ci + 1), v, { zebra: ri % 2 === 1, left: typeof v === 'string' && v.length > 12 })))
  await downloadWorkbook(wb, opts.filename)
}
