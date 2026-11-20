/**
 * Imgflip API client.
 *
 * `get_memes` is public (top 100). The premium endpoints (`search_memes`,
 * `get_meme`, ...) need an API key and are available with an Imgflip account
 * subscription. Server-only: the key must never reach the client bundle.
 */
import { config } from './config'
import { normalizeImgflip, type SourceItem } from './memeSources'

const API_BASE = 'https://api.imgflip.com'
const FETCH_TIMEOUT_MS = 15_000

/** Longest search term sent upstream (Imgflip is not a general search engine). */
export const IMGFLIP_MAX_QUERY = 100

/** True when an Imgflip API key is configured (enables premium catalog search). */
export function isImgflipPremiumConfigured(): boolean {
  return Boolean(config.imgflipApiKey)
}

/**
 * The key was missing, rejected (401/403) or the API reported `success: false`.
 * Callers turn this into a clear admin-facing message instead of a 500.
 */
export class ImgflipAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImgflipAuthError'
  }
}

/**
 * Search the full Imgflip template catalog (premium). Returns [] for an empty
 * query without hitting the network. Throws ImgflipAuthError when the key is
 * missing or rejected.
 */
export async function searchImgflipTemplates(query: string): Promise<SourceItem[]> {
  const key = config.imgflipApiKey
  if (!key) throw new ImgflipAuthError('Imgflip premium API key is not configured.')

  const q = query.trim().slice(0, IMGFLIP_MAX_QUERY)
  if (!q) return []

  const url = `${API_BASE}/search_memes?q=${encodeURIComponent(q)}`
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (response.status === 401 || response.status === 403) {
    throw new ImgflipAuthError('Imgflip rejected the API key.')
  }
  if (!response.ok) {
    throw new Error(`Imgflip responded with HTTP ${response.status}`)
  }

  const payload: unknown = await response.json().catch(() => null)
  if (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { success?: unknown }).success === false
  ) {
    const message = (payload as { error_message?: unknown }).error_message
    throw new ImgflipAuthError(
      typeof message === 'string' && message ? message : 'Imgflip rejected the request.',
    )
  }

  // `search_memes` uses the same { data: { memes: [...] } } shape as get_memes.
  return normalizeImgflip(payload)
}
