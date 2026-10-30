import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { backend } from '../data'
import type { AcademicYear, Department, Profile, Settings } from '../lib/types'

export interface Session {
  profile: Profile
  settings: Settings
  departments: Department[]
  years: AcademicYear[]
  profiles: Profile[]
  yearId: string
  year: AcademicYear | undefined
  setYearId: (id: string) => void
  deptById: (id: string | null | undefined) => Department | undefined
  profileById: (id: string | null | undefined) => Profile | undefined
  signOut: (reason?: string) => Promise<void>
  setProfile: (p: Profile) => void
}

const Ctx = createContext<Session | null>(null)

export function useSession(): Session {
  const s = useContext(Ctx)
  if (!s) throw new Error('SessionProvider missing')
  return s
}

const YEAR_KEY = 'exam.year'

export function SessionProvider({
  profile,
  onSignedOut,
  setProfile,
  children,
  fallback,
}: {
  profile: Profile
  onSignedOut: (reason?: string) => void
  setProfile: (p: Profile) => void
  children: ReactNode
  fallback: ReactNode
}) {
  const qc = useQueryClient()
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: () => backend.getSettings() })
  const deptsQ = useQuery({ queryKey: ['departments'], queryFn: () => backend.listDepartments() })
  const yearsQ = useQuery({ queryKey: ['years'], queryFn: () => backend.listYears() })
  const profilesQ = useQuery({ queryKey: ['profiles'], queryFn: () => backend.listProfiles() })

  const [yearPref, setYearPref] = useState<string | null>(() => {
    try {
      return localStorage.getItem(YEAR_KEY)
    } catch {
      return null
    }
  })

  const years = yearsQ.data ?? []
  const settings = settingsQ.data
  const yearId =
    (yearPref && years.some((y) => y.id === yearPref) ? yearPref : null) ??
    (settings?.current_year_id && years.some((y) => y.id === settings.current_year_id) ? settings.current_year_id : null) ??
    years[years.length - 1]?.id ??
    ''

  const setYearId = useCallback((id: string) => {
    setYearPref(id)
    try {
      localStorage.setItem(YEAR_KEY, id)
    } catch {
      /* ignore */
    }
  }, [])

  const signOut = useCallback(
    async (reason?: string) => {
      try {
        await backend.signOut()
      } finally {
        qc.clear()
        onSignedOut(reason)
      }
    },
    [qc, onSignedOut],
  )

  // الخروج التلقائي بعد فترة خمول
  const idleMinutes = settings?.idle_minutes ?? 60
  const lastActive = useRef(Date.now())
  useEffect(() => {
    const mark = () => (lastActive.current = Date.now())
    const evts = ['mousedown', 'keydown', 'touchstart', 'wheel'] as const
    evts.forEach((e) => window.addEventListener(e, mark, { passive: true }))
    const timer = setInterval(() => {
      if (Date.now() - lastActive.current > idleMinutes * 60_000) {
        void signOut('تم تسجيل الخروج تلقائياً بسبب عدم النشاط.')
      }
    }, 30_000)
    return () => {
      evts.forEach((e) => window.removeEventListener(e, mark))
      clearInterval(timer)
    }
  }, [idleMinutes, signOut])

  useEffect(() => backend.onAuthLost(() => onSignedOut('انتهت الجلسة. يرجى تسجيل الدخول مجدداً.')), [onSignedOut])

  const value = useMemo<Session | null>(() => {
    if (!settings || !deptsQ.data || !yearsQ.data || !profilesQ.data) return null
    const depts = deptsQ.data
    const profiles = profilesQ.data
    return {
      profile,
      settings,
      departments: depts,
      years: yearsQ.data,
      profiles,
      yearId,
      year: yearsQ.data.find((y) => y.id === yearId),
      setYearId,
      deptById: (id) => depts.find((d) => d.id === id),
      profileById: (id) => profiles.find((p) => p.id === id),
      signOut,
      setProfile,
    }
  }, [profile, settings, deptsQ.data, yearsQ.data, profilesQ.data, yearId, setYearId, signOut, setProfile])

  const error = settingsQ.error || deptsQ.error || yearsQ.error || profilesQ.error
  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="card max-w-md p-6 text-center">
          <h2 className="font-semibold text-danger">تعذر تحميل البيانات</h2>
          <p className="mt-2 text-sm text-muted">{(error as Error).message}</p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="rounded-lg bg-primary px-4 py-2 text-sm text-white" onClick={() => qc.invalidateQueries()}>
              إعادة المحاولة
            </button>
            <button className="rounded-lg border border-line px-4 py-2 text-sm" onClick={() => void signOut()}>
              تسجيل الخروج
            </button>
          </div>
        </div>
      </div>
    )
  }
  if (!value) return <>{fallback}</>
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
