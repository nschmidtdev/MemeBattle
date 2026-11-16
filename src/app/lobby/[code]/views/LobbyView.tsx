'use client'

import { useEffect, useState } from 'react'
import type { LobbyState } from '@/lib/client'

interface PackOption {
  id: string
  name: string
  description: string | null
  isPublic: boolean
  templateCount: number
}

interface Props {
  state: LobbyState
  myId: string | null
  onSettings: (patch: Partial<LobbyState['settings']>) => void
  onStart: () => void
  onKick: (playerId: string) => void
}

export default function LobbyView({ state, myId, onSettings, onStart, onKick }: Props) {
  const isHost = state.players.find((p) => p.id === myId)?.isHost ?? false
  const [lobbyName, setLobbyName] = useState(state.settings.lobbyName)
  const [rounds, setRounds] = useState(state.settings.rounds)
  const [captionTime, setCaptionTime] = useState(state.settings.captionTime)
  const [voteTime, setVoteTime] = useState(state.settings.voteTime)
  const [packs, setPacks] = useState<PackOption[] | null>(null)

  // keep local inputs in sync when the server state changes (e.g. play again)
  useEffect(() => {
    setLobbyName(state.settings.lobbyName)
    setRounds(state.settings.rounds)
    setCaptionTime(state.settings.captionTime)
    setVoteTime(state.settings.voteTime)
  }, [state.settings])

  useEffect(() => {
    fetch('/api/packs/public')
      .then((r) => (r.ok ? r.json() : { packs: [] }))
      .then((d: { packs?: PackOption[] }) => setPacks(d.packs ?? []))
      .catch(() => setPacks([]))
  }, [])

  const togglePack = (id: string) => {
    if (!isHost) return
    const next = state.settings.packIds.includes(id)
      ? state.settings.packIds.filter((x) => x !== id)
      : [...state.settings.packIds, id]
    onSettings({ packIds: next })
  }

  const canStart = isHost && state.players.length >= 2 && state.settings.packIds.length > 0
  const startHint =
    state.players.length < 2
      ? `Waiting for players (${state.players.length}/2 minimum)…`
      : state.settings.packIds.length === 0
        ? 'Pick at least one template pack…'
        : null

  const sliderCls = 'w-full accent-punch'

  return (
    <section className="grid gap-4">
      {/* ---------------------------------------------------------- players */}
      <div className="rounded-2xl border border-line bg-card p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xl uppercase tracking-wide">
            Players <span className="text-dim">{state.players.length}/{state.maxPlayers}</span>
          </h2>
          <span className="text-xs text-dim">share the code to invite</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {state.players.map((p) => (
            <div
              key={p.id}
              className={`relative flex items-center gap-2 rounded-xl border px-3 py-2 ${
                p.connected ? 'border-line bg-night2' : 'border-line/50 bg-night2/40 opacity-50'
              } ${p.id === myId ? 'ring-1 ring-punch/60' : ''}`}
            >
              <span
                className="flex h-9 w-9 flex-none items-center justify-center rounded-full font-extrabold text-night"
                style={{ background: p.color }}
              >
                {p.username[0]?.toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold" style={{ textDecoration: p.connected ? undefined : 'line-through' }}>
                  {p.username}
                </span>
                {p.id === myId && <span className="block text-[10px] uppercase tracking-wider text-punch">you</span>}
              </span>
              {p.isHost && <span title="Host" className="text-lg">👑</span>}
              {isHost && p.id !== myId && (
                <button
                  className="rounded-md px-1.5 text-xs text-dim hover:text-rose"
                  title="Kick player"
                  onClick={() => window.confirm(`Kick ${p.username}?`) && onKick(p.id)}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ---------------------------------------------------------- settings */}
      <div className="rounded-2xl border border-line bg-card p-4 shadow-xl">
        <h2 className="mb-4 font-display text-xl uppercase tracking-wide">
          Settings {!isHost && <span className="ml-1 align-middle text-xs font-normal normal-case text-dim">— host only</span>}
        </h2>

        <div className={`grid gap-x-6 gap-y-4 sm:grid-cols-2 ${isHost ? '' : 'pointer-events-none opacity-60'}`}>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-dim">Lobby name</span>
            <input
              className="w-full rounded-lg border border-line bg-night px-3 py-2 font-semibold"
              value={lobbyName}
              maxLength={24}
              disabled={!isHost}
              onChange={(e) => setLobbyName(e.target.value)}
              onBlur={() => lobbyName.trim() && onSettings({ lobbyName: lobbyName.trim() })}
            />
          </label>

          <label className="block">
            <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wider text-dim">
              Rounds <span className="font-bold text-sun">{rounds}</span>
            </span>
            <input type="range" min={1} max={10} step={1} className={sliderCls} value={rounds} disabled={!isHost}
              onChange={(e) => { setRounds(+e.target.value); onSettings({ rounds: +e.target.value }) }} />
          </label>

          <label className="block">
            <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wider text-dim">
              Caption time <span className="font-bold text-sun">{captionTime}s</span>
            </span>
            <input type="range" min={15} max={120} step={5} className={sliderCls} value={captionTime} disabled={!isHost}
              onChange={(e) => { setCaptionTime(+e.target.value); onSettings({ captionTime: +e.target.value }) }} />
          </label>

          <label className="block">
            <span className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wider text-dim">
              Vote time / meme <span className="font-bold text-sun">{voteTime}s</span>
            </span>
            <input type="range" min={5} max={30} step={1} className={sliderCls} value={voteTime} disabled={!isHost}
              onChange={(e) => { setVoteTime(+e.target.value); onSettings({ voteTime: +e.target.value }) }} />
          </label>

          <div className="sm:col-span-2">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-dim">
              Template packs <span className="text-sun">{state.settings.packIds.length} selected</span>
            </span>
            <div className="flex flex-wrap gap-2">
              {(packs ?? []).map((p) => {
                const on = state.settings.packIds.includes(p.id)
                return (
                  <button
                    key={p.id}
                    disabled={!isHost}
                    title={p.description ?? undefined}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                      on
                        ? 'border-punch bg-punch/20 text-punch'
                        : 'border-line bg-night2 text-dim hover:border-dim hover:text-ink'
                    } disabled:cursor-default`}
                    onClick={() => togglePack(p.id)}
                  >
                    {on ? '✓ ' : ''}{p.name}
                    <span className="ml-1 text-xs opacity-60">{p.templateCount}</span>
                  </button>
                )
              })}
              {packs !== null && packs.length === 0 && (
                <p className="text-sm text-dim">No template packs yet — an admin needs to create some.</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          {isHost ? (
            <button
              className="w-full rounded-xl bg-gradient-to-r from-punch to-punch2 py-3 text-lg font-extrabold uppercase tracking-wide text-night shadow-lg transition hover:brightness-110 active:translate-y-px disabled:cursor-default disabled:opacity-40 disabled:hover:brightness-100"
              disabled={!canStart}
              onClick={onStart}
            >
              ▶ Start game
            </button>
          ) : (
            <p className="text-center text-sm text-dim">Waiting for the host to start…</p>
          )}
          {isHost && startHint && <p className="mt-2 text-center text-xs text-dim">{startHint}</p>}
        </div>
      </div>
    </section>
  )
}
