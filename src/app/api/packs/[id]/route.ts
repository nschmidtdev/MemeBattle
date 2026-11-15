import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUserFromCookies } from '@/lib/auth'
import { deleteImage } from '@/lib/storage'

/** Admin-only: update a pack. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
  if (body.description === null || (typeof body.description === 'string' && body.description.trim())) {
    data.description = typeof body.description === 'string' ? body.description.trim() : null
  }
  if (typeof body.isPublic === 'boolean') data.isPublic = body.isPublic
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)) data.sortOrder = body.sortOrder

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  try {
    const pack = await prisma.pack.update({ where: { id }, data })
    return NextResponse.json({ ok: true, pack: { id: pack.id, name: pack.name, description: pack.description, isPublic: pack.isPublic, isActive: pack.isActive, sortOrder: pack.sortOrder } })
  } catch {
    return NextResponse.json({ error: 'Pack not found' }, { status: 404 })
  }
}

/** Admin-only: delete a pack and its templates (+ uploaded images). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { id } = await params
  const pack = await prisma.pack.findUnique({ where: { id }, include: { templates: true } })
  if (!pack) return NextResponse.json({ error: 'Pack not found' }, { status: 404 })

  for (const t of pack.templates) {
    if (!t.imageKey.startsWith('public:')) deleteImage(t.imageKey)
  }
  await prisma.pack.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
