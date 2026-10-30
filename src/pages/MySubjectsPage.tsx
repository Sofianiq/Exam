import { BookOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useProgress, useSubjects } from '../app/queries'
import { useSession } from '../app/session'
import { SubjectCard } from '../components/SubjectCard'
import { Card, EmptyState, LoadingBlock, PageHeader, Segmented } from '../components/ui'
import { yearLabel } from '../lib/format'
import { TERM_LABEL } from '../lib/labels'

export function MySubjectsPage() {
  const s = useSession()
  const [term, setTerm] = useState<0 | 1 | 2>(0)
  const subjectsQ = useSubjects({ year_id: s.yearId, teacher_id: s.profile.id })
  const progressQ = useProgress(s.yearId)
  const pmap = useMemo(() => new Map(progressQ.data?.map((p) => [p.subject_id, p])), [progressQ.data])
  const list = (subjectsQ.data ?? []).filter((x) => !term || x.term === term)

  return (
    <div>
      <PageHeader
        title="موادي الدراسية"
        subtitle={`المواد المسندة إليك في السنة الدراسية ${yearLabel(s.year?.label)}`}
        actions={
          <Segmented
            value={term}
            onChange={setTerm}
            options={[
              { value: 0, label: 'الكل' },
              { value: 1, label: TERM_LABEL[1] },
              { value: 2, label: TERM_LABEL[2] },
            ]}
          />
        }
      />
      {subjectsQ.isLoading ? (
        <LoadingBlock />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<BookOpen className="size-6" />} title="لا توجد مواد" />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((x) => (
            <SubjectCard key={x.id} subject={x} progress={pmap.get(x.id)} />
          ))}
        </div>
      )}
    </div>
  )
}
