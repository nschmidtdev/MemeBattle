'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { connectSocket, getSavedUsername, saveUsername, getSavedPlayerId, savePlayerId, type PublicLobbyInfo } from '@/lib/client'
import { Events } from '@/lib/types'
import { sounds } from '@/lib/sounds'

interface PackOption {
  id: string
  name: string
  description: string | null
  templateCount: number
}

export default function StartPage() {
  const router = useRouter()
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null)

  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lobbies, setLobbies] = useState<PublicLobbyInfo[]>([])
  const [packs, setPacks] = useState<PackOption[]>([])

  // create form
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [rounds, setRounds] = useState(3)
  const [captionTime, setCaptionTime] = useState(45)
  const [voteTime, setVoteTime] = useState(10)
  const [packIds, setPackIds] = useState<string[]>([])

  // join form
  const [codeInput, setCodeInput] = useState('')

  useEffect(() => {
    setUsername(getSavedUsername() ?? '')
  }, [])

  useEffect(() => {
    fetch('/api/packs/public')
      .then((r) => (r.ok ? r.json() : { packs: [] }))
      .then((d) => setPacks(d.packs ?? []))
      .catch(() => {})
    return () => {}
  }, [])

  useEffect(() => {
    const socket = connectSocket((message) => setError(message))
    socketRef.current = socket
    const onList = ({ lobbies: list }: { lobbies: PublicLobbyInfo[] }) => setLobbies(list ?? [])
    socket.on(Events.PublicLobbies, onList)
    socket.emit(Events.PublicList)
    return () => {
      socket.off(Events.PublicLobbies, onList)
      socket.disconnect()
    }
  }, [])

  const identity = useCallback(() => {
    const name = username.trim()
    if (!name) {
      setError('Enter a username first.')
      return null
    }
    saveUsername(name)
    let pid = getSavedPlayerId()
    if (!pid) {
      pid = crypto.randomUUID()
      savePlayerId(pid)
    }
    return { username: name, playerId: pid }
  }, [username])

  const joinLobby = useCallback(
    (code: string | null, isPublic = true) => {
      const id = identity()
      if (!id) return
      const socket = socketRef.current
      if (!socket) return
      const onJoined = ({ code: c }: { code: string }) => {
        router.push(`/lobby/${c}`)
      }
      socket.once(Events.LobbyJoined, onJoined)
      socket.emit(Events.Join, { code: code ?? undefined, ...id, isPublic })
      if (code) sounds.join()
    },
    [identity, router],
  )

  const quickPlay = useCallback(() => joinLobby(null), [joinLobby])
  const joinByCode = useCallback(() => {
    const code = codeInput.trim().toUpperCase()
    if (!code) return
    joinLobby(code, false)
  }, [codeInput, joinLobby])

  const createLobby = useCallback(() => {
    const id = identity()
    if (!id) return
    const socket = socketRef.current
    if (!socket) return
    const onJoined = ({ code: c }: { code: string }) => router.push(`/lobby/${c}`)
    socket.once(Events.LobbyJoined, onJoined)
    socket.emit(Events.Join, {
      create: true,
      ...id,
      isPublic,
      lobbyName: name.trim() || 'Meme Lobby',
      settings: { rounds, captionTime, voteTime, packIds },
    })
    sounds.join()
  }, [identity, isPublic, name, packIds, captionTime, rounds, router])

  const togglePack = (id: string) => {
    setPackIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const allPacksSelected = packs.length > 0 && packIds.length === packs.length
  const selectAll = () => setPackIds(allPacksSelected ? [] : packs.map((p) => p.id))

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 34, margin: '18px 0 4px' }}>
        🖼️ Meme <span style={{ color: 'var(--accent)' }}>Battle</span>
      </h1>
      <p className="muted">Caption templates. Vote on your friends' masterpieces. Highest score wins.</p>

      {error && (
        <div className="error-banner">
          {error}{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); setError(null) }}>
            dismiss
          </a>
        </div>
      )}

      <div className="panel">
        <div className="row" style={{ marginBottom: 14 }}>
          <input
            type="text"
            placeholder="Your username"
            value={username}
            maxLength={16}
            onChange={(e) => setUsername(e.target.value)}
            style={{ flex: 1, minWidth: 180 }}
            onKeyDown={(e) => e.key === 'Enter' && quickPlay()}
          />
          <button className="primary" onClick={quickPlay}>
            ⚡ Quick Play
          </button>
        </div>
        <div className="row">
          <input
            type="text"
            placeholder="Lobby code"
            value={codeInput}
            maxLength={6}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            style={{ flex: 1, minWidth: 140, fontFamily: 'ui-monospace, monospace', letterSpacing: '0.1em' }}
            onKeyDown={(e) => e.key === 'Enter' && joinByCode()}
          />
          <button onClick={joinByCode} disabled={!codeInput.trim()}>
            Join by code
          </button>
          <button onClick={() => setCreating((c) => !c)} className={creating ? '' : 'ghost'}>
            {creating ? 'Cancel' : '+ Create lobby'}
          </button>
        </div>

        {creating && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div className="row" style={{ marginBottom: 12 }}>
              <input
                type="text"
                placeholder="Lobby name"
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                style={{ flex: 1, minWidth: 180 }}
              />
              <label className="checkbox-row" style={{ marginBottom: 0 }}>
                <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                Public (visible in the list)
              </label>
            </div>
            <div className="row" style={{ marginBottom: 12 }}>
              <label>
                Rounds <input type="number" min={1} max={10} value={rounds} onChange={(e) => setRounds(+e.target.value)} style={{ width: 70 }} />
              </label>
              <label>
                Caption (s) <input type="number" min={5} max={120} value={captionTime} onChange={(e) => setCaptionTime(+e.target.value)} style={{ width: 70 }} />
              </label>
              <label>
                Vote (s) <input type="number" min={3} max={60} value={voteTime} onChange={(e) => setVoteTime(+e.target.value)} style={{ width: 70 }} />
              </label>
            </div>
            <div className="row" style={{ marginBottom: 8 }}>
              <button className="ghost" onClick={selectAll} style={{ padding: '4px 10px', fontSize: 12 }}>
                {allPacksSelected ? 'Clear all' : 'Select all'}
              </button>
              <span className="muted">Template packs ({packIds.length} selected)</span>
            </div>
            {packs.length === 0 && <p className="muted">No template packs available yet — an admin needs to create some.</p>}
            {packs.map((p) => (
              <label key={p.id} className="checkbox-row">
                <input type="checkbox" checked={packIds.includes(p.id)} onChange={() => togglePack(p.id)} />
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span className="muted">
                  ({p.templateCount} templates){p.description ? ` — ${p.description}` : ''}
                </span>
              </label>
            ))}
            <button className="primary" style={{ marginTop: 10 }} onClick={createLobby} disabled={packIds.length === 0}>
              Create &amp; join
            </button>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="spread" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Public lobbys</h2>
          <span className="muted">{lobbies.length} online</span>
        </div>
        {lobbies.length === 0 && <p className="muted">No public lobbys right now. Create one, or invite friends by code.</p>}
        {lobbies.map((l) => (
          <div key={l.code} className="lobby-row">
            <span className="lname">{l.name}</span>
            <span className="code">{l.code}</span>
            <span className="badge">{l.players}/{l.maxPlayers}</span>
            {l.inGame && <span className="badge live">in game</span>}
            <button style={{ marginLeft: 'auto' }} disabled={l.inGame} onClick={() => joinLobby(l.code)}>
              Join
            </button>
          </div>
        ))}
      </div>

      <p className="muted" style={{ textAlign: 'center' }}>
        Self-hosted · no accounts · no filters · <a href="/admin/login">admin</a>
      </p>
    </div>
  )
}
