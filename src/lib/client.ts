// Shared client socket + identity helpers.
// Identity (playerId + username) is persisted in localStorage so that a page
// refresh or crash reconnects the same player.

import { io, type Socket } from 'socket.io-client'
import { Events, MAX_ID_LENGTH } from './types'
import type { LobbySettings, Phase, PlayerInfo } from './types'

/** Backwards-compatible re-export; the shared type lives in `types.ts`. */
export type { MemeInfo } from './types'

const PLAYER_ID_KEY = 'mb_player_id'
const USERNAME_KEY = 'mb_username'

/**
 * RFC4122-based id where available, capped at `MAX_ID_LENGTH` characters so
 * ids created here also satisfy the template-box API limit.
 */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, MAX_ID_LENGTH)
  }
  return (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, MAX_ID_LENGTH)
}

export function getSavedPlayerId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(PLAYER_ID_KEY)
}

export function savePlayerId(id: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(PLAYER_ID_KEY, id)
}

export function getSavedUsername(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(USERNAME_KEY)
}

export function saveUsername(name: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(USERNAME_KEY, name)
}

/** Forget both player id and username (used when kicked or leaving for good). */
export function clearIdentity() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PLAYER_ID_KEY)
  localStorage.removeItem(USERNAME_KEY)
}

export function connectSocket(onError: (message: string) => void): Socket {
  const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
  })
  socket.on(Events.Error, ({ message }: { message: string }) => onError(message))
  return socket
}

/** Payloads the client expects from the server (typed convenience). */
export interface LobbyState {
  code: string
  name: string
  isPublic: boolean
  settings: LobbySettings
  phase: Phase
  players: PlayerInfo[]
  maxPlayers: number
}

export interface PublicLobbyInfo {
  code: string
  name: string
  players: number
  maxPlayers: number
  inGame: boolean
}
