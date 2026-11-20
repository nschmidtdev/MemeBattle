/**
 * Generic meme-pack importer for the running instance (admin API).
 *
 * Sources:
 *   - Imgflip get_memes (public catalog)
 *   - Memegen /templates
 *   - local JSON manifests ({ packs: [...] } or { items: [...] })
 *   - local folders of images (recursive)
 *
 * Local folders and manifests are imported as-is, without a content filter.
 * That deliberately supports private/NSFW collections kept by the operator;
 * only the image formats accepted by /api/upload (PNG, JPEG, GIF, WebP) are
 * enforced. Pack name and description come from the CLI.
 *
 * Legal/safety: template images are third-party content. They are uploaded
 * only into this local instance's database and UPLOAD_DIR. Never commit
 * downloaded assets, manifests containing third-party images, or database
 * exports to the MIT-licensed repository. Pack descriptions automatically
 * carry source attribution.
 *
 * Usage: see --help. Real imports need ADMIN_EMAIL/ADMIN_PASSWORD (env/.env);
 * those values are never printed. --dry-run makes no admin login, download,
 * upload or database write.
 */
import '../src/lib/env'
import fs from 'node:fs'
import path from 'node:path'
import type { Dirent, Stats } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  dedupeSourceItems,
  normalizeImgflip,
  normalizeManifest,
  normalizeMemegen,
  slugify,
  stableTemplateName,
  templateNameKey,
  uniqueTemplateName,
} from '../src/lib/memeSources'
import type { SourceItem, SourceKind } from '../src/lib/memeSources'

const DEFAULT_BASE_URL = 'http://localhost:3000'
const IMGFLIP_API = 'https://api.imgflip.com/get_memes'
const MEMEGEN_API = 'https://api.memegen.link/templates'

const PAGE_SIZE = 500
const MAX_PAGES = 100
const MIN_IMAGE_BYTES = 1024
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 60_000
const API_TIMEOUT_MS = 30_000
const ITEM_DELAY_MS = 150
const DRY_RUN_PREVIEW_LIMIT = 200
const FOLDER_MAX_DEPTH = 20
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:[\\/]/
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const HELP_TEXT = `Meme pack importer

Usage:
  npm run import:pack -- --source <imgflip|memegen|manifest|path> [options]
  npx tsx scripts/import-pack.ts --source ./my-pack [options]

Sources:
  imgflip              https://api.imgflip.com/get_memes
  memegen              https://api.memegen.link/templates
  manifest             JSON file: { packs: [{ name, items: [...] }] } or { items: [...] }
  <path>               local JSON manifest, or a folder of images (scanned recursively)

Options:
  --source <value>     source name or local path (required)
  --pack "Name"        target pack name (default: source name / manifest pack / folder name)
  --description "..."  pack description; source attribution is appended automatically
  --limit N            import at most N items after --ids and dedupe
  --ids id1,id2        only import these source ids
  --dry-run            list what would be imported; no login, download, upload or DB write
  --public             create the pack as public (default)
  --private            create the pack as private
  --base-url URL       app URL (default: BASE_URL or ${DEFAULT_BASE_URL})
  --manifest <path>    manifest path when using "--source manifest" (or pass it positionally)
  -h, --help           show this help

Environment:
  ADMIN_EMAIL, ADMIN_PASSWORD   admin login for a real import (never logged)
  BASE_URL                      app URL when --base-url is absent

Local manifests:
  { "packs": [{ "name": "After Dark (18+)", "items": [
      { "id": "one", "name": "One", "url": "https://example.test/one.png" },
      { "id": "two", "name": "Two" }
  ]}]}
  Items without "url" use a sibling image named <id>.<ext> or <slug(name)>.<ext>.
  Relative "url" values are resolved against the manifest directory.

Local folders:
  Every .png/.jpg/.jpeg/.gif/.webp file under the folder is imported as-is.
  Images must be valid PNG/JPEG/GIF/WebP, >1 KB and <=10 MB.
  No content/NSFW filter is applied; the operator owns the collection.

Examples:
  npm run import:pack -- --source imgflip --pack "Imgflip" --limit 50 --dry-run
  npm run import:pack -- --source memegen --pack "Memegen" --ids aag,drake --dry-run
  npm run import:pack -- --source manifest --manifest ./pack.json --pack "My Pack"
  npm run import:pack -- --source ./private/after-dark --pack "After Dark (18+)" --description "Adults only" --private

Safety:
  Imported images belong to their original creators and stay in this local
  instance. Do not commit them to the MIT-licensed repository. Pack descriptions
  include the source and import date.

Exit codes: 0 = success, 1 = one or more items failed, 2 = usage/fatal error.
`

class UsageError extends Error {}

interface CliOptions {
  source: string
  sourcePath?: string
  packName?: string
  description?: string
  limit?: number
  ids?: string[]
  dryRun: boolean
  isPublic: boolean
  baseUrl: string
  help: boolean
}

type ResolvedSource =
  | { kind: 'imgflip'; label: string }
  | { kind: 'memegen'; label: string }
  | { kind: 'manifest'; file: string; label: string }
  | { kind: 'folder'; dir: string; label: string }

interface LoadedSource {
  kind: SourceKind
  label: string
  attribution: string
  defaultPackName: string
  items: SourceItem[]
  manifestDir?: string
  manifestFiles?: Map<string, string>
}

interface PackDto {
  id: string
  name: string
  isPublic?: boolean
  isActive?: boolean
}

interface TemplateDto {
  id: string
  packId: string
  name: string
}

interface ImageData {
  buffer: Buffer
  contentType: string
  extension: string
}

type ImageLocation =
  | { kind: 'remote'; url: string }
  | { kind: 'local'; file: string }

interface ImportFailure {
  item: SourceItem
  reason: string
}

interface ImportStats {
  imported: number
  duplicates: number
  failed: number
  failures: ImportFailure[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return DEFAULT_BASE_URL
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new UsageError(`Invalid base URL: ${raw}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`Base URL must use http or https: ${raw}`)
  }
  if (url.search || url.hash) {
    throw new UsageError(`Base URL must not contain a query or hash: ${raw}`)
  }
  return url.href.replace(/\/+$/, '')
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    source: '',
    dryRun: false,
    isPublic: true,
    baseUrl: process.env.BASE_URL?.trim() || DEFAULT_BASE_URL,
    help: false,
  }
  const positional: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      opts.help = true
      continue
    }
    if (arg === '--') {
      positional.push(...argv.slice(index + 1))
      break
    }
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }

    const equals = arg.indexOf('=')
    const flag = equals === -1 ? arg : arg.slice(0, equals)
    const inline = equals === -1 ? undefined : arg.slice(equals + 1)
    const readValue = (): string => {
      if (inline !== undefined) return inline
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new UsageError(`${flag} requires a value`)
      }
      index += 1
      return next
    }
    const readFlag = (): void => {
      if (inline !== undefined) throw new UsageError(`${flag} does not take a value`)
    }

    switch (flag) {
      case '--source':
        opts.source = readValue().trim()
        break
      case '--pack':
        opts.packName = readValue().trim()
        if (!opts.packName) throw new UsageError('--pack requires a non-empty name')
        break
      case '--description':
        opts.description = readValue().trim() || undefined
        break
      case '--limit': {
        const raw = readValue().trim()
        if (!/^\d+$/.test(raw)) throw new UsageError('--limit requires a positive integer')
        const limit = Number(raw)
        if (!Number.isSafeInteger(limit) || limit < 1) {
          throw new UsageError('--limit requires a positive integer')
        }
        opts.limit = limit
        break
      }
      case '--ids': {
        const ids = readValue()
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
        if (ids.length === 0) throw new UsageError('--ids requires at least one source id')
        opts.ids = ids
        break
      }
      case '--manifest':
      case '--file':
        opts.sourcePath = readValue().trim()
        if (!opts.sourcePath) throw new UsageError(`${flag} requires a path`)
        break
      case '--base-url':
        opts.baseUrl = readValue()
        break
      case '--dry-run':
        readFlag()
        opts.dryRun = true
        break
      case '--public':
        readFlag()
        opts.isPublic = true
        break
      case '--private':
        readFlag()
        opts.isPublic = false
        break
      default:
        throw new UsageError(`Unknown option: ${flag}`)
    }
  }

  if (opts.help) return opts

  if (positional.length > 1) {
    throw new UsageError('Only one source path is allowed')
  }
  if (positional.length === 1) {
    if (opts.sourcePath) {
      throw new UsageError('Source path given twice (--manifest/--file and positional)')
    }
    opts.sourcePath = positional[0].trim()
  }
  if (!opts.source) {
    throw new UsageError('--source is required (imgflip, memegen, manifest or a local path)')
  }
  opts.baseUrl = normalizeBaseUrl(opts.baseUrl)
  return opts
}

function statLocalPath(raw: string): { absolute: string; isDirectory: boolean } {
  let absolute: string
  if (/^file:/i.test(raw)) {
    try {
      absolute = fileURLToPath(raw)
    } catch {
      throw new UsageError(`Invalid file URL: ${raw}`)
    }
  } else {
    absolute = path.resolve(raw)
  }

  try {
    const stat = fs.statSync(absolute)
    if (stat.isDirectory()) return { absolute, isDirectory: true }
    if (stat.isFile()) return { absolute, isDirectory: false }
  } catch {
    // Reported by the shared error below.
  }
  throw new UsageError(`Source not found or unreadable: ${absolute}`)
}

function resolveSource(opts: CliOptions): ResolvedSource {
  const raw = opts.source.trim()
  const lower = raw.toLowerCase()

  if (lower === 'imgflip') {
    if (opts.sourcePath) throw new UsageError('--source imgflip does not take a path')
    return { kind: 'imgflip', label: `Imgflip (${IMGFLIP_API})` }
  }
  if (lower === 'memegen') {
    if (opts.sourcePath) throw new UsageError('--source memegen does not take a path')
    return { kind: 'memegen', label: `Memegen (${MEMEGEN_API})` }
  }

  let pathValue: string
  if (lower === 'manifest') {
    if (!opts.sourcePath) {
      throw new UsageError(
        '--source manifest needs a JSON file: use --manifest <path>, --source manifest:<path>, or a positional path',
      )
    }
    pathValue = opts.sourcePath
  } else if (lower.startsWith('manifest:')) {
    if (opts.sourcePath) throw new UsageError('Manifest path given twice')
    pathValue = raw.slice(raw.indexOf(':') + 1).trim()
    if (!pathValue) throw new UsageError('manifest: needs a path after the colon')
  } else {
    if (opts.sourcePath) {
      throw new UsageError('A source path was given twice; pass either --source <path> or a positional path')
    }
    pathValue = raw
  }

  const local = statLocalPath(pathValue)
  if (local.isDirectory) {
    return { kind: 'folder', dir: local.absolute, label: `local folder ${local.absolute}` }
  }
  return { kind: 'manifest', file: local.absolute, label: `local manifest ${local.absolute}` }
}

async function fetchJson(url: string): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'meme-battle-import-pack/1.0',
      },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`Could not reach ${url}: ${messageOf(error)}`)
  }
  if (!res.ok) throw new Error(`GET ${url} failed with HTTP ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`GET ${url} returned invalid JSON`)
  }
}

function readDir(dir: string): Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    throw new UsageError(`Could not read folder ${dir}: ${messageOf(error)}`)
  }
}

function sortEntries(entries: Dirent[]): Dirent[] {
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

function collectImageFiles(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > FOLDER_MAX_DEPTH) return
    for (const entry of sortEntries(readDir(dir))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) walk(full, depth + 1)
      } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(full)
      }
    }
  }
  walk(root, 0)
  return files
}

function nameFromFile(file: string): string {
  const base = path.basename(file, path.extname(file))
  const spaced = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return stableTemplateName(spaced || base || 'Template')
}

function buildLocalImageIndex(dir: string): Map<string, string> {
  const index = new Map<string, string>()
  for (const entry of sortEntries(readDir(dir))) {
    if (!entry.isFile() || !IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
    const full = path.join(dir, entry.name)
    const base = path.basename(entry.name, path.extname(entry.name))
    // Match both "my_file" and "my-file" against a manifest id/name.
    for (const key of new Set([base.toLowerCase(), slugify(base)])) {
      if (key && !index.has(key)) index.set(key, full)
    }
  }
  return index
}

function firstManifestPackName(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.packs)) return null
  for (const pack of payload.packs) {
    if (isRecord(pack) && typeof pack.name === 'string' && pack.name.trim()) {
      return pack.name.trim()
    }
  }
  return null
}

async function loadSource(source: ResolvedSource): Promise<LoadedSource> {
  if (source.kind === 'imgflip') {
    const payload = await fetchJson(IMGFLIP_API)
    return {
      kind: 'imgflip',
      label: source.label,
      attribution: `Imgflip's public meme catalog (${IMGFLIP_API}; https://imgflip.com)`,
      defaultPackName: 'Imgflip',
      items: normalizeImgflip(payload),
    }
  }

  if (source.kind === 'memegen') {
    const payload = await fetchJson(MEMEGEN_API)
    return {
      kind: 'memegen',
      label: source.label,
      attribution: `the Memegen template API (${MEMEGEN_API}; https://memegen.link)`,
      defaultPackName: 'Memegen',
      items: normalizeMemegen(payload),
    }
  }

  if (source.kind === 'manifest') {
    let text: string
    try {
      text = fs.readFileSync(source.file, 'utf8')
    } catch (error) {
      throw new UsageError(`Could not read manifest ${source.file}: ${messageOf(error)}`)
    }
    let payload: unknown
    try {
      // Windows editors/PowerShell often write a UTF-8 BOM.
      payload = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown
    } catch {
      throw new UsageError(`Manifest is not valid JSON: ${source.file}`)
    }

    const manifestDir = path.dirname(source.file)
    const packFromManifest = firstManifestPackName(payload)
    const stem = stableTemplateName(path.basename(source.file, path.extname(source.file)))
    return {
      kind: 'manifest',
      label: source.label,
      attribution: `local manifest ${source.file}`,
      defaultPackName: packFromManifest || stem || 'Imported Pack',
      items: normalizeManifest(payload),
      manifestDir,
      manifestFiles: buildLocalImageIndex(manifestDir),
    }
  }

  // Local folders are deliberately unfiltered: the operator's own collection
  // may be private/NSFW. Only the formats accepted by the server are selected.
  const files = collectImageFiles(source.dir)
  const items: SourceItem[] = files.map((file) => ({
    source: 'folder',
    sourceId: path.relative(source.dir, file).split(path.sep).join('/'),
    name: nameFromFile(file),
    imageUrl: pathToFileURL(file).href,
  }))
  const stem = stableTemplateName(path.basename(source.dir))
  return {
    kind: 'folder',
    label: source.label,
    attribution: `local folder ${source.dir}`,
    defaultPackName: stem === 'Untitled' ? 'Local Pack' : stem,
    items: dedupeSourceItems(items),
  }
}

function describeImage(item: SourceItem): string {
  const raw = item.imageUrl.trim()
  if (!raw) return '(sibling image resolved by id/slug)'
  if (/^file:/i.test(raw)) {
    try {
      return fileURLToPath(raw)
    } catch {
      return raw
    }
  }
  return raw
}

function locateImage(item: SourceItem, source: LoadedSource): ImageLocation | null {
  const raw = item.imageUrl.trim()
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return { kind: 'remote', url: raw }
    if (/^file:/i.test(raw)) {
      try {
        return { kind: 'local', file: fileURLToPath(raw) }
      } catch {
        return null
      }
    }
    if (!WINDOWS_ABSOLUTE_PATH.test(raw) && /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null
    if (path.isAbsolute(raw) || WINDOWS_ABSOLUTE_PATH.test(raw)) {
      return { kind: 'local', file: raw }
    }
    if (source.manifestDir) {
      return { kind: 'local', file: path.resolve(source.manifestDir, raw) }
    }
    return null
  }

  if (source.kind === 'manifest' && source.manifestFiles) {
    const candidates = new Set([
      item.sourceId.toLowerCase(),
      slugify(item.sourceId),
      slugify(item.name),
    ])
    for (const key of candidates) {
      if (!key) continue
      const file = source.manifestFiles.get(key)
      if (file) return { kind: 'local', file }
    }
  }
  return null
}

function statLocalFile(file: string): Stats {
  let stat: Stats
  try {
    stat = fs.statSync(file)
  } catch {
    throw new Error(`Local image not found: ${file}`)
  }
  if (!stat.isFile()) throw new Error(`Local image is not a file: ${file}`)
  return stat
}

function sniffImage(buffer: Buffer): { contentType: string; extension: string } | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { contentType: 'image/png', extension: '.png' }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: '.jpg' }
  }
  if (buffer.length >= 6) {
    const gif = buffer.subarray(0, 6).toString('ascii')
    if (gif === 'GIF87a' || gif === 'GIF89a') {
      return { contentType: 'image/gif', extension: '.gif' }
    }
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: '.webp' }
  }
  return null
}

function checkedImage(buffer: Buffer): ImageData {
  if (buffer.length <= MIN_IMAGE_BYTES) {
    throw new Error(`image is too small (${buffer.length} bytes; must be larger than 1 KB)`)
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`image is too large (${formatBytes(buffer.length)}; max 10 MB)`)
  }
  const sniffed = sniffImage(buffer)
  if (!sniffed) throw new Error('unsupported image format (allowed: PNG, JPEG, GIF, WebP)')
  return { buffer, contentType: sniffed.contentType, extension: sniffed.extension }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function readBodyCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const reader = res.body?.getReader()
  if (!reader) {
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > maxBytes) throw new Error('image is larger than 10 MB')
    return buffer
  }

  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error('image is larger than 10 MB')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

async function loadImage(location: ImageLocation): Promise<ImageData> {
  if (location.kind === 'local') {
    const stat = statLocalFile(location.file)
    if (stat.size <= MIN_IMAGE_BYTES) {
      throw new Error(`image is too small (${stat.size} bytes; must be larger than 1 KB)`)
    }
    if (stat.size > MAX_IMAGE_BYTES) {
      throw new Error(`image is too large (${formatBytes(stat.size)}; max 10 MB)`)
    }
    let buffer: Buffer
    try {
      buffer = fs.readFileSync(location.file)
    } catch (error) {
      throw new Error(`Could not read local image ${location.file}: ${messageOf(error)}`)
    }
    return checkedImage(buffer)
  }

  let res: Response
  try {
    res = await fetch(location.url, {
      redirect: 'follow',
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`download failed: ${messageOf(error)}`)
  }
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`download has non-image Content-Type "${contentType}"`)
  }
  if (contentType === 'image/svg+xml') {
    throw new Error('SVG images are not supported by the upload endpoint')
  }

  const declaredLength = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new Error(`image is too large (${formatBytes(declaredLength)}; max 10 MB)`)
  }
  if (Number.isFinite(declaredLength) && declaredLength > 0 && declaredLength <= MIN_IMAGE_BYTES) {
    throw new Error(`image is too small (${declaredLength} bytes; must be larger than 1 KB)`)
  }

  let buffer: Buffer
  try {
    buffer = await readBodyCapped(res, MAX_IMAGE_BYTES)
  } catch (error) {
    throw new Error(`download failed: ${messageOf(error)}`)
  }
  return checkedImage(buffer)
}

function readSetCookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const raw = res.headers.get('set-cookie')
  return raw ? [raw] : []
}

function errorFromBody(body: unknown, fallback: string): string {
  if (isRecord(body) && typeof body.error === 'string' && body.error.trim()) {
    return body.error.trim()
  }
  return fallback
}

async function loginAdmin(baseUrl: string): Promise<string> {
  const email = process.env.ADMIN_EMAIL?.trim()
  const password = process.env.ADMIN_PASSWORD
  if (!email || !password) {
    throw new UsageError(
      'ADMIN_EMAIL and ADMIN_PASSWORD must be set (environment or .env) for a real import',
    )
  }

  let res: Response
  try {
    res = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`Could not reach ${baseUrl}: ${messageOf(error)}`)
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = null
    }
  }
  if (!res.ok) {
    throw new Error(`Admin login failed (HTTP ${res.status}): ${errorFromBody(body, res.statusText)}`)
  }

  const cookie = readSetCookies(res)
    .map((entry) => entry.split(';', 1)[0].trim())
    .filter(Boolean)
    .join('; ')
  if (!cookie) throw new Error('Admin login succeeded but returned no session cookie')
  return cookie
}

async function apiJson(
  baseUrl: string,
  pathName: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')

  let res: Response
  try {
    res = await fetch(`${baseUrl}${pathName}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`${init.method ?? 'GET'} ${pathName} failed: ${messageOf(error)}`)
  }

  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = null
    }
  }
  if (!res.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${pathName} failed (HTTP ${res.status}): ${errorFromBody(body, res.statusText)}`,
    )
  }
  if (text && body === null) throw new Error(`${pathName} returned invalid JSON`)
  return body
}

async function fetchPacks(baseUrl: string, cookie: string): Promise<PackDto[]> {
  const packs: PackDto[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await apiJson(baseUrl, `/api/packs?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`, {
      headers: { Cookie: cookie },
    })
    if (!isRecord(data) || !Array.isArray(data.packs)) {
      throw new Error('GET /api/packs returned an unexpected payload')
    }
    for (const entry of data.packs) {
      if (isRecord(entry) && typeof entry.id === 'string' && typeof entry.name === 'string') {
        packs.push({
          id: entry.id,
          name: entry.name,
          isPublic: typeof entry.isPublic === 'boolean' ? entry.isPublic : undefined,
          isActive: typeof entry.isActive === 'boolean' ? entry.isActive : undefined,
        })
      }
    }
    if (data.packs.length < PAGE_SIZE) return packs
  }
  throw new Error('Refusing to page through more than 50,000 packs')
}

async function fetchTemplates(baseUrl: string, cookie: string): Promise<TemplateDto[]> {
  const templates: TemplateDto[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await apiJson(
      baseUrl,
      `/api/templates?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
      { headers: { Cookie: cookie } },
    )
    if (!isRecord(data) || !Array.isArray(data.templates)) {
      throw new Error('GET /api/templates returned an unexpected payload')
    }
    for (const entry of data.templates) {
      if (
        isRecord(entry) &&
        typeof entry.id === 'string' &&
        typeof entry.packId === 'string' &&
        typeof entry.name === 'string'
      ) {
        templates.push({ id: entry.id, packId: entry.packId, name: entry.name })
      }
    }
    if (data.templates.length < PAGE_SIZE) return templates
  }
  throw new Error('Refusing to page through more than 50,000 templates')
}

function findPack(packs: PackDto[], name: string): PackDto | null {
  const key = templateNameKey(name)
  return packs.find((pack) => templateNameKey(pack.name) === key) ?? null
}

function buildDescription(opts: CliOptions, source: LoadedSource): string {
  const parts: string[] = []
  if (opts.description?.trim()) parts.push(opts.description.trim())
  parts.push(`Imported from ${source.attribution} on ${new Date().toISOString().slice(0, 10)}.`)
  parts.push(
    'Template images are third-party content owned by their respective creators; this pack exists only in this local instance and is not part of the MIT-licensed repository.',
  )
  return parts.join('\n\n')
}

async function createPack(
  baseUrl: string,
  cookie: string,
  name: string,
  description: string,
  isPublic: boolean,
): Promise<PackDto> {
  // The packs endpoint always creates active packs; isActive is not settable.
  const data = await apiJson(baseUrl, '/api/packs', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, isPublic }),
  })
  if (!isRecord(data) || !isRecord(data.pack) || typeof data.pack.id !== 'string') {
    throw new Error('POST /api/packs did not return a pack id')
  }
  return {
    id: data.pack.id,
    name: typeof data.pack.name === 'string' ? data.pack.name : name,
  }
}

async function uploadImage(
  baseUrl: string,
  cookie: string,
  image: ImageData,
  templateName: string,
): Promise<string> {
  const form = new FormData()
  const fileName = `${slugify(templateName, 40) || 'template'}${image.extension}`
  // Copy into a plain Uint8Array: Buffer's ArrayBufferLike type is not a BlobPart.
  form.append('file', new Blob([new Uint8Array(image.buffer)], { type: image.contentType }), fileName)

  const data = await apiJson(baseUrl, '/api/upload', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  })
  if (!isRecord(data) || typeof data.key !== 'string' || !data.key) {
    throw new Error('upload response did not contain an image key')
  }
  return data.key
}

async function createTemplate(
  baseUrl: string,
  cookie: string,
  packId: string,
  name: string,
  imageKey: string,
): Promise<void> {
  await apiJson(baseUrl, '/api/templates', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      packId,
      name,
      imageKey,
      isFreeform: true,
      boxes: [],
    }),
  })
}

async function importSelected(
  opts: CliOptions,
  source: LoadedSource,
  selected: SourceItem[],
  pack: PackDto,
  cookie: string,
  existingNames: Set<string>,
): Promise<ImportStats> {
  const stats: ImportStats = { imported: 0, duplicates: 0, failed: 0, failures: [] }
  const plannedNames = new Set<string>()
  let attempts = 0

  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index]
    const progress = `[${index + 1}/${selected.length}]`
    const baseName = stableTemplateName(item.name)

    if (
      existingNames.has(templateNameKey(item.name)) ||
      existingNames.has(templateNameKey(baseName))
    ) {
      stats.duplicates += 1
      console.log(`${progress} skip duplicate "${baseName}" (${item.sourceId})`)
      continue
    }

    const name = uniqueTemplateName(
      baseName,
      (key) => existingNames.has(key) || plannedNames.has(key),
    )

    // Friendly to the admin API: at most one upload/template pair per 150 ms.
    if (attempts > 0) await sleep(ITEM_DELAY_MS)
    attempts += 1

    try {
      const location = locateImage(item, source)
      if (!location) {
        throw new Error(
          'no image URL/path; add a url or place <id>.<ext>/<slug>.<ext> next to the manifest',
        )
      }
      const image = await loadImage(location)
      console.log(
        `${progress} ${item.source}:${item.sourceId} -> "${name}" (${formatBytes(image.buffer.length)})`,
      )
      const imageKey = await uploadImage(opts.baseUrl, cookie, image, name)
      await createTemplate(opts.baseUrl, cookie, pack.id, name, imageKey)
      plannedNames.add(templateNameKey(name))
      stats.imported += 1
      console.log(`  imported (${imageKey})`)
    } catch (error) {
      const reason = messageOf(error)
      stats.failed += 1
      stats.failures.push({ item, reason })
      // A failed template create can leave the uploaded (content-addressed)
      // file behind; `npm run uploads:cleanup` removes unreferenced files.
      console.error(`  failed: ${reason}`)
    }
  }

  return stats
}

function printDryRun(
  opts: CliOptions,
  source: LoadedSource,
  selected: SourceItem[],
  packName: string,
): void {
  console.log(`\nDry run: ${selected.length} item(s) would be imported.`)
  console.log(`  target pack: "${packName}" (${opts.isPublic ? 'public' : 'private'})`)
  console.log('  No admin login, image download, upload or database write was performed.')
  console.log('  Existing templates are deduped by name only during a real import.')

  const plannedNames = new Set<string>()
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index]
    const name = uniqueTemplateName(stableTemplateName(item.name), (key) => plannedNames.has(key))
    plannedNames.add(templateNameKey(name))
    if (index < DRY_RUN_PREVIEW_LIMIT) {
      const location = locateImage(item, source)
      let imageNote: string
      if (location?.kind === 'remote') {
        imageNote = location.url
      } else if (location?.kind === 'local') {
        imageNote = location.file
        if (!fs.existsSync(location.file)) {
          imageNote += ' [missing: real import would fail]'
        }
      } else {
        imageNote = `${describeImage(item)} [unresolved: real import would fail]`
      }
      console.log(`  ${index + 1}. "${name}" [${item.source}:${item.sourceId}]`)
      console.log(`     image: ${imageNote}`)
    }
  }
  if (selected.length > DRY_RUN_PREVIEW_LIMIT) {
    console.log(`  ... ${selected.length - DRY_RUN_PREVIEW_LIMIT} more item(s) not shown`)
  }
  console.log(`Would attempt ${selected.length} template(s) into "${packName}".`)
}

function printSummary(source: LoadedSource, pack: PackDto, stats: ImportStats): void {
  console.log('\nSummary')
  console.log(`  source: ${source.label}`)
  console.log(`  pack:   "${pack.name}" (${pack.id})`)
  console.log(`  imported: ${stats.imported}`)
  console.log(`  duplicates skipped: ${stats.duplicates}`)
  console.log(`  failed: ${stats.failed}`)
  if (stats.failures.length > 0) {
    console.log('Failures:')
    for (const failure of stats.failures) {
      console.log(
        `  - ${failure.item.source}:${failure.item.sourceId} (${failure.item.name}): ${failure.reason}`,
      )
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<number> {
  let opts: CliOptions
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`Error: ${messageOf(error)}`)
    if (error instanceof UsageError) console.error('Run with --help for usage.')
    return 2
  }

  if (opts.help) {
    console.log(HELP_TEXT)
    return 0
  }

  try {
    const resolved = resolveSource(opts)
    console.log(`Source: ${resolved.label}`)
    const source = await loadSource(resolved)
    console.log(`Found ${source.items.length} valid source item(s).`)
    if (source.items.length === 0) {
      throw new UsageError(`No valid items found in ${source.label}`)
    }

    let selected = dedupeSourceItems(source.items)

    if (opts.ids && opts.ids.length > 0) {
      const wanted = new Set(opts.ids.map((id) => id.toLowerCase()))
      const matched = new Set<string>()
      selected = selected.filter((item) => {
        const key = item.sourceId.toLowerCase()
        if (!wanted.has(key)) return false
        matched.add(key)
        return true
      })
      const missing = opts.ids.filter((id) => !matched.has(id.toLowerCase()))
      if (missing.length > 0) {
        console.warn(`Warning: --ids not found: ${missing.join(', ')}`)
      }
      if (selected.length === 0) {
        const examples = source.items
          .slice(0, 10)
          .map((item) => item.sourceId)
          .join(', ')
        throw new UsageError(
          `None of the --ids matched; available ids${examples ? ` include: ${examples}` : ' are empty'}`,
        )
      }
    }

    if (opts.limit !== undefined) selected = selected.slice(0, opts.limit)
    if (selected.length === 0) {
      throw new UsageError('No items left after filtering; nothing to import')
    }

    const packName = opts.packName?.trim() || source.defaultPackName.trim() || 'Imported Pack'

    if (opts.dryRun) {
      printDryRun(opts, source, selected, packName)
      return 0
    }

    const cookie = await loginAdmin(opts.baseUrl)
    console.log(`Logged in to ${opts.baseUrl}.`)

    const packs = await fetchPacks(opts.baseUrl, cookie)
    let pack = findPack(packs, packName)
    if (pack) {
      console.log(`Using existing pack "${pack.name}" (${pack.id}; description unchanged).`)
      if (pack.isPublic !== undefined && pack.isPublic !== opts.isPublic) {
        console.warn(
          `Warning: existing pack is ${pack.isPublic ? 'public' : 'private'}; --public/--private only applies to new packs.`,
        )
      }
      if (pack.isActive === false) {
        console.warn('Warning: existing pack is inactive; imported templates stay hidden until it is activated.')
      }
    } else {
      pack = await createPack(
        opts.baseUrl,
        cookie,
        packName,
        buildDescription(opts, source),
        opts.isPublic,
      )
      console.log(`Created ${opts.isPublic ? 'public' : 'private'} pack "${pack.name}" (${pack.id}).`)
    }

    const templates = await fetchTemplates(opts.baseUrl, cookie)
    const existingNames = new Set(
      templates
        .filter((template) => template.packId === pack.id)
        .map((template) => templateNameKey(template.name)),
    )
    console.log(`${existingNames.size} existing template name(s) in this pack.`)

    const stats = await importSelected(opts, source, selected, pack, cookie, existingNames)
    printSummary(source, pack, stats)
    return stats.failed > 0 ? 1 : 0
  } catch (error) {
    console.error(`Error: ${messageOf(error)}`)
    if (error instanceof UsageError) console.error('Run with --help for usage.')
    return 2
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(`Importer crashed: ${messageOf(error)}`)
    process.exitCode = 2
  })
