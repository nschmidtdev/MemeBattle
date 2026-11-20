import { describe, expect, it } from 'vitest'
import {
  MEME_PAD_RATIO,
  buildTextItems,
  downloadTargetSize,
  isLightTextColor,
  memeCanvasLayout,
  normalizeMemePadding,
} from '../../src/lib/meme'
import type { CaptionSubmission, FreeformLine, TemplateBox, TemplateData } from '../../src/lib/types'

function box(overrides: Partial<TemplateBox> = {}): TemplateBox {
  return {
    id: 'box-1',
    x: 0.5,
    y: 0.25,
    w: 0.8,
    fontSize: 0.06,
    color: '#ffffff',
    stroke: '#000000',
    font: 'Impact',
    align: 'center',
    rotation: 0,
    ...overrides,
  }
}

function line(overrides: Partial<FreeformLine> = {}): FreeformLine {
  return {
    id: 'line-1',
    text: 'hello',
    x: 0.5,
    y: 0.9,
    w: 0.8,
    fontSize: 0.07,
    color: '#ffffff',
    stroke: '#000000',
    font: 'Impact',
    align: 'center',
    rotation: 0,
    ...overrides,
  }
}

function template(overrides: Partial<TemplateData> = {}): TemplateData {
  return {
    id: 'tpl-1',
    name: 'Test template',
    imageKey: 'public:test.svg',
    isFreeform: false,
    boxes: [],
    ...overrides,
  }
}

function submission(overrides: Partial<CaptionSubmission> = {}): CaptionSubmission {
  return { texts: {}, lines: [], ...overrides }
}

describe('downloadTargetSize', () => {
  it('never goes below 2048 px, so small raster images stay native after rendering', () => {
    // 1600 px long edge: the target is only an upper bound, renderMeme keeps
    // raster images at their natural size instead of upscaling them.
    expect(downloadTargetSize(1600, 1200)).toBe(2048)
    expect(downloadTargetSize(0, 0)).toBe(2048)
    expect(downloadTargetSize(Number.NaN, Number.NaN)).toBe(2048)
  })

  it('keeps the natural long edge for images above the minimum', () => {
    expect(downloadTargetSize(3024, 1890)).toBe(3024)
    expect(downloadTargetSize(1890, 3024)).toBe(3024)
  })

  it('caps very large images at 4096 px to keep the PNG allocation bounded', () => {
    expect(downloadTargetSize(6000, 8000)).toBe(4096)
  })
})

describe('memeCanvasLayout', () => {
  it('keeps the exact old image sizing when no padding is active', () => {
    expect(memeCanvasLayout(800, 600, 640, undefined, true)).toMatchObject({
      imageWidth: 640,
      imageHeight: 480,
      padTop: 0,
      padBottom: 0,
      width: 640,
      height: 480,
    })
    expect(memeCanvasLayout(400, 300, 640, { top: false, bottom: false }, false)).toMatchObject({
      imageWidth: 400,
      imageHeight: 300,
      padTop: 0,
      padBottom: 0,
      width: 400,
      height: 300,
    })
  })

  it('adds one MEME_PAD_RATIO bar per active side, based on the image height', () => {
    const both = memeCanvasLayout(400, 300, 1000, { top: true, bottom: true }, false)

    expect(both).toMatchObject({
      imageWidth: 400,
      imageHeight: 300,
      padTop: Math.round(300 * MEME_PAD_RATIO),
      padBottom: Math.round(300 * MEME_PAD_RATIO),
      width: 400,
      height: 420,
    })

    const topOnly = memeCanvasLayout(400, 300, 1000, { top: true, bottom: false }, false)
    expect(topOnly.padTop).toBe(60)
    expect(topOnly.padBottom).toBe(0)
    expect(topOnly.height).toBe(360)
  })

  it('scales the image so image + bars stay inside the maxDim budget', () => {
    const layout = memeCanvasLayout(1000, 1000, 640, { top: true, bottom: true }, true)

    expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(640)
    expect(layout.height).toBe(layout.imageHeight + layout.padTop + layout.padBottom)
    expect(layout.imageWidth).toBe(layout.imageHeight)

    // Rounding the bars independently must not leak past the budget either.
    const large = memeCanvasLayout(1000, 1000, 2048, { top: true, bottom: true }, true)
    expect(Math.max(large.width, large.height)).toBeLessThanOrEqual(2048)
  })

  it('does not upscale raster images just because bars were added', () => {
    const layout = memeCanvasLayout(200, 100, 640, { top: true, bottom: true }, false)

    expect(layout.scale).toBe(1)
    expect(layout.width).toBe(200)
    expect(layout.height).toBe(140)
  })
})

describe('normalizeMemePadding', () => {
  it('keeps explicit booleans and drops inactive or malformed padding', () => {
    expect(normalizeMemePadding({ top: true, bottom: false })).toEqual({ top: true, bottom: false })
    expect(normalizeMemePadding({ top: true, bottom: true })).toEqual({ top: true, bottom: true })
    expect(normalizeMemePadding({ top: 'yes', bottom: 1 })).toBeUndefined()
    expect(normalizeMemePadding({ top: false, bottom: false })).toBeUndefined()
    expect(normalizeMemePadding(null)).toBeUndefined()
    expect(normalizeMemePadding(undefined)).toBeUndefined()
  })
})

describe('isLightTextColor', () => {
  it('detects white and very light colours, but leaves dark colours alone', () => {
    expect(isLightTextColor('#ffffff')).toBe(true)
    expect(isLightTextColor('#fff')).toBe(true)
    expect(isLightTextColor('white')).toBe(true)
    expect(isLightTextColor('#ffff00')).toBe(true)
    expect(isLightTextColor('#111111')).toBe(false)
    expect(isLightTextColor('#ff0000')).toBe(false)
    expect(isLightTextColor('not-a-colour')).toBe(false)
  })
})

describe('buildTextItems', () => {
  it('prefers placed freeform lines over legacy texts and box defaults', () => {
    const tpl = template({ boxes: [box({ id: 'box-1', defaultText: 'default' })] })
    const sub = submission({
      texts: { 'box-1': 'legacy text' },
      lines: [line({ id: 'line-1', text: 'placed text' })],
    })

    const items = buildTextItems(tpl, sub)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'line-1', text: 'placed text', x: 0.5, y: 0.9 })
  })

  it('uses the legacy boxId -> text mapping for fixed templates', () => {
    const tpl = template({
      boxes: [box({ id: 'top', defaultText: 'fallback top' }), box({ id: 'bottom', defaultText: 'fallback bottom' })],
    })
    const sub = submission({ texts: { top: 'written by player' } })

    const items = buildTextItems(tpl, sub)

    expect(items.map((i) => [i.id, i.text])).toEqual([
      ['top', 'written by player'],
      ['bottom', 'fallback bottom'],
    ])
  })

  it('treats an empty legacy text as empty instead of falling back to defaultText', () => {
    const tpl = template({
      boxes: [box({ id: 'top', defaultText: 'default top' }), box({ id: 'bottom', defaultText: 'default bottom' })],
    })
    const sub = submission({ texts: { top: '' } })

    const items = buildTextItems(tpl, sub)

    // `??` keeps '' -> top is skipped; bottom has no entry -> default is used.
    expect(items.map((i) => i.id)).toEqual(['bottom'])
    expect(items[0].text).toBe('default bottom')
  })

  it('skips boxes whose text and defaultText are empty or whitespace only', () => {
    const tpl = template({
      boxes: [
        box({ id: 'empty', defaultText: '' }),
        box({ id: 'blank', defaultText: '   ' }),
        box({ id: 'spaces', defaultText: '\n\t' }),
        box({ id: 'good', defaultText: 'ok' }),
      ],
    })

    const items = buildTextItems(tpl, submission())

    expect(items.map((i) => i.id)).toEqual(['good'])
  })

  it('returns [] when a freeform submission only has empty lines', () => {
    const tpl = template({ boxes: [box({ defaultText: 'do not use me' })] })
    const sub = submission({
      texts: { 'box-1': 'do not use me either' },
      lines: [line({ text: '' }), line({ id: 'line-2', text: '   ' })],
    })

    expect(buildTextItems(tpl, sub)).toEqual([])
  })

  it('drops whitespace-only lines but keeps the remaining ones in order', () => {
    const sub = submission({
      lines: [line({ id: 'a', text: 'first' }), line({ id: 'b', text: '  ' }), line({ id: 'c', text: 'third' })],
    })

    expect(buildTextItems(template(), sub).map((i) => i.id)).toEqual(['a', 'c'])
  })

  it('does not fall back to box defaults for freeform templates', () => {
    const tpl = template({ isFreeform: true, boxes: [box({ defaultText: 'default' })] })

    expect(buildTextItems(tpl, submission())).toEqual([])
    expect(buildTextItems(tpl, submission({ texts: { 'box-1': 'legacy' } }))).toEqual([])
  })

  it('returns [] when there are no lines, texts or boxes', () => {
    expect(buildTextItems(template(), submission())).toEqual([])
  })

  it('tolerates a missing/undefined lines array', () => {
    const tpl = template({ boxes: [box({ id: 'top', defaultText: 'default' })] })
    const sub = { texts: { top: 'legacy' } } as unknown as CaptionSubmission

    expect(buildTextItems(tpl, sub)).toHaveLength(1)
    expect(buildTextItems(tpl, sub)[0].text).toBe('legacy')
  })

  it('clamps out-of-range line placement and style values', () => {
    const sub = submission({
      lines: [
        line({
          id: 'wild',
          text: 'clamped',
          x: 0,
          y: 1.5,
          w: 0.01,
          fontSize: 0.9,
          rotation: 180,
        }),
      ],
    })

    const [item] = buildTextItems(template({ isFreeform: true }), sub)

    expect(item).toMatchObject({
      id: 'wild',
      x: 0.05,
      y: 0.98,
      w: 0.1,
      fontSize: 0.25,
      rotation: 90,
    })
  })

  it('clamps legacy box placement the same way', () => {
    const tpl = template({
      boxes: [
        box({
          id: 'legacy',
          x: 2,
          y: -1,
          w: 4,
          fontSize: 0,
          rotation: -180,
          defaultText: 'legacy text',
        }),
      ],
    })

    const [item] = buildTextItems(tpl, submission())

    expect(item).toMatchObject({ x: 0.95, y: 0.02, w: 1, fontSize: 0.02, rotation: -90 })
  })

  it('keeps colour, stroke, font and align untouched', () => {
    const sub = submission({
      lines: [line({ color: '#ff0000', stroke: '#00ff00', font: 'Verdana', align: 'left' })],
    })

    const [item] = buildTextItems(template({ isFreeform: true }), sub)

    expect(item).toMatchObject({ color: '#ff0000', stroke: '#00ff00', font: 'Verdana', align: 'left' })
  })

  it('passes whiteBackground through for freeform lines', () => {
    const sub = submission({
      lines: [
        line({ id: 'white', text: 'white box', whiteBackground: true }),
        line({ id: 'plain', text: 'no box', whiteBackground: false }),
        line({ id: 'old', text: 'legacy line' }),
      ],
    })

    const items = buildTextItems(template({ isFreeform: true }), sub)

    expect(items.map((i) => i.whiteBackground)).toEqual([true, false, false])
  })

  it('defaults whiteBackground to false for legacy template boxes', () => {
    const tpl = template({ boxes: [box({ id: 'legacy', defaultText: 'legacy text' })] })

    const [item] = buildTextItems(tpl, submission())

    expect(item.whiteBackground).toBe(false)
  })
})
