/**
 * Client-safe image URL helper (no server-only imports).
 * Server storage code re-exports/uses this too.
 */

/**
 * Bucketed display widths. The image route generates (and caches) a WebP
 * variant per bucket, so listing never explodes into thousands of sizes.
 */
export const IMAGE_WIDTH_STEPS = [160, 320, 480, 720, 900, 1200, 1440, 1800, 2048] as const

/** Snap a requested display width up to the next bucket; null when invalid. */
export function snapImageWidth(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return IMAGE_WIDTH_STEPS.find((step) => step >= n) ?? IMAGE_WIDTH_STEPS[IMAGE_WIDTH_STEPS.length - 1]
}

/**
 * URL for an image key. With a width the route serves a compressed WebP
 * variant capped to that size (uploads stay up to 10 MB originals otherwise).
 */
export function imageUrl(key: string, width?: number): string {
  const url = `/api/images/${encodeURIComponent(key)}`
  const snapped = width ? snapImageWidth(width) : null
  return snapped ? `${url}?w=${snapped}` : url
}

/** MIME types the upload endpoint accepts (SVG is rejected by the server). */
export const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp'
