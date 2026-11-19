import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSessionUserFromCookies } from '@/lib/auth'
import { deleteImage } from '@/lib/storage'

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInt32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2025'
  )
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

/** Admin-only: update a pack. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const data: Prisma.PackUpdateInput = {}
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 })
    }
    data.name = body.name.trim()
  }
  if (body.description === null) {
    data.description = null
  } else if (typeof body.description === 'string' && body.description.trim()) {
    data.description = body.description.trim()
  }
  if (typeof body.isPublic === 'boolean') data.isPublic = body.isPublic
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (body.sortOrder !== undefined) {
    if (!isInt32(body.sortOrder)) {
      return NextResponse.json({ error: 'sortOrder must be a 32-bit integer' }, { status: 400 })
    }
    data.sortOrder = body.sortOrder
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  try {
    const pack = await prisma.pack.update({ where: { id }, data })
    return NextResponse.json({
      ok: true,
      pack: {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        isPublic: pack.isPublic,
        isActive: pack.isActive,
        sortOrder: pack.sortOrder,
      },
    })
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: 'Pack not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to update pack' }, { status: 500 })
  }
}

/** Admin-only: delete a pack, its templates (DB cascade) and unused images. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { id } = await params
  const pack = await prisma.pack.findUnique({ where: { id }, include: { templates: true } })
  if (!pack) return NextResponse.json({ error: 'Pack not found' }, { status: 404 })

  try {
    // Delete first; only touch files after the database committed.
    await prisma.pack.delete({ where: { id } })
  } catch (error) {
    if (isNotFoundError(error)) {
      return NextResponse.json({ error: 'Pack not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to delete pack' }, { status: 500 })
  }

  const keys = new Set(pack.templates.map((t) => t.imageKey))
  for (const key of keys) {
    await deleteImageIfUnused(key)
  }
  return NextResponse.json({ ok: true })
}
