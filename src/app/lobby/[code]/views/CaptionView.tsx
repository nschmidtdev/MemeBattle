'use client'

import { useEffect, useState } from 'react'
import type { CaptionSubmission, FreeformLine, TemplateData } from '@/lib/types'
import FreeformEditor from './FreeformEditor'

interface Props {
  template: TemplateData | null
  round: number
  totalRounds: number
  onSubmit: (submission: CaptionSubmission) => void
}

/**
 * Caption phase. Every template is edited with the freeform editor:
 * if the template ships pre-placed boxes they become editable starting
 * lines — the player can move, restyle, delete them and add more.
 */
export default function CaptionView({ template, round, totalRounds, onSubmit }: Props) {
  const [lines, setLines] = useState<FreeformLine[]>([])
  const [submitted, setSubmitted] = useState(false)

  // reset when a new template arrives for the round
  useEffect(() => {
    setSubmitted(false)
    if (!template) {
      setLines([])
      return
    }
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
        <span className="rounded-full border border-line bg-night2 px-3 py-1 text-xs text-dim">
          {template.name}
        </span>
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
