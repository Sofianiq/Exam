import type { ReportSection, StudentReport } from '../app/results'
import type { ResultStatus, StudentSummary } from '../lib/calc'
import { fmtDate } from '../lib/format'
import { SHIFT_LONG, SPECIAL_LABEL, TERM_LABEL, stageShort } from '../lib/labels'
import type { Department, Settings, Student, Term } from '../lib/types'

/** ألوان ثابتة (ورقة رسمية) لا تتأثر بالوضع الليلي */
const C = {
  green: '#0b5a3a',
  greenDark: '#083d28',
  gold: '#b7882a',
  goldSoft: '#f7eedb',
  ink: '#1b241f',
  muted: '#5d685f',
  line: '#d9d3c2',
  paper: '#fffdf8',
}

const LABEL_COLOR: Record<string, string> = {
  امتياز: '#0b5a3a',
  'جيد جداً': '#1f7a4f',
  جيد: '#2f6fae',
  متوسط: '#6b5bb5',
  مقبول: '#a0670c',
  ضعيف: '#b42318',
  راسب: '#b42318',
}

const STATUS_STYLE: Record<ResultStatus, { bg: string; fg: string }> = {
  pass: { bg: '#e3f4ea', fg: '#0b5a3a' },
  pass_r2: { bg: '#e3f4ea', fg: '#0b5a3a' },
  carry: { bg: '#fdf1df', fg: '#9a5a05' },
  fail: { bg: '#fdecea', fg: '#b42318' },
  incomplete: { bg: '#eeeeea', fg: '#5d685f' },
  none: { bg: '#eeeeea', fg: '#5d685f' },
}

export type ResultScope = Term | 0

export function scopeLabel(scope: ResultScope) {
  return scope === 0 ? 'الفصلان الأول والثاني' : TERM_LABEL[scope]
}

/** نتيجة طالب للطباعة (صفحة A4) — تعرض التقديرات فقط */
export function ResultCard({
  student,
  dept,
  yearLabel,
  settings,
  report,
  scope,
}: {
  student: Student
  dept: Department | undefined
  yearLabel: string
  settings: Settings
  report: StudentReport
  scope: ResultScope
}) {
  const sections = report.sections.filter((s) => scope === 0 || s.term === scope)
  const final: StudentSummary | undefined = scope === 0 ? report.annual : sections[0]?.summary
  const st = STATUS_STYLE[final?.status ?? 'none']

  return (
    <div className="result-card">
      <div className="result-frame">
        <img src="./logo.png" alt="" className="result-watermark" />

        {/* الترويسة */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ fontSize: '10pt', lineHeight: 1.7, color: C.ink }}>
            <div>وزارة التعليم العالي والبحث العلمي</div>
            <div style={{ fontWeight: 700 }}>{settings.university_name}</div>
            <div>{settings.college_name}</div>
          </div>
          <img src="./logo.png" alt="شعار الكلية" style={{ width: '84px', height: '84px', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.15))' }} />
          <div style={{ fontSize: '10pt', lineHeight: 1.7, color: C.ink, textAlign: 'left' }}>
            <div>اللجنة الامتحانية</div>
            <div style={{ fontWeight: 700 }}>قسم {dept?.name}</div>
            <div>العام الدراسي {yearLabel}</div>
          </div>
        </div>

        <div style={{ textAlign: 'center', margin: '14px 0 10px' }}>
          <div style={{ display: 'inline-block', padding: '6px 34px', borderRadius: '999px', background: C.green, color: '#fff', fontSize: '17pt', fontWeight: 700, letterSpacing: '.5px' }}>
            نتيجة الطالب
          </div>
          <div style={{ marginTop: '6px', fontSize: '11pt', color: C.gold, fontWeight: 700 }}>{scopeLabel(scope)}</div>
        </div>

        {/* معلومات الطالب */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 18px', padding: '10px 14px', border: `1px solid ${C.line}`, borderRadius: '10px', background: C.goldSoft, fontSize: '11pt' }}>
          <Info label="اسم الطالب" value={student.full_name} wide />
          <Info label="القسم" value={dept?.name ?? ''} />
          <Info label="المرحلة" value={stageShort(student.stage)} />
          <Info label="نوع الدراسة" value={SHIFT_LONG[student.shift]} />
          <Info label="العام الدراسي" value={yearLabel} />
        </div>

        {/* المواد */}
        <div style={{ display: 'grid', gridTemplateColumns: sections.length > 1 ? '1fr 1fr' : '1fr', gap: '10px', marginTop: '14px', alignItems: 'start' }}>
          {sections.map((sec) => (
            <SectionTable key={sec.term} section={sec} showTitle={scope === 0} compact={sections.length > 1} />
          ))}
          {sections.length === 0 && <div style={{ textAlign: 'center', color: C.muted, padding: '20px' }}>لا توجد مواد مسجلة لهذا الفصل</div>}
        </div>

        {/* النتيجة */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '16px', alignItems: 'stretch' }}>
          <div style={{ flex: 1, border: `1px solid ${C.line}`, borderRadius: '10px', padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: '9.5pt', color: C.muted }}>{scope === 0 ? 'التقدير العام السنوي' : 'التقدير العام للفصل'}</div>
            <div style={{ fontSize: '16pt', fontWeight: 700, color: LABEL_COLOR[final?.averageLabel ?? ''] ?? C.ink }}>{final?.averageLabel ?? '—'}</div>
          </div>
          <div style={{ flex: 2, borderRadius: '10px', padding: '10px 14px', textAlign: 'center', background: st.bg, border: `1.5px solid ${st.fg}` }}>
            <div style={{ fontSize: '9.5pt', color: C.muted }}>النتيجة</div>
            <div style={{ fontSize: '17pt', fontWeight: 800, color: st.fg }}>{student.status !== 'active' ? (student.status === 'withdrawn' ? 'منسحب' : 'مؤجل') : final?.statusText || '—'}</div>
          </div>
        </div>

        {/* التواقيع */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 'auto', paddingTop: '22px', fontSize: '10.5pt' }}>
          <div style={{ textAlign: 'center', minWidth: '170px' }}>
            <div style={{ fontWeight: 700 }}>رئيس القسم</div>
            <div style={{ marginTop: '4px', minHeight: '18px' }}>{dept?.head_name ?? ''}</div>
            <div style={{ marginTop: '26px', borderTop: `1px dotted ${C.muted}`, paddingTop: '2px', fontSize: '8.5pt', color: C.muted }}>التوقيع</div>
          </div>
          <div style={{ textAlign: 'center', fontSize: '8.5pt', color: C.muted }}>
            <div>تاريخ الإصدار: {fmtDate(new Date())}</div>
            <div style={{ marginTop: '2px' }}>صادرة من نظام اللجنة الامتحانية</div>
          </div>
          <div style={{ width: '96px', height: '96px', borderRadius: '50%', border: `1.5px dashed ${C.gold}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gold, fontSize: '9pt' }}>
            ختم الكلية
          </div>
        </div>
      </div>
    </div>
  )
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined, display: 'flex', gap: '8px' }}>
      <span style={{ color: C.muted, minWidth: '86px' }}>{label}:</span>
      <b style={{ color: C.ink }}>{value}</b>
    </div>
  )
}

function SectionTable({ section, showTitle, compact }: { section: ReportSection; showTitle: boolean; compact?: boolean }) {
  const cell = { padding: compact ? '4px 5px' : '5px 8px', borderBottom: `1px solid ${C.line}` }
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: '10px', overflow: 'hidden', breakInside: 'avoid' }}>
      {showTitle && (
        <div style={{ background: C.goldSoft, padding: '5px 12px', fontWeight: 700, color: C.greenDark, fontSize: '10.5pt', display: 'flex', justifyContent: 'space-between' }}>
          <span>{TERM_LABEL[section.term]}</span>
          <span style={{ fontWeight: 400, color: C.muted }}>
            التقدير العام: <b style={{ color: LABEL_COLOR[section.summary.averageLabel ?? ''] ?? C.ink }}>{section.summary.averageLabel ?? '—'}</b>
          </span>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: compact ? '9pt' : '10.5pt' }}>
        <thead>
          <tr style={{ background: C.green, color: '#fff' }}>
            <th style={{ ...cell, width: '7%', textAlign: 'center' }}>ت</th>
            <th style={{ ...cell, textAlign: 'right' }}>المادة الدراسية</th>
            <th style={{ ...cell, width: compact ? '15%' : '13%', textAlign: 'center' }}>{compact ? 'وحدات' : 'الوحدات'}</th>
            <th style={{ ...cell, width: compact ? '30%' : '26%', textAlign: 'center' }}>التقدير</th>
          </tr>
        </thead>
        <tbody>
          {section.items.map((it, i) => {
            const r = it.result
            const label = r.finalSpecial ? SPECIAL_LABEL[r.finalSpecial] : (r.finalLabel ?? '—')
            return (
              <tr key={it.subject.id} style={{ background: i % 2 ? '#faf8f2' : '#fff' }}>
                <td style={{ ...cell, textAlign: 'center', color: C.muted }}>{i + 1}</td>
                <td style={{ ...cell, color: C.ink }}>{it.subject.name}</td>
                <td style={{ ...cell, textAlign: 'center', color: C.muted }}>{it.subject.units ?? '—'}</td>
                <td style={{ ...cell, textAlign: 'center', fontWeight: 700, color: LABEL_COLOR[label] ?? (r.finalSpecial ? '#9a5a05' : C.ink) }}>
                  {label}
                  {r.finalRound === 2 && <span style={{ fontWeight: 400, fontSize: '8pt', color: C.gold }}>{compact ? ' (د2)' : ' (دور ثانٍ)'}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
