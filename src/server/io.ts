import type { Server, Socket } from 'socket.io'
import { Lobby, MAX_PLAYERS, generateCode, normalizeSettings, sanitizeUsername } from './lobby'
import type { LobbySettings } from '../lib/types'
import { Events } from '../lib/types'

/** Hard cap on live lobbies so a single client (or a bot) cannot exhaust memory. */
const MAX_LOBBIES = 200
/** Minimum time between two lobby creations by the same socket. */
const CREATE_COOLDOWN_MS = 3_000
/** Period for the public lobby list broadcast and the ghost/empty lobby sweep. */
const PUBLIC_LIST_INTERVAL_MS = 5_000
const SWEEP_INTERVAL_MS = 5_000

interface BoundSocket {
  lobby: Lobby
  playerId: string
}

function bind(socket: Socket, lobby: Lobby, playerId: string) {
  const b: BoundSocket = { lobby, playerId }
  socket.data.mb = b
  socket.join(lobby.code)
}

function unbind(socket: Socket) {
  const b = socket.data.mb as BoundSocket | undefined
  if (b) {
    delete socket.data.mb
    socket.leave(b.lobby.code)
  }
}

/** Drop the socket's current lobby binding before it joins or creates another one. */
function release(socket: Socket) {
  const b = socket.data.mb as BoundSocket | undefined
  if (!b) return
  b.lobby.leave(socket.id)
  unbind(socket)
}

function emitError(socket: Socket, message: string) {
  socket.emit(Events.Error, { message })
}

/**
 * Wrap a socket handler so sync throws and async rejections are contained.
 * A failing handler must never take down the process.
 */
function guard<Args extends unknown[]>(
  socket: Socket,
  event: string,
  fn: (...args: Args) => unknown,
) {
  return (...args: Args) => {
    const fail = (e: unknown) => {
      console.error(`${event} handler failed`, e)
      emitError(socket, 'Something went wrong.')
    }
    try {
      const result = fn(...args)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        Promise.resolve(result).catch(fail)
      }
    } catch (e) {
      fail(e)
    }
  }
}

export function initSockets(io: Server): () => void {
  const lobbies = new Map<string, Lobby>()
  const timerHandles: NodeJS.Timeout[] = []

  /** Enforce the global lobby cap and the per-socket create cooldown. */
  function canCreateLobby(socket: Socket): boolean {
    if (lobbies.size >= MAX_LOBBIES) {
      emitError(socket, 'Server is busy. Try again later.')
      return false
    }
    const lastCreateAt = typeof socket.data.lastCreateAt === 'number' ? socket.data.lastCreateAt : 0
    if (Date.now() - lastCreateAt < CREATE_COOLDOWN_MS) {
      emitError(socket, 'Please wait before creating another lobby.')
      return false
    }
    return true
  }

  function createLobby(
    name: string,
    isPublic: boolean,
    settings: unknown,
    hostSocket: Socket,
    hostUsername: string,
  ): { lobby: Lobby; player: ReturnType<Lobby['addPlayerPublic']> } | null {
    if (!canCreateLobby(hostSocket)) return null

    let code = generateCode()
    while (lobbies.has(code)) code = generateCode()
    // Normalisation lives in Lobby/normalizeSettings; do not merge defaults here.
    const normalized = normalizeSettings({ ...(settings as object), lobbyName: name })
    const lobby = new Lobby(code, name, isPublic, normalized, {
      broadcast: (event, payload) => io.to(code).emit(event, payload),
      sendTo: (socketId, event, payload) => io.to(socketId).emit(event, payload),
    })
    const player = lobby.addPlayerPublic(sanitizeUsername(hostUsername), hostSocket.id)
    hostSocket.data.lastCreateAt = Date.now()
    lobbies.set(code, lobby)
    lobby.broadcast(Events.LobbyUpdate, lobby.fullLobbyUpdate())
    return { lobby, player }
  }

  io.on('connection', (socket) => {
    socket.on(
      Events.PublicList,
      guard(socket, Events.PublicList, () => {
        const list = [...lobbies.values()].filter((l) => l.isPublic).map((l) => l.publicInfo())
        socket.emit(Events.PublicLobbies, { lobbies: list })
      }),
    )

    socket.on(
      Events.Join,
      guard(socket, Events.Join, async (data: Record<string, unknown>) => {
        const username = sanitizeUsername(data?.username)
        const code = typeof data?.code === 'string' ? data.code.trim().toUpperCase() : null
        const playerId = typeof data?.playerId === 'string' ? data.playerId : null
        const isPublic = data?.isPublic === true

        // Rejoining the same lobby on the same socket keeps the seat (and host role)
        // instead of leaving and accidentally removing it.
        const existing = socket.data.mb as BoundSocket | undefined
        if (existing && code && existing.lobby.code === code) {
          socket.emit(Events.LobbyJoined, { code: existing.lobby.code, playerId: existing.playerId })
          existing.lobby.resume(socket.id, existing.playerId)
          return
        }
        // Rejoining or creating must not leave a phantom lobby or a connected ghost behind.
        release(socket)

        if (code) {
          const lobby = lobbies.get(code)
          if (!lobby) {
            emitError(socket, `Lobby ${code} not found.`)
            return
          }
          const res = lobby.join(socket.id, playerId, username)
          if (res.error || !res.player) {
            emitError(socket, res.error ?? 'Could not join lobby.')
            return
          }
          bind(socket, lobby, res.player.id)
          lobby.broadcast(Events.LobbyUpdate, lobby.fullLobbyUpdate())
          socket.emit(Events.LobbyJoined, { code: lobby.code, playerId: res.player.id })
          lobby.resume(socket.id, res.player.id)
        } else if (data?.create === true) {
          const created = createLobby(
            sanitizeUsername(String(data.lobbyName ?? 'Meme Lobby')),
            isPublic,
            data.settings ?? {},
            socket,
            username,
          )
          if (!created) return
          bind(socket, created.lobby, created.player.id)
          socket.emit(Events.LobbyJoined, { code: created.lobby.code, playerId: created.player.id })
          created.lobby.resume(socket.id, created.player.id)
        } else {
          // Quick play: join an existing public lobby with room, or create one.
          let target: Lobby | undefined = [...lobbies.values()].find(
            (l) => l.isPublic && l.phase === 'lobby' && l.playerCount() < MAX_PLAYERS,
          )
          let player: ReturnType<Lobby['addPlayerPublic']> | undefined
          if (target) {
            const res = target.join(socket.id, playerId, username)
            if (res.error || !res.player) {
              target = undefined
            } else {
              player = res.player
            }
          }
          if (!target) {
            // Quick Play lobbies are always public so others can quick-join into them.
            const created = createLobby('Quick Play', true, {}, socket, username)
            if (!created) return
            target = created.lobby
            player = created.player
          }
          if (!player) return
          bind(socket, target, player.id)
          target.broadcast(Events.LobbyUpdate, target.fullLobbyUpdate())
          socket.emit(Events.LobbyJoined, { code: target.code, playerId: player.id })
          target.resume(socket.id, player.id)
        }
      }),
    )

    socket.on(
      Events.Leave,
      guard(socket, Events.Leave, () => {
        release(socket)
      }),
    )

    socket.on(
      Events.Settings,
      guard(socket, Events.Settings, (data: Record<string, unknown>) => {
        const b = socket.data.mb as BoundSocket | undefined
        if (!b) return
        const err = b.lobby.setSettings(socket.id, (data ?? {}) as Partial<LobbySettings>)
        if (err) emitError(socket, err)
      }),
    )

    socket.on(
      Events.Start,
      guard(socket, Events.Start, async () => {
        const b = socket.data.mb as BoundSocket | undefined
        if (!b) return
        const err = await b.lobby.start(socket.id)
        if (err) emitError(socket, err)
      }),
    )

    socket.on(
      Events.CaptionSubmit,
      guard(socket, Events.CaptionSubmit, (data: unknown) => {
        const b = socket.data.mb as BoundSocket | undefined
        if (!b) return
        const err = b.lobby.submitCaption(socket.id, data as never)
        if (err) emitError(socket, err)
      }),
    )

    socket.on(
      Events.Reroll,
      guard(socket, Events.Reroll, () => {
        const b = socket.data.mb as BoundSocket | undefined
        if (!b) return
        const err = b.lobby.reroll(socket.id)
        if (err) emitError(socket, err)
      }),
    )

    socket.on(
      Events.Vote,
      guard(socket, Events.Vote, (data: Record<string, unknown>) => {
        const b = socket.data.mb as BoundSocket | undefined
        if (!b) return
        const err = b.lobby.castVote(socket.id, Number(data?.index), data?.value as never)
        if (err) emitError(socket, err)
      }),
    )

    socket.on(
      Events.PlayAgain,
      guard(socket, Events.PlayAgain, () => {
        const b = socket.data.mb as BoundSocket | undefined
        if (!b) return
        const err = b.lobby.playAgain(socket.id)
        if (err) emitError(socket, err)
      }),
    )

    socket.on(
      Events.Kick,
      guard(socket, Events.Kick, (data: Record<string, unknown>) => {
        const b = socket.data.mb as BoundSocket | undefined
        if (!b) return
        const targetId = String(data?.playerId ?? '')
        // Remember the bound socket before the player is removed from the lobby.
        const targetSocketId = b.lobby.playerSocketId(targetId)
        const err = b.lobby.kick(socket.id, targetId)
        if (err) {
          emitError(socket, err)
          return
        }
        if (targetSocketId) {
          const ts = io.sockets.sockets.get(targetSocketId)
          if (ts) {
            // Detach the kicked client so it stops receiving phase events. The kick
            // broadcast already went out through the lobby hook.
            ts.leave(b.lobby.code)
            delete ts.data.mb
          }
        }
      }),
    )

    socket.on(
      'disconnect',
      guard(socket, 'disconnect', () => {
        const b = socket.data.mb as BoundSocket | undefined
        if (!b) return
        // Ghost the player instead of removing it: client-side navigation disconnects the
        // previous socket right after joining, and the lobby must survive that.
        b.lobby.disconnect(socket.id)
        unbind(socket)
      }),
    )
  })

  // Re-broadcast the public list periodically so the start page stays fresh.
  timerHandles.push(
    setInterval(() => {
      const list = [...lobbies.values()].filter((l) => l.isPublic).map((l) => l.publicInfo())
      io.emit(Events.PublicLobbies, { lobbies: list })
    }, PUBLIC_LIST_INTERVAL_MS),
  )

  // Remove ghosted players after GHOST_TTL_MS and drop lobbies that are left empty
  // (covers both TTL expiry and explicit leaves of the last player).
  timerHandles.push(
    setInterval(() => {
      const now = Date.now()
      for (const [code, lobby] of [...lobbies]) {
        if (lobby.sweep(now)) {
          lobbies.delete(code)
          lobby.destroy()
        }
      }
    }, SWEEP_INTERVAL_MS),
  )

  return () => {
    for (const t of timerHandles) clearInterval(t)
    timerHandles.length = 0
  }
}
