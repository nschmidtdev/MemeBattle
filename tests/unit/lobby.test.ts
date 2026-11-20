import { describe, expect, it, vi } from 'vitest'
import { normalizeSettings, sanitizeLobbyName, sanitizeUsername } from '../../src/server/lobby'

// `lobby.ts` imports `./templates`, which pulls in the Prisma client. The unit
// tests only exercise pure helpers, so the module is mocked to keep a database
// (and DATABASE_URL) out of the test process entirely.
vi.mock('../../src/server/templates', () => ({
  loadTemplates: vi.fn(),
}))

describe('normalizeSettings', () => {
  it('applies the documented defaults for missing input', () => {
    expect(normalizeSettings(undefined)).toEqual({
      rounds: 3,
      rerolls: 10,
      captionTime: 45,
      voteTime: 10,
      packIds: [],
      lobbyName: 'Meme Lobby',
    })
    expect(normalizeSettings(null)).toEqual(normalizeSettings(undefined))
    expect(normalizeSettings({})).toEqual(normalizeSettings(undefined))
    expect(normalizeSettings('not-an-object')).toEqual(normalizeSettings(undefined))
  })

  it('keeps valid values', () => {
    expect(
      normalizeSettings({ rounds: 5, rerolls: 12, captionTime: 30, voteTime: 7, packIds: ['p1', 'p2'], lobbyName: 'Friday' }),
    ).toEqual({
      rounds: 5,
      rerolls: 12,
      captionTime: 30,
      voteTime: 7,
      packIds: ['p1', 'p2'],
      lobbyName: 'Friday',
    })
  })

  it('clamps rounds to 1..10', () => {
    expect(normalizeSettings({ rounds: 0 }).rounds).toBe(1)
    expect(normalizeSettings({ rounds: -5 }).rounds).toBe(1)
    expect(normalizeSettings({ rounds: 11 }).rounds).toBe(10)
    expect(normalizeSettings({ rounds: 1 }).rounds).toBe(1)
    expect(normalizeSettings({ rounds: 10 }).rounds).toBe(10)
  })

  it('clamps rerolls to 0..20 and defaults to 10', () => {
    expect(normalizeSettings({}).rerolls).toBe(10)
    expect(normalizeSettings({ rerolls: -1 }).rerolls).toBe(0)
    expect(normalizeSettings({ rerolls: 0 }).rerolls).toBe(0)
    expect(normalizeSettings({ rerolls: 20 }).rerolls).toBe(20)
    expect(normalizeSettings({ rerolls: 21 }).rerolls).toBe(20)
    expect(normalizeSettings({ rerolls: 9.9 }).rerolls).toBe(9)
  })

  it('clamps captionTime to 5..120', () => {
    expect(normalizeSettings({ captionTime: 4 }).captionTime).toBe(5)
    expect(normalizeSettings({ captionTime: 5 }).captionTime).toBe(5)
    expect(normalizeSettings({ captionTime: 120 }).captionTime).toBe(120)
    expect(normalizeSettings({ captionTime: 121 }).captionTime).toBe(120)
  })

  it('clamps voteTime to 3..60', () => {
    expect(normalizeSettings({ voteTime: 2 }).voteTime).toBe(3)
    expect(normalizeSettings({ voteTime: 3 }).voteTime).toBe(3)
    expect(normalizeSettings({ voteTime: 60 }).voteTime).toBe(60)
    expect(normalizeSettings({ voteTime: 600 }).voteTime).toBe(60)
  })

  it('floors decimals and accepts numeric strings', () => {
    const settings = normalizeSettings({ rounds: 4.9, captionTime: '30', voteTime: '8.7' })
    expect(settings.rounds).toBe(4)
    expect(settings.captionTime).toBe(30)
    expect(settings.voteTime).toBe(8)
  })

  it('falls back for non-numeric, empty or non-finite values', () => {
    for (const value of ['abc', '', '   ', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
      const settings = normalizeSettings({ rounds: value, rerolls: value, captionTime: value, voteTime: value })
      expect(settings.rounds).toBe(3)
      expect(settings.rerolls).toBe(10)
      expect(settings.captionTime).toBe(45)
      expect(settings.voteTime).toBe(10)
    }
  })

  it('returns [] for packIds that is not an array', () => {
    for (const packIds of [undefined, null, 'p1', { 0: 'p1' }, 42]) {
      expect(normalizeSettings({ packIds }).packIds).toEqual([])
    }
  })

  it('trims packIds, drops empty/non-string entries and removes duplicates', () => {
    const settings = normalizeSettings({
      packIds: ['  p1  ', 'p1', '', '   ', 'p2', 42, null, 'p3', 'p2'],
    })

    expect(settings.packIds).toEqual(['p1', 'p2', 'p3'])
  })

  it('keeps at most 100 packIds', () => {
    const packIds = Array.from({ length: 150 }, (_, i) => `pack-${i}`)

    const settings = normalizeSettings({ packIds })

    expect(settings.packIds).toHaveLength(100)
    expect(settings.packIds).toEqual(packIds.slice(0, 100))
  })

  it('counts the 100-id cap after deduplication and trimming', () => {
    const packIds = [...Array.from({ length: 99 }, (_, i) => `p${i}`), ' p0 ', 'p99', 'p100', 'p101']

    expect(normalizeSettings({ packIds }).packIds).toEqual([
      ...Array.from({ length: 100 }, (_, i) => `p${i}`),
    ])
  })

  it('collapses lobby name whitespace and caps it at 24 characters', () => {
    expect(normalizeSettings({ lobbyName: '  My   Meme   Lobby  ' }).lobbyName).toBe('My Meme Lobby')
    expect(normalizeSettings({ lobbyName: 'x'.repeat(30) }).lobbyName).toBe('x'.repeat(24))
    expect(normalizeSettings({ lobbyName: 'abcdefghijklmnopqrstuvwxyz' }).lobbyName).toHaveLength(24)
  })

  it('falls back to "Meme Lobby" for missing/blank/non-string lobby names', () => {
    for (const lobbyName of [undefined, null, '', '   ', '\n\t', 42]) {
      expect(normalizeSettings({ lobbyName }).lobbyName).toBe('Meme Lobby')
    }
    expect(normalizeSettings({ lobbyName: '    ' }).lobbyName).toBe('Meme Lobby')
  })

  it('ignores unknown properties', () => {
    const settings = normalizeSettings({ rounds: 2, nonsense: true })
    expect(settings).toEqual({ rounds: 2, rerolls: 10, captionTime: 45, voteTime: 10, packIds: [], lobbyName: 'Meme Lobby' })
  })
})

describe('sanitizeLobbyName', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeLobbyName('  Friday   Night  ')).toBe('Friday Night')
  })

  it('caps the name at 24 characters', () => {
    expect(sanitizeLobbyName('x'.repeat(40))).toBe('x'.repeat(24))
  })

  it('returns the fallback for non-strings and blank input', () => {
    expect(sanitizeLobbyName(undefined)).toBe('Meme Lobby')
    expect(sanitizeLobbyName(42)).toBe('Meme Lobby')
    expect(sanitizeLobbyName('   ')).toBe('Meme Lobby')
  })
})

describe('sanitizeUsername', () => {
  it('trims and collapses internal whitespace', () => {
    expect(sanitizeUsername('  Alice \n\t  Bob  ')).toBe('Alice Bob')
  })

  it('caps the username at 16 characters', () => {
    expect(sanitizeUsername('abcdefghijklmnop')).toBe('abcdefghijklmnop')
    expect(sanitizeUsername('abcdefghijklmnopq')).toBe('abcdefghijklmnop')
    expect(sanitizeUsername('x'.repeat(100))).toBe('x'.repeat(16))
  })

  it('returns "Player" for empty, blank or non-string input', () => {
    for (const raw of ['', '   ', '\n\t', undefined, null, 42, {}, []]) {
      expect(sanitizeUsername(raw)).toBe('Player')
    }
  })

  it('keeps unicode names intact', () => {
    expect(sanitizeUsername('  Jürgen  ')).toBe('Jürgen')
    expect(sanitizeUsername('🐸🐸')).toBe('🐸🐸')
  })
})
