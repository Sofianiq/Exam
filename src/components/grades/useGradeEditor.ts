import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { backend } from '../../data'
import { componentsOf, computeRow, type RowResult } from '../../lib/calc'
import { parseGradeInput } from '../../lib/parse'
import type { Grade, GradeComponent, GradeRowInput, GradeValues, Settings, SpecialCode, Student, Subject } from '../../lib/types'

export interface DraftRow {
  cw_theory: string
  cw_practical: string
  final_practical: string
  final_theory: string
  special: SpecialCode | ''
  note: string
}

export interface ParsedRow {
  values: GradeValues
  errors: Partial<Record<GradeComponent, string>>
  result: RowResult
}

const EMPTY: DraftRow = { cw_theory: '', cw_practical: '', final_practical: '', final_theory: '', special: '', note: '' }
const str = (n: number | null | undefined) => (n == null ? '' : String(n))

export const toDraft = (g?: Grade): DraftRow =>
  g
    ? {
        cw_theory: str(g.cw_theory),
        cw_practical: str(g.cw_practical),
        final_practical: str(g.final_practical),
        final_theory: str(g.final_theory),
        special: g.special ?? '',
        note: g.note ?? '',
      }
    : { ...EMPTY }

export function parseDraft(subject: Subject, d: DraftRow, settings: Settings): ParsedRow {
  const values: GradeValues = {
    cw_theory: null,
    cw_practical: null,
    final_practical: null,
    final_theory: null,
    special: d.special || null,
    note: d.note.trim() || null,
  }
  const errors: ParsedRow['errors'] = {}
  for (const c of componentsOf(subject)) {
    const r = parseGradeInput(d[c.key], c.max)
    if (r.kind === 'number') values[c.key] = r.value
    else if (r.kind === 'special') values.special = values.special ?? r.code
    else if (r.kind === 'error') errors[c.key] = r.message
  }
  return { values, errors, result: computeRow(subject, values, settings) }
}

interface Options {
  subject: Subject | undefined
  students: Student[] | undefined
  grades: Grade[] | undefined
  settings: Settings
  reason: string | null
  onSaved: () => void
}

export function useGradeEditor({ subject, students, grades, settings, reason, onSaved }: Options) {
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({})
  const dirty = useRef(new Map<string, number>())
  const version = useRef(0)
  const [dirtyCount, setDirtyCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<boolean> | null>(null)

  // دمج بيانات الخادم مع الصفوف غير المعدّلة محلياً فقط
  useEffect(() => {
    if (!grades || !students) return
    const gmap = new Map(grades.map((g) => [g.student_id, g]))
    setDrafts((prev) => {
      const next: Record<string, DraftRow> = {}
      for (const st of students) next[st.id] = dirty.current.has(st.id) && prev[st.id] ? prev[st.id] : toDraft(gmap.get(st.id))
      return next
    })
    const latest = grades.reduce<string | null>((m, g) => (!m || g.updated_at > m ? g.updated_at : m), null)
    setLastSaved((cur) => (cur && latest && cur > latest ? cur : latest))
  }, [grades, students])

  const parsed = useMemo(() => {
    const out: Record<string, ParsedRow> = {}
    if (!subject) return out
    for (const [id, d] of Object.entries(drafts)) out[id] = parseDraft(subject, d, settings)
    return out
  }, [drafts, subject, settings])
  const parsedRef = useRef(parsed)
  parsedRef.current = parsed

  const save = useCallback(async (): Promise<boolean> => {
    if (!subject) return true
    if (inflight.current) await inflight.current
    const snapshot = new Map(dirty.current)
    const rows: GradeRowInput[] = []
    for (const id of snapshot.keys()) {
      const p = parsedRef.current[id]
      if (!p || Object.keys(p.errors).length) continue
      rows.push({ student_id: id, ...p.values })
    }
    if (rows.length === 0) return snapshot.size === 0
    setSaving(true)
    const run = (async () => {
      try {
        const at = await backend.saveGrades(subject.id, rows, reason)
        for (const r of rows) {
          if (dirty.current.get(r.student_id) === snapshot.get(r.student_id)) dirty.current.delete(r.student_id)
        }
        setDirtyCount(dirty.current.size)
        setLastSaved(at)
        setSaveError(null)
        onSaved()
        return true
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'تعذر الحفظ')
        return false
      } finally {
        setSaving(false)
        inflight.current = null
      }
    })()
    inflight.current = run
    return run
  }, [subject, reason, onSaved])

  const saveRef = useRef(save)
  saveRef.current = save

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void saveRef.current()
    }, 1200)
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const update = useCallback(
    (studentId: string, patch: Partial<DraftRow>) => {
      setDrafts((prev) => ({ ...prev, [studentId]: { ...(prev[studentId] ?? EMPTY), ...patch } }))
      dirty.current.set(studentId, ++version.current)
      setDirtyCount(dirty.current.size)
      setSaveError(null)
      schedule()
    },
    [schedule],
  )

  /** يحفظ كل التعديلات المعلقة فوراً (قبل الإرسال أو مغادرة الصفحة) */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (dirty.current.size === 0) return true
    return saveRef.current()
  }, [])

  const invalidCount = useMemo(
    () => [...dirty.current.keys()].filter((id) => parsed[id] && Object.keys(parsed[id].errors).length > 0).length,
    [parsed, dirtyCount],
  )

  return { drafts, parsed, update, save, flush, dirtyCount, invalidCount, saving, lastSaved, saveError }
}
