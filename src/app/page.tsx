'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  connectSocket,
  getSavedPlayerId,
  getSavedUsername,
  randomId,
  savePlayerId,
  saveUsername,
  type PublicLobbyInfo,
} from '@/lib/client'
import { Events, type PackOption } from '@/lib/types'
import { formatDuration } from '@/lib/format'
import { sounds } from '@/lib/sounds'

type PendingAction = 'quick' | 'code' | 'create' | null

interface PendingJoin {
  handler: (payload: { code: string }) => void
  timer: ReturnType<typeof setTimeout>
}

export default function StartPage() {
  const router = useRouter()
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null)
  /** The one `LobbyJoined` listener + safety timeout for an in-flight join. */
  const pendingJoinRef = useRef<PendingJoin | null>(null)

  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lobbies, setLobbies] = useState<PublicLobbyInfo[]>([])
  const [packs, setPacks] = useState<PackOption[] | null>(null)
  const [packsError, setPacksError] = useState<string | null>(null)

  // one-at-a-time join/create state: prevents double taps and double lobbies
  const [pending, setPending] = useState<PendingAction>(null)

  // create form
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [rounds, setRounds] = useState(3)
  const [rerolls, setRerolls] = useState(10)
  const [captionTime, setCaptionTime] = useState(45)
  const [voteTime, setVoteTime] = useState(10)
  const [packIds, setPackIds] = useState<string[]>([])

  // join form
  const [codeInput, setCodeInput] = useState('')

  useEffect(() => {
    setUsername(getSavedUsername() ?? '')
  }, [])

  const loadPacks = useCallback(() => {
    setPacks(null)
    setPacksError(null)
    fetch('/api/packs/public')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<{ packs?: PackOption[] }>
      })
      .then((d) => setPacks(d.packs ?? []))
      .catch(() => {
        setPacks(null)
        setPacksError('Could not load template packs.')
      })
  }, [])

  useEffect(() => {
    loadPacks()
  }, [loadPacks])

  /** Drop the in-flight join listener and timeout, if any. */
  const clearPendingJoin = useCallback(() => {
    const p = pendingJoinRef.current
    if (p) {
      clearTimeout(p.timer)
      socketRef.current?.off(Events.LobbyJoined, p.handler)
      pendingJoinRef.current = null
    }
    setPending(null)
  }, [])

  /** Wait for the next `lobby:joined`; the socket error handler cancels this. */
  const awaitJoin = useCallback(
    (onJoined: (code: string) => void) => {
      const socket = socketRef.current
      if (!socket) return
      clearPendingJoin()
      const handler = ({ code: c }: { code: string }) => {
        clearPendingJoin()
        onJoined(c)
      }
      const timer = setTimeout(() => {
        clearPendingJoin()
        setError('No response from the server — please try again.')
      }, 10_000)
      pendingJoinRef.current = { handler, timer }
      socket.on(Events.LobbyJoined, handler)
    },
    [clearPendingJoin],
  )

  useEffect(() => {
    const socket = connectSocket((message) => {
      setError(message)
      // A join that fails must release the button, not stay pending forever.
      clearPendingJoin()
    })
    socketRef.current = socket
    const onList = ({ lobbies: list }: { lobbies: PublicLobbyInfo[] }) => setLobbies(list ?? [])
    socket.on(Events.PublicLobbies, onList)
    socket.emit(Events.PublicList)
    return () => {
      clearPendingJoin()
      socket.off(Events.PublicLobbies, onList)
      socket.disconnect()
    }
  }, [clearPendingJoin])

  const identity = useCallback(() => {
    const name = username.trim()
    if (!name) {
      setError('Enter a username first.')
      return null
    }
    saveUsername(name)
    let pid = getSavedPlayerId()
    if (!pid) {
      pid = randomId()
      savePlayerId(pid)
    }
    return { username: name, playerId: pid }
  }, [username])

  const joinLobby = useCallback(
    (code: string | null, isPublic = true) => {
      if (pendingJoinRef.current) return // tap already in flight
      const id = identity()
      if (!id) return
      const socket = socketRef.current
      if (!socket) {
        setError('Not connected yet — please try again in a moment.')
        return
      }
      awaitJoin((c) => router.push(`/lobby/${c}`))
      // awaitJoin clears any previous pending state, so mark this one afterwards.
      setPending(code ? 'code' : 'quick')
      socket.emit(Events.Join, { code: code ?? undefined, ...id, isPublic })
      if (code) sounds.join()
    },
    [awaitJoin, identity, router],
  )

  const quickPlay = useCallback(() => joinLobby(null), [joinLobby])
  const joinByCode = useCallback(() => {
    const code = codeInput.trim().toUpperCase()
    if (!code) return
    joinLobby(code, false)
  }, [codeInput, joinLobby])

  const createLobby = useCallback(() => {
    if (pendingJoinRef.current) return
    const id = identity()
    if (!id) return
    const socket = socketRef.current
    if (!socket) {
      setError('Not connected yet — please try again in a moment.')
      return
    }
    awaitJoin((c) => router.push(`/lobby/${c}`))
    // awaitJoin clears any previous pending state, so mark this one afterwards.
    setPending('create')
    socket.emit(Events.Join, {
      create: true,
      ...id,
      isPublic,
      lobbyName: name.trim() || 'Meme Lobby',
      settings: { rounds, rerolls, captionTime, voteTime, packIds },
    })
    sounds.join()
  }, [awaitJoin, identity, isPublic, name, packIds, captionTime, rerolls, rounds, voteTime, router])

  const togglePack = (id: string) => {
    setPackIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const busy = pending !== null
  const allPacksSelected = (packs?.length ?? 0) > 0 && packIds.length === packs?.length

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:pt-12">
      {/* ------------------------------------------------------------ hero */}
      <header className="mb-8 text-center">
        <span className="mb-3 inline-block rounded-full border border-line bg-night2 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-dim">
          self-hosted · no filters
        </span>
        <h1 className="font-display text-5xl uppercase leading-none tracking-wide sm:text-7xl">
          <span className="bg-gradient-to-r from-sun via-punch to-rose bg-clip-text text-transparent">Meme</span>{' '}
          <span className="text-ink">Battle</span>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-dim sm:text-base">
          Caption the templates. Place your texts anywhere. Roast your friends&apos; memes. Most points wins.
        </p>
      </header>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose/50 bg-rose/10 px-4 py-2.5 text-sm text-rose">
          <span>{error}</span>
          <button className="font-bold" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ------------------------------------------------------------ username + quick play */}
      <section className="rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl">🎭</span>
            <input
              type="text"
              placeholder="Your username"
              value={username}
              maxLength={16}
              className="w-full rounded-xl border border-line bg-night py-3 pl-10 pr-3 text-base font-semibold"
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && quickPlay()}
            />
          </div>
          <button
            className="rounded-xl bg-gradient-to-r from-punch to-punch2 px-8 py-3 text-lg font-extrabold uppercase tracking-wide text-night shadow-lg transition hover:brightness-110 active:translate-y-px disabled:cursor-default disabled:opacity-50 disabled:hover:brightness-100"
            onClick={quickPlay}
            disabled={busy}
          >
            {pending === 'quick' ? 'Joining…' : '⚡ Quick Play'}
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-1 gap-2">
            <input
              type="text"
              placeholder="CODE"
              value={codeInput}
              maxLength={6}
              className="w-32 flex-none rounded-xl border border-line bg-night px-3 py-2.5 text-center font-mono text-lg font-bold uppercase tracking-[0.25em]"
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && !busy && joinByCode()}
            />
            <button
              className="flex-1 rounded-xl border border-line bg-night2 py-2.5 font-bold transition hover:border-dim disabled:opacity-40"
              onClick={joinByCode}
              disabled={busy || !codeInput.trim()}
            >
              {pending === 'code' ? 'Joining…' : 'Join by code'}
            </button>
          </div>
          <button
            className={`rounded-xl border py-2.5 font-bold transition disabled:opacity-40 ${creating ? 'border-rose/60 text-rose' : 'border-sky/60 text-sky hover:bg-sky/10'}`}
            onClick={() => setCreating((c) => !c)}
            disabled={busy}
          >
            {creating ? 'Cancel' : '⚙ Create lobby'}
          </button>
        </div>

        {creating && (
          <div className="mt-4 space-y-4 rounded-xl border border-line bg-night2/60 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                placeholder="Lobby name"
                value={name}
                maxLength={24}
                className="min-w-40 flex-1 rounded-lg border border-line bg-night px-3 py-2 font-semibold"
                onChange={(e) => setName(e.target.value)}
              />
              <label className="flex cursor-pointer items-center gap-2 text-sm text-dim">
                <input type="checkbox" className="accent-punch" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                Public (shown in the list)
              </label>
            </div>

            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block">
                <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wider text-dim">
                  Rounds <b className="text-sun">{rounds}</b>
                </span>
                <input type="range" min={1} max={10} className="w-full accent-punch" value={rounds} onChange={(e) => setRounds(+e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wider text-dim">
                  Rerolls <b className="text-sun">{rerolls}</b>
                </span>
                <input type="range" min={0} max={20} step={1} aria-valuetext={`${rerolls} rerolls per player and round`} className="w-full accent-punch" value={rerolls} onChange={(e) => setRerolls(+e.target.value)} />
                <span className="mt-0.5 flex justify-between text-[10px] tabular-nums text-dim"><span>0</span><span>20</span></span>
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wider text-dim">
                  Caption <b className="text-sun">{formatDuration(captionTime)}</b>
                </span>
                <input type="range" min={15} max={120} step={1} aria-valuetext={`${captionTime} seconds`} className="w-full accent-punch" value={captionTime} onChange={(e) => setCaptionTime(+e.target.value)} />
                <span className="mt-0.5 flex justify-between text-[10px] tabular-nums text-dim"><span>15s</span><span>2m</span></span>
              </label>
              <label className="block">
                <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wider text-dim">
                  Vote / meme <b className="text-sun">{formatDuration(voteTime)}</b>
                </span>
                <input type="range" min={5} max={30} step={1} aria-valuetext={`${voteTime} seconds`} className="w-full accent-punch" value={voteTime} onChange={(e) => setVoteTime(+e.target.value)} />
                <span className="mt-0.5 flex justify-between text-[10px] tabular-nums text-dim"><span>5s</span><span>30s</span></span>
              </label>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-dim">
                  Template packs <span className="text-sun">{packIds.length} selected</span>
                </span>
                <button
                  className="text-xs text-dim underline hover:text-ink disabled:opacity-40"
                  onClick={() => setPackIds(allPacksSelected ? [] : (packs ?? []).map((p) => p.id))}
                  disabled={!packs || packs.length === 0}
                >
                  {allPacksSelected ? 'clear all' : 'select all'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {packs === null && !packsError && (
                  <p className="animate-pulse text-sm text-dim">Loading template packs…</p>
                )}
                {packsError && (
                  <p className="flex items-center gap-2 text-sm text-rose">
                    {packsError}
                    <button className="underline hover:text-ink" onClick={loadPacks}>Retry</button>
                  </p>
                )}
                {packs !== null && packs.length === 0 && (
                  <p className="text-sm text-dim">No template packs yet — an admin needs to create some.</p>
                )}
                {(packs ?? []).map((p) => {
                  const on = packIds.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      title={p.description ?? undefined}
                      className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                        on ? 'border-punch bg-punch/20 text-punch' : 'border-line bg-night text-dim hover:border-dim hover:text-ink'
                      }`}
                      onClick={() => togglePack(p.id)}
                    >
                      {on ? '✓ ' : ''}{p.name} <span className="text-xs opacity-60">{p.templateCount}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <button
              className="w-full rounded-xl bg-gradient-to-r from-punch to-punch2 py-3 text-lg font-extrabold uppercase tracking-wide text-night shadow-lg transition hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100"
              onClick={createLobby}
              disabled={packIds.length === 0 || busy}
            >
              {pending === 'create' ? 'Creating lobby…' : 'Create & join 🚀'}
            </button>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------ public lobbies */}
      <section className="mt-4 rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl uppercase tracking-wide">Public lobbys</h2>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-dim">
            {lobbies.length} online
          </span>
        </div>
        {lobbies.length === 0 && (
          <p className="text-sm text-dim">No public lobbys right now — create one or bring friends by code.</p>
        )}
        <div className="grid gap-2">
          {lobbies.map((l) => (
            <div key={l.code} className="flex items-center gap-3 rounded-xl border border-line bg-night2 px-3 py-2.5">
              <span className="text-xl">{l.inGame ? '🎮' : '💬'}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{l.name}</span>
                <span className="font-mono text-xs tracking-[0.2em] text-dim">{l.code}</span>
              </span>
              {l.inGame ? (
                <span className="rounded-full border border-sun/50 bg-sun/10 px-2.5 py-0.5 text-xs font-semibold text-sun">in game</span>
              ) : (
                <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-dim">
                  {l.players}/{l.maxPlayers}
                </span>
              )}
              <button
                className="rounded-lg border border-mint/60 px-4 py-1.5 text-sm font-bold text-mint transition hover:bg-mint/10 disabled:opacity-40"
                disabled={l.inGame || busy}
                onClick={() => joinLobby(l.code)}
              >
                Join
              </button>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-6 text-center text-xs text-dim">
        self-hosted · open source (MIT) · no accounts ·{' '}
        <a href="/admin/login" className="underline">admin</a>
      </p>
    </main>
  )
}
