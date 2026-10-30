import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronDown, FileSpreadsheet, History, Search } from 'lucide-react'
import { useState } from 'react'
import { useSession } from '../app/session'
import { useToast } from '../components/feedback'
import { Badge, Button, Card, EmptyState, LoadingBlock, PageHeader, Select } from '../components/ui'
import { backend } from '../data'
import { fmtDateTime, fmtNum } from '../lib/format'
import { ACTION_LABEL, SPECIAL_LABEL, STATUS_LABEL } from '../lib/labels'
import { canSeeAudit } from '../lib/perm'
import type { AuditEntry, SpecialCode, SubjectStatus } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

const CATEGORIES: { value: string; label: string }[] = [
  { value: '', label: 'كل العمليات' },
  { value: 'grade.', label: 'الدرجات' },
  { value: 'subject.', label: 'المواد وحالة القوائم' },
  { value: 'entry.', label: 'فتح وغلق الإدخال' },
  { value: 'student.', label: 'الطلبة' },
  { value: 'user.', label: 'الحسابات' },
  { value: 'auth.', label: 'الدخول والخروج' },
  { value: 'settings.', label: 'الإعدادات' },
  { value: 'report.', label: 'التقارير والتصدير' },
]

const PAGE = 50
const GRADE_FIELDS: Record<string, string> = {
  cw_theory: 'السعي النظري',
  cw_practical: 'السعي العملي',
  final_practical: 'العملي النهائي',
  final_theory: 'النظري النهائي',
  special: 'الحالة',
  note: 'ملاحظة',
}

const tone = (a: string) =>
  a.startsWith('grade.update') || a.startsWith('subject.returned') || a === 'entry.close'
    ? 'warning'
    : a.startsWith('subject.approved') || a === 'entry.open'
      ? 'success'
      : a.endsWith('delete')
        ? 'danger'
        : a.startsWith('auth.')
          ? 'neutral'
          : 'primary'

export function AuditPage() {
  const s = useSession()
  const toast = useToast()
  const isHead = s.profile.role === 'head'
  const [cat, setCat] = useState('')
  const [dept, setDept] = useState(isHead ? (s.profile.department_id ?? '') : '')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  const q = useInfiniteQuery({
    queryKey: ['audit', 'list', cat, dept, term],
    queryFn: ({ pageParam }) => backend.listAudit({ action_prefix: cat || null, department_id: dept || null, search: term || null, limit: PAGE, before_id: pageParam }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].id : undefined),
    enabled: canSeeAudit(s.profile),
  })
  if (!canSeeAudit(s.profile)) return <NotFoundPage />
  const rows = q.data?.pages.flat() ?? []

  const exportExcel = async () => {
    try {
      const { exportTableXlsx } = await import('../lib/excel')
      await exportTableXlsx({
        settings: s.settings,
        title: 'سجل العمليات',
        subtitle: CATEGORIES.find((c) => c.value === cat)?.label,
        sheet: 'سجل العمليات',
        headers: ['التاريخ والوقت', 'المستخدم', 'العملية', 'القسم', 'التفاصيل', 'القيم السابقة', 'القيم الجديدة', 'السبب / الملاحظة'],
        widths: [18, 24, 18, 20, 40, 30, 30, 30],
        rows: rows.map((a) => [fmtDateTime(a.at), a.user_name ?? '', ACTION_LABEL[a.action] ?? a.action, s.deptById(a.department_id)?.name ?? '', a.summary ?? '', valuesText(a, 'old'), valuesText(a, 'new'), reasonOf(a)]),
        filename: `سجل العمليات - ${fmtDateTime(new Date()).replace(/[/:]/g, '-')}.xlsx`,
      })
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <div>
      <PageHeader
        title="سجل العمليات"
        subtitle="سجل غير قابل للتعديل أو الحذف لكل عمليات الإدخال والتعديل والاعتماد"
        actions={
          <Button size="sm" icon={<FileSpreadsheet className="size-4" />} onClick={() => void exportExcel()} disabled={!rows.length}>
            Excel
          </Button>
        }
      />
      <Card>
        <form
          className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            setTerm(search.trim())
          }}
        >
          <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-auto">
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          {!isHead && (
            <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto">
              <option value="">كل الأقسام</option>
              {s.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-faint" />
            <input className="field ps-9" placeholder="بحث باسم طالب أو مادة أو مستخدم… (Enter)" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => setTerm(search.trim())} />
          </div>
        </form>
        {q.isLoading ? (
          <LoadingBlock />
        ) : rows.length === 0 ? (
          <EmptyState icon={<History className="size-6" />} title="لا توجد عمليات مطابقة" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((a) => {
              const hasDetails = !!a.details && (a.action.startsWith('grade.') || a.action.startsWith('subject.') || a.action.startsWith('user.update') || a.action === 'settings.update')
              const expanded = open === a.id
              return (
                <li key={a.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="w-36 shrink-0 text-xs tabular-nums text-muted">{fmtDateTime(a.at)}</span>
                    <Badge tone={tone(a.action)}>{ACTION_LABEL[a.action] ?? a.action}</Badge>
                    <span className="min-w-0 flex-1 text-sm">
                      <b>{a.user_name}</b>
                      <span className="text-muted"> — {a.summary}</span>
                      {a.department_id && <span className="text-xs text-faint"> ({s.deptById(a.department_id)?.name})</span>}
                    </span>
                    {hasDetails && (
                      <button className="flex items-center gap-1 text-xs text-primary-text hover:underline" onClick={() => setOpen(expanded ? null : a.id)}>
                        التفاصيل <ChevronDown className={`size-3.5 transition ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                  </div>
                  {a.action.startsWith('grade.') && !expanded && <GradeDiffInline a={a} />}
                  {expanded && <Details a={a} />}
                </li>
              )
            })}
          </ul>
        )}
        {q.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <Button size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              تحميل المزيد
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}

type Vals = Record<string, unknown> | null | undefined
const fmtVal = (k: string, v: unknown) =>
  v == null || v === '' ? '—' : k === 'special' ? (SPECIAL_LABEL[v as SpecialCode] ?? String(v)) : typeof v === 'number' ? fmtNum(v) : String(v)

function changed(a: AuditEntry) {
  const d = a.details as { old?: Vals; new?: Vals } | null
  const keys = Object.keys(GRADE_FIELDS).filter((k) => (d?.old?.[k] ?? null) !== (d?.new?.[k] ?? null))
  return { d, keys }
}

function valuesText(a: AuditEntry, which: 'old' | 'new') {
  if (!a.action.startsWith('grade.')) return ''
  const { d, keys } = changed(a)
  return keys.map((k) => `${GRADE_FIELDS[k]}: ${fmtVal(k, d?.[which]?.[k])}`).join('، ')
}

function reasonOf(a: AuditEntry) {
  const d = a.details as { reason?: string; note?: string } | null
  return d?.reason ?? d?.note ?? ''
}

function GradeDiffInline({ a }: { a: AuditEntry }) {
  const { d, keys } = changed(a)
  if (!keys.length) return null
  const reason = reasonOf(a)
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 ps-0 text-xs sm:ps-39">
      {keys.map((k) => (
        <span key={k} className="rounded-md bg-surface-2 px-2 py-0.5">
          {GRADE_FIELDS[k]}: <span className="text-danger line-through">{fmtVal(k, d?.old?.[k])}</span> ← <b className="text-success">{fmtVal(k, d?.new?.[k])}</b>
        </span>
      ))}
      {reason && <span className="rounded-md bg-gold-soft px-2 py-0.5 text-gold-text">السبب: {reason}</span>}
    </div>
  )
}

function Details({ a }: { a: AuditEntry }) {
  const d = (a.details ?? {}) as Record<string, unknown>
  if (a.action.startsWith('grade.')) return <GradeDiffInline a={a} />
  if (a.action.startsWith('subject.') && 'to' in d) {
    return (
      <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs sm:ms-39">
        من «{STATUS_LABEL[d.from as SubjectStatus]}» إلى «{STATUS_LABEL[d.to as SubjectStatus]}»
        {typeof d.note === 'string' && d.note && <> — الملاحظة: {d.note}</>}
      </div>
    )
  }
  return <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-surface-2 p-3 text-start text-[0.7rem] leading-5 sm:ms-39" dir="ltr">{JSON.stringify(d, null, 2)}</pre>
}
