'use client'

import { useEffect, useRef, useState } from 'react'
import type {
  CaptionSubmission,
  FinalMeme,
  GameMode,
  GameOverPayload,
  RoundBuddyPick,
  RoundResult,
  TemplateData,
} from '@/lib/types'
import MemeView from '@/components/MemeView'
import Icon from '@/components/Icon'
import { RULE_INFO } from '@/lib/modes'
import { downloadBlob, downloadMemePng, renderMemePngBlob } from '@/lib/meme'
import { createZip, type ZipEntry } from '@/lib/zip'

/** Final gallery meme; the server adds its round rank. */
type GalleryMeme = FinalMeme & { rank?: number }

/**
 * Round result meme. The buddy fields and the render data are optional here so
 * payloads from older servers (before Meme Buddy / the round gallery) still
 * render instead of crashing. Newer servers always send them.
 */
type RoundMeme = Omit<
  RoundResult['memes'][number],
  'voteScore' | 'buddyBonus' | 'buddyCount' | 'buddyPlayerIds' | 'template' | 'submission'
> &
  Partial<{
    voteScore: number
    buddyBonus: number
    buddyCount: number
    buddyPlayerIds: string[]
    template: TemplateData
    submission: CaptionSubmission
  }>

type RoundData = Omit<RoundResult, 'memes'> & {
  memes: RoundMeme[]
  roundTotals?: Record<string, number>
  buddies?: RoundBuddyPick[]
}

/** Minimum shape both galleries need for one card. */
interface CardMeme {
  playerId: string
  username: string
  template?: TemplateData
  submission?: CaptionSubmission
  score: number
  round: number
  rank?: number
  buddyCount?: number
  buddyPlayerIds?: string[]
}

interface RoundProps {
  mode: 'round'
  result: RoundResult
  myId?: string | null
  /** Needed to announce the final round instead of "next round". */
  totalRounds?: number
  gameMode: GameMode
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

/** Points are shown with an explicit plus for positive values. */
function fmt(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** Number of buddies a meme collected; older payloads simply have none. */
function buddyCountOf(m: { buddyCount?: number; buddyPlayerIds?: string[] }): number {
  if (isNum(m.buddyCount)) return Math.max(0, m.buddyCount)
  return Array.isArray(m.buddyPlayerIds) ? m.buddyPlayerIds.length : 0
}

/** Final meme score (votes + 10 per buddy); never invents points for old payloads. */
function memeScore(m: RoundMeme): number {
  if (isNum(m.score)) return m.score
  return (isNum(m.voteScore) ? m.voteScore : 0) + 10 * buddyCountOf(m)
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

/** Icons are SVG files under public/res/icons — see components/Icon.tsx. */
function DownloadIcon() {
  return <Icon name="download" className="h-5 w-5" />
}

function CheckIcon() {
  return <Icon name="check" className="h-5 w-5" />
}

function AlertIcon() {
  return <Icon name="alert" className="h-5 w-5" />
}

function SpinnerIcon() {
  return <Icon name="spinner" className="h-5 w-5 animate-spin" />
}

function ArchiveIcon() {
  return <Icon name="archive" className="h-4 w-4" />
}

/**
 * Gallery card: the canvas is only mounted once the card approaches the
 * viewport, so a long game never allocates hundreds of canvases at once.
 * Deliberately not clickable — the only action is the download button.
 */
function MemeCard({
  meme,
  mine,
  roundView = false,
  buddyNames = [],
  showScore = true,
}: {
  meme: CardMeme
  mine: boolean
  roundView?: boolean
  buddyNames?: string[]
  showScore?: boolean
}) {
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
  const buddies = buddyCountOf(meme)
  const canDownload = Boolean(meme.template && meme.submission)
  const downloadLabel = `Download ${meme.username}'s meme as PNG`

  const download = async () => {
    if (saving) return
    const template = meme.template
    const submission = meme.submission
    if (!template || !submission) return
    setSaving(true)
    const slug = meme.username.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meme'
    const ok = await downloadMemePng(template, submission, `meme-r${meme.round}-${slug}.png`)
    setSaving(false)
    setSaveState(ok ? 'ok' : 'fail')
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSaveState('idle'), 1600)
  }

  return (
    <figure
      ref={holderRef}
      className={`relative touch-manipulation select-none overflow-hidden rounded-2xl border bg-night2 ${
        gold
          ? 'border-sun/70 shadow-[0_0_18px_rgba(255,201,60,0.25)]'
          : mine
            ? 'border-punch/70'
            : 'border-line'
      }`}
    >
      {canDownload && (
        <button
          type="button"
          className={`absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-night/80 p-0 shadow-md backdrop-blur transition hover:border-sky hover:ring-2 hover:ring-sky/50 focus-visible:border-sky focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/70 disabled:cursor-default disabled:opacity-70 ${
            saveState === 'ok' ? 'text-mint' : saveState === 'fail' ? 'text-rose' : 'text-ink'
          }`}
          aria-label={downloadLabel}
          aria-busy={saving}
          title={downloadLabel}
          onClick={download}
          disabled={saving}
        >
          {saving ? <SpinnerIcon /> : saveState === 'ok' ? <CheckIcon /> : saveState === 'fail' ? <AlertIcon /> : <DownloadIcon />}
        </button>
      )}
      <div className="meme-canvas-wrap border-none bg-black">
        {visible ? (
          meme.template && meme.submission ? (
            <MemeView template={meme.template} submission={meme.submission} maxDim={320} className="max-h-56 w-auto max-w-full" />
          ) : (
            <div className="flex h-48 w-full items-center justify-center px-3 text-center text-xs text-dim">
              Meme preview unavailable
            </div>
          )
        ) : (
          <div className="flex h-48 w-full items-center justify-center text-xs text-dim">Loading meme…</div>
        )}
      </div>
      <figcaption className="px-2.5 py-2">
        <div className="flex items-center gap-2">
          {roundView && showScore ? (
            <span className="w-6 text-center text-lg font-extrabold text-dim" title={`Rank ${meme.rank ?? '?'}`}>
              {meme.rank ? medal(meme.rank) : '–'}
            </span>
          ) : (
            !roundView && showScore && gold && <span className="text-lg" title="Best meme of its round">👑</span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-bold">
            {meme.username}
            {mine && <span className="ml-1 text-xs text-punch">(you)</span>}
          </span>
          {!roundView && <span className="text-[10px] font-bold uppercase tracking-wider text-dim">R{meme.round}</span>}
          {showScore && !roundView && buddies > 0 && (
            <span
              className="rounded-full border border-sun/50 bg-sun/10 px-1.5 py-0.5 text-[10px] font-bold text-sun"
              title={`${buddies} Meme ${buddies === 1 ? 'Buddy' : 'Buddies'} (+10 each)`}
            >
              🤝 ×{buddies}
            </span>
          )}
          {showScore && (
            <span className={`text-sm font-extrabold tabular-nums ${scoreCls(meme.score)}`}>{fmt(meme.score)}</span>
          )}
        </div>
        {showScore && roundView && buddies > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className="rounded-full border border-sun/50 bg-sun/10 px-1.5 py-0.5 text-[10px] font-bold text-sun"
              title={`${buddies} Meme ${buddies === 1 ? 'Buddy' : 'Buddies'} · +10 points each`}
            >
              🤝 +10×{buddies}
            </span>
            {buddyNames.length > 0 && (
              <span className="min-w-0 flex-1 truncate text-[11px] text-dim" title={buddyNames.join(', ')}>
                {buddyNames.join(', ')}
              </span>
            )}
          </div>
        )}
      </figcaption>
    </figure>
  )
}

/** Shared card grid for the round and final galleries. */
function MemeGallery({
  memes,
  myId,
  empty,
  roundView = false,
  buddyNamesFor,
  showScore = true,
}: {
  memes: Array<CardMeme & { rank: number }>
  myId: string | null
  empty: string
  roundView?: boolean
  buddyNamesFor?: (meme: CardMeme & { rank: number }) => string[]
  showScore?: boolean
}) {
  return (
    <div className="mx-auto grid max-w-2xl grid-cols-1 justify-center gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {memes.map((meme, i) => (
        <MemeCard
          key={`${meme.round}-${meme.playerId}-${i}`}
          meme={meme}
          mine={meme.playerId === myId}
          roundView={roundView}
          buddyNames={buddyNamesFor?.(meme)}
          showScore={showScore}
        />
      ))}
      {memes.length === 0 && <p className="col-span-full text-center text-sm text-dim">{empty}</p>}
    </div>
  )
}

/** Long edge used inside the ZIP; single downloads keep their natural size. */
const ZIP_EXPORT_MAX_DIM = 2048
/** How long the ZIP button keeps its success/failure label. */
const ZIP_RESET_MS = 4000

function slugName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meme'
}

/** `r03-01-alice.png` — zero-padded so archive tools group rounds naturally. */
function zipMemeName(meme: CardMeme & { rank: number }, used: Set<string>): string {
  const base = `r${String(meme.round).padStart(2, '0')}-${String(meme.rank).padStart(2, '0')}-${slugName(meme.username)}`
  let name = `${base}.png`
  for (let i = 2; used.has(name); i++) name = `${base}-${i}.png`
  used.add(name)
  return name
}

function localDateStamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Builds one PNG per meme in the browser and offers them as a single ZIP.
 * Rendering is sequential so a 60-meme game never holds 60 canvases at once;
 * the button reports progress and skips memes whose image cannot be loaded.
 */
function DownloadAllButton({ memes }: { memes: Array<CardMeme & { rank: number }> }) {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [saved, setSaved] = useState(0)
  const [skipped, setSkipped] = useState(0)
  const runRef = useRef(0)
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      runRef.current += 1
      if (resetRef.current) clearTimeout(resetRef.current)
    }
  }, [])

  const scheduleReset = () => {
    if (resetRef.current) clearTimeout(resetRef.current)
    resetRef.current = setTimeout(() => {
      setStatus((current) => (current === 'working' ? current : 'idle'))
      setSkipped(0)
    }, ZIP_RESET_MS)
  }

  const start = async () => {
    if (status === 'working') return
    if (resetRef.current) clearTimeout(resetRef.current)
    const runId = ++runRef.current
    setStatus('working')
    setProgress(0)
    setSaved(0)
    setSkipped(0)

    const entries: ZipEntry[] = []
    const used = new Set<string>()
    let failures = 0

    for (let i = 0; i < memes.length; i++) {
      if (runRef.current !== runId) return
      const meme = memes[i]
      if (meme.template && meme.submission) {
        const blob = await renderMemePngBlob(meme.template, meme.submission, ZIP_EXPORT_MAX_DIM)
        if (runRef.current !== runId) return
        if (blob) {
          entries.push({ name: zipMemeName(meme, used), data: new Uint8Array(await blob.arrayBuffer()) })
          if (runRef.current !== runId) return
        } else {
          failures++
        }
      } else {
        failures++
      }
      setProgress(i + 1)
      setSkipped(failures)
      // Let the progress label paint before the next render blocks the thread.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    if (runRef.current !== runId) return
    if (entries.length === 0) {
      setStatus('error')
      scheduleReset()
      return
    }

    try {
      const zip = createZip(entries, { modifiedAt: new Date() })
      downloadBlob(zip, `meme-battle-${localDateStamp()}.zip`)
      setSaved(entries.length)
      setSkipped(failures)
      setStatus('done')
    } catch {
      setStatus('error')
    }
    scheduleReset()
  }

  const label =
    status === 'working'
      ? `Zipping ${progress}/${memes.length}…`
      : status === 'error'
        ? 'ZIP failed — try again'
        : status === 'done'
          ? skipped > 0
            ? `${saved} saved · ${skipped} skipped`
            : `${saved} memes saved`
          : `Download all as ZIP (${memes.length})`

  return (
    <button
      type="button"
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold transition disabled:cursor-default ${
        status === 'done'
          ? 'border-mint/60 bg-mint/10 text-mint'
          : status === 'error'
            ? 'border-rose/60 bg-rose/10 text-rose'
            : 'border-line bg-night2 text-ink hover:border-sky'
      }`}
      onClick={start}
      disabled={status === 'working'}
      aria-busy={status === 'working'}
      title="One PNG per meme (long edge up to 2048 px), packaged as a ZIP"
    >
      {status === 'working' ? (
        <SpinnerIcon />
      ) : status === 'done' ? (
        <CheckIcon />
      ) : status === 'error' ? (
        <AlertIcon />
      ) : (
        <ArchiveIcon />
      )}
      <span aria-live="polite">{label}</span>
    </button>
  )
}

export default function ResultsView(props: Props) {
  if (props.mode === 'round') {
    const result: RoundData = props.result
    const relaxed = props.gameMode === 'relaxed'
    const myId = props.myId ?? null
    const playerMeta = result.players ?? {}
    const totals = result.totals ?? {}
    const roundTotals = result.roundTotals ?? {}
    const hasRoundTotals = result.roundTotals !== undefined && result.roundTotals !== null
    const buddies: RoundBuddyPick[] = Array.isArray(result.buddies) ? result.buddies : []
    const isFinal = props.totalRounds !== undefined && result.round >= props.totalRounds

    const nameOf = (playerId: string) =>
      playerMeta[playerId]?.username ??
      buddies.find((b) => b.playerId === playerId)?.username ??
      buddies.find((b) => b.targetPlayerId === playerId)?.targetUsername ??
      'Player'
    const colorOf = (playerId: string) => playerMeta[playerId]?.color ?? '#607d8b'
    const avatarOf = (playerId: string) => playerMeta[playerId]?.avatar ?? ''

    // Buddy points the player earned by picking a meme (half of its final points).
    const pickBonus = new Map<string, number>()
    for (const b of buddies) {
      if (!b || typeof b.playerId !== 'string') continue
      pickBonus.set(b.playerId, (pickBonus.get(b.playerId) ?? 0) + (isNum(b.bonus) ? b.bonus : 0))
    }

    const ids = new Set<string>([
      ...Object.keys(totals),
      ...Object.keys(roundTotals),
      ...Object.keys(playerMeta),
      ...result.memes.map((m) => m.playerId),
      ...buddies.map((b) => b.playerId),
    ])
    const memeByPlayer = new Map<string, RoundMeme>(result.memes.map((m) => [m.playerId, m] as const))

    // Round points: server `roundTotals` wins; otherwise derive from the memes
    // (old payloads had no buddy points at all).
    const roundRows = rankPlayers(
      [...ids].map((playerId) => {
        const meme = memeByPlayer.get(playerId)
        const memePoints = meme ? memeScore(meme) : 0
        const fromPicks = pickBonus.get(playerId) ?? 0
        const serverTotal = hasRoundTotals && isNum(roundTotals[playerId]) ? roundTotals[playerId] : null
        const total = serverTotal ?? memePoints + fromPicks
        // Reconcile the breakdown with the authoritative round total, even if a
        // partial payload omitted the buddies list or a bonus value.
        const buddyPoints = serverTotal !== null ? serverTotal - memePoints : fromPicks
        return {
          playerId,
          username: nameOf(playerId),
          avatar: avatarOf(playerId),
          color: colorOf(playerId),
          total,
          memePoints,
          buddyPoints,
        }
      }),
    )

    // Cumulative standings, including players who did not submit this round.
    const totalRows = rankPlayers(
      [...ids].map((playerId) => ({
        playerId,
        username: nameOf(playerId),
        avatar: avatarOf(playerId),
        color: colorOf(playerId),
        total: totals[playerId] ?? 0,
      })),
    )

    // Only this round's memes, strongest first; ranks come from the server.
    const gallery = rankMemes(
      result.memes.map((m) => ({
        ...m,
        score: memeScore(m),
        round: result.round,
      })),
    )

    const buddyNamesFor = (m: CardMeme): string[] => {
      const buddyIds = Array.isArray(m.buddyPlayerIds)
        ? m.buddyPlayerIds
        : buddies.filter((b) => b.targetPlayerId === m.playerId).map((b) => b.playerId)
      return [...new Set(buddyIds.map(nameOf))]
    }

    const podium = roundRows.filter((p) => p.rank <= 3)

    return (
      <section className="mx-auto max-w-6xl">
        <div className="rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5">
          <h2 className="mb-1 text-center font-display text-3xl uppercase tracking-wide">
            Round <span className="text-sun">{result.round}</span> results
          </h2>
          <p className="mb-4 text-center text-sm text-dim">
            {gallery.length} {gallery.length === 1 ? 'meme' : 'memes'} this round
            {relaxed ? ' · relaxed round, no points' : ' · round points include Meme Buddies'}
          </p>

          {result.rule && (
            <p className="mx-auto mb-4 w-fit rounded-full border border-sun/60 bg-sun/10 px-3 py-1 text-xs font-bold text-sun">
              {RULE_INFO[result.rule].emoji} {RULE_INFO[result.rule].label} —{' '}
              {RULE_INFO[result.rule].description}
            </p>
          )}

          <div
            className={`grid items-start gap-5 ${
              relaxed ? '' : 'lg:grid-cols-[1fr_360px]'
            }`}
          >
            {/* ------------------------------------------------ this round's memes */}
            <div className={relaxed ? '' : 'order-2 lg:order-1'}>
              <h3 className="mb-3 text-center text-sm font-bold uppercase tracking-widest text-dim">
                Memes this round{relaxed ? '' : ' — best first'}
              </h3>
              <MemeGallery
                memes={gallery}
                myId={myId}
                empty="Nobody submitted a meme this round."
                roundView
                buddyNamesFor={buddyNamesFor}
                showScore={!relaxed}
              />
              {relaxed && (
                <p className="mt-4 rounded-xl border border-mint/50 bg-mint/10 px-4 py-3 text-center font-semibold text-mint">
                  🌿 Relaxed round — no points, no winner. Just the memes.
                  <span className="mt-1 block text-xs font-normal text-dim">
                    {isFinal ? 'Final gallery coming up…' : 'Next round starting soon…'}
                  </span>
                </p>
              )}
            </div>

            {!relaxed && (
            <div className="order-1 lg:order-2">
              <h3 className="mb-3 text-center text-sm font-bold uppercase tracking-widest text-dim lg:text-left">
                Round points
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
                        <span className={`text-base font-extrabold tabular-nums ${scoreCls(p.total)}`}>
                          {fmt(p.total)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="grid gap-1.5">
                {roundRows.map((p) => (
                  <div
                    key={p.playerId}
                    className={`rounded-xl border px-3 py-2 ${
                      p.playerId === myId
                        ? p.rank === 1
                          ? 'border-sun/70 bg-sun/10 ring-1 ring-punch/60'
                          : 'border-punch/70 bg-punch/10'
                        : p.rank === 1
                          ? 'border-sun/60 bg-sun/10'
                          : 'border-line bg-night2'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-6 text-center font-extrabold text-dim">{medal(p.rank)}</span>
                      <Avatar entry={p} size="h-7 w-7 text-xs" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">
                          {p.username}
                          {p.playerId === myId && <span className="ml-1 text-xs text-punch">(you)</span>}
                        </div>
                        <div className="text-[11px] tabular-nums text-dim">
                          Meme {fmt(p.memePoints)} · Buddy {fmt(p.buddyPoints)}
                        </div>
                      </div>
                      <span className={`text-base font-extrabold tabular-nums ${scoreCls(p.total)}`}>
                        {fmt(p.total)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {totalRows.length > 0 && (
                <>
                  <h3 className="mb-2 mt-5 text-sm font-bold uppercase tracking-widest text-dim">
                    Overall standings
                  </h3>
                  <div className="grid max-h-44 gap-1 overflow-y-auto pr-1">
                    {totalRows.map((row) => (
                      <div
                        key={row.playerId}
                        className={`flex items-center gap-2 rounded-lg border px-2.5 py-1 ${
                          row.playerId === myId ? 'border-punch/70 bg-punch/10' : 'border-transparent bg-night2/60'
                        }`}
                      >
                        <span className="w-5 text-center text-xs font-bold text-dim">{row.rank}</span>
                        <Avatar entry={row} size="h-5 w-5 text-[10px]" />
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                          {row.username}
                          {row.playerId === myId && <span className="ml-1 text-[10px] text-punch">(you)</span>}
                        </span>
                        <span className={`text-xs font-extrabold tabular-nums ${scoreCls(row.total)}`}>
                          {row.total}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {isFinal ? (
                <p className="mt-4 rounded-xl border border-sun/50 bg-sun/10 px-4 py-3 text-center font-semibold text-sun">
                  🏁 That was the final round — final standings coming up!
                </p>
              ) : (
                <p className="mt-4 animate-pulse text-center text-sm text-dim">Next round starting soon…</p>
              )}
            </div>
            )}
          </div>
        </div>
      </section>
    )
  }

  // ------------------------------------------------------------------ game over
  const ranking = rankPlayers(props.ranking)
  const podium = ranking.filter((p) => p.rank <= 3)
  const gallery = rankGallery(((props.memes ?? []) as GalleryMeme[]).filter(hasVisibleContent))
  const relaxed = props.gameMode === 'relaxed'

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
          {relaxed ? ' · just for fun' : ''}
        </p>

        <div className="grid items-start gap-5 lg:grid-cols-[1fr_360px]">
          {/* ------------------------------------------------ memes: best first */}
          <div className="order-2 lg:order-1">
            <div className="mb-3 flex flex-col items-center gap-2">
              <h3 className="text-center text-sm font-bold uppercase tracking-widest text-dim">
                All memes{relaxed ? '' : ' — best rated first'}
              </h3>
              {gallery.length > 0 && <DownloadAllButton memes={gallery} />}
            </div>
            <MemeGallery
              memes={gallery}
              myId={props.myId}
              empty="No memes made it… 🤷"
              showScore={!relaxed}
            />
          </div>

          {/* ------------------------------------------------- points staircase */}
          <div className="order-1 lg:order-2">
            {relaxed ? (
              <p className="rounded-xl border border-mint/50 bg-mint/10 px-4 py-3 text-center font-semibold text-mint">
                🌿 Relaxed game — no points, no winner. All memes are in the gallery.
              </p>
            ) : (
              <>
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
              </>
            )}

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
