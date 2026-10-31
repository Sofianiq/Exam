import qrcode from 'qrcode-generator'
import { useMemo } from 'react'
import type { ReportSection, StudentReport } from '../app/results'
import type { ResultStatus, StudentSummary } from '../lib/calc'
import { fmtDate } from '../lib/format'
import { SHIFT_LONG, SPECIAL_LABEL, TERM_LABEL, stageShort } from '../lib/labels'
import type { Department, Settings, Student, Term } from '../lib/types'

export type ResultScope = Term | 0

export function scopeLabel(scope: ResultScope) {
  return scope === 0 ? 'الفصلان الأول والثاني' : TERM_LABEL[scope]
}

/** رمز التحقق بصيغة مقروءة: XXXX-XXXX-XXXX-XXXX */
export const formatCode = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-')

/** رابط صفحة التحقق العامة من النتيجة (يُشفَّر في رمز QR) */
export function verifyUrl(code: string) {
  const base = typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}`
  return `${base}#/verify/${code}`
}

type Tone = 'ok' | 'carry' | 'fail' | 'muted'

export interface SlipRow {
  name: string
  units: number | null
  label: string
  note: string
  tone: Tone
}

export interface SlipSection {
  term: Term
  rows: SlipRow[]
  label: string | null
  units: number
}

export interface SlipModel {
  sections: SlipSection[]
  overallLabel: string | null
  units: number
  status: ResultStatus | 'withdrawn' | 'postponed'
  statusText: string
  failedTitle: string
  failed: string[]
  round: string
}

const STATUS_TEXT: Record<ResultStatus, string> = {
  pass: 'ناجح',
  pass_r2: 'ناجح (الدور الثاني)',
  carry: 'مكمل',
  fail: 'راسب',
  incomplete: 'النتيجة غير مكتملة',
  none: 'لم تُرصد النتيجة بعد',
}

/** يحوّل تقرير الطالب إلى محتوى ورقة النتيجة (التقديرات فقط، دون الدرجات) — دالة نقية قابلة للاختبار */
export function slipModel(student: Pick<Student, 'status'>, report: StudentReport, scope: ResultScope): SlipModel {
  const secs = report.sections.filter((s) => scope === 0 || s.term === scope)
  const summary: StudentSummary | undefined = scope === 0 ? report.annual : secs[0]?.summary
  const status = summary?.status ?? 'none'
  const rowsOf = (sec: ReportSection): SlipRow[] =>
    sec.items.map(({ subject, result: r }) => {
      let note = '—'
      let tone: Tone = 'muted'
      if (r.finalPassed === true) {
        note = r.finalRound === 2 ? 'ناجح (د2)' : 'ناجح'
        tone = 'ok'
      } else if (r.finalPassed === false) {
        const pending = r.needsR2 && !r.r2Complete
        note = pending && status !== 'fail' ? 'مكمل' : 'راسب'
        tone = note === 'مكمل' ? 'carry' : 'fail'
      }
      return {
        name: subject.name,
        units: subject.units,
        label: r.finalSpecial ? SPECIAL_LABEL[r.finalSpecial] : (r.finalLabel ?? '—'),
        note,
        tone,
      }
    })
  const sections = secs.map((sec) => ({
    term: sec.term,
    rows: rowsOf(sec),
    label: sec.summary.averageLabel,
    units: sec.items.reduce((a, x) => a + (x.subject.units ?? 0), 0),
  }))
  const failed = !summary ? [] : status === 'fail' ? (summary.finalFailed.length ? summary.finalFailed : summary.r1Failed) : status === 'carry' ? summary.pendingR2.length ? summary.pendingR2 : summary.r1Failed : []
  const anyR2 = secs.some((sec) => sec.items.some((x) => x.result.finalRound === 2))
  const inactive = student.status === 'withdrawn' || student.status === 'postponed'
  return {
    sections,
    overallLabel: summary?.averageLabel ?? null,
    units: sections.reduce((a, s) => a + s.units, 0),
    status: inactive ? (student.status as 'withdrawn' | 'postponed') : status,
    statusText: inactive ? (student.status === 'withdrawn' ? 'منسحب' : 'مؤجل') : STATUS_TEXT[status],
    failedTitle: status === 'fail' ? 'المواد الراسب فيها' : 'المواد المكمل فيها',
    failed: inactive ? [] : failed,
    round: anyR2 ? 'الأول والثاني' : 'الأول',
  }
}

/** رمز QR بصيغة SVG (بالكحلي على أبيض) */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const count = qr.getModuleCount()
    let path = ''
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c},${r}h1v1h-1z`
    return { n: count, d: path }
  }, [value])
  return (
    <svg className={className} viewBox={`-2 -2 ${n + 4} ${n + 4}`} shapeRendering="crispEdges" role="img" aria-label="رمز التحقق من النتيجة">
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#14284b" />
    </svg>
  )
}

export interface SlipProps {
  student: Student
  dept: Department | undefined
  yearLabel: string
  settings: Settings
  report: StudentReport
  scope: ResultScope
  /** وسم النسخة (نسخة الطالب / نسخة القسم) */
  copy?: string
}

/** نتيجة الامتحانات النهائية لطالب واحد — نصف ورقة A4 أفقية */
export function ResultSlip({ student, dept, yearLabel, settings, report, scope, copy }: SlipProps) {
  const m = slipModel(student, report, scope)
  const rowsCount = m.sections.reduce((a, s) => a + s.rows.length + (m.sections.length > 1 ? 1 : 0), 0)
  // كثافة الجدول حسب عدد المواد لتملأ النتيجة نصف الورقة دون ازدحام أو فراغ كبير
  const density = rowsCount > 21 ? 'dense' : rowsCount > 17 ? 'normal' : rowsCount > 10 ? 'roomy' : 'spacious'
  const statusClass = m.status === 'pass' || m.status === 'pass_r2' ? 'is-pass' : m.status === 'carry' ? 'is-carry' : m.status === 'fail' ? 'is-fail' : 'is-muted'
  let n = 0
  return (
    <article className={`slip slip-${density}`} data-result-slip>
      <div className="slip-frame">
        <img src="./logo.png" alt="" className="slip-watermark" />
        <header className="slip-head">
          <div className="slip-head-ar">
            <div>جمهورية العراق</div>
            <div>وزارة التعليم العالي والبحث العلمي</div>
            <div className="b">{settings.university_name}</div>
            <div>{settings.college_name}</div>
          </div>
          <img src="./logo.png" alt="شعار الجامعة" className="slip-logo" />
          <div className="slip-head-en" dir="ltr">
            <div>Republic of Iraq</div>
            <div>Ministry of Higher Education &amp; Scientific Research</div>
            <div className="b">Al-Siraj Private University</div>
            <div>College of Health &amp; Medical Techniques</div>
          </div>
        </header>

        <div className="slip-title">
          <div className="slip-title-ar">نتيجة الامتحانات النهائية</div>
          <div className="slip-title-en" dir="ltr">
            FINAL EXAMINATION RESULTS
          </div>
        </div>

        <dl className="slip-info">
          <div className="wide">
            <dt>اسم الطالب</dt>
            <dd className="name">{student.full_name}</dd>
          </div>
          <div>
            <dt>القسم</dt>
            <dd>{dept?.name}</dd>
          </div>
          <div>
            <dt>المرحلة</dt>
            <dd>{stageShort(student.stage)}</dd>
          </div>
          <div>
            <dt>الدراسة</dt>
            <dd>{SHIFT_LONG[student.shift].replace('الدراسة ', '')}</dd>
          </div>
          <div>
            <dt>العام الدراسي</dt>
            <dd>{yearLabel}</dd>
          </div>
          <div>
            <dt>الفصل الدراسي</dt>
            <dd>{scope === 0 ? 'الأول والثاني' : TERM_LABEL[scope].replace('الفصل ', '')}</dd>
          </div>
          <div>
            <dt>الدور الامتحاني</dt>
            <dd>{m.round}</dd>
          </div>
        </dl>

        <table className="slip-table">
          <thead>
            <tr>
              <th className="c-n">ت</th>
              <th className="c-name">المادة الدراسية</th>
              <th className="c-u">الوحدات</th>
              <th className="c-l">التقدير</th>
              <th className="c-s">النتيجة</th>
            </tr>
          </thead>
          <tbody>
            {m.sections.map((sec) => [
              m.sections.length > 1 && (
                <tr key={`h${sec.term}`} className="slip-group">
                  <td colSpan={5}>
                    <span>{TERM_LABEL[sec.term]}</span>
                    <span className="meta">
                      التقدير العام: <b>{sec.label ?? '—'}</b> · الوحدات: <b>{sec.units}</b>
                    </span>
                  </td>
                </tr>
              ),
              ...sec.rows.map((r) => (
                <tr key={`${sec.term}-${r.name}`}>
                  <td className="c-n">{++n}</td>
                  <td className={`c-name${r.name.length > 42 ? ' long' : ''}`}>{r.name}</td>
                  <td className="c-u">{r.units ?? '—'}</td>
                  <td className={`c-l tone-${r.tone === 'fail' ? 'fail' : 'label'}`}>{r.label}</td>
                  <td className={`c-s tone-${r.tone}`}>{r.note}</td>
                </tr>
              )),
            ])}
            {m.sections.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  لا توجد مواد مسجلة
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="slip-summary">
          <div>
            <span className="k">{scope === 0 ? 'التقدير العام السنوي' : 'التقدير العام'}</span>
            <span className="v">{m.overallLabel ?? '—'}</span>
          </div>
          <div>
            <span className="k">مجموع الوحدات</span>
            <span className="v num">{m.units}</span>
          </div>
          <div className={`status ${statusClass}`}>
            <span className="k">حالة الطالب</span>
            <span className="v">{m.statusText}</span>
          </div>
        </div>
        {m.failed.length > 0 && (
          <div className={`slip-failed ${m.status === 'fail' ? 'is-fail' : 'is-carry'}`}>
            <b>{m.failedTitle}:</b> {m.failed.join('، ')}
          </div>
        )}

        {rowsCount <= 12 && (
          <div className="slip-notes">
            <span>ملاحظات:</span>
          </div>
        )}

        <footer className="slip-foot">
          <div className="slip-stamp">
            <span>الختم الرسمي</span>
          </div>
          <div className="slip-signs">
            <Sign title="رئيس القسم" name={dept?.head_name} />
            <Sign title="رئيس اللجنة الامتحانية" name={settings.committee_head_name} />
            <Sign title="عميد الكلية" name={settings.dean_name} />
          </div>
          <div className="slip-qr">
            <QrCode value={verifyUrl(student.verify_code)} />
            <span>امسح للتحقق</span>
          </div>
        </footer>
        <div className="slip-meta">
          <span>
            رمز التحقق: <b dir="ltr">{formatCode(student.verify_code)}</b>
          </span>
          <span>تاريخ الإصدار: {fmtDate(new Date())}</span>
          {copy && <span className="copy">{copy}</span>}
        </div>
      </div>
    </article>
  )
}

function Sign({ title, name }: { title: string; name: string | null | undefined }) {
  return (
    <div className="slip-sign">
      <div className="t">{title}</div>
      <div className="line" />
      <div className="n">{name || ' '}</div>
    </div>
  )
}

/** صفحات A4 أفقية، في كل صفحة نتيجتان متجاورتان مع خط قص بينهما */
export function ResultSheets({ items, className }: { items: SlipProps[]; className?: string }) {
  const pages: SlipProps[][] = []
  for (let i = 0; i < items.length; i += 2) pages.push(items.slice(i, i + 2))
  return (
    <div className={className}>
      {pages.map((pg, i) => (
        <section key={i} className="slip-sheet">
          {pg.map((p, j) => (
            <ResultSlip key={`${p.student.id}-${j}`} {...p} />
          ))}
          {pg.length === 1 && <div className="slip slip-empty" />}
        </section>
      ))}
    </div>
  )
}
