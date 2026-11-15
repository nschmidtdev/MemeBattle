import { prisma } from '../lib/prisma'
import type { TemplateData, TemplateBox } from '../lib/types'

/** Load all active templates of the given packs (for dealing in a round). */
export async function loadTemplates(packIds: string[]): Promise<TemplateData[]> {
  if (packIds.length === 0) return []
  const rows = await prisma.template.findMany({
    where: { isActive: true, pack: { id: { in: packIds }, isActive: true } },
  })
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    imageKey: t.imageKey,
    isFreeform: t.isFreeform,
    boxes: (t.boxes ?? []) as unknown as TemplateBox[],
  }))
}

/** Random pack list for lobby settings (public + active packs). */
export async function loadPackOptions() {
  const packs = await prisma.pack.findMany({
    where: { isActive: true, isPublic: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      _count: { select: { templates: { where: { isActive: true } } } },
    },
  })
  return packs.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    templateCount: p._count.templates,
  }))
}
