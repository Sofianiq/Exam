import { useMemo } from 'react'
import { computeRow, gradeLabel, lowestLabel, rankDescending, sheetStats, summarizeStudent, type RowResult, type SheetStats, type StudentSummary } from '../lib/calc'
import type { ClassKey, Grade, Settings, Student, Subject, Term, VerifiedResult, VerifiedSubject } from '../lib/types'
import { useGrades, useStudents, useSubjects } from './queries'

export interface StudentResultRow {
  student: Student
  /** نتيجة كل مادة بنفس ترتيب المواد */
  results: RowResult[]
  grades: (Grade | undefined)[]
  summary: StudentSummary
  rank: number | null
}

export interface ClassResults {
  subjects: Subject[]
  rows: StudentResultRow[]
  subjectStats: SheetStats[]
}

const sortSubjects = (a: Subject, b: Subject) => a.term - b.term || a.sort - b.sort || a.name.localeCompare(b.name, 'ar')

/** يبني نتائج صف كامل لمجموعة مواد (فصل أو سنة) — دالة نقية قابلة للاختبار */
export function buildClassResults(subjects: Subject[], students: Student[], grades: Grade[], settings: Settings): ClassResults {
  const subs = [...subjects].sort(sortSubjects)
  const gmap = new Map<string, Grade>()
  for (const g of grades) gmap.set(`${g.subject_id}|${g.student_id}`, g)
  const meta = subs.map((x) => ({ name: x.name, units: x.units }))
  const rows: StudentResultRow[] = students.map((st) => {
    const gs = subs.map((sub) => gmap.get(`${sub.id}|${st.id}`))
    const results = subs.map((sub, i) => computeRow(sub, gs[i], settings))
    return { student: st, grades: gs, results, summary: summarizeStudent(meta, results, settings), rank: null }
  })
  const active = rows.filter((r) => r.student.status === 'active')
  const ranks = rankDescending(active.map((r) => r.summary.average))
  active.forEach((r, i) => (r.rank = ranks[i]))
  const subjectStats = subs.map((_, j) =>
    sheetStats(
      active.map((r) => ({ ...r.results[j], total: r.results[j].finalTotal, passed: r.results[j].finalPassed })),
    ),
  )
  return { subjects: subs, rows, subjectStats }
}

/** نتائج صف لفصل محدد (1 أو 2) أو للسنة كاملة (0) */
export function useClassResults(classKey: ClassKey, term: Term | 0, settings: Settings) {
  const subjectsQ = useSubjects({ ...classKey, term: term || undefined })
  const studentsQ = useStudents(classKey)
  const subjects = useMemo(() => subjectsQ.data ?? [], [subjectsQ.data])
  const gradesQ = useGrades(subjects.map((x) => x.id))
  const data = useMemo(
    () => buildClassResults(subjects, studentsQ.data ?? [], gradesQ.data ?? [], settings),
    [subjects, studentsQ.data, gradesQ.data, settings],
  )
  return {
    ...data,
    loading: subjectsQ.isLoading || studentsQ.isLoading || (subjects.length > 0 && gradesQ.isLoading),
    grades: gradesQ.data ?? [],
  }
}

export interface ReportItem {
  subject: Subject
  grade: Grade | undefined
  result: RowResult
}

export interface ReportSection {
  term: Term
  items: ReportItem[]
  summary: StudentSummary
}

export interface StudentReport {
  sections: ReportSection[]
  annual: StudentSummary
}

/**
 * الدرجات الرسمية فقط (كما تظهر في صفحة التحقق العامة): درجات الدور الأول بعد اعتماد القائمة،
 * ودرجات الدور الثاني بعد اعتماد قائمته
 */
export function officialGrade(subject: Subject, grade: Grade | undefined): Grade | undefined {
  if (!grade || subject.status !== 'approved') return undefined
  if (subject.r2_status === 'approved') return grade
  return { ...grade, r2_final_practical: null, r2_final_theory: null, r2_special: null }
}

/** تقرير طالب واحد: كل فصل على حدة + النتيجة السنوية. official = المعتمد فقط (للنتيجة الرسمية المطبوعة) */
export function buildStudentReport(subjects: Subject[], grades: Grade[], studentId: string, settings: Settings, official = false): StudentReport {
  const gmap = new Map(grades.filter((g) => g.student_id === studentId).map((g) => [g.subject_id, g]))
  const items: ReportItem[] = [...subjects].sort(sortSubjects).map((subject) => {
    const grade = official ? officialGrade(subject, gmap.get(subject.id)) : gmap.get(subject.id)
    return { subject, grade, result: computeRow(subject, grade, settings) }
  })
  const summarize = (list: ReportItem[]) =>
    summarizeStudent(
      list.map((x) => ({ name: x.subject.name, units: x.subject.units })),
      list.map((x) => x.result),
      settings,
    )
  const sections = ([1, 2] as Term[])
    .map((term) => {
      const list = items.filter((x) => x.subject.term === term)
      return { term, items: list, summary: summarize(list) }
    })
    .filter((s) => s.items.length > 0)
  return { sections, annual: summarize(items) }
}

/** يحوّل نتيجة مادة معتمدة (من صفحة التحقق) إلى صيغة RowResult ليُحسب التقدير والحالة بنفس قواعد النظام */
export function rowFromVerified(x: VerifiedSubject, settings: VerifiedResult['settings']): RowResult {
  const pass = settings.pass_mark
  const labelOf = (t: number | null, ok: boolean | null) =>
    t == null ? null : ok === false && t >= pass ? lowestLabel(settings.grade_scale) : gradeLabel(t, settings.grade_scale)
  const complete = x.approved && (x.special != null || x.total != null)
  const passed = x.special != null ? false : x.total != null ? x.passed : null
  const needsR2 = complete && (x.special != null || x.passed === false)
  const r2Complete = x.r2_approved && (x.r2_special != null || x.r2_total != null)
  const useR2 = needsR2 && r2Complete
  const finalTotal = useR2 ? x.r2_total : x.total
  const finalSpecial = useR2 ? x.r2_special : x.special
  const finalPassed = finalTotal != null ? (useR2 ? x.r2_passed : x.passed) : finalSpecial != null ? false : null
  return {
    coursework: null,
    finalSum: null,
    total: x.total,
    complete,
    missing: [],
    special: x.special,
    label: labelOf(x.total, passed),
    passed,
    belowFinalMin: x.total != null && x.total >= pass && x.passed === false,
    needsR2,
    r2FinalSum: null,
    r2Total: x.r2_total,
    r2Special: x.r2_special,
    r2Complete,
    finalTotal,
    finalRound: useR2 ? 2 : 1,
    finalSpecial,
    finalLabel: labelOf(finalTotal, finalPassed),
    finalPassed,
    finalBelowMin: finalTotal != null && finalTotal >= pass && finalPassed === false,
  }
}

export interface VerifiedSection {
  term: Term
  items: { subject: VerifiedSubject; result: RowResult }[]
  summary: StudentSummary
}

/** نتيجة التحقق: كل فصل على حدة + النتيجة السنوية (المواد غير المعتمدة تجعل النتيجة غير مكتملة) */
export function buildVerifiedReport(v: VerifiedResult): { sections: VerifiedSection[]; annual: StudentSummary } {
  const items = v.subjects.map((subject) => ({ subject, result: rowFromVerified(subject, v.settings) }))
  const summarize = (list: typeof items) =>
    summarizeStudent(
      list.map((x) => ({ name: x.subject.name, units: x.subject.units })),
      list.map((x) => x.result),
      v.settings,
    )
  const sections = ([1, 2] as Term[])
    .map((term) => {
      const list = items.filter((x) => x.subject.term === term)
      return { term, items: list, summary: summarize(list) }
    })
    .filter((s) => s.items.length > 0)
  return { sections, annual: summarize(items) }
}
