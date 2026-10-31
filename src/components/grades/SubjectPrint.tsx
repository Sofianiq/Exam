import { componentsOf, type SheetStats } from '../../lib/calc'
import { fmtNum, fmtPct } from '../../lib/format'
import { SPECIAL_LABEL, STATUS_LABEL } from '../../lib/labels'
import type { Student, Subject } from '../../lib/types'
import { PrintHeader, PrintSignatures } from '../PrintParts'
import type { ParsedRow } from './useGradeEditor'

export function SubjectPrint({
  subject,
  students,
  parsed,
  stats,
  teachers,
}: {
  subject: Subject
  students: Student[]
  parsed: Record<string, ParsedRow>
  stats: SheetStats
  teachers: string
}) {
  const comps = componentsOf(subject)
  const cw = comps.filter((c) => c.group === 'coursework')
  const fin = comps.filter((c) => c.group === 'final')
  const cwSum = cw.length > 1
  const finSum = fin.length > 1
  const hasR2 = students.some((st) => {
    const r = parsed[st.id]?.result
    return !!r && r.needsR2 && r.r2Complete
  })
  return (
    <div className="print-only">
      <PrintHeader
        classKey={subject}
        term={subject.term}
        title={`قائمة درجات مادة: ${subject.name}`}
        extra={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>التدريسي: {teachers || '—'}</span>
            <span>حالة القائمة: {STATUS_LABEL[subject.status]}</span>
            {subject.ministerial && <span>مادة تقويمية (وزارية): يُشترط {subject.final_min} في الامتحان النهائي</span>}
            <span>عدد الطلبة: {students.length}</span>
          </div>
        }
      />
      <table className="print-table">
        <thead>
          <tr>
            <th rowSpan={2} style={{ width: '4%' }}>
              ت
            </th>
            <th rowSpan={2}>اسم الطالب</th>
            {cw.length > 0 && <th colSpan={cw.length + (cwSum ? 1 : 0)}>السعي الفصلي ({subject.coursework_max}%)</th>}
            {fin.length > 0 && <th colSpan={fin.length + (finSum ? 1 : 0)}>الامتحان النهائي ({100 - subject.coursework_max}%)</th>}
            {hasR2 && <th colSpan={2}>الدور الثاني</th>}
            <th rowSpan={2}>الدرجة النهائية (100)</th>
            <th rowSpan={2}>التقدير</th>
          </tr>
          <tr>
            {cw.map((c) => (
              <th key={c.key}>
                {cw.length > 1 ? c.label.replace('السعي ', '') : 'الدرجة'} ({c.max})
              </th>
            ))}
            {cwSum && <th>المجموع ({subject.coursework_max})</th>}
            {fin.map((c) => (
              <th key={c.key}>
                {fin.length > 1 ? c.label.replace(' النهائي', '') : 'الدرجة'} ({c.max})
              </th>
            ))}
            {finSum && <th>المجموع ({100 - subject.coursework_max})</th>}
            {hasR2 && (
              <>
                <th>النهائي ({100 - subject.coursework_max})</th>
                <th>المجموع</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {students.map((st, i) => {
            const p = parsed[st.id]
            const r = p?.result
            const fail = r?.finalTotal != null && r.finalPassed === false
            const showR2 = !!r && r.needsR2 && r.r2Complete
            return (
              <tr key={st.id}>
                <td>{i + 1}</td>
                <td className="name">
                  {st.full_name}
                  {st.status !== 'active' && ` (${st.status === 'withdrawn' ? 'منسحب' : 'مؤجل'})`}
                </td>
                {cw.map((c) => (
                  <td key={c.key}>{fmtNum(p?.values[c.key] ?? null)}</td>
                ))}
                {cwSum && <td>{fmtNum(r?.coursework ?? null)}</td>}
                {fin.map((c) => (
                  <td key={c.key}>{fmtNum(p?.values[c.key] ?? null)}</td>
                ))}
                {finSum && <td>{fmtNum(r?.finalSum ?? null)}</td>}
                {hasR2 && (
                  <>
                    <td>{showR2 ? (r!.r2Special ? SPECIAL_LABEL[r!.r2Special] : fmtNum(r!.r2FinalSum)) : ''}</td>
                    <td>{showR2 ? fmtNum(r!.r2Total) : ''}</td>
                  </>
                )}
                <td className={fail ? 'print-fail' : ''} style={{ fontWeight: 700 }}>
                  {r?.finalSpecial ? SPECIAL_LABEL[r.finalSpecial] : fmtNum(r?.finalTotal ?? null)}
                </td>
                <td className={fail ? 'print-fail' : ''}>{r?.finalLabel}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <table className="print-table" style={{ marginTop: '8px', breakInside: 'avoid' }}>
        <tbody>
          <tr>
            <th>عدد الطلبة</th>
            <td>{stats.count}</td>
            <th>الناجحون</th>
            <td>{stats.pass}</td>
            <th>الراسبون</th>
            <td>{stats.fail}</td>
            <th>حالات خاصة</th>
            <td>{stats.special}</td>
          </tr>
          <tr>
            <th>أعلى درجة</th>
            <td>{fmtNum(stats.max)}</td>
            <th>أدنى درجة</th>
            <td>{fmtNum(stats.min)}</td>
            <th>المعدل</th>
            <td>{fmtNum(stats.avg)}</td>
            <th>نسبة النجاح</th>
            <td>{fmtPct(stats.passRate)}</td>
          </tr>
        </tbody>
      </table>
      <PrintSignatures labels={['توقيع التدريسي', 'رئيس القسم', 'رئيس اللجنة الامتحانية']} />
    </div>
  )
}
