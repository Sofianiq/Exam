import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { backend, type SubjectFilter } from '../data'
import type { ClassKey, Shift, SubjectProgress } from '../lib/types'

export const classKeyOf = (k: ClassKey): ClassKey => ({
  year_id: k.year_id,
  department_id: k.department_id,
  stage: k.stage,
  shift: k.shift,
})

export const useSubjects = (f: SubjectFilter, enabled = true) =>
  useQuery({ queryKey: ['subjects', f], queryFn: () => backend.listSubjects(f), enabled: enabled && !!f.year_id })

export const useStudents = (k: ClassKey | null) =>
  useQuery({
    queryKey: ['students', k && classKeyOf(k)],
    queryFn: () => backend.listStudents(k!),
    enabled: !!k?.year_id,
  })

export const useGrades = (subjectIds: string[]) => {
  const ids = [...subjectIds].sort()
  return useQuery({ queryKey: ['grades', ids], queryFn: () => backend.getGrades(ids), enabled: ids.length > 0 })
}

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
