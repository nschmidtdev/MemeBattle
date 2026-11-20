import { describe, expect, it } from 'vitest'
import {
  CAPTION_TIME_VALUES,
  captionTimeFromIndex,
  captionTimeToIndex,
  snapCaptionTime,
} from '../../src/lib/timing'

describe('caption time slider stops', () => {
  it('uses 5s steps up to 2 minutes and 30s steps up to 10 minutes', () => {
    expect(CAPTION_TIME_VALUES.length).toBe(40)
    expect(CAPTION_TIME_VALUES.slice(0, 4)).toEqual([5, 10, 15, 20])
    expect(CAPTION_TIME_VALUES).toContain(120)
    expect(CAPTION_TIME_VALUES).toContain(150)
    expect(CAPTION_TIME_VALUES).not.toContain(135)
    expect(CAPTION_TIME_VALUES[CAPTION_TIME_VALUES.length - 1]).toBe(600)
  })

  it('snaps arbitrary values to the nearest allowed stop', () => {
    expect(snapCaptionTime(45)).toBe(45)
    expect(snapCaptionTime(137)).toBe(150)
    expect(snapCaptionTime(121)).toBe(120)
    expect(snapCaptionTime(4)).toBe(5)
    expect(snapCaptionTime(999)).toBe(600)
    expect(snapCaptionTime('30')).toBe(30)
    expect(snapCaptionTime('garbage')).toBe(45)
  })

  it('maps slider indices to seconds and back', () => {
    expect(captionTimeFromIndex(0)).toBe(5)
    expect(captionTimeFromIndex(-1)).toBe(5)
    expect(captionTimeFromIndex(9999)).toBe(600)
    expect(captionTimeFromIndex(captionTimeToIndex(45))).toBe(45)
    expect(captionTimeFromIndex(captionTimeToIndex(137))).toBe(150)
    expect(captionTimeFromIndex(captionTimeToIndex(600))).toBe(600)
  })
})
