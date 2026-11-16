// Client-side meme rendering. Deterministic: same template + submission + size
// always produces the same image. No stored meme files — everything is drawn
// from data, which keeps storage at zero and makes downloads trivial.

import type { CaptionSubmission, FreeformLine, RenderTextItem, TemplateBox, TemplateData } from './types'

/** Merge template boxes with the player's text into renderable text items. */
export function buildTextItems(template: TemplateData, submission: CaptionSubmission): RenderTextItem[] {
  // Freeform submissions (every caption is edited with the freeform editor now):
  // the placed lines carry all placement info themselves.
  const lines = (submission.lines ?? []).filter((l) => l && typeof l.text === 'string' && l.text.trim() !== '')
  if (lines.length > 0) {
    return lines.map((l) => toRenderItem(l, l.text))
  }
  if (template.isFreeform) return []
  // Legacy fixed-slot submissions (boxId -> text)
  return template.boxes
    .map((box) => {
      const text = submission.texts[box.id] ?? box.defaultText ?? ''
      if (!text || !text.trim()) return null
      return toRenderItem(box, text)
    })
    .filter((x): x is RenderTextItem => x !== null)
}

function toRenderItem(box: TemplateBox | FreeformLine, text: string): RenderTextItem {
  return {
    id: box.id,
    text,
    x: box.x,
    y: box.y,
    w: box.w,
    fontSize: box.fontSize,
    color: box.color,
    stroke: box.stroke,
    font: box.font,
    align: box.align,
    rotation: box.rotation,
  }
}

export interface RenderedMeme {
  width: number
  height: number
  canvas: HTMLCanvasElement
}

/**
 * Draw the template image + all text onto a canvas.
 * `image` is the decoded HTMLImageElement for the template (SVG works fine).
 * Text uses relative coordinates so output is resolution-independent.
 */
export function renderMeme(
  template: TemplateData,
  submission: CaptionSubmission,
  image: HTMLImageElement,
  maxDim = 640,
): HTMLCanvasElement {
  const iw = image.naturalWidth || 800
  const ih = image.naturalHeight || 800
  const scale = Math.min(1, maxDim / Math.max(iw, ih))
  const W = Math.max(1, Math.round(iw * scale))
  const H = Math.max(1, Math.round(ih * scale))

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, W, H)

  for (const item of buildTextItems(template, submission)) {
    drawTextItem(ctx, item, W, H)
  }
  return canvas
}

function drawTextItem(ctx: CanvasRenderingContext2D, item: RenderTextItem, W: number, H: number) {
  const fontSize = Math.max(4, item.fontSize * H)
  const maxWidth = Math.max(10, item.w * W)
  const cx = item.x * W
  const cy = item.y * H
  const lines = wrapText(ctx, item.text, item.font, fontSize, maxWidth)

  ctx.save()
  ctx.translate(cx, cy)
  if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180)

  const lineHeight = fontSize * 1.05
  const totalHeight = lines.length * lineHeight
  const strokeW = Math.max(1, fontSize * 0.09)
  ctx.font = `${item.font === 'Impact' ? '900 ' : ''}${fontSize}px ${item.font}, sans-serif`
  ctx.textAlign = item.align
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.lineWidth = strokeW
  ctx.strokeStyle = item.stroke
  ctx.fillStyle = item.color

  const x = item.align === 'left' ? -maxWidth / 2 : item.align === 'right' ? maxWidth / 2 : 0
  for (let i = 0; i < lines.length; i++) {
    const y = -totalHeight / 2 + lineHeight / 2 + i * lineHeight
    ctx.strokeText(lines[i], x, y)
    ctx.fillText(lines[i], x, y)
  }
  ctx.restore()
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, font: string, fontSize: number, maxWidth: number): string[] {
  const words = text.replace(/\r/g, '').split(/\n/).flatMap((line) => line.split(' '))
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word
    ctx.font = `${font === 'Impact' ? '900 ' : ''}${fontSize}px ${font}, sans-serif`
    if (word && ctx.measureText(attempt).width > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = attempt
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

/** Render + return a PNG data URL (for the download button). */
export function memeToPngDataUrl(
  template: TemplateData,
  submission: CaptionSubmission,
  image: HTMLImageElement,
  maxDim = 1024,
): string {
  const canvas = renderMeme(template, submission, image, maxDim)
  return canvas.toDataURL('image/png')
}

/** Load an image element from a URL (cross-origin safe when same-origin). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}
