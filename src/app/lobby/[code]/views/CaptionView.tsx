'use client'

import { useEffect, useRef, useState } from 'react'
import type { CaptionSubmission, FreeformLine, MemePadding, TemplateData } from '@/lib/types'
import { clampFreeformLine, normalizeMemePadding } from '@/lib/meme'
import FreeformEditor from './FreeformEditor'

const NO_PADDING: MemePadding = { top: 0, bottom: 0 }

interface Props {
  template: TemplateData | null
  round: number
  totalRounds: number
  rerollsLeft: number
  onReroll: () => void
  onSubmit: (submission: CaptionSubmission) => void
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
  onReroll,
  onSubmit,
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

  const submit = () => {
    if (isSubmitted || rerollPending || !hasText) return
    const cleaned = lines.filter((l) => l.text.trim() !== '').map(clampFreeformLine)
    const activePadding =
      padding.top > 0 || padding.bottom > 0 ? { top: padding.top, bottom: padding.bottom } : undefined
    onSubmit(activePadding ? { texts: {}, lines: cleaned, padding: activePadding } : { texts: {}, lines: cleaned })
    setLocalSubmitted(true)
  }

  const reroll = () => {
    if (isSubmitted || rerollPending || rerollsLeft <= 0) return
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
            disabled={isSubmitted || rerollPending || rerollsLeft <= 0}
            aria-busy={rerollPending}
            title={
              isSubmitted
                ? 'Already submitted'
                : rerollPending
                  ? 'Loading a new template…'
                  : rerollsLeft > 0
                    ? 'Trade this template for a different one'
                    : 'No rerolls left this round'
            }
            onClick={reroll}
          >
            {rerollPending ? '⏳ …' : '🔄 Template'} <span className="text-xs">({rerollsLeft})</span>
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-line bg-card p-3 shadow-xl sm:p-4">
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
        />

        <div className="mt-4 border-t border-line pt-4">
          <button
            className="w-full rounded-xl bg-gradient-to-r from-punch to-punch2 py-3 text-lg font-extrabold uppercase tracking-wide text-night shadow-lg transition hover:brightness-110 active:translate-y-px disabled:cursor-default disabled:opacity-40"
            disabled={isSubmitted || rerollPending || !hasText}
            onClick={submit}
          >
            {isSubmitted ? 'Submitted ✓' : rerollPending ? 'Loading new template…' : hasText ? 'Send meme 🚀' : 'Write at least one text…'}
          </button>
        </div>
      </div>
    </section>
  )
}
