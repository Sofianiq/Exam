// بوابة الطالب: بناء النسخ التي تُنشر للطلبة بمحرك النتائج نفسه (فتطابق الماستر شيت والنتيجة الرسمية)
import { slipModel } from '../components/ResultSlip'
import { computeRow } from '../lib/calc'
import type {
  Grade,
  PortalChange,
  PortalCourseworkSnapshot,
  PortalKind,
  PortalPublishPayload,
  PortalResultSnapshot,
  PortalTerm,
  Settings,
  Student,
  Subject,
} from '../lib/types'
import { buildClassResults, buildStudentReport, officialGrade } from './results'

const bySort = (a: Subject, b: Subject) => a.term - b.term || a.sort - b.sort || a.name.localeCompare(b.name, 'ar')

/** السعي: مجموع السعي لكل مادة فقط — لا يُنشر تفصيل النظري والعملي ولا أي درجة امتحان */
export function courseworkSnapshot(subjects: Subject[], grades: Map<string, Grade>, settings: Settings): PortalCourseworkSnapshot {
  return {
    v: 1,
    subjects: subjects
      .filter((x) => x.coursework_max > 0)
      .map((x) => ({ name: x.name, units: x.units, cw: computeRow(x, grades.get(x.id), settings).coursework, max: x.coursework_max })),
  }
}

/**
 * يبني نسخ صف كامل للنشر.
 * - السعي: كل مواد الفصل بدرجاتها الحالية.
 * - النتيجة: المعتمد فقط، بالتقديرات والحالة (ناجح/مكمل/راسب/ناجح بالتحميل…) دون أي درجة.
 */
export function buildPortalSnapshots(
  kind: PortalKind,
  term: PortalTerm,
  subjects: Subject[],
  students: Student[],
  grades: Grade[],
  settings: Settings,
): PortalPublishPayload['snapshots'] {
  const active = students.filter((st) => st.status === 'active')
  const scoped = subjects.filter((x) => term === 0 || x.term === term).sort(bySort)
  if (kind === 'coursework') {
    const byStudent = new Map<string, Map<string, Grade>>()
    for (const g of grades) {
      let m = byStudent.get(g.student_id)
      if (!m) byStudent.set(g.student_id, (m = new Map()))
      m.set(g.subject_id, g)
    }
    return active.map((st) => ({ student_id: st.id, data: courseworkSnapshot(scoped, byStudent.get(st.id) ?? new Map(), settings) }))
  }
  const subjectById = new Map(subjects.map((x) => [x.id, x]))
  const official = grades.flatMap((g) => {
    const sub = subjectById.get(g.subject_id)
    const o = sub ? officialGrade(sub, g) : undefined
    return o ? [o] : []
  })
  const ranks = new Map(buildClassResults(scoped, students, official, settings).rows.map((r) => [r.student.id, r.rank]))
  return active.map((st) => {
    const m = slipModel(st, buildStudentReport(subjects, grades, st.id, settings, true), term)
    const rank = ranks.get(st.id) ?? null
    const data: PortalResultSnapshot = {
      v: 1,
      scope: term,
      sections: m.sections,
      overallLabel: m.overallLabel,
      units: m.units,
      status: m.status,
      statusText: m.statusText,
      failedTitle: m.failedTitle,
      failed: m.failed,
      round: m.round,
      rank: rank != null && rank <= 10 && (m.status === 'pass' || m.status === 'pass_r2') ? rank : null,
    }
    return { student_id: st.id, data }
  })
}

/** سبب منع النشر (null = جاهز). النتيجة لا تُنشر قبل اعتماد كل قوائم الفصل حتى لا تظهر للطالب ناقصة */
export function publishBlocker(kind: PortalKind, term: PortalTerm, changes: Pick<PortalChange, 'term' | 'subjects' | 'approved'>[]): string | null {
  const terms = term === 0 ? [1, 2] : [term]
  for (const t of terms) {
    const c = changes.find((x) => x.term === t)
    const name = t === 1 ? 'الفصل الأول' : 'الفصل الثاني'
    if (!c || c.subjects === 0) return `لا توجد مواد في ${name}`
    if (kind === 'results' && c.approved < c.subjects) return `${c.subjects - c.approved} من قوائم ${name} لم تُعتمد بعد`
  }
  return null
}

export const PORTAL_ITEMS: { term: PortalTerm; kind: PortalKind; label: string; short: string }[] = [
  { term: 1, kind: 'coursework', label: 'سعي الفصل الأول', short: 'سعي ف1' },
  { term: 2, kind: 'coursework', label: 'سعي الفصل الثاني', short: 'سعي ف2' },
  { term: 1, kind: 'results', label: 'نتيجة الفصل الأول', short: 'نتيجة ف1' },
  { term: 2, kind: 'results', label: 'نتيجة الفصل الثاني', short: 'نتيجة ف2' },
  { term: 0, kind: 'results', label: 'النتيجة السنوية', short: 'السنوية' },
]

/** رابط الدخول المباشر المشفّر في رمز QR على بطاقة الطالب */
export function portalLoginUrl(portalUrl: string | null | undefined, loginId: string, code: string | null): string | null {
  if (!portalUrl) return null
  const base = portalUrl.trim().replace(/#.*$/, '')
  return `${base}${base.endsWith('/') ? '' : '/'}#/login?u=${encodeURIComponent(loginId)}${code ? `&c=${encodeURIComponent(code)}` : ''}`
}

/** آخر تغيير في درجات الفصل (أو الفصلين للنتيجة السنوية) كما يعيده ملخص البوابة */
export function changedAtOf(term: PortalTerm, changes: PortalChange[]): string | null {
  const terms = term === 0 ? [1, 2] : [term]
  return changes.filter((c) => terms.includes(c.term)).reduce<string | null>((m, c) => (c.changed_at && (!m || c.changed_at > m) ? c.changed_at : m), null)
}

/** هل تغيّرت الدرجات بعد آخر نشر؟ (يحتاج الطلبة إلى «تحديث النشر» ليروا الجديد) */
export function isStalePublication(pub: { term: PortalTerm; published_at: string } | undefined, changes: PortalChange[]): boolean {
  if (!pub) return false
  const at = changedAtOf(pub.term, changes)
  return !!at && at > pub.published_at
}
