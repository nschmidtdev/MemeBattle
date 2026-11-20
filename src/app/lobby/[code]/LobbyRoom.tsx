'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  CaptionSubmission,
  ChaosRule,
  GameMode,
  GameOverPayload,
  RoundResult,
  TemplateData,
  VoteValue,
  VotingMemeInfo,
} from '@/lib/types'
import { Events, MAX_REROLLS, MAX_TEXT_LEN } from '@/lib/types'
import { formatDuration } from '@/lib/format'
import {
  clearIdentity,
  connectSocket,
  getSavedPlayerId,
  getSavedUsername,
  randomId,
  savePlayerId,
  saveUsername,
  type LobbyState,
} from '@/lib/client'
import { isMuted, setMuted, sounds } from '@/lib/sounds'
import LobbyView from './views/LobbyView'
import CaptionView from './views/CaptionView'
import VotingView from './views/VotingView'
import ResultsView from './views/ResultsView'
import AdultGateModal from './views/AdultGateModal'

interface CaptionState {
  template: TemplateData | null
  round: number
  totalRounds: number
  rerollsLeft: number
  /** Server-confirmed submission, restored on reconnect. */
  submitted: boolean
  submission: CaptionSubmission | null
  timeTotal: number
  mode: GameMode
  rule: ChaosRule | null
  maxTextLen: number
  scoresEnabled: boolean
}

interface VotingState {
  round: number
  memes: VotingMemeInfo[]
  current: number
  /** Votes this player already cast, restored on reconnect. */
  votes: Record<number, VoteValue>
  /** This player's own Meme Buddy pick for the round (secret until results). */
  buddyIndex: number | null
  timeTotal: number
  mode: GameMode
  rule: ChaosRule | null
  canDownvote: boolean
  scoresEnabled: boolean
}

type CopyState = 'idle' | 'ok' | 'fail'

/** Lobby is gone because the server restarted (lobbies only live in memory). */
// Anchored on "Lobby" so unrelated "Player not found." errors don't wipe the room.
const DEAD_LOBBY_RE = /^lobby\b.*not found|not in this lobby/i
const DEAD_LOBBY_MESSAGE = 'Diese Lobby existiert nicht mehr — der Server wurde neu gestartet.'
const HEADER_AVATARS = 8

export default function LobbyRoom({ code }: { code: string }) {
  const router = useRouter()
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null)
  const codeRef = useRef(code)
  const endsAtRef = useRef<number | null>(null)
  const lastTickRef = useRef<number>(Infinity)
  const myIdRef = useRef<string | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorNonceRef = useRef(0)
  /** Current meme index, so a shortened-timer update cannot hit the wrong meme. */
  const currentMemeRef = useRef<number | null>(null)

  const [state, setState] = useState<LobbyState | null>(null)
  const [myId, setMyId] = useState<string | null>(null)
  const [online, setOnline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [errorNonce, setErrorNonce] = useState(0)
  const [muted, setMutedState] = useState(false)
  /** Only used to re-render the countdown every tick; the value itself is never read. */
  const [, setClock] = useState(0)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  /** Vote rejections are surfaced to VotingView so it can roll back optimistic state. */
  const [voteError, setVoteError] = useState<{ message: string; nonce: number } | null>(null)

  const [caption, setCaption] = useState<CaptionState | null>(null)
  const [voting, setVoting] = useState<VotingState | null>(null)
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null)
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null)
  const [adultPrompt, setAdultPrompt] = useState(false)

  const [nameInput, setNameInput] = useState<string | null>(null)

  // ---------------------------------------------------------------- helpers
  const tryRejoin = useCallback(() => {
    const username = getSavedUsername()
    if (!username) return
    const pid = getSavedPlayerId() ?? randomId()
    savePlayerId(pid)
    setJoinError(null)
    socketRef.current?.emit(Events.Join, { username, playerId: pid, code: codeRef.current })
  }, [])

  // ---------------------------------------------------------------- socket
  useEffect(() => {
    setMutedState(isMuted())
    const unlock = () => sounds.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })

    const socket = connectSocket((msg) => {
      setError(msg)
      setErrorNonce((n) => n + 1)
      // Vote errors arrive after the optimistic UI update: let VotingView undo it.
      if (/vote|voting|unknown meme/i.test(msg)) {
        errorNonceRef.current += 1
        setVoteError({ message: msg, nonce: errorNonceRef.current })
      }
      if (myIdRef.current && DEAD_LOBBY_RE.test(msg)) {
        // Reconnect after a server restart: the lobby only ever lived in memory.
        // Drop every bit of stale game state instead of showing a dead room.
        myIdRef.current = null
        setMyId(null)
        setState(null)
        setCaption(null)
        setVoting(null)
        setRoundResult(null)
        setGameOver(null)
        endsAtRef.current = null
        setJoinError(DEAD_LOBBY_MESSAGE)
      } else if (!myIdRef.current) {
        // Before the first successful join a server error is fatal for this page.
        setJoinError(msg)
      }
      sounds.error()
    })
    socketRef.current = socket

    const onJoined = ({ code: c, playerId }: { code: string; playerId: string }) => {
      savePlayerId(playerId)
      myIdRef.current = playerId
      setMyId(playerId)
      setJoinError(null)
      setError(null)
      if (c !== codeRef.current) {
        codeRef.current = c
        router.replace(`/lobby/${c}`)
      }
    }
    const onState = (s: LobbyState) => setState(s)
    const onEmpty = () => router.replace('/')
    const onKick = ({ playerId }: { playerId: string }) => {
      if (playerId === myIdRef.current) {
        clearIdentity()
        myIdRef.current = null
        setMyId(null)
        router.replace('/')
      }
    }
    const onAdultPrompt = () => setAdultPrompt(true)
    const onAdultDeclined = () => {
      setAdultPrompt(false)
      clearIdentity()
      myIdRef.current = null
      setMyId(null)
      router.replace('/?adult=declined')
    }
    const startTimer = (seconds: number) => {
      endsAtRef.current = Date.now() + Math.max(0, seconds) * 1000
      lastTickRef.current = Infinity
    }

    const onPhaseCaption = ({
      round,
      totalRounds,
      timeLeft,
      timeTotal,
      mode,
      rule,
      maxTextLen,
      scoresEnabled,
    }: {
      round: number
      totalRounds: number
      timeLeft: number
      timeTotal?: number
      mode?: GameMode
      rule?: ChaosRule | null
      maxTextLen?: number
      scoresEnabled?: boolean
    }) => {
      setCaption({
        template: null,
        round,
        totalRounds,
        rerollsLeft: MAX_REROLLS,
        submitted: false,
        submission: null,
        timeTotal: timeTotal ?? timeLeft,
        mode: mode ?? 'normal',
        rule: rule ?? null,
        maxTextLen: maxTextLen ?? MAX_TEXT_LEN,
        scoresEnabled: scoresEnabled ?? true,
      })
      setVoting(null)
      setRoundResult(null)
      setGameOver(null)
      startTimer(timeLeft)
      sounds.countdown()
    }

    const onCaptionTemplate = ({
      template,
      timeLeft,
      timeTotal,
      rerollsLeft,
      round,
      totalRounds,
      submitted,
      submission,
      mode,
      rule,
      maxTextLen,
      scoresEnabled,
    }: {
      template: TemplateData | null
      timeLeft?: number
      timeTotal?: number
      rerollsLeft?: number
      round?: number
      totalRounds?: number
      submitted?: boolean
      submission?: CaptionSubmission | null
      mode?: GameMode
      rule?: ChaosRule | null
      maxTextLen?: number
      scoresEnabled?: boolean
    }) => {
      setCaption((prev) => ({
        template,
        round: round ?? prev?.round ?? 1,
        totalRounds: totalRounds ?? prev?.totalRounds ?? 1,
        rerollsLeft: typeof rerollsLeft === 'number' ? rerollsLeft : (prev?.rerollsLeft ?? 0),
        // Resume payloads carry the server-confirmed submission; rerolls omit it.
        submitted: typeof submitted === 'boolean' ? submitted : (prev?.submitted ?? false),
        submission: submission !== undefined ? submission : (prev?.submission ?? null),
        timeTotal: typeof timeTotal === 'number' ? timeTotal : (prev?.timeTotal ?? timeLeft ?? 0),
        mode: mode ?? prev?.mode ?? 'normal',
        rule: rule !== undefined ? rule : (prev?.rule ?? null),
        maxTextLen:
          typeof maxTextLen === 'number' ? maxTextLen : (prev?.maxTextLen ?? MAX_TEXT_LEN),
        scoresEnabled:
          typeof scoresEnabled === 'boolean' ? scoresEnabled : (prev?.scoresEnabled ?? true),
      }))
      if (typeof timeLeft === 'number') startTimer(timeLeft)
    }

    const onPhaseVoting = ({
      round,
      memes,
      current,
      timeLeft,
      timeTotal,
      votes,
      buddyIndex,
      mode,
      rule,
      canDownvote,
      scoresEnabled,
    }: {
      round: number
      memes: VotingMemeInfo[]
      current: number
      timeLeft: number
      timeTotal?: number
      votes?: Record<number, VoteValue>
      buddyIndex?: number | null
      mode?: GameMode
      rule?: ChaosRule | null
      canDownvote?: boolean
      scoresEnabled?: boolean
    }) => {
      setVoting({
        round,
        memes,
        current,
        votes: votes ?? {},
        // Resume payloads carry the player's own pick; older payloads omit it.
        buddyIndex: typeof buddyIndex === 'number' ? buddyIndex : null,
        timeTotal: timeTotal ?? timeLeft,
        mode: mode ?? 'normal',
        rule: rule ?? null,
        canDownvote: canDownvote ?? true,
        scoresEnabled: scoresEnabled ?? true,
      })
      currentMemeRef.current = current
      setCaption(null)
      setRoundResult(null)
      setGameOver(null)
      setVoteError(null)
      startTimer(timeLeft)
      // The following voting:progress(0) plays memeShown(); don't double it here.
    }

    const onVotingProgress = ({
      index,
      timeLeft,
    }: {
      index: number
      timeLeft: number
    }) => {
      currentMemeRef.current = index
      setVoting((prev) => (prev ? { ...prev, current: index } : prev))
      startTimer(timeLeft)
      sounds.memeShown()
    }

    const onVotingTimer = ({ index, timeLeft }: { index: number; timeLeft: number }) => {
      // Everyone eligible voted: the server capped the remaining time.
      if (currentMemeRef.current === index) startTimer(timeLeft)
    }

    const onBuddyPicked = ({ index }: { index: number }) => {
      // Only the picker receives this event; it confirms the one pick per round.
      setVoting((prev) => (prev ? { ...prev, buddyIndex: index } : prev))
    }

    const onRoundResults = (r: RoundResult) => {
      setRoundResult(r)
      setGameOver(null)
      sounds.results()
    }

    const onGameOver = ({ ranking, totalRounds, memes, gameMode }: GameOverPayload) => {
      setGameOver({ ranking, totalRounds, memes, gameMode: gameMode ?? 'normal' })
      setRoundResult(null)
      sounds.win()
    }

    const onConnect = () => {
      setOnline(true)
      tryRejoin()
    }
    const onDisconnect = () => setOnline(false)

    socket.on(Events.LobbyJoined, onJoined)
    socket.on(Events.LobbyUpdate, onState)
    socket.on(Events.LobbyEmpty, onEmpty)
    socket.on(Events.PlayerKick, onKick)
    socket.on(Events.AdultPrompt, onAdultPrompt)
    socket.on(Events.AdultDeclined, onAdultDeclined)
    socket.on(Events.PhaseCaption, onPhaseCaption)
    socket.on(Events.CaptionTemplate, onCaptionTemplate)
    socket.on(Events.PhaseVoting, onPhaseVoting)
    socket.on(Events.VotingProgress, onVotingProgress)
    socket.on(Events.VotingTimer, onVotingTimer)
    socket.on(Events.BuddyPicked, onBuddyPicked)
    socket.on(Events.RoundResults, onRoundResults)
    socket.on(Events.GameOver, onGameOver)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.connect()

    const tick = setInterval(() => {
      if (endsAtRef.current === null) return
      const left = Math.max(0, endsAtRef.current - Date.now()) / 1000
      setClock(Date.now())
      const sec = Math.ceil(left)
      if (left > 0 && sec <= 3 && sec !== lastTickRef.current) {
        lastTickRef.current = sec
        sounds.tick()
      }
      if (left <= 0) endsAtRef.current = null
    }, 250)

    return () => {
      window.removeEventListener('pointerdown', unlock)
      clearInterval(tick)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      // Every listener gets removed explicitly: the socket may reconnect after unmount otherwise.
      socket.off(Events.LobbyJoined, onJoined)
      socket.off(Events.LobbyUpdate, onState)
      socket.off(Events.LobbyEmpty, onEmpty)
      socket.off(Events.PlayerKick, onKick)
      socket.off(Events.AdultPrompt, onAdultPrompt)
      socket.off(Events.AdultDeclined, onAdultDeclined)
      socket.off(Events.PhaseCaption, onPhaseCaption)
      socket.off(Events.CaptionTemplate, onCaptionTemplate)
      socket.off(Events.PhaseVoting, onPhaseVoting)
      socket.off(Events.VotingProgress, onVotingProgress)
      socket.off(Events.VotingTimer, onVotingTimer)
      socket.off(Events.BuddyPicked, onBuddyPicked)
      socket.off(Events.RoundResults, onRoundResults)
      socket.off(Events.GameOver, onGameOver)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- actions
  const joinAs = (username: string) => {
    const name = username.trim().slice(0, 16) || 'Player'
    const pid = getSavedPlayerId() ?? randomId()
    savePlayerId(pid)
    saveUsername(name)
    setJoinError(null)
    setNameInput(null)
    socketRef.current?.emit(Events.Join, { username: name, playerId: pid, code: codeRef.current })
  }

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    setMutedState(next)
  }

  const copyCode = useCallback(async () => {
    const text = (state?.code ?? codeRef.current).toUpperCase()
    let ok = false
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        ok = true
      }
    } catch {
      // fall through to the legacy path
    }
    if (!ok) {
      const ta = document.createElement('textarea')
      try {
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand('copy')
      } catch {
        ok = false
      } finally {
        ta.remove()
      }
    }
    setCopyState(ok ? 'ok' : 'fail')
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyState('idle'), 1800)
  }, [state?.code])

  const submitCaption = useCallback((sub: CaptionSubmission) => {
    socketRef.current?.emit(Events.CaptionSubmit, sub)
    // Mark locally right away; the server is the source of truth on resume.
    setCaption((prev) => (prev ? { ...prev, submitted: true, submission: sub } : prev))
    sounds.submit()
  }, [])
  const rerollTemplate = useCallback(() => {
    socketRef.current?.emit(Events.Reroll)
  }, [])
  const castVote = useCallback((index: number, value: VoteValue) => {
    socketRef.current?.emit(Events.Vote, { index, value })
    sounds.vote()
  }, [])
  const pickBuddy = useCallback((index: number) => {
    socketRef.current?.emit(Events.BuddyPick, { index })
  }, [])
  const sendSettings = useCallback((patch: Partial<LobbyState['settings']>) => {
    socketRef.current?.emit(Events.Settings, patch)
  }, [])
  const startGame = useCallback(() => socketRef.current?.emit(Events.Start), [])
  const playAgain = useCallback(() => socketRef.current?.emit(Events.PlayAgain), [])
  const kick = useCallback((playerId: string) => socketRef.current?.emit(Events.Kick, { playerId }), [])
  const leave = useCallback(() => {
    if (!window.confirm('Leave this lobby?')) return
    socketRef.current?.emit(Events.Leave)
    router.replace('/')
  }, [router])

  // error toast auto-clear
  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(id)
  }, [error])

  // Scroll back to the top whenever the view changes; timer ticks and template
  // rerolls intentionally do not trigger this.
  const currentMemeIndex = voting?.current ?? null
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [state?.phase, currentMemeIndex, roundResult, gameOver])

  // ---------------------------------------------------------------- render
  const timeLeftSec =
    endsAtRef.current !== null
      ? Math.max(0, (endsAtRef.current - Date.now()) / 1000)
      : // Caption timer already ran out (the tick clears endsAtRef at zero).
        state?.phase === 'caption'
        ? 0
        : null
  const phaseTotal = state
    ? state.phase === 'caption'
      ? (caption?.timeTotal || state.settings.captionTime)
      : state.phase === 'voting'
        ? (voting?.timeTotal || state.settings.voteTime)
        : null
    : null
  const timerPct = timeLeftSec !== null && phaseTotal ? Math.min(100, Math.max(0, (timeLeftSec / phaseTotal) * 100)) : null
  const myPlayer = state?.players.find((p) => p.id === myId) ?? null
  const isHost = myPlayer?.isHost ?? false

  const showJoinForm = !state && nameInput !== null && !joinError

  const inGame = (state?.phase ?? '') === 'caption' || (state?.phase ?? '') === 'voting'
  const headerPlayers = state ? state.players.slice(0, HEADER_AVATARS) : []
  const hiddenPlayers = state ? Math.max(0, state.players.length - headerPlayers.length) : 0
  const playerStrip = inGame && state ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {headerPlayers.map((p) => (
        <span
          key={p.id}
          title={p.username + (p.connected ? '' : ' (disconnected)') + (p.isHost ? ' 👑' : '')}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold text-night ${p.connected ? '' : 'opacity-40'}`}
          style={{ background: p.color }}
        >
          {p.username[0]?.toUpperCase()}
        </span>
      ))}
      {hiddenPlayers > 0 && (
        <span
          title={state.players.slice(HEADER_AVATARS).map((p) => p.username).join(', ')}
          className="flex h-8 min-w-8 items-center justify-center rounded-full border border-line bg-night2 px-1.5 text-xs font-bold text-dim"
        >
          +{hiddenPlayers}
        </span>
      )}
    </div>
  ) : null

  return (
    <div
      className={`mx-auto px-3 pb-16 sm:px-4 ${
        state?.phase === 'gameOver' ||
        state?.phase === 'roundResults' ||
        state?.phase === 'caption'
          ? 'max-w-6xl'
          : 'max-w-4xl'
      }`}
    >
      {/* ------------------------------------------------------------ top bar */}
      <header className="sticky top-0 z-40 -mx-3 mb-4 border-b border-line/60 bg-night/85 px-3 py-2.5 backdrop-blur-md sm:-mx-4 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto min-w-0 truncate font-display text-lg uppercase tracking-wide sm:text-xl">
            {state?.name ?? 'Meme Battle'}
          </h1>
          <button
            className="rounded-lg border border-line bg-night2 px-2.5 py-1 font-mono text-sm font-bold tracking-[0.2em] text-sun transition hover:border-sun"
            title="Copy lobby code"
            onClick={copyCode}
            aria-live="polite"
          >
            {state ? state.code : code.toUpperCase()}{' '}
            <span className={copyState === 'fail' ? 'font-sans text-rose' : copyState === 'ok' ? 'font-sans text-mint' : ''}>
              {copyState === 'ok' ? '✓ Copied!' : copyState === 'fail' ? '⚠ Failed' : '⧉'}
            </span>
          </button>
          <span className={`hidden rounded-full border px-2.5 py-1 text-xs font-semibold sm:inline-flex ${state?.isPublic ? 'border-mint/60 text-mint' : 'border-line text-dim'}`}>
            {state?.isPublic ? '🌍 public' : '🔒 private'}
          </span>
          <button
            className="rounded-lg border border-line bg-night2 px-2.5 py-1.5 text-sm transition hover:border-dim"
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute sound' : 'Mute sound'}
            aria-pressed={muted}
            onClick={toggleMute}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          {state && (
            <button
              className="rounded-lg border border-rose/60 bg-night2 px-2.5 py-1.5 text-sm text-rose transition hover:bg-rose/10"
              onClick={leave}
            >
              Leave
            </button>
          )}
        </div>

        {timerPct !== null && timeLeftSec !== null && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-night2">
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${timerPct > 50 ? 'bg-mint' : timerPct > 25 ? 'bg-sun' : 'bg-rose'}`}
                style={{ width: `${timerPct}%` }}
              />
            </div>
            <span className={`w-16 text-right text-sm font-extrabold tabular-nums ${timerPct > 25 ? 'text-dim' : 'text-rose'}`}>
              {formatDuration(timeLeftSec)}
            </span>
          </div>
        )}

        {playerStrip && <div className="mt-2">{playerStrip}</div>}
      </header>

      {!online && (
        <div className="mb-4 rounded-xl border border-sky/50 bg-sky/10 px-4 py-2.5 text-sm text-sky">
          Reconnecting…
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose/50 bg-rose/10 px-4 py-2.5 text-sm text-rose">
          <span>{error}</span>
          <button className="font-bold" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {showJoinForm ? (
        <section className="mx-auto mt-16 max-w-sm rounded-2xl border border-line bg-card p-6 shadow-xl">
          <h2 className="mb-1 font-display text-2xl uppercase tracking-wide">
            Join <span className="text-sun">{code.toUpperCase()}</span>
          </h2>
          <p className="mb-4 text-sm text-dim">Pick a name and hop in.</p>
          <input
            autoFocus
            className="w-full rounded-xl border border-line bg-night px-4 py-3 text-lg font-semibold"
            value={nameInput ?? ''}
            maxLength={16}
            placeholder="Your name"
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && joinAs(nameInput ?? '')}
          />
          <div className="mt-4 flex gap-2">
            <button
              className="flex-1 rounded-xl bg-gradient-to-r from-punch to-punch2 py-3 font-extrabold uppercase tracking-wide text-night shadow-lg transition hover:brightness-110"
              onClick={() => joinAs(nameInput ?? '')}
            >
              Join
            </button>
            <button
              className="rounded-xl border border-line px-4 py-3 text-dim transition hover:border-dim hover:text-ink"
              onClick={() => router.replace('/')}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : !state ? (
        <section className="mx-auto mt-16 max-w-sm rounded-2xl border border-line bg-card p-6 text-center shadow-xl">
          {getSavedUsername() === null && nameInput === null ? (
            <>
              <h2 className="mb-1 font-display text-2xl uppercase tracking-wide">
                Join <span className="text-sun">{code.toUpperCase()}</span>
              </h2>
              <p className="mb-4 text-sm text-dim">Enter a name to join this lobby.</p>
              <button
                className="rounded-xl bg-gradient-to-r from-punch to-punch2 px-6 py-3 font-extrabold uppercase tracking-wide text-night shadow-lg transition hover:brightness-110"
                onClick={() => setNameInput('')}
              >
                Enter name
              </button>
            </>
          ) : joinError ? (
            <>
              <h2 className="mb-2 font-display text-2xl uppercase tracking-wide">
                Join <span className="text-sun">{code.toUpperCase()}</span>
              </h2>
              <p className="mb-2 text-sm text-rose">{joinError}</p>
              <p className="text-xs text-dim">
                Lobbies live in server memory — this lobby may have ended or the server may have
                been restarted.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <button
                  className="rounded-xl bg-gradient-to-r from-punch to-punch2 px-5 py-2.5 font-bold text-night shadow-lg transition hover:brightness-110"
                  onClick={() => router.replace('/')}
                >
                  Back to home
                </button>
                <button
                  className="rounded-xl border border-line px-5 py-2.5 text-dim transition hover:border-dim hover:text-ink"
                  onClick={() => tryRejoin()}
                >
                  Try again
                </button>
              </div>
            </>
          ) : (
            <p className="animate-pulse text-dim">Connecting to lobby…</p>
          )}
        </section>
      ) : state.phase === 'lobby' ? (
        <LobbyView
          state={state}
          myId={myId}
          onSettings={sendSettings}
          onStart={startGame}
          onKick={kick}
          error={error}
          errorNonce={errorNonce}
        />
      ) : state.phase === 'caption' && caption ? (
        <CaptionView
          key={caption.round}
          template={caption.template}
          round={caption.round}
          totalRounds={caption.totalRounds}
          rerollsLeft={caption.rerollsLeft}
          mode={caption.mode}
          rule={caption.rule}
          maxTextLen={caption.maxTextLen}
          timeLeft={timeLeftSec}
          forceSubmission={state.settings.forceSubmission}
          submitted={caption.submitted}
          submission={caption.submission}
          onReroll={rerollTemplate}
          onSubmit={submitCaption}
        />
      ) : state.phase === 'voting' && voting ? (
        <VotingView
          key={voting.round}
          round={voting.round}
          memes={voting.memes}
          current={voting.current}
          initialVotes={voting.votes}
          voteError={voteError}
          onVote={castVote}
          buddyIndex={voting.buddyIndex}
          onPickBuddy={pickBuddy}
          rule={voting.rule}
          canDownvote={voting.canDownvote}
          scoresEnabled={voting.scoresEnabled}
        />
      ) : state.phase === 'roundResults' && roundResult ? (
        <ResultsView
          mode="round"
          result={roundResult}
          myId={myId}
          totalRounds={state.settings.rounds}
          gameMode={roundResult.gameMode}
        />
      ) : state.phase === 'gameOver' && gameOver ? (
        <ResultsView
          mode="over"
          ranking={gameOver.ranking}
          memes={gameOver.memes}
          totalRounds={gameOver.totalRounds}
          myId={myId}
          isHost={isHost}
          onPlayAgain={playAgain}
          gameMode={gameOver.gameMode}
        />
      ) : (
        <section className="rounded-2xl border border-line bg-card p-8 text-center text-dim shadow-xl">
          <p className="animate-pulse">Waiting…</p>
        </section>
      )}

      <AdultGateModal
        open={adultPrompt}
        onAnswer={(accepted) => {
          setAdultPrompt(false)
          socketRef.current?.emit(Events.AdultAnswer, { accepted })
          if (!accepted) {
            clearIdentity()
            myIdRef.current = null
            setMyId(null)
            router.replace('/?adult=declined')
          }
        }}
      />
    </div>
  )
}
