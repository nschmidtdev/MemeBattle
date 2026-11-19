// Load .env* for local runs (`npm run db:seed`, `prisma db seed`); in Docker the
// environment is provided by Compose. Must run before PrismaClient connects.
import '../src/lib/env'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const PACK_NAME = 'Classic'
const force = process.env.SEED_FORCE === '1'

const PACK_DATA = {
  name: PACK_NAME,
  description: 'The original meme templates',
  isPublic: true,
  isActive: true,
  sortOrder: 0,
}

interface BoxSeed {
  id: string
  x: number
  y: number
  w: number
  fontSize: number
  defaultText?: string
}

function box(id: string, x: number, y: number, w: number, fontSize: number, defaultText?: string): BoxSeed {
  return { id, x, y, w, fontSize, defaultText }
}

interface TemplateSeed {
  name: string
  imageKey: string
  isFreeform: boolean
  boxes: BoxSeed[]
}

const TEMPLATES: TemplateSeed[] = [
  {
    name: 'Drake',
    imageKey: 'public:seed/drake.svg',
    isFreeform: false,
    boxes: [
      box('top', 0.3, 0.25, 0.52, 0.05, 'I would never'),
      box('bottom', 0.3, 0.75, 0.52, 0.05, 'but I will'),
    ],
  },
  {
    name: 'Yelling Cat',
    imageKey: 'public:seed/yelling-cat.svg',
    isFreeform: false,
    boxes: [
      box('left', 0.25, 0.78, 0.4, 0.08, 'SAY IT AGAIN'),
      box('right', 0.75, 0.78, 0.4, 0.08, 'LOUDER'),
    ],
  },
  {
    name: 'Distracted',
    imageKey: 'public:seed/distracted.svg',
    isFreeform: false,
    boxes: [
      box('l', 0.19, 0.85, 0.3, 0.055, 'I am here'),
      box('c', 0.5, 0.85, 0.3, 0.055, 'but my eyes are over there'),
      box('r', 0.81, 0.85, 0.3, 0.055, 'because of THAT'),
    ],
  },
  {
    name: 'Chad',
    imageKey: 'public:seed/chad.svg',
    isFreeform: false,
    boxes: [box('bottom', 0.5, 0.85, 0.7, 0.06, 'PEAK PERFORMANCE')],
  },
  {
    name: 'Fire Dog',
    imageKey: 'public:seed/fire-dog.svg',
    isFreeform: false,
    boxes: [box('bottom', 0.5, 0.85, 0.7, 0.06, 'IT IS WOKING')],
  },
  {
    name: 'Grumpy Cat',
    imageKey: 'public:seed/grumpy-cat.svg',
    isFreeform: false,
    boxes: [box('bottom', 0.5, 0.85, 0.7, 0.06, 'I AM DISAPPOINTED')],
  },
  {
    name: 'Surprised',
    imageKey: 'public:seed/surprised.svg',
    isFreeform: false,
    boxes: [box('bottom', 0.5, 0.85, 0.6, 0.065, 'WAIT FOR IT…')],
  },
]

async function main() {
  const existingPack = await prisma.pack.findFirst({
    where: { name: PACK_NAME },
    include: { templates: { select: { id: true } } },
  })

  // Never overwrite user edits: an existing pack with templates is left alone.
  // This also means deleted seed templates stay deleted while others remain.
  if (existingPack && existingPack.templates.length > 0 && !force) {
    console.log(
      `Seed skipped: pack "${PACK_NAME}" already has ${existingPack.templates.length} template(s). ` +
        'Set SEED_FORCE=1 to update seeded templates.',
    )
    return
  }

  let pack = existingPack
  if (!pack) {
    pack = await prisma.pack.create({
      data: PACK_DATA,
      include: { templates: { select: { id: true } } },
    })
    console.log(`Created pack "${PACK_NAME}"`)
  } else if (force) {
    await prisma.pack.update({ where: { id: pack.id }, data: PACK_DATA })
    console.log(`Updated pack "${PACK_NAME}"`)
  }

  for (const t of TEMPLATES) {
    const boxes = t.boxes.map((b) => ({
      ...b,
      color: '#ffffff',
      stroke: '#000000',
      font: 'Impact',
      align: 'center',
      rotation: 0,
    }))
    const existing = await prisma.template.findFirst({ where: { packId: pack.id, name: t.name } })

    if (existing) {
      if (!force) continue
      await prisma.template.update({
        where: { id: existing.id },
        data: { imageKey: t.imageKey, isFreeform: t.isFreeform, boxes },
      })
      console.log(`Updated template "${t.name}"`)
    } else {
      await prisma.template.create({
        data: { packId: pack.id, name: t.name, imageKey: t.imageKey, isFreeform: t.isFreeform, boxes, isActive: true },
      })
      console.log(`Created template "${t.name}"`)
    }
  }
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
