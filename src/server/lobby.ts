import crypto from 'crypto'
import type {
  CaptionSubmission,
  ChaosRule,
  FinalMeme,
  FreeformLine,
  GameMode,
  GameOverPayload,
  LobbySettings,
  MemeEntry,
  Phase,
  PlayerInfo,
  RankingEntry,
  RoundBuddyPick,
  RoundResult,
  TemplateData,
  VoteTally,
  VoteValue,
} from '../lib/types'
import {
  CHAOS_RULES,
  DEFAULT_REROLLS,
  Events,
  GAME_MODES,
  LINE_BOUNDS,
  MAX_LINES,
  MAX_REROLLS,
  MAX_TEXT_LEN,
  ROTATION_BOUNDS,
  SHORT_TEXT_MAX,
  TEXT_WIDTH_BOUNDS,
} from '../lib/types'
import { normalizeMemePadding } from '../lib/meme'
import { MEME_BUDDY_POINTS, computeBuddyOutcome, computeScore } from '../lib/scoring'
import type { BuddyPickInput } from '../lib/scoring'
import { loadTemplates } from './templates'

export const MAX_PLAYERS = 30
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** Ghosted players (disconnected) are kept this long so a brief reconnect or page navigation can resume them. */
export const GHOST_TTL_MS = 30_000
/** When every connected eligible voter has voted on a meme, the remaining time is capped to this grace. */
export const ALL_VOTED_GRACE_MS = 5_000
/** Maximum number of template packs a lobby may select. */
const MAX_PACK_IDS = 100
/** Longest allowed lobby name, after whitespace normalization. */
const MAX_LOBBY_NAME_LEN = 24

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
  /** Meme index this player gave their Meme Buddy to this round; one pick per round. */
  buddyIndex: number | null
  /** Template currently dealt to this player (caption phase); set per round, replaced by rerolls. */
  template: TemplateData | null
  /** Rerolls used this round. */
  rerolls: number
  /** Rounds in which this player submitted a meme; final tie-breaker. */
  submittedRounds: number
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

/** Trim and collapse whitespace, then cap the length. Returns '' when nothing remains. */
function collapseLobbyName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  return s.slice(0, MAX_LOBBY_NAME_LEN).trim()
}

export function sanitizeLobbyName(raw: unknown): string {
  return collapseLobbyName(raw) || 'Meme Lobby'
}

function normalizePackIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const ids: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (!id || ids.includes(id)) continue
    ids.push(id)
    if (ids.length >= MAX_PACK_IDS) break
  }
  return ids
}

function normalizeMode(raw: unknown): GameMode {
  return typeof raw === 'string' && (GAME_MODES as readonly string[]).includes(raw)
    ? (raw as GameMode)
    : 'normal'
}

/** Pick a chaos rule, avoiding the previous round's rule when possible. */
export function pickChaosRule(
  mode: GameMode,
  previous: ChaosRule | null,
  random: () => number = Math.random,
): ChaosRule | null {
  if (mode !== 'chaos') return null
  const options = CHAOS_RULES.filter((rule) => rule !== previous)
  const pool = options.length > 0 ? options : [...CHAOS_RULES]
  const index = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return pool[Math.max(0, index)]
}

/** Validate arbitrary client input into safe lobby settings, applying defaults for missing fields. */
export function normalizeSettings(input: unknown): LobbySettings {
  const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  return {
    mode: normalizeMode(raw.mode),
    rounds: clampInt(raw.rounds, 1, 10, 3),
    rerolls: clampInt(raw.rerolls, 0, MAX_REROLLS, DEFAULT_REROLLS),
    captionTime: clampInt(raw.captionTime, 5, 120, 45),
    voteTime: clampInt(raw.voteTime, 3, 60, 10),
    packIds: normalizePackIds(raw.packIds),
    lobbyName: sanitizeLobbyName(raw.lobbyName),
  }
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
  /** Guards start() against concurrent calls while templates are loading. */
  private starting = false

  // game state
  totalRounds = 0
  round = 0
  roundRule: ChaosRule | null = null
  roundCaptionTime = 0
  roundVoteTime = 0
  templates: TemplateData[] = []
  memes: MemeEntry[] = []
  tallies = new Map<number, VoteTally>()
  currentMeme = 0
  captionEndsAt = 0
  memeSwitchAt = 0
  lastRoundResult: RoundResult | null = null
  ranking: RankingEntry[] | null = null
  /** All scored memes of the game, for the final gallery. */
  finalMemes: FinalMeme[] = []

  constructor(code: string, name: string, isPublic: boolean, settings: LobbySettings, hooks: LobbyHooks) {
    this.code = code
    this.isPublic = isPublic
    const raw = typeof settings === 'object' && settings !== null ? settings : ({} as LobbySettings)
    // Settings are authoritative; the legacy name argument only fills a missing name.
    this.settings = normalizeSettings({ ...raw, lobbyName: collapseLobbyName(raw.lobbyName) || name })
    this.name = this.settings.lobbyName
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

  playerSocketId(playerId: string): string | null {
    return this.players.get(playerId)?.socketId ?? null
  }

  playerInfos(): PlayerInfo[] {
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

  /**
   * Knowing the lobby code plus a playerId rebinds that player to the new socket.
   * That is a deliberate trade-off for guest party play (no accounts): codes are
   * short-lived, 5 characters, and shared with friends anyway.
   */
  join(socketId: string, clientPlayerId: string | null, username: string): { player?: PlayerState; error?: string } {
    const uname = sanitizeUsername(username)
    let player = clientPlayerId ? this.players.get(clientPlayerId) : undefined
    if (!player) {
      // Same name = same player: rebind the existing seat instead of creating a
      // duplicate ("Alice 2") — no matter whether the old socket is still
      // connected. A stolen old socket simply stops working (playerBySocket
      // matches on socketId), its disconnect handler no-ops.
      player = [...this.players.values()].find((p) => p.username.toLowerCase() === uname.toLowerCase())
    }
    if (player) {
      const bound = player
      // Keep the existing name if another seat already uses the requested one.
      const nameTaken = [...this.players.values()].some(
        (other) => other.id !== bound.id && other.username.toLowerCase() === uname.toLowerCase(),
      )
      if (!nameTaken) bound.username = uname
      bound.socketId = socketId
      bound.connected = true
      bound.disconnectedAt = null
      // A ghost host (solo host who navigated away) hands the role back on rebind.
      const currentHost = this.host()
      if (currentHost && !currentHost.connected && bound.connected) this.transferHost()
      return { player: bound }
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
      buddyIndex: null,
      template: null,
      rerolls: 0,
      submittedRounds: 0,
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
    // Hand the host role to a connected player right away so the lobby stays
    // manageable (start/kick/play-again). If nobody else is connected the ghost
    // keeps the role: a solo host navigating pages gets it back on rebind.
    if (p.isHost && [...this.players.values()].some((x) => x.connected)) {
      this.transferHost()
    }
    this.hooks.broadcast(Events.LobbyUpdate, this.fullLobbyUpdate())
  }

  /** Give the host role to another player, preferring connected ones. No-op when alone. */
  private transferHost() {
    if (this.players.size === 0) return
    const candidates = [...this.players.values()]
    const next = candidates.find((x) => x.connected) ?? candidates[0]
    this.players.forEach((x) => (x.isHost = x.id === next.id))
  }

  /**
   * Removes ghosted players that have been gone for GHOST_TTL_MS. Runs in the
   * lobby/gameOver phases; mid-game it only cleans up once nobody is connected,
   * so a dead game does not linger forever.
   * Returns true when the lobby is now empty (caller should drop it).
   */
  sweep(now: number): boolean {
    const inGame = this.phase !== 'lobby' && this.phase !== 'gameOver'
    if (inGame && this.playerCount() > 0) return false
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
    if (p.isHost) {
      // prefer a connected player: map order could otherwise hand the role to a ghost
      this.transferHost()
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
    const input: Record<string, unknown> = {}
    if (typeof settings === 'object' && settings !== null) {
      for (const [key, value] of Object.entries(settings)) {
        if (value !== undefined) input[key] = value
      }
    }
    const merged: Record<string, unknown> = { ...this.settings, ...input }
    // An empty lobby name keeps the current one instead of falling back to a default.
    if ('lobbyName' in input && !collapseLobbyName(input.lobbyName)) {
      merged.lobbyName = this.settings.lobbyName
    }
    this.settings = normalizeSettings(merged)
    this.name = this.settings.lobbyName
    this.hooks.broadcast(Events.LobbyUpdate, this.fullLobbyUpdate())
    return null
  }

  // ------------------------------------------------------------------ game flow

  async start(socketId: string): Promise<string | null> {
    const p = this.playerBySocket(socketId)
    if (!p?.isHost) return 'Only the host can start the game.'
    if (this.phase !== 'lobby') return 'The game already started.'
    if (this.starting) return 'The game is already starting.'
    if (this.playerCount() < 2) return 'You need at least 2 players to start.'
    if (this.settings.packIds.length === 0) return 'Select at least one template pack.'

    this.starting = true
    try {
      const templates = await loadTemplates(this.settings.packIds)
      // Loading is async: only continue if the lobby is still waiting and the caller
      // is still a connected host (by player id, so a nav rebind does not cancel it).
      const host = this.players.get(p.id)
      if (this.phase !== 'lobby' || !host?.isHost || !host.connected) return null
      if (this.playerCount() < 2) return 'You need at least 2 connected players to start.'
      if (templates.length === 0) return 'No active templates found in the selected packs.'

      this.templates = shuffle(templates)
      this.totalRounds = this.settings.rounds
      this.finalMemes = []
      this.players.forEach((pl) => {
        pl.totalScore = 0
        pl.roundScores = []
        pl.submittedRounds = 0
      })
      this.beginRound(1)
      return null
    } finally {
      this.starting = false
    }
  }

  /** Change phase and broadcast the full lobby state so clients switch views. */
  private setPhase(phase: Phase) {
    this.phase = phase
    this.hooks.broadcast(Events.LobbyUpdate, this.fullLobbyUpdate())
  }

  private beginRound(round: number) {
    this.round = round
    // Reshuffle every round so players do not get the same template each time.
    this.templates = shuffle(this.templates)
    this.roundRule = this.pickChaosRule()
    const fast = this.roundRule === 'fast'
    this.roundCaptionTime = fast
      ? Math.max(10, Math.round(this.settings.captionTime / 2))
      : this.settings.captionTime
    this.roundVoteTime = fast
      ? Math.max(3, Math.round(this.settings.voteTime / 2))
      : this.settings.voteTime
    const relaxed = this.settings.mode === 'relaxed'
    const maxTextLen = this.roundRule === 'shortText' ? SHORT_TEXT_MAX : MAX_TEXT_LEN

    this.players.forEach((pl) => {
      pl.submission = null
      pl.votes = {}
      pl.buddyIndex = null
      pl.template = null
      pl.rerolls = 0
    })
    this.setPhase('caption')
    this.captionEndsAt = Date.now() + this.roundCaptionTime * 1000
    this.hooks.broadcast(Events.PhaseCaption, {
      round,
      totalRounds: this.totalRounds,
      timeLeft: this.roundCaptionTime,
      timeTotal: this.roundCaptionTime,
      mode: this.settings.mode,
      rule: this.roundRule,
      maxTextLen,
      scoresEnabled: !relaxed,
    })
    this.players.forEach((pl) => {
      const template = this.dealTemplate(pl)
      pl.template = template
      if (pl.socketId) {
        this.hooks.sendTo(pl.socketId, Events.CaptionTemplate, {
          template,
          rerollsLeft: this.canReroll() ? this.settings.rerolls : 0,
          timeLeft: this.roundCaptionTime,
          timeTotal: this.roundCaptionTime,
          mode: this.settings.mode,
          rule: this.roundRule,
          maxTextLen,
          scoresEnabled: !relaxed,
        })
      }
    })
    const roundNumber = round
    this.schedule(() => {
      if (this.round !== roundNumber) return
      this.beginVoting()
    }, this.roundCaptionTime * 1000)
  }

  private pickChaosRule(): ChaosRule | null {
    return pickChaosRule(this.settings.mode, this.roundRule)
  }

  private canReroll(): boolean {
    return this.settings.mode === 'normal' && this.templates.length > 1
  }

  /** Trade the current template for a different random one (limited per round). */
  reroll(socketId: string): string | null {
    const p = this.playerBySocket(socketId)
    if (!p) return 'Unknown player.'
    if (this.phase !== 'caption') return 'Not in the caption phase.'
    if (this.settings.mode !== 'normal') return 'Template changes are only available in Meme Battle mode.'
    if (p.submission) return 'You already submitted.'
    if (p.rerolls >= this.settings.rerolls) return 'No rerolls left this round.'
    const others = this.templates.filter((t) => t.id !== p.template?.id)
    if (others.length === 0) return 'No other template available.'
    p.template = clone(others[Math.floor(Math.random() * others.length)])
    p.rerolls++
    if (p.socketId) {
      this.hooks.sendTo(p.socketId, Events.CaptionTemplate, {
        template: p.template,
        rerollsLeft: this.settings.rerolls - p.rerolls,
        timeLeft: Math.max(0, Math.ceil((this.captionEndsAt - Date.now()) / 1000)),
        timeTotal: this.roundCaptionTime,
        mode: this.settings.mode,
        rule: this.roundRule,
        maxTextLen: this.roundRule === 'shortText' ? SHORT_TEXT_MAX : MAX_TEXT_LEN,
        scoresEnabled: true,
      })
    }
    return null
  }

  /** Deal a template: i-th player gets templates[i % len] (shuffled each round). */
  private dealTemplate(pl: PlayerState): TemplateData {
    // Same/relaxed/chaos give everyone the same template for a fair round.
    if (this.settings.mode !== 'normal') return clone(this.templates[0])
    const idx = [...this.players.values()].indexOf(pl)
    const t = this.templates[idx % this.templates.length]
    return clone(t)
  }

  private beginVoting() {
    if (this.phase !== 'caption') return // idempotent: early-exit and full-timeout can both fire
    this.clearTimers() // kill the caption timeout when everyone submitted early
    // Defensive reset: a fresh voting phase never inherits a buddy pick.
    this.players.forEach((pl) => {
      pl.buddyIndex = null
    })
    const submitters = shuffle([...this.players.values()].filter((pl) => pl.submission))
    submitters.forEach((pl) => {
      pl.submittedRounds++
    })
    this.memes = submitters.map((pl) => ({
      playerId: pl.id,
      username: pl.username,
      avatar: pl.avatar,
      color: pl.color,
      template: pl.template ?? this.dealTemplate(pl),
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
      timeLeft: this.roundVoteTime,
      timeTotal: this.roundVoteTime,
      mode: this.settings.mode,
      rule: this.roundRule,
      scoresEnabled: this.settings.mode !== 'relaxed',
      canDownvote: this.roundRule !== 'noDownvotes',
    })
    this.showMeme(0)
  }

  private showMeme(index: number) {
    this.currentMeme = index
    this.memeSwitchAt = Date.now() + this.roundVoteTime * 1000
    this.hooks.broadcast(Events.VotingProgress, {
      index,
      count: this.memes.length,
      timeLeft: this.roundVoteTime,
      timeTotal: this.roundVoteTime,
      canDownvote: this.roundRule !== 'noDownvotes',
    })
    this.schedule(() => this.advanceMeme(index), this.roundVoteTime * 1000)
    // If nobody can vote on this meme, still show it briefly instead of waiting
    // the full vote time.
    this.maybeShortenVoting()
  }

  private advanceMeme(index: number) {
    if (this.currentMeme !== index) return
    if (index + 1 < this.memes.length) {
      this.showMeme(index + 1)
    } else {
      this.endVoting()
    }
  }

  /**
   * Everyone who can vote on the current meme has voted: cap the remaining
   * time at ALL_VOTED_GRACE_MS. This never extends the timer and is a no-op
   * once the cap has already been applied.
   */
  private maybeShortenVoting() {
    if (this.phase !== 'voting') return
    const index = this.currentMeme
    const meme = this.memes[index]
    if (!meme) return

    const eligible = [...this.players.values()].filter(
      (pl) => pl.connected && pl.submission && pl.id !== meme.playerId,
    )
    if (!eligible.every((pl) => pl.votes[index] !== undefined)) return

    const now = Date.now()
    const target = Math.min(this.memeSwitchAt, now + ALL_VOTED_GRACE_MS)
    if (target >= this.memeSwitchAt) return

    this.memeSwitchAt = target
    this.hooks.broadcast(Events.VotingTimer, {
      index,
      timeLeft: Math.max(0, Math.ceil((target - now) / 1000)),
    })
    this.schedule(() => this.advanceMeme(index), Math.max(0, target - now))
  }

  private endVoting() {
    this.clearTimers()
    const relaxed = this.settings.mode === 'relaxed'
    const multiplier = this.roundRule === 'double' ? 2 : 1
    const voteScored = this.memes.map((meme, index) => {
      const votes = this.tallies.get(index) ?? { up: 0, down: 0, meh: 0 }
      return {
        meme,
        index,
        votes,
        voteScore: relaxed ? 0 : computeScore(votes) * multiplier,
      }
    })

    // Only picks that resolve to another player's meme count. pickBuddy already
    // guarantees this; the check also protects against stale picks after a kick.
    // Relaxed rounds have no scoring, so they ignore Buddy picks entirely.
    const buddyPicks: Array<{ picker: PlayerState; index: number }> = []
    const buddyPlayerIds: string[][] = this.memes.map(() => [])
    if (!relaxed) {
      for (const pl of this.players.values()) {
        const index = pl.buddyIndex
        if (index === null) continue
        const meme = Number.isInteger(index) ? this.memes[index] : undefined
        if (!meme || meme.playerId === pl.id) continue
        buddyPicks.push({ picker: pl, index })
        buddyPlayerIds[index].push(pl.id)
      }
    }
    const picks: BuddyPickInput[] = buddyPicks.map(({ picker, index }) => ({
      playerId: picker.id,
      index,
    }))
    const { memeScores, memeBuddyCounts, pickerBonuses } = relaxed
      ? {
          memeScores: voteScored.map(() => 0),
          memeBuddyCounts: voteScored.map(() => 0),
          pickerBonuses: {} as Record<string, number>,
        }
      : computeBuddyOutcome(
          voteScored.map((entry) => entry.voteScore),
          picks,
        )
    const scored = voteScored.map((entry, index) => ({
      ...entry,
      score: memeScores[index],
      buddyCount: memeBuddyCounts[index],
      buddyBonus: MEME_BUDDY_POINTS * memeBuddyCounts[index],
      buddyPlayerIds: buddyPlayerIds[index],
    }))

    const players: RoundResult['players'] = {}
    const totals: Record<string, number> = {}
    const roundTotals: Record<string, number> = {}
    for (const pl of this.players.values()) {
      players[pl.id] = { username: pl.username, avatar: pl.avatar, color: pl.color }
      // The picker bonus is earned in addition to the player's own meme score.
      const entry = scored.find((m) => m.meme.playerId === pl.id)
      const memeScore = entry ? entry.score : 0
      const roundTotal = memeScore + (pickerBonuses[pl.id] ?? 0)
      pl.totalScore += roundTotal
      pl.roundScores.push(roundTotal)
      totals[pl.id] = pl.totalScore
      roundTotals[pl.id] = roundTotal
    }
    const buddies: RoundBuddyPick[] = buddyPicks.map(({ picker, index }) => {
      const target = this.memes[index]
      return {
        playerId: picker.id,
        username: picker.username,
        targetPlayerId: target.playerId,
        targetUsername: target.username,
        index,
        bonus: pickerBonuses[picker.id] ?? 0,
      }
    })

    const result: RoundResult = {
      round: this.round,
      gameMode: this.settings.mode,
      rule: this.roundRule,
      memes: scored.map(({ meme, index, votes, voteScore, score, buddyBonus, buddyCount, buddyPlayerIds: ids }) => ({
        index,
        playerId: meme.playerId,
        username: meme.username,
        score,
        voteScore,
        buddyBonus,
        buddyCount,
        buddyPlayerIds: ids,
        template: meme.template,
        submission: meme.submission,
        up: votes.up,
        down: votes.down,
        meh: votes.meh,
        rank: 1 + scored.filter((entry) => entry.score > score).length,
      })),
      totals,
      roundTotals,
      buddies,
      players,
    }

    // collect the round's memes (scored) for the final gallery; keep the boxes so
    // legacy fixed-template texts still render in the gallery and downloads
    for (const { meme, score, buddyCount } of scored) {
      this.finalMemes.push({
        playerId: meme.playerId,
        username: meme.username,
        avatar: meme.avatar,
        color: meme.color,
        template: meme.template,
        submission: clone(meme.submission),
        score,
        buddyCount,
        round: this.round,
      })
    }

    this.lastRoundResult = result
    this.setPhase('roundResults')
    this.hooks.broadcast(Events.RoundResults, result)

    if (this.round >= this.totalRounds) {
      this.schedule(() => this.gameOver(), 10000)
    } else {
      this.schedule(() => this.beginRound(this.round + 1), 10000)
    }
  }

  private gameOver() {
    const sorted = [...this.players.values()]
      .map((pl) => ({
        playerId: pl.id,
        username: pl.username,
        avatar: pl.avatar,
        color: pl.color,
        total: pl.totalScore,
        rounds: pl.roundScores,
        submittedRounds: pl.submittedRounds,
      }))
      .sort((a, b) => b.total - a.total || b.submittedRounds - a.submittedRounds)
    const ranking: RankingEntry[] = sorted.map((entry) => ({
      playerId: entry.playerId,
      username: entry.username,
      avatar: entry.avatar,
      color: entry.color,
      total: entry.total,
      rounds: entry.rounds,
      // Competition ranking; ties need the same score AND submission count.
      rank:
        1 +
        sorted.filter(
          (other) =>
            other.total > entry.total ||
            (other.total === entry.total && other.submittedRounds > entry.submittedRounds),
        ).length,
    }))
    this.ranking = ranking
    this.setPhase('gameOver')
    const payload: GameOverPayload = {
      ranking,
      totalRounds: this.totalRounds,
      memes: this.finalMemes,
      gameMode: this.settings.mode,
    }
    this.hooks.broadcast(Events.GameOver, payload)
  }

  playAgain(socketId: string): string | null {
    const p = this.playerBySocket(socketId)
    if (!p?.isHost) return 'Only the host can start a new game.'
    if (this.phase !== 'gameOver') return 'The game is not over yet.'
    this.phase = 'lobby'
    this.round = 0
    this.roundRule = null
    this.roundCaptionTime = 0
    this.roundVoteTime = 0
    this.memes = []
    this.tallies = new Map()
    this.finalMemes = []
    this.players.forEach((pl) => {
      pl.submission = null
      pl.votes = {}
      pl.buddyIndex = null
      pl.submittedRounds = 0
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

    const maxTextLen = this.roundRule === 'shortText' ? SHORT_TEXT_MAX : MAX_TEXT_LEN
    const texts: Record<string, string> = {}
    const raw = typeof submission?.texts === 'object' && submission.texts ? submission.texts : {}
    let textCount = 0
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v !== 'string') continue
      if (textCount++ >= MAX_LINES) break
      texts[k.slice(0, 64)] = v.slice(0, maxTextLen)
    }
    let lines: FreeformLine[] = []
    if (Array.isArray(submission?.lines)) {
      lines = submission.lines
        .filter((b) => b && typeof b === 'object' && typeof b.text === 'string')
        .slice(0, MAX_LINES)
        .map((b) => ({
          id: String(b.id ?? '').slice(0, 32) || crypto.randomUUID(),
          text: String(b.text).slice(0, maxTextLen),
          x: clampNum(b.x, LINE_BOUNDS.xMin, LINE_BOUNDS.xMax),
          y: clampNum(b.y, LINE_BOUNDS.yMin, LINE_BOUNDS.yMax),
          w: clampNum(b.w, TEXT_WIDTH_BOUNDS.min, TEXT_WIDTH_BOUNDS.max),
          fontSize: clampNum(b.fontSize, LINE_BOUNDS.fontSizeMin, LINE_BOUNDS.fontSizeMax),
          color: typeof b.color === 'string' ? b.color.slice(0, 20) : '#ffffff',
          stroke: typeof b.stroke === 'string' ? b.stroke.slice(0, 20) : '#000000',
          font: typeof b.font === 'string' ? b.font.slice(0, 40) : 'Impact',
          align: b.align === 'left' || b.align === 'right' ? b.align : 'center',
          rotation: clampNum(b.rotation, ROTATION_BOUNDS.min, ROTATION_BOUNDS.max),
          whiteBackground: b.whiteBackground === true,
        }))
    }
    const hasAny =
      Object.values(texts).some((t) => t.trim() !== '') || lines.some((l) => l.text.trim() !== '')
    if (!hasAny) return 'Add at least one text before submitting.'
    const padding = normalizeMemePadding(submission?.padding)
    p.submission = padding ? { texts, lines, padding } : { texts, lines }
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
    if (!p.submission) return 'You did not submit a meme this round.'
    if (index < 0 || index >= this.memes.length) return 'Unknown meme.'
    if (value !== 'up' && value !== 'down' && value !== 'meh') return 'Invalid vote.'
    if (value === 'down' && this.roundRule === 'noDownvotes') return 'Downvotes are disabled this round.'
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
    // No live tally broadcast: how people vote stays hidden until the results.
    this.maybeShortenVoting()
    return null
  }

  /**
   * Give another player's current meme your Meme Buddy (once per round).
   * The pick is private: only the picker gets a confirmation, and only the
   * picker sees it again on resume during the voting phase.
   */
  pickBuddy(socketId: string, index: number): string | null {
    const p = this.playerBySocket(socketId)
    if (!p) return 'Unknown player.'
    if (this.phase !== 'voting') return 'Not in the voting phase.'
    if (this.settings.mode === 'relaxed') return 'Meme Buddy is disabled in relaxed mode.'
    if (!p.submission) return 'You did not submit a meme this round.'
    if (!Number.isInteger(index) || index < 0 || index >= this.memes.length) return 'Unknown meme.'
    if (index !== this.currentMeme) return 'This meme is not up for voting.'
    const meme = this.memes[index]
    if (!meme || meme.playerId === p.id) return 'You cannot pick your own meme.'
    if (p.buddyIndex !== null) return 'You already picked your Meme Buddy this round.'

    p.buddyIndex = index
    this.hooks.sendTo(socketId, Events.BuddyPicked, { index })
    return null
  }

  // ------------------------------------------------------------------ reconnect

  resume(socketId: string, playerId: string | null): string | null {
    const p = this.playerBySocket(socketId)
    if (p) return this.sendResume(socketId, p.id)
    if (!playerId) return 'You are not in this lobby.'
    const found = this.players.get(playerId)
    if (!found) return 'You are not in this lobby.'
    found.socketId = socketId
    found.connected = true
    found.disconnectedAt = null
    return this.sendResume(socketId, found.id)
  }

  private sendResume(socketId: string, playerId: string): string | null {
    const send = (event: string, payload: unknown) => this.hooks.sendTo(socketId, event, payload)
    send(Events.LobbyUpdate, this.fullLobbyUpdate())
    if (this.phase === 'caption') {
      const pl = this.players.get(playerId)
      const template = pl?.template ?? null
      send(Events.CaptionTemplate, {
        template,
        rerollsLeft: this.canReroll()
          ? Math.max(0, this.settings.rerolls - (pl?.rerolls ?? 0))
          : 0,
        timeLeft: Math.max(0, Math.ceil((this.captionEndsAt - Date.now()) / 1000)),
        timeTotal: this.roundCaptionTime,
        round: this.round,
        totalRounds: this.totalRounds,
        submitted: !!pl?.submission,
        submission: pl?.submission ? clone(pl.submission) : null,
        mode: this.settings.mode,
        rule: this.roundRule,
        maxTextLen: this.roundRule === 'shortText' ? SHORT_TEXT_MAX : MAX_TEXT_LEN,
        scoresEnabled: this.settings.mode !== 'relaxed',
      })
    } else if (this.phase === 'voting') {
      const pl = this.players.get(playerId)
      send(Events.PhaseVoting, {
        round: this.round,
        memes: this.memes,
        count: this.memes.length,
        current: this.currentMeme,
        timeLeft: Math.max(0, Math.ceil((this.memeSwitchAt - Date.now()) / 1000)),
        timeTotal: this.roundVoteTime,
        mode: this.settings.mode,
        rule: this.roundRule,
        scoresEnabled: this.settings.mode !== 'relaxed',
        canDownvote: this.roundRule !== 'noDownvotes',
        // Only the resuming socket gets its own votes and buddy pick back; tallies stay secret.
        votes: pl?.votes ?? {},
        buddyIndex: pl?.buddyIndex ?? null,
      })
    } else if (this.phase === 'roundResults' && this.lastRoundResult) {
      send(Events.RoundResults, this.lastRoundResult)
    } else if (this.phase === 'gameOver' && this.ranking) {
      const payload: GameOverPayload = {
        ranking: this.ranking,
        totalRounds: this.totalRounds,
        memes: this.finalMemes,
        gameMode: this.settings.mode,
      }
      send(Events.GameOver, payload)
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

function clampInt(v: unknown, min: number, max: number, fallback = min): number {
  const n =
    typeof v === 'number'
      ? Math.floor(v)
      : typeof v === 'string' && v.trim() !== ''
        ? Math.floor(Number(v))
        : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampNum(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}
