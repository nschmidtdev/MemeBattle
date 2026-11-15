import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSessionUserFromCookies } from '@/lib/auth'
import { deleteImage } from '@/lib/storage'

/** Admin-only: update a template. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const existing = await prisma.template.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
  if (typeof body.imageKey === 'string' && body.imageKey && body.imageKey !== existing.imageKey) {
    data.imageKey = body.imageKey
    if (!existing.imageKey.startsWith('public:')) deleteImage(existing.imageKey)
  }
  if (typeof body.isFreeform === 'boolean') data.isFreeform = body.isFreeform
  if (Array.isArray(body.boxes)) data.boxes = body.boxes
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const template = await prisma.template.update({ where: { id }, data })
  return NextResponse.json({
    ok: true,
    template: { id: template.id, name: template.name, imageKey: template.imageKey, isFreeform: template.isFreeform, boxes: template.boxes, isActive: template.isActive, packId: template.packId },
  })
}

/** Admin-only: delete a template (+ uploaded image). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { id } = await params
  const template = await prisma.template.findUnique({ where: { id } })
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  if (!template.imageKey.startsWith('public:')) deleteImage(template.imageKey)
  await prisma.template.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
