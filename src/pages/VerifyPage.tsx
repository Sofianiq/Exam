import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, BadgeCheck, LogIn, ShieldX } from 'lucide-react'
import { buildVerifiedReport } from '../app/results'
import { formatCode } from '../components/ResultSlip'
import { Spinner, cx } from '../components/ui'
import { backend } from '../data'
import type { ResultStatus, RowResult } from '../lib/calc'
import { fmtDateTime, yearLabel } from '../lib/format'
import { SHIFT_LONG, SPECIAL_LABEL, STUDENT_STATUS_LABEL, TERM_LABEL, stageLabel } from '../lib/labels'

const STATUS_TEXT: Record<ResultStatus, string> = {
  pass: 'ناجح',
  pass_r2: 'ناجح (الدور الثاني)',
  carry: 'مكمل',
  fail: 'راسب',
  incomplete: 'غير مكتملة',
  none: 'لم تُرصد بعد',
}
const STATUS_CLASS: Record<ResultStatus, string> = {
  pass: 'bg-[#eef3fb] text-[#14284b] border-[#9fb3d6]',
  pass_r2: 'bg-[#eef3fb] text-[#14284b] border-[#9fb3d6]',
  carry: 'bg-[#fdf5e6] text-[#8a5a00] border-[#e3c486]',
  fail: 'bg-[#fbeceb] text-[#a8201a] border-[#e3a5a1]',
  incomplete: 'bg-[#f3f5f8] text-[#5f697b] border-[#d3d9e2]',
  none: 'bg-[#f3f5f8] text-[#5f697b] border-[#d3d9e2]',
}

/** صفحة عامة يفتحها رمز QR المطبوع على النتيجة: تعرض النتيجة المعتمدة من قاعدة البيانات مباشرة */
export function VerifyPage({ code }: { code: string }) {
  const q = useQuery({ queryKey: ['verify', code], queryFn: () => backend.verifyResult(code), retry: 0, staleTime: 60_000 })
  const v = q.data
  const report = v ? buildVerifiedReport(v) : null
  const pending = v ? v.subjects.filter((x) => !x.approved).length : 0

  return (
    <div className="min-h-dvh bg-[#f3f5f8] text-[#1a2232]">
      <header className="bg-[#14284b] text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-5">
          <img src="./logo.png" alt="شعار الجامعة" className="size-16 shrink-0 rounded-full bg-white p-0.5" />
          <div className="min-w-0">
            <div className="text-lg font-bold">{v?.settings.university_name ?? 'جامعة السراج الأهلية'}</div>
            <div className="text-sm text-white/75">{v?.settings.college_name ?? 'كلية التقنيات الصحية والطبية'} — اللجنة الامتحانية</div>
          </div>
        </div>
        <div className="h-1 bg-[#b8913a]" />
      </header>

      <main className="mx-auto max-w-3xl px-4 py-7">
        <h1 className="mb-5 text-center text-xl font-bold text-[#14284b]">التحقق من نتيجة الامتحانات النهائية</h1>

        {q.isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-7 text-[#14284b]" />
          </div>
        ) : q.isError ? (
          <Notice tone="warn" icon={<AlertTriangle className="size-6" />} title="تعذر الاتصال بالخادم">
            يرجى المحاولة مرة أخرى بعد قليل.
          </Notice>
        ) : !v || !report ? (
          <Notice tone="bad" icon={<ShieldX className="size-6" />} title="رمز التحقق غير صحيح">
            لم يُعثر على نتيجة بالرمز <b dir="ltr">{formatCode(code.replace(/[^0-9A-Za-z]/g, '').toUpperCase())}</b>. تأكد من مسح الرمز المطبوع على النتيجة الأصلية، وأي
            اختلاف بين الورقة وهذه الصفحة يعني أن الورقة غير صادرة من النظام.
          </Notice>
        ) : (
          <div className="space-y-5">
            <Notice tone={pending ? 'warn' : 'ok'} icon={pending ? <AlertTriangle className="size-6" /> : <BadgeCheck className="size-6" />} title={pending ? 'نتيجة موثقة جزئياً' : 'النتيجة موثقة'}>
              {pending
                ? `البيانات أدناه صادرة من نظام اللجنة الامتحانية، وما زالت ${pending} ${pending === 1 ? 'مادة' : 'مواد'} بانتظار الاعتماد.`
                : 'البيانات أدناه صادرة مباشرة من نظام اللجنة الامتحانية وهي المعتمدة رسمياً. قارنها بالورقة المطبوعة.'}
            </Notice>

            <section className="rounded-xl border border-[#d3d9e2] bg-white p-5 shadow-sm">
              <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
                <Info label="اسم الطالب" value={v.student.full_name} wide />
                <Info label="القسم" value={v.department?.name ?? '—'} />
                <Info label="المرحلة" value={stageLabel(v.student.stage).replace('المرحلة ', '')} />
                <Info label="الدراسة" value={SHIFT_LONG[v.student.shift].replace('الدراسة ', '')} />
                <Info label="العام الدراسي" value={yearLabel(v.year ?? undefined) || '—'} />
                {v.student.status !== 'active' && <Info label="حالة القيد" value={STUDENT_STATUS_LABEL[v.student.status]} />}
              </dl>
            </section>

            {report.sections.map((sec) => (
              <section key={sec.term} className="overflow-hidden rounded-xl border border-[#d3d9e2] bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-[#14284b] px-4 py-2.5 text-white">
                  <h2 className="font-semibold">{TERM_LABEL[sec.term]}</h2>
                  <span className="text-sm text-white/80">
                    التقدير العام: <b className="text-white">{sec.summary.averageLabel ?? '—'}</b>
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[#f3f5f8] text-xs text-[#5f697b]">
                        <th className="px-4 py-2 text-start font-medium">المادة الدراسية</th>
                        <th className="px-3 py-2 font-medium">الوحدات</th>
                        <th className="px-3 py-2 font-medium">التقدير</th>
                        <th className="px-3 py-2 font-medium">النتيجة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sec.items.map(({ subject, result }) => (
                        <tr key={subject.name} className="border-t border-[#e8ecf2]">
                          <td className="px-4 py-2">{subject.name}</td>
                          <td className="px-3 py-2 text-center tabular-nums">{subject.units ?? '—'}</td>
                          <td className="px-3 py-2 text-center font-semibold text-[#14284b]">
                            {!subject.approved ? '—' : result.finalSpecial ? SPECIAL_LABEL[result.finalSpecial] : (result.finalLabel ?? '—')}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <SubjectState approved={subject.approved} r={result} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <StatusBar status={sec.summary.status} failed={failedOf(sec.summary)} />
              </section>
            ))}

            {report.sections.length > 1 && (
              <section className="rounded-xl border border-[#d3d9e2] bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold text-[#14284b]">النتيجة السنوية</h2>
                  <span className="text-sm">
                    التقدير العام السنوي: <b className="text-[#14284b]">{report.annual.averageLabel ?? '—'}</b>
                  </span>
                </div>
                <div className="mt-3">
                  <StatusBar status={report.annual.status} failed={failedOf(report.annual)} boxed />
                </div>
              </section>
            )}

            <p className="text-center text-xs text-[#5f697b]">
              رمز التحقق: <b dir="ltr">{formatCode(v.code)}</b> — وقت التحقق: {fmtDateTime(new Date())}
            </p>
          </div>
        )}

        <div className="mt-8 text-center">
          <a href="#/" className="inline-flex items-center gap-2 rounded-lg border border-[#d3d9e2] bg-white px-4 py-2 text-sm font-medium text-[#14284b] hover:bg-[#eef3fb]">
            <LogIn className="size-4" />
            الدخول إلى نظام اللجنة الامتحانية
          </a>
        </div>
      </main>
      <footer className="pb-8 text-center text-xs leading-relaxed text-[#8a93a3]">
        نظام إدارة اللجنة الامتحانية — إعداد وتطوير: م.م سفيان محمد
      </footer>
    </div>
  )
}

function failedOf(s: { status: ResultStatus; finalFailed: string[]; r1Failed: string[]; pendingR2: string[] }) {
  if (s.status === 'fail') return s.finalFailed.length ? s.finalFailed : s.r1Failed
  if (s.status === 'carry') return s.pendingR2.length ? s.pendingR2 : s.r1Failed
  return []
}

function SubjectState({ approved, r }: { approved: boolean; r: RowResult }) {
  if (!approved) return <span className="text-xs text-[#8a93a3]">بانتظار الاعتماد</span>
  if (r.finalPassed === true) return <span className="font-medium text-[#1f5f3f]">{r.finalRound === 2 ? 'ناجح (د2)' : 'ناجح'}</span>
  if (r.finalPassed === false) return <span className="font-medium text-[#a8201a]">{r.needsR2 && !r.r2Complete ? 'غير مجتاز' : 'راسب'}</span>
  return <span className="text-[#8a93a3]">—</span>
}

function StatusBar({ status, failed, boxed }: { status: ResultStatus; failed: string[]; boxed?: boolean }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-4 gap-y-1 border px-4 py-2.5 text-sm', STATUS_CLASS[status], boxed ? 'rounded-lg' : 'border-x-0 border-b-0')}>
      <span>
        حالة الطالب: <b>{STATUS_TEXT[status]}</b>
      </span>
      {failed.length > 0 && (
        <span>
          {status === 'fail' ? 'المواد الراسب فيها' : 'المواد المكمل فيها'}: {failed.join('، ')}
        </span>
      )}
    </div>
  )
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cx('flex gap-2', wide && 'sm:col-span-2')}>
      <dt className="text-[#5f697b]">{label}:</dt>
      <dd className={cx('font-semibold', wide && 'text-base text-[#14284b]')}>{value}</dd>
    </div>
  )
}

function Notice({ tone, icon, title, children }: { tone: 'ok' | 'warn' | 'bad'; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  const cls =
    tone === 'ok' ? 'border-[#9fc7b0] bg-[#edf7f1] text-[#1f5f3f]' : tone === 'warn' ? 'border-[#e3c486] bg-[#fdf5e6] text-[#8a5a00]' : 'border-[#e3a5a1] bg-[#fbeceb] text-[#a8201a]'
  return (
    <div className={cx('flex items-start gap-3 rounded-xl border px-4 py-3.5', cls)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <div className="font-bold">{title}</div>
        <div className="mt-0.5 text-sm leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
