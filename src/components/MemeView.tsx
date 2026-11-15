'use client'

import { useEffect, useRef, useState } from 'react'
import type { CaptionSubmission, TemplateData } from '@/lib/types'
import { renderMeme, loadImage } from '@/lib/meme'
import { imageUrl } from '@/lib/images'

interface Props {
  template: TemplateData
  submission: CaptionSubmission
  maxDim?: number
  className?: string
}

/** Renders a template + submission onto a canvas. Re-renders when inputs change. */
export default function MemeView({ template, submission, maxDim = 640, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [failed, setFailed] = useState(false)

  const url = imageUrl(template.imageKey)

  useEffect(() => {
    let alive = true
    setFailed(false)
    loadImage(url)
      .then((img) => {
        if (!alive || !canvasRef.current) return
        const canvas = renderMeme(template, submission, img, maxDim)
        const target = canvasRef.current
        // copy rendered pixels into the visible canvas (keeps aspect ratio via CSS)
        target.width = canvas.width
        target.height = canvas.height
        target.getContext('2d')?.drawImage(canvas, 0, 0)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [url, template, submission, maxDim])

  if (failed) {
    return (
      <div className="meme-canvas-wrap" style={{ padding: 20, color: 'var(--dim)' }}>
        template image unavailable
      </div>
    )
  }

  return (
    <div className="meme-canvas-wrap">
      <canvas ref={canvasRef} className={className} />
    </div>
  )
}
