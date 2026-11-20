import { describe, expect, it } from 'vitest'
import { createZip, crc32, type ZipEntry } from '../../src/lib/zip'

const enc = new TextEncoder()
const dec = new TextDecoder()

interface ParsedEntry {
  name: string
  data: Uint8Array
  flags: number
  method: number
  crc: number
  localCrc: number
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

/** Minimal ZIP reader for the STORE-only archives the app produces. */
function parseZip(bytes: Uint8Array): { entries: ParsedEntry[]; comment: string } {
  const eocd = bytes.length - 22
  expect(u32(bytes, eocd)).toBe(0x06054b50)
  const count = u16(bytes, eocd + 10)
  const cdOffset = u32(bytes, eocd + 16)

  const entries: ParsedEntry[] = []
  let cursor = cdOffset
  for (let i = 0; i < count; i++) {
    expect(u32(bytes, cursor)).toBe(0x02014b50)
    const flags = u16(bytes, cursor + 8)
    const method = u16(bytes, cursor + 10)
    const crc = u32(bytes, cursor + 16)
    const compressed = u32(bytes, cursor + 20)
    const uncompressed = u32(bytes, cursor + 24)
    const nameLen = u16(bytes, cursor + 28)
    const extraLen = u16(bytes, cursor + 30)
    const commentLen = u16(bytes, cursor + 32)
    const localOffset = u32(bytes, cursor + 42)
    const name = dec.decode(bytes.slice(cursor + 46, cursor + 46 + nameLen))

    expect(u32(bytes, localOffset)).toBe(0x04034b50)
    const localNameLen = u16(bytes, localOffset + 26)
    const localExtraLen = u16(bytes, localOffset + 28)
    const localCrc = u32(bytes, localOffset + 14)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const data = bytes.slice(dataStart, dataStart + compressed)

    expect(compressed).toBe(uncompressed)
    expect(crc32(data)).toBe(crc)

    entries.push({ name, data, flags, method, crc, localCrc })
    cursor += 46 + nameLen + extraLen + commentLen
  }

  expect(cursor).toBe(eocd)
  return { entries, comment: '' }
}

function entry(name: string, text: string): ZipEntry {
  return { name, data: enc.encode(text) }
}

describe('crc32', () => {
  it('matches the standard test vectors', () => {
    expect(crc32(enc.encode(''))).toBe(0)
    expect(crc32(enc.encode('hello'))).toBe(0x3610a686)
    expect(crc32(enc.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('createZip', () => {
  it('writes a readable STORE archive with correct names, sizes and CRCs', async () => {
    const zip = createZip([entry('r01-01-alice.png', 'alice-meme'), entry('r01-02-bob.png', 'bob')], {
      modifiedAt: new Date(2024, 4, 17, 13, 45, 30),
    })

    expect(zip.type).toBe('application/zip')
    const bytes = new Uint8Array(await zip.arrayBuffer())
    const { entries } = parseZip(bytes)

    expect(entries.map((e) => e.name)).toEqual(['r01-01-alice.png', 'r01-02-bob.png'])
    expect(entries.map((e) => dec.decode(e.data))).toEqual(['alice-meme', 'bob'])
    expect(entries.every((e) => e.method === 0)).toBe(true)
    expect(entries.every((e) => e.flags === 0x0800)).toBe(true)
    expect(entries.every((e) => e.crc === e.localCrc)).toBe(true)

    // Local DOS timestamp: 13:45:30 -> seconds are stored in 2s steps.
    expect(u16(bytes, 10)).toBe((13 << 11) | (45 << 5) | (30 >> 1))
    expect(u16(bytes, 12)).toBe(((2024 - 1980) << 9) | (5 << 5) | 17)
  })

  it('stores UTF-8 file names behind the language flag', async () => {
    const zip = createZip([entry('memes/löwe-🦁.png', 'x')])
    const bytes = new Uint8Array(await zip.arrayBuffer())
    const { entries } = parseZip(bytes)

    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('memes/löwe-🦁.png')
    expect(entries[0].flags & 0x0800).toBe(0x0800)
  })

  it('produces a valid empty archive', async () => {
    const zip = createZip([])
    const bytes = new Uint8Array(await zip.arrayBuffer())

    expect(bytes.length).toBe(22)
    expect(u32(bytes, 0)).toBe(0x06054b50)
    expect(u16(bytes, 8)).toBe(0)
    expect(u16(bytes, 10)).toBe(0)
  })

  it('keeps binary data byte for byte', async () => {
    const data = new Uint8Array(256).map((_, i) => i)
    const zip = createZip([{ name: 'bytes.bin', data }])
    const bytes = new Uint8Array(await zip.arrayBuffer())
    const { entries } = parseZip(bytes)

    expect(Array.from(entries[0].data)).toEqual(Array.from(data))
  })
})
