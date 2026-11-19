// Best-effort startup maintenance: remove files in UPLOAD_DIR that no template
// references (e.g. leftovers from deleted templates). Files referenced via
// "public:" live in public/ and are never touched.
import '../src/lib/env'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { config } from '../src/lib/config'

const prisma = new PrismaClient()

async function main() {
  const dir = config.uploadDir
  if (!fs.existsSync(dir)) {
    console.log(`Upload cleanup: ${dir} does not exist, nothing to do.`)
    return
  }

  const templates = await prisma.template.findMany({ select: { imageKey: true } })
  const referenced = new Set(
    templates
      .map((t) => t.imageKey)
      .filter((key): key is string => typeof key === 'string' && key.length > 0 && !key.startsWith('public:')),
  )

  let removed = 0
  let kept = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Uploads are flat files; leave anything else (defensive) alone.
    if (!entry.isFile()) continue
    if (referenced.has(entry.name)) {
      kept++
      continue
    }
    try {
      fs.unlinkSync(path.join(dir, entry.name))
      removed++
    } catch (err) {
      console.error(`Upload cleanup: could not delete "${entry.name}":`, err)
    }
  }

  console.log(`Upload cleanup: removed ${removed} unreferenced file(s), kept ${kept} in ${dir}.`)
}

main()
  .catch((err) => {
    console.error('Upload cleanup failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
