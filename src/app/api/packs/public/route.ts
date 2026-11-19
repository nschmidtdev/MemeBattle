import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/** Public: active + public packs, with active template counts. */
export async function GET() {
  try {
    const packs = await prisma.pack.findMany({
      where: { isPublic: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { templates: { select: { isActive: true } } },
    })
    return NextResponse.json({
      packs: packs
        .map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          isPublic: p.isPublic,
          templateCount: p.templates.filter((t) => t.isActive).length,
        }))
        .filter((p) => p.templateCount > 0),
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load public packs' }, { status: 500 })
  }
}
