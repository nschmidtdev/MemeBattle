import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getSessionUserFromCookies } from '@/lib/auth'
import { imageExists } from '@/lib/storage'
import { validateTemplateBoxes } from '@/lib/templateValidation'
import type { TemplateBox } from '@/lib/types'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 500

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function paging(req: Request): { take: number; skip: number } {
  const params = new URL(req.url, 'http://localhost').searchParams
  const limit = Number(params.get('limit'))
  const offset = Number(params.get('offset'))
  const take = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : DEFAULT_LIMIT
  const skip = Number.isInteger(offset) && offset > 0 ? offset : 0
  return { take, skip }
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

/** Admin-only: list all templates. Optional ?limit/&offset paging, array response. */
export async function GET(req: Request) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { take, skip } = paging(req)
  try {
    const templates = await prisma.template.findMany({ orderBy: { name: 'asc' }, take, skip })
    return NextResponse.json({ templates: templates.map(templateDto) })
  } catch {
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 })
  }
}

/** Admin-only: create a template in a pack. */
export async function POST(req: Request) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const packId = typeof body.packId === 'string' ? body.packId.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const imageKey = typeof body.imageKey === 'string' ? body.imageKey.trim() : ''
  if (!packId || !name || !imageKey) {
    return NextResponse.json({ error: 'packId, name and imageKey required' }, { status: 400 })
  }

  const pack = await prisma.pack.findUnique({ where: { id: packId } })
  if (!pack) return NextResponse.json({ error: 'Pack not found' }, { status: 404 })

  if (!imageExists(imageKey)) {
    return NextResponse.json(
      { error: 'imageKey does not reference an existing image', field: 'imageKey' },
      { status: 400 },
    )
  }

  let boxes: TemplateBox[] = []
  if (body.boxes !== undefined) {
    const validation = validateTemplateBoxes(body.boxes)
    if (!validation.boxes) {
      return NextResponse.json(
        { error: `Invalid boxes: ${validation.error}`, field: 'boxes' },
        { status: 400 },
      )
    }
    boxes = validation.boxes
  }

  const isFreeform =
    boxes.length === 0
      ? typeof body.isFreeform === 'boolean'
        ? body.isFreeform
        : true
      : false

  try {
    const template = await prisma.template.create({
      data: {
        packId,
        name,
        imageKey,
        isFreeform,
        boxes: boxes as unknown as Prisma.InputJsonValue,
      },
    })
    return NextResponse.json({ template: templateDto(template) }, { status: 201 })
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2025') {
      return NextResponse.json({ error: 'Pack not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}
