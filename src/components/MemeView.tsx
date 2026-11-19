'use client'

import { useEffect, useRef, useState } from 'react'
import type { CaptionSubmission, TemplateData } from '@/lib/types'
import { ensureMemeFontsReady, loadImage, renderMeme } from '@/lib/meme'
import { imageUrl } from '@/lib/images'

interface Props {
  template: TemplateData
  submission: CaptionSubmission
  maxDim?: number
  className?: string
  /** Called after every successful canvas draw (e.g. to reveal the meme). */
  onRendered?: () => void
}

/** Renders a template + submission onto a canvas. Re-renders when inputs change. */
export default function MemeView({ template, submission, maxDim = 640, className, onRendered }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const onRenderedRef = useRef(onRendered)
  const [failed, setFailed] = useState(false)

  const url = imageUrl(template.imageKey)

  // Keep the latest callback without re-running the render effect for every
  // parent render (inline callbacks are common).
  useEffect(() => {
    onRenderedRef.current = onRendered
  }, [onRendered])

  useEffect(() => {
    let alive = true
    setFailed(false)

    // Clear immediately so an old meme never lingers while the new one loads.
    const target = canvasRef.current
    if (target) {
      target.getContext('2d')?.clearRect(0, 0, target.width, target.height)
    }

    ;(async () => {
      try {
        const img = await loadImage(url)
        if (!alive) return
        await ensureMemeFontsReady()
        if (!alive || !canvasRef.current) return

        const rendered = renderMeme(template, submission, img, maxDim)
        const canvas = canvasRef.current
        canvas.width = rendered.width
        canvas.height = rendered.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(rendered, 0, 0)
        try {
          onRenderedRef.current?.()
        } catch {
          // A consumer callback must not turn a successful draw into an error.
        }
      } catch {
        if (alive) setFailed(true)
      }
    })()

    return () => {
      alive = false
    }
  }, [url, template, submission, maxDim])

  return (
    <div className="meme-canvas-wrap">
      <canvas ref={canvasRef} className={`${failed ? 'hidden' : ''} ${className ?? ''}`} />
      {failed && (
        <div style={{ padding: 20, color: 'var(--dim)' }}>template image unavailable</div>
      )}
    </div>
  )
}
