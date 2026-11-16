import crypto from 'crypto'
import { cookies } from 'next/headers'
import { prisma } from './prisma'

export const SESSION_COOKIE = 'mb_session'
const SESSION_DAYS = 30

// --- password hashing (node:crypto, no external deps) ---------------------

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt ?? crypto.randomBytes(16).toString('hex')
  const h = crypto.scryptSync(password, s, 64).toString('hex')
  return { hash: h, salt: s }
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const h = crypto.scryptSync(password, salt, 64)
  const stored = Buffer.from(hash, 'hex')
  // A corrupt/stored-with-other-params hash must fail verification, not throw
  // inside timingSafeEqual (length mismatch) and turn into a 500.
  if (stored.length !== h.length) return false
  return crypto.timingSafeEqual(h, stored)
}

// --- sessions ---------------------------------------------------------------

export async function createSession(userId: string): Promise<string> {
  // piggyback cleanup of expired sessions on login (no cron needed)
  await prisma.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await prisma.adminSession.create({ data: { token, userId, expiresAt } })
  return token
}

export async function getSessionUser(token: string | undefined) {
  if (!token) return null
  const session = await prisma.adminSession.findUnique({
    where: { token },
    include: { user: true },
  })
  if (!session || session.expiresAt < new Date()) return null
  return session.user
}

export async function getSessionUserFromCookies(): Promise<Awaited<ReturnType<typeof getSessionUser>>> {
  const store = await cookies()
  return getSessionUser(store.get(SESSION_COOKIE)?.value)
}

export async function destroySession(token: string): Promise<void> {
  await prisma.adminSession.deleteMany({ where: { token } })
}
