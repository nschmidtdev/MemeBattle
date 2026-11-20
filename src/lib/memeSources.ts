/**
 * Pure source adapters for the generic meme-pack importer.
 *
 * These functions turn payloads from Imgflip, Memegen or a local JSON manifest
 * into the common `SourceItem` shape used by `scripts/import-pack.ts`. They do
 * no network or filesystem I/O, so the normalisation rules are unit-testable
 * offline. Downloads, local folder scanning and the admin-API uploads happen
 * in the CLI script.
 */

export type SourceKind = 'imgflip' | 'memegen' | 'memegenscript' | 'memegenrs' | 'manifest' | 'folder'

export interface SourceItem {
  source: SourceKind
  sourceId: string
  name: string
  /**
   * http(s) URL, file URL or local path. Empty for manifest items without a
   * `url`; the CLI then resolves a sibling image by id/slug.
   */
  imageUrl: string
  width?: number
  height?: number
  boxCount?: number
}

/** Stable, human-readable template names stay well below this length. */
export const MAX_TEMPLATE_NAME_LENGTH = 60

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  euro: '€',
  pound: '£',
  yen: '¥',
}

function entityCodePoint(code: number): string {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return ''
  // Lone surrogates are not valid Unicode scalar values.
  if (code >= 0xd800 && code <= 0xdfff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** Decode the small HTML-entity set that meme catalogs actually emit. */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) =>
      entityCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]{1,7});/g, (_, dec: string) =>
      entityCodePoint(Number.parseInt(dec, 10)),
    )
    .replace(/&([a-z][a-z0-9]{1,31});/gi, (match, name: string) => {
      return NAMED_ENTITIES[name.toLowerCase()] ?? match
    })
}

function cleanText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/[\u0000-\u001f\u007f\u00a0\u200b-\u200d\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readName(value: unknown): string {
  return typeof value === 'string' ? cleanText(value) : ''
}

function readId(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** Accept numbers and numeric strings; round to an integer >= min. */
function readInteger(value: unknown, min: number): number | undefined {
  let parsed: number
  if (typeof value === 'number') {
    parsed = value
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    parsed = Number(value.trim())
  } else {
    return undefined
  }
  if (!Number.isFinite(parsed)) return undefined
  const rounded = Math.round(parsed)
  return rounded >= min ? rounded : undefined
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

const IMGFLIP_HOSTS = new Set(['i.imgflip.com', 'imgflip.com', 'www.imgflip.com'])
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/i

/** Imgflip serves its assets from i.imgflip.com over HTTPS. */
function isImgflipImageUrl(value: string): boolean {
  if (!isAbsoluteHttpUrl(value)) return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      IMGFLIP_HOSTS.has(url.hostname.toLowerCase()) &&
      IMAGE_EXTENSION.test(url.pathname)
    )
  } catch {
    return false
  }
}

/**
 * Memegen's blank-image endpoint is documented (and live) as
 * https://api.memegen.link/images/<id>.png. Only use it for safe ids and only
 * when the payload does not carry a usable `blank` URL.
 */
function memegenFallbackUrl(id: string): string | null {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) return null
  return `https://api.memegen.link/images/${encodeURIComponent(id)}.png`
}

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/

/**
 * Manifest URLs may be remote, file URLs, absolute paths or paths relative to
 * the manifest. Other URI schemes (data:, javascript:, ...) are rejected.
 */
function isSupportedImageReference(value: string): boolean {
  if (isAbsoluteHttpUrl(value)) return true
  if (WINDOWS_ABSOLUTE_PATH.test(value)) return true
  if (/^file:/i.test(value)) {
    try {
      return new URL(value).protocol === 'file:'
    } catch {
      return false
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false
  return value.length > 0
}

function normalizedUrlKey(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    url.hash = ''
    return url.href
  } catch {
    return trimmed
  }
}

/**
 * Drop duplicates by source id (case-insensitive) and by image URL. The first
 * occurrence wins, which keeps upstream catalog order stable.
 */
export function dedupeSourceItems(items: SourceItem[]): SourceItem[] {
  const seen = new Set<string>()
  const result: SourceItem[] = []
  for (const item of items) {
    const idKey = `${item.source}:${item.sourceId.trim().toLowerCase()}`
    const urlKey = normalizedUrlKey(item.imageUrl)
    if (seen.has(idKey) || (urlKey !== '' && seen.has(`url:${urlKey}`))) continue
    seen.add(idKey)
    if (urlKey !== '') seen.add(`url:${urlKey}`)
    result.push(item)
  }
  return result
}

/** Normalise an Imgflip `get_memes` response. Broken entries are skipped. */
export function normalizeImgflip(payload: unknown): SourceItem[] {
  const root = isRecord(payload) ? payload : null
  const data = root && isRecord(root.data) ? root.data : null
  const memes = data && Array.isArray(data.memes) ? data.memes : null
  if (!memes) return []

  const items: SourceItem[] = []
  for (const entry of memes) {
    if (!isRecord(entry)) continue
    const sourceId = readId(entry.id)
    const name = readName(entry.name)
    const imageUrl = readString(entry.url)
    if (!sourceId || !name || !isImgflipImageUrl(imageUrl)) continue

    const item: SourceItem = { source: 'imgflip', sourceId, name, imageUrl }
    const width = readInteger(entry.width, 1)
    const height = readInteger(entry.height, 1)
    const boxCount = readInteger(entry.box_count, 0)
    if (width !== undefined) item.width = width
    if (height !== undefined) item.height = height
    if (boxCount !== undefined) item.boxCount = boxCount
    items.push(item)
  }

  return dedupeSourceItems(items)
}

/** Normalise a Memegen `/templates` array. Broken entries are skipped. */
export function normalizeMemegen(payload: unknown): SourceItem[] {
  if (!Array.isArray(payload)) return []

  const items: SourceItem[] = []
  for (const entry of payload) {
    if (!isRecord(entry)) continue
    const sourceId = readId(entry.id)
    const name = readName(entry.name)
    if (!sourceId || !name) continue

    const blank = readString(entry.blank)
    const imageUrl = isAbsoluteHttpUrl(blank) ? blank : memegenFallbackUrl(sourceId)
    if (!imageUrl) continue

    const item: SourceItem = { source: 'memegen', sourceId, name, imageUrl }
    const width = readInteger(entry.width, 1)
    const height = readInteger(entry.height, 1)
    // Memegen calls its caption slots "lines"; it is the closest box_count.
    const boxCount = readInteger(entry.lines, 0)
    if (width !== undefined) item.width = width
    if (height !== undefined) item.height = height
    if (boxCount !== undefined) item.boxCount = boxCount
    items.push(item)
  }

  return dedupeSourceItems(items)
}

/**
 * Memegenscript mirrors the Memegen payload but serves its own images. Use the
 * same field mapping with a source-specific fallback for missing `blank`.
 */
export function normalizeMemegenscript(payload: unknown): SourceItem[] {
  if (!Array.isArray(payload)) return []

  const items: SourceItem[] = []
  for (const entry of payload) {
    if (!isRecord(entry)) continue
    const sourceId = readId(entry.id)
    const name = readName(entry.name)
    if (!sourceId || !name) continue

    const blank = readString(entry.blank)
    const imageUrl = isAbsoluteHttpUrl(blank)
      ? blank
      : /^[a-z0-9][a-z0-9_-]*$/i.test(sourceId)
        ? `https://memegenscript.com/images/${encodeURIComponent(sourceId)}.png`
        : ''
    if (!imageUrl) continue

    const item: SourceItem = { source: 'memegenscript', sourceId, name, imageUrl }
    const width = readInteger(entry.width, 1)
    const height = readInteger(entry.height, 1)
    const boxCount = readInteger(entry.lines, 0)
    if (width !== undefined) item.width = width
    if (height !== undefined) item.height = height
    if (boxCount !== undefined) item.boxCount = boxCount
    items.push(item)
  }

  return dedupeSourceItems(items)
}

/**
 * Memegen.rs uses mostly the same payload but `blank` may be a relative path
 * such as `/images/drake-hotline-bling.png`, so resolve it against the host.
 */
export function normalizeMemegenRs(payload: unknown): SourceItem[] {
  if (!Array.isArray(payload)) return []

  const items: SourceItem[] = []
  for (const entry of payload) {
    if (!isRecord(entry)) continue
    const sourceId = readId(entry.id)
    const name = readName(entry.name)
    if (!sourceId || !name) continue

    const blank = readString(entry.blank)
    let imageUrl = ''
    if (blank) {
      try {
        const resolved = new URL(blank, 'https://memegen.rs')
        if (resolved.protocol === 'https:' && /(^|\.)memegen\.rs$/i.test(resolved.hostname)) {
          imageUrl = resolved.href
        }
      } catch {
        imageUrl = ''
      }
    }
    if (!imageUrl && /^[a-z0-9][a-z0-9_-]*$/i.test(sourceId)) {
      imageUrl = `https://memegen.rs/images/${encodeURIComponent(sourceId)}.png`
    }
    if (!imageUrl) continue

    const item: SourceItem = { source: 'memegenrs', sourceId, name, imageUrl }
    const width = readInteger(entry.width, 1)
    const height = readInteger(entry.height, 1)
    const boxCount = readInteger(entry.lines, 0)
    if (width !== undefined) item.width = width
    if (height !== undefined) item.height = height
    if (boxCount !== undefined) item.boxCount = boxCount
    items.push(item)
  }

  return dedupeSourceItems(items)
}

function manifestEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!isRecord(payload)) return []

  if (Array.isArray(payload.packs)) {
    const entries: unknown[] = []
    for (const pack of payload.packs) {
      if (!isRecord(pack) || !Array.isArray(pack.items)) continue
      entries.push(...pack.items)
    }
    if (entries.length > 0 || !Array.isArray(payload.items)) return entries
  }

  return Array.isArray(payload.items) ? payload.items : []
}

/**
 * Normalise our JSON manifest formats:
 *   { packs: [{ name, items: [{ id, name, url? }] }] }
 *   { items: [{ id, name, url? }] }
 *
 * `url` may be a remote URL, a file URL, an absolute path or a path relative
 * to the manifest. Items without a URL are kept with an empty imageUrl so the
 * CLI can look for `<id>.<ext>` / `<slug>.<ext>` next to the manifest. That
 * makes local (including private/NSFW) collections first-class sources.
 */
export function normalizeManifest(payload: unknown): SourceItem[] {
  const items: SourceItem[] = []
  for (const entry of manifestEntries(payload)) {
    if (!isRecord(entry)) continue

    const nameValue = readName(entry.name)
    const sourceId = readId(entry.id) || (nameValue ? slugify(nameValue) : '')
    if (!sourceId) continue
    const name = nameValue || sourceId

    const urlValue = entry.url !== undefined ? entry.url : entry.imageUrl
    let imageUrl = ''
    if (typeof urlValue === 'string') {
      imageUrl = urlValue.trim()
    } else if (urlValue !== undefined && urlValue !== null) {
      continue
    }
    if (imageUrl !== '' && !isSupportedImageReference(imageUrl)) continue

    const item: SourceItem = { source: 'manifest', sourceId, name, imageUrl }
    const width = readInteger(entry.width, 1)
    const height = readInteger(entry.height, 1)
    const boxCount = readInteger(entry.boxCount, 0)
    if (width !== undefined) item.width = width
    if (height !== undefined) item.height = height
    if (boxCount !== undefined) item.boxCount = boxCount
    items.push(item)
  }

  return dedupeSourceItems(items)
}

/**
 * Clean a user/source name and cap it at `maxLength` Unicode code points.
 * Truncation prefers the last word boundary, otherwise it cuts the long word
 * and marks the result with an ellipsis.
 */
export function stableTemplateName(
  value: string,
  maxLength = MAX_TEMPLATE_NAME_LENGTH,
): string {
  const limit = Math.max(1, Math.floor(maxLength))
  const cleaned = cleanText(value).normalize('NFC') || 'Untitled'
  const chars = Array.from(cleaned)
  if (chars.length <= limit) return cleaned
  if (limit === 1) return chars[0] ?? '…'

  let head = chars.slice(0, limit - 1).join('').trimEnd()
  const lastSpace = head.lastIndexOf(' ')
  if (lastSpace >= Math.floor((limit - 1) * 0.6)) {
    head = head.slice(0, lastSpace).trimEnd()
  }
  if (!head) head = chars.slice(0, limit - 1).join('')
  return `${head}…`
}

/** Case/whitespace-insensitive key for duplicate template names. */
export function templateNameKey(name: string): string {
  return cleanText(name).normalize('NFC').toLowerCase()
}

/** ASCII slug used for source ids and upload filenames. */
export function slugify(value: string, maxLength = MAX_TEMPLATE_NAME_LENGTH): string {
  const limit = Math.max(1, Math.floor(maxLength))
  const ascii = cleanText(value)
    .replace(/ß/g, 'ss')
    .replace(/ẞ/g, 'SS')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    .replace(/ø/g, 'o')
    .replace(/Ø/g, 'O')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const slug = ascii || 'item'
  if (slug.length <= limit) return slug
  return slug.slice(0, limit).replace(/-+$/g, '') || slug.slice(0, limit)
}

/**
 * Derive a deterministic, unique template name: keep the base name unless it
 * is already taken, then append " (2)", " (3)", ... without exceeding
 * `maxLength`. The caller supplies the "is taken" predicate.
 */
export function uniqueTemplateName(
  name: string,
  isTaken: (key: string) => boolean,
  maxLength = MAX_TEMPLATE_NAME_LENGTH,
): string {
  const limit = Math.max(1, Math.floor(maxLength))
  const base = stableTemplateName(name, limit)
  if (!isTaken(templateNameKey(base))) return base

  const cleaned = cleanText(name) || 'Untitled'
  for (let index = 2; index <= 9999; index += 1) {
    const suffix = ` (${index})`
    const headLimit = Math.max(1, limit - suffix.length)
    const head = stableTemplateName(cleaned, headLimit).replace(/…$/, '').trimEnd()
    const candidate = Array.from(`${head || 'Template'}${suffix}`)
      .slice(0, limit)
      .join('')
      .trimEnd()
    if (candidate && !isTaken(templateNameKey(candidate))) return candidate
  }

  throw new Error(`Could not derive a unique template name for "${base}"`)
}
