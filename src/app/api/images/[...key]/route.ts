import fs from 'fs'
import { NextResponse } from 'next/server'
import { imageFilePath, readImage } from '@/lib/storage'

/** Serves uploaded images and seed references (public:<path>). */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
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
