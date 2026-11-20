import type { VoteTally } from './types'

/** Points a meme gains for every Meme Buddy it receives. */
export const MEME_BUDDY_POINTS = 10

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

/** One player's Meme Buddy choice; `index` points into the round's memes. */
export interface BuddyPickInput {
  playerId: string
  index: number
}

/**
 * Apply the Meme Buddy rule to one round:
 * every valid pick adds MEME_BUDDY_POINTS to that meme, and the picker earns
 * half of the meme's final score (rounded, may be negative).
 * Invalid meme indices are ignored; the server already enforces one pick per player.
 */
export function computeBuddyOutcome(
  voteScores: number[],
  picks: BuddyPickInput[],
): {
  memeScores: number[]
  memeBuddyCounts: number[]
  pickerBonuses: Record<string, number>
} {
  const memeBuddyCounts = voteScores.map(() => 0)
  const validPicks: BuddyPickInput[] = []
  for (const pick of picks) {
    if (!Number.isInteger(pick.index) || pick.index < 0 || pick.index >= voteScores.length) continue
    memeBuddyCounts[pick.index]++
    validPicks.push(pick)
  }
  // Bonuses are based on the final meme score, buddies included.
  const memeScores = voteScores.map(
    (score, index) => score + MEME_BUDDY_POINTS * memeBuddyCounts[index],
  )
  const pickerBonuses: Record<string, number> = {}
  for (const pick of validPicks) {
    pickerBonuses[pick.playerId] = Math.round(memeScores[pick.index] / 2)
  }
  return { memeScores, memeBuddyCounts, pickerBonuses }
}
