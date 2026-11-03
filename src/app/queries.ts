import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { backend, type SubjectFilter } from '../data'
import type { ClassKey, Grade, Shift, Subject, SubjectProgress } from '../lib/types'

export const classKeyOf = (k: ClassKey): ClassKey => ({
  year_id: k.year_id,
  department_id: k.department_id,
  stage: k.stage,
  shift: k.shift,
})

/** يطابق المادة مع مرشح البحث (القسم، المرحلة، الدراسة، الفصل، التدريسي) */
export const matchesSubject = (x: Subject, f: SubjectFilter) =>
  (!f.department_id || x.department_id === f.department_id) &&
  (!f.stage || x.stage === f.stage) &&
  (!f.shift || x.shift === f.shift) &&
  (!f.term || x.term === f.term) &&
  (!f.teacher_id || x.teacher_ids.includes(f.teacher_id))

/**
 * مواد السنة الدراسية تُجلب مرة واحدة (حسب صلاحيات المستخدم) وتُرشَّح في الذاكرة،
 * فتتشارك كل الصفحات والتبويبات ذاكرة واحدة ويصبح التنقل بينها فورياً
 */
export const useSubjects = (f: SubjectFilter, enabled = true) => {
  const { department_id, stage, shift, term, teacher_id } = f
  const select = useMemo(
    () => (all: Subject[]) => all.filter((x) => matchesSubject(x, { year_id: f.year_id, department_id, stage, shift, term, teacher_id })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [department_id, stage, shift, term, teacher_id],
  )
  return useQuery({
    queryKey: ['subjects', { year_id: f.year_id }],
    queryFn: () => backend.listSubjects({ year_id: f.year_id }),
    enabled: enabled && !!f.year_id,
    select,
  })
}

export const useStudents = (k: ClassKey | null) =>
  useQuery({
    queryKey: ['students', k && classKeyOf(k)],
    queryFn: () => backend.listStudents(k!),
    enabled: !!k?.year_id,
  })

export const useGrades = (subjectIds: string[]) => {
  const qc = useQueryClient()
  const ids = useMemo(() => [...subjectIds].sort(), [subjectIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  return useQuery({
    queryKey: ['grades', ids],
    queryFn: () => backend.getGrades(ids),
    enabled: ids.length > 0,
    // عرض فوري من ذاكرة أوسع تحتوي هذه المواد (مثلاً فتح مادة بعد عرض الماستر شيت) ريثما تصل البيانات المحدثة
    placeholderData: () => {
      const want = new Set(ids)
      for (const [key, data] of qc.getQueriesData<Grade[]>({ queryKey: ['grades'] })) {
        const have = key[1] as string[] | undefined
        if (data && have && have.length > ids.length && ids.every((id) => have.includes(id))) return data.filter((g) => want.has(g.subject_id))
      }
      return undefined
    },
  })
}

export const useCurriculum = (departmentId: string | undefined) =>
  useQuery({ queryKey: ['curriculum', departmentId], queryFn: () => backend.listCurriculum(departmentId!), enabled: !!departmentId })

export const useProgress = (yearId: string) =>
  useQuery({ queryKey: ['progress', yearId], queryFn: () => backend.listProgress(yearId), enabled: !!yearId })

/** يحدّث كل البيانات المرتبطة بالدرجات والمواد بعد أي تعديل */
export function useInvalidate() {
  const qc = useQueryClient()
  return useCallback(
    (...keys: string[]) => {
      const list = keys.length ? keys : ['subjects', 'grades', 'progress', 'students', 'audit', 'subject']
      return Promise.all(list.map((k) => qc.invalidateQueries({ queryKey: [k] })))
    },
    [qc],
  )
}

export interface Completion {
  cells: number
  done: number
  ratio: number
}

export function completionOf(rows: SubjectProgress[]): Completion {
  const cells = rows.reduce((a, r) => a + r.n_students, 0)
  const done = rows.reduce((a, r) => a + r.n_complete, 0)
  return { cells, done, ratio: cells ? done / cells : 0 }
}

/** عدد الطلبة الفعلي (دون تكرار عبر المواد) */
export function studentCount(rows: SubjectProgress[]): number {
  const byClass = new Map<string, number>()
  for (const r of rows) {
    const k = `${r.department_id}|${r.stage}|${r.shift}`
    byClass.set(k, Math.max(byClass.get(k) ?? 0, r.n_students))
  }
  return [...byClass.values()].reduce((a, b) => a + b, 0)
}

export const parseShift = (s: string | undefined): Shift => (s === 'evening' ? 'evening' : 'morning')
