// Minimal ZIP writer (STORE / no compression). Meme exports are PNGs, which are
// already compressed, so adding a deflate dependency would increase the bundle
// without making the archive meaningfully smaller. The output is a regular ZIP
// with UTF-8 names, readable by Windows Explorer, macOS Archive Utility and
// `unzip`.

export interface ZipEntry {
  /** Path inside the archive, e.g. `meme-01-alice.png`. */
  name: string
  /** Raw bytes; must be backed by a regular ArrayBuffer (Blob constraint). */
  data: Uint8Array<ArrayBuffer>
}

const LOCAL_HEADER_SIG = 0x04034b50
const CENTRAL_HEADER_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
/** General purpose bit 11: file names are UTF-8. */
const UTF8_FLAG = 0x0800
/** 4 GiB minus one, the largest value a classic (non-ZIP64) field can hold. */
const MAX_FIELD = 0xffffffff

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** Standard CRC-32 (IEEE 802.3), as required by the ZIP format. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * MS-DOS time/date pair used by ZIP headers. Two-second resolution and a
 * 1980–2107 range, exactly like the format requires.
 */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()))
  const month = Math.min(12, Math.max(1, date.getMonth() + 1))
  const day = Math.min(31, Math.max(1, date.getDate()))
  const time =
    (Math.min(23, Math.max(0, date.getHours())) << 11) |
    (Math.min(59, Math.max(0, date.getMinutes())) << 5) |
    (Math.min(59, Math.max(0, date.getSeconds())) >> 1)
  const dateField = ((year - 1980) << 9) | (month << 5) | day
  return { time, date: dateField }
}

/**
 * Build a ZIP archive from in-memory files. Entries keep their order and are
 * stored uncompressed. Throws if the archive would exceed the classic ZIP
 * limits (65,535 entries / 4 GiB); a full meme game is far below both.
 */
export function createZip(files: ZipEntry[], options: { modifiedAt?: Date } = {}): Blob {
  if (files.length > 0xffff) throw new Error('ZIP supports at most 65,535 files.')
  const stamp = dosDateTime(options.modifiedAt ?? new Date())
  const encoder = new TextEncoder()

  const localParts: BlobPart[] = []
  const centralParts: BlobPart[] = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = file.data
    if (data.length > MAX_FIELD) throw new Error(`File too large for ZIP: ${file.name}`)
    const crc = crc32(data)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, LOCAL_HEADER_SIG, true)
    lv.setUint16(4, 20, true) // version needed to extract (2.0)
    lv.setUint16(6, UTF8_FLAG, true)
    lv.setUint16(8, 0, true) // method: store
    lv.setUint16(10, stamp.time, true)
    lv.setUint16(12, stamp.date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true) // compressed size
    lv.setUint32(22, data.length, true) // uncompressed size
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true) // extra field length
    local.set(name, 30)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, CENTRAL_HEADER_SIG, true)
    cv.setUint16(4, 20, true) // version made by (MS-DOS, 2.0)
    cv.setUint16(6, 20, true) // version needed to extract
    cv.setUint16(8, UTF8_FLAG, true)
    cv.setUint16(10, 0, true) // method: store
    cv.setUint16(12, stamp.time, true)
    cv.setUint16(14, stamp.date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint16(30, 0, true) // extra field length
    cv.setUint16(32, 0, true) // file comment length
    cv.setUint16(34, 0, true) // disk number start
    cv.setUint16(36, 0, true) // internal file attributes
    cv.setUint32(38, 0, true) // external file attributes
    cv.setUint32(42, offset, true) // relative offset of local header
    central.set(name, 46)

    localParts.push(local, data)
    centralParts.push(central)
    offset += local.length + data.length
    if (offset > MAX_FIELD) throw new Error('ZIP archive exceeds 4 GiB.')
  }

  const centralSize = centralParts.reduce<number>(
    (sum, part) => sum + (part instanceof Uint8Array ? part.length : 0),
    0,
  )
  if (offset + centralSize > MAX_FIELD) throw new Error('ZIP archive exceeds 4 GiB.')

  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, EOCD_SIG, true)
  ev.setUint16(4, 0, true) // number of this disk
  ev.setUint16(6, 0, true) // disk with the central directory
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true) // comment length

  return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' })
}
