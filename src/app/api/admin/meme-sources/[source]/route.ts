import { NextResponse } from 'next/server'
import { getSessionUserFromCookies } from '@/lib/auth'
import { ImgflipAuthError, isImgflipPremiumConfigured, searchImgflipTemplates } from '@/lib/imgflip'
import {
  normalizeImgflip,
  normalizeMemegen,
  normalizeMemegenscript,
  normalizeMemegenRs,
  type SourceItem,
} from '@/lib/memeSources'

const CACHE_TTL_MS = 10 * 60 * 1000
/** Search results change slowly and each miss costs a premium API call. */
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const SEARCH_CACHE_MAX = 50
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

interface CachedSearch {
  memes: SourceItem[]
  fetchedAt: number
}

// One cache per source, collapsed concurrent misses, single server process.
const caches = new Map<string, CachedCatalog>()
const pending = new Map<string, Promise<CachedCatalog>>()
const searchCaches = new Map<string, CachedSearch>()
const searchPending = new Map<string, Promise<CachedSearch>>()

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
 * Premium catalog search with a small bounded cache. A miss only costs one
 * upstream call; the cache keeps repeated searches and debounce retries cheap.
 */
function searchCatalog(query: string): Promise<CachedSearch> {
  const key = query.trim().toLowerCase()
  const cached = searchCaches.get(key)
  if (cached && Date.now() - cached.fetchedAt < SEARCH_CACHE_TTL_MS) return Promise.resolve(cached)

  const inFlight = searchPending.get(key)
  if (inFlight) return inFlight

  const request = searchImgflipTemplates(key)
    .then((memes) => {
      const entry: CachedSearch = { memes, fetchedAt: Date.now() }
      searchCaches.set(key, entry)
      while (searchCaches.size > SEARCH_CACHE_MAX) {
        const oldest = searchCaches.keys().next().value
        if (oldest === undefined) break
        searchCaches.delete(oldest)
      }
      return entry
    })
    .finally(() => searchPending.delete(key))
  searchPending.set(key, request)
  return request
}

/**
 * Admin-only catalog endpoint for the pack creator.
 * Sources: imgflip, memegen, memegenscript, memegenrs.
 * `?q=` on imgflip triggers the premium full-catalog search (IMGFLIP_API_KEY).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ source: string }> },
) {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  const { source } = await params
  const config = SOURCES[source]
  if (!config) return NextResponse.json({ error: 'Unknown meme source' }, { status: 404 })

  const premium = source === 'imgflip' ? isImgflipPremiumConfigured() : undefined
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''

  if (source === 'imgflip' && query) {
    try {
      const entry = await searchCatalog(query)
      return NextResponse.json(
        {
          source,
          label: config.label,
          memes: entry.memes,
          fetchedAt: new Date(entry.fetchedAt).toISOString(),
          premium: true,
          query,
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      )
    } catch (error) {
      if (error instanceof ImgflipAuthError) {
        console.error('Imgflip premium search rejected:', error.message)
        return NextResponse.json(
          {
            error: premium
              ? 'Imgflip rejected the API key — check IMGFLIP_API_KEY.'
              : 'Imgflip premium search is not configured. Set IMGFLIP_API_KEY on the server.',
          },
          { status: 502 },
        )
      }
      console.error(
        'Imgflip premium search failed:',
        error instanceof Error ? error.message : 'unknown error',
      )
      return NextResponse.json({ error: 'Failed to search Imgflip templates' }, { status: 502 })
    }
  }

  try {
    const entry = await loadCatalog(source, config)
    return NextResponse.json(
      {
        source,
        label: config.label,
        memes: entry.memes,
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
        ...(premium !== undefined ? { premium } : {}),
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
