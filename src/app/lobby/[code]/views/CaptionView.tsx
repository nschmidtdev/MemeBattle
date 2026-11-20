'use client'

import { useEffect, useRef, useState } from 'react'
import type {
  CaptionSubmission,
  ChaosRule,
  FreeformLine,
  GameMode,
  MemePadding,
  TemplateData,
} from '@/lib/types'
import { clampFreeformLine, normalizeMemePadding } from '@/lib/meme'
import { MODE_INFO, RULE_INFO } from '@/lib/modes'
import FreeformEditor from './FreeformEditor'

const NO_PADDING: MemePadding = { top: 0, bottom: 0 }

interface Props {
  template: TemplateData | null
  round: number
  totalRounds: number
  rerollsLeft: number
  mode: GameMode
  rule: ChaosRule | null
  maxTextLen: number
  onReroll: () => void
  onSubmit: (submission: CaptionSubmission) => void
  /** Caption countdown in seconds; null when no timer is running. */
  timeLeft?: number | null
  /** Auto-submit the current draft when the timer expires (default mode). */
  forceSubmission?: boolean
  /** Controlled by the parent so a reconnected player resumes read-only. */
  submitted?: boolean
  submission?: CaptionSubmission | null
}

function templateStartLines(template: TemplateData): FreeformLine[] {
  return template.boxes.map((b) =>
    clampFreeformLine({
      id: b.id,
      text: '',
      x: b.x,
      y: b.y,
      w: b.w,
      fontSize: b.fontSize,
      color: b.color,
      stroke: b.stroke,
      font: b.font,
      align: b.align,
      rotation: b.rotation,
    }),
  )
}

/**
 * Caption phase. Every template is edited with the freeform editor:
 * if the template ships pre-placed boxes they become editable starting
 * lines — the player can move, restyle, delete them and add more.
 * Rerolling trades the template but keeps the texts already placed.
 */
export default function CaptionView({
  template,
  round,
  totalRounds,
  rerollsLeft,
  mode,
  rule,
  maxTextLen,
  onReroll,
  onSubmit,
  timeLeft = null,
  forceSubmission = true,
  submitted,
  submission,
}: Props) {
  const [lines, setLines] = useState<FreeformLine[]>([])
  const [padding, setPadding] = useState<MemePadding>(NO_PADDING)
  const [localSubmitted, setLocalSubmitted] = useState(false)
  const [rerollPending, setRerollPending] = useState(false)
  const linesRef = useRef(lines)
  linesRef.current = lines

  const isSubmitted = submitted ?? localSubmitted
  const templateKey = template ? `${template.id}|${template.imageKey}` : null
  const lastTemplateKey = useRef<string | null>(null)
  const submissionLines = submission?.lines ?? null
  const submissionPadTop = normalizeMemePadding(submission?.padding)?.top ?? 0
  const submissionPadBottom = normalizeMemePadding(submission?.padding)?.bottom ?? 0

  // Prefill from the template's boxes. A real template change (reroll) only
  // replaces the lines when the player has not written any text yet; otherwise
  // their texts stay. `submitted` is never reset here: only the parent's round
  // `key` remounts this view.
  useEffect(() => {
    if (!template) {
      lastTemplateKey.current = null
      setLines([])
      return
    }
    const changed = lastTemplateKey.current !== null && lastTemplateKey.current !== templateKey
    lastTemplateKey.current = templateKey
    if (isSubmitted) return

    const hasText = linesRef.current.some((l) => l.text.trim() !== '')
    if (changed) {
      if (!hasText) setLines(templateStartLines(template))
      return
    }
    if (linesRef.current.length === 0) setLines(templateStartLines(template))
  }, [template, templateKey, isSubmitted])

  // Resume after a refresh/reconnect: restore exactly what was submitted.
  // While the local submit is still in flight (`submission` is null) keep the
  // editor state as-is so the just-chosen padding does not disappear.
  useEffect(() => {
    if (!isSubmitted || !submission) return
    if (submissionLines) setLines(submissionLines.map(clampFreeformLine))
    setPadding({ top: submissionPadTop, bottom: submissionPadBottom })
  }, [isSubmitted, submission, submissionLines, submissionPadTop, submissionPadBottom, templateKey])

  // A new template arrived (reroll) -> the button may be used again.
  useEffect(() => {
    setRerollPending(false)
  }, [templateKey, rerollsLeft])

  // Safety valve: if the server rejects a reroll (e.g. no rerolls left),
  // don't leave the button disabled forever.
  useEffect(() => {
    if (!rerollPending) return
    const timer = window.setTimeout(() => setRerollPending(false), 6000)
    return () => window.clearTimeout(timer)
  }, [rerollPending])

  const submit = (auto = false) => {
    if (isSubmitted || rerollPending) return
    const cleaned = lines.filter((l) => l.text.trim() !== '').map(clampFreeformLine)
    if (!auto && cleaned.length === 0) return
    const activePadding =
      padding.top > 0 || padding.bottom > 0 ? { top: padding.top, bottom: padding.bottom } : undefined
    const draft: CaptionSubmission = { texts: {}, lines: cleaned }
    if (activePadding) draft.padding = activePadding
    if (auto) draft.auto = true
    onSubmit(draft)
    setLocalSubmitted(true)
  }

  // Forced participation: the moment the countdown hits zero, send whatever is
  // in the editor (even an empty draft). The server keeps a short grace window.
  const autoSubmittedRef = useRef(false)
  useEffect(() => {
    if (!template || !forceSubmission || isSubmitted || autoSubmittedRef.current) return
    if (typeof timeLeft !== 'number' || timeLeft > 0) return
    autoSubmittedRef.current = true
    submit(true)
    // submit reads the latest draft; the ref guards against re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, forceSubmission, isSubmitted, timeLeft])

  if (!template) {
    return (
      <section className="rounded-2xl border border-line bg-card p-8 text-center shadow-xl">
        <h2 className="font-display text-2xl uppercase tracking-wide">
          Round {round} / {totalRounds}
        </h2>
        <p className="mt-2 animate-pulse text-dim">Waiting for your template…</p>
      </section>
    )
  }

  const hasText = lines.some((l) => l.text.trim() !== '')
  const canReroll = mode === 'normal' && rerollsLeft > 0
  const timeIsUp = forceSubmission && typeof timeLeft === 'number' && timeLeft <= 0

  const reroll = () => {
    if (isSubmitted || rerollPending || !canReroll) return
    setRerollPending(true)
    onReroll()
  }

  return (
    <section className="mx-auto w-full max-w-2xl lg:max-w-6xl">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-2xl uppercase tracking-wide">
          Round <span className="text-sun">{round}</span> / {totalRounds}
        </h2>
        <div className="flex items-center gap-2">
          {template && (
            <span className="hidden rounded-full border border-line bg-night2 px-3 py-1 text-xs text-dim sm:inline">
              {template.name}
            </span>
          )}
          <button
            className="min-h-11 rounded-full border border-sky/60 px-4 py-2 text-sm font-bold text-sky transition hover:bg-sky/10 disabled:cursor-default disabled:opacity-40"
            disabled={isSubmitted || rerollPending || !canReroll}
            aria-busy={rerollPending}
            title={
              isSubmitted
                ? 'Already submitted'
                : rerollPending
                  ? 'Loading a new template…'
                  : mode !== 'normal'
                    ? 'Template changes are only available in Meme Battle mode'
                    : canReroll
                      ? 'Trade this template for a different one'
                      : 'No rerolls left this round'
            }
            onClick={reroll}
          >
            {rerollPending ? '⏳ …' : '🔄 Template'} <span className="text-xs">({rerollsLeft})</span>
          </button>
        </div>
      </header>

      {(mode !== 'normal' || rule) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-night2 px-3 py-2">
          {mode !== 'normal' && (
            <span className="rounded-full border border-punch/50 bg-punch/10 px-2.5 py-1 text-xs font-bold text-punch">
              {mode === 'chaos' ? '🌀 Chaos' : MODE_INFO[mode].name}
            </span>
          )}
          {rule && (
            <span className="rounded-full border border-sun/60 bg-sun/10 px-2.5 py-1 text-xs font-bold text-sun">
              {RULE_INFO[rule].emoji} {RULE_INFO[rule].label}
            </span>
          )}
          <span className="text-xs text-dim">
            {rule ? RULE_INFO[rule].description : MODE_INFO[mode].description}
          </span>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-card p-3 shadow-xl sm:p-4">
        {timeIsUp && !isSubmitted && (
          <div className="mb-3 rounded-xl border border-sun/60 bg-sun/10 px-4 py-3 text-center font-semibold text-sun">
            ⏰ Time&apos;s up — submitting your current draft…
          </div>
        )}
        {isSubmitted && (
          <div className="mb-3 rounded-xl border border-mint/50 bg-mint/10 px-4 py-3 text-center font-semibold text-mint">
            ✅ Submitted — waiting for the others…
          </div>
        )}

        <FreeformEditor
          template={template}
          lines={lines}
          setLines={setLines}
          disabled={isSubmitted}
          padding={padding}
          onPaddingChange={setPadding}
          maxTextLen={maxTextLen}
        />

        <div className="mt-4 border-t border-line pt-4">
          <button
            className="w-full rounded-xl bg-gradient-to-r from-punch to-punch2 py-3 text-lg font-extrabold uppercase tracking-wide text-night shadow-lg transition hover:brightness-110 active:translate-y-px disabled:cursor-default disabled:opacity-40"
            disabled={isSubmitted || rerollPending || !hasText}
            onClick={() => submit()}
          >
            {isSubmitted ? 'Submitted ✓' : rerollPending ? 'Loading new template…' : hasText ? 'Send meme 🚀' : 'Write at least one text…'}
          </button>
        </div>
      </div>
    </section>
  )
}
