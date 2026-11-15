import { NextResponse } from 'next/server'
import { readImage } from '@/lib/storage'

/** Serves uploaded images and seed references (public:<path>). */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params
  const image = readImage(key.join('/'))
  if (!image) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return new NextResponse(new Uint8Array(image.buffer), {
    headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
