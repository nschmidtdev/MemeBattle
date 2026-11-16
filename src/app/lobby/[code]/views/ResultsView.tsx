'use client'

import type { FinalMeme, RoundResult } from '@/lib/types'
import MemeView from '@/components/MemeView'

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
  memes: FinalMeme[]
  totalRounds: number
  myId: string | null
  isHost: boolean
  onPlayAgain: () => void
}
type Props = RoundProps | OverProps

const MEDALS = ['🏆', '🥈', '🥉']

/** Staircase step heights for the top 3 (rank 1 highest). */
const STEP_H = ['h-44', 'h-36', 'h-28']

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

  // ------------------------------------------------------------------ game over
  const ranking = [...props.result].sort((a, b) => b.total - a.total)
  const podium = ranking.slice(0, 3)
  const gallery = [...(props.memes ?? [])].sort((a, b) => b.score - a.score)

  return (
    <section className="mx-auto max-w-6xl">
      <div className="rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5">
        <h2 className="mb-1 text-center font-display text-3xl uppercase tracking-wide">
          🎉{' '}
          <span className="bg-gradient-to-r from-sun via-punch to-punch2 bg-clip-text text-transparent">
            Game over
          </span>
        </h2>
        <p className="mb-4 text-center text-sm text-dim">
          after {props.totalRounds} glorious rounds · {gallery.length} memes
        </p>

        <div className="grid items-start gap-5 lg:grid-cols-[1fr_360px]">
          {/* ------------------------------------------------ memes: best first */}
          <div className="order-2 lg:order-1">
            <h3 className="mb-3 text-center text-sm font-bold uppercase tracking-widest text-dim">
              All memes — best rated first
            </h3>
            <div className="mx-auto grid max-w-2xl grid-cols-1 justify-center gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {gallery.map((m, i) => (
                <figure
                  key={`${m.round}-${m.playerId}-${i}`}
                  className={`overflow-hidden rounded-2xl border bg-night2 ${
                    i === 0 ? 'border-sun/70 shadow-[0_0_18px_rgba(255,201,60,0.25)]' : 'border-line'
                  }`}
                >
                  <div className="meme-canvas-wrap border-none bg-black">
                    <MemeView template={m.template} submission={m.submission} maxDim={320} className="max-h-56 w-auto max-w-full" />
                  </div>
                  <figcaption className="flex items-center gap-2 px-2.5 py-2">
                    {i === 0 && <span className="text-lg">👑</span>}
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">
                      {m.username}
                      {m.playerId === props.myId && <span className="ml-1 text-xs text-punch">(you)</span>}
                    </span>
                    <span className={`text-sm font-extrabold tabular-nums ${scoreCls(m.score)}`}>
                      {m.score > 0 ? `+${m.score}` : m.score}
                    </span>
                  </figcaption>
                </figure>
              ))}
              {gallery.length === 0 && <p className="col-span-full text-center text-sm text-dim">No memes made it… 🤷</p>}
            </div>
          </div>

          {/* ------------------------------------------------- points staircase */}
          <div className="order-1 lg:order-2">
            <h3 className="mb-3 text-center text-sm font-bold uppercase tracking-widest text-dim lg:text-left">
              Points
            </h3>

            {podium.length > 0 && (
              <div className="mb-4 flex items-end justify-center gap-1.5">
                {podium.map((p, i) => (
                  <div
                    key={p.playerId}
                    className={`flex w-full flex-col items-center justify-end gap-1 rounded-t-xl border px-1 pb-2 pt-3 ${
                      i === 0 ? 'border-sun/60 bg-gradient-to-b from-sun/20 to-sun/5' : 'border-line bg-night2'
                    } ${STEP_H[i] ?? 'h-24'}`}
                  >
                    <span className={i === 0 ? 'text-3xl' : 'text-2xl'}>{MEDALS[i]}</span>
                    <Avatar entry={p} size={i === 0 ? 'h-10 w-10 text-base' : 'h-8 w-8 text-sm'} />
                    <span className="w-full truncate text-center text-xs font-bold">{p.username}</span>
                    <span className={`text-base font-extrabold tabular-nums ${scoreCls(p.total)}`}>{p.total}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-1.5">
              {ranking.map((p, i) => (
                <div
                  key={p.playerId}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-base ${
                    p.playerId === props.myId ? 'border-punch/70 bg-punch/10' : 'border-line bg-night2'
                  }`}
                >
                  <span className="w-6 text-center font-extrabold text-dim">{i + 1}</span>
                  <Avatar entry={p} size="h-8 w-8 text-sm" />
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {p.username}
                    {p.playerId === props.myId && <span className="ml-1 text-xs text-punch">(you)</span>}
                  </span>
                  <span className={`text-lg font-extrabold tabular-nums ${scoreCls(p.total)}`}>{p.total}</span>
                </div>
              ))}
            </div>

            <div className="mt-4">
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
        </div>
      </div>
    </section>
  )
}
