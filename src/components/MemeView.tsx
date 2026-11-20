'use client'

import { useEffect, useRef, useState } from 'react'
import type { CaptionSubmission, TemplateData } from '@/lib/types'
import {
  drawMemeText,
  ensureMemeFontsReady,
  isAnimatedImage,
  loadImage,
  memeLayoutForImage,
  renderMeme,
  type MemeCanvasLayout,
} from '@/lib/meme'
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
  const textCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const onRenderedRef = useRef(onRendered)
  const renderedRef = useRef(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [gifLayout, setGifLayout] = useState<MemeCanvasLayout | null>(null)

  const url = imageUrl(template.imageKey, maxDim)

  // Keep the latest callback without re-running the render effect for every
  // parent render (inline callbacks are common).
  useEffect(() => {
    onRenderedRef.current = onRendered
  }, [onRendered])

  useEffect(() => {
    let alive = true
    setFailed(false)
    setLoading(true)
    setGifLayout(null)
    renderedRef.current = false

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
        if (!alive) return

        const animated =
          isAnimatedImage(template.imageKey) ||
          isAnimatedImage(img.currentSrc) ||
          isAnimatedImage(img.src)
        const reduceMotion =
          typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches

        if (animated && !reduceMotion) {
          // An animated GIF cannot be played through drawImage (only the first
          // frame is captured). Keep the live <img> in the DOM and draw only
          // the text on a transparent canvas above it.
          setGifLayout(memeLayoutForImage(template, submission, img, maxDim))
          setLoading(false)
          return
        }

        const rendered = renderMeme(template, submission, img, maxDim)
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = rendered.width
        canvas.height = rendered.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(rendered, 0, 0)
        setLoading(false)
        if (!renderedRef.current) {
          renderedRef.current = true
          try {
            onRenderedRef.current?.()
          } catch {
            // A consumer callback must not turn a successful draw into an error.
          }
        }
      } catch {
        if (alive) {
          setFailed(true)
          setLoading(false)
        }
      }
    })()

    return () => {
      alive = false
    }
  }, [url, template, submission, maxDim])

  // The animated view has no draw loop: the browser animates the <img>, this
  // effect only paints the static text layer that sits above it.
  useEffect(() => {
    if (!gifLayout) return
    const canvas = textCanvasRef.current
    if (!canvas) return
    canvas.width = gifLayout.width
    canvas.height = gifLayout.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawMemeText(ctx, template, submission, canvas.width, canvas.height)
    if (!renderedRef.current) {
      renderedRef.current = true
      try {
        onRenderedRef.current?.()
      } catch {
        // A consumer callback must not turn a successful draw into an error.
      }
    }
  }, [gifLayout, template, submission])

  if (gifLayout) {
    const { width: W, height: H, imageHeight, padTop, padBottom } = gifLayout
    const pct = (value: number) => `${(value / H) * 100}%`
    return (
      <div className="meme-canvas-wrap">
        <div className="relative inline-block max-w-full" style={{ lineHeight: 0 }}>
          {/* Empty spacer provides the responsive intrinsic size and the
              caller's max-height/max-width classes. */}
          <canvas
            width={W}
            height={H}
            className={`${className ?? ''} block`}
            aria-hidden="true"
          />
          {padTop > 0 && (
            <div
              className="absolute inset-x-0 top-0 bg-white"
              style={{ height: pct(padTop) }}
              aria-hidden="true"
            />
          )}
          <div
            className="absolute inset-x-0 bg-black"
            style={{ top: pct(padTop), height: pct(imageHeight) }}
            aria-hidden="true"
          />
          {padBottom > 0 && (
            <div
              className="absolute inset-x-0 bottom-0 bg-white"
              style={{ height: pct(padBottom) }}
              aria-hidden="true"
            />
          )}
          {/* eslint-disable-next-line @next/next/no-img-element -- animated GIF must stay a live <img> */}
          <img
            src={url}
            alt=""
            className="pointer-events-none absolute left-0 w-full"
            style={{
              top: pct(padTop),
              height: pct(imageHeight),
              maxHeight: 'none',
              maxWidth: 'none',
            }}
            draggable={false}
          />
          <canvas
            ref={textCanvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ maxHeight: 'none', maxWidth: 'none' }}
            aria-hidden="true"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="meme-canvas-wrap relative">
      <canvas ref={canvasRef} className={`${failed ? 'hidden' : ''} ${className ?? ''}`} />
      {loading && !failed && (
        <div className="pointer-events-none absolute inset-0 z-10 flex min-h-[6rem] items-center justify-center bg-night2/70">
          <span
            className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-sun"
            aria-label="Loading meme"
          />
        </div>
      )}
      {failed && (
        <div style={{ padding: 20, color: 'var(--dim)' }}>template image unavailable</div>
      )}
    </div>
  )
}
