// Shared client socket + identity helpers.
// Identity (playerId + username) is persisted in localStorage so that a page
// refresh or crash reconnects the same player.

import { io, type Socket } from 'socket.io-client'
import { Events } from './types'

const PLAYER_ID_KEY = 'mb_player_id'
const USERNAME_KEY = 'mb_username'

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
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

export function clearPlayerId() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PLAYER_ID_KEY)
}

/** Forget both player id and username (used when kicked or leaving for good). */
export function clearIdentity() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PLAYER_ID_KEY)
  localStorage.removeItem(USERNAME_KEY)
}

export interface JoinArgs {
  username: string
  playerId: string
  code?: string | null
  isPublic?: boolean
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

export function joinArgs(username: string, playerId: string, code?: string | null, isPublic?: boolean): JoinArgs {
  return { username, playerId, code: code || null, isPublic: isPublic ?? true }
}

/** Payloads the client expects from the server (typed convenience). */
export interface LobbyState {
  code: string
  name: string
  isPublic: boolean
  settings: {
    rounds: number
    captionTime: number
    voteTime: number
    packIds: string[]
    lobbyName: string
  }
  phase: 'lobby' | 'caption' | 'voting' | 'roundResults' | 'gameOver'
  players: Array<{
    id: string
    username: string
    avatar: string
    color: string
    connected: boolean
    isHost: boolean
  }>
  maxPlayers: number
}

export interface PublicLobbyInfo {
  code: string
  name: string
  players: number
  maxPlayers: number
  inGame: boolean
}

export interface MemeInfo {
  playerId: string
  username: string
  avatar: string
  color: string
  template: {
    id: string
    name: string
    imageKey: string
    isFreeform: boolean
    boxes: Array<{
      id: string
      x: number
      y: number
      w: number
      fontSize: number
      color: string
      stroke: string
      font: string
      align: 'left' | 'center' | 'right'
      rotation: number
      defaultText?: string
    }>
  }
  submission: {
    texts: Record<string, string>
    lines: Array<{
      id: string
      text: string
      x: number
      y: number
      w: number
      fontSize: number
      color: string
      stroke: string
      font: string
      align: 'left' | 'center' | 'right'
      rotation: number
    }>
  }
}
