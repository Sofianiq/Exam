import { fmtNum, unitsLabel } from '../lib/format'
import type { RowResult, StudentSummary } from '../lib/calc'
import type { Grade, Settings, SpecialCode, Subject } from '../lib/types'

/**
 * ترتيب أعمدة الماستر شيت كما في سجل درجات برنامج اللجنة الامتحانية:
 * لكل مادة: الدور الأول (السعي، العملي النهائي، النظري) ← الدور الثاني (العملي النهائي، النظري)
 * لمن امتحن فيه ← الدرجة النهائية. الأعمدة غير المستخدمة في المادة لا تظهر، ولا تظهر أعمدة الدور الثاني
 * إلا إذا امتحن فيه طالب واحد على الأقل. في النتيجة السنوية تظهر الدرجة النهائية لكل مادة فقط.
 * دالة نقية تستخدمها الشاشة والطباعة وتصدير Excel.
 */

export type MsKind = 'cw' | 'prac' | 'theory' | 'r2prac' | 'r2theory' | 'final'

export interface MsCol {
  kind: MsKind
  /** عنوان العمود (يُكتب عمودياً) */
  label: string
  /** الدرجة العظمى للعمود */
  max: number | null
}

export interface MsGroup {
  subject: Subject
  /** موضع المادة في نتائج الطالب */
  index: number
  r1: MsCol[]
  r2: MsCol[]
  final: MsCol
  /** كل أعمدة المادة بالترتيب: الدور الأول ثم الثاني ثم الدرجة النهائية */
  cols: MsCol[]
}

export type MsTone = 'r2' | 'decision' | 'carried' | 'fail' | 'special'

export interface MsCell {
  text: string
  /** القيمة الرقمية (لتصدير Excel) */
  value: number | string | null
  tone?: MsTone
  /** علامة صغيرة بجانب الدرجة: ق = ناجح بقرار، د2 = حُسمت في الدور الثاني (في النتيجة السنوية) */
  mark?: 'ق' | 'د2'
}

/** الحالات الخاصة برمز مختصر داخل الأعمدة الضيقة */
export const SPECIAL_SHORT: Record<SpecialCode, string> = { absent: 'غ', banned: 'ح', postponed: 'م' }

type MasterRow = { results: RowResult[]; grades: (Grade | undefined)[]; summary: StudentSummary }

const hasR2Data = (g: Grade | undefined) => g != null && (g.r2_final_practical != null || g.r2_final_theory != null || g.r2_special != null)

export function masterGroups(subjects: Subject[], rows: MasterRow[], compact: boolean): MsGroup[] {
  return subjects.map((subject, index) => {
    const final: MsCol = { kind: 'final', label: 'الدرجة النهائية', max: 100 }
    if (compact) return { subject, index, r1: [], r2: [], final, cols: [final] }
    const prac = subject.practical_max > 0
    const theory = subject.final_max > 0
    // المواد المرحّلة من النظام السابق تخزّن الامتحان النهائي (عملي + نظري) في عمود واحد
    const theoryLabel = prac ? 'النظري' : subject.legacy ? 'الامتحان النهائي' : 'النظري'
    const r1: MsCol[] = []
    if (subject.coursework_max > 0) r1.push({ kind: 'cw', label: 'السعي', max: subject.coursework_max })
    if (prac) r1.push({ kind: 'prac', label: 'العملي النهائي', max: subject.practical_max })
    if (theory) r1.push({ kind: 'theory', label: theoryLabel, max: subject.final_max })
    const r2: MsCol[] = []
    if (rows.some((row) => row.results[index]?.needsR2 && hasR2Data(row.grades[index]))) {
      if (prac) r2.push({ kind: 'r2prac', label: 'العملي النهائي', max: subject.practical_max })
      if (theory) r2.push({ kind: 'r2theory', label: theoryLabel, max: subject.final_max })
    }
    return { subject, index, r1, r2, final, cols: [...r1, ...r2, final] }
  })
}

/** عنوان المادة: الاسم ثم الوحدات */
export const groupTitle = (s: Subject) => `${s.name}`
export const groupUnits = (s: Subject) => `${s.units ? unitsLabel(s.units) : 'الوحدات غير محددة'}${s.ministerial ? ' · وزارية' : ''}`

const num = (v: number | null | undefined): MsCell => ({ text: fmtNum(v ?? null), value: v ?? null })
const special = (code: SpecialCode): MsCell => ({ text: SPECIAL_SHORT[code], value: SPECIAL_SHORT[code], tone: 'special' })

export function masterCell(group: MsGroup, col: MsCol, row: MasterRow, compact: boolean): MsCell {
  const r = row.results[group.index]
  const g = row.grades[group.index]
  if (!r) return { text: '', value: null }
  // رمز الحالة الخاصة في الدور الأول يُكتب في آخر عمود امتحان (النظري، أو العملي إن لم يوجد نظري)
  const lastR1Exam = [...group.r1].reverse().find((c) => c.kind !== 'cw')?.kind
  const lastR2 = group.r2[group.r2.length - 1]?.kind
  switch (col.kind) {
    case 'cw':
      return num(r.coursework)
    case 'prac':
    case 'theory':
      if (r.special) return col.kind === lastR1Exam ? special(r.special) : { text: '', value: null }
      return num(col.kind === 'prac' ? g?.final_practical : g?.final_theory)
    case 'r2prac':
    case 'r2theory': {
      // درجات الدور الثاني لمن يحق له فقط (راسب في الأول أو حالة خاصة)
      if (!r.needsR2 || !hasR2Data(g)) return { text: '', value: null }
      if (r.r2Special) return col.kind === lastR2 ? { ...special(r.r2Special), tone: 'r2' } : { text: '', value: null, tone: 'r2' }
      const v = col.kind === 'r2prac' ? g?.r2_final_practical : g?.r2_final_theory
      return { ...num(v), tone: 'r2' }
    }
    case 'final': {
      if (r.finalSpecial) return special(r.finalSpecial)
      if (r.finalTotal == null) return { text: '', value: null }
      const cell: MsCell = num(r.finalTotal)
      if (r.byDecision) {
        cell.tone = 'decision'
        cell.mark = 'ق'
      } else if (r.finalPassed === false) {
        // المادة الراسبة لطالب «ناجح بالتحميل» = مادة محمل بها
        cell.tone = row.summary.status === 'pass_carry' ? 'carried' : 'fail'
      }
      if (compact && r.finalRound === 2 && !cell.mark) cell.mark = 'د2'
      return cell
    }
  }
}

/** مجموع الدرجات حسب النظام المعتمد (الموزون: الدرجة × الوحدات) والمعدل (المجموع ÷ الوحدات) */
export function masterTotals(summary: StudentSummary, settings: Pick<Settings, 'average_mode'>) {
  const weighted = settings.average_mode === 'weighted'
  return { total: weighted ? summary.weightedSum : summary.sum, average: summary.average, units: summary.units }
}

export const totalsCaption = (settings: Pick<Settings, 'average_mode'>) =>
  settings.average_mode === 'weighted'
    ? { total: 'الدرجة × الوحدات', average: 'المجموع ÷ الوحدات' }
    : { total: 'مجموع الدرجات', average: 'المجموع ÷ عدد المواد' }
