// Shared types used by both the server (realtime game) and the client UI.

export type TextAlign = 'left' | 'center' | 'right'

// ---------------------------------------------------------------------------
// Gameplay limits (shared by server validation and client editors)
// ---------------------------------------------------------------------------

/** Template rerolls per player and round (caption phase). */
export const MAX_REROLLS = 3
/** Maximum number of freeform text lines per submission. */
export const MAX_LINES = 12
/** Maximum length of a single caption text or freeform line. */
export const MAX_TEXT_LEN = 120
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
}

/** Player's caption submission for a round. */
export interface CaptionSubmission {
  /** Fixed template: boxId -> text. Freeform: the lines the player placed. */
  texts: Record<string, string>
  lines: FreeformLine[] // only used for freeform templates
}

export interface PlayerInfo {
  id: string
  username: string
  avatar: string
  color: string
  connected: boolean
  isHost: boolean
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
  round: number
}

/** A meme as sent to clients during the voting phase (same shape as a MemeEntry). */
export type MemeInfo = MemeEntry

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
}

export interface VoteTally {
  up: number
  down: number
  meh: number
}

export type VoteValue = 'up' | 'down' | 'meh'

export interface RoundResult {
  round: number
  memes: Array<{
    index: number
    playerId: string
    username: string
    score: number
    up: number
    down: number
    meh: number
    /** Competition rank by score (ties share a rank, e.g. 1, 1, 3). */
    rank: number
  }>
  totals: Record<string, number>
  /** Player display data by id, so clients can render results without a lobby state. */
  players: Record<string, { username: string; avatar: string; color: string }>
}

export interface LobbySettings {
  rounds: number
  captionTime: number // seconds
  voteTime: number // seconds per meme during voting
  packIds: string[]
  lobbyName: string
}

/** Public template pack summary (home page and lobby settings). */
export interface PackOption {
  id: string
  name: string
  description: string | null
  templateCount: number
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
  PublicList: 'public:list',
  PlayAgain: 'game:play-again',
  Kick: 'lobby:kick',

  // server -> client
  LobbyUpdate: 'lobby:update',
  LobbyJoined: 'lobby:joined',
  LobbyEmpty: 'lobby:empty',
  PublicLobbies: 'public:lobbies',
  PlayerKick: 'player:kick',
  CaptionTemplate: 'caption:template',
  PhaseCaption: 'phase:caption',
  PhaseVoting: 'phase:voting',
  VotingProgress: 'voting:progress',
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
