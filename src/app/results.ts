import { useMemo } from 'react'
import { computeRow, rankDescending, sheetStats, summarizeStudent, type RowResult, type SheetStats, type StudentSummary } from '../lib/calc'
import type { ClassKey, Grade, Settings, Student, Subject, Term } from '../lib/types'
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

/** تقرير طالب واحد: كل فصل على حدة + النتيجة السنوية */
export function buildStudentReport(subjects: Subject[], grades: Grade[], studentId: string, settings: Settings): StudentReport {
  const gmap = new Map(grades.filter((g) => g.student_id === studentId).map((g) => [g.subject_id, g]))
  const items: ReportItem[] = [...subjects].sort(sortSubjects).map((subject) => {
    const grade = gmap.get(subject.id)
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
