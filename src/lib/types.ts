// Shared types used by both the server (realtime game) and the client UI.

export type TextAlign = 'left' | 'center' | 'right'

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

export interface VoteTally {
  up: number
  down: number
  meh: number
}

export type VoteValue = 'up' | 'down' | 'meh'

export interface RoundMemeResult {
  memeIndex: number
  score: number
  votes: VoteTally
}

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
  }>
  totals: Record<string, number>
}

export interface LobbySettings {
  rounds: number
  captionTime: number // seconds
  voteTime: number // seconds per meme during voting
  packIds: string[]
  lobbyName: string
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
