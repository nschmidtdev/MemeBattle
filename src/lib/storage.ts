import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { config } from './config'
import { snapImageWidth } from './images'

/** Maximum accepted upload size (10 MB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

export interface DetectedImageType {
  /** Lower-case extension including the dot, e.g. ".png". */
  ext: string
  contentType: string
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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Sniff the real image type from magic bytes. The client-supplied filename and
 * MIME type are deliberately ignored: an HTML/SVG file renamed to "x.png"
 * must not be stored and served.
 */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ext: '.png', contentType: 'image/png' }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: '.jpg', contentType: 'image/jpeg' }
  }
  if (buffer.length >= 6) {
    const gif = buffer.subarray(0, 6).toString('ascii')
    if (gif === 'GIF87a' || gif === 'GIF89a') {
      return { ext: '.gif', contentType: 'image/gif' }
    }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: '.webp', contentType: 'image/webp' }
  }
  return null
}

/**
 * Content-addressed upload key: first 32 hex chars of the SHA-256 digest plus
 * the extension detected from the bytes. Identical uploads dedupe to the same
 * file instead of filling the disk.
 */
export function generateUploadKey(buffer: Buffer, type?: DetectedImageType): string {
  const detected = type ?? detectImageType(buffer)
  if (!detected) throw new Error('Unsupported image type')

  const digest = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32)
  const key = `${digest}${detected.ext}`
  const file = path.join(config.uploadDir, key)
  if (!fs.existsSync(file)) fs.writeFileSync(file, buffer)
  return key
}

function safeJoin(base: string, key: string): string | null {
  // Keys are server-generated (no traversal) or "public:..." seed refs.
  if (!key || key.includes('..') || path.isAbsolute(key)) return null
  return path.join(base, key)
}

/**
 * Resolve an image key to an absolute path, or null when the key is unsafe.
 * Exported so the image route can verify the target is a regular file.
 */
export function imageFilePath(key: string): string | null {
  if (key.startsWith('public:')) {
    const rel = key.slice('public:'.length)
    return safeJoin(path.join(process.cwd(), 'public'), rel)
  }
  return safeJoin(config.uploadDir, key)
}

/** True when a key references an existing file (seed asset or upload). */
export function imageExists(key: string): boolean {
  const file = imageFilePath(key)
  if (!file) return false
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve an image key to a file buffer.
 * Keys are either upload filenames (in UPLOAD_DIR) or "public:<path>"
 * references into the app's public/ directory (seed content).
 * Any filesystem problem yields null, never an unhandled exception.
 */
export function readImage(key: string): StoredImage | null {
  const file = imageFilePath(key)
  if (!file) return null
  try {
    if (!fs.statSync(file).isFile()) return null
    return { buffer: fs.readFileSync(file), contentType: contentTypeOf(file) }
  } catch {
    return null
  }
}

function contentTypeOf(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

/** Best-effort delete; shared keys must be checked by the caller first. */
export function deleteImage(key: string): void {
  if (key.startsWith('public:')) return // seed content is not deletable
  const file = safeJoin(config.uploadDir, key)
  if (!file) return
  try {
    if (fs.statSync(file).isFile()) fs.unlinkSync(file)
  } catch {
    // Missing file / permissions: nothing useful to do here.
  }
}

/**
 * Display variants are generated lazily by the image route. They live in a
 * hidden subfolder of the upload volume (never in the repo) and are keyed by
 * source key + width, so they are immutable until the source changes.
 */
function variantFilePath(key: string, width: number): string {
  const hash = crypto.createHash('sha256').update(`${key}@${width}`).digest('hex').slice(0, 32)
  return path.join(config.uploadDir, '.variants', `${hash}.webp`)
}

/** True for static raster formats we can safely re-encode. */
function canResizeImage(key: string): boolean {
  const ext = path.extname(key).toLowerCase()
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp'
}

/**
 * Read or lazily generate a compressed WebP display variant capped to the
 * requested (bucketed) size. Returns null for SVG, animated images and any
 * failure: the caller then serves the original file unchanged.
 */
export async function readImageVariant(key: string, width: unknown): Promise<StoredImage | null> {
  const snapped = snapImageWidth(width)
  if (!snapped || !canResizeImage(key)) return null
  const source = imageFilePath(key)
  if (!source) return null

  const file = variantFilePath(key, snapped)
  try {
    if (fs.existsSync(file)) return { buffer: fs.readFileSync(file), contentType: 'image/webp' }

    const sharp = (await import('sharp')).default
    const meta = await sharp(source, { limitInputPixels: 50_000_000 }).metadata()
    // Animated images (GIF/WebP) must keep their frames: serve the original.
    if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) return null

    const buffer = await sharp(source, { limitInputPixels: 50_000_000 })
      .rotate() // honor EXIF orientation before stripping metadata
      .resize({ width: snapped, height: snapped, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, buffer)
    return { buffer, contentType: 'image/webp' }
  } catch {
    return null
  }
}
