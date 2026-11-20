import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUserFromCookies } from '@/lib/auth'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 500
const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInt32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX
}

/** Optional paging without changing the response shape the admin UI expects. */
function paging(req: Request): { take: number; skip: number } {
  const params = new URL(req.url, 'http://localhost').searchParams
  const limit = Number(params.get('limit'))
  const offset = Number(params.get('offset'))
  const take = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : DEFAULT_LIMIT
  const skip = Number.isInteger(offset) && offset > 0 ? offset : 0
  return { take, skip }
}

/** Admin-only: list all packs with template counts. */
export async function GET(req: Request) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { take, skip } = paging(req)
  try {
    const packs = await prisma.pack.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { templates: { select: { isActive: true } } },
      take,
      skip,
    })
    return NextResponse.json({
      packs: packs.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        isPublic: p.isPublic,
        isActive: p.isActive,
        adult: p.adult,
        sortOrder: p.sortOrder,
        templateCount: p.templates.length,
        activeTemplateCount: p.templates.filter((t) => t.isActive).length,
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load packs' }, { status: 500 })
  }
}

/** Admin-only: create a pack. */
export async function POST(req: Request) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const parsed = await req.json().catch(() => null)
  if (!isRecord(parsed)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const description =
    typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim() : null
  const isPublic = typeof parsed.isPublic === 'boolean' ? parsed.isPublic : true
  const adult = parsed.adult === true
  if (parsed.sortOrder !== undefined && !isInt32(parsed.sortOrder)) {
    return NextResponse.json({ error: 'sortOrder must be a 32-bit integer' }, { status: 400 })
  }

  try {
    const pack = await prisma.pack.create({
      data: {
        name,
        description,
        isPublic,
        adult,
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder as number } : {}),
      },
    })
    return NextResponse.json(
      {
        pack: {
          id: pack.id,
          name: pack.name,
          description: pack.description,
          isPublic: pack.isPublic,
          isActive: pack.isActive,
          adult: pack.adult,
          sortOrder: pack.sortOrder,
        },
      },
      { status: 201 },
    )
  } catch {
    return NextResponse.json({ error: 'Failed to create pack' }, { status: 500 })
  }
}
