import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSession,
  isSecureRequest,
  verifyPassword,
} from '@/lib/auth'

const MAX_BODY_BYTES = 10 * 1024 // 10 KB is plenty for { email, password }
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000

interface RateEntry {
  count: number
  resetAt: number
}

// In-memory per-IP limiter (single server process; resets on restart). Enough
// to stop online password guessing without adding a dependency.
const attempts = new Map<string, RateEntry>()

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

function pruneAttempts(now: number): void {
  if (attempts.size < 500) return
  for (const [ip, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(ip)
  }
}

function retryAfterSeconds(entry: RateEntry, now: number): number {
  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
}

function registerAttempt(ip: string, now: number): void {
  const entry = attempts.get(ip)
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return
  }
  entry.count += 1
}

type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 }

/**
 * Enforce the size limit before parsing JSON. The Content-Length header is
 * checked first; the stream is also capped so a missing/lying header cannot
 * force an unbounded buffer.
 */
async function readJsonBody(req: Request): Promise<BodyResult> {
  const declared = req.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isFinite(length) || length < 0) return { ok: false, status: 400 }
    if (length > MAX_BODY_BYTES) return { ok: false, status: 413 }
  }

  const reader = req.body?.getReader()
  if (!reader) return { ok: false, status: 400 }

  const chunks: Buffer[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, status: 413 }
      }
      chunks.push(Buffer.from(value))
    }
  } catch {
    return { ok: false, status: 400 }
  }

  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false, status: 400 }
  }
}

export async function POST(req: Request) {
  const now = Date.now()
  pruneAttempts(now)

  const ip = clientIp(req)
  const existing = attempts.get(ip)
  if (existing && existing.resetAt > now && existing.count >= RATE_LIMIT_MAX) {
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds(existing, now)) } },
    )
  }

  const parsed = await readJsonBody(req)
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.status === 413 ? 'Request body too large' : 'Invalid request body' },
      { status: parsed.status },
    )
  }

  const record =
    typeof parsed.value === 'object' && parsed.value !== null
      ? (parsed.value as Record<string, unknown>)
      : {}
  const email = typeof record.email === 'string' ? record.email.trim() : ''
  const password = typeof record.password === 'string' ? record.password : ''
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  // Only real credential checks count towards the limit.
  registerAttempt(ip, now)

  try {
    const user = await prisma.user.findFirst({ where: { email, role: 'admin' } })
    let valid = false
    if (user?.passwordHash && user.salt) {
      valid = await verifyPassword(password, user.salt, user.passwordHash)
    }
    if (!user || !valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Successful login also clears accumulated failures for this IP.
    attempts.delete(ip)

    const token = await createSession(user.id)
    const res = NextResponse.json({ ok: true })
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecureRequest(req),
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
    return res
  } catch {
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
