// Client-side meme rendering. Deterministic: same template + submission + size
// always produces the same image. No stored meme files — everything is drawn
// from data, which keeps storage at zero and makes downloads trivial.

import { LINE_BOUNDS, ROTATION_BOUNDS, TEXT_WIDTH_BOUNDS } from './types'
import type {
  CaptionSubmission,
  FreeformLine,
  MemePadding,
  RenderTextItem,
  TemplateBox,
  TemplateData,
} from './types'
import { imageUrl } from './images'

/** White bar height per active side, relative to the template image height. */
export const MAX_MEME_PAD_RATIO = 1
/** Legacy boolean padding (`true`) used to mean one fifth of the image height. */
const LEGACY_MEME_PAD_RATIO = 0.2

/** Vertical breathing room inside an optional white text box, relative to the font size. */
export const MEME_TEXT_BOX_PAD_RATIO = 0.15

/** Clamp a numeric value the same way the server validates submissions. */
export function clampMemeValue(value: number, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/**
 * Normalise padding from clients. Numeric values are fractions of the image
 * height and are clamped to 0..MAX_MEME_PAD_RATIO (100% — a bar can be as tall
 * as the image itself). Legacy boolean payloads (`true`) keep the old 20% bar.
 */
export function normalizeMemePadding(value: unknown): MemePadding | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as { top?: unknown; bottom?: unknown }

  const side = (input: unknown): number => {
    if (input === true) return LEGACY_MEME_PAD_RATIO
    if (input === false || input === undefined || input === null) return 0
    const parsed = typeof input === 'number' ? input : Number.NaN
    if (!Number.isFinite(parsed)) return 0
    return clampMemeValue(parsed, 0, MAX_MEME_PAD_RATIO)
  }

  const top = side(raw.top)
  const bottom = side(raw.bottom)
  if (top <= 0 && bottom <= 0) return undefined
  return { top, bottom }
}

/**
 * Detect very light text colours (white, near-white, light yellow…). Used by
 * the editor to flip to dark text when a white text box is switched on.
 */
export function isLightTextColor(color: string): boolean {
  const value = (color || '').trim().toLowerCase()
  if (value === 'white') return true
  let hex: string | null = null
  if (/^#[0-9a-f]{3}$/.test(value)) {
    hex = value.slice(1).split('').map((c) => c + c).join('')
  } else if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(value)) {
    hex = value.slice(1, 7)
  }
  if (!hex) return false
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255
  // Perceived brightness (BT.601), close enough for "very light".
  return 0.299 * r + 0.587 * g + 0.114 * b >= 0.8
}

/**
 * Keep a freeform line inside the same bounds the server enforces, so the
 * editor preview and the voting canvas cannot drift apart.
 */
export function clampFreeformLine(line: FreeformLine): FreeformLine {
  return {
    ...line,
    x: clampMemeValue(line.x, LINE_BOUNDS.xMin, LINE_BOUNDS.xMax),
    y: clampMemeValue(line.y, LINE_BOUNDS.yMin, LINE_BOUNDS.yMax),
    w: clampMemeValue(line.w, TEXT_WIDTH_BOUNDS.min, TEXT_WIDTH_BOUNDS.max),
    fontSize: clampMemeValue(line.fontSize, LINE_BOUNDS.fontSizeMin, LINE_BOUNDS.fontSizeMax),
    rotation: clampMemeValue(line.rotation, ROTATION_BOUNDS.min, ROTATION_BOUNDS.max),
  }
}

export type MemeResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/**
 * Resize a text block from one of eight handles, Windows-style: the opposite
 * edge/corner stays put while the dragged one follows the pointer. `dx`/`dy`
 * are pointer deltas as fractions of the stage width/height. Width grows from
 * the left/right edges and font size from the top/bottom edges, so corner
 * handles change both. Handles on a rotated text use the block's local axes.
 */
export function resizeFreeformLine(
  line: Pick<FreeformLine, 'x' | 'y' | 'w' | 'fontSize' | 'rotation'>,
  handle: MemeResizeHandle,
  dx: number,
  dy: number,
): Pick<FreeformLine, 'x' | 'y' | 'w' | 'fontSize'> {
  const rad = ((Number.isFinite(line.rotation) ? line.rotation : 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const localX = dx * cos + dy * sin
  const localY = -dx * sin + dy * cos
  const signX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0
  const signY = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0

  const w = signX
    ? clampMemeValue(line.w + localX * signX, TEXT_WIDTH_BOUNDS.min, TEXT_WIDTH_BOUNDS.max)
    : line.w
  const fontSize = signY
    ? clampMemeValue(
        line.fontSize + localY * signY,
        LINE_BOUNDS.fontSizeMin,
        LINE_BOUNDS.fontSizeMax,
      )
    : line.fontSize

  // Keep the opposite edge fixed by moving the centre half the size change.
  const shiftX = (signX * (w - line.w)) / 2
  const shiftY = (signY * (fontSize - line.fontSize)) / 2
  const stageDx = shiftX * cos - shiftY * sin
  const stageDy = shiftX * sin + shiftY * cos

  return {
    x: clampMemeValue(line.x + stageDx, LINE_BOUNDS.xMin, LINE_BOUNDS.xMax),
    y: clampMemeValue(line.y + stageDy, LINE_BOUNDS.yMin, LINE_BOUNDS.yMax),
    w,
    fontSize,
  }
}

/**
 * Family stack shared by the DOM editor and the canvas renderer.
 * Impact is mapped to the bundled Anton face (with Impact as fallback).
 */
export function memeFontFamily(font: string): string {
  const name = memeFontName(font)
  if (name.toLowerCase() === 'impact' || name.toLowerCase() === 'anton') {
    return `'Anton', Impact, 'Arial Black', sans-serif`
  }
  return `'${name}', Impact, 'Arial Black', sans-serif`
}

/** Weight shared by the DOM editor and the canvas renderer. */
export function memeFontWeight(font: string): number {
  const name = memeFontName(font).toLowerCase()
  return name === 'impact' || name === 'anton' ? 900 : 700
}

function memeFontName(font: string): string {
  return (font || 'Impact').replace(/['"\\]/g, '').trim() || 'Impact'
}

/** Complete canvas font shorthand (must match the editor's family + weight). */
export function memeCanvasFont(font: string, sizePx: number): string {
  return `${memeFontWeight(font)} ${Math.max(1, sizePx)}px ${memeFontFamily(font)}`
}

/**
 * Make sure the bundled display font is decoded before any canvas text is
 * drawn; canvas does not wait for webfonts on its own.
 */
export async function ensureMemeFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await document.fonts.load('900 16px Anton')
    await document.fonts.ready
  } catch {
    // Font loading is best effort: Impact / Arial Black remain as fallbacks.
  }
}

/** Merge template boxes with the player's text into renderable text items. */
export function buildTextItems(template: TemplateData, submission: CaptionSubmission): RenderTextItem[] {
  // Freeform submissions (every caption is edited with the freeform editor now):
  // the placed lines carry all placement info themselves.
  const submissionLines = submission.lines ?? []
  const lines = submissionLines.filter((l) => l && typeof l.text === 'string' && l.text.trim() !== '')
  if (lines.length > 0) {
    return lines.map((l) => toRenderItem(l, l.text))
  }
  // A freeform submission with only empty lines must not fall back to the
  // template's default texts.
  if (submissionLines.length > 0 || template.isFreeform) return []
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
    x: clampMemeValue(box.x, LINE_BOUNDS.xMin, LINE_BOUNDS.xMax),
    y: clampMemeValue(box.y, LINE_BOUNDS.yMin, LINE_BOUNDS.yMax),
    w: clampMemeValue(box.w, TEXT_WIDTH_BOUNDS.min, TEXT_WIDTH_BOUNDS.max),
    fontSize: clampMemeValue(box.fontSize, LINE_BOUNDS.fontSizeMin, LINE_BOUNDS.fontSizeMax),
    color: box.color,
    stroke: box.stroke,
    font: box.font,
    align: box.align,
    rotation: clampMemeValue(box.rotation, ROTATION_BOUNDS.min, ROTATION_BOUNDS.max),
    whiteBackground: 'whiteBackground' in box ? box.whiteBackground === true : false,
  }
}

export interface RenderedMeme {
  width: number
  height: number
  canvas: HTMLCanvasElement
}

/** Final canvas geometry for a template image plus optional white bars. */
export interface MemeCanvasLayout {
  /** Scale used to size the source image before pixel rounding. */
  scale: number
  imageWidth: number
  imageHeight: number
  padTop: number
  padBottom: number
  /** Total canvas size (image + bars). */
  width: number
  height: number
}

/**
 * Size the final canvas before anything is drawn.
 *
 * Each bar is its own fraction of the rendered image height (0..1, max. the
 * image height). The whole canvas (image + bars) must stay inside the `maxDim`
 * budget, so the image is scaled down accordingly and keeps its aspect ratio.
 * Without padding this is exactly the old image sizing.
 */
export function memeCanvasLayout(
  naturalWidth: number,
  naturalHeight: number,
  maxDim: number,
  padding?: MemePadding | null,
  allowUpscale = false,
): MemeCanvasLayout {
  const iw = Math.max(1, Number(naturalWidth) || 1)
  const ih = Math.max(1, Number(naturalHeight) || 1)
  const top = clampMemeValue(Number(padding?.top ?? 0), 0, MAX_MEME_PAD_RATIO)
  const bottom = clampMemeValue(Number(padding?.bottom ?? 0), 0, MAX_MEME_PAD_RATIO)
  const paddedHeight = ih * (1 + top + bottom)
  const longest = Math.max(iw, paddedHeight)
  const target = Math.max(1, maxDim)
  const scale = allowUpscale ? target / longest : Math.min(1, target / longest)
  let imageWidth = Math.max(1, Math.round(iw * scale))
  let imageHeight = Math.max(1, Math.round(ih * scale))
  let padTop = top > 0 ? Math.max(1, Math.round(imageHeight * top)) : 0
  let padBottom = bottom > 0 ? Math.max(1, Math.round(imageHeight * bottom)) : 0

  // Rounding the bars independently can exceed the budget by a pixel or two.
  // Trim the image (keeping its aspect ratio) until image + bars fit exactly.
  const overflow = imageHeight + padTop + padBottom - target
  if (overflow > 0) {
    const nextHeight = Math.max(1, imageHeight - overflow)
    imageWidth = Math.max(1, Math.round(imageWidth * (nextHeight / imageHeight)))
    imageHeight = nextHeight
    padTop = top > 0 ? Math.max(1, Math.round(imageHeight * top)) : 0
    padBottom = bottom > 0 ? Math.max(1, Math.round(imageHeight * bottom)) : 0
  }

  return {
    scale,
    imageWidth,
    imageHeight,
    padTop,
    padBottom,
    width: imageWidth,
    height: imageHeight + padTop + padBottom,
  }
}

function isVectorSource(url: string): boolean {
  return /\.svg(?:[?#]|$)/i.test(url)
}

/**
 * Resolve the final canvas geometry and image placement for a loaded image.
 * Factored out so the animated-GIF view can size its DOM layers exactly like
 * the canvas renderer.
 */
export function memeLayoutForImage(
  template: TemplateData,
  submission: CaptionSubmission,
  image: HTMLImageElement,
  maxDim = 640,
): MemeCanvasLayout {
  const vector =
    isVectorSource(image.currentSrc || image.src || '') || isVectorSource(template.imageKey)

  // Never derive the aspect ratio from the browser's 0 / 300×150 placeholder
  // size for SVG images. Without intrinsic dimensions we fall back to 4:3.
  let iw = Number(image.naturalWidth) || 0
  let ih = Number(image.naturalHeight) || 0
  if (iw <= 0 || ih <= 0 || (vector && iw === 300 && ih === 150)) {
    iw = 800
    ih = 600
  }

  const padding = normalizeMemePadding(submission.padding)
  return memeCanvasLayout(iw, ih, maxDim, padding, vector)
}

/** True for GIF sources; those animate natively in the DOM-based view. */
export function isAnimatedImage(source: string | null | undefined): boolean {
  return /\.gif(?:[?#]|$)/i.test(source ?? '')
}

/** Draw only the text layer (used over a live animated GIF). */
export function drawMemeText(
  ctx: CanvasRenderingContext2D,
  template: TemplateData,
  submission: CaptionSubmission,
  width: number,
  height: number,
) {
  for (const item of buildTextItems(template, submission)) {
    drawTextItem(ctx, item, width, height)
  }
}

/**
 * Draw the template image + all text onto a canvas.
 * `image` is the decoded HTMLImageElement for the template (SVG works fine).
 * Text uses relative coordinates so output is resolution-independent.
 *
 * Vectors may be upscaled to `maxDim`; raster images are only ever downscaled
 * so a small bitmap does not turn into a blurry, oversized canvas.
 */
export function renderMeme(
  template: TemplateData,
  submission: CaptionSubmission,
  image: HTMLImageElement,
  maxDim = 640,
): HTMLCanvasElement {
  const layout = memeLayoutForImage(template, submission, image, maxDim)
  const W = layout.width
  const H = layout.height

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  // Opaque white bars only; the template area itself keeps its own pixels.
  if (layout.padTop > 0 || layout.padBottom > 0) {
    ctx.fillStyle = '#ffffff'
    if (layout.padTop > 0) ctx.fillRect(0, 0, W, layout.padTop)
    if (layout.padBottom > 0) ctx.fillRect(0, layout.padTop + layout.imageHeight, W, layout.padBottom)
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, layout.padTop, layout.imageWidth, layout.imageHeight)

  // Text coordinates and font sizes are relative to the whole canvas,
  // including the bars, matching the editor stage.
  drawMemeText(ctx, template, submission, W, H)
  return canvas
}

function drawTextItem(ctx: CanvasRenderingContext2D, item: RenderTextItem, W: number, H: number) {
  const fontSize = Math.max(4, item.fontSize * H)
  const maxWidth = Math.max(10, item.w * W)
  const cx = item.x * W
  const cy = item.y * H
  ctx.font = memeCanvasFont(item.font, fontSize)
  const lines = wrapMemeText(ctx, item.text, item.font, fontSize, maxWidth)

  ctx.save()
  ctx.translate(cx, cy)
  if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180)

  const lineHeight = fontSize * 1.05
  const totalHeight = lines.length * lineHeight
  const strokeW = Math.max(1, fontSize * 0.09)
  ctx.font = memeCanvasFont(item.font, fontSize)
  ctx.textAlign = item.align
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.lineWidth = strokeW
  ctx.strokeStyle = item.stroke
  ctx.fillStyle = item.color

  const x = item.align === 'left' ? -maxWidth / 2 : item.align === 'right' ? maxWidth / 2 : 0

  // Opaque white block behind all lines, spanning the full block width. Drawn
  // in the rotated coordinate system, so align and rotation match the editor.
  if (item.whiteBackground) {
    const padY = fontSize * MEME_TEXT_BOX_PAD_RATIO
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(-maxWidth / 2, -totalHeight / 2 - padY, maxWidth, totalHeight + padY * 2)
    ctx.fillStyle = item.color
  }

  for (let i = 0; i < lines.length; i++) {
    const y = -totalHeight / 2 + lineHeight / 2 + i * lineHeight
    ctx.strokeText(lines[i], x, y)
    ctx.fillText(lines[i], x, y)
  }
  ctx.restore()
}

/**
 * Greedy word wrap that mirrors CSS `pre-line` + `overflow-wrap: anywhere`:
 * newlines are hard breaks, runs of spaces collapse, and a word that is wider
 * than the block is broken character by character.
 */
export function wrapMemeText(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  fontSize: number,
  maxWidth: number,
): string[] {
  ctx.font = memeCanvasFont(font, fontSize)
  const lines: string[] = []
  const logicalLines = text.replace(/\r\n?/g, '\n').split('\n')

  for (const raw of logicalLines) {
    // Same whitespace handling as CSS white-space: pre-line (ASCII spaces/tabs
    // collapse; non-breaking spaces stay intact, unlike String.trim()).
    const normalized = raw.replace(/[ \t\f\v]+/g, ' ').replace(/^ +| +$/g, '')
    if (!normalized) {
      lines.push('')
      continue
    }

    let current = ''
    for (const word of normalized.split(' ')) {
      const attempt = current ? `${current} ${word}` : word
      if (ctx.measureText(attempt).width <= maxWidth) {
        current = attempt
        continue
      }
      if (current) {
        lines.push(current)
        current = ''
      }
      if (ctx.measureText(word).width <= maxWidth) {
        current = word
        continue
      }
      // Very long word: fill the current line character by character.
      let chunk = ''
      for (const ch of word) {
        const next = chunk + ch
        if (chunk && ctx.measureText(next).width > maxWidth) {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk = next
        }
      }
      current = chunk
    }
    if (current) lines.push(current)
  }

  return lines.length ? lines : ['']
}

/** Bounds for the long edge of a full-size PNG export. */
const DOWNLOAD_MIN_DIM = 2048
const DOWNLOAD_MAX_DIM = 4096

/**
 * Long-edge target for a full-size PNG export.
 *
 * Missing intrinsic dimensions (an SVG without width/height, a placeholder
 * size, a failed decode) fall back to the minimum so vectors still get a
 * crisp canvas. Raster images keep their natural size because `renderMeme`
 * never upscales them; only the 4096 cap makes very large photos smaller.
 */
export function downloadTargetSize(naturalWidth: number, naturalHeight: number): number {
  const w = Number.isFinite(naturalWidth) ? Math.max(0, naturalWidth) : 0
  const h = Number.isFinite(naturalHeight) ? Math.max(0, naturalHeight) : 0
  const natural = Math.max(w, h)
  return Math.min(DOWNLOAD_MAX_DIM, Math.max(DOWNLOAD_MIN_DIM, natural))
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

/**
 * Render a meme to a PNG blob. Without an explicit `maxDim` the export uses the
 * image's natural resolution, bounded to a sane PNG size. Returns null on any
 * failure (image, canvas or missing DOM).
 */
export async function renderMemePngBlob(
  template: TemplateData,
  submission: CaptionSubmission,
  maxDim?: number,
): Promise<Blob | null> {
  try {
    if (typeof document === 'undefined') return null

    await ensureMemeFontsReady()
    const image = await loadImage(imageUrl(template.imageKey))
    const target = maxDim ?? downloadTargetSize(image.naturalWidth, image.naturalHeight)
    const canvas = renderMeme(template, submission, image, target)
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  }
}

/** Offer an existing blob as a browser download. */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const safeName = filename.trim() || 'download'
  anchor.href = objectUrl
  anchor.download = safeName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Give the browser a moment to start the download before releasing the blob.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500)
}

/**
 * Render the meme at download resolution and trigger a browser download.
 * Returns false on any failure (image, canvas, blob or missing DOM).
 */
export async function downloadMemePng(
  template: TemplateData,
  submission: CaptionSubmission,
  filename: string,
): Promise<boolean> {
  try {
    const blob = await renderMemePngBlob(template, submission)
    if (!blob) return false
    const safeName = filename.trim() || 'meme'
    downloadBlob(blob, /\.png$/i.test(safeName) ? safeName : `${safeName}.png`)
    return true
  } catch {
    return false
  }
}
