'use client'

import { useState } from 'react'
import type { MemeInfo } from '@/lib/client'
import type { VoteTally, VoteValue } from '@/lib/types'
import MemeView from '@/components/MemeView'

interface Props {
  round: number
  memes: MemeInfo[]
  current: number
  counts: Record<number, VoteTally>
  myId: string | null
  onVote: (index: number, value: VoteValue) => void
}

export default function VotingView({ round, memes, current, counts, myId, onVote }: Props) {
  const [myVotes, setMyVotes] = useState<Record<number, VoteValue>>({})

  const meme = memes[current]
  if (!meme) {
    return (
      <div className="panel">
        <h2>Voting — Round {round}</h2>
        <p className="muted">Loading memes…</p>
      </div>
    )
  }

  const isOwn = meme.playerId === myId
  const tally: VoteTally = counts[current] ?? { up: 0, down: 0, meh: 0 }
  const myVote = myVotes[current]

  const vote = (value: VoteValue) => {
    onVote(current, value)
    setMyVotes((prev) => ({ ...prev, [current]: value }))
  }

  return (
    <div className="panel">
      <h2 className="row spread">
        <span>Voting — Round {round}</span>
        <span className="badge">meme {current + 1} of {memes.length}</span>
      </h2>

      <div className="row" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px', minWidth: 300 }}>
          <div className="meme-canvas-wrap">
            <MemeView template={meme.template} submission={meme.submission} maxDim={440} />
          </div>
          <p style={{ textAlign: 'center', marginTop: 8 }}>
            <span
              className="avatar"
              style={{ background: meme.color, display: 'inline-flex', marginRight: 6 }}
            >
              {meme.username[0]?.toUpperCase()}
            </span>
            <strong>{meme.username}</strong>
            {isOwn && <span className="badge" style={{ marginLeft: 8 }}>your meme</span>}
          </p>
        </div>

        <div style={{ flex: '0 1 300px', minWidth: 260 }}>
          {!isOwn ? (
            <div className="vote-btns">
              <button
                className={myVote === 'up' ? 'active-up' : ''}
                onClick={() => vote('up')}
              >
                👍 Fun
              </button>
              <button
                className={myVote === 'meh' ? 'active-meh' : ''}
                onClick={() => vote('meh')}
              >
                🤷 Meh
              </button>
              <button
                className={myVote === 'down' ? 'active-down' : ''}
                onClick={() => vote('down')}
              >
                👎 Cringe
              </button>
            </div>
          ) : (
            <p className="muted">You can't vote on your own meme.</p>
          )}

          <div className="vote-counts">
            <span className="score-pos">👍 {tally.up}</span>
            <span>🤷 {tally.meh}</span>
            <span className="score-neg">👎 {tally.down}</span>
          </div>
        </div>
      </div>

      <h3 style={{ marginTop: 18 }}>This round</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {memes.map((m, i) => (
          <span key={m.playerId} className={`badge${i === current ? ' live' : ''}`}>
            {i + 1}. {m.username}
          </span>
        ))}
      </div>
    </div>
  )
}
