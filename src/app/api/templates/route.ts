import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUserFromCookies } from '@/lib/auth'

/** Admin-only: list all templates. */
export async function GET() {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const templates = await prisma.template.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json({
    templates: templates.map((t) => ({
      id: t.id,
      packId: t.packId,
      name: t.name,
      imageKey: t.imageKey,
      isFreeform: t.isFreeform,
      boxes: t.boxes,
      isActive: t.isActive,
    })),
  })
}

/** Admin-only: create a template in a pack. */
export async function POST(req: Request) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const packId = typeof body?.packId === 'string' ? body.packId : ''
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const imageKey = typeof body?.imageKey === 'string' ? body.imageKey : ''
  if (!packId || !name || !imageKey) {
    return NextResponse.json({ error: 'packId, name and imageKey required' }, { status: 400 })
  }

  const pack = await prisma.pack.findUnique({ where: { id: packId } })
  if (!pack) return NextResponse.json({ error: 'Pack not found' }, { status: 404 })

  const boxes = Array.isArray(body?.boxes) ? body.boxes : []
  const isFreeform = boxes.length === 0 ? (typeof body?.isFreeform === 'boolean' ? body.isFreeform : true) : false

  const template = await prisma.template.create({
    data: { packId, name, imageKey, isFreeform, boxes },
  })
  return NextResponse.json({ template: { id: template.id, name: template.name, imageKey: template.imageKey, isFreeform: template.isFreeform, boxes: template.boxes, isActive: template.isActive } })
}
