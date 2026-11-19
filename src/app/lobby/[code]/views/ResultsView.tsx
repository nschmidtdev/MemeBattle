'use client'

import { useEffect, useRef, useState } from 'react'
import type { FinalMeme, GameOverPayload, RoundResult } from '@/lib/types'
import MemeView from '@/components/MemeView'
import { downloadMemePng } from '@/lib/meme'

/** Final gallery meme; the server adds its round rank. */
type GalleryMeme = FinalMeme & { rank?: number }

interface RoundProps {
  mode: 'round'
  result: RoundResult
  myId?: string | null
  /** Needed to announce the final round instead of "next round". */
  totalRounds?: number
}
interface OverProps extends GameOverPayload {
  mode: 'over'
  myId: string | null
  isHost: boolean
  onPlayAgain: () => void
}
type Props = RoundProps | OverProps

const STEP_H = ['h-44', 'h-36', 'h-28']

function scoreCls(n: number) {
  return n > 0 ? 'text-mint' : n < 0 ? 'text-rose' : 'text-dim'
}

/** Medal for a competition rank; ties beyond 3 simply show the number. */
function medal(rank: number): string {
  if (rank === 1) return '🏆'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return String(rank)
}

/**
 * Sort by score and fill in missing ranks with competition ranking
 * (1, 1, 3). Server-provided ranks win, so per-round ranks stay intact.
 */
function rankMemes<T extends { score: number; rank?: number }>(rows: T[]): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => b.score - a.score)
  let prevScore: number | null = null
  let prevRank = 0
  return sorted.map((row, i) => {
    const computed = prevScore !== null && row.score === prevScore ? prevRank : i + 1
    const rank = row.rank ?? computed
    prevScore = row.score
    prevRank = rank
    return { ...row, rank }
  })
}

function rankPlayers<T extends { total: number; rank?: number }>(rows: T[]): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => b.total - a.total)
  let prevTotal: number | null = null
  let prevRank = 0
  return sorted.map((row, i) => {
    const computed = prevTotal !== null && row.total === prevTotal ? prevRank : i + 1
    const rank = row.rank ?? computed
    prevTotal = row.total
    prevRank = rank
    return { ...row, rank }
  })
}

/**
 * Final gallery: rank memes within their round (so every round has its own
 * winner) when the server does not attach per-meme ranks, then sort the whole
 * gallery by score.
 */
function rankGallery(memes: GalleryMeme[]): Array<GalleryMeme & { rank: number }> {
  const byRound = new Map<number, GalleryMeme[]>()
  for (const m of memes) {
    const group = byRound.get(m.round)
    if (group) group.push(m)
    else byRound.set(m.round, [m])
  }
  const ranked: Array<GalleryMeme & { rank: number }> = []
  for (const group of byRound.values()) ranked.push(...rankMemes(group))
  return ranked.sort((a, b) => b.score - a.score)
}

/** Hide gallery entries whose submission has no non-empty text at all. */
function hasVisibleContent(m: FinalMeme): boolean {
  const lines = m.submission?.lines ?? []
  if (lines.some((l) => typeof l.text === 'string' && l.text.trim() !== '')) return true
  return Object.values(m.submission?.texts ?? {}).some((t) => typeof t === 'string' && t.trim() !== '')
}

function Avatar({ entry, size = 'h-9 w-9 text-base' }: { entry: { username: string; color: string }; size?: string }) {
  return (
    <span className={`flex flex-none items-center justify-center rounded-full font-extrabold text-night ${size}`} style={{ background: entry.color }}>
      {entry.username[0]?.toUpperCase()}
    </span>
  )
}

/**
 * Gallery card: the canvas is only mounted once the card approaches the
 * viewport, so a long game never allocates hundreds of canvases at once.
 */
function MemeCard({ meme, mine }: { meme: GalleryMeme; mine: boolean }) {
  const holderRef = useRef<HTMLElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'ok' | 'fail'>('idle')

  useEffect(() => {
    if (visible) return
    const el = holderRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { rootMargin: '360px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const gold = meme.rank === 1

  const download = async () => {
    if (saving) return
    setSaving(true)
    const slug = meme.username.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meme'
    const ok = await downloadMemePng(meme.template, meme.submission, `meme-r${meme.round}-${slug}.png`)
    setSaving(false)
    setSaveState(ok ? 'ok' : 'fail')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSaveState('idle'), 1600)
  }

  return (
    <figure
      ref={holderRef}
      className={`relative overflow-hidden rounded-2xl border bg-night2 ${
        gold
          ? 'border-sun/70 shadow-[0_0_18px_rgba(255,201,60,0.25)]'
          : mine
            ? 'border-punch/70'
            : 'border-line'
      }`}
    >
      <button
        className="absolute right-2 top-2 z-10 rounded-lg border border-line bg-night/80 px-2 py-1 text-sm backdrop-blur transition hover:border-sky hover:text-sky disabled:opacity-60"
        title={saveState === 'fail' ? 'Download failed' : 'Download this meme as PNG'}
        onClick={download}
        disabled={saving}
      >
        {saving ? '…' : saveState === 'ok' ? '✓' : saveState === 'fail' ? '⚠' : '⬇'}
      </button>
      <div className="meme-canvas-wrap border-none bg-black">
        {visible ? (
          <MemeView template={meme.template} submission={meme.submission} maxDim={320} className="max-h-56 w-auto max-w-full" />
        ) : (
          <div className="flex h-48 w-full items-center justify-center text-xs text-dim">Loading meme…</div>
        )}
      </div>
      <figcaption className="flex items-center gap-2 px-2.5 py-2">
        {gold && <span className="text-lg" title="Best meme of its round">👑</span>}
        <span className="min-w-0 flex-1 truncate text-sm font-bold">
          {meme.username}
          {mine && <span className="ml-1 text-xs text-punch">(you)</span>}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-dim">R{meme.round}</span>
        <span className={`text-sm font-extrabold tabular-nums ${scoreCls(meme.score)}`}>
          {meme.score > 0 ? `+${meme.score}` : meme.score}
        </span>
      </figcaption>
    </figure>
  )
}

export default function ResultsView(props: Props) {
  if (props.mode === 'round') {
    const { result } = props
    const memes = rankMemes(result.memes)
    const isFinal = props.totalRounds !== undefined && result.round >= props.totalRounds
    const playerMeta = result.players ?? {}
    const memeNames = new Map(result.memes.map((m) => [m.playerId, m.username]))

    // "Overall standings" must include everyone, even players who did not submit.
    const ids = new Set([...Object.keys(result.totals), ...Object.keys(playerMeta)])
    const totalRows = rankPlayers(
      [...ids].map((playerId) => ({
        playerId,
        username: playerMeta[playerId]?.username ?? memeNames.get(playerId) ?? 'Player',
        avatar: playerMeta[playerId]?.avatar ?? '',
        color: playerMeta[playerId]?.color ?? '#607d8b',
        total: result.totals[playerId] ?? 0,
        rank: undefined as number | undefined,
      })),
    )
    const myRow = props.myId ?? null

    return (
      <section className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-6">
          <h2 className="mb-4 font-display text-2xl uppercase tracking-wide">
            Round <span className="text-sun">{result.round}</span> results
          </h2>

          <div className="grid gap-2">
            {memes.map((m) => (
              <div
                key={m.playerId}
                className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  m.rank === 1 ? 'border-sun/60 bg-sun/10' : 'border-line bg-night2'
                }`}
              >
                <span className="w-7 text-center text-lg font-extrabold text-dim">{medal(m.rank)}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{m.username}</span>
                <span className="text-xs text-dim">
                  👍 {m.up} · 🤷 {m.meh} · 👎 {m.down}
                </span>
                <span className={`w-16 text-right text-lg font-extrabold tabular-nums ${scoreCls(m.score)}`}>
                  {m.score > 0 ? `+${m.score}` : m.score}
                </span>
              </div>
            ))}
            {memes.length === 0 && <p className="text-center text-sm text-dim">Nobody submitted a meme this round.</p>}
          </div>

          {totalRows.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-sm font-bold uppercase tracking-widest text-dim">
                Overall standings
              </h3>
              <div className="grid max-h-64 gap-1.5 overflow-y-auto pr-1">
                {totalRows.map((row) => (
                  <div
                    key={row.playerId}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-1.5 ${
                      row.playerId === myRow ? 'border-punch/70 bg-punch/10' : 'border-transparent bg-night2/60'
                    }`}
                  >
                    <span className="w-5 text-center text-sm font-bold text-dim">{row.rank}</span>
                    <Avatar entry={row} size="h-6 w-6 text-xs" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {row.username}
                      {row.playerId === myRow && <span className="ml-1 text-xs text-punch">(you)</span>}
                    </span>
                    <span className={`text-sm font-extrabold tabular-nums ${scoreCls(row.total)}`}>{row.total}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {isFinal ? (
            <p className="mt-5 rounded-xl border border-sun/50 bg-sun/10 px-4 py-3 text-center font-semibold text-sun">
              🏁 That was the final round — final standings coming up!
            </p>
          ) : (
            <p className="mt-5 animate-pulse text-center text-sm text-dim">Next round starting soon…</p>
          )}
        </div>
      </section>
    )
  }

  // ------------------------------------------------------------------ game over
  const ranking = rankPlayers(props.ranking)
  const podium = ranking.filter((p) => p.rank <= 3)
  const gallery = rankGallery(((props.memes ?? []) as GalleryMeme[]).filter(hasVisibleContent))

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
                <MemeCard key={`${m.round}-${m.playerId}-${i}`} meme={m} mine={m.playerId === props.myId} />
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
              <div className="mb-4 flex flex-wrap items-end justify-center gap-1.5">
                {podium.map((p) => {
                  const gold = p.rank === 1
                  return (
                    <div
                      key={p.playerId}
                      className={`flex flex-1 min-w-20 max-w-36 flex-col items-center justify-end gap-1 rounded-t-xl border px-1 pb-2 pt-3 ${
                        gold ? 'border-sun/60 bg-gradient-to-b from-sun/20 to-sun/5' : 'border-line bg-night2'
                      } ${STEP_H[p.rank - 1] ?? 'h-24'}`}
                    >
                      <span className={gold ? 'text-3xl' : 'text-2xl'}>{medal(p.rank)}</span>
                      <Avatar entry={p} size={gold ? 'h-10 w-10 text-base' : 'h-8 w-8 text-sm'} />
                      <span className="w-full truncate text-center text-xs font-bold">{p.username}</span>
                      <span className={`text-base font-extrabold tabular-nums ${scoreCls(p.total)}`}>{p.total}</span>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="grid gap-1.5">
              {ranking.map((p) => (
                <div
                  key={p.playerId}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-base ${
                    p.playerId === props.myId
                      ? p.rank === 1
                        ? 'border-sun/70 bg-sun/10 ring-1 ring-punch/60'
                        : 'border-punch/70 bg-punch/10'
                      : p.rank === 1
                        ? 'border-sun/60 bg-sun/10'
                        : 'border-line bg-night2'
                  }`}
                >
                  <span className="w-6 text-center font-extrabold text-dim">{medal(p.rank)}</span>
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
