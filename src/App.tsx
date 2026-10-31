import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './app/Layout'
import { SessionProvider } from './app/session'
import { FeedbackProvider } from './components/feedback'
import { LoadingBlock } from './components/ui'
import { UpdateBanner } from './components/UpdateBanner'
import { backend } from './data'
import type { Profile } from './lib/types'
import { AnnouncementsPage } from './pages/AnnouncementsPage'
import { AuditPage } from './pages/AuditPage'
import { ClassPage } from './pages/ClassPage'
import { ControlPage } from './pages/ControlPage'
import { CurriculumPage } from './pages/CurriculumPage'
import { DashboardPage } from './pages/DashboardPage'
import { DepartmentPage, DepartmentsPage } from './pages/DepartmentsPage'
import { GradeSheetPage } from './pages/GradeSheetPage'
import { LoginPage } from './pages/LoginPage'
import { MySubjectsPage } from './pages/MySubjectsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ProgressPage } from './pages/ProgressPage'
import { ResultsBatchPage } from './pages/ResultsBatchPage'
import { ResultsPage } from './pages/ResultsPage'
import { ReviewPage } from './pages/ReviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { StudentPage } from './pages/StudentPage'
import { StudentsSearchPage } from './pages/StudentsSearchPage'
import { UsersPage } from './pages/UsersPage'
import { VerifyPage } from './pages/VerifyPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
})

const router = createHashRouter([
  {
    element: <Layout />,
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
      { path: 'control', element: <ControlPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
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
        <VerifyPage code={verifyCode} />
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
