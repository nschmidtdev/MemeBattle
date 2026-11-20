/**
 * Caption ("creation") time slider stops.
 *
 * Small values stay fine-grained: 5s..2min in 5-second steps. Above two minutes
 * the slider jumps in 30-second blocks up to 10 minutes. The same stops are used
 * by the server to normalise client input, so the UI and the rules never diverge.
 */
export const MIN_CAPTION_TIME = 5
export const CAPTION_TIME_SMALL_STEP = 5
export const CAPTION_TIME_SWITCH = 120
export const CAPTION_TIME_LARGE_STEP = 30
export const MAX_CAPTION_TIME = 600
export const DEFAULT_CAPTION_TIME = 45

function buildCaptionTimeValues(): number[] {
  const values: number[] = []
  for (let s = MIN_CAPTION_TIME; s <= CAPTION_TIME_SWITCH; s += CAPTION_TIME_SMALL_STEP) {
    values.push(s)
  }
  for (let s = CAPTION_TIME_SWITCH + CAPTION_TIME_LARGE_STEP; s <= MAX_CAPTION_TIME; s += CAPTION_TIME_LARGE_STEP) {
    values.push(s)
  }
  return values
}

/** Every selectable caption time, ascending (40 stops: 5s..2m, then 2m30s..10m). */
export const CAPTION_TIME_VALUES: readonly number[] = buildCaptionTimeValues()

/** Clamp any input to the allowed range and snap it to the nearest slider stop. */
export function snapCaptionTime(raw: unknown): number {
  const numeric =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN
  const n = Number.isFinite(numeric) ? Math.floor(numeric) : DEFAULT_CAPTION_TIME
  const clamped = Math.min(MAX_CAPTION_TIME, Math.max(MIN_CAPTION_TIME, n))
  let best = CAPTION_TIME_VALUES[0]
  for (const value of CAPTION_TIME_VALUES) {
    if (Math.abs(value - clamped) < Math.abs(best - clamped)) best = value
  }
  return best
}

/** Slider position (0..n-1) for a caption time. */
export function captionTimeToIndex(value: number): number {
  const index = CAPTION_TIME_VALUES.indexOf(snapCaptionTime(value))
  return index < 0 ? 0 : index
}

/** Caption time for a slider position. */
export function captionTimeFromIndex(index: number): number {
  const i = Math.min(CAPTION_TIME_VALUES.length - 1, Math.max(0, Math.round(index)))
  return CAPTION_TIME_VALUES[i]
}
