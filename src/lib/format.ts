/**
 * Human-readable duration for sliders and the in-game timer.
 * Under a minute: "45s". From a minute on: "1m", "1m 25s", "2m".
 * Values are rounded up to whole seconds so a countdown never shows 0 too early.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(Number.isFinite(totalSeconds) ? totalSeconds : 0))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}
