import { computeRow } from '../lib/calc'
import type { Department, Grade, Settings, Student, Subject } from '../lib/types'

/**
 * فحص سلامة البيانات: يكشف ما قد يؤثر في صحة النتائج قبل اعتمادها ونشرها، دون تعديل أي شيء.
 * دالة نقية تعمل على بيانات السنة الدراسية (المواد والطلبة والدرجات) وتُختبر بمعزل عن الواجهة.
 */

export type HealthLevel = 'error' | 'warning' | 'info'

export type HealthKind =
  | 'missing_grades'
  | 'missing_r2'
  | 'dup_name'
  | 'dup_no'
  | 'no_units'
  | 'ministerial_min'
  | 'override_below_min'
  | 'no_teacher'
  | 'class_no_subjects'
  | 'class_no_students'

export interface HealthIssue {
  kind: HealthKind
  level: HealthLevel
  title: string
  detail: string
  department_id: string
  stage: number
  shift: Student['shift']
  /** رابط الإصلاح داخل النظام */
  link: string
  /** أسماء الطلبة المعنيين (للعرض المختصر) */
  names?: string[]
}

export interface HealthReport {
  issues: HealthIssue[]
  counts: Record<HealthLevel, number>
  checked: { subjects: number; students: number; grades: number }
}

export const LEVEL_ORDER: HealthLevel[] = ['error', 'warning', 'info']

/** تطبيع الاسم للمقارنة: «عبد الله» = «عبدالله»، والهمزات والتاء المربوطة والألف المقصورة موحّدة */
export function nameKey(s: string): string {
  return String(s ?? '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^| )(عبد|ابو) /g, '$1$2')
}

const classKeyOf = (x: { department_id: string; stage: number; shift: Student['shift'] }) => `${x.department_id}|${x.stage}|${x.shift}`
const classLink = (x: { department_id: string; stage: number; shift: Student['shift'] }, tab: 'subjects' | 'students' | 'master' = 'subjects', term?: number) =>
  `/class/${x.department_id}/${x.stage}/${x.shift}?tab=${tab}${term ? `&term=${term}` : ''}`
/** العدد مع المعدود: طالب واحد، طالبان، 3 طلبة، 11 طالباً */
const studentsCount = (n: number) => (n === 1 ? 'طالب واحد' : n === 2 ? 'طالبان' : n <= 10 ? `${n} طلبة` : `${n} طالباً`)
const listNames = (names: string[], max = 6) => (names.length > max ? `${names.slice(0, max).join('، ')} و${names.length - max} آخرين` : names.join('، '))

export function runHealthCheck(input: { subjects: Subject[]; students: Student[]; grades: Grade[]; settings: Settings; departments?: Department[] }): HealthReport {
  const { subjects, students, grades, settings } = input
  const issues: HealthIssue[] = []
  const gmap = new Map<string, Grade>()
  for (const g of grades) gmap.set(`${g.subject_id}|${g.student_id}`, g)
  const byClass = new Map<string, Student[]>()
  for (const st of students) {
    const k = classKeyOf(st)
    byClass.set(k, [...(byClass.get(k) ?? []), st])
  }
  const subjectsByClass = new Map<string, Subject[]>()
  for (const sub of subjects) {
    const k = classKeyOf(sub)
    subjectsByClass.set(k, [...(subjectsByClass.get(k) ?? []), sub])
  }

  // 1) المواد
  for (const sub of subjects) {
    const where = { department_id: sub.department_id, stage: sub.stage, shift: sub.shift }
    const termText = sub.term === 1 ? 'الفصل الأول' : 'الفصل الثاني'
    const active = (byClass.get(classKeyOf(sub)) ?? []).filter((s) => s.status === 'active')
    const results = active.map((st) => ({ st, g: gmap.get(`${sub.id}|${st.id}`), r: computeRow(sub, gmap.get(`${sub.id}|${st.id}`), settings) }))

    if (sub.status === 'approved') {
      const missing = results.filter((x) => !x.r.complete && !x.r.overridden).map((x) => x.st.full_name)
      if (missing.length)
        issues.push({
          kind: 'missing_grades',
          level: 'error',
          title: `قائمة معتمدة فيها ${studentsCount(missing.length)} بلا درجات مكتملة`,
          detail: `${sub.name} — ${termText}. النتيجة تبقى «غير مكتملة» لهؤلاء: ${listNames(missing)}`,
          ...where,
          link: `/subjects/${sub.id}`,
          names: missing,
        })
    }
    if (sub.r2_status === 'approved') {
      const pending = results.filter((x) => x.r.complete && x.r.needsR2 && !x.r.r2Complete && !x.r.overridden).map((x) => x.st.full_name)
      if (pending.length)
        issues.push({
          kind: 'missing_r2',
          level: 'warning',
          title: `قائمة الدور الثاني معتمدة وفيها ${studentsCount(pending.length)} بلا درجة دور ثانٍ`,
          detail: `${sub.name} — ${termText}. يبقون «مكملين» حتى تُرصد درجتهم أو حالتهم (غائب/محروم): ${listNames(pending)}`,
          ...where,
          link: `/subjects/${sub.id}`,
          names: pending,
        })
    }
    if (!sub.units || sub.units <= 0)
      issues.push({
        kind: 'no_units',
        level: settings.average_mode === 'weighted' ? 'warning' : 'info',
        title: 'مادة بلا وحدات',
        detail: `${sub.name} — ${termText}. ${settings.average_mode === 'weighted' ? 'المعدل الموزون يحتسبها بوحدة واحدة، فيتأثر مجموع الدرجات والمعدل.' : 'تُعرض الوحدات في النتيجة المطبوعة.'}`,
        ...where,
        link: classLink(where, 'subjects', sub.term),
      })
    if (sub.ministerial && sub.final_min == null)
      issues.push({
        kind: 'ministerial_min',
        level: 'warning',
        title: 'مادة تقويمية بلا حد أدنى للامتحان النهائي',
        detail: `${sub.name} — ${termText}. لن يُطبَّق شرط النجاح في الامتحان النهائي (30 من 60 عادةً).`,
        ...where,
        link: classLink(where, 'subjects', sub.term),
      })
    if (sub.final_min != null) {
      const below = results
        .filter(({ g }) => {
          if (g?.final_override == null || g.final_override < settings.pass_mark) return false
          const r2 = g.r2_final_practical != null || g.r2_final_theory != null
          const exam = r2 ? (g.r2_final_practical ?? 0) + (g.r2_final_theory ?? 0) : (g.final_practical ?? 0) + (g.final_theory ?? 0)
          return exam < (sub.final_min ?? 0)
        })
        .map((x) => x.st.full_name)
      if (below.length)
        issues.push({
          kind: 'override_below_min',
          level: 'warning',
          title: below.length === 1 ? 'درجة مثبتة تُظهر الطالب ناجحاً رغم عدم بلوغ الحد الأدنى' : `درجات مثبتة تُظهر ${studentsCount(below.length)} ناجحين رغم عدم بلوغ الحد الأدنى`,
          detail: `${sub.name} — ${termText}. الامتحان النهائي أقل من ${sub.final_min} والدرجة المثبتة ناجحة: ${listNames(below)}`,
          ...where,
          link: `/subjects/${sub.id}`,
          names: below,
        })
    }
    if (!sub.legacy && sub.teacher_ids.length === 0)
      issues.push({
        kind: 'no_teacher',
        level: 'info',
        title: 'مادة غير مسندة إلى تدريسي',
        detail: `${sub.name} — ${termText}. لا يستطيع أحد غير الإدارة إدخال درجاتها.`,
        ...where,
        link: classLink(where, 'subjects', sub.term),
      })
  }

  // 2) الطلبة: الأسماء المكررة في الصف، والرقم الجامعي المكرر في السنة
  for (const [k, list] of byClass) {
    const seen = new Map<string, Student[]>()
    for (const st of list) {
      const nk = nameKey(st.full_name)
      if (!nk) continue
      seen.set(nk, [...(seen.get(nk) ?? []), st])
    }
    for (const dup of seen.values())
      if (dup.length > 1) {
        const [department_id, stage, shift] = k.split('|')
        issues.push({
          kind: 'dup_name',
          level: 'error',
          title: 'اسم مكرر في الصف نفسه',
          detail: `«${dup[0].full_name}» مسجل ${dup.length} مرات. إن كان الطالب نفسه فاحذف التكرار، وإلا فميّز الاسمين بالاسم الرباعي.`,
          department_id,
          stage: Number(stage),
          shift: shift as Student['shift'],
          link: classLink({ department_id, stage: Number(stage), shift: shift as Student['shift'] }, 'students'),
          names: dup.map((d) => d.full_name),
        })
      }
  }
  const byNo = new Map<string, Student[]>()
  for (const st of students) {
    const no = st.student_no?.trim()
    if (no) byNo.set(no, [...(byNo.get(no) ?? []), st])
  }
  for (const [no, list] of byNo)
    if (list.length > 1)
      issues.push({
        kind: 'dup_no',
        level: 'error',
        title: 'رقم جامعي مكرر لأكثر من طالب',
        detail: `الرقم ${no} مسجل لـ: ${listNames(list.map((s) => s.full_name))}`,
        department_id: list[0].department_id,
        stage: list[0].stage,
        shift: list[0].shift,
        link: `/student/${list[0].id}`,
        names: list.map((s) => s.full_name),
      })

  // 3) الصفوف: طلبة بلا مواد، أو مواد بلا طلبة
  for (const [k, list] of byClass)
    if (!subjectsByClass.has(k) && list.some((s) => s.status === 'active')) {
      const [department_id, stage, shift] = k.split('|')
      const where = { department_id, stage: Number(stage), shift: shift as Student['shift'] }
      issues.push({ kind: 'class_no_subjects', level: 'warning', title: 'صف فيه طلبة بلا مواد دراسية', detail: `${studentsCount(list.length)} دون أي مادة في هذه السنة.`, ...where, link: classLink(where, 'subjects') })
    }
  for (const [k, list] of subjectsByClass)
    if (!byClass.has(k)) {
      const [department_id, stage, shift] = k.split('|')
      const where = { department_id, stage: Number(stage), shift: shift as Student['shift'] }
      issues.push({ kind: 'class_no_students', level: 'info', title: 'صف فيه مواد بلا طلبة', detail: `${list.length} مادة دون طلبة مسجلين في هذه السنة.`, ...where, link: classLink(where, 'students') })
    }

  const rank = (l: HealthLevel) => LEVEL_ORDER.indexOf(l)
  issues.sort((a, b) => rank(a.level) - rank(b.level) || a.department_id.localeCompare(b.department_id) || a.stage - b.stage || a.shift.localeCompare(b.shift))
  const counts = { error: 0, warning: 0, info: 0 } as Record<HealthLevel, number>
  for (const i of issues) counts[i.level]++
  return { issues, counts, checked: { subjects: subjects.length, students: students.length, grades: grades.length } }
}
