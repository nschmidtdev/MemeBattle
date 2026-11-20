import { describe, expect, it } from 'vitest'
import { formatDuration } from '../../src/lib/format'

describe('formatDuration', () => {
  it('shows seconds below one minute', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(1)).toBe('1s')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(59)).toBe('59s')
  })

  it('switches to minutes at exactly 60 seconds', () => {
    expect(formatDuration(60)).toBe('1m')
    expect(formatDuration(120)).toBe('2m')
  })

  it('keeps the second remainder from one minute on', () => {
    expect(formatDuration(61)).toBe('1m 1s')
    expect(formatDuration(85)).toBe('1m 25s')
    expect(formatDuration(125)).toBe('2m 5s')
  })

  it('rounds fractional seconds up and clamps invalid values', () => {
    expect(formatDuration(59.1)).toBe('1m')
    expect(formatDuration(60.1)).toBe('1m 1s')
    expect(formatDuration(-5)).toBe('0s')
    expect(formatDuration(Number.NaN)).toBe('0s')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s')
  })
})
