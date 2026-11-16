import crypto from 'crypto'
import type {
  CaptionSubmission,
  FreeformLine,
  LobbySettings,
  MemeEntry,
  Phase,
  TemplateData,
  VoteTally,
  VoteValue,
} from '../lib/types'
import { Events } from '../lib/types'
import { computeScore } from '../lib/scoring'
import { loadTemplates } from './templates'

export const MAX_PLAYERS = 30
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** Ghosted players (disconnected) are kept this long so a brief reconnect or page navigation can resume them. */
export const GHOST_TTL_MS = 30_000

const AVATARS = ['🐶', '🐱', '🦊', '🐸', '🐵', '🦄', '🐼', '🦁', '🐷', '🐙', '🦖', '🐔', '🐺', '🦉', '🐯', '🐢', '🦜', '🐭', '🦈', '🐉']
const COLORS = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#ff9800', '#ff5722', '#795548', '#607d8b', '#ffeb3b', '#00e5ff', '#ff4081', '#76ff03', '#ffd740']

export interface PlayerState {
  id: string
  username: string
  avatar: string
  color: string
  socketId: string | null
  connected: boolean
  disconnectedAt: number | null
  isHost: boolean
  submission: CaptionSubmission | null
  votes: Record<number, VoteValue>
  totalScore: number
  roundScores: number[]
}

export interface LobbyHooks {
  broadcast: (event: string, payload: unknown) => void
  sendTo: (socketId: string, event: string, payload: unknown) => void
}

export function generateCode(): string {
  let code = ''
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return code
}

export function sanitizeUsername(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  return (s.slice(0, 16) || 'Player').trim()
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export class Lobby {
  code: string
  name: string
  isPublic: boolean
  settings: LobbySettings
  phase: Phase = 'lobby'
  players = new Map<string, PlayerState>()

  private hooks: LobbyHooks
  private timers: NodeJS.Timeout[] = []

  // game state
  totalRounds = 0
  round = 0
  templates: TemplateData[] = []
  memes: MemeEntry[] = []
  tallies = new Map<number, VoteTally>()
  currentMeme = 0
  captionEndsAt = 0
  memeSwitchAt = 0
  lastRoundResult: unknown = null
  ranking: unknown = null

  constructor(code: string, name: string, isPublic: boolean, settings: LobbySettings, hooks: LobbyHooks) {
    this.code = code
    this.name = name
    this.isPublic = isPublic
    this.settings = clone(settings)
    this.hooks = hooks
  }

  broadcast(event: string, payload: unknown) {
    this.hooks.broadcast(event, payload)
  }

  // ------------------------------------------------------------------ players

  host(): PlayerState | undefined {
    for (const p of this.players.values()) if (p.isHost) return p
    return undefined
  }

  playerBySocket(socketId: string): PlayerState | undefined {
    for (const p of this.players.values()) if (p.socketId === socketId) return p
    return undefined
  }

  playerInfos() {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      username: p.username,
      avatar: p.avatar,
      color: p.color,
      connected: p.connected,
      isHost: p.isHost,
    }))
  }

  fullLobbyUpdate() {
    return {
      code: this.code,
      name: this.name,
      isPublic: this.isPublic,
      settings: this.settings,
      phase: this.phase,
      players: this.playerInfos(),
      maxPlayers: MAX_PLAYERS,
    }
  }

  addPlayerPublic(username: string, socketId: string): PlayerState {
    return this.addPlayer(sanitizeUsername(username), socketId)
  }

  playerCount(): number {
    let n = 0
    for (const p of this.players.values()) if (p.connected) n++
    return n
  }

  isEmpty(): boolean {
    return this.players.size === 0
  }

  /**
   * Knowing the lobby code plus a playerId rebinds that player to the new socket.
   * That is a deliberate trade-off for guest party play (no accounts): codes are
   * short-lived, 5 characters, and shared with friends anyway.
   */
  join(socketId: string, clientPlayerId: string | null, username: string): { player?: PlayerState; error?: string } {
    const uname = sanitizeUsername(username)
    let player = clientPlayerId ? this.players.get(clientPlayerId) : undefined
    if (!player) {
      player = [...this.players.values()].find(
        (p) => !p.connected && p.username.toLowerCase() === uname.toLowerCase(),
      )
    }
    if (player) {
      player.socketId = socketId
      player.connected = true
      player.disconnectedAt = null
      return { player }
    }
    if (this.phase !== 'lobby') return { error: 'The game is already in progress.' }
    if (this.players.size >= MAX_PLAYERS) return { error: 'Lobby is full.' }
    return { player: this.addPlayer(uname, socketId) }
  }

  private addPlayer(username: string, socketId: string): PlayerState {
    let name = username
    let i = 2
    while ([...this.players.values()].some((p) => p.username.toLowerCase() === name.toLowerCase())) {
      name = `${username} ${i++}`
    }
    const usedColors = new Set([...this.players.values()].map((p) => p.color))
    const free = COLORS.filter((c) => !usedColors.has(c))
    const p: PlayerState = {
      id: crypto.randomUUID(),
      username: name,
      avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
      color: free.length ? free[Math.floor(Math.random() * free.length)] : COLORS[Math.floor(Math.random() * COLORS.length)],
      socketId,
      connected: true,
      disconnectedAt: null,
      isHost: this.players.size === 0,
      submission: null,
      votes: {},
      totalScore: 0,
      roundScores: [],
    }
    this.players.set(p.id, p)
    return p
  }

  /** Explicit leave: the player fully leaves the lobby (in lobby/gameOver phases), or gets ghosted mid-game. */
  leave(socketId: string) {
    const p = this.playerBySocket(socketId)
    if (!p) return
    if (this.phase === 'lobby' || this.phase === 'gameOver') {
      this.removePlayer(p.id)
    } else {
      this.ghost(p)
    }
  }

  /**
   * Socket went away (navigation, tab close, network drop): ghost the player in ALL phases
   * so the lobby survives client-side navigation and reconnects. The player is only removed
   * later by sweep() once it has been gone for GHOST_TTL_MS.
   * No-op if the player was already re-bound to a newer socket (reconnect race).
   */
  disconnect(socketId: string) {
    const p = this.playerBySocket(socketId)
    if (!p) return
    this.ghost(p)
  }

  private ghost(p: PlayerState) {
    p.connected = false
    p.socketId = null
    p.disconnectedAt = Date.now()
    this.hooks.broadcast(Events.LobbyUpdate, this.fullLobbyUpdate())
  }

  /**
   * Removes ghosted players that have been gone for GHOST_TTL_MS. Only active in the
   * lobby/gameOver phases; mid-game ghosts persist until the game ends.
   * Returns true when the lobby is now empty (caller should drop it).
   */
  sweep(now: number): boolean {
    if (this.phase !== 'lobby' && this.phase !== 'gameOver') return false
    for (const p of [...this.players.values()]) {
      if (!p.connected && p.disconnectedAt !== null && now - p.disconnectedAt >= GHOST_TTL_MS) {
        this.removePlayer(p.id)
      }
    }
    return this.players.size === 0
  }

  kick(socketId: string, playerId: string): string | null {
    const caller = this.playerBySocket(socketId)
    if (!caller?.isHost) return 'Only the host can kick.'
    if (this.phase !== 'lobby') return 'The game is already in progress.'
    const target = this.players.get(playerId)
    if (!target) return 'Player not found.'
    if (target.isHost) return 'The host cannot be kicked.'
    // Remove immediately: the kicked client navigates away, and a ghosted removal
    // would linger for GHOST_TTL_MS.
    this.removePlayer(playerId)
    this.hooks.broadcast(Events.PlayerKick, { playerId })
    return null
  }

  private removePlayer(playerId: string) {
    const p = this.players.get(playerId)
    if (!p) return
    this.players.delete(playerId)
    const wasHost = p.isHost
    if (wasHost && this.players.size > 0) {
      this.players.values().next().value!.isHost = true
    }
    if (this.players.size === 0) {
      this.hooks.broadcast(Events.LobbyEmpty, {})
    } else {
      this.hooks.broadcast(Events.LobbyUpdate, this.fullLobbyUpdate())
    }
  }

  setSettings(socketId: string, settings: Partial<LobbySettings>): string | null {
    const p = this.playerBySocket(socketId)
    if (!p?.isHost) return 'Only the host can change settings.'
    if (this.phase !== 'lobby') return 'Settings are locked during the game.'
    const s = { ...this.settings }
    if (settings.lobbyName !== undefined) s.lobbyName = sanitizeUsername(settings.lobbyName + ' ') || this.settings.lobbyName
    if (settings.rounds !== undefined) s.rounds = clampInt(settings.rounds, 1, 10)
    if (settings.captionTime !== undefined) s.captionTime = clampInt(settings.captionTime, 5, 120)
    if (settings.voteTime !== undefined) s.voteTime = clampInt(settings.voteTime, 3, 60)
    if (Array.isArray(settings.packIds)) s.packIds = settings.packIds.filter((x): x is string => typeof x === 'string').slice(0, 10)
    this.settings = s
    this.name = s.lobbyName
    this.hooks.broadcast(Events.LobbyUpdate, this.fullLobbyUpdate())
    return null
  }

  // ------------------------------------------------------------------ game flow

  async start(socketId: string): Promise<string | null> {
    const p = this.playerBySocket(socketId)
    if (!p?.isHost) return 'Only the host can start the game.'
    if (this.phase !== 'lobby') return 'The game already started.'
    if (this.players.size < 2) return 'You need at least 2 players to start.'
    if (this.settings.packIds.length === 0) return 'Select at least one template pack.'

    const templates = await loadTemplates(this.settings.packIds)
    if (templates.length === 0) return 'No active templates found in the selected packs.'

    this.templates = shuffle(templates)
    this.totalRounds = this.settings.rounds
    this.players.forEach((pl) => {
      pl.totalScore = 0
      pl.roundScores = []
    })
    this.beginRound(1)
    return null
  }

  /** Change phase and broadcast the full lobby state so clients switch views. */
  private setPhase(phase: Phase) {
    this.phase = phase
    this.hooks.broadcast(Events.LobbyUpdate, this.fullLobbyUpdate())
  }

  private beginRound(round: number) {
    this.round = round
    this.players.forEach((pl) => {
      pl.submission = null
      pl.votes = {}
    })
    this.setPhase('caption')
    this.captionEndsAt = Date.now() + this.settings.captionTime * 1000
    this.hooks.broadcast(Events.PhaseCaption, {
      round,
      totalRounds: this.totalRounds,
      timeLeft: this.settings.captionTime,
    })
    this.players.forEach((pl) => {
      const template = this.dealTemplate(pl)
      if (pl.socketId) {
        this.hooks.sendTo(pl.socketId, Events.CaptionTemplate, { template, timeLeft: this.settings.captionTime })
      }
    })
    this.schedule(() => this.beginVoting(), this.settings.captionTime * 1000)
  }

  /** Deal a template: i-th player gets templates[i % len] (shuffled each round). */
  private dealTemplate(pl: PlayerState): TemplateData {
    const idx = [...this.players.values()].indexOf(pl)
    const t = this.templates[idx % this.templates.length]
    return clone(t)
  }

  private beginVoting() {
    if (this.phase !== 'caption') return // idempotent: early-exit and full-timeout can both fire
    const submitters = shuffle([...this.players.values()].filter((pl) => pl.submission))
    this.memes = submitters.map((pl) => ({
      playerId: pl.id,
      username: pl.username,
      avatar: pl.avatar,
      color: pl.color,
      template: this.dealTemplate(pl),
      submission: clone(pl.submission!),
    }))

    this.tallies = new Map()
    this.memes.forEach((_, i) => this.tallies.set(i, { up: 0, down: 0, meh: 0 }))
    this.currentMeme = 0
    this.setPhase('voting')

    if (this.memes.length === 0) {
      // nobody submitted: skip straight to results
      this.endVoting()
      return
    }

    this.hooks.broadcast(Events.PhaseVoting, {
      round: this.round,
      memes: this.memes,
      count: this.memes.length,
      current: 0,
      timeLeft: this.settings.voteTime,
    })
    this.showMeme(0)
  }

  private showMeme(index: number) {
    this.currentMeme = index
    this.memeSwitchAt = Date.now() + this.settings.voteTime * 1000
    this.hooks.broadcast(Events.VotingProgress, {
      index,
      count: this.memes.length,
      timeLeft: this.settings.voteTime,
    })
    this.schedule(() => {
      if (this.currentMeme === index) {
        if (index + 1 < this.memes.length) {
          this.showMeme(index + 1)
        } else {
          this.endVoting()
        }
      }
    }, this.settings.voteTime * 1000)
  }

  private endVoting() {
    this.clearTimers()
    const result = {
      round: this.round,
      memes: this.memes.map((m, i) => {
        const t = this.tallies.get(i) ?? { up: 0, down: 0, meh: 0 }
        return {
          index: i,
          playerId: m.playerId,
          username: m.username,
          score: computeScore(t),
          up: t.up,
          down: t.down,
          meh: t.meh,
        }
      }),
      totals: {},
    } as { round: number; memes: Array<Record<string, unknown>>; totals: Record<string, number> }
    for (const pl of this.players.values()) {
      const entry = result.memes.find((m) => m.playerId === pl.id)
      const score = entry ? (entry.score as number) : 0
      pl.totalScore += score
      pl.roundScores.push(score)
      ;(result.totals as Record<string, number>)[pl.id] = pl.totalScore
    }
    this.lastRoundResult = result
    this.setPhase('roundResults')
    this.hooks.broadcast(Events.RoundResults, result)

    if (this.round >= this.totalRounds) {
      this.schedule(() => this.gameOver(), 6000)
    } else {
      this.schedule(() => this.beginRound(this.round + 1), 6000)
    }
  }

  private gameOver() {
    const ranking = [...this.players.values()]
      .map((pl) => ({
        playerId: pl.id,
        username: pl.username,
        avatar: pl.avatar,
        color: pl.color,
        total: pl.totalScore,
        rounds: pl.roundScores,
      }))
      .sort((a, b) => b.total - a.total)
    this.ranking = ranking
    this.setPhase('gameOver')
    this.hooks.broadcast(Events.GameOver, { ranking, totalRounds: this.totalRounds })
  }

  playAgain(socketId: string): string | null {
    const p = this.playerBySocket(socketId)
    if (!p?.isHost) return 'Only the host can start a new game.'
    if (this.phase !== 'gameOver') return 'The game is not over yet.'
    this.phase = 'lobby'
    this.round = 0
    this.memes = []
    this.tallies = new Map()
    this.players.forEach((pl) => {
      pl.submission = null
      pl.votes = {}
      pl.totalScore = 0
      pl.roundScores = []
    })
    this.hooks.broadcast(Events.LobbyUpdate, this.fullLobbyUpdate())
    return null
  }

  // ------------------------------------------------------------------ input

  submitCaption(socketId: string, submission: CaptionSubmission): string | null {
    const p = this.playerBySocket(socketId)
    if (!p) return 'Unknown player.'
    if (this.phase !== 'caption') return 'Not in the caption phase.'
    if (p.submission) return 'You already submitted.'

    const texts: Record<string, string> = {}
    const raw = typeof submission?.texts === 'object' && submission.texts ? submission.texts : {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') texts[k.slice(0, 64)] = v.slice(0, 240)
    }
    let lines: FreeformLine[] = []
    if (Array.isArray(submission?.lines)) {
      lines = submission.lines
        .filter((b) => b && typeof b === 'object' && typeof b.text === 'string')
        .slice(0, 12)
        .map((b) => ({
          id: String(b.id ?? '').slice(0, 32) || crypto.randomUUID(),
          text: String(b.text).slice(0, 120),
          x: clampNum(b.x, 0.05, 0.95),
          y: clampNum(b.y, 0.02, 0.98),
          w: clampNum(b.w, 0.1, 1),
          fontSize: clampNum(b.fontSize, 0.02, 0.25),
          color: typeof b.color === 'string' ? b.color.slice(0, 20) : '#ffffff',
          stroke: typeof b.stroke === 'string' ? b.stroke.slice(0, 20) : '#000000',
          font: typeof b.font === 'string' ? b.font.slice(0, 40) : 'Impact',
          align: b.align === 'left' || b.align === 'right' ? b.align : 'center',
          rotation: clampNum(b.rotation, -90, 90),
        }))
    }
    const hasAny =
      Object.values(texts).some((t) => t.trim() !== '') || lines.some((l) => l.text.trim() !== '')
    if (!hasAny) return 'Add at least one text before submitting.'
    p.submission = { texts, lines }
    // Everyone in -> move on early (brief grace so clients see "submitted").
    if ([...this.players.values()].every((pl) => pl.submission)) {
      this.schedule(() => this.beginVoting(), 1000)
    }
    return null
  }

  castVote(socketId: string, index: number, value: VoteValue): string | null {
    const p = this.playerBySocket(socketId)
    if (!p) return 'Unknown player.'
    if (this.phase !== 'voting') return 'Not in the voting phase.'
    if (index < 0 || index >= this.memes.length) return 'Unknown meme.'
    if (value !== 'up' && value !== 'down' && value !== 'meh') return 'Invalid vote.'
    if (index !== this.currentMeme) return 'This meme is not up for voting.'
    const meme = this.memes[index]
    if (!meme || meme.playerId === p.id) return 'You cannot vote on your own meme.'

    const prev = p.votes[index]
    if (prev === value) return null
    const tally = this.tallies.get(index)
    if (tally) {
      if (prev) tally[prev] = Math.max(0, tally[prev] - 1)
      tally[value]++
    }
    p.votes[index] = value
    if (tally) {
      this.hooks.broadcast(Events.VotingCounts, {
        index,
        up: tally.up,
        down: tally.down,
        meh: tally.meh,
      })
    }
    return null
  }

  // ------------------------------------------------------------------ reconnect

  resume(socketId: string, playerId: string | null): string | null {
    const p = this.playerBySocket(socketId)
    if (!p) {
      const found = playerId
        ? this.players.get(playerId)
        : [...this.players.values()].find((pl) => !pl.connected)
      if (!found) return 'You are not in this lobby.'
      found.socketId = socketId
      found.connected = true
      found.disconnectedAt = null
      return this.sendResume(socketId, found.id)
    }
    return this.sendResume(socketId, p.id)
  }

  private sendResume(socketId: string, playerId: string): string | null {
    const send = (event: string, payload: unknown) => this.hooks.sendTo(socketId, event, payload)
    send(Events.LobbyUpdate, this.fullLobbyUpdate())
    if (this.phase === 'caption') {
      const pl = this.players.get(playerId)
      const template = pl ? this.dealTemplate(pl) : null
      send(Events.CaptionTemplate, {
        template,
        timeLeft: Math.max(0, Math.ceil((this.captionEndsAt - Date.now()) / 1000)),
      })
    } else if (this.phase === 'voting') {
      send('phase:voting', {
        round: this.round,
        memes: this.memes,
        count: this.memes.length,
        current: this.currentMeme,
        timeLeft: Math.max(0, Math.ceil((this.memeSwitchAt - Date.now()) / 1000)),
      })
      const tally = this.tallies.get(this.currentMeme)
      if (tally) {
        send('voting:counts', {
          index: this.currentMeme,
          up: tally.up,
          down: tally.down,
          meh: tally.meh,
        })
      }
    } else if (this.phase === 'roundResults' && this.lastRoundResult) {
      send('round:results', this.lastRoundResult)
    } else if (this.phase === 'gameOver' && this.ranking) {
      send('game:over', { ranking: this.ranking, totalRounds: this.totalRounds })
    }
    return null
  }

  publicInfo() {
    const inGame = this.phase !== 'lobby' && this.phase !== 'gameOver'
    let connected = 0
    for (const p of this.players.values()) if (p.connected) connected++
    return {
      code: this.code,
      name: this.name,
      players: connected,
      maxPlayers: MAX_PLAYERS,
      inGame,
    }
  }

  // ------------------------------------------------------------------ timers

  private schedule(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t)
      fn()
    }, Math.max(0, ms))
    this.timers.push(t)
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  destroy() {
    this.clearTimers()
  }
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? Math.floor(v) : Number(v)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function clampNum(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}
