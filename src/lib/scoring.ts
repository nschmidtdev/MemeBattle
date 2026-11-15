import type { VoteTally } from './types'

/**
 * Score on a comparable -1000..+1000 scale:
 * all upvotes => +1000, all downvotes => -1000, no votes => 0.
 * "meh" votes don't count.
 */
export function computeScore(tally: VoteTally): number {
  const total = tally.up + tally.down
  if (total === 0) return 0
  return Math.round((1000 * (tally.up - tally.down)) / total)
}
