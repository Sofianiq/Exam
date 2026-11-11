import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ExternalLink, IdCard, KeyRound, Printer, RefreshCw, Save, Send, Smartphone, Undo2, UserPlus, Users, Eye, EyeOff, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PORTAL_ITEMS, buildPortalSnapshots, isStalePublication, portalLoginUrl, publishBlocker } from '../app/portal'
import { printPage, usePrinting } from '../app/print'
import { useSession } from '../app/session'
import { errorText, useConfirm, useToast } from '../components/feedback'
import { QrCode } from '../components/ResultSlip'
import { Badge, Button, Callout, Card, CardHeader, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Select, StatCard, Switch, Textarea, cx } from '../components/ui'
import { backend } from '../data'
import { fmtDateTime } from '../lib/format'
import { SHIFT_LABEL, stageLabel } from '../lib/labels'
import { canViewAll } from '../lib/perm'
import { WithholdDialog } from '../components/WithholdDialog'
import type { ClassKey, PortalCard, PortalChange, PortalClassInfo, PortalKind, PortalOverview, PortalPublication, PortalTerm, PortalWithheld } from '../lib/types'
import { NotFoundPage } from './NotFoundPage'

export function PortalPage() {
  const s = useSession()
  if (!canViewAll(s.profile) && s.profile.role !== 'head') return <NotFoundPage />
  return <Portal />
}

const classId = (c: { department_id: string; stage: number; shift: string }) => `${c.department_id}|${c.stage}|${c.shift}`
const historyText = (n: number | undefined) => (n ? `، ورُبط ${n} ${n === 1 ? 'سجل' : 'سجلات'} من سنوات أخرى بحسابات أصحابها` : '')

function Portal() {
  const s = useSession()
  const qc = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const manage = s.profile.role === 'admin' || s.profile.role === 'dean'
  const isHead = s.profile.role === 'head'
  const [dept, setDept] = useState(isHead ? (s.profile.department_id ?? '') : '')
  const [busy, setBusy] = useState<string | null>(null)
  const [cardsOf, setCardsOf] = useState<PortalClassInfo | null>(null)
  const [lifting, setLifting] = useState<PortalWithheld | null>(null)

  const q = useQuery({ queryKey: ['portal', s.yearId], queryFn: () => backend.portalOverview(s.yearId), enabled: !!s.yearId })
  const ov = q.data
  const refresh = () => qc.invalidateQueries({ queryKey: ['portal'] })

  const classes = useMemo(() => {
    const order = new Map(s.departments.map((d, i) => [d.id, d.sort * 1000 + i]))
    return (ov?.classes ?? [])
      .filter((c) => c.students > 0 && (!dept || c.department_id === dept))
      .sort((a, b) => (order.get(a.department_id) ?? 0) - (order.get(b.department_id) ?? 0) || a.stage - b.stage || a.shift.localeCompare(b.shift))
  }, [ov, dept, s.departments])

  const totals = useMemo(() => {
    const list = ov?.classes ?? []
    return {
      students: list.reduce((a, c) => a + c.students, 0),
      accounts: list.reduce((a, c) => a + c.accounts, 0),
      loggedIn: list.reduce((a, c) => a + c.logged_in, 0),
      published: ov?.publications.length ?? 0,
    }
  }, [ov])

  const canCards = (c: PortalClassInfo) => manage || (isHead && s.profile.department_id === c.department_id)
  const keyOf = (c: PortalClassInfo): ClassKey => ({ year_id: s.yearId, department_id: c.department_id, stage: c.stage, shift: c.shift })
  const title = (c: PortalClassInfo) => `${s.deptById(c.department_id)?.name ?? ''} — ${stageLabel(c.stage)} — ${SHIFT_LABEL[c.shift]}`

  const generate = async (c: PortalClassInfo) => {
    setBusy(`gen|${classId(c)}`)
    try {
      const r = await backend.portalGenerateAccounts(keyOf(c))
      toast.success(`أُنشئ ${r.created} حساب${r.linked ? `، واحتفظ ${r.linked} طالب بحسابه السابق` : ''}${historyText(r.history)}`)
      await refresh()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(null)
    }
  }

  const generateAll = async () => {
    const missing = classes.filter((c) => c.accounts < c.students && canCards(c))
    setBusy('gen-all')
    let created = 0
    let history = 0
    try {
      for (const c of missing) {
        const r = await backend.portalGenerateAccounts(keyOf(c))
        created += r.created
        history += r.history ?? 0
      }
      // حتى لو كانت الحسابات مكتملة: سجلات الطلبة في السنوات الأخرى تُربط بحساباتهم ليروا كل مراحلهم
      const scope = isHead ? s.profile.department_id : dept || null
      let linkError: unknown = null
      try {
        if (manage || isHead) history += (await backend.portalLinkHistory(scope)).linked
      } catch (e) {
        linkError = e // قاعدة بيانات لم تُحدَّث بعد: تُعرض الرسالة بعد نتيجة إنشاء الحسابات
      }
      if (created) toast.success(`أُنشئ ${created} حساب جديد${historyText(history)}`)
      else if (history) toast.success(`كل الطلبة لديهم حسابات${historyText(history)}`)
      else if (!linkError) toast.info('كل الطلبة لديهم حسابات، وسجلات السنوات الأخرى مربوطة')
      if (linkError) toast.error(linkError)
    } catch (e) {
      toast.error(e)
    } finally {
      await refresh()
      setBusy(null)
    }
  }

  /** يحسب النسخة التي سيراها كل طالب بالمحرك نفسه المستخدم في النتائج الرسمية */
  const snapshotsFor = async (c: PortalClassInfo, term: PortalTerm, kind: PortalKind) => {
    const k = keyOf(c)
    const [subjects, students] = await Promise.all([backend.listSubjects(k), backend.listStudents(k)])
    const grades = await backend.getGrades(subjects.map((x) => x.id))
    return buildPortalSnapshots(kind, term, subjects, students, grades, s.settings)
  }

  // المنشورات التي عُدّلت درجاتها بعد النشر (ويمكن تحديثها الآن)
  const staleList = useMemo(() => {
    if (!ov) return []
    return ov.publications.flatMap((p) => {
      const c = ov.classes.find((x) => classId(x) === classId(p))
      if (!c || (dept && c.department_id !== dept)) return []
      const changes = ov.changes.filter((x) => classId(x) === classId(c))
      const item = PORTAL_ITEMS.find((it) => it.term === p.term && it.kind === p.kind)
      return item && isStalePublication(p, changes) && !publishBlocker(p.kind, p.term, changes) ? [{ c, item }] : []
    })
  }, [ov, dept])

  // نتائج جاهزة للنشر (كل قوائمها معتمدة) ولم تُنشر بعد — تُنشر دفعة واحدة، وهو الأسهل للسنوات السابقة
  const readyResults = useMemo(() => {
    if (!ov) return []
    return classes.flatMap((c) => {
      const changes = ov.changes.filter((x) => classId(x) === classId(c))
      return PORTAL_ITEMS.filter(
        (it) => it.kind === 'results' && !publishBlocker(it.kind, it.term, changes) && !ov.publications.some((p) => classId(p) === classId(c) && p.term === it.term && p.kind === it.kind),
      ).map((item) => ({ c, item }))
    })
  }, [ov, classes])

  const publishReady = async () => {
    const ok = await confirm({
      title: 'نشر النتائج الجاهزة',
      message: (
        <div className="space-y-2">
          <p>
            ستُنشر للطلبة <b>{readyResults.length}</b> {readyResults.length === 1 ? 'نتيجة' : 'نتائج'} اعتُمدت كل قوائمها ولم تُنشر بعد في السنة الدراسية المختارة ({s.year?.label}):
          </p>
          <ul className="list-disc space-y-0.5 ps-5 text-muted">
            {readyResults.slice(0, 8).map(({ c, item }) => (
              <li key={`${classId(c)}|${item.term}`}>
                {item.label} — {title(c)}
              </li>
            ))}
            {readyResults.length > 8 && <li>و{readyResults.length - 8} أخرى…</li>}
          </ul>
          <p className="text-muted">يرى كل طالب تقديراته وحالته النهائية فقط (دون درجات). السعي لا يُنشر بهذا الزر.</p>
        </div>
      ),
      confirmText: 'نشر الكل',
    })
    if (!ok) return
    setBusy('ready-all')
    const base = `${window.location.origin}${window.location.pathname}`
    let done = 0
    try {
      for (const { c, item } of readyResults) {
        const snapshots = await snapshotsFor(c, item.term, item.kind)
        await backend.portalPublish({ ...keyOf(c), term: item.term, kind: item.kind, exam_url: base, snapshots })
        done++
      }
      toast.success(`نُشرت ${done} ${done === 1 ? 'نتيجة' : 'نتائج'} للطلبة`)
    } catch (e) {
      toast.error(e)
    } finally {
      await refresh()
      setBusy(null)
    }
  }

  const refreshStale = async () => {
    const ok = await confirm({
      title: 'تحديث كل ما تغيّر بعد النشر',
      message: (
        <div className="space-y-2">
          <p>
            سيُعاد نشر <b>{staleList.length}</b> {staleList.length === 1 ? 'عنصر' : 'عناصر'} عُدّلت درجاتها بعد النشر، ليرى الطلبة أحدث نسخة:
          </p>
          <ul className="list-disc space-y-0.5 ps-5 text-muted">
            {staleList.slice(0, 8).map(({ c, item }) => (
              <li key={`${classId(c)}|${item.term}|${item.kind}`}>
                {item.label} — {title(c)}
              </li>
            ))}
            {staleList.length > 8 && <li>و{staleList.length - 8} أخرى…</li>}
          </ul>
        </div>
      ),
      confirmText: 'تحديث الكل',
    })
    if (!ok) return
    setBusy('stale-all')
    const base = `${window.location.origin}${window.location.pathname}`
    let done = 0
    try {
      for (const { c, item } of staleList) {
        const snapshots = await snapshotsFor(c, item.term, item.kind)
        await backend.portalPublish({ ...keyOf(c), term: item.term, kind: item.kind, exam_url: base, snapshots })
        done++
      }
      toast.success(`حُدّث نشر ${done} ${done === 1 ? 'عنصر' : 'عناصر'}`)
    } catch (e) {
      toast.error(e)
    } finally {
      await refresh()
      setBusy(null)
    }
  }

  const publish = async (c: PortalClassInfo, term: PortalTerm, kind: PortalKind, label: string, republish: boolean) => {
    const id = `pub|${classId(c)}|${term}|${kind}`
    setBusy(id)
    try {
      const k = keyOf(c)
      const snapshots = await snapshotsFor(c, term, kind)
      const ok = await confirm({
        title: `${republish ? 'تحديث نشر' : 'نشر'} ${label}`,
        message: (
          <div className="space-y-2">
            <p>
              {title(c)} — <b>{snapshots.length}</b> طالب.
            </p>
            <p className="text-muted">
              {kind === 'coursework'
                ? 'سيرى كل طالب مجموع سعيه في كل مادة فقط (دون تفصيل النظري والعملي). المواد التي لم يُرصد سعيها تظهر «لم يُرصد بعد».'
                : 'سيرى كل طالب تقديراته وحالته النهائية فقط (دون درجات)، من القوائم المعتمدة.'}
            </p>
          </div>
        ),
        confirmText: republish ? 'تحديث النشر' : 'نشر للطلبة',
      })
      if (!ok) return
      const base = `${window.location.origin}${window.location.pathname}`
      const r = await backend.portalPublish({ ...k, term, kind, exam_url: base, snapshots })
      toast.success(`نُشر ${label} لـ ${r.students} طالب`)
      await refresh()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(null)
    }
  }

  const unpublish = async (c: PortalClassInfo, term: PortalTerm, kind: PortalKind, label: string) => {
    const ok = await confirm({ title: `سحب ${label}`, message: `لن يرى طلبة «${title(c)}» ${label} في البوابة حتى يُنشر مجدداً.`, confirmText: 'سحب النشر', danger: true })
    if (!ok) return
    setBusy(`pub|${classId(c)}|${term}|${kind}`)
    try {
      await backend.portalUnpublish(keyOf(c), term, kind)
      toast.success('سُحب النشر')
      await refresh()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(null)
    }
  }

  const withheld = (ov?.withheld ?? []).filter((w) => !dept || w.department_id === dept)

  if (q.isLoading) return <LoadingBlock />
  if (q.isError || !ov) return <Callout tone="danger">{errorText(q.error)}</Callout>

  return (
    <div>
      <div className="no-print space-y-6">
      <PageHeader
        title="بوابة الطلبة"
        subtitle="تطبيق مستقل للطلبة: يرى كل طالب سعيه ونتيجته بعد أن تنشرها اللجنة من هنا فقط"
        actions={
          ov.settings.portal_url && (
            <a href={ov.settings.portal_url} target="_blank" rel="noreferrer">
              <Button icon={<ExternalLink className="size-4" />}>فتح بوابة الطالب</Button>
            </a>
          )
        }
      />

      {!ov.settings.enabled && (
        <Callout tone="warning" icon={<AlertTriangle className="size-5" />} title="البوابة مغلقة مؤقتاً">
          لا يستطيع الطلبة الدخول حالياً. فعّلها من الإعدادات أدناه.
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="الطلبة" value={totals.students} hint="المستمرون في السنة المختارة" icon={<Users className="size-5" />} />
        <StatCard label="لديهم حساب دخول" value={totals.accounts} hint={totals.students ? `${Math.round((totals.accounts / totals.students) * 100)}% من الطلبة` : undefined} icon={<IdCard className="size-5" />} tone="info" />
        <StatCard label="دخلوا إلى البوابة" value={totals.loggedIn} hint="مرة واحدة على الأقل" icon={<Smartphone className="size-5" />} tone="success" />
        <StatCard label="المنشور للطلبة" value={totals.published} hint="سعي أو نتيجة لصف" icon={<Send className="size-5" />} tone="gold" />
      </div>

      {manage && <SettingsCard ov={ov} onSaved={refresh} />}

      <Card>
        <CardHeader
          title="الصفوف الدراسية"
          subtitle="أنشئ حسابات الطلبة واطبع بطاقاتهم، ثم انشر السعي والنتائج متى شئت"
          icon={<Smartphone className="size-5" />}
          actions={
            <>
              {!isHead && (
                <Select aria-label="القسم" className="w-auto min-w-48" value={dept} onChange={(e) => setDept(e.target.value)}>
                  <option value="">كل الأقسام</option>
                  {s.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
              {manage && readyResults.length > 0 && (
                <Button icon={<Send className="size-4" />} loading={busy === 'ready-all'} disabled={!!busy} onClick={publishReady}>
                  نشر النتائج الجاهزة ({readyResults.length})
                </Button>
              )}
              {manage && staleList.length > 0 && (
                <Button variant="primary" icon={<RefreshCw className="size-4" />} loading={busy === 'stale-all'} disabled={!!busy} onClick={refreshStale}>
                  تحديث ما تغيّر ({staleList.length})
                </Button>
              )}
              <Button icon={<UserPlus className="size-4" />} loading={busy === 'gen-all'} disabled={!!busy} onClick={generateAll}>
                إنشاء الحسابات الناقصة
              </Button>
            </>
          }
        />
        {classes.length === 0 ? (
          <EmptyState icon={<Users className="size-6" />} title="لا يوجد طلبة في السنة الدراسية المختارة" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>الصف الدراسي</th>
                  <th className="text-center">حسابات الطلبة</th>
                  {PORTAL_ITEMS.map((it) => (
                    <th key={`${it.kind}${it.term}`} className="text-center">
                      {it.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => {
                  const changes = ov.changes.filter((x) => classId(x) === classId(c))
                  return (
                    <tr key={classId(c)} className="align-top">
                      <td>
                        <div className="font-medium whitespace-nowrap">{s.deptById(c.department_id)?.name}</div>
                        <div className="text-xs text-muted">
                          {stageLabel(c.stage)} — {SHIFT_LABEL[c.shift]} · {c.students} طالب
                        </div>
                      </td>
                      <td className="text-center">
                        <div className={cx('text-sm font-semibold tabular-nums', c.accounts < c.students ? 'text-warning' : 'text-success')}>
                          {c.accounts} / {c.students}
                        </div>
                        <div className="mt-1 flex flex-wrap justify-center gap-1">
                          {c.accounts < c.students && canCards(c) && (
                            <Button size="sm" icon={<UserPlus className="size-3.5" />} loading={busy === `gen|${classId(c)}`} disabled={!!busy} onClick={() => generate(c)}>
                              إنشاء
                            </Button>
                          )}
                          {c.accounts > 0 && canCards(c) && (
                            <Button size="sm" variant="ghost" icon={<IdCard className="size-3.5" />} onClick={() => setCardsOf(c)}>
                              البطاقات
                            </Button>
                          )}
                        </div>
                        {c.logged_in > 0 && <div className="mt-1 text-[0.7rem] text-muted">دخل {c.logged_in}</div>}
                      </td>
                      {PORTAL_ITEMS.map((it) => (
                        <td key={`${it.kind}${it.term}`} className="text-center">
                          <PublishCell
                            pub={ov.publications.find((p) => classId(p) === classId(c) && p.term === it.term && p.kind === it.kind)}
                            changes={changes}
                            term={it.term}
                            kind={it.kind}
                            manage={manage}
                            busy={busy === `pub|${classId(c)}|${it.term}|${it.kind}`}
                            disabled={!!busy}
                            onPublish={(re) => publish(c, it.term, it.kind, it.label, re)}
                            onUnpublish={() => unpublish(c, it.term, it.kind, it.label)}
                          />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* النتائج المحجوبة مؤقتاً */}
      <Card>
        <CardHeader
          icon={<EyeOff className="size-5" />}
          title={`النتائج المحجوبة${withheld.length ? ` (${withheld.length})` : ''}`}
          subtitle="طالب تُحجب نتيجته لا يراها في البوابة ولا في صفحة التحقق حتى يُرفع الحجب؛ سعيه يبقى ظاهراً"
          actions={
            canViewAll(s.profile) && (
              <Link to="/students">
                <Button icon={<Search className="size-4" />}>حجب نتيجة طالب</Button>
              </Link>
            )
          }
        />
        {withheld.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">
            لا توجد نتائج محجوبة. لحجب نتيجة طالب: ابحث عنه وافتح صفحته ثم اضغط «حجب النتيجة».
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>الطالب</th>
                  <th>الصف الدراسي</th>
                  <th>الملاحظة الظاهرة للطالب</th>
                  <th>تاريخ الحجب</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {withheld.map((w) => (
                  <tr key={w.student_id}>
                    <td className="font-medium">
                      <Link to={`/student/${w.student_id}`} className="hover:text-primary-text hover:underline">
                        {w.full_name}
                      </Link>
                    </td>
                    <td className="text-sm text-muted">
                      {s.deptById(w.department_id)?.name} — {stageLabel(w.stage)} — {SHIFT_LABEL[w.shift]}
                    </td>
                    <td className="max-w-72 text-sm">{w.reason || <span className="text-faint">—</span>}</td>
                    <td className="text-sm whitespace-nowrap text-muted" title={w.by_name ?? undefined}>
                      {w.at ? fmtDateTime(w.at) : '—'}
                    </td>
                    <td className="text-end">
                      {canViewAll(s.profile) && (
                        <Button size="sm" icon={<Eye className="size-3.5" />} onClick={() => setLifting(w)}>
                          رفع الحجب
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Callout tone="info" title="كيف تعمل البوابة؟">
        <ul className="mt-1 list-disc space-y-1 ps-5">
          <li>البوابة تطبيق منفصل: الطالب لا يدخل إلى نظام اللجنة ولا يقرأ جداول الدرجات، بل نسخة جاهزة تُحفظ عند الضغط على «نشر».</li>
          <li>السعي يظهر للطالب كمجموع لكل مادة فقط، والنتيجة تظهر بالتقديرات والحالة النهائية دون درجات.</li>
          <li>إذا عُدّلت الدرجات بعد النشر تظهر علامة «تغيّرت بعد النشر»؛ اضغط «تحديث» لنشر النسخة الجديدة.</li>
          <li>لإعلان يظهر للطلبة: الإعلانات ← إعلان جديد ← يظهر لـ «الطلبة».</li>
          <li>
            يرى الطالب كل مراحله بحساب واحد: سجلاته في السنوات الأخرى تُربط بحسابه تلقائياً (بالرقم الجامعي أو بالاسم في القسم نفسه). لنشر نتائج سنة سابقة اختر السنة الدراسية من أعلى الصفحة
            ثم اضغط «نشر النتائج الجاهزة».
          </li>
        </ul>
      </Callout>
      </div>

      {lifting && (
        <WithholdDialog student={{ id: lifting.student_id, full_name: lifting.full_name, result_withheld: true, withheld_reason: lifting.reason }} onClose={() => setLifting(null)} onDone={refresh} />
      )}
      {cardsOf && <CardsModal cls={cardsOf} classKey={keyOf(cardsOf)} title={title(cardsOf)} portalUrl={ov.settings.portal_url} onClose={() => setCardsOf(null)} onChanged={refresh} />}
    </div>
  )
}

function PublishCell({
  pub,
  changes,
  term,
  kind,
  manage,
  busy,
  disabled,
  onPublish,
  onUnpublish,
}: {
  pub: PortalPublication | undefined
  changes: PortalChange[]
  term: PortalTerm
  kind: PortalKind
  manage: boolean
  busy: boolean
  disabled: boolean
  onPublish: (republish: boolean) => void
  onUnpublish: () => void
}) {
  const blocker = publishBlocker(kind, term, changes)
  const stale = isStalePublication(pub, changes)
  if (pub) {
    return (
      <div className="flex flex-col items-center gap-1">
        <Badge tone={stale ? 'warning' : 'success'} icon={stale ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}>
          {stale ? 'تغيّرت بعد النشر' : 'منشور'}
        </Badge>
        <div className="text-[0.7rem] leading-tight text-muted" title={pub.published_by_name ?? undefined}>
          {fmtDateTime(pub.published_at)} · {pub.students} طالب
        </div>
        {manage && (
          <div className="flex gap-1">
            <Button size="sm" variant={stale ? 'primary' : 'ghost'} icon={<RefreshCw className="size-3.5" />} loading={busy} disabled={disabled || !!blocker} title={blocker ?? undefined} onClick={() => onPublish(true)}>
              تحديث
            </Button>
            <Button size="sm" variant="danger-soft" icon={<Undo2 className="size-3.5" />} disabled={disabled} onClick={onUnpublish}>
              سحب
            </Button>
          </div>
        )}
      </div>
    )
  }
  if (blocker) return <span className="text-xs text-faint">{blocker}</span>
  if (!manage) return <span className="text-xs text-muted">لم يُنشر</span>
  return (
    <Button size="sm" icon={<Send className="size-3.5" />} loading={busy} disabled={disabled} onClick={() => onPublish(false)}>
      نشر
    </Button>
  )
}

function SettingsCard({ ov, onSaved }: { ov: PortalOverview; onSaved: () => unknown }) {
  const toast = useToast()
  const suggested = useMemo(() => (/\.github\.io$/.test(window.location.hostname) ? `${window.location.origin}/student-results/` : ''), [])
  const [enabled, setEnabled] = useState(ov.settings.enabled)
  const [url, setUrl] = useState(ov.settings.portal_url ?? '')
  const [notice, setNotice] = useState(ov.settings.notice ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setEnabled(ov.settings.enabled)
    setUrl(ov.settings.portal_url ?? '')
    setNotice(ov.settings.notice ?? '')
  }, [ov.settings])
  const dirty = enabled !== ov.settings.enabled || url.trim() !== (ov.settings.portal_url ?? '') || notice.trim() !== (ov.settings.notice ?? '')
  const save = async () => {
    const u = url.trim()
    if (u && !/^https?:\/\//i.test(u)) return toast.error('رابط البوابة يجب أن يبدأ بـ https://')
    setSaving(true)
    try {
      await backend.portalSaveSettings({ enabled, portal_url: u || null, notice: notice.trim() || null, exam_url: `${window.location.origin}${window.location.pathname}` })
      toast.success('حُفظت إعدادات البوابة')
      await onSaved()
    } catch (e) {
      toast.error(e)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Card>
      <CardHeader
        title="إعدادات البوابة"
        icon={<Smartphone className="size-5" />}
        actions={
          <Button variant="primary" size="sm" icon={<Save className="size-4" />} loading={saving} disabled={!dirty} onClick={save}>
            حفظ
          </Button>
        }
      />
      <div className="grid gap-4 p-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-4 py-3">
            <div>
              <div className="font-medium">البوابة مفتوحة للطلبة</div>
              <div className="text-xs text-muted">عند الإيقاف لا يستطيع أي طالب الدخول، ولا يُحذف شيء مما نُشر.</div>
            </div>
            <Switch checked={enabled} onChange={setEnabled} label="البوابة مفتوحة للطلبة" />
          </div>
          <Field label="رابط بوابة الطالب" hint="يُطبع في بطاقات الدخول ويُشفَّر في رمز QR للدخول المباشر">
            <Input dir="ltr" placeholder={suggested || 'https://…/student-results/'} value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          {!url && suggested && (
            <button type="button" className="text-xs text-primary-text hover:underline" onClick={() => setUrl(suggested)}>
              استخدام الرابط المقترح: <span dir="ltr">{suggested}</span>
            </button>
          )}
        </div>
        <Field label="رسالة للطلبة (اختياري)" hint="تظهر في الصفحة الرئيسية للبوابة، مثل موعد إعلان النتائج">
          <Textarea rows={5} value={notice} onChange={(e) => setNotice(e.target.value)} placeholder="مثال: تُعلن نتائج الفصل الأول يوم الخميس القادم بإذن الله." />
        </Field>
      </div>
    </Card>
  )
}

function CardsModal({ cls, classKey, title, portalUrl, onClose, onChanged }: { cls: PortalClassInfo; classKey: ClassKey; title: string; portalUrl: string | null; onClose: () => void; onChanged: () => unknown }) {
  const s = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const printing = usePrinting()
  const [resetting, setResetting] = useState<string | null>(null)
  const [only, setOnly] = useState<Set<string> | null>(null)
  const q = useQuery({ queryKey: ['portal-cards', classKey], queryFn: () => backend.portalCards(classKey) })
  const cards = q.data ?? []
  const toPrint = only ? cards.filter((c) => only.has(c.student_id)) : cards.filter((c) => c.code)
  const meta = `${s.deptById(cls.department_id)?.name ?? ''} — ${stageLabel(cls.stage)} — ${SHIFT_LABEL[cls.shift]}`

  const reset = async (c: PortalCard) => {
    const ok = await confirm({ title: 'إعادة تعيين الرمز السري', message: `سيُلغى الرمز الحالي للطالب «${c.full_name}» ويُولَّد رمز جديد يُطبع في بطاقة جديدة.`, confirmText: 'إعادة التعيين' })
    if (!ok) return
    setResetting(c.student_id)
    try {
      await backend.portalResetCode(c.student_id)
      toast.success('وُلِّد رمز جديد — اطبع بطاقة الطالب')
      await q.refetch()
      await onChanged()
    } catch (e) {
      toast.error(e)
    } finally {
      setResetting(null)
    }
  }
  const print = (ids: Set<string> | null) => {
    setOnly(ids)
    void backend.logEvent('report.print', `طباعة بطاقات بوابة الطالب — ${title}`)
    // ينتظر تحديث قائمة الطباعة قبل فتح نافذة الطباعة
    setTimeout(printPage, 50)
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={`بطاقات الدخول — ${title}`}
        size="xl"
        footer={
          <>
            <Button onClick={onClose}>إغلاق</Button>
            <Button variant="primary" icon={<Printer className="size-4" />} disabled={!cards.some((c) => c.code)} onClick={() => print(null)}>
              طباعة البطاقات ({cards.filter((c) => c.code).length})
            </Button>
          </>
        }
      >
        {!portalUrl && (
          <Callout tone="warning" className="mb-3">
            لم يُحدَّد رابط البوابة بعد، فلن يظهر رمز QR في البطاقات. حدّده من «إعدادات البوابة».
          </Callout>
        )}
        {q.isLoading ? (
          <LoadingBlock />
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-10 text-center">ت</th>
                  <th>اسم الطالب</th>
                  <th className="text-center">رقم الدخول</th>
                  <th className="text-center">الرمز السري</th>
                  <th className="text-center">آخر دخول</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.student_id}>
                    <td className="text-center text-xs tabular-nums text-muted">{c.seq}</td>
                    <td className="font-medium">{c.full_name}</td>
                    <td className="text-center font-mono tabular-nums" dir="ltr">
                      {c.login_id}
                    </td>
                    <td className="text-center font-mono tabular-nums" dir="ltr">
                      {c.code ? `${c.code.slice(0, 4)} ${c.code.slice(4)}` : <span className="font-sans text-xs text-muted">غيّره الطالب</span>}
                    </td>
                    <td className="text-center text-xs text-muted">{c.last_login_at ? fmtDateTime(c.last_login_at) : 'لم يدخل بعد'}</td>
                    <td className="text-end whitespace-nowrap">
                      {c.code && (
                        <Button size="sm" variant="ghost" icon={<Printer className="size-3.5" />} onClick={() => print(new Set([c.student_id]))}>
                          بطاقة
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} loading={resetting === c.student_id} onClick={() => reset(c)}>
                        رمز جديد
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
      {printing && (
        <div className="print-only">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7mm 6mm' }}>
            {toPrint.map((c) => (
              <AccessCard key={c.student_id} card={c} meta={meta} college={s.settings.college_name} university={s.settings.university_name} portalUrl={portalUrl} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

const NAVY = '#14284b'
const GOLD = '#b8913a'

/** بطاقة دخول الطالب (8 بطاقات في صفحة A4): كحلي وذهبي مع رمز QR للدخول المباشر */
function AccessCard({ card, meta, college, university, portalUrl }: { card: PortalCard; meta: string; college: string; university: string; portalUrl: string | null }) {
  const link = portalLoginUrl(portalUrl, card.login_id, card.code)
  const box = { border: `1px solid ${GOLD}`, borderRadius: '6px', padding: '3px 4px', background: '#fbf8f1', textAlign: 'center' as const, flex: 1 }
  const digits = { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '11.5pt', fontWeight: 700, letterSpacing: '0.4px', color: NAVY, direction: 'ltr' as const, whiteSpace: 'nowrap' as const }
  return (
    <div style={{ border: `1.2px solid ${NAVY}`, borderRadius: '10px', overflow: 'hidden', breakInside: 'avoid', height: '62mm', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ background: NAVY, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px', borderBottom: `2.5px solid ${GOLD}` }}>
        <img src="./logo.png" alt="" style={{ width: '30px', height: '30px', borderRadius: '50%', background: '#fff', padding: '1px' }} />
        <div style={{ lineHeight: 1.35, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '11pt' }}>بوابة الطالب</div>
          <div style={{ fontSize: '7.5pt', opacity: 0.85 }}>
            {college} — {university}
          </div>
        </div>
        <div style={{ fontSize: '7pt', color: GOLD, fontWeight: 700 }}>بطاقة دخول</div>
      </div>
      <div style={{ display: 'flex', gap: '8px', padding: '6px 10px', flex: 1, alignItems: 'stretch' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '11pt', color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.full_name}</div>
            <div style={{ fontSize: '8pt', color: '#555' }}>{meta}</div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <div style={box}>
              <div style={{ fontSize: '7pt', color: '#6b5a2a' }}>رقم الدخول</div>
              <div style={digits}>{card.login_id}</div>
            </div>
            <div style={box}>
              <div style={{ fontSize: '7pt', color: '#6b5a2a' }}>الرمز السري</div>
              <div style={digits}>{card.code ? `${card.code.slice(0, 4)} ${card.code.slice(4)}` : '••••'}</div>
            </div>
          </div>
        </div>
        {link && (
          <div style={{ width: '24mm', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <QrCode value={link} className="" />
            <div style={{ fontSize: '6.5pt', color: '#555', marginTop: '1px' }}>امسح للدخول مباشرة</div>
          </div>
        )}
      </div>
      <div style={{ borderTop: '1px solid #e3e3e3', padding: '3px 10px', fontSize: '7pt', color: '#555', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ whiteSpace: 'nowrap' }}>بطاقة شخصية · غيّر رمزك من «حسابي»</span>
        {portalUrl && (
          <span dir="ltr" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {portalUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
          </span>
        )}
      </div>
    </div>
  )
}
