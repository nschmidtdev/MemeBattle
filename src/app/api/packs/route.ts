import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUserFromCookies } from '@/lib/auth'

/** Admin-only: list all packs with template counts. */
export async function GET() {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const packs = await prisma.pack.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { templates: { select: { isActive: true } } },
  })
  return NextResponse.json({
    packs: packs.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isPublic: p.isPublic,
      isActive: p.isActive,
      sortOrder: p.sortOrder,
      templateCount: p.templates.length,
      activeTemplateCount: p.templates.filter((t) => t.isActive).length,
    })),
  })
}

/** Admin-only: create a pack. */
export async function POST(req: Request) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const description = typeof body?.description === 'string' && body.description.trim() ? body.description.trim() : null
  const isPublic = typeof body?.isPublic === 'boolean' ? body.isPublic : true

  const pack = await prisma.pack.create({ data: { name, description, isPublic } })
  return NextResponse.json({ pack: { id: pack.id, name: pack.name, description, isPublic } })
}
