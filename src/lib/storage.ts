import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { config } from './config'
export { imageUrl } from './images'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])

export function generateUploadKey(buffer: Buffer, filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  const safeExt = IMAGE_EXTENSIONS.has(ext) ? ext : '.png'
  const key = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${safeExt}`
  const file = path.join(config.uploadDir, key)
  fs.writeFileSync(file, buffer)
  return key
}

export interface StoredImage {
  buffer: Buffer
  contentType: string
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

function safeJoin(base: string, key: string): string | null {
  // Keys are server-generated (no traversal) or "public:..." seed refs.
  if (key.includes('..') || path.isAbsolute(key)) return null
  return path.join(base, key)
}

/**
 * Resolve an image key to a file buffer.
 * Keys are either upload filenames (in UPLOAD_DIR) or "public:<path>"
 * references into the app's public/ directory (seed content).
 */
export function readImage(key: string): StoredImage | null {
  if (key.startsWith('public:')) {
    const rel = key.slice('public:'.length)
    const file = safeJoin(path.join(process.cwd(), 'public'), rel)
    if (file && fs.existsSync(file)) {
      return { buffer: fs.readFileSync(file), contentType: contentTypeOf(file) }
    }
    return null
  }
  const file = safeJoin(config.uploadDir, key)
  if (file && fs.existsSync(file)) {
    return { buffer: fs.readFileSync(file), contentType: contentTypeOf(file) }
  }
  return null
}

function contentTypeOf(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

export function deleteImage(key: string): void {
  if (key.startsWith('public:')) return // seed content is not deletable
  const file = safeJoin(config.uploadDir, key)
  if (file && fs.existsSync(file)) fs.unlinkSync(file)
}

