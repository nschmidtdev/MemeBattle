// Shared types used by both the server (realtime game) and the client UI.

export type TextAlign = 'left' | 'center' | 'right'

// ---------------------------------------------------------------------------
// Gameplay limits (shared by server validation and client editors)
// ---------------------------------------------------------------------------

/** Hard cap for template rerolls per player and round (caption phase). */
export const MAX_REROLLS = 20
/** Default number of rerolls for new lobbies. */
export const DEFAULT_REROLLS = 10
/** Maximum number of freeform text lines per submission. */
export const MAX_LINES = 12
/** Maximum length of a single caption text or freeform line. */
export const MAX_TEXT_LEN = 120
/** Chaos mode "short text" cap. */
export const SHORT_TEXT_MAX = 40

export const GAME_MODES = ['normal', 'same', 'relaxed', 'chaos'] as const
export type GameMode = (typeof GAME_MODES)[number]

export const CHAOS_RULES = ['double', 'noDownvotes', 'shortText', 'fast'] as const
export type ChaosRule = (typeof CHAOS_RULES)[number]
/** Allowed ranges for freeform line placement (relative units). */
export const LINE_BOUNDS = {
  xMin: 0.05,
  xMax: 0.95,
  yMin: 0.02,
  yMax: 0.98,
  fontSizeMin: 0.02,
  fontSizeMax: 0.25,
} as const

/** Width range both text editors expose (relative to the image width). */
export const TEXT_WIDTH_BOUNDS = { min: 0.1, max: 1 } as const

/** Allowed text rotation in degrees. */
export const ROTATION_BOUNDS = { min: -90, max: 90 } as const

/** Maximum number of pre-placed text boxes a template may carry. */
export const MAX_TEMPLATE_BOXES = 12

/** Maximum length of a template box id; `randomId()` stays within this. */
export const MAX_ID_LENGTH = 32

/** A pre-placed text slot on a template (fixed templates). */
export interface TemplateBox {
  id: string
  /** Relative position of the text block center, 0..1 */
  x: number
  y: number
  /** Relative max width of the text block, 0..1 */
  w: number
  /** Font size relative to image height, e.g. 0.06 */
  fontSize: number
  color: string
  stroke: string
  font: string
  align: TextAlign
  /** Degrees, 0 = upright */
  rotation: number
  defaultText?: string
}

/** A meme template as it flows through the game (no DB metadata). */
export interface TemplateData {
  id: string
  name: string
  imageKey: string
  isFreeform: boolean
  boxes: TemplateBox[]
}

/** A text line the player placed on a freeform template. */
export interface FreeformLine {
  id: string
  text: string
  /** Relative position of the text block center, 0..1 */
  x: number
  y: number
  /** Relative max width of the text block, 0..1 */
  w: number
  /** Font size relative to image height, e.g. 0.06 */
  fontSize: number
  color: string
  stroke: string
  font: string
  align: TextAlign
  /** Degrees, 0 = upright */
  rotation: number
  /** Optional opaque white box behind the whole text block. */
  whiteBackground?: boolean
}

/** A text item as rendered on the final meme (fixed box w/ player text, or freeform line). */
export interface RenderTextItem {
  id: string
  text: string
  x: number
  y: number
  w: number
  fontSize: number
  color: string
  stroke: string
  font: string
  align: TextAlign
  rotation: number
  /** Draw an opaque white rectangle behind the text block. */
  whiteBackground?: boolean
}

/** Optional white bars above/below the template image. */
export interface MemePadding {
  /** Bar height as a fraction of the image height (0..1). */
  top: number
  /** Bar height as a fraction of the image height (0..1). */
  bottom: number
}

/** Player's caption submission for a round. */
export interface CaptionSubmission {
  /** Fixed template: boxId -> text. Freeform: the lines the player placed. */
  texts: Record<string, string>
  lines: FreeformLine[] // only used for freeform templates
  /** Optional whitespace bars around the template (omitted when inactive). */
  padding?: MemePadding
  /**
   * Sent by the client when the caption timer expires and forced submissions
   * are enabled. The server accepts an otherwise empty draft for these.
   */
  auto?: boolean
}

export interface PlayerInfo {
  id: string
  username: string
  avatar: string
  color: string
  connected: boolean
  isHost: boolean
  /** Confirmed the +18 prompt for this lobby (always true when no adult packs are active). */
  adultOk: boolean
}

export interface MemeEntry {
  playerId: string
  username: string
  avatar: string
  color: string
  template: TemplateData
  submission: CaptionSubmission
}

/** A scored meme of a finished round — collected for the final gallery. */
export interface FinalMeme extends MemeEntry {
  score: number
  /** Number of Meme Buddies this meme received. */
  buddyCount: number
  round: number
}

/** A meme as sent to clients during the voting phase (same shape as a MemeEntry). */
export type MemeInfo = MemeEntry

/**
 * A meme as sent to one voter during the voting phase. Owner identity is
 * deliberately absent: votes stay anonymous until the results. `mine` marks
 * the receiver's own meme (only used to hide the vote buttons).
 */
export interface VotingMemeInfo {
  template: TemplateData
  submission: CaptionSubmission
  mine: boolean
}

/** One player's row in the final ranking. */
export interface RankingEntry {
  playerId: string
  username: string
  avatar: string
  color: string
  total: number
  rounds: number[]
  /** Competition rank from the server (ties share a rank). */
  rank?: number
}

/** Payload of the `game:over` event. */
export interface GameOverPayload {
  ranking: RankingEntry[]
  totalRounds: number
  memes: FinalMeme[]
  gameMode: GameMode
}

export interface VoteTally {
  up: number
  down: number
  meh: number
}

export type VoteValue = 'up' | 'down' | 'meh'

/** One Meme Buddy pick of a finished round, for the results screen. */
export interface RoundBuddyPick {
  playerId: string
  username: string
  targetPlayerId: string
  targetUsername: string
  index: number
  /** Half of the meme's final score (rounded); may be negative. */
  bonus: number
}

export interface RoundResult {
  round: number
  /** Mode of the game this round belongs to. */
  gameMode: GameMode
  /** Chaos rule for this round (null in every other mode). */
  rule: ChaosRule | null
  memes: Array<{
    index: number
    playerId: string
    username: string
    /** Final meme score: voteScore + buddyBonus. */
    score: number
    /** Score from the votes alone (-1000..+1000). */
    voteScore: number
    /** MEME_BUDDY_POINTS × buddyCount. */
    buddyBonus: number
    buddyCount: number
    /** Players who gave this meme their Meme Buddy. */
    buddyPlayerIds: string[]
    template: TemplateData
    submission: CaptionSubmission
    up: number
    down: number
    meh: number
    /** Competition rank by final score (ties share a rank, e.g. 1, 1, 3). */
    rank: number
  }>
  /** Cumulative total per player id. */
  totals: Record<string, number>
  /** Points scored in this round per player id (meme score + Meme Buddy bonus). */
  roundTotals: Record<string, number>
  /** Meme Buddy picks of this round. */
  buddies: RoundBuddyPick[]
  /** Player display data by id, so clients can render results without a lobby state. */
  players: Record<string, { username: string; avatar: string; color: string }>
}

export interface LobbySettings {
  mode: GameMode
  rounds: number
  /** Template rerolls per player and round (0..MAX_REROLLS). */
  rerolls: number
  captionTime: number // seconds
  voteTime: number // seconds per meme during voting
  packIds: string[]
  lobbyName: string
  /**
   * Everyone must submit before voting starts (default). When disabled, the
   * round starts on the timer with whoever submitted ("spectators").
   */
  forceSubmission: boolean
}

/** Public template pack summary (home page and lobby settings). */
export interface PackOption {
  id: string
  name: string
  description: string | null
  templateCount: number
  /** Contains adult (18+) templates; lobbies ask every player to confirm. */
  adult: boolean
}

export type Phase = 'lobby' | 'caption' | 'voting' | 'roundResults' | 'gameOver'

// ---------------------------------------------------------------------------
// Socket protocol
// ---------------------------------------------------------------------------

export const Events = {
  // client -> server
  Join: 'lobby:join',
  Leave: 'lobby:leave',
  Settings: 'lobby:settings',
  Start: 'lobby:start',
  CaptionSubmit: 'caption:submit',
  Reroll: 'caption:reroll',
  Vote: 'vote:cast',
  BuddyPick: 'buddy:pick',
  PublicList: 'public:list',
  PlayAgain: 'game:play-again',
  Kick: 'lobby:kick',
  AdultAnswer: 'adult:answer',

  // server -> client
  LobbyUpdate: 'lobby:update',
  LobbyJoined: 'lobby:joined',
  LobbyEmpty: 'lobby:empty',
  PublicLobbies: 'public:lobbies',
  PlayerKick: 'player:kick',
  AdultPrompt: 'adult:prompt',
  AdultDeclined: 'adult:declined',
  CaptionTemplate: 'caption:template',
  PhaseCaption: 'phase:caption',
  PhaseVoting: 'phase:voting',
  VotingProgress: 'voting:progress',
  VotingTimer: 'voting:timer',
  BuddyPicked: 'buddy:picked',
  RoundResults: 'round:results',
  GameOver: 'game:over',
  Error: 'client:error',
} as const

export const FONT_OPTIONS = [
  'Impact',
  'Arial Black',
  'Verdana',
  'Comic Sans MS',
  'Georgia',
  'Courier New',
  'Trebuchet MS',
]

export const DEFAULT_BOX: Omit<TemplateBox, 'id' | 'x' | 'y'> = {
  w: 0.9,
  fontSize: 0.06,
  color: '#ffffff',
  stroke: '#000000',
  font: 'Impact',
  align: 'center',
  rotation: 0,
}
