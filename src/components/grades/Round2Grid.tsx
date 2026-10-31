import { useCallback, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { componentsOf, R2_OF } from '../../lib/calc'
import { fmtNum } from '../../lib/format'
import { SPECIAL_LABEL } from '../../lib/labels'
import { parseClipboardGrid, parseGradeInput } from '../../lib/parse'
import type { R2Component, SpecialCode, Student, Subject } from '../../lib/types'
import { cx } from '../ui'
import type { DraftRow, ParsedRow } from './useGradeEditor'

/** جدول الدور الثاني: السعي الفصلي ثابت، ويُعاد إدخال درجات الامتحان النهائي فقط */
export function Round2Grid({
  subject,
  students,
  numberOf,
  drafts,
  parsed,
  readOnly,
  onChange,
  onPasteRows,
}: {
  subject: Subject
  students: Student[]
  numberOf: Map<string, number>
  drafts: Record<string, DraftRow>
  parsed: Record<string, ParsedRow>
  readOnly: boolean
  onChange: (studentId: string, patch: Partial<DraftRow>) => void
  onPasteRows?: (count: number) => void
}) {
  const fin = componentsOf(subject).filter((c) => c.group === 'final')
  const cols = fin.map((c) => ({ ...c, key2: R2_OF[c.key] as R2Component }))
  const showSum = cols.length > 1
  const tableRef = useRef<HTMLTableElement>(null)

  const focusCell = useCallback((r: number, c: number) => {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const moves: Record<string, [number, number]> = {
      Enter: e.shiftKey ? [r - 1, c] : [r + 1, c],
      ArrowDown: [r + 1, c],
      ArrowUp: [r - 1, c],
      ArrowLeft: [r, c + 1],
      ArrowRight: [r, c - 1],
    }
    const to = moves[e.key]
    if (!to) return
    e.preventDefault()
    focusCell(to[0], to[1])
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    const text = e.clipboardData.getData('text/plain')
    if (!/[\t\n]/.test(text.trim())) return
    e.preventDefault()
    let rows = 0
    parseClipboardGrid(text).forEach((cells, dr) => {
      const st = students[r + dr]
      if (!st) return
      const patch: Partial<DraftRow> = {}
      cells.forEach((raw, dc) => {
        const col = cols[c + dc]
        if (!col) return
        const p = parseGradeInput(raw, col.max)
        if (p.kind === 'special') {
          patch.r2_special = p.code
          patch[col.key2] = ''
        } else patch[col.key2] = raw.trim()
      })
      onChange(st.id, patch)
      rows++
    })
    onPasteRows?.(rows)
  }

  return (
    <table ref={tableRef} className="grade-grid w-full min-w-[820px] text-sm">
      <thead>
        <tr>
          <th rowSpan={2} className="sticky-col start-0 w-11 px-2 py-2 text-center text-xs text-muted">ت</th>
          <th rowSpan={2} className="sticky-col start-11 min-w-56 px-3 py-2 text-start text-xs text-muted">اسم الطالب</th>
          <th rowSpan={2} className="w-20 px-2 py-2 text-center text-xs text-muted">
            السعي الفصلي
            <span className="block font-normal text-faint">ثابت ({subject.coursework_max})</span>
          </th>
          <th rowSpan={2} className="w-24 px-2 py-2 text-center text-xs text-muted">نتيجة الدور الأول</th>
          <th colSpan={cols.length + (showSum ? 1 : 0)} className="bg-gold-soft! px-2 py-2 text-center text-xs font-bold text-gold-text">
            الامتحان النهائي — الدور الثاني ({100 - subject.coursework_max}%)
          </th>
          <th rowSpan={2} className="w-20 px-2 py-2 text-center text-xs font-bold text-ink">
            الدرجة النهائية
            <span className="block font-normal text-faint">(100)</span>
          </th>
          <th rowSpan={2} className="w-20 px-2 py-2 text-center text-xs text-muted">التقدير</th>
          <th rowSpan={2} className="w-24 px-2 py-2 text-center text-xs text-muted">حالة خاصة</th>
        </tr>
        <tr>
          {cols.map((c) => (
            <th key={c.key2} className="px-1 py-2 text-center text-xs font-semibold text-muted">
              {cols.length > 1 ? c.label.replace(' النهائي', '') : 'الدرجة'}
              <span className="block font-normal tabular-nums text-faint">({c.max})</span>
            </th>
          ))}
          {showSum && (
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
          const fail = res?.r2Total != null && res.finalPassed === false
          return (
            <tr key={st.id}>
              <td className="sticky-col start-0 px-2 text-center text-xs tabular-nums text-muted">{numberOf.get(st.id)}</td>
              <td className="sticky-col start-11 px-3 py-1 font-medium whitespace-nowrap">{st.full_name}</td>
              <td className="bg-surface-2/60 px-2 text-center font-semibold tabular-nums text-muted">{fmtNum(res?.coursework ?? null)}</td>
              <td className="px-2 text-center text-xs">
                {res?.special ? <span className="text-warning">{SPECIAL_LABEL[res.special]}</span> : <span className="font-semibold text-danger tabular-nums">{fmtNum(res?.total ?? null)}</span>}
              </td>
              {cols.map((c, ci) => {
                const err = p?.errors[c.key2]
                return (
                  <td key={c.key2} className={cx('p-0.5', err && 'cell-error')} title={err}>
                    <input
                      className="cell-input"
                      dir="ltr"
                      inputMode="decimal"
                      autoComplete="off"
                      aria-label={`${c.label} (الدور الثاني) — ${st.full_name}`}
                      data-r={r}
                      data-c={ci}
                      value={d?.[c.key2] ?? ''}
                      disabled={readOnly}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => onChange(st.id, { [c.key2]: e.target.value })}
                      onBlur={(e) => {
                        const parsedCell = parseGradeInput(e.target.value, c.max)
                        if (parsedCell.kind === 'special') onChange(st.id, { [c.key2]: '', r2_special: parsedCell.code })
                      }}
                      onKeyDown={(e) => onKeyDown(e, r, ci)}
                      onPaste={(e) => onPaste(e, r, ci)}
                    />
                  </td>
                )
              })}
              {showSum && <td className="bg-surface-2/60 px-2 text-center text-sm font-semibold tabular-nums text-muted">{fmtNum(res?.r2FinalSum ?? null)}</td>}
              <td className={cx('px-2 text-center text-base font-bold tabular-nums', fail ? 'text-danger' : 'text-success')}>
                {res?.r2Special ? <span className="text-sm text-warning">{SPECIAL_LABEL[res.r2Special]}</span> : fmtNum(res?.r2Total ?? null)}
              </td>
              <td className={cx('px-2 text-center text-xs font-medium', fail ? 'text-danger' : 'text-muted')}>{res?.r2Total != null ? res.finalLabel : ''}</td>
              <td className="p-0.5">
                <select
                  aria-label={`حالة الدور الثاني — ${st.full_name}`}
                  className={cx('h-[34px] w-full rounded bg-transparent px-1 text-xs', d?.r2_special ? 'font-semibold text-warning' : 'text-faint')}
                  value={d?.r2_special ?? ''}
                  disabled={readOnly}
                  onChange={(e) => onChange(st.id, { r2_special: e.target.value as SpecialCode | '' })}
                >
                  <option value="">—</option>
                  {Object.entries(SPECIAL_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
