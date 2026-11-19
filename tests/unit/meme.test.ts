import { describe, expect, it } from 'vitest'
import { buildTextItems } from '../../src/lib/meme'
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
})
