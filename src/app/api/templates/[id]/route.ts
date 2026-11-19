import { NextResponse } from 'next/server'
import type { Prisma, Template } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSessionUserFromCookies } from '@/lib/auth'
import { deleteImage, imageExists } from '@/lib/storage'
import { validateTemplateBoxes } from '@/lib/templateValidation'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2025'
  )
}

function templateDto(t: {
  id: string
  packId: string
  name: string
  imageKey: string
  isFreeform: boolean
  boxes: unknown
  isActive: boolean
  updatedAt: Date
}) {
  return {
    id: t.id,
    packId: t.packId,
    name: t.name,
    imageKey: t.imageKey,
    isFreeform: t.isFreeform,
    boxes: Array.isArray(t.boxes) ? t.boxes : [],
    isActive: t.isActive,
    updatedAt: t.updatedAt.toISOString(),
  }
}

/** Delete an uploaded file only when no template still references the key. */
async function deleteImageIfUnused(key: string): Promise<void> {
  if (key.startsWith('public:')) return
  try {
    const count = await prisma.template.count({ where: { imageKey: key } })
    if (count === 0) deleteImage(key)
  } catch {
    // Best effort: a failed count must not fail the request or delete shared data.
  }
}

/** Admin-only: update a template. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const existing = await prisma.template.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  // Optimistic concurrency: if the client sends the version it edited, reject
  // the write when another admin saved in the meantime.
  if (body.updatedAt !== undefined) {
    if (typeof body.updatedAt !== 'string') {
      return NextResponse.json({ error: 'updatedAt must be an ISO date string' }, { status: 400 })
    }
    const expected = new Date(body.updatedAt)
    if (Number.isNaN(expected.getTime())) {
      return NextResponse.json({ error: 'updatedAt must be a valid ISO date string' }, { status: 400 })
    }
    if (expected.getTime() !== existing.updatedAt.getTime()) {
      return NextResponse.json(
        {
          error: 'Template was modified by someone else',
          currentUpdatedAt: existing.updatedAt.toISOString(),
          template: templateDto(existing),
        },
        { status: 409 },
      )
    }
  }

  const data: Prisma.TemplateUpdateInput = {}
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
    }
    data.name = body.name.trim()
  }

  if (body.imageKey !== undefined) {
    if (typeof body.imageKey !== 'string' || !body.imageKey.trim()) {
      return NextResponse.json(
        { error: 'imageKey must be a non-empty string', field: 'imageKey' },
        { status: 400 },
      )
    }
    const nextKey = body.imageKey.trim()
    if (!imageExists(nextKey)) {
      return NextResponse.json(
        { error: 'imageKey does not reference an existing image', field: 'imageKey' },
        { status: 400 },
      )
    }
    if (nextKey !== existing.imageKey) {
      data.imageKey = nextKey
    }
  }

  if (body.boxes !== undefined) {
    const validation = validateTemplateBoxes(body.boxes)
    if (!validation.boxes) {
      return NextResponse.json(
        { error: `Invalid boxes: ${validation.error}`, field: 'boxes' },
        { status: 400 },
      )
    }
    data.boxes = validation.boxes as unknown as Prisma.InputJsonValue
  }

  if (typeof body.isFreeform === 'boolean') data.isFreeform = body.isFreeform
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  let template: Template
  try {
    template = await prisma.template.update({ where: { id }, data })
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }

  // File cleanup only after a successful DB write, and only for unreferenced
  // non-seed images (several templates may share the same uploaded file).
  if (data.imageKey && template.imageKey !== existing.imageKey) {
    await deleteImageIfUnused(existing.imageKey)
  }

  return NextResponse.json({ ok: true, template: templateDto(template) })
}

/** Admin-only: delete a template (+ its uploaded image when unused). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { id } = await params
  const template = await prisma.template.findUnique({ where: { id } })
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  try {
    await prisma.template.delete({ where: { id } })
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }

  await deleteImageIfUnused(template.imageKey)
  return NextResponse.json({ ok: true })
}
