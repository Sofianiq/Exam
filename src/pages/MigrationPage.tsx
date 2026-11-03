import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeftRight,
  BadgeCheck,
  CheckCircle2,
  DatabaseZap,
  FileSpreadsheet,
  FolderOpen,
  ListChecks,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../app/session'
import { errorText, useConfirm, useToast } from '../components/feedback'
import { Badge, Button, Callout, Card, CardHeader, Checkbox, EmptyState, Modal, PageHeader, ProgressBar, Select, StatCard, cx } from '../components/ui'
import { backend, isDemo } from '../data'
import { fmtDateTime } from '../lib/format'
import {
  FIX_REASON_LABEL,
  LEGACY_RULES,
  LegacyFormatError,
  analyzeLegacy,
  classLabel,
  parseLegacyWorkbook,
  readWorkbook,
  settingsIssues,
  type Issue,
  type LegacyClassAnalysis,
  type LegacyFile,
} from '../lib/legacy'
import { SHIFT_LABEL, stageLabel } from '../lib/labels'
import { normalizeArabic } from '../lib/parse'
import { canEditSettings } from '../lib/perm'
import type { LegacyImport, LegacyImportResult } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

interface ReadState {
  done: number
  total: number
}
interface FileProblem {
  file: string
  message: string
}
type RunResult = { ok: true; res: LegacyImportResult } | { ok: false; error: string }
interface Existing {
  /** مواد منشأة في هذا النظام لنفس الصف والفصول */
  current: number
  /** منها مواد فيها درجات */
  withGrades: number
}

const isXlsx = (name: string) => /\.xlsx$/i.test(name) && !/(^|[\\/])(~\$|\.)/.test(name)

/** يقرأ ملفات مجلد مسحوب (بما فيه المجلدات الفرعية) */
async function filesFromDrop(e: DragEvent): Promise<File[]> {
  const items = [...e.dataTransfer.items]
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x)
  if (!entries.length) return [...e.dataTransfer.files]
  const out: File[] = []
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      out.push(new File([f], `${path}${f.name}`, { type: f.type }))
      return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      for (const c of batch) await walk(c, `${path}${entry.name}/`)
    }
  }
  for (const en of entries) await walk(en, '')
  return out
}

export function MigrationPage() {
  const s = useSession()
  if (!canEditSettings(s.profile)) return <NotFoundPage />
  return <Migration />
}

function Migration() {
  const s = useSession()
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const folderRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<LegacyFile[]>([])
  const [problems, setProblems] = useState<FileProblem[]>([])
  const [ignored, setIgnored] = useState<string[]>([])
  const [reading, setReading] = useState<ReadState | null>(null)
  const [drag, setDrag] = useState(false)
  const [deptMap, setDeptMap] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [replace, setReplace] = useState(false)
  const [clearEmpty, setClearEmpty] = useState(false)
  const [ackMismatch, setAckMismatch] = useState(false)
  const [details, setDetails] = useState<LegacyClassAnalysis | null>(null)
  const [existing, setExisting] = useState<Record<string, Existing>>({})
  const [running, setRunning] = useState<{ done: number; total: number; current: string } | null>(null)
  const [results, setResults] = useState<Record<string, RunResult>>({})
  const [fixingSettings, setFixingSettings] = useState(false)

  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '')
    folderRef.current?.setAttribute('directory', '')
  }, [])

  const importsQ = useQuery({ queryKey: ['legacy-imports'], queryFn: () => backend.listLegacyImports() })
  const imports = useMemo(() => importsQ.data ?? [], [importsQ.data])

  const analysis = useMemo(
    () => (files.length ? analyzeLegacy(files, { departments: s.departments, settings: s.settings, departmentMap: deptMap }) : null),
    [files, s.departments, s.settings, deptMap],
  )
  const setIssues = useMemo(() => settingsIssues(s.settings), [s.settings])
  const blockingSettings = setIssues.some((i) => i.level === 'error')

  const yearIdOf = (label: string) => s.years.find((y) => y.label === label)?.id
  const importOf = (c: LegacyClassAnalysis): LegacyImport | undefined => {
    const y = yearIdOf(c.year)
    return y ? imports.find((x) => x.year_id === y && x.department_id === c.departmentId && x.stage === c.stage && x.shift === c.shift) : undefined
  }
  const stateOf = (c: LegacyClassAnalysis) => {
    const li = importOf(c)
    if (li && c.payload && li.checksum === c.payload.checksum) return 'same' as const
    if (li) return 'changed' as const
    return 'new' as const
  }

  // المواد الموجودة مسبقاً في هذا النظام للصفوف نفسها (مثلاً مستوردة من الخطة الدراسية)
  useEffect(() => {
    if (!analysis) return
    let stop = false
    ;(async () => {
      const out: Record<string, Existing> = {}
      for (const c of analysis.classes) {
        const y = yearIdOf(c.year)
        if (!y || !c.departmentId) continue
        const terms = Object.keys(c.terms).map(Number)
        const subs = (await backend.listSubjects({ year_id: y, department_id: c.departmentId, stage: c.stage, shift: c.shift })).filter((x) => !x.legacy && terms.includes(x.term))
        if (!subs.length) continue
        const grades = await backend.getGrades(subs.map((x) => x.id))
        const has = new Set(grades.filter((g) => g.cw_theory != null || g.cw_practical != null || g.final_practical != null || g.final_theory != null || g.special != null).map((g) => g.subject_id))
        out[c.key] = { current: subs.length, withGrades: has.size }
      }
      if (!stop) setExisting(out)
    })().catch(() => undefined)
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, s.years])

  const blockReason = (c: LegacyClassAnalysis): string | null => {
    if (!c.importable) return c.departmentId ? 'توجد أخطاء مانعة' : 'حدّد القسم المقابل'
    const ex = existing[c.key]
    if (ex?.withGrades) return 'الصف يحتوي على درجات مُدخلة في هذا النظام'
    if (ex?.current && !clearEmpty) return 'يحتوي على مواد من هذا النظام'
    if (stateOf(c) === 'changed' && !replace) return 'مرحّل سابقاً بملفات أخرى'
    if (!c.clean && !ackMismatch) return 'يحتوي على فروقات تتطلب المراجعة'
    return null
  }

  // اختيار تلقائي: كل صف مطابق تماماً ولم يُرحَّل بعد
  useEffect(() => {
    if (!analysis) return
    setSelected(new Set(analysis.classes.filter((c) => c.clean && c.importable && stateOf(c) === 'new').map((c) => c.key)))
    setResults({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis])

  const load = async (list: File[]) => {
    const xs = list.filter((f) => isXlsx(f.webkitRelativePath || f.name))
    const skipped = list.filter((f) => !isXlsx(f.webkitRelativePath || f.name) && !/(^|[\\/])\./.test(f.webkitRelativePath || f.name)).map((f) => f.webkitRelativePath || f.name)
    if (!xs.length) return toast.error('لم يُعثر على ملفات Excel (xlsx) ضمن ما اخترته')
    setReading({ done: 0, total: xs.length })
    const parsed: LegacyFile[] = []
    const errs: FileProblem[] = []
    const other: string[] = [...skipped]
    for (const f of xs) {
      const name = f.webkitRelativePath || f.name
      try {
        const wb = await readWorkbook(name, await f.arrayBuffer())
        const lf = parseLegacyWorkbook(wb)
        if (lf) parsed.push(lf)
        else other.push(name)
      } catch (e) {
        errs.push({ file: name, message: e instanceof LegacyFormatError ? e.message.replace(`${name}: `, '') : `تعذرت قراءة الملف: ${errorText(e)}` })
      }
      setReading((r) => (r ? { ...r, done: r.done + 1 } : r))
    }
    setReading(null)
    setFiles(parsed)
    setProblems(errs)
    setIgnored(other)
    if (parsed.length) toast.success(`قُرئ ${parsed.length} ملف من النظام السابق`)
  }

  const fixSettings = async () => {
    setFixingSettings(true)
    try {
      await backend.updateSettings({
        pass_mark: LEGACY_RULES.passMark,
        average_mode: LEGACY_RULES.averageMode,
        max_failed_subjects: LEGACY_RULES.maxCarry,
        second_round_deduction: LEGACY_RULES.r2Deduction,
      })
      await qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success('ضُبطت قواعد النتيجة لتطابق النظام السابق')
    } catch (e) {
      toast.error(e)
    } finally {
      setFixingSettings(false)
    }
  }

  const run = async () => {
    if (!analysis) return
    const list = analysis.classes.filter((c) => selected.has(c.key) && !blockReason(c))
    if (!list.length) return
    const ok = await confirm({
      title: 'ترحيل البيانات',
      message: (
        <div className="space-y-2">
          <p>
            سيُرحَّل <b>{list.length}</b> صف دراسي ({list.reduce((a, c) => a + c.stats.students, 0)} طالب، {list.reduce((a, c) => a + c.stats.records, 0)} سجل درجة) كمواد
            معتمدة في الدورين. يُنفَّذ كل صف في معاملة واحدة: إما أن يُرحَّل كاملاً أو لا يُرحَّل منه شيء.
          </p>
          <p className="text-muted">يمكن التراجع عن ترحيل أي صف لاحقاً من «سجل الترحيل».</p>
        </div>
      ),
      confirmText: 'بدء الترحيل',
    })
    if (!ok) return
    const out: Record<string, RunResult> = {}
    setResults({})
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      setRunning({ done: i, total: list.length, current: classLabel(c) })
      try {
        const res = await backend.importLegacyClass({ ...c.payload!, replace: stateOf(c) === 'changed' && replace, clear_empty: clearEmpty && !!existing[c.key]?.current })
        out[c.key] = { ok: true, res }
      } catch (e) {
        out[c.key] = { ok: false, error: errorText(e) }
      }
      setResults({ ...out })
    }
    setRunning(null)
    await qc.invalidateQueries()
    const failed = Object.values(out).filter((r) => !r.ok).length
    if (failed) toast.error(`تعذر ترحيل ${failed} من ${list.length} صف — راجع التفاصيل في الجدول`)
    else toast.success(`اكتمل ترحيل ${list.length} صف دراسي بنجاح`)
  }

  const reset = () => {
    setFiles([])
    setProblems([])
    setIgnored([])
    setResults({})
    setDeptMap({})
    if (folderRef.current) folderRef.current.value = ''
    if (filesRef.current) filesRef.current.value = ''
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    try {
      await load(await filesFromDrop(e))
    } catch (err) {
      toast.error(err)
    }
  }

  const counts = analysis
    ? {
        errors: analysis.classes.reduce((n, c) => n + c.issues.filter((i) => i.level === 'error').length, 0) + analysis.issues.filter((i) => i.level === 'error').length,
        mismatches: analysis.classes.reduce((n, c) => n + c.issues.filter((i) => i.level === 'mismatch').length, 0),
        clean: analysis.classes.filter((c) => c.clean).length,
        checked: analysis.classes.reduce((n, c) => n + c.stats.checkedStudents + c.stats.checkedAnnual, 0),
      }
    : null
  const selectable = analysis?.classes.filter((c) => !blockReason(c)) ?? []
  const chosen = selectable.filter((c) => selected.has(c.key))

  return (
    <div className="max-w-7xl space-y-6">
      <PageHeader
        title="ترحيل بيانات النظام السابق"
        subtitle="نقل درجات السنوات السابقة من ملفات تصدير النظام القديم (ExamData) مع التحقق الذاتي من كل درجة ونتيجة قبل الترحيل"
        actions={
          analysis && (
            <>
              <Button icon={<FileSpreadsheet className="size-4" />} onClick={() => import('../lib/legacyReport').then((m) => m.exportLegacyReport(analysis)).catch((e) => toast.error(e))}>
                تقرير التحقق
              </Button>
              <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={reset} disabled={!!running}>
                اختيار ملفات أخرى
              </Button>
            </>
          )
        }
      />

      {isDemo && (
        <Callout tone="warning" icon={<AlertTriangle className="size-5" />} title="النسخة التجريبية">
          البيانات في النسخة التجريبية تُحفظ في المتصفح فقط وبسعة محدودة. جرّب الترحيل هنا بصف أو صفين، ثم نفّذه كاملاً على قاعدة البيانات الفعلية.
        </Callout>
      )}

      {setIssues.length > 0 && (
        <Callout tone={blockingSettings ? 'danger' : 'warning'} icon={<AlertTriangle className="size-5" />} title="إعدادات النتيجة لا تطابق قواعد النظام السابق">
          <ul className="mt-1 list-disc space-y-0.5 ps-5">
            {setIssues.map((i) => (
              <li key={i.message}>{i.message}</li>
            ))}
          </ul>
          {blockingSettings && (
            <Button className="mt-3" size="sm" variant="primary" loading={fixingSettings} onClick={fixSettings}>
              مطابقة الإعدادات مع النظام السابق
            </Button>
          )}
        </Callout>
      )}

      {!analysis && !reading && (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDrag(true)
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              className={cx('m-5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition', drag ? 'border-primary bg-primary-soft' : 'border-line-strong')}
            >
              <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary-text">
                <UploadCloud className="size-7" />
              </div>
              <h3 className="text-lg font-semibold">اسحب مجلد «بيانات الترحيل» إلى هنا</h3>
              <p className="mt-1 max-w-md text-sm text-muted">
                أو اختر المجلد كاملاً (بما فيه المجلدات الفرعية للسنوات والأقسام). تُقرأ الملفات داخل المتصفح فقط ولا تُرفع إلى أي مكان قبل موافقتك.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={<FolderOpen className="size-4" />} onClick={() => folderRef.current?.click()}>
                  اختيار المجلد
                </Button>
                <Button icon={<FileSpreadsheet className="size-4" />} onClick={() => filesRef.current?.click()}>
                  اختيار ملفات
                </Button>
              </div>
              <input ref={folderRef} type="file" multiple hidden onChange={(e) => load([...(e.target.files ?? [])])} />
              <input ref={filesRef} type="file" multiple accept=".xlsx" hidden onChange={(e) => load([...(e.target.files ?? [])])} />
            </div>
          </Card>
          <RulesCard />
        </div>
      )}

      {reading && (
        <Card className="p-6">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="font-medium">جارٍ قراءة الملفات والتحقق منها…</span>
            <span className="tabular-nums text-muted">
              {reading.done} / {reading.total}
            </span>
          </div>
          <ProgressBar value={reading.done / reading.total} />
        </Card>
      )}

      {problems.length > 0 && (
        <Callout tone="danger" icon={<XCircle className="size-5" />} title={`ملفات تعذرت قراءتها (${problems.length})`}>
          <ul className="mt-1 space-y-0.5">
            {problems.map((p) => (
              <li key={p.file}>
                <b dir="auto">{p.file.replace(/^.*[\\/]/, '')}</b>: {p.message}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {analysis && counts && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="الملفات المقروءة"
              value={analysis.totals.files}
              hint={`${analysis.totals.termFiles} فصل · ${analysis.totals.annualFiles} نتيجة سنوية${analysis.index ? ' · الفهرس' : ''}${ignored.length ? ` · تُجوهل ${ignored.length}` : ''}`}
              icon={<FileSpreadsheet className="size-5" />}
            />
            <StatCard label="الطلبة / سجلات الدرجات" value={`${analysis.totals.students} / ${analysis.totals.records}`} hint={`${analysis.classes.length} صف دراسي`} icon={<ListChecks className="size-5" />} tone="info" />
            <StatCard
              label="التحقق الذاتي"
              value={counts.errors + counts.mismatches === 0 ? 'مطابق 100%' : `${counts.clean} / ${analysis.classes.length}`}
              hint={`أُعيد حساب ${counts.checked} نتيجة طالب وقورنت بالنظام السابق`}
              icon={<ShieldCheck className="size-5" />}
              tone={counts.errors ? 'danger' : counts.mismatches ? 'warning' : 'success'}
            />
            <StatCard
              label="المستبعدون / المثبتة"
              value={`${analysis.totals.excluded} / ${analysis.totals.fixed}`}
              hint="طلبة كل درجاتهم صفر · درجات نُقلت كما هي"
              icon={<BadgeCheck className="size-5" />}
              tone="gold"
            />
          </div>

          {analysis.unmatchedDepartments.length > 0 && (
            <Card>
              <CardHeader title="مطابقة الأقسام" subtitle="أقسام في النظام السابق لم يُعثر على ما يقابلها بالاسم في هذا النظام" icon={<ArrowLeftRight className="size-5" />} />
              <div className="grid gap-3 p-5 sm:grid-cols-2">
                {analysis.unmatchedDepartments.map((name) => (
                  <label key={name} className="flex items-center gap-3 text-sm">
                    <span className="w-48 shrink-0 font-medium">{name}</span>
                    <Select value={deptMap[name] ?? ''} onChange={(e) => setDeptMap((m) => ({ ...m, [name]: e.target.value }))}>
                      <option value="">— اختر القسم —</option>
                      {s.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>
            </Card>
          )}

          {analysis.issues.length > 0 && <IssueList title="مطابقة الفهرس والملفات" issues={analysis.issues} />}

          <Card>
            <CardHeader
              title="الصفوف الدراسية"
              subtitle="كل صف (السنة/القسم/المرحلة/الدراسة) يضم الفصلين معاً ويُرحَّل في معاملة واحدة"
              icon={<DatabaseZap className="size-5" />}
              actions={
                <Button variant="primary" icon={<UploadCloud className="size-4" />} disabled={!chosen.length || blockingSettings || !!running} loading={!!running} onClick={run}>
                  ترحيل المحدد ({chosen.length})
                </Button>
              }
            />
            <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-line px-5 py-3 text-sm">
              <Checkbox checked={replace} onChange={setReplace} label="استبدال الترحيل السابق للصفوف المرحّلة بملفات مختلفة" />
              <Checkbox checked={clearEmpty} onChange={setClearEmpty} label="استبدال المواد الفارغة المنشأة في هذا النظام لنفس الصفوف" />
              <Checkbox checked={ackMismatch} onChange={setAckMismatch} label="راجعتُ الفروقات وأوافق على ترحيل الصفوف التي تحتويها" />
            </div>
            {running && (
              <div className="border-b border-line px-5 py-3">
                <div className="mb-2 flex justify-between text-xs text-muted">
                  <span>جارٍ ترحيل: {running.current}</span>
                  <span className="tabular-nums">
                    {running.done} / {running.total}
                  </span>
                </div>
                <ProgressBar value={running.done / running.total} tone="success" />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="تحديد الكل"
                        className="size-4 accent-[var(--color-primary)]"
                        checked={selectable.length > 0 && chosen.length === selectable.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((c) => c.key)) : new Set())}
                      />
                    </th>
                    <th className="px-3 py-2.5 text-start font-medium">الصف الدراسي</th>
                    <th className="px-3 py-2.5 font-medium">الملفات</th>
                    <th className="px-3 py-2.5 font-medium">الطلبة</th>
                    <th className="px-3 py-2.5 font-medium">السجلات</th>
                    <th className="px-3 py-2.5 font-medium">التحقق</th>
                    <th className="px-3 py-2.5 font-medium">في هذا النظام</th>
                    <th className="px-3 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {analysis.classes.map((c) => {
                    const why = blockReason(c)
                    const st = stateOf(c)
                    const r = results[c.key]
                    const nErr = c.issues.filter((i) => i.level === 'error').length
                    const nMis = c.issues.filter((i) => i.level === 'mismatch').length
                    const ex = existing[c.key]
                    return (
                      <tr key={c.key} className={cx('border-t border-line align-middle', why && 'bg-surface-2/40')}>
                        <td className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            aria-label={classLabel(c)}
                            className="size-4 accent-[var(--color-primary)]"
                            disabled={!!why || !!running}
                            checked={!why && selected.has(c.key)}
                            onChange={(e) =>
                              setSelected((sel) => {
                                const n = new Set(sel)
                                if (e.target.checked) n.add(c.key)
                                else n.delete(c.key)
                                return n
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium">
                            {c.departmentName} — {stageLabel(c.stage)} — {SHIFT_LABEL[c.shift]}
                          </div>
                          <div className="text-xs text-muted">
                            <span className="tabular-nums">{c.year}</span>
                            {c.departmentId && normalizeArabic(s.deptById(c.departmentId)?.name ?? '') !== normalizeArabic(c.departmentName) && ` · يُرحَّل إلى: ${s.deptById(c.departmentId)?.name}`}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex justify-center gap-1">
                            <FileBadge ok={!!c.terms[1]} label="الأول" />
                            <FileBadge ok={!!c.terms[2]} label="الثاني" />
                            <FileBadge ok={!!c.annual} label="السنوية" />
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center tabular-nums">
                          {c.stats.students}
                          {c.stats.excluded > 0 && <span className="block text-[0.7rem] text-muted">+{c.stats.excluded} مستبعد</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center tabular-nums">{c.stats.records}</td>
                        <td className="px-3 py-2.5 text-center">
                          {nErr ? (
                            <Badge tone="danger" icon={<XCircle className="size-3.5" />}>
                              {nErr} خطأ
                            </Badge>
                          ) : nMis ? (
                            <Badge tone="warning" icon={<AlertTriangle className="size-3.5" />}>
                              {nMis} فرق
                            </Badge>
                          ) : (
                            <Badge tone="success" icon={<CheckCircle2 className="size-3.5" />}>
                              مطابق تماماً
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {r ? (
                            r.ok ? (
                              <Badge tone="success">{r.res.status === 'unchanged' ? 'مرحّل مسبقاً' : r.res.status === 'replaced' ? 'استُبدل' : 'رُحِّل'}</Badge>
                            ) : (
                              <span className="text-xs text-danger">{r.error}</span>
                            )
                          ) : st === 'same' ? (
                            <Badge tone="success">مرحّل مسبقاً</Badge>
                          ) : st === 'changed' ? (
                            <Badge tone="warning">مرحّل بملفات أخرى</Badge>
                          ) : ex?.current ? (
                            <Badge tone={ex.withGrades ? 'danger' : 'warning'}>{ex.withGrades ? 'فيه درجات حالية' : `${ex.current} مادة حالية`}</Badge>
                          ) : (
                            <span className="text-xs text-muted">لم يُرحَّل</span>
                          )}
                          {why && !r && st !== 'same' && <div className="mt-0.5 text-[0.7rem] text-muted">{why}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex justify-center gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setDetails(c)}>
                              التفاصيل
                            </Button>
                            {(r?.ok || st === 'same') && c.departmentId && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  const y = yearIdOf(c.year)
                                  if (y) s.setYearId(y)
                                  navigate(`/class/${c.departmentId}/${c.stage}/${c.shift}`)
                                }}
                              >
                                عرض
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <HistoryCard imports={imports} loading={importsQ.isLoading} onUndone={() => qc.invalidateQueries()} />

      {details && <DetailsModal c={details} onClose={() => setDetails(null)} />}
    </div>
  )
}

function FileBadge({ ok, label }: { ok: boolean; label: string }) {
  return <span className={cx('rounded px-1.5 py-0.5 text-[0.7rem] font-medium', ok ? 'bg-success-soft text-success' : 'bg-surface-3 text-faint line-through')}>{label}</span>
}

const LEVEL_TONE = { error: 'danger', mismatch: 'warning', warning: 'info', info: 'neutral' } as const
const LEVEL_LABEL = { error: 'خطأ', mismatch: 'فرق', warning: 'تنبيه', info: 'معلومة' } as const

function IssueList({ title, issues, max = 200 }: { title?: string; issues: Issue[]; max?: number }) {
  const sorted = [...issues].sort((a, b) => ['error', 'mismatch', 'warning', 'info'].indexOf(a.level) - ['error', 'mismatch', 'warning', 'info'].indexOf(b.level))
  const body = (
    <ul className="divide-y divide-line text-sm">
      {sorted.slice(0, max).map((i, n) => (
        <li key={n} className="flex items-start gap-3 px-5 py-2">
          <Badge tone={LEVEL_TONE[i.level]} className="mt-0.5">
            {LEVEL_LABEL[i.level]}
          </Badge>
          <div className="min-w-0">
            <div>{i.message}</div>
            {(i.student || i.subject || i.file) && (
              <div className="mt-0.5 text-xs text-muted">{[i.student, i.subject, i.file?.replace(/^.*[\\/]/, '')].filter(Boolean).join(' · ')}</div>
            )}
          </div>
        </li>
      ))}
      {sorted.length > max && <li className="px-5 py-2 text-xs text-muted">و {sorted.length - max} ملاحظة أخرى في تقرير التحقق…</li>}
    </ul>
  )
  if (!title) return body
  return (
    <Card>
      <CardHeader title={title} icon={<ScrollText className="size-5" />} />
      {body}
    </Card>
  )
}

function DetailsModal({ c, onClose }: { c: LegacyClassAnalysis; onClose: () => void }) {
  const [tab, setTab] = useState<'issues' | 'fixed' | 'excluded' | 'subjects'>(c.issues.length ? 'issues' : 'subjects')
  const subjects = c.payload?.subjects ?? []
  const tabs = [
    { k: 'issues' as const, label: `الملاحظات (${c.issues.length})` },
    { k: 'fixed' as const, label: `الدرجات المثبتة (${c.fixed.length})` },
    { k: 'excluded' as const, label: `المستبعدون (${c.excluded.length})` },
    { k: 'subjects' as const, label: `المواد (${c.stats.subjects})` },
  ]
  return (
    <Modal open onClose={onClose} title={classLabel(c)} size="xl">
      <div className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Mini label="نتائج فصلية مُتحقق منها" value={c.stats.checkedStudents} />
        <Mini label="نتائج سنوية مُتحقق منها" value={c.stats.checkedAnnual} />
        <Mini label="درجات القرار" value={c.stats.decisions} />
        <Mini label="درجات الدور الثاني" value={c.stats.r2} />
      </div>
      <div className="mb-3 flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === t.k ? 'border-primary font-semibold text-primary-text' : 'border-transparent text-muted hover:text-ink')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="max-h-[55vh] overflow-auto">
        {tab === 'issues' &&
          (c.issues.length ? <IssueList issues={c.issues} /> : <EmptyState icon={<CheckCircle2 className="size-6" />} title="لا ملاحظات">كل الدرجات والنتائج مطابقة للنظام السابق.</EmptyState>)}
        {tab === 'fixed' &&
          (c.fixed.length ? (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">الطالب</th>
                  <th className="px-3 py-2 text-start font-medium">المادة</th>
                  <th className="px-3 py-2 font-medium">النظام السابق</th>
                  <th className="px-3 py-2 font-medium">المحسوب</th>
                  <th className="px-3 py-2 text-start font-medium">السبب</th>
                </tr>
              </thead>
              <tbody>
                {c.fixed.map((f, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-1.5">{f.student}</td>
                    <td className="px-3 py-1.5">{f.subject}</td>
                    <td className="px-3 py-1.5 text-center font-semibold tabular-nums">{f.legacyFinal ?? '—'}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums text-muted">{f.computed ?? '—'}</td>
                    <td className="px-3 py-1.5 text-xs">{FIX_REASON_LABEL[f.reason]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState title="لا توجد درجات مثبتة">كل الدرجات النهائية أعاد هذا النظام حسابها بقواعده وطابقت النظام السابق.</EmptyState>
          ))}
        {tab === 'excluded' &&
          (c.excluded.length ? (
            <ul className="divide-y divide-line text-sm">
              {c.excluded.map((x) => (
                <li key={x.no ?? x.name} className="px-3 py-2">
                  <div className="font-medium">{x.name}</div>
                  <div className="text-xs text-muted">{[x.no, x.notes].filter(Boolean).join(' · ')}</div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="لا يوجد طلبة مستبعدون" />
          ))}
        {tab === 'subjects' && (
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">الفصل</th>
                <th className="px-3 py-2 text-start font-medium">المادة</th>
                <th className="px-3 py-2 font-medium">الوحدات</th>
                <th className="px-3 py-2 font-medium">التوزيع</th>
                <th className="px-3 py-2 text-start font-medium">التدريسي</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((x) => (
                <tr key={x.key} className="border-t border-line">
                  <td className="px-3 py-1.5 text-center">{x.term === 1 ? 'الأول' : 'الثاني'}</td>
                  <td className="px-3 py-1.5">{x.name}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums">{x.units ?? '—'}</td>
                  <td className="px-3 py-1.5 text-center tabular-nums">
                    {x.coursework_max} / {100 - x.coursework_max}
                    {x.meta?.inferred && (
                      <Badge tone="info" className="ms-1">
                        مستنتج
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted">{x.meta?.teacher ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  )
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  )
}

function RulesCard() {
  const rules = [
    'تُقرأ الأوراق الخمس لكل ملف فصل (المعلومات، المواد، الطلبة، الدرجات التفصيلية، الكشف الشامل) والنتيجة السنوية وملف الفهرس.',
    'تُحسب كل درجة بمحرك هذا النظام نفسه (السعي + النهائي + درجات القرار) وتُقارن بالدرجة النهائية في النظام السابق.',
    'الدور الثاني: السعي ثابت ويُخصم 10 درجات من الناجح فيه دون النزول عن 50، ولا خصم على المؤجل بعذر.',
    'الطالب مكمل بعد الدور الأول مهما كان عدد المواد، وبعد الدور الثاني: ناجح بالتحميل (مادتان فأقل سنوياً) أو راسب.',
    'يُعاد حساب المعدل الموزون والنتيجة والتسلسل لكل طالب ويُقارن بالكشف الشامل والنتيجة السنوية.',
    'الطلبة الذين كل درجاتهم صفر أو فارغة لا يُرحَّلون، ويظهرون في التقرير بأسمائهم.',
    'الدرجات التي عدّلها النظام السابق يدوياً (تسوية) تُثبت كما هي مع ذكر السبب، ويُحفظ السجل الأصلي لكل درجة.',
    'الترحيل آمن للتكرار: الملفات نفسها لا تُرحَّل مرتين، ويمكن التراجع عن أي صف.',
  ]
  return (
    <Card>
      <CardHeader title="كيف يعمل الترحيل" icon={<ShieldCheck className="size-5" />} />
      <ol className="space-y-2.5 px-5 py-4 text-sm leading-relaxed">
        {rules.map((r, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[0.7rem] font-bold text-primary-text">{i + 1}</span>
            <span>{r}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function HistoryCard({ imports, loading, onUndone }: { imports: LegacyImport[]; loading: boolean; onUndone: () => void }) {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const undo = async (li: LegacyImport) => {
    const label = `${s.years.find((y) => y.id === li.year_id)?.label ?? ''} — ${s.deptById(li.department_id)?.name ?? ''} — المرحلة ${li.stage} — ${SHIFT_LABEL[li.shift]}`
    const ok = await confirm({
      title: 'التراجع عن الترحيل',
      message: `ستُحذف كل المواد والدرجات المرحّلة للصف «${label}» والطلبة الذين أنشأهم الترحيل. لا يؤثر ذلك على أي بيانات أخرى.`,
      confirmText: 'تراجع',
      danger: true,
      typeToConfirm: 'تراجع',
    })
    if (!ok) return
    setBusy(li.id)
    try {
      await backend.undoLegacyImport(li.id)
      toast.success('تم التراجع عن ترحيل الصف')
      onUndone()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card>
      <CardHeader title="سجل الترحيل" subtitle="الصفوف المرحّلة من النظام السابق" icon={<ScrollText className="size-5" />} />
      {loading ? null : imports.length === 0 ? (
        <EmptyState icon={<DatabaseZap className="size-6" />} title="لم يُرحَّل أي صف بعد" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-4 py-2 text-start font-medium">الصف الدراسي</th>
                <th className="px-3 py-2 font-medium">الطلبة</th>
                <th className="px-3 py-2 font-medium">المواد</th>
                <th className="px-3 py-2 font-medium">الدرجات</th>
                <th className="px-3 py-2 text-start font-medium">التاريخ</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {imports.map((li) => (
                <tr key={li.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <div className="font-medium">
                      {s.deptById(li.department_id)?.name} — {stageLabel(li.stage)} — {SHIFT_LABEL[li.shift]}
                    </div>
                    <div className="text-xs text-muted">{s.years.find((y) => y.id === li.year_id)?.label}</div>
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{li.counts.students ?? '—'}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{li.counts.subjects ?? '—'}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{li.counts.grades ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {fmtDateTime(li.imported_at)}
                    {li.imported_by_name && <div>{li.imported_by_name}</div>}
                  </td>
                  <td className="px-3 py-2 text-end">
                    <Button size="sm" variant="danger-soft" loading={busy === li.id} onClick={() => undo(li)}>
                      تراجع
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
