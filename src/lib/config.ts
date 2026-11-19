import path from 'path'
import fs from 'fs'

interface CorsOriginConfig {
  /** Explicit allowed origins, normalized to URL origins (empty = same-origin only). */
  origins: string[]
  /** True when CORS_ORIGIN contains "*". */
  allowAll: boolean
}

function parsePort(raw: string): number {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid PORT "${raw}": expected an integer between 1 and 65535.`)
  }
  const port = Number(trimmed)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${raw}": expected an integer between 1 and 65535.`)
  }
  return port
}

function parseCorsOrigins(raw: string): CorsOriginConfig {
  const origins: string[] = []
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (entry === '*') {
      origins.push('*')
      continue
    }
    try {
      const url = new URL(entry)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
      origins.push(url.origin)
    } catch {
      throw new Error(
        `Invalid CORS_ORIGIN entry "${entry}": expected "*" or an http(s) origin such as https://example.com.`,
      )
    }
  }
  return { origins, allowAll: origins.includes('*') }
}

const cors = parseCorsOrigins(process.env.CORS_ORIGIN?.trim() ?? '')

export const config = {
  port: parsePort(process.env.PORT || '3000'),
  uploadDir: path.resolve(process.env.UPLOAD_DIR?.trim() || './data/uploads'),
  /** Unset = same-origin only. The app and its socket endpoint share one origin. */
  corsOrigins: cors.origins,
  /** True when CORS_ORIGIN contains "*" (allow every origin). */
  corsAllowAll: cors.allowAll,
}

// Make sure the upload dir exists (server + route handlers both use it).
fs.mkdirSync(config.uploadDir, { recursive: true })
