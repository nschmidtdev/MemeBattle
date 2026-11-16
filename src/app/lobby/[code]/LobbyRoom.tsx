'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CaptionSubmission, RoundResult, TemplateData, VoteTally, VoteValue } from '@/lib/types'
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
  const [counts, setCounts] = useState<Record<number, VoteTally>>({})
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
      setCounts({})
      startTimer(timeLeft)
      sounds.memeShown()
    })
    socket.on(Events.VotingProgress, ({ index, timeLeft }: { index: number; timeLeft: number }) => {
      setVoting((prev) => (prev ? { ...prev, current: index } : prev))
      startTimer(timeLeft)
      sounds.memeShown()
    })
    socket.on(Events.VotingCounts, ({ index, up, down, meh }: { index: number; up: number; down: number; meh: number }) => {
      setCounts((prev) => ({ ...prev, [index]: { up, down, meh } }))
    })
    socket.on(Events.RoundResults, (r: RoundResult) => {
      setRoundResult(r)
      setGameOver(null)
      sounds.results()
    })
    socket.on(Events.GameOver, ({ ranking, totalRounds }: GameStateOver) => {
      setGameOver({ ranking, totalRounds })
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

  const playerList = state && state.phase !== 'caption' && state.phase !== 'voting' ? (
    <aside className="panel">
      <h3>Players ({state.players.length}/{state.maxPlayers})</h3>
      {state.players.map((p) => (
        <div key={p.id} className={`player-card${p.connected ? '' : ' disconnected'}`}>
          <span className="avatar" style={{ background: p.color }}>{p.username[0]?.toUpperCase()}</span>
          <span className="uname">{p.username}{p.id === myId ? ' (you)' : ''}</span>
          {p.isHost && <span className="host-badge">HOST</span>}
          {isHost && p.id !== myId && state.phase === 'lobby' && (
            <button className="kick-btn" title="Kick" onClick={() => kick(p.id)}>✕</button>
          )}
        </div>
      ))}
    </aside>
  ) : null

  return (
    <div className="container">
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{state?.name ?? 'Meme Battle'}</h1>
          <span className="badge">
            {state ? state.code : code.toUpperCase()}
            <button
              className="ghost"
              style={{ padding: '0 4px', fontSize: 12 }}
              onClick={() => navigator.clipboard?.writeText((state?.code ?? code).toUpperCase())}
              title="Copy code"
            >⧉</button>
          </span>
          {state?.isPublic ? <span className="badge">public</span> : <span className="badge">private</span>}
        </div>
        <div className="row">
          <button className="ghost" onClick={toggleMute}>{muted ? '🔇' : '🔊'}</button>
          {state && <button className="danger" onClick={leave}>Leave</button>}
        </div>
      </div>

      {!online && <div className="error-banner">Connecting…</div>}
      {error && <div className="error-banner">{error}</div>}

      {timerPct !== null && timeLeftSec !== null && (
        <div className="timer-bar" style={{ marginBottom: 14 }}>
          <div style={{ width: `${timerPct}%` }} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 16, alignItems: 'start' }}>
        <main>
          {showJoinForm ? (
            <div className="panel" style={{ maxWidth: 340, margin: '60px auto' }}>
              <h2>Join {code.toUpperCase()}</h2>
              <input
                autoFocus
                value={nameInput ?? ''}
                maxLength={16}
                placeholder="Your name"
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && joinAs(nameInput ?? '')}
              />
              <div className="row" style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => joinAs(nameInput ?? '')}>Join</button>
                <button className="ghost" onClick={() => router.replace('/')}>Cancel</button>
              </div>
            </div>
          ) : !state ? (
            <div className="panel" style={{ maxWidth: 340, margin: '60px auto', textAlign: 'center' }}>
              {getSavedUsername() === null && nameInput === null ? (
                <>
                  <h2>Join {code.toUpperCase()}</h2>
                  <p className="muted">Enter a name to join this lobby.</p>
                  <button className="primary" onClick={() => setNameInput('')}>Enter name</button>
                </>
              ) : joinError ? (
                <>
                  <h2>Join {code.toUpperCase()}</h2>
                  <p className="muted">{joinError}</p>
                  <p className="muted" style={{ fontSize: 12 }}>
                    Lobbies live in server memory — this lobby may have ended or the server may have
                    been restarted.
                  </p>
                  <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
                    <button className="primary" onClick={() => router.replace('/')}>Back to home</button>
                    <button className="ghost" onClick={() => tryRejoin()}>Try again</button>
                  </div>
                </>
              ) : (
                <p className="muted">Connecting to lobby…</p>
              )}
            </div>
          ) : state.phase === 'lobby' ? (
            <LobbyView state={state} myId={myId} onSettings={sendSettings} onStart={startGame} />
          ) : state.phase === 'caption' && caption ? (
            <CaptionView key={caption.round} template={caption.template} round={caption.round} totalRounds={caption.totalRounds} onSubmit={submitCaption} />
          ) : state.phase === 'voting' && voting ? (
            <VotingView key={voting.round} round={voting.round} memes={voting.memes} current={voting.current} counts={counts} myId={myId} onVote={castVote} />
          ) : state.phase === 'roundResults' && roundResult ? (
            <ResultsView mode="round" result={roundResult} />
          ) : state.phase === 'gameOver' && gameOver ? (
            <ResultsView mode="over" result={gameOver.ranking} totalRounds={gameOver.totalRounds} myId={myId} isHost={isHost} onPlayAgain={playAgain} />
          ) : (
            <div className="panel"><p className="muted">Waiting…</p></div>
          )}
        </main>
        {playerList}
      </div>
    </div>
  )
}
