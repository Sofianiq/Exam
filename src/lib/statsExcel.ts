// تصدير إحصائيات اللجنة الامتحانية إلى Excel بتنسيق أكاديمي (يُحمَّل عند الطلب فقط)
import type * as ExcelJS from 'exceljs'
import { SCOPE_LABEL, type Band, type ClassStat, type CollegeStat, type Counts, type DeptStat } from '../app/statistics'
import { downloadWorkbook } from './excel'
import { fmtDate } from './format'
import { SHIFT_LABEL, stageLabel } from './labels'

const NAVY = 'FF0B5A3A'
const LIGHT = 'FFE7F0EA'
const ZEBRA = 'FFF7F9F8'
const thin = { style: 'thin' as const, color: { argb: 'FFB5BDB8' } }
const box = { top: thin, left: thin, bottom: thin, right: thin }

type Cell = string | number | null

interface Meta {
  university: string
  college: string
  year: string
  /** لمقرر القسم: قسمه فقط */
  onlyDepartment?: string
  official: boolean
}

const STATUS_TEXT: Record<string, string> = { fail: 'راسب', carry: 'مكمل', pass_carry: 'ناجح بالتحميل' }
const classTitle = (c: ClassStat) => `${stageLabel(c.stage)} — ${SHIFT_LABEL[c.shift]}`
const rate = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 10000)

/** ورقة بترويسة رسمية وكاتب جداول متتالية */
class SheetWriter {
  row = 1
  constructor(
    readonly ws: ExcelJS.Worksheet,
    readonly cols: number,
  ) {}

  title(lines: string[], heading: string) {
    for (const l of lines) {
      const r = this.ws.getRow(this.row++)
      r.getCell(1).value = l
      r.font = { bold: true, size: 11 }
      this.ws.mergeCells(r.number, 1, r.number, this.cols)
      r.alignment = { horizontal: 'right' }
    }
    const h = this.ws.getRow(this.row++)
    h.getCell(1).value = heading
    this.ws.mergeCells(h.number, 1, h.number, this.cols)
    h.font = { bold: true, size: 15, color: { argb: NAVY } }
    h.alignment = { horizontal: 'center', vertical: 'middle' }
    h.height = 26
    this.row++
  }

  section(text: string) {
    const r = this.ws.getRow(this.row++)
    r.getCell(1).value = text
    this.ws.mergeCells(r.number, 1, r.number, this.cols)
    r.font = { bold: true, size: 12, color: { argb: NAVY } }
    r.height = 20
  }

  table(header: string[], rows: Cell[][], opts: { percentCols?: number[]; totalLast?: boolean } = {}) {
    const h = this.ws.getRow(this.row++)
    header.forEach((t, i) => {
      const c = h.getCell(i + 1)
      c.value = t
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
      c.border = box
    })
    h.height = 30
    rows.forEach((vals, ri) => {
      const r = this.ws.getRow(this.row++)
      const total = opts.totalLast && ri === rows.length - 1
      vals.forEach((v, i) => {
        const c = r.getCell(i + 1)
        c.value = v ?? '—'
        c.border = box
        c.alignment = { horizontal: i === 0 || typeof v === 'string' ? 'right' : 'center', vertical: 'middle', wrapText: true }
        if (opts.percentCols?.includes(i) && typeof v === 'number') c.numFmt = '0.0%'
        if (total) {
          c.font = { bold: true }
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } }
        } else if (ri % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } }
      })
    })
    this.row++
  }
}

const COUNT_HEAD = ['الطلبة', 'ناجح', 'منهم بالدور الثاني', 'منهم بقرار', 'منهم بالتحميل', 'مكمل', 'راسب', 'غير مكتمل', 'نسبة النجاح', 'المعدل', 'أعلى معدل']
const countRow = (c: Counts): Cell[] => [c.students, c.pass, c.passR2, c.byDecision, c.passCarry, c.carry, c.fail, c.incomplete, rate(c.passRate), c.average, c.highest]
const COUNT_PCT = [9]

function bandsTable(w: SheetWriter, bands: Band[]) {
  const total = bands.reduce((a, b) => a + b.count, 0)
  const ordered = [...bands].sort((a, b) => b.min - a.min)
  w.table(
    ['التقدير', 'المدى', 'عدد الطلبة', 'النسبة'],
    ordered.map((b) => [b.label, `${b.min} – ${b.upper}`, b.count, total ? rate(b.count / total) : null]),
    { percentCols: [3] },
  )
}

function deptSheet(wb: ExcelJS.Workbook, d: DeptStat, st: CollegeStat, header: string[], used: Set<string>) {
  let name = d.department.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
  while (used.has(name)) name = `${name.slice(0, 28)} ${used.size}`
  used.add(name)
  const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } })
  const w = new SheetWriter(ws, 17)
  w.title(header, `إحصائيات قسم ${d.department.name} — ${SCOPE_LABEL[st.scope]}`)
  w.section('أولاً: النتائج حسب المرحلة والدراسة')
  w.table(['المرحلة والدراسة', ...COUNT_HEAD], [...d.classes.map((c) => [classTitle(c), ...countRow(c.counts)]), ['القسم', ...countRow(d.counts)]], {
    percentCols: COUNT_PCT.map((i) => i + 1),
    totalLast: true,
  })
  w.section('ثانياً: نسبة النجاح في كل مادة')
  for (const c of d.classes) {
    w.section(classTitle(c))
    w.table(
      ['المادة', 'الفصل', 'الوحدات', 'الطلبة', 'ناجح', 'راسب', 'غائب', 'محروم', 'مؤجل', 'نسبة النجاح', 'المعدل', 'الأعلى', 'الأدنى', 'مكمل', 'امتحن د2', 'ناجح د2', 'ناجح بقرار'],
      c.subjects.map((x) => [
        x.subject.name,
        x.subject.term === 1 ? 'الأول' : 'الثاني',
        x.subject.units,
        x.students,
        x.pass,
        x.fail,
        x.absent,
        x.banned,
        x.postponed,
        rate(x.passRate),
        x.average,
        x.max,
        x.min,
        x.needR2,
        x.satR2,
        x.passR2,
        x.byDecision,
      ]),
      { percentCols: [9] },
    )
  }
  w.section(`ثالثاً: الطلبة الراسبون والمكملون (${d.failing.length})`)
  w.table(
    ['ت', 'اسم الطالب', 'الرقم الجامعي', 'المرحلة والدراسة', 'الحالة', 'عدد المواد', 'المواد', 'المعدل'],
    d.failing.map((f, i) => [i + 1, f.student.full_name, f.student.student_no ?? null, classTitle(f.cls), STATUS_TEXT[f.status] ?? f.status, f.subjects.length, f.subjects.join('، '), f.average]),
  )
  w.section('رابعاً: توزيع معدلات الطلبة حسب التقدير')
  bandsTable(w, d.bands)
  w.section('خامساً: أوائل القسم')
  w.table(
    ['ت', 'اسم الطالب', 'المرحلة والدراسة', 'المعدل', 'التقدير'],
    d.top.map((t, i) => [i + 1, t.student.full_name, classTitle(t.cls), t.average, t.label]),
  )
  ws.columns.forEach((c, i) => (c.width = [30, 12, 14, 18, 12, 12, 40, 10, 10, 12, 10, 10, 10, 10, 10, 10, 10][i] ?? 12))
}

export async function exportStatistics(st: CollegeStat, meta: Meta) {
  const mod = await import('exceljs')
  const Excel = (mod as unknown as { default?: typeof ExcelJS }).default ?? (mod as unknown as typeof ExcelJS)
  const wb = new Excel.Workbook()
  wb.creator = 'نظام اللجنة الامتحانية'
  wb.created = new Date()
  const header = [
    meta.university,
    `${meta.college} — اللجنة الامتحانية`,
    `العام الدراسي: ${meta.year} — ${SCOPE_LABEL[st.scope]} — ${meta.official ? 'النتائج المعتمدة فقط' : 'كل الدرجات المدخلة'} — تاريخ الإصدار: ${fmtDate(new Date())}`,
  ]
  const depts = meta.onlyDepartment ? st.departments.filter((d) => d.department.id === meta.onlyDepartment) : st.departments
  const used = new Set<string>()

  if (!meta.onlyDepartment) {
    const ws = wb.addWorksheet('ملخص الكلية', { views: [{ rightToLeft: true }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } })
    used.add('ملخص الكلية')
    const w = new SheetWriter(ws, 12)
    w.title(header, `إحصائيات اللجنة الامتحانية — ${SCOPE_LABEL[st.scope]}`)
    w.section('أولاً: المؤشرات العامة')
    w.table(
      ['المؤشر', 'القيمة'],
      [
        ['عدد الأقسام', st.departments.length],
        ['عدد الطلبة', st.counts.students],
        ['عدد المواد', st.subjects],
        ['سجلات الدرجات', st.records],
        ['الناجحون', st.counts.pass],
        ['المكملون', st.counts.carry],
        ['الراسبون', st.counts.fail],
        ['نتائج غير مكتملة', st.counts.incomplete],
        ['نسبة النجاح الكلية', rate(st.counts.passRate)],
        ['المعدل العام', st.counts.average],
        ['أعلى معدل', st.counts.highest],
        ['قوائم غير معتمدة', st.unapproved],
      ],
    )
    // تنسيق النسبة المئوية في صف «نسبة النجاح» فقط
    ws.eachRow((r) => {
      if (r.getCell(1).value === 'نسبة النجاح الكلية') r.getCell(2).numFmt = '0.0%'
    })
    w.section('ثانياً: النتائج حسب القسم')
    w.table(['القسم', ...COUNT_HEAD], [...st.departments.map((d) => [d.department.name, ...countRow(d.counts)]), ['الكلية', ...countRow(st.counts)]], {
      percentCols: [9],
      totalLast: true,
    })
    w.section('ثالثاً: النتائج حسب المرحلة الدراسية')
    w.table(['المرحلة', ...COUNT_HEAD], st.byStage.map((g) => [g.label, ...countRow(g.counts)]), { percentCols: [9] })
    w.section('رابعاً: النتائج حسب نوع الدراسة')
    w.table(['الدراسة', ...COUNT_HEAD], st.byShift.map((g) => [g.label, ...countRow(g.counts)]), { percentCols: [9] })
    if (st.byGender.length) {
      w.section('خامساً: النتائج حسب الجنس')
      w.table(['الجنس', ...COUNT_HEAD], st.byGender.map((g) => [g.label, ...countRow(g.counts)]), { percentCols: [9] })
    }
    w.section('توزيع معدلات الطلبة حسب التقدير')
    bandsTable(w, st.bands)
    w.section('المواد الأقل نسبة نجاح')
    w.table(
      ['المادة', 'القسم', 'المرحلة والدراسة', 'ناجح', 'راسب', 'نسبة النجاح', 'المعدل'],
      st.hardest.map((x) => [x.subject.name, x.department.name, `${stageLabel(x.subject.stage)} — ${SHIFT_LABEL[x.subject.shift]}`, x.pass, x.fail, rate(x.passRate), x.average]),
      { percentCols: [5] },
    )
    w.section('أوائل الكلية')
    w.table(
      ['ت', 'اسم الطالب', 'القسم', 'المرحلة والدراسة', 'المعدل', 'التقدير'],
      st.top.map((t, i) => [i + 1, t.student.full_name, t.department.name, classTitle(t.cls), t.average, t.label]),
    )
    ws.columns.forEach((c, i) => (c.width = [30, 16, 14, 14, 12, 12, 12, 12, 12, 12, 10, 10][i] ?? 12))
  }

  for (const d of depts) deptSheet(wb, d, st, header, used)

  // كل الراسبين والمكملين في ورقة واحدة (للمتابعة والفرز)
  const ws = wb.addWorksheet('الراسبون والمكملون', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] })
  const all = depts.flatMap((d) => d.failing.map((f) => ({ d, f })))
  const w = new SheetWriter(ws, 9)
  w.table(
    ['ت', 'القسم', 'المرحلة والدراسة', 'اسم الطالب', 'الرقم الجامعي', 'الحالة', 'عدد المواد', 'المواد', 'المعدل'],
    all.map(({ d, f }, i) => [i + 1, d.department.name, classTitle(f.cls), f.student.full_name, f.student.student_no ?? null, STATUS_TEXT[f.status] ?? f.status, f.subjects.length, f.subjects.join('، '), f.average]),
  )
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } }
  ws.columns.forEach((c, i) => (c.width = [6, 26, 22, 30, 22, 14, 10, 50, 10][i] ?? 12))

  const scope = SCOPE_LABEL[st.scope]
  const who = meta.onlyDepartment ? (depts[0]?.department.name ?? '') : 'الكلية'
  await downloadWorkbook(wb, `إحصائيات اللجنة الامتحانية — ${who} — ${scope} — ${meta.year}.xlsx`)
}
