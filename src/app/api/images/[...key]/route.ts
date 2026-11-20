import fs from 'fs'
import { NextResponse } from 'next/server'
import { imageFilePath, readImage, readImageVariant } from '@/lib/storage'

/** Serves uploaded images and seed references (public:<path>). */
export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  try {
    const { key } = await params
    const lookup = key.join('/')

    // Resolve + verify the target is a regular file. Directories, devices and
    // traversal attempts are all a plain 404.
    const file = imageFilePath(lookup)
    if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!fs.statSync(file).isFile()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // ?w=... serves a compressed WebP display variant (cached on disk). SVG,
    // animated images and generation failures fall through to the original.
    const width = new URL(req.url).searchParams.get('w')
    if (width) {
      const variant = await readImageVariant(lookup, width)
      if (variant) {
        return new NextResponse(new Uint8Array(variant.buffer), {
          headers: {
            'Content-Type': variant.contentType,
            'Cache-Control': 'public, max-age=86400',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      }
    }

    const image = readImage(lookup)
    if (!image) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return new NextResponse(new Uint8Array(image.buffer), {
      headers: {
        'Content-Type': image.contentType,
        'Cache-Control': 'public, max-age=3600',
        // SVGs (seed assets) are same-origin documents when opened directly:
        // sandbox them (stored-XSS guard) and forbid type sniffing.
        'Content-Security-Policy': 'sandbox',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    // Never leak a stack trace for missing/unreadable files.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
