'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChaosRule, MemeInfo, VoteValue } from '@/lib/types'
import { RULE_INFO } from '@/lib/modes'
import MemeView from '@/components/MemeView'

interface Props {
  round: number
  memes: MemeInfo[]
  current: number
  myId: string | null
  onVote: (index: number, value: VoteValue) => void
  /** Votes restored from the server after a reconnect. */
  initialVotes?: Record<number, VoteValue>
  /** Latest vote rejection; used to roll back the optimistic highlight. */
  voteError?: { message: string; nonce: number } | null
  /** This player's own Meme Buddy pick, if already made this round. */
  buddyIndex: number | null
  onPickBuddy: (index: number) => void
  rule: ChaosRule | null
  canDownvote: boolean
  scoresEnabled: boolean
}

const VOTE_BTNS: Array<{ value: VoteValue; label: string; emoji: string; active: string }> = [
  { value: 'up', label: 'Fun', emoji: '👍', active: 'border-mint bg-mint/20 text-mint ring-2 ring-mint/60' },
  { value: 'meh', label: 'Meh', emoji: '🤷', active: 'border-sky bg-sky/20 text-sky ring-2 ring-sky/60' },
  { value: 'down', label: 'Cringe', emoji: '👎', active: 'border-rose bg-rose/20 text-rose ring-2 ring-rose/60' },
]

export default function VotingView({
  round,
  memes,
  current,
  myId,
  onVote,
  initialVotes,
  voteError,
  buddyIndex,
  onPickBuddy,
  rule,
  canDownvote,
  scoresEnabled,
}: Props) {
  const [myVotes, setMyVotes] = useState<Record<number, VoteValue>>(() => ({ ...(initialVotes ?? {}) }))
  /** Index of the meme whose canvas finished rendering — vote only on that one. */
  const [renderedIndex, setRenderedIndex] = useState<number | null>(null)
  const pendingRef = useRef<{ index: number; prev?: VoteValue } | null>(null)

  // Merge restored votes (reconnect) without dropping optimistic local ones.
  useEffect(() => {
    if (!initialVotes) return
    setMyVotes((prev) => ({ ...prev, ...initialVotes }))
  }, [initialVotes])

  // A new meme is not voteable until its image has rendered. Keep the pending
  // optimistic vote so an error that races the meme switch can still roll it back.
  useEffect(() => {
    setRenderedIndex(null)
  }, [current])

  // Server rejected the last optimistic vote: restore the previous highlight.
  useEffect(() => {
    if (!voteError) return
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    setMyVotes((prev) => {
      const next = { ...prev }
      if (pending.prev) next[pending.index] = pending.prev
      else delete next[pending.index]
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteError?.nonce])

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
  /** Submitted nothing this round: no votes and no Buddy pick. */
  const isSpectator = myId !== null && !memes.some((m) => m.playerId === myId)
  const myVote = myVotes[current]
  const ready = renderedIndex === current
  const progress = memes.length > 0 ? ((current + 1) / memes.length) * 100 : 0
  const buddyMeme = buddyIndex !== null ? (memes[buddyIndex] ?? null) : null
  const buddyIsCurrent = buddyIndex !== null && buddyIndex === current
  const voteButtons = canDownvote ? VOTE_BTNS : VOTE_BTNS.filter((b) => b.value !== 'down')

  const vote = (value: VoteValue) => {
    if (!ready || isOwn) return
    const prev = myVotes[current]
    if (prev === value) return
    // Optimistic: highlight immediately, roll back if the server rejects it.
    pendingRef.current = { index: current, prev }
    onVote(current, value)
    setMyVotes((p) => ({ ...p, [current]: value }))
  }

  return (
    <section className="mx-auto max-w-3xl">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl uppercase tracking-wide">
          Vote — <span className="text-sun">Round {round}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {rule && (
            <span className="rounded-full border border-sun/60 bg-sun/10 px-2.5 py-1 text-xs font-bold text-sun">
              {RULE_INFO[rule].emoji} {RULE_INFO[rule].label}
            </span>
          )}
          {!scoresEnabled && (
            <span className="rounded-full border border-mint/60 bg-mint/10 px-2.5 py-1 text-xs font-bold text-mint">
              🌿 Relaxed · no points
            </span>
          )}
        </div>
        {/* compact progress: n/N + thin bar (scales to any lobby size) */}
        <div className="flex items-center gap-2" title={`Meme ${current + 1} of ${memes.length}`}>
          <span className="text-sm font-bold tabular-nums text-dim">
            {current + 1}/{memes.length}
          </span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-night2 sm:w-40">
            <div className="h-full rounded-full bg-punch transition-[width] duration-200" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </header>

      <div className="overflow-clip rounded-2xl border border-line bg-card shadow-xl">
        <div className="p-2 sm:p-3">
          <div className="meme-canvas-wrap border-none bg-transparent">
            <MemeView
              key={current}
              template={meme.template}
              submission={meme.submission}
              maxDim={720}
              className="max-h-[calc(100dvh-21rem)] w-auto max-w-full sm:max-h-[calc(100dvh-17rem)]"
              onRendered={() => setRenderedIndex(current)}
            />
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
        </div>

        {/* sticky footer keeps the vote bar reachable without scrolling */}
        <div className="sticky bottom-0 z-10 border-t border-line bg-night2/95 p-3 backdrop-blur">
          {isSpectator ? (
            <p className="text-center text-sm text-dim">
              👀 You didn&apos;t submit a meme this round — spectating.
            </p>
          ) : (
            <>
              {isOwn ? (
                <p className="text-center text-sm text-dim">
                  😎 That&apos;s your masterpiece — you can&apos;t vote on it.
                </p>
              ) : (
                <div
                  className={`grid gap-2 sm:gap-3 ${canDownvote ? 'grid-cols-3' : 'grid-cols-2'}`}
                >
                  {voteButtons.map(({ value, label, emoji, active }) => (
                    <button
                      key={value}
                      className={`flex flex-col items-center gap-1 rounded-2xl border border-line bg-night2 py-3 transition hover:border-dim hover:bg-card2 active:translate-y-px disabled:cursor-default disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-night2 ${
                        myVote === value ? active : ''
                      }`}
                      disabled={!ready}
                      onClick={() => vote(value)}
                    >
                      <span className="text-3xl leading-none">{emoji}</span>
                      <span className="text-sm font-bold">{label}</span>
                    </button>
                  ))}
                </div>
              )}

              {scoresEnabled && (
                <>
                  {/* Meme Buddy: one secret pick per round, only on the shown meme. */}
                  <div className="mt-3 border-t border-line/70 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">🤝 Meme Buddy</p>
                    <p className="text-[11px] leading-snug text-dim">
                      One pick per round · you get half of its final points (positive or negative) · the meme gets
                      +10 per buddy.
                    </p>
                  </div>
                  <div className="flex-none">
                    {buddyIndex === null ? (
                      isOwn ? (
                        <span className="text-xs text-dim">Pick another player&apos;s meme.</span>
                      ) : (
                        <button
                          className="rounded-xl border border-sun/70 bg-sun/10 px-3 py-2 text-sm font-bold text-sun transition hover:bg-sun/20 active:translate-y-px disabled:cursor-default disabled:opacity-50 disabled:hover:bg-sun/10"
                          title="Make the currently shown meme your Meme Buddy"
                          disabled={!ready}
                          onClick={() => onPickBuddy(current)}
                        >
                          🤝 Make this my Meme Buddy
                        </button>
                      )
                    ) : buddyIsCurrent ? (
                      <span className="inline-flex rounded-xl border border-sun bg-sun/15 px-3 py-2 text-sm font-bold text-sun ring-2 ring-sun/50">
                        🤝 Your Meme Buddy
                      </span>
                    ) : (
                      <span
                        className="inline-flex rounded-xl border border-line bg-night px-3 py-2 text-sm font-semibold text-dim"
                        title="One Meme Buddy pick per round"
                      >
                        🤝 Meme Buddy: {buddyMeme?.username ?? 'picked'}
                      </span>
                    )}
                  </div>
                </div>
                  </div>
                </>
              )}

              <p className="mt-3 text-center text-xs text-dim">
                {!scoresEnabled
                  ? '🌿 Relaxed round — the votes are just for fun'
                  : isOwn || ready
                    ? '🤫 Votes stay secret until the results'
                    : 'Preparing meme…'}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
