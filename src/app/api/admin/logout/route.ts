import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE, destroySession } from '@/lib/auth'

export async function POST() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (token) await destroySession(token)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}

export async function GET() {
  return POST()
}
