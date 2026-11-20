import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The voting gate only needs the template catalog. Mocking it keeps these
 * tests pure and avoids a database roundtrip.
 */
vi.mock('../../src/server/templates', () => ({
  loadTemplates: vi.fn(async () => [
    { id: 'tpl-1', name: 'One', imageKey: 'public:test-1.svg', isFreeform: false, boxes: [] },
    { id: 'tpl-2', name: 'Two', imageKey: 'public:test-2.svg', isFreeform: false, boxes: [] },
  ]),
  loadAdultPackIds: vi.fn(async () => new Set<string>()),
}))

import { Lobby, VOTING_GATE_TIMEOUT_MS, type LobbyHooks } from '../../src/server/lobby'
import { Events, type LobbySettings } from '../../src/lib/types'

function makeLobby() {
  const events: Array<{ event: string; payload: unknown; socketId?: string }> = []
  const hooks: LobbyHooks = {
    broadcast: (event, payload) => events.push({ event, payload }),
    sendTo: (socketId, event, payload) => events.push({ event, payload, socketId }),
  }
  const settings: LobbySettings = {
    mode: 'normal',
    rounds: 1,
    rerolls: 0,
    captionTime: 5,
    voteTime: 5,
    packIds: ['classic'],
    lobbyName: 'Voting Gate',
    forceSubmission: true,
  }
  const lobby = new Lobby('GATE', 'Voting Gate', false, settings, hooks)
  return { lobby, events }
}

/** Start a round and let the caption early-exit move the lobby into voting. */
async function beginVoting(lobby: Lobby) {
  lobby.addPlayerPublic('Host', 's1')
  lobby.addPlayerPublic('Guest', 's2')
  expect(await lobby.start('s1')).toBeNull()
  lobby.submitCaption('s1', { texts: { a: 'one' }, lines: [] })
  lobby.submitCaption('s2', { texts: { a: 'two' }, lines: [] })
  vi.advanceTimersByTime(1000)
}

function goEvents(events: Array<{ event: string; payload: unknown }>) {
  return events.filter((entry) => entry.event === Events.VotingGo)
}

describe('Lobby voting gate', () => {
  let lobby: Lobby | null = null

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    lobby?.destroy()
    lobby = null
    vi.useRealTimers()
  })

  it('holds the meme until every connected client reported it rendered', async () => {
    const ctx = makeLobby()
    lobby = ctx.lobby
    await beginVoting(lobby)

    const progress = ctx.events.filter((entry) => entry.event === Events.VotingProgress)
    expect(progress).toHaveLength(1)
    expect(progress[0].payload).toMatchObject({ index: 0, held: true, timeLeft: null })
    expect(goEvents(ctx.events)).toHaveLength(0)

    lobby.markVotingReady('s1', 0)
    expect(goEvents(ctx.events)).toHaveLength(0)

    lobby.markVotingReady('s2', 0)
    const go = goEvents(ctx.events)
    expect(go).toHaveLength(1)
    expect(go[0].payload).toMatchObject({ index: 0, timeLeft: 5 })
  })

  it('starts the clock after the timeout when a client never acknowledges', async () => {
    const ctx = makeLobby()
    lobby = ctx.lobby
    await beginVoting(lobby)

    lobby.markVotingReady('s1', 0)
    vi.advanceTimersByTime(VOTING_GATE_TIMEOUT_MS - 100)
    expect(goEvents(ctx.events)).toHaveLength(0)

    vi.advanceTimersByTime(100)
    const go = goEvents(ctx.events)
    expect(go).toHaveLength(1)
    expect(go[0].payload).toMatchObject({ index: 0, timeLeft: 5 })
  })

  it('stops waiting for a client that disconnects', async () => {
    const ctx = makeLobby()
    lobby = ctx.lobby
    await beginVoting(lobby)

    lobby.markVotingReady('s1', 0)
    lobby.disconnect('s2')
    expect(goEvents(ctx.events)).toHaveLength(1)
  })

  it('ignores stale and repeated acknowledgements', async () => {
    const ctx = makeLobby()
    lobby = ctx.lobby
    await beginVoting(lobby)

    // Wrong meme index: no effect.
    lobby.markVotingReady('s1', 1)
    expect(goEvents(ctx.events)).toHaveLength(0)

    lobby.markVotingReady('s1', 0)
    lobby.markVotingReady('s2', 0)
    expect(goEvents(ctx.events)).toHaveLength(1)

    // Late duplicate after the clock started: still one go, no restart.
    lobby.markVotingReady('s1', 0)
    expect(goEvents(ctx.events)).toHaveLength(1)
  })

  it('only advances the meme once the full vote time ran from go', async () => {
    const ctx = makeLobby()
    lobby = ctx.lobby
    await beginVoting(lobby)

    // No ack yet: the clock is not running and must not advance.
    vi.advanceTimersByTime(VOTING_GATE_TIMEOUT_MS - 100)
    expect(ctx.events.filter((entry) => entry.event === Events.VotingProgress)).toHaveLength(1)

    lobby.markVotingReady('s1', 0)
    lobby.markVotingReady('s2', 0)
    vi.advanceTimersByTime(4900)
    expect(ctx.events.filter((entry) => entry.event === Events.VotingProgress)).toHaveLength(1)

    vi.advanceTimersByTime(100)
    const progress = ctx.events.filter((entry) => entry.event === Events.VotingProgress)
    expect(progress).toHaveLength(2)
    expect(progress[1].payload).toMatchObject({ index: 1, held: true })
  })
})
