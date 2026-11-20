import { NextResponse } from 'next/server'
import { getSessionUserFromCookies } from '@/lib/auth'
import {
  normalizeImgflip,
  normalizeMemegen,
  normalizeMemegenscript,
  normalizeMemegenRs,
  type SourceItem,
} from '@/lib/memeSources'

const CACHE_TTL_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 15_000

interface SourceConfig {
  url: string
  label: string
  normalize: (payload: unknown) => SourceItem[]
}

const SOURCES: Record<string, SourceConfig> = {
  imgflip: {
    url: 'https://api.imgflip.com/get_memes',
    label: 'Imgflip',
    normalize: normalizeImgflip,
  },
  memegen: {
    url: 'https://api.memegen.link/templates',
    label: 'Memegen',
    normalize: normalizeMemegen,
  },
  memegenscript: {
    url: 'https://memegenscript.com/templates',
    label: 'Memegenscript',
    normalize: normalizeMemegenscript,
  },
  memegenrs: {
    url: 'https://memegen.rs/templates',
    label: 'Memegen.rs',
    normalize: normalizeMemegenRs,
  },
}

interface CachedCatalog {
  memes: SourceItem[]
  fetchedAt: number
}

// One cache per source, collapsed concurrent misses, single server process.
const caches = new Map<string, CachedCatalog>()
const pending = new Map<string, Promise<CachedCatalog>>()

async function fetchCatalog(source: string, config: SourceConfig): Promise<CachedCatalog> {
  const response = await fetch(config.url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`${config.label} responded with HTTP ${response.status}`)
  }

  const payload: unknown = await response.json()
  const memes = config.normalize(payload)
  if (memes.length === 0) throw new Error(`${config.label} returned no usable memes`)

  const entry: CachedCatalog = { memes, fetchedAt: Date.now() }
  caches.set(source, entry)
  return entry
}

function loadCatalog(source: string, config: SourceConfig): Promise<CachedCatalog> {
  const cached = caches.get(source)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return Promise.resolve(cached)

  const inFlight = pending.get(source)
  if (inFlight) return inFlight

  const request = fetchCatalog(source, config).finally(() => pending.delete(source))
  pending.set(source, request)
  return request
}

/**
 * Admin-only catalog endpoint for the pack creator.
 * Sources: imgflip, memegen, memegenscript, memegenrs.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ source: string }> },
) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { source } = await params
  const config = SOURCES[source]
  if (!config) return NextResponse.json({ error: 'Unknown meme source' }, { status: 404 })

  try {
    const entry = await loadCatalog(source, config)
    return NextResponse.json(
      {
        source,
        label: config.label,
        memes: entry.memes,
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    console.error(
      `${config.label} catalog failed:`,
      error instanceof Error ? error.message : 'unknown error',
    )
    return NextResponse.json({ error: `Failed to load ${config.label} templates` }, { status: 502 })
  }
}
