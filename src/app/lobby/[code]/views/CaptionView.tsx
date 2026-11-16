'use client'

import { useEffect, useRef, useState } from 'react'
import type { CaptionSubmission, FreeformLine, TemplateData } from '@/lib/types'
import FreeformEditor from './FreeformEditor'

interface Props {
  template: TemplateData | null
  round: number
  totalRounds: number
  rerollsLeft: number
  onReroll: () => void
  onSubmit: (submission: CaptionSubmission) => void
}

/**
 * Caption phase. Every template is edited with the freeform editor:
 * if the template ships pre-placed boxes they become editable starting
 * lines — the player can move, restyle, delete them and add more.
 * Rerolling trades the template but keeps the texts already placed.
 */
export default function CaptionView({ template, round, totalRounds, rerollsLeft, onReroll, onSubmit }: Props) {
  const [lines, setLines] = useState<FreeformLine[]>([])
  const [submitted, setSubmitted] = useState(false)
  const linesRef = useRef(lines)
  linesRef.current = lines

  // reset when a new template arrives for the round; on a reroll the already
  // placed lines are kept (only the very first empty editor is prefilled)
  useEffect(() => {
    setSubmitted(false)
    if (!template) {
      setLines([])
      return
    }
    if (linesRef.current.length === 0) {
      setLines(
        template.boxes.map((b) => ({
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
        })),
      )
    }
  }, [template])

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
    if (submitted) return
    onSubmit({ texts: {}, lines })
    setSubmitted(true)
  }

  return (
    <section className="mx-auto max-w-2xl">
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
            className="rounded-full border border-sky/60 px-3 py-1.5 text-sm font-bold text-sky transition hover:bg-sky/10 disabled:cursor-default disabled:opacity-40"
            disabled={submitted || rerollsLeft <= 0}
            title={rerollsLeft > 0 ? 'Trade this template for a different one' : 'No rerolls left this round'}
            onClick={onReroll}
          >
            🔄 Template <span className="text-xs">({rerollsLeft})</span>
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-line bg-card p-3 shadow-xl sm:p-4">
        <FreeformEditor template={template} lines={lines} setLines={setLines} disabled={submitted} />

        <div className="mt-4 border-t border-line pt-4">
          {submitted ? (
            <div className="rounded-xl border border-mint/50 bg-mint/10 px-4 py-3 text-center font-semibold text-mint">
              ✅ Submitted — waiting for the others…
            </div>
          ) : (
            <button
              className="w-full rounded-xl bg-gradient-to-r from-punch to-punch2 py-3 text-lg font-extrabold uppercase tracking-wide text-night shadow-lg transition hover:brightness-110 active:translate-y-px disabled:cursor-default disabled:opacity-40"
              disabled={!hasText}
              onClick={submit}
            >
              {hasText ? 'Send meme 🚀' : 'Write at least one text…'}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
