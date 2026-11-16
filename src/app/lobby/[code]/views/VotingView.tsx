'use client'

import { useState } from 'react'
import type { MemeInfo } from '@/lib/client'
import type { VoteValue } from '@/lib/types'
import MemeView from '@/components/MemeView'

interface Props {
  round: number
  memes: MemeInfo[]
  current: number
  myId: string | null
  onVote: (index: number, value: VoteValue) => void
}

const VOTE_BTNS: Array<{ value: VoteValue; label: string; emoji: string; active: string }> = [
  { value: 'up', label: 'Fun', emoji: '👍', active: 'border-mint bg-mint/20 text-mint ring-2 ring-mint/60' },
  { value: 'meh', label: 'Meh', emoji: '🤷', active: 'border-sky bg-sky/20 text-sky ring-2 ring-sky/60' },
  { value: 'down', label: 'Cringe', emoji: '👎', active: 'border-rose bg-rose/20 text-rose ring-2 ring-rose/60' },
]

export default function VotingView({ round, memes, current, myId, onVote }: Props) {
  const [myVotes, setMyVotes] = useState<Record<number, VoteValue>>({})

  const meme = memes[current]
  if (!meme) {
    return (
      <section className="rounded-2xl border border-line bg-card p-8 text-center shadow-xl">
        <h2 className="font-display text-2xl uppercase tracking-wide">Voting — Round {round}</h2>
        <p className="mt-2 animate-pulse text-dim">Loading memes…</p>
      </section>
    )
  }

  const isOwn = meme.playerId === myId
  const myVote = myVotes[current]

  const vote = (value: VoteValue) => {
    onVote(current, value)
    setMyVotes((prev) => ({ ...prev, [current]: value }))
  }

  return (
    <section className="mx-auto max-w-3xl">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl uppercase tracking-wide">
          Vote — <span className="text-sun">Round {round}</span>
        </h2>
        {/* progress dots */}
        <div className="flex items-center gap-1.5">
          {memes.map((m, i) => (
            <span
              key={m.playerId}
              title={`${i + 1}. ${m.username}`}
              className={`h-2.5 rounded-full transition-all ${
                i === current ? 'w-7 bg-punch' : i < current ? 'w-2.5 bg-mint/70' : 'w-2.5 bg-line'
              }`}
            />
          ))}
        </div>
      </header>

      <div className="rounded-2xl border border-line bg-card p-3 shadow-xl sm:p-4">
        <div className="meme-canvas-wrap border-none bg-transparent">
          <MemeView template={meme.template} submission={meme.submission} maxDim={720} className="max-h-[80vh] w-auto max-w-full" />
        </div>

        <div className="mt-3 flex items-center justify-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold text-night"
            style={{ background: meme.color }}
          >
            {meme.username[0]?.toUpperCase()}
          </span>
          <strong>{meme.username}</strong>
          {isOwn && (
            <span className="rounded-full border border-sun/60 bg-sun/10 px-2 py-0.5 text-xs font-semibold text-sun">
              your meme
            </span>
          )}
        </div>

        {isOwn ? (
          <p className="mt-4 text-center text-sm text-dim">
            😎 That&apos;s your masterpiece — you can&apos;t vote on it.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
            {VOTE_BTNS.map(({ value, label, emoji, active }) => (
              <button
                key={value}
                className={`flex flex-col items-center gap-1 rounded-2xl border border-line bg-night2 py-3 transition hover:border-dim hover:bg-card2 active:translate-y-px ${
                  myVote === value ? active : ''
                }`}
                onClick={() => vote(value)}
              >
                <span className="text-3xl leading-none">{emoji}</span>
                <span className="text-sm font-bold">{label}</span>
              </button>
            ))}
          </div>
        )}

        <p className="mt-4 border-t border-line pt-3 text-center text-sm text-dim">
          🤫 Votes stay secret until the results
        </p>
      </div>
    </section>
  )
}
