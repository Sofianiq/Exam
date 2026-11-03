// تقرير التحقق من ملفات النظام السابق (Excel) — يُحمَّل عند الطلب فقط
import type * as ExcelJS from 'exceljs'
import { downloadWorkbook } from './excel'
import { FIX_REASON_LABEL, classLabel, type IssueLevel, type LegacyAnalysis } from './legacy'

const LEVEL: Record<IssueLevel, string> = { error: 'خطأ مانع', mismatch: 'فرق عن النظام السابق', warning: 'تنبيه', info: 'معلومة' }
const HEAD = 'FF14284B'

export async function exportLegacyReport(a: LegacyAnalysis, filename = 'تقرير التحقق من بيانات النظام السابق.xlsx') {
  const mod = await import('exceljs')
  const Excel = (mod as unknown as { default?: typeof ExcelJS }).default ?? (mod as unknown as typeof ExcelJS)
  const wb = new Excel.Workbook()
  wb.creator = 'نظام اللجنة الامتحانية'
  wb.created = new Date()

  const sheet = (name: string, header: string[], rows: (string | number | null)[][], widths: number[]) => {
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] })
    ws.addRow(header)
    for (const r of rows) ws.addRow(r)
    ws.columns.forEach((c, i) => (c.width = widths[i] ?? 14))
    const h = ws.getRow(1)
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } }
    h.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    h.height = 22
    return ws
  }

  sheet(
    'الملخص',
    ['البيان', 'العدد'],
    [
      ['ملفات الفصول', a.totals.termFiles],
      ['ملفات النتائج السنوية', a.totals.annualFiles],
      ['الصفوف الدراسية', a.classes.length],
      ['الصفوف المطابقة تماماً', a.classes.filter((c) => c.clean).length],
      ['الطلبة المرحَّلون', a.totals.students],
      ['سجلات الدرجات', a.totals.records],
      ['الطلبة المستبعدون (كل درجاتهم صفر)', a.totals.excluded],
      ['الدرجات المثبتة كما هي', a.totals.fixed],
      ['الأخطاء المانعة', a.classes.reduce((n, c) => n + c.issues.filter((i) => i.level === 'error').length, 0) + a.issues.filter((i) => i.level === 'error').length],
      ['الفروقات عن النظام السابق', a.classes.reduce((n, c) => n + c.issues.filter((i) => i.level === 'mismatch').length, 0)],
    ],
    [42, 14],
  )
  sheet(
    'الصفوف',
    ['الصف الدراسي', 'الفصل الأول', 'الفصل الثاني', 'النتيجة السنوية', 'الطلبة', 'المستبعدون', 'المواد', 'سجلات الدرجات', 'درجات القرار', 'الدور الثاني', 'المثبتة', 'نتائج فصلية مُتحقق منها', 'نتائج سنوية مُتحقق منها', 'الأخطاء', 'الفروقات', 'الحالة'],
    a.classes.map((c) => [
      classLabel(c),
      c.terms[1] ? 'موجود' : '—',
      c.terms[2] ? 'موجود' : '—',
      c.annual ? 'موجود' : '—',
      c.stats.students,
      c.stats.excluded,
      c.stats.subjects,
      c.stats.records,
      c.stats.decisions,
      c.stats.r2,
      c.stats.fixed,
      c.stats.checkedStudents,
      c.stats.checkedAnnual,
      c.issues.filter((i) => i.level === 'error').length,
      c.issues.filter((i) => i.level === 'mismatch').length,
      c.clean ? 'مطابق تماماً' : c.importable ? 'قابل للترحيل مع فروقات' : 'غير قابل للترحيل',
    ]),
    [52, 10, 10, 12, 9, 10, 8, 12, 10, 10, 9, 14, 14, 9, 9, 22],
  )
  sheet(
    'الملاحظات',
    ['المستوى', 'الصف الدراسي', 'الملف', 'الطالب', 'المادة', 'الملاحظة'],
    [
      ...a.issues.map((i) => [LEVEL[i.level], '—', i.file?.replace(/^.*[\\/]/, '') ?? '', i.student ?? '', i.subject ?? '', i.message]),
      ...a.classes.flatMap((c) => c.issues.map((i) => [LEVEL[i.level], classLabel(c), i.file?.replace(/^.*[\\/]/, '') ?? '', i.student ?? '', i.subject ?? '', i.message])),
    ],
    [18, 48, 40, 30, 30, 70],
  )
  sheet(
    'الدرجات المثبتة',
    ['الصف الدراسي', 'الفصل', 'الطالب', 'المادة', 'الدرجة في النظام السابق', 'الدرجة المحسوبة', 'السبب'],
    a.classes.flatMap((c) => c.fixed.map((f) => [classLabel(c), f.term === 1 ? 'الأول' : 'الثاني', f.student, f.subject, f.legacyFinal, f.computed, FIX_REASON_LABEL[f.reason]])),
    [48, 8, 30, 32, 14, 14, 40],
  )
  sheet(
    'المستبعدون',
    ['الصف الدراسي', 'الرقم الجامعي', 'اسم الطالب', 'الملاحظات'],
    a.classes.flatMap((c) => c.excluded.map((x) => [classLabel(c), x.no, x.name, x.notes])),
    [48, 24, 34, 50],
  )
  await downloadWorkbook(wb, filename)
}
