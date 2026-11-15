import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { SESSION_COOKIE, createSession, verifyPassword } from '@/lib/auth'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const user = await prisma.user.findFirst({ where: { email, role: 'admin' } })
  if (!user?.passwordHash || !user.salt || !verifyPassword(password, user.salt, user.passwordHash)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const token = await createSession(user.id)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 14 * 24 * 60 * 60,
  })
  return res
}
