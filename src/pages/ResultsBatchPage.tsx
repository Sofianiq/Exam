import { Navigate, useParams, useSearchParams } from 'react-router-dom'

/** الرابط القديم لطباعة نتائج صف كامل — يُحوَّل إلى صفحة «النتائج» بنفس الاختيارات */
export function ResultsBatchPage() {
  const { deptId, stage, shift } = useParams()
  const [sp] = useSearchParams()
  const q = new URLSearchParams({ dept: deptId ?? '', stage: stage ?? '1', shift: shift ?? 'morning', term: sp.get('term') ?? '1' })
  return <Navigate to={`/results?${q.toString()}`} replace />
}
