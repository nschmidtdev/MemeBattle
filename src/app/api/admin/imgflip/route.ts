import { NextResponse } from 'next/server'
import { getSessionUserFromCookies } from '@/lib/auth'
import { normalizeImgflip, type SourceItem } from '@/lib/memeSources'

const IMGFLIP_ENDPOINT = 'https://api.imgflip.com/get_memes'
/** The catalog changes rarely; one upstream request per 10 minutes is plenty. */
const CACHE_TTL_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

interface CachedCatalog {
  memes: SourceItem[]
  fetchedAt: number
}

// Module-level cache (single server process). It is intentionally shared
// across admin sessions: the Imgflip catalog is public data.
let cache: CachedCatalog | null = null
let pending: Promise<CachedCatalog> | null = null

async function fetchCatalog(): Promise<CachedCatalog> {
  const response = await fetch(IMGFLIP_ENDPOINT, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Imgflip responded with HTTP ${response.status}`)
  }

  const payload: unknown = await response.json()
  const memes = normalizeImgflip(payload)
  if (memes.length === 0) {
    throw new Error('Imgflip returned no usable memes')
  }

  const entry: CachedCatalog = { memes, fetchedAt: Date.now() }
  cache = entry
  return entry
}

function loadCatalog(): Promise<CachedCatalog> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(cache)
  }
  if (!pending) {
    // Collapse concurrent cache misses into one upstream request.
    pending = fetchCatalog().finally(() => {
      pending = null
    })
  }
  return pending
}

/** Admin-only: the current Imgflip template catalog, normalised for the client. */
export async function GET() {
  const user = await getSessionUserFromCookies()
  if (!user) return NextResponse.json({ error: 'Not authorized' }, { status: 401 })

  try {
    const entry = await loadCatalog()
    return NextResponse.json(
      {
        memes: entry.memes,
        fetchedAt: new Date(entry.fetchedAt).toISOString(),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    // Only the upstream failure category is logged; the response carries no
    // session, cookie or request details.
    console.error(
      'Imgflip get_memes failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return NextResponse.json({ error: 'Failed to load Imgflip templates' }, { status: 502 })
  }
}
