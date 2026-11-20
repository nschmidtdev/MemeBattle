import { prisma } from '../lib/prisma'
import type { TemplateData } from '../lib/types'
import { filterValidTemplateBoxes } from '../lib/templateValidation'

/**
 * Which of the given packs are marked adult (18+). Only active, public packs
 * count: hidden packs cannot be played and therefore must not gate a lobby.
 */
export async function loadAdultPackIds(packIds: string[]): Promise<Set<string>> {
  if (packIds.length === 0) return new Set()
  const rows = await prisma.pack.findMany({
    where: { id: { in: packIds }, isActive: true, isPublic: true, adult: true },
    select: { id: true },
  })
  return new Set(rows.map((row) => row.id))
}

/**
 * Load all active templates of the given packs (for dealing in a round).
 * Only active, public packs are playable: a hidden/disabled pack id supplied by
 * a client must never leak templates into a game.
 */
export async function loadTemplates(packIds: string[]): Promise<TemplateData[]> {
  if (packIds.length === 0) return []
  const rows = await prisma.template.findMany({
    where: {
      isActive: true,
      pack: { id: { in: packIds }, isActive: true, isPublic: true },
    },
    orderBy: [{ packId: 'asc' }, { name: 'asc' }],
  })
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    imageKey: t.imageKey,
    isFreeform: t.isFreeform,
    // Legacy/hand-edited rows may contain broken boxes: drop them instead of
    // handing `null`/non-array data to the renderer.
    boxes: filterValidTemplateBoxes(t.boxes),
  }))
}
