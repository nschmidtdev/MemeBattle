'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CaptionSubmission, FinalMeme, RoundResult, TemplateData, VoteValue } from '@/lib/types'
import { Events } from '@/lib/types'
import {
  clearIdentity,
  connectSocket,
  getSavedPlayerId,
  getSavedUsername,
  savePlayerId,
  saveUsername,
  type LobbyState,
  type MemeInfo,
} from '@/lib/client'
import { isMuted, setMuted, sounds } from '@/lib/sounds'
import LobbyView from './views/LobbyView'
import CaptionView from './views/CaptionView'
import VotingView from './views/VotingView'
import ResultsView from './views/ResultsView'

interface GameStateOver {
  ranking: Array<{ playerId: string; username: string; avatar: string; color: string; total: number; rounds: number[] }>
  totalRounds: number
  memes: FinalMeme[]
}

export default function LobbyRoom({ code }: { code: string }) {
  const router = useRouter()
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null)
  const codeRef = useRef(code)
  const endsAtRef = useRef<number | null>(null)
  const lastTickRef = useRef<number>(Infinity)
  const myIdRef = useRef<string | null>(null)

  const [state, setState] = useState<LobbyState | null>(null)
  const [myId, setMyId] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)
  const [online, setOnline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [muted, setMutedState] = useState(false)
  const [now, setNow] = useState(0)

  const [caption, setCaption] = useState<{ template: TemplateData | null; round: number; totalRounds: number } | null>(null)
  const [voting, setVoting] = useState<{ round: number; memes: MemeInfo[]; current: number } | null>(null)
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null)
  const [gameOver, setGameOver] = useState<GameStateOver | null>(null)

  const [nameInput, setNameInput] = useState<string | null>(null)

  // ---------------------------------------------------------------- helpers
  const tryRejoin = useCallback(() => {
    const username = getSavedUsername()
    if (!username) return
    const pid = getSavedPlayerId() ?? crypto.randomUUID()
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
      // While not joined yet, a server error is fatal for this page (e.g.
      // lobby no longer exists) — surface it persistently, not just as a toast.
      if (!myIdRef.current) setJoinError(msg)
      sounds.error()
    })
    socketRef.current = socket

    const onJoined = ({ code: c, playerId }: { code: string; playerId: string }) => {
      savePlayerId(playerId)
      myIdRef.current = playerId
      setMyId(playerId)
      setJoined(true)
      setJoinError(null)
      if (c !== codeRef.current) {
        codeRef.current = c
        router.replace(`/lobby/${c}`)
      }
    }
    const onState = (s: LobbyState) => setState(s)
    const onKick = ({ playerId }: { playerId: string }) => {
      if (playerId === myIdRef.current) {
        clearIdentity()
        setJoined(false)
        router.replace('/')
      }
    }
    const startTimer = (seconds: number) => {
      endsAtRef.current = Date.now() + Math.max(0, seconds) * 1000
      lastTickRef.current = Infinity
    }

    socket.on(Events.LobbyJoined, onJoined)
    socket.on(Events.LobbyUpdate, onState)
    socket.on(Events.LobbyEmpty, () => router.replace('/'))
    socket.on(Events.PlayerKick, onKick)
    socket.on(Events.PhaseCaption, ({ round, totalRounds, timeLeft }: { round: number; totalRounds: number; timeLeft: number }) => {
      setCaption({ template: null, round, totalRounds })
      setVoting(null)
      setRoundResult(null)
      setGameOver(null)
      startTimer(timeLeft)
      sounds.countdown()
    })
    socket.on('caption:template', ({ template, timeLeft }: { template: TemplateData; timeLeft?: number }) => {
      setCaption((prev) => ({
        template,
        round: prev?.round ?? 1,
        totalRounds: prev?.totalRounds ?? 1,
      }))
      if (typeof timeLeft === 'number') startTimer(timeLeft)
    })
    socket.on(Events.PhaseVoting, ({ round, memes, current, timeLeft }: { round: number; memes: MemeInfo[]; current: number; timeLeft: number }) => {
      setVoting({ round, memes, current })
      setCaption(null)
      setRoundResult(null)
      setGameOver(null)
      startTimer(timeLeft)
      sounds.memeShown()
    })
    socket.on(Events.VotingProgress, ({ index, timeLeft }: { index: number; timeLeft: number }) => {
      setVoting((prev) => (prev ? { ...prev, current: index } : prev))
      startTimer(timeLeft)
      sounds.memeShown()
    })
    socket.on(Events.RoundResults, (r: RoundResult) => {
      setRoundResult(r)
      setGameOver(null)
      sounds.results()
    })
    socket.on(Events.GameOver, ({ ranking, totalRounds, memes }: GameStateOver) => {
      setGameOver({ ranking, totalRounds, memes })
      setRoundResult(null)
      sounds.win()
    })
    socket.on('connect', () => {
      setOnline(true)
      tryRejoin()
    })
    socket.on('disconnect', () => setOnline(false))
    socket.connect()

    const tick = setInterval(() => {
      if (endsAtRef.current === null) return
      const left = Math.max(0, endsAtRef.current - Date.now()) / 1000
      setNow(Date.now())
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
      socket.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- helpers
  const joinAs = (username: string) => {
    const name = username.trim().slice(0, 16) || 'Player'
    const pid = getSavedPlayerId() ?? crypto.randomUUID()
    savePlayerId(pid)
    saveUsername(name)
    setJoined(true)
    setJoinError(null)
    setNameInput(null)
    socketRef.current?.emit(Events.Join, { username: name, playerId: pid, code: codeRef.current })
  }

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    setMutedState(next)
  }

  const timeLeftSec = endsAtRef.current !== null ? Math.max(0, (endsAtRef.current - Date.now()) / 1000) : null
  const phaseTotal = state ? (state.phase === 'caption' ? state.settings.captionTime : state.phase === 'voting' ? state.settings.voteTime : null) : null
  const timerPct = timeLeftSec !== null && phaseTotal ? Math.min(100, Math.max(0, (timeLeftSec / phaseTotal) * 100)) : null
  const myPlayer = state?.players.find((p) => p.id === myId) ?? null
  const isHost = myPlayer?.isHost ?? false

  const submitCaption = useCallback((sub: CaptionSubmission) => {
    socketRef.current?.emit(Events.CaptionSubmit, sub)
    sounds.submit()
  }, [])
  const castVote = useCallback((index: number, value: VoteValue) => {
    socketRef.current?.emit(Events.Vote, { index, value })
    sounds.vote()
  }, [])
  const sendSettings = useCallback((patch: Partial<LobbyState['settings']>) => {
    socketRef.current?.emit(Events.Settings, patch)
  }, [])
  const startGame = useCallback(() => socketRef.current?.emit(Events.Start), [])
  const playAgain = useCallback(() => socketRef.current?.emit(Events.PlayAgain), [])
  const kick = useCallback((playerId: string) => socketRef.current?.emit(Events.Kick, { playerId }), [])
  const leave = useCallback(() => {
    socketRef.current?.emit(Events.Leave)
    router.replace('/')
  }, [router])

  // error toast auto-clear
  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(id)
  }, [error])

  // ---------------------------------------------------------------- render
  const showJoinForm = !state && nameInput !== null

  const inGame = (state?.phase ?? '') === 'caption' || (state?.phase ?? '') === 'voting'
  const playerStrip = inGame && state ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {state.players.map((p) => (
        <span
          key={p.id}
          title={p.username + (p.connected ? '' : ' (disconnected)') + (p.isHost ? ' 👑' : '')}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold text-night ${p.connected ? '' : 'opacity-40'}`}
          style={{ background: p.color }}
        >
          {p.username[0]?.toUpperCase()}
        </span>
      ))}
    </div>
  ) : null

  return (
    <div className={`mx-auto px-3 pb-16 sm:px-4 ${state?.phase === 'gameOver' ? 'max-w-6xl' : 'max-w-4xl'}`}>
      {/* ------------------------------------------------------------ top bar */}
      <header className="sticky top-0 z-40 -mx-3 mb-4 border-b border-line/60 bg-night/85 px-3 py-2.5 backdrop-blur-md sm:-mx-4 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto min-w-0 truncate font-display text-lg uppercase tracking-wide sm:text-xl">
            {state?.name ?? 'Meme Battle'}
          </h1>
          <button
            className="rounded-lg border border-line bg-night2 px-2.5 py-1 font-mono text-sm font-bold tracking-[0.2em] text-sun transition hover:border-sun"
            title="Copy lobby code"
            onClick={() => navigator.clipboard?.writeText((state?.code ?? code).toUpperCase())}
          >
            {state ? state.code : code.toUpperCase()} ⧉
          </button>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${state?.isPublic ? 'border-mint/60 text-mint' : 'border-line text-dim'}`}>
            {state?.isPublic ? '🌍 public' : '🔒 private'}
          </span>
          <button
            className="rounded-lg border border-line bg-night2 px-2.5 py-1.5 text-sm transition hover:border-dim"
            title={muted ? 'Unmute' : 'Mute'}
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
            <span className={`w-9 text-right text-sm font-extrabold tabular-nums ${timerPct > 25 ? 'text-dim' : 'text-rose'}`}>
              {Math.ceil(timeLeftSec)}
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
        <LobbyView state={state} myId={myId} onSettings={sendSettings} onStart={startGame} onKick={kick} />
      ) : state.phase === 'caption' && caption ? (
        <CaptionView key={caption.round} template={caption.template} round={caption.round} totalRounds={caption.totalRounds} onSubmit={submitCaption} />
      ) : state.phase === 'voting' && voting ? (
        <VotingView key={voting.round} round={voting.round} memes={voting.memes} current={voting.current} myId={myId} onVote={castVote} />
      ) : state.phase === 'roundResults' && roundResult ? (
        <ResultsView mode="round" result={roundResult} />
      ) : state.phase === 'gameOver' && gameOver ? (
        <ResultsView mode="over" result={gameOver.ranking} memes={gameOver.memes} totalRounds={gameOver.totalRounds} myId={myId} isHost={isHost} onPlayAgain={playAgain} />
      ) : (
        <section className="rounded-2xl border border-line bg-card p-8 text-center text-dim shadow-xl">
          <p className="animate-pulse">Waiting…</p>
        </section>
      )}
    </div>
  )
}
