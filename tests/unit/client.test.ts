import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomId } from '../../src/lib/client'

const HEX_ID = /^[0-9a-f]{32}$/i

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('randomId', () => {
  it('returns a 32 character hex id capped to MAX_ID_LENGTH', () => {
    const id = randomId()

    expect(id).toHaveLength(32)
    expect(id).toMatch(HEX_ID)
  })

  it('returns a different id on every call', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomId()))
    expect(ids.size).toBe(1000)
  })

  it('falls back to a base36 id when crypto.randomUUID is unavailable', () => {
    // Simulates older/non-secure browser contexts.
    vi.stubGlobal('crypto', {})

    const id = randomId()

    expect(id.length).toBeGreaterThan(8)
    expect(id).toMatch(/^[a-z0-9]+$/)
  })
})
