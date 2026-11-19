import { loadEnvConfig } from '@next/env'

/**
 * Load `.env*` files before any project module reads `process.env`.
 *
 * `server.ts` imports this immediately after the polyfills and before
 * `src/lib/config.ts`, whose values are computed at import time. Next.js does
 * the same internally, but only once `next` has been imported - too late for
 * modules evaluated before it. Variables already present in the process
 * environment always win over values from `.env` files.
 */
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')
