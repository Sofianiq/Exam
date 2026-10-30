import type { ReactNode } from 'react'
import { useSession } from '../app/session'
import { fmtDate, yearLabel } from '../lib/format'
import { SHIFT_LONG, TERM_LABEL, stageShort } from '../lib/labels'
import type { ClassKey, Term } from '../lib/types'

/** ترويسة رسمية للطباعة (PDF) */
export function PrintHeader({
  classKey,
  title,
  term,
  extra,
}: {
  classKey?: ClassKey
  title: string
  term?: Term | 0
  extra?: ReactNode
}) {
  const s = useSession()
  const dept = classKey ? s.deptById(classKey.department_id) : undefined
  const year = classKey ? s.years.find((y) => y.id === classKey.year_id) : s.year
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #0b5a3a', paddingBottom: '6px' }}>
        <div style={{ fontSize: '11pt', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700 }}>{s.settings.university_name}</div>
          <div>{s.settings.college_name}</div>
          {dept && <div>قسم {dept.name}</div>}
        </div>
        <img src="./logo.png" alt="" style={{ width: '64px', height: '64px' }} />
        <div style={{ fontSize: '10pt', lineHeight: 1.6, textAlign: 'left' }}>
          <div>اللجنة الامتحانية</div>
          <div>العام الدراسي: {yearLabel(year?.label)}</div>
          <div>تاريخ الطباعة: {fmtDate(new Date())}</div>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: '14pt', fontWeight: 700, margin: '8px 0 4px' }}>{title}</div>
      {classKey && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '18px', fontSize: '10.5pt', flexWrap: 'wrap' }}>
          <span>المرحلة: {stageShort(classKey.stage)}</span>
          <span>نوع الدراسة: {SHIFT_LONG[classKey.shift]}</span>
          {term !== undefined && <span>{term === 0 ? 'النتيجة السنوية' : TERM_LABEL[term]}</span>}
        </div>
      )}
      {extra && <div style={{ fontSize: '10.5pt', marginTop: '4px' }}>{extra}</div>}
    </div>
  )
}

export function PrintSignatures({ labels }: { labels: string[] }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '28px', fontSize: '11pt', breakInside: 'avoid' }}>
      {labels.map((l) => (
        <div key={l} style={{ textAlign: 'center', minWidth: '130px' }}>
          <div style={{ fontWeight: 700 }}>{l}</div>
          <div style={{ marginTop: '34px', borderTop: '1px dotted #555', paddingTop: '2px', fontSize: '9pt', color: '#555' }}>التوقيع</div>
        </div>
      ))}
    </div>
  )
}
