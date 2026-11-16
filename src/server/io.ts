import type { Server, Socket } from 'socket.io'
import { Lobby, MAX_PLAYERS, generateCode, sanitizeUsername } from './lobby'
import type { LobbySettings } from '../lib/types'
import { Events } from '../lib/types'

const DEFAULT_SETTINGS: LobbySettings = {
  rounds: 3,
  captionTime: 45,
  voteTime: 10,
  packIds: [],
  lobbyName: 'Meme Lobby',
}

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

export function initSockets(io: Server) {
  const lobbies = new Map<string, Lobby>()

  function createLobby(name: string, isPublic: boolean, settings: LobbySettings, hostSocket: Socket, hostUsername: string) {
    let code = generateCode()
    while (lobbies.has(code)) code = generateCode()
    const lobby = new Lobby(code, name, isPublic, { ...DEFAULT_SETTINGS, ...settings, lobbyName: name }, {
      broadcast: (event, payload) => io.to(code).emit(event, payload),
      sendTo: (socketId, event, payload) => io.to(socketId).emit(event, payload),
    })
    const player = lobby.addPlayerPublic(sanitizeUsername(hostUsername), hostSocket.id)
    lobbies.set(code, lobby)
    lobby.broadcast(Events.LobbyUpdate, lobby.fullLobbyUpdate())
    return { lobby, player }
  }

  function emitError(socket: Socket, message: string) {
    socket.emit(Events.Error, { message })
  }

  io.on('connection', (socket) => {
    socket.on(Events.PublicList, () => {
      const list = [...lobbies.values()]
        .filter((l) => l.isPublic)
        .map((l) => l.publicInfo())
      socket.emit(Events.PublicLobbies, { lobbies: list })
    })

    socket.on(Events.Join, async (data: Record<string, unknown>) => {
      const username = sanitizeUsername(data?.username)
      const code = typeof data?.code === 'string' ? data.code.trim().toUpperCase() : null
      const playerId = typeof data?.playerId === 'string' ? data.playerId : null
      const isPublic = data?.isPublic === true

      try {
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
          const settings = (data.settings ?? {}) as Partial<LobbySettings>
          const created = createLobby(
            sanitizeUsername(String(data.lobbyName ?? 'Meme Lobby')),
            isPublic,
            { ...DEFAULT_SETTINGS, ...settings },
            socket,
            username,
          )
          bind(socket, created.lobby, created.player.id)
          socket.emit(Events.LobbyJoined, { code: created.lobby.code, playerId: created.player.id })
          created.lobby.resume(socket.id, created.player.id)
        } else {
          // quick play: join an existing public lobby with room, or create one
          let target: Lobby | undefined = [...lobbies.values()].find(
            (l) => l.isPublic && l.phase === 'lobby' && l.playerCount() < MAX_PLAYERS,
          )
          let player: ReturnType<Lobby['addPlayerPublic']>
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
            const created = createLobby('Quick Play', true, DEFAULT_SETTINGS, socket, username)
            target = created.lobby
            player = created.player
          }
          bind(socket, target, player!.id)
          target.broadcast(Events.LobbyUpdate, target.fullLobbyUpdate())
          socket.emit(Events.LobbyJoined, { code: target.code, playerId: player!.id })
          target.resume(socket.id, player!.id)
        }
      } catch (e) {
        console.error('join failed', e)
        emitError(socket, 'Failed to join lobby.')
      }
    })

    socket.on(Events.Leave, () => {
      const b = socket.data.mb as BoundSocket | undefined
      if (!b) return
      b.lobby.leave(socket.id)
      unbind(socket)
    })

    socket.on(Events.Settings, (data: Record<string, unknown>) => {
      const b = socket.data.mb as BoundSocket | undefined
      if (!b) return
      const err = b.lobby.setSettings(socket.id, (data ?? {}) as Partial<LobbySettings>)
      if (err) emitError(socket, err)
    })

    socket.on(Events.Start, async () => {
      const b = socket.data.mb as BoundSocket | undefined
      if (!b) return
      const err = await b.lobby.start(socket.id)
      if (err) emitError(socket, err)
    })

    socket.on(Events.CaptionSubmit, (data: unknown) => {
      const b = socket.data.mb as BoundSocket | undefined
      if (!b) return
      const err = b.lobby.submitCaption(socket.id, data as never)
      if (err) emitError(socket, err)
    })

    socket.on(Events.Vote, (data: Record<string, unknown>) => {
      const b = socket.data.mb as BoundSocket | undefined
      if (!b) return
      const err = b.lobby.castVote(socket.id, Number(data?.index), data?.value as never)
      if (err) emitError(socket, err)
    })

    socket.on(Events.PlayAgain, () => {
      const b = socket.data.mb as BoundSocket | undefined
      if (!b) return
      const err = b.lobby.playAgain(socket.id)
      if (err) emitError(socket, err)
    })

    socket.on(Events.Kick, (data: Record<string, unknown>) => {
      const b = socket.data.mb as BoundSocket | undefined
      if (!b) return
      const err = b.lobby.kick(socket.id, String(data?.playerId ?? ''))
      if (err) emitError(socket, err)
    })

    socket.on('disconnect', () => {
      const b = socket.data.mb as BoundSocket | undefined
      if (!b) return
      // Ghost the player instead of removing it: client-side navigation disconnects the
      // previous socket right after joining, and the lobby must survive that.
      b.lobby.disconnect(socket.id)
      unbind(socket)
    })
  })

  // re-broadcast public list periodically so the start page stays fresh
  setInterval(() => {
    const list = [...lobbies.values()].filter((l) => l.isPublic).map((l) => l.publicInfo())
    io.emit(Events.PublicLobbies, { lobbies: list })
  }, 5000)

  // remove ghosted players after GHOST_TTL_MS and drop lobbies that are left empty
  // (covers both TTL expiry and explicit leaves of the last player)
  setInterval(() => {
    const now = Date.now()
    for (const [code, lobby] of [...lobbies]) {
      if (lobby.sweep(now)) {
        lobbies.delete(code)
        lobby.destroy()
      }
    }
  }, 5000)
}
