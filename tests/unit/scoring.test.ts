import { describe, expect, it } from 'vitest'
import { computeScore } from '../../src/lib/scoring'
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
