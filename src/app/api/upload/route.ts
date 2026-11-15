import { NextResponse } from 'next/server'
import { getSessionUserFromCookies } from '@/lib/auth'
import { generateUploadKey, imageUrl } from '@/lib/storage'

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

/** Admin-only: upload an image, returns { key, url }. */
export async function POST(req: Request) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Expected a file field named "file"' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const key = generateUploadKey(buffer, file.name || 'image.png')
  return NextResponse.json({ key, url: imageUrl(key) })
}
