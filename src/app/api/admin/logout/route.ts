import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE, destroySession, isSecureRequest } from '@/lib/auth'

export async function POST(req: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (token) await destroySession(token)
  const res = NextResponse.json({ ok: true })
  // Mirror the login attributes so browsers reliably clear the cookie on both
  // HTTP and HTTPS deployments.
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
    maxAge: 0,
  })
  return res
}
