import crypto from 'crypto'
import { promisify } from 'util'
import { cookies } from 'next/headers'
import { prisma } from './prisma'

export const SESSION_COOKIE = 'mb_session'
/** Session lifetime: 7 days (cookie maxAge and DB expiry stay in sync). */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

// --- password hashing (node:crypto, no external deps) ---------------------

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt ?? crypto.randomBytes(16).toString('hex')
  const h = crypto.scryptSync(password, s, 64).toString('hex')
  return { hash: h, salt: s }
}

const scryptAsync = promisify(crypto.scrypt) as unknown as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
) => Promise<Buffer>

/** Async scrypt verification so a login cannot block the event loop. */
export async function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
  try {
    const h = await scryptAsync(password, salt, 64)
    const stored = Buffer.from(hash, 'hex')
    // A corrupt/stored-with-other-params hash must fail verification, not throw
    // inside timingSafeEqual (length mismatch) and turn into a 500.
    if (stored.length !== h.length) return false
    return crypto.timingSafeEqual(h, stored)
  } catch {
    return false
  }
}

// --- sessions ---------------------------------------------------------------

/**
 * Only a SHA-256 hash of the session token is stored. A leaked database row
 * therefore cannot be replayed as a cookie; the raw token exists only in the
 * browser. Existing plaintext-token sessions become invalid by design.
 */
function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function createSession(userId: string): Promise<string> {
  // piggyback cleanup of expired sessions on login (no cron needed)
  await prisma.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000)
  await prisma.adminSession.create({ data: { token: hashSessionToken(token), userId, expiresAt } })
  return token
}

export async function getSessionUser(token: string | undefined) {
  if (!token) return null
  const session = await prisma.adminSession.findUnique({
    where: { token: hashSessionToken(token) },
    include: { user: true },
  })
  if (!session || session.expiresAt < new Date()) return null
  // Defense in depth: only admin sessions are valid for the admin panel.
  if (session.user.role !== 'admin') return null
  return session.user
}

export async function getSessionUserFromCookies(): Promise<Awaited<ReturnType<typeof getSessionUser>>> {
  const store = await cookies()
  return getSessionUser(store.get(SESSION_COOKIE)?.value)
}

export async function destroySession(token: string): Promise<void> {
  await prisma.adminSession.deleteMany({ where: { token: hashSessionToken(token) } })
}

// --- cookies ----------------------------------------------------------------

/**
 * Whether the session cookie must be marked Secure.
 * COOKIE_SECURE wins ('true'/'false'); otherwise trust the forwarded protocol
 * (reverse proxy) or the request URL (direct TLS). This keeps plain HTTP LAN
 * logins working even when NODE_ENV=production.
 */
export function isSecureRequest(req: Request): boolean {
  const configured = process.env.COOKIE_SECURE?.trim().toLowerCase()
  if (configured === 'true') return true
  if (configured === 'false') return false

  const forwarded = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  if (forwarded) return forwarded === 'https'

  try {
    return new URL(req.url).protocol === 'https:'
  } catch {
    return false
  }
}
