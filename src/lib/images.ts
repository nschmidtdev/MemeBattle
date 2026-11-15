/**
 * Client-safe image URL helper (no server-only imports).
 * Server storage code re-exports/uses this too.
 */
export function imageUrl(key: string): string {
  return `/api/images/${encodeURIComponent(key)}`
}
