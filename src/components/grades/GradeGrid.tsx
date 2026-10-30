import { useCallback, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { componentsOf, type ComponentDef } from '../../lib/calc'
import { fmtNum } from '../../lib/format'
import { SPECIAL_LABEL } from '../../lib/labels'
import { parseClipboardGrid, parseGradeInput } from '../../lib/parse'
import type { GradeComponent, SpecialCode, Student, Subject } from '../../lib/types'
import { cx } from '../ui'
import type { DraftRow, ParsedRow } from './useGradeEditor'

interface Props {
  subject: Subject
  students: Student[]
  /** رقم التسلسل المعروض لكل طالب (موقعه في القائمة الكاملة حتى عند البحث) */
  numberOf: Map<string, number>
  drafts: Record<string, DraftRow>
  parsed: Record<string, ParsedRow>
  readOnly: boolean
  highlightMissing: boolean
  passMark: number
  onChange: (studentId: string, patch: Partial<DraftRow>) => void
  onPasteRows?: (count: number) => void
}

export function GradeGrid({ subject, students, numberOf, drafts, parsed, readOnly, highlightMissing, passMark, onChange, onPasteRows }: Props) {
  const comps = componentsOf(subject)
  const cw = comps.filter((c) => c.group === 'coursework')
  const fin = comps.filter((c) => c.group === 'final')
  const showCwSum = cw.length > 1
  const showFinSum = fin.length > 1
  const tableRef = useRef<HTMLTableElement>(null)
  const headRef = useRef<HTMLTableRowElement>(null)

  useLayoutEffect(() => {
    const h = headRef.current?.getBoundingClientRect().height
    if (h && tableRef.current) tableRef.current.style.setProperty('--head-row-1', `${h}px`)
  })

  const focusCell = useCallback((r: number, c: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  // التنقل مثل Excel: الأسهم وEnter تنقل بين الخلايا مباشرة
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const moves: Record<string, [number, number]> = {
      Enter: e.shiftKey ? [r - 1, c] : [r + 1, c],
      ArrowDown: [r + 1, c],
      ArrowUp: [r - 1, c],
      ArrowLeft: [r, c + 1], // الاتجاه من اليمين لليسار: يسار = العمود التالي
      ArrowRight: [r, c - 1],
    }
    const to = moves[e.key]
    if (!to) return
    e.preventDefault()
    focusCell(to[0], to[1])
  }

  const commitSpecial = (studentId: string, key: GradeComponent, raw: string, max: number) => {
    const p = parseGradeInput(raw, max)
    if (p.kind === 'special') onChange(studentId, { [key]: '', special: p.code })
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text/plain')
    if (!/[\t\n]/.test(text.trim())) return
    e.preventDefault()
    const grid = parseClipboardGrid(text)
    let rows = 0
    grid.forEach((cells, dr) => {
      const st = students[r + dr]
      if (!st) return
      const patch: Partial<DraftRow> = {}
      cells.forEach((raw, dc) => {
        const comp = comps[c + dc]
        if (!comp) return
        const p = parseGradeInput(raw, comp.max)
        if (p.kind === 'special') {
          patch.special = p.code
          patch[comp.key] = ''
        } else {
          patch[comp.key] = raw.trim()
        }
      })
      onChange(st.id, patch)
      rows++
    })
    onPasteRows?.(rows)
  }

  const head = (c: ComponentDef) => (
    <th key={c.key} className="px-1 py-2 text-center text-xs font-semibold text-muted">
      {c.group === 'coursework' ? (cw.length > 1 ? c.label.replace('السعي ', '') : 'الدرجة') : fin.length > 1 ? c.label.replace(' النهائي', '') : 'الدرجة'}
      <span className="block font-normal tabular-nums text-faint">({c.max})</span>
    </th>
  )

  const cell = (st: Student, r: number, c: ComponentDef, ci: number) => {
    const d = drafts[st.id]
    const p = parsed[st.id]
    const err = p?.errors[c.key]
    const val = d?.[c.key] ?? ''
    const missing = highlightMissing && !p?.values.special && val.trim() === '' && st.status === 'active'
    return (
      <td key={c.key} className={cx('p-0.5', err && 'cell-error', missing && 'cell-missing')} title={err}>
        <input
          className="cell-input"
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          aria-label={`${c.label} — ${st.full_name}`}
          data-r={r}
          data-c={ci}
          value={val}
          disabled={readOnly}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(st.id, { [c.key]: e.target.value })}
          onBlur={(e) => commitSpecial(st.id, c.key, e.target.value, c.max)}
          onKeyDown={(e) => onKeyDown(e, r, ci)}
          onPaste={(e) => onPaste(e, r, ci)}
        />
      </td>
    )
  }

  const sumCell = (v: number | null, max: number) => (
    <td className="bg-surface-2/60 px-2 text-center text-sm font-semibold tabular-nums text-muted">{v == null ? '' : `${fmtNum(v)}`}<span className="sr-only"> من {max}</span></td>
  )

  return (
    <table ref={tableRef} className="grade-grid w-full min-w-[860px] text-sm">
      <thead>
        <tr ref={headRef}>
          <th rowSpan={2} className="sticky-col start-0 w-11 px-2 py-2 text-center text-xs text-muted">ت</th>
          <th rowSpan={2} className="sticky-col start-11 min-w-56 px-3 py-2 text-start text-xs text-muted">اسم الطالب</th>
          {cw.length > 0 && (
            <th colSpan={cw.length + (showCwSum ? 1 : 0)} className="px-2 py-2 text-center text-xs font-bold text-ink">
              السعي الفصلي ({subject.coursework_max}%)
            </th>
          )}
          {fin.length > 0 && (
            <th colSpan={fin.length + (showFinSum ? 1 : 0)} className="px-2 py-2 text-center text-xs font-bold text-ink">
              الامتحان النهائي ({100 - subject.coursework_max}%)
            </th>
          )}
          <th rowSpan={2} className="w-20 px-2 py-2 text-center text-xs font-bold text-ink">
            الدرجة النهائية
            <span className="block font-normal text-faint">(100)</span>
          </th>
          <th rowSpan={2} className="w-20 px-2 py-2 text-center text-xs text-muted">التقدير</th>
          <th rowSpan={2} className="w-24 px-2 py-2 text-center text-xs text-muted">حالة خاصة</th>
          <th rowSpan={2} className="min-w-32 px-2 py-2 text-start text-xs text-muted">ملاحظات</th>
        </tr>
        <tr>
          {cw.map(head)}
          {showCwSum && (
            <th className="px-1 py-2 text-center text-xs font-semibold text-muted">
              المجموع<span className="block font-normal tabular-nums text-faint">({subject.coursework_max})</span>
            </th>
          )}
          {fin.map(head)}
          {showFinSum && (
            <th className="px-1 py-2 text-center text-xs font-semibold text-muted">
              المجموع<span className="block font-normal tabular-nums text-faint">({100 - subject.coursework_max})</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {students.map((st, r) => {
          const d = drafts[st.id]
          const p = parsed[st.id]
          const res = p?.result
          const inactive = st.status !== 'active'
          const fail = res?.total != null && res.total < passMark
          let ci = 0
          return (
            <tr key={st.id} className={cx(inactive && 'opacity-55')}>
              <td className="sticky-col start-0 px-2 text-center text-xs tabular-nums text-muted">{numberOf.get(st.id)}</td>
              <td className="sticky-col start-11 px-3 py-1 font-medium whitespace-nowrap">
                {st.full_name}
                {inactive && <span className="ms-2 text-xs text-warning">({st.status === 'withdrawn' ? 'منسحب' : 'مؤجل'})</span>}
              </td>
              {cw.map((c) => cell(st, r, c, ci++))}
              {showCwSum && sumCell(res?.coursework ?? null, subject.coursework_max)}
              {fin.map((c) => cell(st, r, c, ci++))}
              {showFinSum && sumCell(res?.finalSum ?? null, 100 - subject.coursework_max)}
              <td className={cx('px-2 text-center text-base font-bold tabular-nums', fail ? 'text-danger' : 'text-ink')}>
                {res?.special ? <span className="text-sm text-warning">{SPECIAL_LABEL[res.special]}</span> : fmtNum(res?.total ?? null)}
              </td>
              <td className={cx('px-2 text-center text-xs font-medium', fail ? 'text-danger' : 'text-muted')}>{res?.label}</td>
              <td className="p-0.5">
                <select
                  aria-label={`حالة خاصة — ${st.full_name}`}
                  className={cx('h-[34px] w-full rounded bg-transparent px-1 text-xs', d?.special ? 'font-semibold text-warning' : 'text-faint')}
                  value={d?.special ?? ''}
                  disabled={readOnly}
                  onChange={(e) => onChange(st.id, { special: e.target.value as SpecialCode | '' })}
                >
                  <option value="">—</option>
                  {Object.entries(SPECIAL_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </td>
              <td className="p-0.5">
                <input
                  className="cell-input text-start! px-2 text-xs"
                  aria-label={`ملاحظة — ${st.full_name}`}
                  value={d?.note ?? ''}
                  disabled={readOnly}
                  onChange={(e) => onChange(st.id, { note: e.target.value })}
                />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
