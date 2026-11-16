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

function scoreCls(n: number) {
  return n > 0 ? 'text-mint' : n < 0 ? 'text-rose' : 'text-dim'
}

function Avatar({ entry, size = 'h-9 w-9 text-base' }: { entry: { username: string; color: string }; size?: string }) {
  return (
    <span className={`flex items-center justify-center rounded-full font-extrabold text-night ${size}`} style={{ background: entry.color }}>
      {entry.username[0]?.toUpperCase()}
    </span>
  )
}

export default function ResultsView(props: Props) {
  if (props.mode === 'round') {
    const memes = [...props.result.memes].sort((a, b) => b.score - a.score)
    const totals = Object.entries(props.result.totals).sort((a, b) => b[1] - a[1])
    const names = new Map(props.result.memes.map((m) => [m.playerId, m.username]))
    return (
      <section className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-6">
          <h2 className="mb-4 font-display text-2xl uppercase tracking-wide">
            Round <span className="text-sun">{props.result.round}</span> results
          </h2>

          <div className="grid gap-2">
            {memes.map((m, i) => (
              <div
                key={m.playerId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-night2 px-3 py-2.5"
              >
                <span className="w-7 text-center text-lg font-extrabold text-dim">
                  {MEDALS[i] ?? i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">{m.username}</span>
                <span className="text-xs text-dim">
                  👍 {m.up} · 🤷 {m.meh} · 👎 {m.down}
                </span>
                <span className={`w-16 text-right text-lg font-extrabold tabular-nums ${scoreCls(m.score)}`}>
                  {m.score > 0 ? `+${m.score}` : m.score}
                </span>
              </div>
            ))}
          </div>

          {totals.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-sm font-bold uppercase tracking-widest text-dim">
                Overall standings
              </h3>
              <div className="grid gap-1.5">
                {totals.slice(0, 8).map(([playerId, total], i) => (
                  <div key={playerId} className="flex items-center gap-3 rounded-lg bg-night2/60 px-3 py-1.5">
                    <span className="w-5 text-center text-sm font-bold text-dim">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {names.get(playerId) ?? 'Player'}
                    </span>
                    <span className={`text-sm font-extrabold tabular-nums ${scoreCls(total)}`}>{total}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <p className="mt-5 animate-pulse text-center text-sm text-dim">Next round starting soon…</p>
        </div>
      </section>
    )
  }

  const ranking = [...props.result].sort((a, b) => b.total - a.total)
  const podium = ranking.slice(0, 3)
  // display order: 2nd, 1st, 3rd (winner in the middle, slightly taller)
  const podiumOrder = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium

  return (
    <section className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-6">
        <h2 className="mb-5 text-center font-display text-3xl uppercase tracking-wide">
          🎉 <span className="bg-gradient-to-r from-sun via-punch to-punch2 bg-clip-text text-transparent">Game over</span>
        </h2>
        <p className="-mt-4 mb-5 text-center text-sm text-dim">after {props.totalRounds} glorious rounds</p>

        {podium.length > 0 && (
          <div className="mb-6 flex items-end justify-center gap-2 sm:gap-4">
            {podiumOrder.map((p) => {
              const isWinner = p === podium[0]
              return (
                <div
                  key={p.playerId}
                  className={`flex w-24 flex-col items-center gap-1 rounded-2xl border px-2 py-3 sm:w-32 ${
                    isWinner ? 'border-sun/60 bg-sun/10' : 'border-line bg-night2'
                  } ${isWinner ? 'pb-6 sm:pb-8' : ''}`}
                >
                  <span className={isWinner ? 'text-4xl' : 'text-2xl'}>{MEDALS[podium.indexOf(p)]}</span>
                  <Avatar entry={p} size={isWinner ? 'h-11 w-11 text-lg' : 'h-9 w-9 text-base'} />
                  <span className="w-full truncate text-center text-sm font-bold">{p.username}</span>
                  <span className={`text-lg font-extrabold tabular-nums ${scoreCls(p.total)}`}>{p.total}</span>
                </div>
              )
            })}
          </div>
        )}

        <div className="grid gap-1.5">
          {ranking.map((p, i) => (
            <div
              key={p.playerId}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                p.playerId === props.myId ? 'border-punch/70 bg-punch/10' : 'border-line bg-night2'
              }`}
            >
              <span className="w-6 text-center font-extrabold text-dim">{i + 1}</span>
              <Avatar entry={p} size="h-8 w-8 text-sm" />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {p.username}
                {p.playerId === props.myId && <span className="ml-1 text-xs text-punch">(you)</span>}
              </span>
              <span className={`font-extrabold tabular-nums ${scoreCls(p.total)}`}>{p.total}</span>
            </div>
          ))}
        </div>

        <div className="mt-6">
          {props.isHost ? (
            <button
              className="w-full rounded-xl bg-gradient-to-r from-punch to-punch2 py-3 text-lg font-extrabold uppercase tracking-wide text-night shadow-lg transition hover:brightness-110 active:translate-y-px"
              onClick={props.onPlayAgain}
            >
              🔁 Play again
            </button>
          ) : (
            <p className="text-center text-sm text-dim">Waiting for the host to start a new game…</p>
          )}
        </div>
      </div>
    </section>
  )
}
