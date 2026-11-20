import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The +18 gate needs the pack lookup from the database. Mocking it keeps these
 * tests pure: 'adult' is the only pack flagged as adult.
 */
vi.mock('../../src/server/templates', () => ({
  loadTemplates: vi.fn(async () => []),
  loadAdultPackIds: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => id === 'adult'))),
}))

import { Lobby, type LobbyHooks } from '../../src/server/lobby'
import { Events, type LobbySettings } from '../../src/lib/types'

function makeLobby(packIds: string[] = ['adult']) {
  const events: Array<{ event: string; payload: unknown; socketId?: string }> = []
  const hooks: LobbyHooks = {
    broadcast: (event, payload) => events.push({ event, payload }),
    sendTo: (socketId, event, payload) => events.push({ event, payload, socketId }),
  }
  const settings: LobbySettings = {
    mode: 'normal',
    rounds: 2,
    rerolls: 10,
    captionTime: 45,
    voteTime: 10,
    packIds,
    lobbyName: 'Adult Test',
  }
  return { lobby: new Lobby('ADULT', 'Adult Test', false, settings, hooks), events }
}

function prompts(events: Array<{ event: string; socketId?: string }>, socketId?: string) {
  return events.filter(
    (entry) =>
      entry.event === Events.AdultPrompt && (socketId === undefined || entry.socketId === socketId),
  )
}

describe('Lobby +18 gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks a lobby as adult only when a selected pack is adult', async () => {
    const { lobby } = makeLobby(['adult'])
    await lobby.refreshAdultPacks(false)
    expect(lobby.hasAdultPacks()).toBe(true)

    const plain = makeLobby(['classic'])
    await plain.lobby.refreshAdultPacks(false)
    expect(plain.lobby.hasAdultPacks()).toBe(false)
  })

  it('prompts a joining player once and records the answer', async () => {
    const { lobby, events } = makeLobby()
    await lobby.refreshAdultPacks(false)
    const p = lobby.addPlayerPublic('Alice', 's1')
    events.length = 0

    lobby.resume('s1', p.id)
    expect(prompts(events, 's1').length).toBe(1)

    expect(lobby.answerAdult('s1', true)).toBeNull()
    expect(lobby.playerInfos().find((info) => info.id === p.id)?.adultOk).toBe(true)

    // A reconnect after confirming must not prompt again.
    events.length = 0
    lobby.resume('s1', p.id)
    expect(prompts(events, 's1').length).toBe(0)
  })

  it('removes a player who declines and sends the dedicated event', async () => {
    const { lobby, events } = makeLobby()
    await lobby.refreshAdultPacks(false)
    const host = lobby.addPlayerPublic('Host', 's1')
    const guest = lobby.addPlayerPublic('Guest', 's2')
    events.length = 0

    expect(lobby.answerAdult('s1', true)).toBeNull()
    expect(lobby.answerAdult('s2', false)).toBeNull()

    expect(lobby.playerInfos().map((info) => info.id)).toEqual([host.id])
    expect(guest.id).not.toBe(host.id)
    expect(events.some((entry) => entry.event === Events.AdultDeclined && entry.socketId === 's2')).toBe(
      true,
    )
  })

  it('blocks the start until every connected player confirmed, host included', async () => {
    const { lobby } = makeLobby()
    await lobby.refreshAdultPacks(false)
    lobby.addPlayerPublic('Host', 's1')
    lobby.addPlayerPublic('Guest', 's2')

    expect(await lobby.start('s1')).toBe('Waiting for +18 confirmations (0/2).')

    lobby.answerAdult('s1', true)
    expect(await lobby.start('s1')).toBe('Waiting for +18 confirmations (1/2).')

    lobby.answerAdult('s2', true)
    // The gate passed: the mocked catalog is empty, which is the next error.
    expect(await lobby.start('s1')).toBe('No active templates found in the selected packs.')
  })

  it('does not gate non-adult lobbies', async () => {
    const { lobby, events } = makeLobby(['classic'])
    await lobby.refreshAdultPacks(false)
    lobby.addPlayerPublic('Host', 's1')
    lobby.addPlayerPublic('Guest', 's2')

    expect(await lobby.start('s1')).toBe('No active templates found in the selected packs.')
    expect(prompts(events).length).toBe(0)
  })

  it('prompts everyone unconfirmed when adult packs are enabled later', async () => {
    const { lobby, events } = makeLobby(['classic'])
    await lobby.refreshAdultPacks(false)
    const host = lobby.addPlayerPublic('Host', 's1')
    const guest = lobby.addPlayerPublic('Guest', 's2')

    // Simulate the host selecting the adult pack afterwards.
    lobby.settings = { ...lobby.settings, packIds: ['classic', 'adult'] }
    events.length = 0
    await lobby.refreshAdultPacks(true)

    expect(lobby.hasAdultPacks()).toBe(true)
    // Nobody was asked before, so both players are prompted (host included).
    expect(prompts(events, 's1').length).toBe(1)
    expect(prompts(events, 's2').length).toBe(1)
    expect(lobby.playerInfos().find((info) => info.id === host.id)?.adultOk).toBe(false)
    expect(lobby.playerInfos().find((info) => info.id === guest.id)?.adultOk).toBe(false)
  })
})
