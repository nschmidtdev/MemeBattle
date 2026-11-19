/**
 * Client-safe image URL helper (no server-only imports).
 * Server storage code re-exports/uses this too.
 */
export function imageUrl(key: string): string {
  return `/api/images/${encodeURIComponent(key)}`
}

/** MIME types the upload endpoint accepts (SVG is rejected by the server). */
export const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
