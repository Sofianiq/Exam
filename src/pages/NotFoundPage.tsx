import { Compass } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Card, EmptyState } from '../components/ui'

export function NotFoundPage({ title = 'الصفحة غير موجودة', message }: { title?: string; message?: string }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={<Compass className="size-6" />}
        title={title}
        action={
          <Link to="/">
            <Button variant="primary">العودة إلى الرئيسية</Button>
          </Link>
        }
      >
        {message ?? 'قد يكون الرابط غير صحيح أو ليست لديك صلاحية الوصول إليه.'}
      </EmptyState>
    </Card>
  )
}
