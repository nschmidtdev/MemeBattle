import { describe, expect, it } from 'vitest'
import {
  MAX_TEMPLATE_BOXES,
  filterValidTemplateBoxes,
  sanitizeTemplateBoxes,
  validateTemplateBoxes,
} from '../../src/lib/templateValidation'
import { LINE_BOUNDS } from '../../src/lib/types'

function validBox(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'top',
    x: 0.5,
    y: 0.25,
    w: 0.8,
    fontSize: 0.06,
    color: '#ffffff',
    stroke: '#000000',
    font: 'Impact',
    align: 'center',
    ...overrides,
  }
}

describe('validateTemplateBoxes', () => {
  it('accepts a valid box and applies the rotation default', () => {
    const result = validateTemplateBoxes([validBox()])

    expect(result.error).toBeNull()
    expect(result.boxes).toEqual([
      {
        id: 'top',
        x: 0.5,
        y: 0.25,
        w: 0.8,
        fontSize: 0.06,
        color: '#ffffff',
        stroke: '#000000',
        font: 'Impact',
        align: 'center',
        rotation: 0,
      },
    ])
  })

  it('trims id and font and keeps optional rotation/defaultText', () => {
    const result = validateTemplateBoxes([
      validBox({ id: '  top  ', font: '  Impact  ', rotation: -12, defaultText: 'hello' }),
    ])

    expect(result.error).toBeNull()
    expect(result.boxes?.[0].id).toBe('top')
    expect(result.boxes?.[0].font).toBe('Impact')
    expect(result.boxes?.[0].rotation).toBe(-12)
    expect(result.boxes?.[0].defaultText).toBe('hello')
  })

  it('accepts an empty array', () => {
    expect(validateTemplateBoxes([])).toEqual({ boxes: [], error: null })
  })

  it('rejects non-array input', () => {
    for (const raw of [null, undefined, {}, 'boxes', 42]) {
      const result = validateTemplateBoxes(raw)
      expect(result.boxes).toBeNull()
      expect(result.error).toBe('boxes must be an array')
    }
  })

  it('rejects a duplicate id', () => {
    const result = validateTemplateBoxes([validBox({ id: 'same' }), validBox({ id: 'same' })])

    expect(result.boxes).toBeNull()
    expect(result.error).toContain('boxes[1]')
    expect(result.error).toContain('duplicate id "same"')
  })

  it('rejects a missing/blank/too-long id', () => {
    expect(validateTemplateBoxes([validBox({ id: '' })]).error).toContain('id is required')
    expect(validateTemplateBoxes([validBox({ id: '   ' })]).error).toContain('id is required')
    expect(validateTemplateBoxes([validBox({ id: 42 })]).error).toContain('id is required')
    expect(validateTemplateBoxes([validBox({ id: 'x'.repeat(33) })]).error).toContain('at most 32')
  })

  it('rejects x/y outside LINE_BOUNDS', () => {
    expect(validateTemplateBoxes([validBox({ x: LINE_BOUNDS.xMin - 0.001 })]).error).toContain('x must be')
    expect(validateTemplateBoxes([validBox({ x: LINE_BOUNDS.xMax + 0.001 })]).error).toContain('x must be')
    expect(validateTemplateBoxes([validBox({ y: LINE_BOUNDS.yMin - 0.001 })]).error).toContain('y must be')
    expect(validateTemplateBoxes([validBox({ y: LINE_BOUNDS.yMax + 0.001 })]).error).toContain('y must be')
  })

  it('accepts the exact x/y bounds', () => {
    const box = validBox({ x: LINE_BOUNDS.xMin, y: LINE_BOUNDS.yMax })
    expect(validateTemplateBoxes([box]).error).toBeNull()
    expect(validateTemplateBoxes([validBox({ x: LINE_BOUNDS.xMax, y: LINE_BOUNDS.yMin })]).error).toBeNull()
  })

  it('rejects non-finite x/y', () => {
    expect(validateTemplateBoxes([validBox({ x: Number.NaN })]).error).toContain('x must be')
    expect(validateTemplateBoxes([validBox({ y: Number.POSITIVE_INFINITY })]).error).toContain('y must be')
  })

  it('rejects w outside 0..1', () => {
    expect(validateTemplateBoxes([validBox({ w: -0.01 })]).error).toContain('w must be')
    expect(validateTemplateBoxes([validBox({ w: 1.01 })]).error).toContain('w must be')
  })

  it('rejects fontSize outside LINE_BOUNDS', () => {
    expect(validateTemplateBoxes([validBox({ fontSize: LINE_BOUNDS.fontSizeMin - 0.001 })]).error).toContain(
      'fontSize must be',
    )
    expect(validateTemplateBoxes([validBox({ fontSize: LINE_BOUNDS.fontSizeMax + 0.001 })]).error).toContain(
      'fontSize must be',
    )
  })

  it('accepts the exact fontSize bounds', () => {
    expect(validateTemplateBoxes([validBox({ fontSize: LINE_BOUNDS.fontSizeMin })]).error).toBeNull()
    expect(validateTemplateBoxes([validBox({ fontSize: LINE_BOUNDS.fontSizeMax })]).error).toBeNull()
  })

  it('rejects invalid hex colours', () => {
    for (const color of ['red', '#12', '#12345', '#gggggg', 'ffffff', '#ffff', 123]) {
      const result = validateTemplateBoxes([validBox({ color })])
      expect(result.boxes).toBeNull()
      expect(result.error).toContain('color must be a hex colour')
    }
  })

  it('rejects an invalid stroke colour', () => {
    const result = validateTemplateBoxes([validBox({ stroke: 'black' })])
    expect(result.boxes).toBeNull()
    expect(result.error).toContain('stroke must be a hex colour')
  })

  it('accepts 3, 6 and 8 digit hex colours', () => {
    for (const color of ['#fff', '#ffffff', '#ffffff80']) {
      expect(validateTemplateBoxes([validBox({ color })]).error).toBeNull()
    }
  })

  it('rejects invalid align values', () => {
    for (const align of ['middle', 'LEFT', '', null, 1]) {
      const result = validateTemplateBoxes([validBox({ align })])
      expect(result.boxes).toBeNull()
      expect(result.error).toContain('align must be one of')
    }
  })

  it('accepts every valid align value', () => {
    for (const align of ['left', 'center', 'right']) {
      expect(validateTemplateBoxes([validBox({ align })]).error).toBeNull()
    }
  })

  it('rejects a missing or too-long font', () => {
    expect(validateTemplateBoxes([validBox({ font: '' })]).error).toContain('font is required')
    expect(validateTemplateBoxes([validBox({ font: '   ' })]).error).toContain('font is required')
    expect(validateTemplateBoxes([validBox({ font: 'x'.repeat(41) })]).error).toContain('at most 40')
  })

  it('rejects rotation outside -90..90', () => {
    expect(validateTemplateBoxes([validBox({ rotation: -90.1 })]).error).toContain('rotation must be')
    expect(validateTemplateBoxes([validBox({ rotation: 90.1 })]).error).toContain('rotation must be')
    expect(validateTemplateBoxes([validBox({ rotation: '45' })]).error).toContain('rotation must be')
  })

  it('accepts the exact rotation bounds', () => {
    expect(validateTemplateBoxes([validBox({ rotation: -90 })]).error).toBeNull()
    expect(validateTemplateBoxes([validBox({ rotation: 90 })]).error).toBeNull()
  })

  it('enforces the defaultText limit', () => {
    expect(validateTemplateBoxes([validBox({ defaultText: 'x'.repeat(200) })]).error).toBeNull()
    expect(validateTemplateBoxes([validBox({ defaultText: '' })]).boxes?.[0].defaultText).toBe('')
    expect(validateTemplateBoxes([validBox({ defaultText: 'x'.repeat(201) })]).error).toContain(
      'defaultText must be a string of at most 200',
    )
    expect(validateTemplateBoxes([validBox({ defaultText: 42 })]).error).toContain('defaultText must be a string')
  })

  it(`accepts ${MAX_TEMPLATE_BOXES} boxes and rejects one more`, () => {
    const boxes = Array.from({ length: MAX_TEMPLATE_BOXES }, (_, i) => validBox({ id: `box-${i}` }))
    expect(validateTemplateBoxes(boxes).error).toBeNull()

    const tooMany = [...boxes, validBox({ id: 'one-too-many' })]
    const result = validateTemplateBoxes(tooMany)
    expect(result.boxes).toBeNull()
    expect(result.error).toBe(`boxes must contain at most ${MAX_TEMPLATE_BOXES} entries`)
  })

  it('reports the index of the broken box', () => {
    const result = validateTemplateBoxes([validBox({ id: 'a' }), validBox({ id: 'b', color: 'nope' })])
    expect(result.error).toContain('boxes[1]')
  })
})

describe('sanitizeTemplateBoxes', () => {
  it('returns the parsed boxes for valid input', () => {
    const boxes = sanitizeTemplateBoxes([validBox({ id: ' a ' })])
    expect(boxes).not.toBeNull()
    expect(boxes?.[0].id).toBe('a')
  })

  it('returns null for invalid input', () => {
    expect(sanitizeTemplateBoxes([validBox({ align: 'nope' })])).toBeNull()
    expect(sanitizeTemplateBoxes('not-an-array')).toBeNull()
  })
})

describe('filterValidTemplateBoxes', () => {
  it('returns [] for non-array input', () => {
    expect(filterValidTemplateBoxes(null)).toEqual([])
    expect(filterValidTemplateBoxes({ length: 1 })).toEqual([])
    expect(filterValidTemplateBoxes('boxes')).toEqual([])
  })

  it('drops invalid entries but keeps valid ones', () => {
    const raw = [
      validBox({ id: 'keep-1' }),
      null,
      validBox({ id: 'bad-color', color: 'red' }),
      validBox({ id: 'keep-2' }),
      'nope',
      validBox({ id: 'bad-x', x: 5 }),
    ]

    const boxes = filterValidTemplateBoxes(raw)

    expect(boxes.map((b) => b.id)).toEqual(['keep-1', 'keep-2'])
  })

  it('drops later duplicate ids', () => {
    const boxes = filterValidTemplateBoxes([
      validBox({ id: 'dup', rotation: 0 }),
      validBox({ id: 'dup', rotation: 10 }),
    ])

    expect(boxes).toHaveLength(1)
    expect(boxes[0].rotation).toBe(0)
  })

  it(`caps the result at ${MAX_TEMPLATE_BOXES} entries`, () => {
    const raw = Array.from({ length: MAX_TEMPLATE_BOXES + 5 }, (_, i) => validBox({ id: `box-${i}` }))

    const boxes = filterValidTemplateBoxes(raw)

    expect(boxes).toHaveLength(MAX_TEMPLATE_BOXES)
    expect(boxes[0].id).toBe('box-0')
    expect(boxes[MAX_TEMPLATE_BOXES - 1].id).toBe(`box-${MAX_TEMPLATE_BOXES - 1}`)
  })

  it('fills the cap with later valid boxes even when earlier entries were invalid', () => {
    const raw = [
      ...Array.from({ length: 12 }, () => null),
      ...Array.from({ length: 3 }, (_, i) => validBox({ id: `box-${i}` })),
    ]

    expect(filterValidTemplateBoxes(raw)).toHaveLength(3)
  })
})
