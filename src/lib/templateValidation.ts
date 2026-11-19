import { LINE_BOUNDS, MAX_ID_LENGTH, MAX_TEMPLATE_BOXES, ROTATION_BOUNDS } from './types'
import type { TemplateBox, TextAlign } from './types'

// Placement limits for text lines/boxes live in `types.ts` so client editors,
// the server and this API validator all agree on the same ranges.
export { LINE_BOUNDS, MAX_TEMPLATE_BOXES }

/** Stored templates may predate the editors' narrower 0.1 minimum. */
const WIDTH_BOUNDS = { min: 0, max: 1 } as const

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const MAX_FONT_LENGTH = 40
const MAX_DEFAULT_TEXT_LENGTH = 200

const ALIGNS: ReadonlySet<string> = new Set<TextAlign>(['left', 'center', 'right'])

export interface TemplateBoxValidation {
  boxes: TemplateBox[] | null
  error: string | null
}

interface ParsedBox {
  box: TemplateBox | null
  error: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

/**
 * Validate and normalise one box. `seenIds` is mutated only when the box is
 * valid, so a broken entry does not poison an otherwise usable id.
 */
function parseBox(raw: unknown, seenIds: Set<string>): ParsedBox {
  if (!isRecord(raw)) return { box: null, error: 'must be an object' }

  const rawId = raw.id
  const id = typeof rawId === 'string' ? rawId.trim() : ''
  if (!id) return { box: null, error: 'id is required' }
  if (id.length > MAX_ID_LENGTH) return { box: null, error: `id must be at most ${MAX_ID_LENGTH} characters` }
  if (seenIds.has(id)) return { box: null, error: `duplicate id "${id}"` }

  const { x, y, w, fontSize } = raw
  if (!isNumberInRange(x, LINE_BOUNDS.xMin, LINE_BOUNDS.xMax)) {
    return { box: null, error: `x must be a finite number between ${LINE_BOUNDS.xMin} and ${LINE_BOUNDS.xMax}` }
  }
  if (!isNumberInRange(y, LINE_BOUNDS.yMin, LINE_BOUNDS.yMax)) {
    return { box: null, error: `y must be a finite number between ${LINE_BOUNDS.yMin} and ${LINE_BOUNDS.yMax}` }
  }
  if (!isNumberInRange(w, WIDTH_BOUNDS.min, WIDTH_BOUNDS.max)) {
    return { box: null, error: 'w must be a finite number between 0 and 1' }
  }
  if (!isNumberInRange(fontSize, LINE_BOUNDS.fontSizeMin, LINE_BOUNDS.fontSizeMax)) {
    return {
      box: null,
      error: `fontSize must be a finite number between ${LINE_BOUNDS.fontSizeMin} and ${LINE_BOUNDS.fontSizeMax}`,
    }
  }

  const { color, stroke } = raw
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
    return { box: null, error: 'color must be a hex colour (e.g. #ffffff)' }
  }
  if (typeof stroke !== 'string' || !HEX_COLOR.test(stroke)) {
    return { box: null, error: 'stroke must be a hex colour (e.g. #000000)' }
  }

  const rawFont = raw.font
  const font = typeof rawFont === 'string' ? rawFont.trim() : ''
  if (!font) return { box: null, error: 'font is required' }
  if (font.length > MAX_FONT_LENGTH) {
    return { box: null, error: `font must be at most ${MAX_FONT_LENGTH} characters` }
  }

  const { align } = raw
  if (typeof align !== 'string' || !ALIGNS.has(align)) {
    return { box: null, error: 'align must be one of left, center, right' }
  }

  const rotation = raw.rotation === undefined ? 0 : raw.rotation
  if (!isNumberInRange(rotation, ROTATION_BOUNDS.min, ROTATION_BOUNDS.max)) {
    return {
      box: null,
      error: `rotation must be a finite number between ${ROTATION_BOUNDS.min} and ${ROTATION_BOUNDS.max}`,
    }
  }

  let defaultText: string | undefined
  if (raw.defaultText !== undefined) {
    if (typeof raw.defaultText !== 'string' || raw.defaultText.length > MAX_DEFAULT_TEXT_LENGTH) {
      return {
        box: null,
        error: `defaultText must be a string of at most ${MAX_DEFAULT_TEXT_LENGTH} characters`,
      }
    }
    defaultText = raw.defaultText
  }

  const box: TemplateBox = {
    id,
    x,
    y,
    w,
    fontSize,
    color,
    stroke,
    font,
    align: align as TextAlign,
    rotation,
  }
  if (defaultText !== undefined) box.defaultText = defaultText

  seenIds.add(id)
  return { box, error: '' }
}

/**
 * Strict validation for API input. Returns `null` when anything is wrong so
 * callers can answer 400; use `validateTemplateBoxes` when the concrete field
 * error is useful in the response.
 */
export function sanitizeTemplateBoxes(raw: unknown): TemplateBox[] | null {
  return validateTemplateBoxes(raw).boxes
}

/** Strict validation with a field-level message for API responses. */
export function validateTemplateBoxes(raw: unknown): TemplateBoxValidation {
  if (!Array.isArray(raw)) return { boxes: null, error: 'boxes must be an array' }
  if (raw.length > MAX_TEMPLATE_BOXES) {
    return { boxes: null, error: `boxes must contain at most ${MAX_TEMPLATE_BOXES} entries` }
  }

  const seenIds = new Set<string>()
  const boxes: TemplateBox[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const parsed = parseBox(raw[i], seenIds)
    if (!parsed.box) return { boxes: null, error: `boxes[${i}]: ${parsed.error}` }
    boxes.push(parsed.box)
  }
  return { boxes, error: null }
}

/**
 * Lenient variant for data read from the database: invalid entries are
 * dropped instead of failing the whole template, and the result is always an
 * array (never `null`).
 */
export function filterValidTemplateBoxes(raw: unknown): TemplateBox[] {
  if (!Array.isArray(raw)) return []

  const seenIds = new Set<string>()
  const boxes: TemplateBox[] = []
  for (const item of raw) {
    if (boxes.length >= MAX_TEMPLATE_BOXES) break
    const parsed = parseBox(item, seenIds)
    if (parsed.box) boxes.push(parsed.box)
  }
  return boxes
}
