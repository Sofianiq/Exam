import { useQuery } from '@tanstack/react-query'
import {
  Award,
  BookOpenCheck,
  Building2,
  ClipboardCheck,
  Download,
  FileBarChart2,
  History,
  KeyRound,
  LayoutDashboard,
  Lock,
  LockOpen,
  LogOut,
  Megaphone,
  Menu,
  Moon,
  Settings as SettingsIcon,
  UserSearch,
  Sun,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnnouncementBanner } from '../components/AnnouncementBanner'
import { ChangePasswordDialog } from '../components/ChangePasswordDialog'
import { useConfirm, useToast } from '../components/feedback'
import { Badge, IconButton, Select, cx } from '../components/ui'
import { backend, isDemo } from '../data'
import { displayName, yearLabel } from '../lib/format'
import { ROLE_LABEL, SHIFT_LABEL, TERM_LABEL, stageShort } from '../lib/labels'
import { canEditSettings, canManageUsers, canReview, canSeeAudit, canToggleEntry, canViewAll } from '../lib/perm'
import { isActive, useAnnouncements, useSeenAnnouncements } from './announcements'
import { useSubjects } from './queries'
import { useInstallPrompt, useTheme } from './hooks'
import { useSession } from './session'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  badge?: number
  end?: boolean
}

export function Layout() {
  const s = useSession()
  const { profile } = s
  const [open, setOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(profile.must_change_password)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])

  const progressQ = useQuery({
    queryKey: ['progress', s.yearId],
    queryFn: () => backend.listProgress(s.yearId),
    enabled: !!s.yearId && canReview(profile),
  })
  const pendingReview = progressQ.data?.filter((p) => p.status === 'submitted' || (p.status === 'approved' && p.r2_status === 'submitted')).length ?? 0
  const annQ = useAnnouncements()
  const { seen } = useSeenAnnouncements(profile.id)
  const unreadAnn = (annQ.data ?? []).filter((a) => isActive(a) && !seen.has(a.id)).length

  const items: NavItem[] = [{ to: '/', label: 'لوحة المتابعة', icon: <LayoutDashboard className="size-4.5" />, end: true }]
  items.push({ to: '/announcements', label: 'الإعلانات', icon: <Megaphone className="size-4.5" />, badge: unreadAnn })
  if (profile.role === 'teacher') items.push({ to: '/my-subjects', label: 'موادي الدراسية', icon: <BookOpenCheck className="size-4.5" /> })
  if (canViewAll(profile)) items.push({ to: '/departments', label: 'الأقسام العلمية', icon: <Building2 className="size-4.5" /> })
  if (profile.role === 'head' && profile.department_id)
    items.push({ to: `/departments/${profile.department_id}`, label: 'قسمي', icon: <Building2 className="size-4.5" /> })
  if (canSeeAudit(profile)) items.push({ to: '/students', label: 'البحث عن طالب', icon: <UserSearch className="size-4.5" /> })
  if (canSeeAudit(profile)) items.push({ to: '/results', label: 'النتائج', icon: <Award className="size-4.5" /> })
  if (canReview(profile)) items.push({ to: '/review', label: 'التدقيق والاعتماد', icon: <ClipboardCheck className="size-4.5" />, badge: pendingReview })
  if (canViewAll(profile) || profile.role === 'head') items.push({ to: '/progress', label: 'تقرير الإنجاز', icon: <FileBarChart2 className="size-4.5" /> })
  if (canToggleEntry(profile)) items.push({ to: '/control', label: 'التحكم بالإدخال', icon: <Lock className="size-4.5" /> })
  if (canManageUsers(profile)) items.push({ to: '/users', label: 'المستخدمون', icon: <Users className="size-4.5" /> })
  if (canSeeAudit(profile)) items.push({ to: '/audit', label: 'سجل العمليات', icon: <History className="size-4.5" /> })
  if (canEditSettings(profile)) items.push({ to: '/settings', label: 'الإعدادات', icon: <SettingsIcon className="size-4.5" /> })

  return (
    <div className="app-shell min-h-dvh lg:ps-68">
      {/* الشريط الجانبي */}
      <aside
        className={cx(
          'no-print fixed inset-y-0 start-0 z-40 flex w-68 flex-col text-white transition-transform lg:translate-x-0',
          'bg-gradient-to-b from-[var(--sidebar-from)] to-[var(--sidebar-to)]',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
          <img src="./logo.png" alt="شعار الكلية" className="size-12 shrink-0 rounded-full bg-white/95 p-0.5 shadow" />
          <div className="min-w-0">
            <div className="text-[0.95rem] font-bold leading-tight">اللجنة الامتحانية</div>
            <div className="mt-0.5 text-[0.7rem] leading-snug text-white/70">{s.settings.college_name}</div>
          </div>
          <button className="ms-auto rounded-md p-1.5 text-white/70 hover:bg-white/10 lg:hidden" onClick={() => setOpen(false)} aria-label="إغلاق القائمة">
            <X className="size-5" />
          </button>
        </div>
        <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                cx(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition',
                  isActive ? 'bg-white/12 font-semibold text-white' : 'text-white/75 hover:bg-white/7 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-y-2 start-0 w-1 rounded-full bg-[var(--gold)]" />}
                  {it.icon}
                  <span className="flex-1">{it.label}</span>
                  {!!it.badge && <span className="rounded-full bg-[var(--gold)] px-2 py-0.5 text-[0.7rem] font-bold text-white">{it.badge}</span>}
                </>
              )}
            </NavLink>
          ))}
          <TeachingNav />
        </nav>
        <div className="border-t border-white/10 px-4 py-3 text-[0.7rem] leading-relaxed text-white/55">
          {s.settings.university_name}
          <br />
          <span className="text-white/70">إعداد وتطوير: م.م سفيان محمد</span>
          <br />© {new Date().getFullYear()} — نظام إدارة اللجنة الامتحانية
        </div>
      </aside>
      {open && <div className="no-print fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      <Topbar onMenu={() => setOpen(true)} onChangePassword={() => setPwOpen(true)} />
      <AnnouncementBanner />
      {isDemo && (
        <div className="no-print border-b border-gold/30 bg-gold-soft px-4 py-2 text-center text-xs text-gold-text sm:px-6">
          <b>وضع تجريبي:</b> البيانات وهمية ومحفوظة في هذا المتصفح فقط. لربط النظام بقاعدة البيانات الحقيقية راجع دليل التشغيل (README).
        </div>
      )}
      <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
      <ChangePasswordDialog open={pwOpen} forced={profile.must_change_password} onClose={() => setPwOpen(false)} />
    </div>
  )
}

/** أقسام التدريسي وموادّه في السنة الحالية (قد تكون في أكثر من قسم) */
function TeachingNav() {
  const s = useSession()
  const { profile } = s
  const teaches = profile.role === 'teacher' || profile.role === 'head'
  const q = useSubjects({ year_id: s.yearId, teacher_id: profile.id }, teaches)
  const subjects = q.data ?? []
  if (!teaches || (profile.role === 'head' && subjects.length === 0)) return null
  const deptIds = [...new Set([...(profile.role === 'teacher' ? [profile.department_id, ...profile.extra_department_ids] : []), ...subjects.map((x) => x.department_id)])].filter(
    (d): d is string => !!d && !!s.deptById(d),
  )
  if (deptIds.length === 0) return null
  return (
    <div className="mt-4 border-t border-white/10 pt-3" data-teaching-nav>
      <div className="px-3 pb-1.5 text-[0.68rem] font-semibold text-white/50">{profile.role === 'head' ? 'موادي التدريسية' : 'أقسامي وموادي'}</div>
      {deptIds.map((d) => {
        const list = subjects
          .filter((x) => x.department_id === d)
          .sort((a, b) => a.stage - b.stage || a.shift.localeCompare(b.shift) || a.term - b.term || a.sort - b.sort)
        return (
          <div key={d} className="mb-2">
            <div className="flex items-center gap-2 px-3 py-1.5 text-[0.78rem] font-semibold text-[var(--gold)]">
              <Building2 className="size-3.5 shrink-0" />
              <span className="truncate">قسم {s.deptById(d)?.name}</span>
            </div>
            {list.length === 0 ? (
              <div className="px-3 py-1 ps-8 text-[0.7rem] text-white/45">لا مواد مسندة في هذه السنة</div>
            ) : (
              list.map((x) => (
                <NavLink
                  key={x.id}
                  to={`/subjects/${x.id}`}
                  className={({ isActive }) =>
                    cx('block rounded-md px-3 py-1.5 ps-8 text-[0.8rem] leading-snug transition', isActive ? 'bg-white/12 text-white' : 'text-white/70 hover:bg-white/7 hover:text-white')
                  }
                >
                  <span className="block truncate">{x.name}</span>
                  <span className="block text-[0.65rem] text-white/45">
                    {stageShort(x.stage)} · {SHIFT_LABEL[x.shift]} · {TERM_LABEL[x.term]}
                  </span>
                </NavLink>
              ))
            )}
          </div>
        )
      })}
    </div>
  )
}

function Topbar({ onMenu, onChangePassword }: { onMenu: () => void; onChangePassword: () => void }) {
  const s = useSession()
  const { profile, settings } = s
  const theme = useTheme()
  const pwa = useInstallPrompt()
  const confirm = useConfirm()
  const toast = useToast()
  const nav = useNavigate()
  const [menu, setMenu] = useState(false)
  const dept = s.deptById(profile.department_id)
  const open = settings.entry_open

  return (
    <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-2 px-3 sm:gap-3 sm:px-6 lg:px-8">
        <IconButton label="القائمة" className="lg:hidden" onClick={onMenu}>
          <Menu className="size-5" />
        </IconButton>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted sm:inline">السنة الدراسية</span>
          <Select
            aria-label="السنة الدراسية"
            value={s.yearId}
            onChange={(e) => s.setYearId(e.target.value)}
            className="h-9 w-auto py-1 font-semibold tabular-nums"
          >
            {s.years.map((y) => (
              <option key={y.id} value={y.id}>
                {yearLabel(y.label)}
              </option>
            ))}
          </Select>
        </div>
        <button
          type="button"
          onClick={async () => {
            if (!canToggleEntry(profile)) return
            nav('/control')
          }}
          title={canToggleEntry(profile) ? 'إدارة فتح وغلق الإدخال' : undefined}
          className={cx('hidden sm:inline-flex', canToggleEntry(profile) ? 'cursor-pointer' : 'cursor-default')}
        >
          {open ? (
            <Badge tone="success" icon={<LockOpen className="size-3.5" />}>
              إدخال الدرجات مفتوح
            </Badge>
          ) : (
            <Badge tone="danger" icon={<Lock className="size-3.5" />}>
              إدخال الدرجات مغلق
            </Badge>
          )}
        </button>

        <div className="ms-auto flex items-center gap-1">
          {pwa.canInstall && (
            <IconButton label="تثبيت التطبيق على الجهاز" onClick={() => void pwa.install()}>
              <Download className="size-4.5" />
            </IconButton>
          )}
          <IconButton label={theme.dark ? 'الوضع النهاري' : 'الوضع الليلي'} onClick={theme.toggle}>
            {theme.dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
          </IconButton>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-start hover:bg-surface-2"
              aria-haspopup="menu"
              aria-expanded={menu}
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-primary-soft font-bold text-primary-text">
                {profile.full_name.trim().charAt(0)}
              </span>
              <span className="hidden min-w-0 leading-tight md:block">
                <span className="block max-w-44 truncate text-sm font-semibold">{displayName(profile)}</span>
                <span className="block text-xs text-muted">
                  {ROLE_LABEL[profile.role]}
                  {dept ? ` — ${dept.name}` : ''}
                </span>
              </span>
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div role="menu" className="absolute end-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop">
                  <div className="border-b border-line px-4 py-2.5 md:hidden">
                    <div className="truncate text-sm font-semibold">{displayName(profile)}</div>
                    <div className="text-xs text-muted">{ROLE_LABEL[profile.role]}</div>
                  </div>
                  <div className="px-4 py-2 text-xs text-muted" dir="ltr">
                    {profile.username}
                  </div>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-surface-2"
                    onClick={() => {
                      setMenu(false)
                      onChangePassword()
                    }}
                  >
                    <KeyRound className="size-4 text-muted" /> تغيير كلمة المرور
                  </button>
                  <button
                    role="menuitem"
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-danger hover:bg-danger-soft"
                    onClick={async () => {
                      setMenu(false)
                      if (await confirm({ title: 'تسجيل الخروج', message: 'هل تريد تسجيل الخروج من النظام؟', confirmText: 'خروج' })) {
                        await s.signOut()
                        toast.info('تم تسجيل الخروج')
                      }
                    }}
                  >
                    <LogOut className="size-4" /> تسجيل الخروج
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
