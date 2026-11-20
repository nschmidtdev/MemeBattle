import { describe, expect, it } from 'vitest'
import { MEME_BUDDY_POINTS, computeBuddyOutcome, computeScore } from '../../src/lib/scoring'
import type { VoteTally } from '../../src/lib/types'

function tally(up: number, down: number, meh = 0): VoteTally {
  return { up, down, meh }
}

describe('computeScore', () => {
  it('returns 0 for an empty tally', () => {
    expect(computeScore(tally(0, 0))).toBe(0)
  })

  it('ignores "meh" votes when nothing else was voted', () => {
    expect(computeScore(tally(0, 0, 7))).toBe(0)
  })

  it('returns +1000 when every counted vote is an upvote', () => {
    expect(computeScore(tally(1, 0))).toBe(1000)
    expect(computeScore(tally(42, 0, 3))).toBe(1000)
  })

  it('returns -1000 when every counted vote is a downvote', () => {
    expect(computeScore(tally(0, 1))).toBe(-1000)
    expect(computeScore(tally(0, 42, 3))).toBe(-1000)
  })

  it('returns 0 when upvotes and downvotes cancel exactly', () => {
    expect(computeScore(tally(1, 1))).toBe(0)
    expect(computeScore(tally(25, 25, 9))).toBe(0)
  })

  it('ignores meh votes in a mixed tally', () => {
    expect(computeScore(tally(3, 1, 100))).toBe(500)
  })

  it('rounds the score to the nearest integer', () => {
    // 1000 * (2 - 1) / 3 = 333.33...
    expect(computeScore(tally(2, 1))).toBe(333)
    // 1000 * (1 - 2) / 3 = -333.33...
    expect(computeScore(tally(1, 2))).toBe(-333)
    // 1000 * (3 - 2) / 5 = 200
    expect(computeScore(tally(3, 2))).toBe(200)
    // 1000 * (1 - 3) / 4 = -500
    expect(computeScore(tally(1, 3))).toBe(-500)
  })

  it('rounds halves with Math.round (toward +Infinity)', () => {
    // 1000 * (17 - 15) / 32 = 62.5 -> 63
    expect(computeScore(tally(17, 15))).toBe(63)
    // 1000 * (15 - 17) / 32 = -62.5 -> -62
    expect(computeScore(tally(15, 17))).toBe(-62)
  })

  it('never leaves the -1000..+1000 range for non-negative tallies', () => {
    for (let up = 0; up <= 20; up += 1) {
      for (let down = 0; down <= 20; down += 1) {
        const score = computeScore(tally(up, down, 5))
        expect(score).toBeGreaterThanOrEqual(-1000)
        expect(score).toBeLessThanOrEqual(1000)
      }
    }
  })
})

describe('computeBuddyOutcome', () => {
  it('exposes the Meme Buddy points as 10', () => {
    expect(MEME_BUDDY_POINTS).toBe(10)
  })

  it('leaves every meme unchanged when nobody picked a buddy', () => {
    expect(computeBuddyOutcome([1000, -250, 0], [])).toEqual({
      memeScores: [1000, -250, 0],
      memeBuddyCounts: [0, 0, 0],
      pickerBonuses: {},
    })
  })

  it('adds 10 to the meme and gives the picker half of its final score', () => {
    const outcome = computeBuddyOutcome([1000, 0], [{ playerId: 'alice', index: 0 }])

    expect(outcome.memeScores).toEqual([1010, 0])
    expect(outcome.memeBuddyCounts).toEqual([1, 0])
    expect(outcome.pickerBonuses).toEqual({ alice: 505 })
  })

  it('keeps negative picker bonuses negative', () => {
    // -1020 + 10 = -1010; half of that is -505.
    const outcome = computeBuddyOutcome([-1020], [{ playerId: 'bob', index: 0 }])

    expect(outcome.memeScores).toEqual([-1010])
    expect(outcome.memeBuddyCounts).toEqual([1])
    expect(outcome.pickerBonuses).toEqual({ bob: -505 })
  })

  it('adds 10 per buddy to a meme with multiple buddies', () => {
    const outcome = computeBuddyOutcome(
      [0, 200],
      [
        { playerId: 'alice', index: 0 },
        { playerId: 'bob', index: 0 },
      ],
    )

    expect(outcome.memeScores).toEqual([20, 200])
    expect(outcome.memeBuddyCounts).toEqual([2, 0])
    expect(outcome.pickerBonuses).toEqual({ alice: 10, bob: 10 })
  })

  it('rounds bonuses with Math.round', () => {
    // 5 + 10 = 15 -> 7.5 -> 8; -25 + 10 = -15 -> -7.5 -> -7.
    const outcome = computeBuddyOutcome(
      [5, -25],
      [
        { playerId: 'alice', index: 0 },
        { playerId: 'bob', index: 1 },
      ],
    )

    expect(outcome.memeScores).toEqual([15, -15])
    expect(outcome.pickerBonuses).toEqual({ alice: 8, bob: -7 })
  })

  it('ignores invalid meme indices but applies valid picks', () => {
    const outcome = computeBuddyOutcome(
      [100, 200],
      [
        { playerId: 'negative', index: -1 },
        { playerId: 'tooHigh', index: 2 },
        { playerId: 'fractional', index: 1.5 },
        { playerId: 'valid', index: 1 },
      ],
    )

    expect(outcome.memeScores).toEqual([100, 210])
    expect(outcome.memeBuddyCounts).toEqual([0, 1])
    expect(outcome.pickerBonuses).toEqual({ valid: 105 })
  })

  it('turns a vote-less meme into a 10 point meme with a 5 point bonus', () => {
    const outcome = computeBuddyOutcome([0], [{ playerId: 'alice', index: 0 }])

    expect(outcome.memeScores).toEqual([10])
    expect(outcome.memeBuddyCounts).toEqual([1])
    expect(outcome.pickerBonuses).toEqual({ alice: 5 })
  })
})
