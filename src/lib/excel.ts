// تصدير ملفات Excel بنفس تنسيق سجلات الدرجات المعتمدة في الكلية (يُحمَّل عند الطلب فقط)
import type * as ExcelJS from 'exceljs'
import type { ClassResults } from '../app/results'
import { componentsOf, type RowResult, type SheetStats } from './calc'
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
  const hasR2 = e.students.some((st) => {
    const r = e.rows[st.id]?.result
    return !!r && r.needsR2 && r.r2Complete
  })
  const cols = 2 + cw.length + (cwSum ? 1 : 0) + fin.length + (finSum ? 1 : 0) + (hasR2 ? 2 : 0) + 3
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
  if (hasR2) {
    ws.mergeCells(6, col, 6, col + 1)
    headerCell(ws.getCell(6, col), 'الدور الثاني')
    headerCell(ws.getCell(7, col++), `النهائي\n(${100 - s.coursework_max})`)
    headerCell(ws.getCell(7, col++), 'المجموع\n(100)')
  }
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
    const fail = res?.finalTotal != null && res.finalPassed === false
    let c = 1
    bodyCell(ws.getCell(r, c++), i + 1, { zebra })
    bodyCell(ws.getCell(r, c++), st.full_name, { left: true, zebra })
    cw.forEach((k) => bodyCell(ws.getCell(r, c++), v?.[k.key] ?? null, { zebra }))
    if (cwSum) bodyCell(ws.getCell(r, c++), res?.coursework ?? null, { bold: true, zebra })
    fin.forEach((k) => bodyCell(ws.getCell(r, c++), v?.[k.key] ?? null, { zebra }))
    if (finSum) bodyCell(ws.getCell(r, c++), res?.finalSum ?? null, { bold: true, zebra })
    if (hasR2) {
      const show = !!res?.needsR2 && res.r2Complete
      bodyCell(ws.getCell(r, c++), show ? (res!.r2Special ? SPECIAL_LABEL[res!.r2Special] : res!.r2FinalSum) : null, { zebra })
      bodyCell(ws.getCell(r, c++), show ? res!.r2Total : null, { bold: true, zebra })
    }
    bodyCell(ws.getCell(r, c++), res?.finalSpecial ? SPECIAL_LABEL[res.finalSpecial] : res?.finalTotal ?? null, { bold: true, red: fail, zebra })
    bodyCell(ws.getCell(r, c++), res?.finalLabel ?? '', { red: fail, zebra })
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
  /** عرض مختصر (الدرجة النهائية فقط لكل مادة) — للنتيجة السنوية */
  compact: boolean
  data: ClassResults
  subjectSheets?: SubjectExport[]
}

const MS_FILL = {
  navy: 'FF1F3864',
  subjA: 'FFD9E2F3',
  subjB: 'FFE2EFDA',
  r1: 'FFF2F2F2',
  r2: 'FFDDEBF7',
  finalHead: 'FFFFF2CC',
  final: 'FFFFFBEA',
  decision: 'FFFFD966',
  carried: 'FFF8CBAD',
  fail: 'FFFCE4E1',
  zebra: 'FFFAFAFA',
  sum: 'FFF0EFEA',
  avg: 'FFF6EBCB',
}
const solid = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })

function msHead(c: ExcelJS.Cell, text: string, fill: string, opts: { rotate?: boolean; size?: number } = {}) {
  c.value = text
  c.font = { bold: true, size: opts.size ?? 10, color: { argb: 'FF000000' } }
  c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, textRotation: opts.rotate ? 90 : undefined }
  c.fill = solid(fill)
  c.border = box
}

/** الماستر شيت في Excel بترتيب سجل درجات برنامج اللجنة (A3 أفقي بحواف ضيقة، وتتكرر العناوين في كل صفحة) */
export async function exportMasterXlsx(e: MasterExport) {
  const { masterCell, masterGroups, masterTotals, groupUnits, totalsCaption } = await import('../app/masterLayout')
  const wb = await workbook()
  const used = new Set<string>()
  const ws = wb.addWorksheet(safeSheetName('الماستر شيت', used), {
    views: [{ rightToLeft: true, state: 'frozen', xSplit: 2, ySplit: 7 }],
    pageSetup: {
      paperSize: 8 as unknown as ExcelJS.PaperSize, // A3 (غير معرّف في أنواع المكتبة)
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      printTitlesRow: '5:7',
      margins: { left: 0.2, right: 0.2, top: 0.25, bottom: 0.3, header: 0.1, footer: 0.12 },
    },
    headerFooter: { oddFooter: '&Cصفحة &P من &N' },
  })
  const { subjects, rows, subjectStats } = e.data
  const groups = masterGroups(subjects, rows, e.compact)
  const caption = totalsCaption(e.settings)
  const first = 3
  const starts: number[] = []
  let c0 = first
  for (const g of groups) {
    starts.push(c0)
    c0 += g.cols.length
  }
  const after = c0
  const lastCol = after + 4 // مجموع الدرجات، المعدل، الترتيب، النتيجة، الملاحظات
  ws.columns = [
    { width: 5 },
    { width: 30 },
    ...groups.flatMap((g) => g.cols.map((c) => ({ width: e.compact ? 9 : c.kind === 'final' ? 8 : 6.5 }))),
    { width: 10 },
    { width: 9 },
    { width: 6 },
    { width: 24 },
    { width: 20 },
  ]

  titleRow(ws, 1, lastCol, `${e.settings.university_name} — ${e.settings.college_name}`, 15, MS_FILL.navy)
  titleRow(ws, 2, lastCol, `قسم ${e.deptName}  |  المرحلة ${stageShort(e.stage)}  |  ${SHIFT_LONG[e.shift]}  |  ${e.termLabel}  |  العام الدراسي ${e.yearLabel}`, 12, LIGHT, 'FF000000')
  titleRow(ws, 3, lastCol, 'الماستر شيت لدرجات الطلبة', 13, 'FFFFFFFF', MS_FILL.navy)

  // العناوين: المادة ← الدور الأول / الثاني / الدرجة النهائية ← السعي / العملي النهائي / النظري
  ws.mergeCells(5, 1, 7, 1)
  msHead(ws.getCell(5, 1), 'ت', MS_FILL.r1)
  ws.mergeCells(5, 2, 7, 2)
  msHead(ws.getCell(5, 2), 'اسم الطالب', MS_FILL.r1)
  groups.forEach((g, i) => {
    const c = starts[i]
    const fill = i % 2 ? MS_FILL.subjB : MS_FILL.subjA
    if (e.compact) {
      ws.mergeCells(5, c, 7, c)
      msHead(ws.getCell(5, c), `${g.subject.name}\n(${groupUnits(g.subject)})`, fill, { rotate: true, size: 9 })
      return
    }
    if (g.cols.length > 1) ws.mergeCells(5, c, 5, c + g.cols.length - 1)
    msHead(ws.getCell(5, c), `${g.subject.name}\n(${groupUnits(g.subject)})`, fill)
    let k = c
    if (g.r1.length) {
      if (g.r1.length > 1) ws.mergeCells(6, k, 6, k + g.r1.length - 1)
      msHead(ws.getCell(6, k), 'الدور الأول', MS_FILL.r1, { size: 9 })
      g.r1.forEach((col, x) => msHead(ws.getCell(7, k + x), `${col.label}\n(${col.max})`, MS_FILL.r1, { rotate: true, size: 9 }))
      k += g.r1.length
    }
    if (g.r2.length) {
      if (g.r2.length > 1) ws.mergeCells(6, k, 6, k + g.r2.length - 1)
      msHead(ws.getCell(6, k), 'الدور الثاني', MS_FILL.r2, { size: 9 })
      g.r2.forEach((col, x) => msHead(ws.getCell(7, k + x), `${col.label}\n(${col.max})`, MS_FILL.r2, { rotate: true, size: 9 }))
      k += g.r2.length
    }
    ws.mergeCells(6, k, 7, k)
    msHead(ws.getCell(6, k), 'الدرجة النهائية\n(100)', MS_FILL.finalHead, { rotate: true, size: 9 })
  })
  const endHeads: [string, string][] = [
    [`مجموع الدرجات\n(${caption.total})`, MS_FILL.sum],
    [`المعدل\n(${caption.average})`, MS_FILL.avg],
    ['الترتيب', MS_FILL.r1],
    ['النتيجة', MS_FILL.r1],
    ['الملاحظات', MS_FILL.r1],
  ]
  endHeads.forEach(([t, fill], i) => {
    ws.mergeCells(5, after + i, 7, after + i)
    msHead(ws.getCell(5, after + i), t, fill, { rotate: i < 3 })
  })
  ws.getRow(5).height = e.compact ? 110 : 44
  ws.getRow(6).height = e.compact ? 14 : 18
  ws.getRow(7).height = e.compact ? 14 : 78

  const TONE_FILL: Record<string, string> = { r2: MS_FILL.r2, decision: MS_FILL.decision, carried: MS_FILL.carried, fail: MS_FILL.fail }
  let r = 8
  rows.forEach((row, i) => {
    const zebra = i % 2 === 1
    const base = zebra ? MS_FILL.zebra : undefined
    const put = (col: number, v: ExcelJS.CellValue, o: { bold?: boolean; fill?: string; color?: string; left?: boolean; size?: number } = {}) => {
      const cell = ws.getCell(r, col)
      cell.value = v
      cell.font = { bold: o.bold, size: o.size ?? 10.5, color: o.color ? { argb: o.color } : undefined }
      cell.alignment = { horizontal: o.left ? 'right' : 'center', vertical: 'middle', wrapText: o.left }
      cell.border = box
      const f = o.fill ?? base
      if (f) cell.fill = solid(f)
    }
    put(1, i + 1)
    put(2, row.student.full_name, { bold: true, left: true })
    groups.forEach((g, gi) => {
      g.cols.forEach((col, x) => {
        const cell = masterCell(g, col, row, e.compact)
        const isFinal = col.kind === 'final'
        const fill = cell.tone && TONE_FILL[cell.tone] ? TONE_FILL[cell.tone] : isFinal ? MS_FILL.final : undefined
        const color = cell.tone === 'fail' || cell.tone === 'carried' ? 'FFB42318' : cell.tone === 'special' ? 'FF8A5200' : undefined
        const v = cell.mark && cell.value != null ? `${cell.text} ${cell.mark}` : cell.value
        put(starts[gi] + x, v, { bold: isFinal, fill, color })
      })
    })
    const st = row.student
    const totals = masterTotals(row.summary, e.settings)
    const resultText = st.status !== 'active' ? (st.status === 'withdrawn' ? 'منسحب' : 'مؤجل') : row.summary.statusText
    const statusColor = row.summary.status === 'fail' ? 'FFB42318' : row.summary.status === 'carry' ? 'FF8A5200' : st.status === 'active' ? 'FF0B6B3A' : 'FF555555'
    put(after, totals.total, { bold: true, fill: MS_FILL.sum })
    put(after + 1, totals.average, { bold: true, fill: MS_FILL.avg })
    put(after + 2, row.rank ?? '')
    put(after + 3, resultText, { left: true, bold: true, color: statusColor, size: 9.5 })
    put(after + 4, st.notes ?? '', { left: true, size: 9.5 })
    ws.getRow(r).height = 18
    r++
  })

  // إحصائيات المواد (تُدمج خلايا كل مادة)
  r += 1
  const statRow = (label: string, f: (s: SheetStats) => ExcelJS.CellValue) => {
    ws.mergeCells(r, 1, r, 2)
    bodyCell(ws.getCell(r, 1), label, { bold: true })
    groups.forEach((g, gi) => {
      const c = starts[gi]
      if (g.cols.length > 1) ws.mergeCells(r, c, r, c + g.cols.length - 1)
      bodyCell(ws.getCell(r, c), f(subjectStats[g.index]))
    })
    r++
  }
  statRow('المعدل العام', (x) => x.avg)
  statRow('أعلى درجة', (x) => x.max)
  statRow('أدنى درجة', (x) => x.min)
  statRow('عدد الناجحين', (x) => x.pass)
  statRow('عدد الراسبين', (x) => x.fail)
  statRow('نسبة النجاح', (x) => (x.passRate == null ? '—' : `${(x.passRate * 100).toFixed(1)}%`))

  // مفتاح القراءة
  r += 1
  const legend: [string, string | null][] = [
    [MS_FILL.decision, 'درجة نهائية معدلة بقرار (درجات القرار) — ق'],
    [MS_FILL.carried, 'مادة محمل بها الطالب'],
    [MS_FILL.r2, 'درجات الدور الثاني'],
    [MS_FILL.fail, 'درجة راسبة'],
    ['', 'غ = غائب · ح = محروم · م = مؤجل' + (e.compact ? ' · د2 = حُسمت في الدور الثاني' : '')],
    [
      '',
      e.settings.average_mode === 'weighted'
        ? 'مجموع الدرجات = Σ (الدرجة النهائية × وحدات المادة) — المعدل = مجموع الدرجات ÷ مجموع الوحدات'
        : 'المعدل = مجموع الدرجات ÷ عدد المواد',
    ],
  ]
  for (const [fill, text] of legend) {
    const chip = ws.getCell(r, 2)
    if (fill) {
      chip.fill = solid(fill)
      chip.border = box
    }
    ws.mergeCells(r, 3, r, Math.min(lastCol, 3 + 14))
    const t = ws.getCell(r, 3)
    t.value = text
    t.font = { size: 10, bold: !fill }
    t.alignment = { horizontal: 'right', vertical: 'middle' }
    r++
  }
  signatures(ws, r + 1, lastCol, ['مقرر القسم', 'المدقق', 'رئيس القسم', 'رئيس اللجنة الامتحانية', 'عميد الكلية'])

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
