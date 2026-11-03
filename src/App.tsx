import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './app/Layout'
import { SessionProvider } from './app/session'
import { FeedbackProvider } from './components/feedback'
import { RouteError, clearChunkReloadFlag } from './components/RouteError'
import { LoadingBlock } from './components/ui'
import { UpdateBanner } from './components/UpdateBanner'
import { backend } from './data'
import type { Profile } from './lib/types'
import { ClassPage } from './pages/ClassPage'
import { DashboardPage } from './pages/DashboardPage'
import { DepartmentPage, DepartmentsPage } from './pages/DepartmentsPage'
import { GradeSheetPage } from './pages/GradeSheetPage'
import { LoginPage } from './pages/LoginPage'
import { MySubjectsPage } from './pages/MySubjectsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ReviewPage } from './pages/ReviewPage'

// الصفحات الأقل استخداماً تُحمَّل عند فتحها أول مرة فقط (تصغير حجم التحميل الأول وتسريع فتح التطبيق)
const AnnouncementsPage = lazy(() => import('./pages/AnnouncementsPage').then((m) => ({ default: m.AnnouncementsPage })))
const AuditPage = lazy(() => import('./pages/AuditPage').then((m) => ({ default: m.AuditPage })))
const ControlPage = lazy(() => import('./pages/ControlPage').then((m) => ({ default: m.ControlPage })))
const CurriculumPage = lazy(() => import('./pages/CurriculumPage').then((m) => ({ default: m.CurriculumPage })))
const ProgressPage = lazy(() => import('./pages/ProgressPage').then((m) => ({ default: m.ProgressPage })))
const ResultsBatchPage = lazy(() => import('./pages/ResultsBatchPage').then((m) => ({ default: m.ResultsBatchPage })))
const ResultsPage = lazy(() => import('./pages/ResultsPage').then((m) => ({ default: m.ResultsPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const StudentPage = lazy(() => import('./pages/StudentPage').then((m) => ({ default: m.StudentPage })))
const StudentsSearchPage = lazy(() => import('./pages/StudentsSearchPage').then((m) => ({ default: m.StudentsSearchPage })))
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })))
const StatisticsPage = lazy(() => import('./pages/StatisticsPage').then((m) => ({ default: m.StatisticsPage })))
const VerifyPage = lazy(() => import('./pages/VerifyPage').then((m) => ({ default: m.VerifyPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
})

const router = createHashRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      {
        // أخطاء الصفحات تظهر داخل الواجهة مع بقاء القائمة الجانبية
        errorElement: <RouteError />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'my-subjects', element: <MySubjectsPage /> },
          { path: 'departments', element: <DepartmentsPage /> },
          { path: 'departments/:deptId', element: <DepartmentPage /> },
          { path: 'departments/:deptId/plan', element: <CurriculumPage /> },
          { path: 'class/:deptId/:stage/:shift', element: <ClassPage /> },
          { path: 'class/:deptId/:stage/:shift/results', element: <ResultsBatchPage /> },
          { path: 'students', element: <StudentsSearchPage /> },
          { path: 'student/:studentId', element: <StudentPage /> },
          { path: 'subjects/:subjectId', element: <GradeSheetPage /> },
          { path: 'review', element: <ReviewPage /> },
          { path: 'results', element: <ResultsPage /> },
          { path: 'announcements', element: <AnnouncementsPage /> },
          { path: 'progress', element: <ProgressPage /> },
          { path: 'statistics', element: <StatisticsPage /> },
          { path: 'control', element: <ControlPage /> },
          { path: 'users', element: <UsersPage /> },
          { path: 'audit', element: <AuditPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])

type AuthState = { status: 'loading' } | { status: 'out'; notice?: string | null } | { status: 'in'; profile: Profile }

// صفحة التحقق من النتيجة عامة (يفتحها رمز QR المطبوع) ولا تتطلب تسجيل الدخول
const verifyCodeOf = (hash: string) => /^#\/verify\/([0-9A-Za-z-]{8,40})\/?$/.exec(hash)?.[1] ?? null

export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [verifyCode, setVerifyCode] = useState(() => verifyCodeOf(window.location.hash))
  useEffect(() => {
    const onHash = () => setVerifyCode(verifyCodeOf(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const t = setTimeout(clearChunkReloadFlag, 10_000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    backend
      .currentProfile()
      .then((p) => setAuth(p ? { status: 'in', profile: p } : { status: 'out' }))
      .catch(() => setAuth({ status: 'out' }))
  }, [])

  const onSignedOut = useCallback((notice?: string) => {
    queryClient.clear()
    setAuth({ status: 'out', notice })
  }, [])
  const setProfile = useCallback((p: Profile) => setAuth({ status: 'in', profile: p }), [])

  if (verifyCode) {
    return (
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<LoadingBlock />}>
          <VerifyPage code={verifyCode} />
        </Suspense>
      </QueryClientProvider>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        {auth.status === 'loading' && (
          <div className="flex min-h-dvh items-center justify-center">
            <LoadingBlock />
          </div>
        )}
        {auth.status === 'out' && (
          <LoginPage
            notice={auth.notice}
            onLogin={(p) => {
              if (window.location.hash && window.location.hash !== '#/') window.location.hash = '#/'
              setAuth({ status: 'in', profile: p })
            }}
          />
        )}
        {auth.status === 'in' && (
          <SessionProvider
            key={auth.profile.id}
            profile={auth.profile}
            onSignedOut={onSignedOut}
            setProfile={setProfile}
            fallback={
              <div className="flex min-h-dvh items-center justify-center">
                <LoadingBlock />
              </div>
            }
          >
            <RouterProvider router={router} />
          </SessionProvider>
        )}
        <UpdateBanner />
      </FeedbackProvider>
    </QueryClientProvider>
  )
}
