import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  CloudOff,
  FileSpreadsheet,
  Info,
  Loader2,
  Lock,
  PencilLine,
  Printer,
  RotateCcw,
  Save,
  Search,
  Send,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useParams } from 'react-router-dom'
import { classKeyOf, useGrades, useInvalidate, useStudents } from '../app/queries'
import { useSession } from '../app/session'
import { useConfirm, useToast } from '../components/feedback'
import { GradeGrid } from '../components/grades/GradeGrid'
import { SubjectPrint } from '../components/grades/SubjectPrint'
import { useGradeEditor } from '../components/grades/useGradeEditor'
import { Badge, Button, Callout, Card, Checkbox, LoadingBlock, PageHeader, StatusBadge, cx } from '../components/ui'
import { backend } from '../data'
import { bandCounts, sheetStats } from '../lib/calc'
import { displayName, fmtDateTime, fmtNum, fmtPct, fmtTime, yearLabel } from '../lib/format'
import { SHIFT_LABEL, TERM_LABEL, stageLabel } from '../lib/labels'
import { normalizeArabic } from '../lib/parse'
import { canViewAll, gradeEditBlock, workflowActions } from '../lib/perm'
import { NotFoundPage } from './NotFoundPage'

export function GradeSheetPage() {
  const { subjectId } = useParams()
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const invalidate = useInvalidate()
  const subjectQ = useQuery({ queryKey: ['subject', subjectId], queryFn: () => backend.getSubject(subjectId!), enabled: !!subjectId })
  const subject = subjectQ.data ?? undefined
  const studentsQ = useStudents(subject ? classKeyOf(subject) : null)
  const gradesQ = useGrades(subject ? [subject.id] : [])
  const dept = s.deptById(subject?.department_id)
  const [reason, setReason] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [highlight, setHighlight] = useState(false)
  const [acting, setActing] = useState(false)

  const onSaved = useCallback(() => void invalidate('progress', 'audit'), [invalidate])
  const editor = useGradeEditor({ subject, students: studentsQ.data, grades: gradesQ.data, settings: s.settings, reason, onSaved })

  const block = subject ? gradeEditBlock(s.profile, subject, s.settings, dept) : 'loading'
  const approvedEdit = subject?.status === 'approved' && block == null
  const readOnly = block != null || (approvedEdit && !reason)
  const actions = subject ? workflowActions(s.profile, subject, s.settings, dept) : null

  const students = useMemo(() => studentsQ.data ?? [], [studentsQ.data])
  const numberOf = useMemo(() => new Map(students.map((st, i) => [st.id, i + 1])), [students])
  const shown = useMemo(() => {
    const t = normalizeArabic(search)
    return students.filter((st) => {
      if (t && !normalizeArabic(st.full_name).includes(t)) return false
      if (onlyMissing) {
        const r = editor.parsed[st.id]?.result
        return st.status === 'active' && !r?.complete
      }
      return true
    })
  }, [students, search, onlyMissing, editor.parsed])

  const active = students.filter((st) => st.status === 'active')
  const results = active.map((st) => editor.parsed[st.id]?.result).filter((r): r is NonNullable<typeof r> => !!r)
  const stats = sheetStats(results, s.settings.pass_mark)
  const bands = bandCounts(results.map((r) => r.total), s.settings.grade_scale)
  const incomplete = active.length - stats.complete
  const teachers = subject?.teacher_ids.map((id) => displayName(s.profileById(id))).filter(Boolean).join(' + ') ?? ''

  // حماية التعديلات غير المحفوظة
  const editorRef = useRef(editor)
  editorRef.current = editor
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  const blocker = useBlocker(({ currentLocation, nextLocation }) => editorRef.current.dirtyCount > 0 && currentLocation.pathname !== nextLocation.pathname)
  const blockerRef = useRef(blocker)
  blockerRef.current = blocker
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let cancelled = false
    void (async () => {
      const ok = await editorRef.current.flush()
      if (cancelled) return
      if (ok) return blockerRef.current.proceed?.()
      const leave = await confirmRef.current({
        title: 'تغييرات غير محفوظة',
        message: 'توجد درجات لم تُحفظ (قيم غير صحيحة أو خطأ في الاتصال). هل تريد مغادرة الصفحة وتجاهلها؟',
        confirmText: 'مغادرة دون حفظ',
        danger: true,
      })
      if (cancelled) return
      if (leave) blockerRef.current.proceed?.()
      else blockerRef.current.reset?.()
    })()
    return () => {
      cancelled = true
    }
  }, [blocker.state])

  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (editorRef.current.dirtyCount > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void editorRef.current.flush()
      }
    }
    // حفظ فوري عند إخفاء الصفحة (تبديل التبويب أو إغلاق التطبيق على الهاتف)
    const onHide = () => {
      if (document.visibilityState === 'hidden') void editorRef.current.flush()
    }
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('keydown', onKey)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  if (subjectQ.isLoading || (subject && (studentsQ.isLoading || gradesQ.isLoading))) return <LoadingBlock label="جارٍ تحميل قائمة الدرجات…" />
  if (!subject) return <NotFoundPage title="المادة غير موجودة" message="قد تكون المادة محذوفة أو غير مسندة إليك." />

  const refresh = () => invalidate('subject', 'subjects', 'progress', 'audit', 'grades')

  const doSubmit = async () => {
    if (!(await editor.flush())) return toast.error('صحح الخلايا المظللة باللون الأحمر قبل الإرسال')
    setHighlight(true)
    const ok = await confirm({
      title: 'إرسال القائمة إلى اللجنة الامتحانية',
      message: (
        <div className="space-y-2">
          {incomplete > 0 && (
            <div className="rounded-lg bg-warning-soft px-3 py-2 text-warning">
              <b>تنبيه:</b> يوجد {incomplete} طالب بدرجات ناقصة (مظللة باللون البرتقالي). يمكنك تسجيل حالة خاصة لهم (غائب/محروم/مؤجل).
            </div>
          )}
          <p>بعد الإرسال لن تتمكن من تعديل الدرجات إلا إذا أعادت اللجنة القائمة إليك.</p>
        </div>
      ),
      confirmText: incomplete > 0 ? 'إرسال رغم النقص' : 'إرسال',
    })
    if (!ok) return
    await act(() => backend.setSubjectStatus(subject.id, 'submitted'), 'تم إرسال القائمة إلى اللجنة الامتحانية')
  }

  const act = async (fn: () => Promise<void>, msg: string) => {
    setActing(true)
    try {
      await fn()
      toast.success(msg)
      await refresh()
    } catch (e) {
      toast.error(e)
    } finally {
      setActing(false)
    }
  }

  const doApprove = async () => {
    if (incomplete > 0) setHighlight(true)
    const ok = await confirm({
      title: 'اعتماد القائمة',
      message:
        incomplete > 0 ? (
          <span className="text-warning">تنبيه: يوجد {incomplete} طالب بدرجات ناقصة. هل تريد الاعتماد رغم ذلك؟</span>
        ) : (
          'بعد الاعتماد تُغلق القائمة ولا يمكن تعديلها إلا من الإدارة العليا مع ذكر السبب.'
        ),
      confirmText: 'اعتماد',
    })
    if (ok) await act(() => backend.setSubjectStatus(subject.id, 'approved'), 'تم اعتماد القائمة')
  }

  const doReturn = async () => {
    const note = await confirm({
      title: subject.status === 'approved' ? 'إعادة فتح قائمة معتمدة' : 'إعادة القائمة للتعديل',
      message: 'ستُعاد القائمة إلى التدريسي ليتمكن من التعديل ثم إعادة الإرسال.',
      input: { label: 'ملاحظة اللجنة (تظهر للتدريسي)', required: true, multiline: true, placeholder: 'مثال: يرجى مراجعة درجات العملي للطلبة…' },
      confirmText: 'إعادة القائمة',
    })
    if (typeof note === 'string') await act(() => backend.setSubjectStatus(subject.id, 'returned', note), 'تمت إعادة القائمة إلى التدريسي')
  }

  const doDraft = async () => {
    const note = await confirm({
      title: 'إعادة القائمة إلى مسودة',
      input: { label: 'سبب الإجراء', required: true },
      confirmText: 'تأكيد',
    })
    if (typeof note === 'string') await act(() => backend.setSubjectStatus(subject.id, 'draft', note), 'أُعيدت القائمة إلى مسودة')
  }

  const startApprovedEdit = async () => {
    const r = await confirm({
      title: 'تعديل قائمة معتمدة',
      message: 'سيُسجَّل كل تعديل في سجل العمليات مع الدرجة القديمة والجديدة وسبب التعديل.',
      input: { label: 'سبب التعديل', required: true, placeholder: 'مثال: تصحيح خطأ في جمع درجة الطالب…' },
      confirmText: 'بدء التعديل',
    })
    if (typeof r === 'string') setReason(r)
  }

  const exportExcel = async () => {
    try {
      const { exportSubjectXlsx } = await import('../lib/excel')
      await exportSubjectXlsx({
        settings: s.settings,
        deptName: dept?.name ?? '',
        yearLabel: yearLabel(s.years.find((y) => y.id === subject.year_id)?.label),
        subject,
        teachers,
        students,
        rows: editor.parsed,
        stats,
      })
      void backend.logEvent('report.export', `تصدير Excel — ${subject.name}`)
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <div>
      <div className="no-print">
        <PageHeader
          crumbs={
            <>
              {(canViewAll(s.profile) || s.profile.role === 'head') && dept ? (
                <>
                  <Link to={`/departments/${dept.id}`} className="hover:text-ink">
                    {dept.name}
                  </Link>
                  <ChevronLeft className="size-3" />
                  <Link to={`/class/${dept.id}/${subject.stage}/${subject.shift}?term=${subject.term}`} className="hover:text-ink">
                    {stageLabel(subject.stage)} — {SHIFT_LABEL[subject.shift]}
                  </Link>
                </>
              ) : (
                <Link to="/my-subjects" className="hover:text-ink">
                  موادي
                </Link>
              )}
              <ChevronLeft className="size-3" />
              <span>{TERM_LABEL[subject.term]}</span>
            </>
          }
          title={subject.name}
          subtitle={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {dept?.name} — {stageLabel(subject.stage)} — {SHIFT_LABEL[subject.shift]} — {TERM_LABEL[subject.term]}
              </span>
              <span className="text-faint">|</span>
              <span>التدريسي: {teachers || 'غير محدد'}</span>
            </span>
          }
          actions={
            <>
              <StatusBadge status={subject.status} />
              <Button size="sm" icon={<Printer className="size-4" />} onClick={() => {
                void backend.logEvent('report.print', `طباعة — ${subject.name}`)
                window.print()
              }}>
                طباعة / PDF
              </Button>
              <Button size="sm" icon={<FileSpreadsheet className="size-4" />} onClick={() => void exportExcel()}>
                Excel
              </Button>
            </>
          }
        />

        {/* شريط الحالة والإجراءات */}
        <Card className="mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge tone="primary">السعي {subject.coursework_max}{subject.cw_practical_max > 0 ? ` (${subject.coursework_max - subject.cw_practical_max}+${subject.cw_practical_max})` : ''}</Badge>
            {subject.practical_max > 0 && <Badge tone="primary">العملي النهائي {subject.practical_max}</Badge>}
            <Badge tone="primary">النظري النهائي {subject.final_max}</Badge>
          </div>
          <SaveIndicator editor={editor} readOnly={readOnly} />
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {actions?.submit && !readOnly && (
              <Button variant="primary" size="sm" icon={<Send className="size-4" />} loading={acting} onClick={() => void doSubmit()}>
                إرسال إلى اللجنة
              </Button>
            )}
            {actions?.approve && (
              <Button variant="success" size="sm" icon={<CheckCircle2 className="size-4" />} loading={acting} onClick={() => void doApprove()}>
                اعتماد
              </Button>
            )}
            {actions?.giveBack && (
              <Button variant="secondary" size="sm" icon={<Undo2 className="size-4" />} loading={acting} onClick={() => void doReturn()}>
                {subject.status === 'approved' ? 'إعادة فتح' : 'إعادة للتعديل'}
              </Button>
            )}
            {actions?.toDraft && subject.status !== 'approved' && (
              <Button variant="ghost" size="sm" icon={<RotateCcw className="size-4" />} loading={acting} onClick={() => void doDraft()}>
                إلى مسودة
              </Button>
            )}
          </div>
        </Card>

        {subject.status === 'returned' && subject.status_note && (
          <Callout tone="warning" icon={<Undo2 className="size-4.5" />} title="القائمة معادة من اللجنة الامتحانية" className="mb-4">
            {subject.status_note}
            {subject.reviewed_at && <span className="ms-2 text-xs opacity-75">({fmtDateTime(subject.reviewed_at)})</span>}
          </Callout>
        )}
        {block && block !== 'loading' && block !== 'ليست لديك صلاحية على درجات هذه المادة' && (
          <Callout tone={subject.status === 'approved' ? 'success' : 'info'} icon={<Lock className="size-4.5" />} className="mb-4" title="القائمة للعرض فقط">
            {block}
          </Callout>
        )}
        {approvedEdit && !reason && (
          <Callout tone="success" icon={<CheckCircle2 className="size-4.5" />} className="mb-4" title="هذه القائمة معتمدة">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>يمكنك بصلاحيتك تعديلها مع تسجيل السبب في سجل العمليات.</span>
              <Button size="sm" icon={<PencilLine className="size-4" />} onClick={() => void startApprovedEdit()}>
                تعديل مع ذكر السبب
              </Button>
            </div>
          </Callout>
        )}
        {approvedEdit && reason && (
          <Callout tone="gold" icon={<PencilLine className="size-4.5" />} className="mb-4">
            وضع تعديل القائمة المعتمدة — السبب: <b>{reason}</b>
          </Callout>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-faint" />
            <input className="field ps-9" placeholder="بحث باسم الطالب…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Checkbox checked={onlyMissing} onChange={setOnlyMissing} label={`عرض الناقص فقط (${incomplete})`} />
          <Checkbox checked={highlight} onChange={setHighlight} label="تظليل الخلايا الناقصة" />
          {!readOnly && (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Info className="size-3.5" /> الصق عموداً من Excel مباشرة • «غ» غائب، «ح» محروم، «م» مؤجل • الأسهم وEnter للتنقل • Ctrl+S للحفظ
            </span>
          )}
        </div>

        {students.length === 0 ? (
          <Callout tone="warning" icon={<AlertTriangle className="size-4.5" />} title="لا يوجد طلبة في هذا الصف">
            يجب على مقرر القسم إضافة أسماء الطلبة أولاً من صفحة «قائمة الطلبة».
          </Callout>
        ) : (
          <div className="card max-h-[calc(100dvh-14rem)] min-h-80 overflow-auto scrollbar-thin">
            <GradeGrid
              subject={subject}
              students={shown}
              numberOf={numberOf}
              drafts={editor.drafts}
              parsed={editor.parsed}
              readOnly={readOnly}
              highlightMissing={highlight}
              passMark={s.settings.pass_mark}
              onChange={editor.update}
              onPasteRows={(n) => toast.info(`تم لصق درجات ${n} طالب`)}
            />
          </div>
        )}

        {/* الإحصائيات */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          <MiniStat label="عدد الطلبة" value={stats.count} />
          <MiniStat label="مكتمل" value={`${stats.complete}/${stats.count}`} />
          <MiniStat label="الناجحون" value={stats.pass} tone="text-success" />
          <MiniStat label="الراسبون" value={stats.fail} tone="text-danger" />
          <MiniStat label="حالات خاصة" value={stats.special} tone="text-warning" />
          <MiniStat label="أعلى / أدنى" value={stats.max == null ? '—' : `${fmtNum(stats.max)} / ${fmtNum(stats.min)}`} />
          <MiniStat label="المعدل" value={stats.avg == null ? '—' : fmtNum(stats.avg)} />
          <MiniStat label="نسبة النجاح" value={fmtPct(stats.passRate)} />
        </div>
        {stats.graded > 0 && (
          <Card className="mt-3 flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
            <span className="font-semibold text-muted">توزيع التقديرات:</span>
            {bands.map((b) => (
              <Badge key={b.label} tone={b.min >= s.settings.pass_mark ? 'primary' : 'danger'}>
                {b.label} ({b.min}–{b.upper}): <b className="tabular-nums">{b.count}</b>
              </Badge>
            ))}
          </Card>
        )}
      </div>

      <SubjectPrint subject={subject} students={students} parsed={editor.parsed} stats={stats} teachers={teachers} passMark={s.settings.pass_mark} />
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="card px-3 py-2.5">
      <div className="text-[0.7rem] text-muted">{label}</div>
      <div className={cx('text-lg font-bold tabular-nums', tone)}>{value}</div>
    </div>
  )
}

function SaveIndicator({ editor, readOnly }: { editor: ReturnType<typeof useGradeEditor>; readOnly: boolean }) {
  if (readOnly && editor.dirtyCount === 0) {
    return editor.lastSaved ? <span data-save-state="readonly" className="text-xs text-muted">آخر تحديث: {fmtDateTime(editor.lastSaved)}</span> : null
  }
  if (editor.saving)
    return (
      <span data-save-state="saving" className="flex items-center gap-1.5 text-xs text-info">
        <Loader2 className="size-3.5 animate-spin" /> جارٍ الحفظ…
      </span>
    )
  if (editor.saveError)
    return (
      <span data-save-state="error" className="flex items-center gap-2 text-xs text-danger">
        <CloudOff className="size-3.5" /> لم يتم الحفظ: {editor.saveError}
        <button className="font-semibold underline" onClick={() => void editor.save()}>
          إعادة المحاولة
        </button>
      </span>
    )
  if (editor.invalidCount > 0)
    return (
      <span data-save-state="invalid" className="flex items-center gap-1.5 text-xs text-danger">
        <AlertTriangle className="size-3.5" /> {editor.invalidCount} طالب بقيم غير صحيحة لن تُحفظ حتى تصحيحها
      </span>
    )
  if (editor.dirtyCount > 0)
    return (
      <span data-save-state="pending" className="flex items-center gap-1.5 text-xs text-gold-text">
        <Save className="size-3.5" /> تغييرات بانتظار الحفظ…
      </span>
    )
  return editor.lastSaved ? (
    <span data-save-state="saved" className="flex items-center gap-1.5 text-xs text-success">
      <CheckCircle2 className="size-3.5" /> محفوظ — {fmtTime(editor.lastSaved)}
    </span>
  ) : (
    <span className="text-xs text-muted">الحفظ تلقائي أثناء الإدخال</span>
  )
}
