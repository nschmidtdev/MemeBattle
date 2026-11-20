import { describe, expect, it } from 'vitest'
import {
  MAX_TEMPLATE_NAME_LENGTH,
  decodeHtmlEntities,
  dedupeSourceItems,
  normalizeImgflip,
  normalizeManifest,
  normalizeMemegen,
  slugify,
  stableTemplateName,
  templateNameKey,
  uniqueTemplateName,
} from '../../src/lib/memeSources'
import type { SourceItem } from '../../src/lib/memeSources'

function item(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    source: 'manifest',
    sourceId: 'one',
    name: 'One',
    imageUrl: 'https://example.test/one.png',
    ...overrides,
  }
}

describe('normalizeImgflip', () => {
  it('maps get_memes entries and decodes HTML entities in names', () => {
    const payload = {
      success: true,
      data: {
        memes: [
          {
            id: '181913649',
            name: 'Tom &amp; Jerry &#39;Special&#39;',
            url: 'https://i.imgflip.com/30b1gx.jpg',
            width: 1200,
            height: 900,
            box_count: 2,
            captions: 1591250,
          },
        ],
      },
    }

    expect(normalizeImgflip(payload)).toEqual([
      {
        source: 'imgflip',
        sourceId: '181913649',
        name: "Tom & Jerry 'Special'",
        imageUrl: 'https://i.imgflip.com/30b1gx.jpg',
        width: 1200,
        height: 900,
        boxCount: 2,
      },
    ])
  })

  it('accepts numeric ids, numeric strings and a zero box count', () => {
    const result = normalizeImgflip({
      data: {
        memes: [
          {
            id: 123,
            name: 'Numeric',
            url: 'https://i.imgflip.com/numeric.png',
            width: '640',
            height: '480',
            box_count: '0',
          },
        ],
      },
    })

    expect(result).toEqual([
      {
        source: 'imgflip',
        sourceId: '123',
        name: 'Numeric',
        imageUrl: 'https://i.imgflip.com/numeric.png',
        width: 640,
        height: 480,
        boxCount: 0,
      },
    ])
  })

  it('skips missing fields, wrong hosts, HTTP, non-image URLs and empty names', () => {
    const broken = [
      null,
      42,
      { id: '1', name: 'No URL' },
      { id: '2', name: 'Wrong host', url: 'https://example.com/meme.jpg' },
      { id: '3', name: 'Plain HTTP', url: 'http://i.imgflip.com/meme.jpg' },
      { id: '4', name: 'SVG', url: 'https://i.imgflip.com/meme.svg' },
      { id: '5', name: '', url: 'https://i.imgflip.com/meme.jpg' },
      { id: '', name: 'No id', url: 'https://i.imgflip.com/meme.jpg' },
      { id: '6', name: 'Valid', url: 'https://i.imgflip.com/6.jpg' },
    ]

    expect(normalizeImgflip({ data: { memes: broken } })).toEqual([
      item({
        source: 'imgflip',
        sourceId: '6',
        name: 'Valid',
        imageUrl: 'https://i.imgflip.com/6.jpg',
      }),
    ])
  })

  it('dedupes by id and by image URL, keeping the first entry', () => {
    const result = normalizeImgflip({
      data: {
        memes: [
          { id: '1', name: 'First', url: 'https://i.imgflip.com/a.jpg' },
          { id: '1', name: 'Same id', url: 'https://i.imgflip.com/b.jpg' },
          { id: '2', name: 'Same URL', url: 'https://i.imgflip.com/a.jpg' },
          { id: '3', name: 'Third', url: 'https://i.imgflip.com/c.jpg' },
        ],
      },
    })

    expect(result.map((entry) => entry.name)).toEqual(['First', 'Third'])
  })

  it('returns an empty list for empty or malformed payloads', () => {
    expect(normalizeImgflip(null)).toEqual([])
    expect(normalizeImgflip([])).toEqual([])
    expect(normalizeImgflip({})).toEqual([])
    expect(normalizeImgflip({ data: null })).toEqual([])
    expect(normalizeImgflip({ data: { memes: 'nope' } })).toEqual([])
    expect(normalizeImgflip({ data: { memes: [42, null] } })).toEqual([])
  })
})

describe('normalizeMemegen', () => {
  it('maps /templates entries, using blank and lines', () => {
    const payload = [
      {
        id: 'aag',
        name: 'Ancient Aliens &amp; Guy',
        blank: 'https://api.memegen.link/images/aag.jpg',
        lines: 2,
        overlays: 0,
        source: 'https://knowyourmeme.com/memes/ancient-aliens',
        keywords: ['History Channel'],
      },
    ]

    expect(normalizeMemegen(payload)).toEqual([
      {
        source: 'memegen',
        sourceId: 'aag',
        name: 'Ancient Aliens & Guy',
        imageUrl: 'https://api.memegen.link/images/aag.jpg',
        boxCount: 2,
      },
    ])
  })

  it('falls back to the documented blank-image URL when blank is missing or invalid', () => {
    const result = normalizeMemegen([
      { id: '3hd', name: 'Three-Headed Dragon', lines: 3 },
      { id: 'drake', name: 'Drake', blank: 'not-a-url', lines: '2' },
    ])

    expect(result).toEqual([
      {
        source: 'memegen',
        sourceId: '3hd',
        name: 'Three-Headed Dragon',
        imageUrl: 'https://api.memegen.link/images/3hd.png',
        boxCount: 3,
      },
      {
        source: 'memegen',
        sourceId: 'drake',
        name: 'Drake',
        imageUrl: 'https://api.memegen.link/images/drake.png',
        boxCount: 2,
      },
    ])
  })

  it('skips unusable ids/names and dedupes repeated templates', () => {
    const result = normalizeMemegen([
      { id: 'good', name: 'Good', blank: 'https://api.memegen.link/images/good.png' },
      { id: 'good', name: 'Duplicate', blank: 'https://api.memegen.link/images/good-2.png' },
      { id: '../bad', name: 'Path traversal', blank: 'not-a-url' },
      { id: '', name: 'No id', blank: 'https://api.memegen.link/images/x.png' },
      { id: 'no-name', name: '', blank: 'https://api.memegen.link/images/y.png' },
      null,
      42,
    ])

    expect(result.map((entry) => entry.sourceId)).toEqual(['good'])
  })

  it('returns an empty list for non-array payloads', () => {
    expect(normalizeMemegen(null)).toEqual([])
    expect(normalizeMemegen({})).toEqual([])
    expect(normalizeMemegen({ templates: [] })).toEqual([])
    expect(normalizeMemegen('nope')).toEqual([])
  })
})

describe('normalizeManifest', () => {
  it('flattens packs, decodes names and keeps relative/file URLs', () => {
    const result = normalizeManifest({
      packs: [
        {
          name: 'First pack',
          items: [
            {
              id: 'one',
              name: 'One &amp; Only',
              url: 'https://example.test/one.png',
              width: '640',
              height: 480,
              boxCount: 2,
            },
            { id: 2, name: 'Two', url: './two.png' },
            { name: 'No Id Here' },
          ],
        },
        {
          name: 'Second pack',
          items: [
            { id: 'one', name: 'Duplicate One', url: 'https://example.test/dup.png' },
            { id: 'bee', name: 'Bee', url: 'file:///tmp/bee.png' },
          ],
        },
      ],
    })

    expect(result).toEqual([
      {
        source: 'manifest',
        sourceId: 'one',
        name: 'One & Only',
        imageUrl: 'https://example.test/one.png',
        width: 640,
        height: 480,
        boxCount: 2,
      },
      {
        source: 'manifest',
        sourceId: '2',
        name: 'Two',
        imageUrl: './two.png',
      },
      {
        source: 'manifest',
        sourceId: 'no-id-here',
        name: 'No Id Here',
        imageUrl: '',
      },
      {
        source: 'manifest',
        sourceId: 'bee',
        name: 'Bee',
        imageUrl: 'file:///tmp/bee.png',
      },
    ])
  })

  it('supports the flat items format and Windows paths', () => {
    const result = normalizeManifest({
      items: [
        { id: 'flat', name: 'Flat', url: 'pics/flat.webp' },
        { name: 'Derived Id', url: 'C:\\memes\\derived.jpg' },
      ],
    })

    expect(result).toEqual([
      {
        source: 'manifest',
        sourceId: 'flat',
        name: 'Flat',
        imageUrl: 'pics/flat.webp',
      },
      {
        source: 'manifest',
        sourceId: 'derived-id',
        name: 'Derived Id',
        imageUrl: 'C:\\memes\\derived.jpg',
      },
    ])
  })

  it('skips malformed entries and unsafe schemes, then dedupes', () => {
    const result = normalizeManifest({
      items: [
        null,
        {},
        { name: '' },
        { id: 'js', name: 'JS', url: 'javascript:alert(1)' },
        { id: 'data', name: 'Data', url: 'data:image/png;base64,AAAA' },
        { id: 'number', name: 'Number URL', url: 42 },
        { id: 'ok', name: 'Ok', url: 'https://example.test/ok.png' },
        { id: 'ok', name: 'Ok duplicate', url: 'https://example.test/other.png' },
      ],
    })

    expect(result.map((entry) => entry.sourceId)).toEqual(['ok'])
  })

  it('returns an empty list for empty or malformed payloads', () => {
    expect(normalizeManifest(null)).toEqual([])
    expect(normalizeManifest('nope')).toEqual([])
    expect(normalizeManifest({})).toEqual([])
    expect(normalizeManifest({ packs: [] })).toEqual([])
    expect(normalizeManifest({ packs: [{ name: 'x', items: 'nope' }] })).toEqual([])
    expect(normalizeManifest({ items: [null, 42] })).toEqual([])
  })
})

describe('dedupeSourceItems', () => {
  it('keeps the first entry for case-insensitive ids and normalised URLs', () => {
    const first = item({ sourceId: 'ABC', imageUrl: 'https://example.test/a.png#hash' })
    const sameId = item({ sourceId: 'abc', name: 'Same id' })
    const sameUrl = item({ sourceId: 'other', imageUrl: 'https://example.test/a.png' })

    expect(dedupeSourceItems([first, sameId, sameUrl])).toEqual([first])
  })
})

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeHtmlEntities('&amp;&#39;&#x27;')).toBe("&''")
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a b')
  })

  it('leaves unknown entities untouched', () => {
    expect(decodeHtmlEntities('&doesnotexist;')).toBe('&doesnotexist;')
  })
})

describe('template naming', () => {
  it('collapses whitespace and decodes entities', () => {
    expect(stableTemplateName('  Tom   &amp;  Jerry  ')).toBe('Tom & Jerry')
  })

  it('caps long names at the documented length with an ellipsis', () => {
    const long = 'A very long meme template name '.repeat(5)
    const stable = stableTemplateName(long)

    expect(Array.from(stable).length).toBeLessThanOrEqual(MAX_TEMPLATE_NAME_LENGTH)
    expect(stable.endsWith('…')).toBe(true)
  })

  it('does not split surrogate pairs when truncating emoji names', () => {
    const stable = stableTemplateName('😀'.repeat(80))

    expect(Array.from(stable).length).toBeLessThanOrEqual(MAX_TEMPLATE_NAME_LENGTH)
    expect(stable.endsWith('…')).toBe(true)
  })

  it('falls back to Untitled for empty input', () => {
    expect(stableTemplateName('')).toBe('Untitled')
    expect(stableTemplateName('   \u0000  ')).toBe('Untitled')
  })

  it('keeps max length when adding a unique suffix', () => {
    const long = 'Long template name '.repeat(6)
    const base = stableTemplateName(long)
    const used = new Set([templateNameKey(base)])
    const unique = uniqueTemplateName(long, (key) => used.has(key))

    expect(unique.endsWith(' (2)')).toBe(true)
    expect(Array.from(unique).length).toBeLessThanOrEqual(MAX_TEMPLATE_NAME_LENGTH)
  })

  it('leaves free names untouched and suffixes taken ones', () => {
    expect(uniqueTemplateName('Drake', () => false)).toBe('Drake')
    expect(uniqueTemplateName('Drake', (key) => key === 'drake')).toBe('Drake (2)')
  })

  it('builds a duplicate-check key that ignores case and extra spaces', () => {
    expect(templateNameKey('  Drake   Hotline ')).toBe('drake hotline')
  })
})

describe('slugify', () => {
  it('transliterates umlauts and punctuation', () => {
    expect(slugify('Ünïcode & Spaces!')).toBe('unicode-and-spaces')
    expect(slugify('Straße & Küsse')).toBe('strasse-and-kusse')
  })

  it('falls back to item and enforces the length cap', () => {
    expect(slugify('  ...  ')).toBe('item')
    expect(slugify('a'.repeat(100), 12)).toBe('a'.repeat(12))
  })
})
