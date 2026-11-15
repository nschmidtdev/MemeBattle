/**
 * Node 26 no longer exposes AsyncLocalStorage as a global.
 * Next.js's app renderer looks it up on globalThis when its modules load,
 * so it must be set BEFORE any `next` module is imported.
 *
 * This file MUST be imported first in server.ts.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const g = globalThis as Record<string, unknown>
if (g.AsyncLocalStorage === undefined) {
  g.AsyncLocalStorage = AsyncLocalStorage
}
