'use client'

import { useEffect, useState } from 'react'
import type { CaptionSubmission, FreeformLine, TemplateData } from '@/lib/types'
import MemeView from '@/components/MemeView'
import FreeformEditor from './FreeformEditor'

interface Props {
  template: TemplateData | null
  round: number
  totalRounds: number
  onSubmit: (submission: CaptionSubmission) => void
}

export default function CaptionView({ template, round, totalRounds, onSubmit }: Props) {
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [lines, setLines] = useState<FreeformLine[]>([])
  const [submitted, setSubmitted] = useState(false)

  // reset when a new template arrives for the round
  useEffect(() => {
    setTexts({})
    setLines([])
    setSubmitted(false)
  }, [template])

  if (!template) {
    return (
      <div className="panel">
        <h2>Caption Round {round} / {totalRounds}</h2>
        <p className="muted">Waiting for your template…</p>
      </div>
    )
  }

  const isFreeform = template.boxes.length === 0

  const submission: CaptionSubmission = isFreeform
    ? { texts: {}, lines }
    : { texts, lines: [] }

  const submit = () => {
    if (submitted) return
    onSubmit(submission)
    setSubmitted(true)
  }

  return (
    <div className="panel">
      <h2 className="row spread">
        <span>Caption Round {round} / {totalRounds}</span>
        <span className="badge">{isFreeform ? 'freeform' : template.name}</span>
      </h2>

      <div className="row" style={{ gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px', minWidth: 300 }}>
          {isFreeform ? (
            <FreeformEditor template={template} lines={lines} setLines={setLines} />
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {template.boxes.map((box, i) => (
                <div key={box.id} className="caption-box">
                  <span className="label">{box.defaultText ?? `Box ${i + 1}`}</span>
                  <input
                    value={texts[box.id] ?? ''}
                    maxLength={80}
                    placeholder="Type here…"
                    disabled={submitted}
                    onChange={(e) => setTexts((prev) => ({ ...prev, [box.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" disabled={submitted || (isFreeform && lines.length === 0)} onClick={submit}>
              {submitted ? 'Submitted ✓ — waiting for everyone…' : 'Submit meme'}
            </button>
          </div>
        </div>

        <div style={{ flex: '0 1 360px', minWidth: 280 }}>
          <p className="muted" style={{ textAlign: 'center' }}>Live preview</p>
          <div className="meme-canvas-wrap">
            <MemeView template={template} submission={submission} maxDim={360} />
          </div>
        </div>
      </div>
    </div>
  )
}
