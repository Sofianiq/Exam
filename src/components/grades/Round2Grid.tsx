import { memo, useMemo, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { componentsOf, R2_OF, type ComponentDef } from '../../lib/calc'
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
  const cols = useMemo<R2Col[]>(
    () => componentsOf(subject).filter((c) => c.group === 'final').map((c) => ({ ...c, key2: R2_OF[c.key] as R2Component })),
    [subject],
  )
  const showSum = cols.length > 1
  const tableRef = useRef<HTMLTableElement>(null)
  const latest = useRef({ students, cols, onChange, onPasteRows })
  latest.current = { students, cols, onChange, onPasteRows }

  // معالجات ثابتة المرجع حتى لا تُعاد رسم كل الصفوف عند الكتابة في صف واحد
  const h = useMemo<R2Handlers>(() => {
    const focusCell = (r: number, c: number) => {
      const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)
      if (el) {
        el.focus()
        el.select()
      }
    }
    return {
      change: (id, patch) => latest.current.onChange(id, patch),
      keyDown: (e, r, c) => {
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
      },
      paste: (e, r, c) => {
        const text = e.clipboardData.getData('text/plain')
        if (!/[\t\n]/.test(text.trim())) return
        e.preventDefault()
        const { students: list, cols: cs, onChange: change, onPasteRows: pasted } = latest.current
        let rows = 0
        parseClipboardGrid(text).forEach((cells, dr) => {
          const st = list[r + dr]
          if (!st) return
          const patch: Partial<DraftRow> = {}
          cells.forEach((raw, dc) => {
            const col = cs[c + dc]
            if (!col) return
            const p = parseGradeInput(raw, col.max)
            if (p.kind === 'special') {
              patch.r2_special = p.code
              patch[col.key2] = ''
            } else patch[col.key2] = raw.trim()
          })
          change(st.id, patch)
          rows++
        })
        pasted?.(rows)
      },
    }
  }, [])

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
        {students.map((st, r) => (
          <R2Row key={st.id} st={st} r={r} n={numberOf.get(st.id)} d={drafts[st.id]} p={parsed[st.id]} cols={cols} readOnly={readOnly} h={h} />
        ))}
      </tbody>
    </table>
  )
}

type R2Col = ComponentDef & { key2: R2Component }
interface R2Handlers {
  change: (studentId: string, patch: Partial<DraftRow>) => void
  keyDown: (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => void
  paste: (e: ClipboardEvent<HTMLInputElement>, r: number, c: number) => void
}

/** صف طالب في الدور الثاني — لا يُعاد رسمه إلا إذا تغيرت درجاته */
const R2Row = memo(function R2Row({
  st,
  r,
  n,
  d,
  p,
  cols,
  readOnly,
  h,
}: {
  st: Student
  r: number
  n: number | undefined
  d: DraftRow | undefined
  p: ParsedRow | undefined
  cols: R2Col[]
  readOnly: boolean
  h: R2Handlers
}) {
  const res = p?.result
  const fail = res?.r2Total != null && res.finalPassed === false
  return (
    <tr>
      <td className="sticky-col start-0 px-2 text-center text-xs tabular-nums text-muted">{n}</td>
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
              onChange={(e) => h.change(st.id, { [c.key2]: e.target.value })}
              onBlur={(e) => {
                const parsedCell = parseGradeInput(e.target.value, c.max)
                if (parsedCell.kind === 'special') h.change(st.id, { [c.key2]: '', r2_special: parsedCell.code })
              }}
              onKeyDown={(e) => h.keyDown(e, r, ci)}
              onPaste={(e) => h.paste(e, r, ci)}
            />
          </td>
        )
      })}
      {cols.length > 1 && <td className="bg-surface-2/60 px-2 text-center text-sm font-semibold tabular-nums text-muted">{fmtNum(res?.r2FinalSum ?? null)}</td>}
      <td className={cx('px-2 text-center text-base font-bold tabular-nums', fail ? 'text-danger' : 'text-success')}>
        {res?.r2Special ? <span className="text-sm text-warning">{SPECIAL_LABEL[res.r2Special]}</span> : fmtNum(res?.r2Total ?? null)}
        {res?.r2Raw != null && res.r2Total != null && res.r2Raw !== res.r2Total && (
          <span className="block text-[0.65rem] font-medium text-muted" title="مجموع الدور الثاني قبل خصم الدور الثاني">
            قبل الخصم {fmtNum(res.r2Raw)}
          </span>
        )}
        {!!p?.values.r2_decision && <span className="block text-[0.65rem] font-semibold text-gold-text">قرار +{fmtNum(p.values.r2_decision)}</span>}
        {res?.overridden && <span className="block text-[0.65rem] font-semibold text-info">النهائية {fmtNum(res.finalTotal)}</span>}
      </td>
      <td className={cx('px-2 text-center text-xs font-medium', fail ? 'text-danger' : 'text-muted')}>{res?.r2Total != null ? res.finalLabel : ''}</td>
      <td className="p-0.5">
        <select
          aria-label={`حالة الدور الثاني — ${st.full_name}`}
          className={cx('h-[34px] w-full rounded bg-transparent px-1 text-xs', d?.r2_special ? 'font-semibold text-warning' : 'text-faint')}
          value={d?.r2_special ?? ''}
          disabled={readOnly}
          onChange={(e) => h.change(st.id, { r2_special: e.target.value as SpecialCode | '' })}
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
})
