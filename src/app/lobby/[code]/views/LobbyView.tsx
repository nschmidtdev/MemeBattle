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
}

export default function LobbyView({ state, myId, onSettings, onStart }: Props) {
  const isHost = state.players.find((p) => p.id === myId)?.isHost ?? false
  const [lobbyName, setLobbyName] = useState(state.settings.lobbyName)
  const [rounds, setRounds] = useState(state.settings.rounds)
  const [captionTime, setCaptionTime] = useState(state.settings.captionTime)
  const [voteTime, setVoteTime] = useState(state.settings.voteTime)
  const [packs, setPacks] = useState<PackOption[] | null>(null)

  useEffect(() => {
    fetch('/api/packs/public')
      .then((r) => (r.ok ? r.json() : { packs: [] }))
      .then((d: { packs?: PackOption[] }) => setPacks(d.packs ?? []))
      .catch(() => setPacks([]))
  }, [])

  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
  }

  const canStart = state.players.length >= 2 && state.settings.packIds.length > 0

  return (
    <div className="panel">
      <h2>{state.name}</h2>
      <p className="muted">
        {state.players.length}/{state.maxPlayers} players — waiting for the host to start.
      </p>

      <div className="row spread">
        <div>
          <label className="muted">Rounds</label>
          {isHost ? (
            <input
              type="number"
              min={1}
              max={10}
              value={rounds}
              onChange={(e) => {
                const n = num(e.target.value, 1, 10, 3)
                setRounds(n)
                onSettings({ rounds: n })
              }}
              style={{ width: 70 }}
            />
          ) : (
            <strong>{state.settings.rounds}</strong>
          )}
        </div>
        <div>
          <label className="muted">Caption time (s)</label>
          {isHost ? (
            <input
              type="number"
              min={5}
              max={120}
              value={captionTime}
              onChange={(e) => {
                const n = num(e.target.value, 5, 120, 30)
                setCaptionTime(n)
                onSettings({ captionTime: n })
              }}
              style={{ width: 70 }}
            />
          ) : (
            <strong>{state.settings.captionTime}</strong>
          )}
        </div>
        <div>
          <label className="muted">Vote time per meme (s)</label>
          {isHost ? (
            <input
              type="number"
              min={3}
              max={60}
              value={voteTime}
              onChange={(e) => {
                const n = num(e.target.value, 3, 60, 8)
                setVoteTime(n)
                onSettings({ voteTime: n })
              }}
              style={{ width: 70 }}
            />
          ) : (
            <strong>{state.settings.voteTime}</strong>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        {isHost ? (
          <>
            <label className="muted">Lobby name</label>
            <input
              value={lobbyName}
              maxLength={40}
              onChange={(e) => {
                setLobbyName(e.target.value)
                onSettings({ lobbyName: e.target.value })
              }}
              style={{ width: '100%', maxWidth: 320 }}
            />
          </>
        ) : (
          <p className="muted">Host: {state.players.find((p) => p.isHost)?.username ?? '—'}</p>
        )}
      </div>

      <h3 style={{ marginTop: 18 }}>Meme packs</h3>
      {packs === null ? (
        <p className="muted">Loading packs…</p>
      ) : packs.length === 0 ? (
        <p className="muted">No public packs yet — the admin can add some.</p>
      ) : (
        <div>
          {packs.map((p) => (
            <label key={p.id} className="checkbox-row">
              <input
                type="checkbox"
                checked={state.settings.packIds.includes(p.id)}
                disabled={!isHost}
                onChange={() => {
                  const packIds = state.settings.packIds.includes(p.id)
                    ? state.settings.packIds.filter((x) => x !== p.id)
                    : [...state.settings.packIds, p.id]
                  onSettings({ packIds })
                }}
              />
              <span>
                <strong>{p.name}</strong>{' '}
                <span className="muted">
                  ({p.templateCount} templates)
                  {p.description ? ` — ${p.description}` : ''}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 18 }}>
        {isHost ? (
          <button className="primary" disabled={!canStart} onClick={onStart}>
            Start game
          </button>
        ) : (
          <span className="muted">Only the host can start the game.</span>
        )}
      </div>
    </div>
  )
}
