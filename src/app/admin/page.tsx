import { redirect } from 'next/navigation'
import { getSessionUserFromCookies } from '@/lib/auth'
import AdminPanel from './AdminPanel'

export default async function AdminPage() {
  const user = await getSessionUserFromCookies()
  if (!user) redirect('/admin/login')
  return (
    <div className="container">
      <AdminPanel email={user.email ?? ''} />
    </div>
  )
}
