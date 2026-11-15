'use client'

import type { RoundResult } from '@/lib/types'

export interface RankingEntry {
  playerId: string
  username: string
  avatar: string
  color: string
  total: number
  rounds: number[]
}

interface RoundProps {
  mode: 'round'
  result: RoundResult
}
interface OverProps {
  mode: 'over'
  result: RankingEntry[]
  totalRounds: number
  myId: string | null
  isHost: boolean
  onPlayAgain: () => void
}
type Props = RoundProps | OverProps

const MEDALS = ['🏆', '🥈', '🥉']

export default function ResultsView(props: Props) {
  if (props.mode === 'round') {
    const memes = [...props.result.memes].sort((a, b) => b.score - a.score)
    const totals = Object.entries(props.result.totals).sort((a, b) => b[1] - a[1])
    return (
      <div className="panel">
        <h2>Round {props.result.round} Results</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Score</th>
              <th>Votes</th>
            </tr>
          </thead>
          <tbody>
            {memes.map((m, i) => (
              <tr key={m.playerId}>
                <td className="rank">{i + 1}</td>
                <td>{m.username}</td>
                <td className={`score ${m.score >= 0 ? 'score-pos' : 'score-neg'}`}>{m.score}</td>
                <td className="muted">
                  👍 {m.up} · 🤷 {m.meh} · 👎 {m.down}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {totals.length > 0 && (
          <>
            <h3 style={{ marginTop: 16 }}>Running total</h3>
            <div>
              {totals.slice(0, 8).map(([playerId, total], i) => (
                <div key={playerId} className="result-row">
                  <span className="rank">{i + 1}</span>
                  <span className="uname">
                    {props.result.memes.find((m) => m.playerId === playerId)?.username ?? 'Player'}
                  </span>
                  <span className={`score ${total >= 0 ? 'score-pos' : 'score-neg'}`}>{total}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="muted" style={{ marginTop: 14 }}>
          Next round starts shortly…
        </p>
      </div>
    )
  }

  const ranking = [...props.result].sort((a, b) => b.total - a.total)
  const podium = ranking.slice(0, 3)

  return (
    <div className="panel">
      <h2>🎉 Game Over — after {props.totalRounds} rounds</h2>

      <div className="row" style={{ gap: 16, justifyContent: 'center', marginBottom: 16 }}>
        {podium.map((p, i) => (
          <div key={p.playerId} className="panel" style={{ textAlign: 'center', minWidth: 120 }}>
            <div style={{ fontSize: 32 }}>{MEDALS[i]}</div>
            <span
              className="avatar"
              style={{ background: p.color, display: 'inline-flex', margin: '6px 0' }}
            >
              {p.username[0]?.toUpperCase()}
            </span>
            <div>
              <strong>{p.username}</strong>
              {p.playerId === props.myId && <span className="muted"> (you)</span>}
            </div>
            <div className={`score ${p.total >= 0 ? 'score-pos' : 'score-neg'}`}>{p.total}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {ranking.map((p, i) => (
          <div key={p.playerId} className={`result-row${p.playerId === props.myId ? ' live' : ''}`}>
            <span className="rank">{i + 1}</span>
            <span
              className="avatar"
              style={{ background: p.color, display: 'inline-flex' }}
            >
              {p.username[0]?.toUpperCase()}
            </span>
            <span className="uname">
              {p.username}
              {p.playerId === props.myId ? ' (you)' : ''}
            </span>
            <span className={`score ${p.total >= 0 ? 'score-pos' : 'score-neg'}`}>{p.total}</span>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        {props.isHost ? (
          <button className="primary" onClick={props.onPlayAgain}>
            Play again
          </button>
        ) : (
          <span className="muted">The host can start a new game.</span>
        )}
      </div>
    </div>
  )
}
