import { NextResponse } from 'next/server'
import { getSessionUserFromCookies } from '@/lib/auth'
import { MAX_UPLOAD_BYTES, detectImageType, generateUploadKey } from '@/lib/storage'
import { imageUrl } from '@/lib/images'

/** Multipart overhead (boundary, headers) on top of the 10 MB file limit. */
const MAX_REQUEST_BYTES = 11 * 1024 * 1024

/** Admin-only: upload an image, returns { key, url }. */
export async function POST(req: Request) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  // Reject oversized bodies before Next buffers/parses the multipart form.
  const declared = req.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isFinite(length) || length < 0) {
      return NextResponse.json({ error: 'Invalid Content-Length' }, { status: 400 })
    }
    if (length > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: 'Upload too large (max 10 MB)' }, { status: 413 })
    }
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 })

  const file = form.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Expected a file field named "file"' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 })
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(await file.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'Could not read uploaded file' }, { status: 400 })
  }
  if (buffer.length === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 })
  }

  // Sniff magic bytes: filenames and client MIME types are untrusted.
  const type = detectImageType(buffer)
  if (!type) {
    return NextResponse.json(
      { error: 'Unsupported image type. Allowed: PNG, JPEG, GIF, WebP.' },
      { status: 415 },
    )
  }

  try {
    const key = generateUploadKey(buffer, type)
    return NextResponse.json({ key, url: imageUrl(key) })
  } catch {
    return NextResponse.json({ error: 'Failed to store image' }, { status: 500 })
  }
}
