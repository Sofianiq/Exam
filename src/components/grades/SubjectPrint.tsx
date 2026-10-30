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
  passMark,
}: {
  subject: Subject
  students: Student[]
  parsed: Record<string, ParsedRow>
  stats: SheetStats
  teachers: string
  passMark: number
}) {
  const comps = componentsOf(subject)
  const cw = comps.filter((c) => c.group === 'coursework')
  const fin = comps.filter((c) => c.group === 'final')
  const cwSum = cw.length > 1
  const finSum = fin.length > 1
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
          </tr>
        </thead>
        <tbody>
          {students.map((st, i) => {
            const p = parsed[st.id]
            const r = p?.result
            const fail = r?.total != null && r.total < passMark
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
                <td className={fail ? 'print-fail' : ''} style={{ fontWeight: 700 }}>
                  {r?.special ? SPECIAL_LABEL[r.special] : fmtNum(r?.total ?? null)}
                </td>
                <td className={fail ? 'print-fail' : ''}>{r?.label}</td>
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
