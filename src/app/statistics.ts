// إحصائيات اللجنة الامتحانية: تُحسب من محرك النتائج نفسه (buildClassResults) فتطابق الماستر شيت والنتائج تماماً
import { RANKED_STATUSES, bandCounts, round2, type ResultStatus, type RowResult } from '../lib/calc'
import type { Department, Grade, Settings, Shift, Student, Subject, Term } from '../lib/types'
import { buildClassResults, officialGrade, type StudentResultRow } from './results'

/** نطاق الإحصائية: فصل أول، فصل ثانٍ، أو النتيجة السنوية (الفصلان معاً) */
export type StatScope = 1 | 2 | 0

export interface Counts {
  /** الطلبة المستمرون الذين لهم مواد في هذا النطاق */
  students: number
  /** ناجحون (بما فيهم الناجحون في الدور الثاني وبالتحميل) */
  pass: number
  passR2: number
  passCarry: number
  /** ناجحون بقرار (ضمن الناجحين) */
  byDecision: number
  carry: number
  fail: number
  /** نتائج غير مكتملة (درجات ناقصة أو لم تُرصد) */
  incomplete: number
  /** الطلبة الذين حُسمت نتيجتهم أو هم مكملون */
  decided: number
  passRate: number | null
  average: number | null
  highest: number | null
  /** مجموع المعدلات وعددها لدمج المجموعات */
  avgSum: number
  avgN: number
}

export interface Band {
  label: string
  min: number
  upper: number
  count: number
}

export interface SubjectStat {
  subject: Subject
  /** الطلبة المسجلون (المستمرون) */
  students: number
  complete: number
  pass: number
  fail: number
  absent: number
  banned: number
  postponed: number
  passRate: number | null
  average: number | null
  max: number | null
  min: number | null
  needR2: number
  /** امتحنوا فعلاً في الدور الثاني (أو سُجلت لهم حالة فيه) */
  satR2: number
  passR2: number
  byDecision: number
  bands: Band[]
}

export interface FailingStudent {
  student: Student
  status: ResultStatus
  /** المواد الراسب أو المكمل فيها */
  subjects: string[]
  average: number | null
}

export interface TopStudent {
  student: Student
  average: number
  rank: number
  label: string | null
}

export interface ClassStat {
  key: string
  department_id: string
  stage: number
  shift: Shift
  counts: Counts
  subjects: SubjectStat[]
  failing: FailingStudent[]
  top: TopStudent[]
  bands: Band[]
}

export interface DeptStat {
  department: Department
  counts: Counts
  classes: ClassStat[]
  subjects: SubjectStat[]
  failing: (FailingStudent & { cls: ClassStat })[]
  top: (TopStudent & { cls: ClassStat })[]
  bands: Band[]
}

export interface GroupStat {
  label: string
  counts: Counts
}

export interface CollegeStat {
  scope: StatScope
  counts: Counts
  departments: DeptStat[]
  byStage: GroupStat[]
  byShift: GroupStat[]
  byGender: GroupStat[]
  bands: Band[]
  /** المواد الأقل نسبة نجاح (5 طلبة مكتملين على الأقل) */
  hardest: (SubjectStat & { department: Department })[]
  top: (TopStudent & { cls: ClassStat; department: Department })[]
  subjects: number
  records: number
  /** قوائم غير معتمدة بعد في هذا النطاق (لا تدخل في الإحصائية الرسمية) */
  unapproved: number
}

const emptyCounts = (): Counts => ({
  students: 0,
  pass: 0,
  passR2: 0,
  passCarry: 0,
  byDecision: 0,
  carry: 0,
  fail: 0,
  incomplete: 0,
  decided: 0,
  passRate: null,
  average: null,
  highest: null,
  avgSum: 0,
  avgN: 0,
})

function finish(c: Counts): Counts {
  c.decided = c.pass + c.carry + c.fail
  c.passRate = c.decided ? c.pass / c.decided : null
  c.average = c.avgN ? round2(c.avgSum / c.avgN) : null
  return c
}

function addRow(c: Counts, r: StudentResultRow) {
  const s = r.summary
  c.students++
  if (RANKED_STATUSES.includes(s.status)) {
    c.pass++
    if (s.status === 'pass_r2') c.passR2++
    if (s.status === 'pass_carry') c.passCarry++
    if (s.byDecision.length) c.byDecision++
  } else if (s.status === 'carry') c.carry++
  else if (s.status === 'fail') c.fail++
  else c.incomplete++
  if (s.average != null && s.status !== 'none' && s.status !== 'incomplete') {
    c.avgSum += s.average
    c.avgN++
    c.highest = c.highest == null ? s.average : Math.max(c.highest, s.average)
  }
}

export function mergeCounts(list: Counts[]): Counts {
  const c = emptyCounts()
  for (const x of list) {
    c.students += x.students
    c.pass += x.pass
    c.passR2 += x.passR2
    c.passCarry += x.passCarry
    c.byDecision += x.byDecision
    c.carry += x.carry
    c.fail += x.fail
    c.incomplete += x.incomplete
    c.avgSum += x.avgSum
    c.avgN += x.avgN
    if (x.highest != null) c.highest = c.highest == null ? x.highest : Math.max(c.highest, x.highest)
  }
  return finish(c)
}

const countsOf = (rows: StudentResultRow[]) => {
  const c = emptyCounts()
  rows.forEach((r) => addRow(c, r))
  return finish(c)
}

function subjectStat(subject: Subject, results: RowResult[], settings: Settings): SubjectStat {
  const totals = results.map((r) => r.finalTotal).filter((t): t is number => t != null)
  const pass = results.filter((r) => r.finalPassed === true).length
  const fail = results.filter((r) => r.finalPassed === false).length
  const special = (code: string) => results.filter((r) => r.special === code).length
  return {
    subject,
    students: results.length,
    complete: results.filter((r) => r.complete || r.overridden).length,
    pass,
    fail,
    absent: special('absent'),
    banned: special('banned'),
    postponed: special('postponed'),
    passRate: pass + fail ? pass / (pass + fail) : null,
    average: totals.length ? round2(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
    max: totals.length ? Math.max(...totals) : null,
    min: totals.length ? Math.min(...totals) : null,
    needR2: results.filter((r) => r.complete && r.needsR2).length,
    satR2: results.filter((r) => r.complete && r.needsR2 && (r.r2Complete || r.overridden)).length,
    passR2: results.filter((r) => r.finalRound === 2 && r.finalPassed === true).length,
    byDecision: results.filter((r) => r.byDecision).length,
    bands: bandCounts(totals, settings.grade_scale),
  }
}

export interface StatsInput {
  subjects: Subject[]
  students: Student[]
  grades: Grade[]
  settings: Settings
  departments: Department[]
  scope: StatScope
  /** المعتمد فقط (كما في النتيجة الرسمية) */
  official: boolean
}

const classKeyOf = (x: { department_id: string; stage: number; shift: Shift }) => `${x.department_id}|${x.stage}|${x.shift}`

/** يبني إحصائيات الكلية والأقسام والمراحل والمواد لنطاق محدد */
export function buildStatistics({ subjects, students, grades, settings, departments, scope, official }: StatsInput): CollegeStat {
  const inScope = subjects.filter((x) => scope === 0 || x.term === (scope as Term))
  const subjectById = new Map(subjects.map((x) => [x.id, x]))
  const usable = official
    ? grades.flatMap((g) => {
        const sub = subjectById.get(g.subject_id)
        const o = sub ? officialGrade(sub, g) : undefined
        return o ? [o] : []
      })
    : grades
  const gradesBySubject = new Map<string, Grade[]>()
  for (const g of usable) {
    const list = gradesBySubject.get(g.subject_id)
    if (list) list.push(g)
    else gradesBySubject.set(g.subject_id, [g])
  }
  const subsByClass = new Map<string, Subject[]>()
  for (const x of inScope) {
    const k = classKeyOf(x)
    const list = subsByClass.get(k)
    if (list) list.push(x)
    else subsByClass.set(k, [x])
  }
  const studentsByClass = new Map<string, Student[]>()
  for (const st of students) {
    const k = classKeyOf(st)
    const list = studentsByClass.get(k)
    if (list) list.push(st)
    else studentsByClass.set(k, [st])
  }

  const classes: ClassStat[] = []
  const rowsByClass = new Map<string, StudentResultRow[]>()
  for (const [k, subs] of subsByClass) {
    const sts = (studentsByClass.get(k) ?? []).slice().sort((a, b) => a.seq - b.seq)
    if (!sts.length) continue
    const res = buildClassResults(subs, sts, subs.flatMap((x) => gradesBySubject.get(x.id) ?? []), settings)
    const active = res.rows.filter((r) => r.student.status === 'active')
    rowsByClass.set(k, active)
    const [department_id, stage, shift] = k.split('|')
    classes.push({
      key: k,
      department_id,
      stage: Number(stage),
      shift: shift as Shift,
      counts: countsOf(active),
      subjects: res.subjects.map((sub, j) => subjectStat(sub, active.map((r) => r.results[j]), settings)),
      failing: active
        .filter((r) => r.summary.status === 'fail' || r.summary.status === 'carry' || r.summary.status === 'pass_carry')
        .map((r) => ({
          student: r.student,
          status: r.summary.status,
          subjects: r.summary.status === 'carry' ? (r.summary.pendingR2.length ? r.summary.pendingR2 : r.summary.finalFailed) : r.summary.finalFailed,
          average: r.summary.average,
        }))
        .sort((a, b) => b.subjects.length - a.subjects.length || a.student.seq - b.student.seq),
      top: active
        .filter((r) => r.rank != null && r.summary.average != null)
        .sort((a, b) => a.rank! - b.rank! || a.student.seq - b.student.seq)
        .slice(0, 10)
        .map((r) => ({ student: r.student, average: r.summary.average!, rank: r.rank!, label: r.summary.averageLabel })),
      bands: averageBands(active, settings),
    })
  }
  const deptOrder = new Map(departments.map((d, i) => [d.id, d.sort * 1000 + i]))
  classes.sort((a, b) => (deptOrder.get(a.department_id) ?? 0) - (deptOrder.get(b.department_id) ?? 0) || a.stage - b.stage || a.shift.localeCompare(b.shift))

  const depts: DeptStat[] = departments
    .map((department) => {
      const cls = classes.filter((c) => c.department_id === department.id)
      const rows = cls.flatMap((c) => rowsByClass.get(c.key) ?? [])
      return {
        department,
        counts: mergeCounts(cls.map((c) => c.counts)),
        classes: cls,
        subjects: cls.flatMap((c) => c.subjects),
        failing: cls.flatMap((c) => c.failing.map((f) => ({ ...f, cls: c }))),
        top: cls
          .flatMap((c) => c.top.map((t) => ({ ...t, cls: c })))
          .sort((a, b) => b.average - a.average)
          .slice(0, 10),
        bands: averageBands(rows, settings),
      }
    })
    .filter((d) => d.classes.length > 0)

  const allRows = classes.flatMap((c) => rowsByClass.get(c.key) ?? [])
  const group = (label: string, pred: (r: StudentResultRow) => boolean): GroupStat => ({ label, counts: countsOf(allRows.filter(pred)) })
  const stages = [...new Set(classes.map((c) => c.stage))].sort((a, b) => a - b)
  const genders = allRows.some((r) => r.student.gender)
  const deptById = new Map(departments.map((d) => [d.id, d]))

  return {
    scope,
    counts: mergeCounts(depts.map((d) => d.counts)),
    departments: depts,
    byStage: stages.map((st) => group(`المرحلة ${STAGE_WORD[st] ?? st}`, (r) => r.student.stage === st)),
    byShift: (['morning', 'evening'] as Shift[]).map((sh) => group(sh === 'morning' ? 'الدراسة الصباحية' : 'الدراسة المسائية', (r) => r.student.shift === sh)).filter((g) => g.counts.students > 0),
    byGender: genders
      ? [group('الذكور', (r) => r.student.gender === 'male'), group('الإناث', (r) => r.student.gender === 'female')].filter((g) => g.counts.students > 0)
      : [],
    bands: averageBands(allRows, settings),
    hardest: classes
      .flatMap((c) => c.subjects.map((x) => ({ ...x, department: deptById.get(c.department_id)! })))
      .filter((x) => x.department && x.pass + x.fail >= 5 && x.passRate != null)
      .sort((a, b) => a.passRate! - b.passRate! || (a.average ?? 0) - (b.average ?? 0))
      .slice(0, 10),
    top: classes
      .flatMap((c) => c.top.map((t) => ({ ...t, cls: c, department: deptById.get(c.department_id)! })))
      .filter((t) => t.department)
      .sort((a, b) => b.average - a.average)
      .slice(0, 10),
    subjects: inScope.length,
    records: inScope.reduce((n, x) => n + (gradesBySubject.get(x.id)?.length ?? 0), 0),
    unapproved: inScope.filter((x) => x.status !== 'approved').length,
  }
}

const STAGE_WORD = ['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة']

function averageBands(rows: StudentResultRow[], settings: Settings): Band[] {
  const avgs = rows.filter((r) => r.summary.status !== 'none' && r.summary.status !== 'incomplete').map((r) => r.summary.average)
  return bandCounts(avgs, settings.grade_scale)
}

export const pct = (v: number | null | undefined) => (v == null ? '—' : `${round2(v * 100)}%`)

export const SCOPE_LABEL: Record<StatScope, string> = { 1: 'الفصل الأول', 2: 'الفصل الثاني', 0: 'النتيجة السنوية' }

export const STATUS_WORD: Partial<Record<ResultStatus, string>> = { fail: 'راسب', carry: 'مكمل', pass_carry: 'ناجح بالتحميل' }
