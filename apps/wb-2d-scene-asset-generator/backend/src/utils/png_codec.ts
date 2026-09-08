/**
 * Zero-dependency PNG codec (decode + encode) for the image-processing
 * batteries (RemoveBG / Resize / TerrainExtract / AtlasCompose / Seamless …).
 *
 * The shared asset library never installed `sharp`, and the app's other PNG
 * helper (`batteries/pipelines/_shared/png.ts`) only handles the toy
 * 8-bit-RGB / stored-zlib PNGs it itself produces — it returns null for the
 * real (DEFLATE-compressed, filtered, RGBA/palette) PNGs the AI image gateway
 * emits. So those batteries silently degraded to no-ops.
 *
 * This codec uses Node's built-in `zlib` for real inflate/deflate and supports
 * the PNG subset the gateway + asset library actually produce:
 *   decode: 8-bit, color types 0/2/3/4/6 (gray, RGB, palette, gray+alpha,
 *           RGBA), all 5 scanline filters, non-interlaced. → RGBA.
 *   encode: 8-bit RGBA, filter 0 (None), single IDAT, zlib deflate.
 *
 * The AI image gateway also emits JPEG (`image/jpeg`, e.g. `ai-*.jpg`); those
 * are decoded via the pure-JS `jpeg-js` (already a monorepo dep). Use
 * `decodeImageBytes(bytes, mimeType)` as the entry point — it sniffs the
 * signature and dispatches to PNG or JPEG, always returning RGBA.
 *
 * `decodePng` always returns RGBA so downstream algorithms see a uniform
 * 4-channel buffer; `encodePng` always writes RGBA so alpha (e.g. RemoveBG's
 * cutout) round-trips losslessly. Processed images are always re-encoded as
 * PNG so downstream batteries get a lossless, alpha-capable format.
 */

import { deflateSync, inflateSync } from 'node:zlib'
import { decode as decodeJpeg } from 'jpeg-js'

const JPEG_SOI = Buffer.from([0xff, 0xd8])

export interface DecodedImage {
  width: number
  height: number
  /** RGBA, length = width * height * 4. */
  data: Buffer
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function readU32BE(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset)
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/** Undo one of the 5 PNG scanline filters in place, row by row. */
function unfilter(raw: Buffer, width: number, height: number, bytesPerPixel: number): Buffer {
  const stride = width * bytesPerPixel
  const out = Buffer.alloc(height * stride)
  let rawPos = 0
  for (let y = 0; y < height; y++) {
    const filterType = raw[rawPos++]
    const rowStart = y * stride
    const prevStart = (y - 1) * stride
    for (let i = 0; i < stride; i++) {
      const x = raw[rawPos++]
      const a = i >= bytesPerPixel ? out[rowStart + i - bytesPerPixel] : 0
      const b = y > 0 ? out[prevStart + i] : 0
      const c = y > 0 && i >= bytesPerPixel ? out[prevStart + i - bytesPerPixel] : 0
      let val: number
      switch (filterType) {
        case 0:
          val = x
          break
        case 1:
          val = x + a
          break
        case 2:
          val = x + b
          break
        case 3:
          val = x + ((a + b) >> 1)
          break
        case 4:
          val = x + paethPredictor(a, b, c)
          break
        default:
          throw new Error(`unsupported PNG filter type ${filterType}`)
      }
      out[rowStart + i] = val & 0xff
    }
  }
  return out
}

/** Expand decoded scanlines of any supported color type into RGBA. */
function toRgba(
  pixels: Buffer,
  width: number,
  height: number,
  colorType: number,
  palette: Buffer | null,
  trns: Buffer | null,
): Buffer {
  const out = Buffer.alloc(width * height * 4)
  const n = width * height
  if (colorType === 6) {
    pixels.copy(out, 0, 0, Math.min(pixels.length, out.length))
    return out
  }
  if (colorType === 2) {
    for (let i = 0; i < n; i++) {
      out[i * 4] = pixels[i * 3]
      out[i * 4 + 1] = pixels[i * 3 + 1]
      out[i * 4 + 2] = pixels[i * 3 + 2]
      out[i * 4 + 3] = 255
    }
    return out
  }
  if (colorType === 0) {
    for (let i = 0; i < n; i++) {
      const g = pixels[i]
      out[i * 4] = g
      out[i * 4 + 1] = g
      out[i * 4 + 2] = g
      out[i * 4 + 3] = 255
    }
    return out
  }
  if (colorType === 4) {
    for (let i = 0; i < n; i++) {
      const g = pixels[i * 2]
      out[i * 4] = g
      out[i * 4 + 1] = g
      out[i * 4 + 2] = g
      out[i * 4 + 3] = pixels[i * 2 + 1]
    }
    return out
  }
  if (colorType === 3) {
    if (!palette) throw new Error('palette PNG missing PLTE chunk')
    for (let i = 0; i < n; i++) {
      const idx = pixels[i]
      out[i * 4] = palette[idx * 3] ?? 0
      out[i * 4 + 1] = palette[idx * 3 + 1] ?? 0
      out[i * 4 + 2] = palette[idx * 3 + 2] ?? 0
      out[i * 4 + 3] = trns && idx < trns.length ? trns[idx] : 255
    }
    return out
  }
  throw new Error(`unsupported PNG color type ${colorType}`)
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/**
 * Decode a PNG buffer into RGBA. Supports 8-bit, color types 0/2/3/4/6, all
 * scanline filters, non-interlaced. Throws on anything outside that subset.
 */
export function decodePng(buf: Buffer): DecodedImage {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG (bad signature)')
  }
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let palette: Buffer | null = null
  let trns: Buffer | null = null
  const idatChunks: Buffer[] = []

  while (pos + 8 <= buf.length) {
    const len = readU32BE(buf, pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const dataStart = pos + 8
    const dataEnd = dataStart + len
    if (dataEnd > buf.length) break
    if (type === 'IHDR') {
      width = readU32BE(buf, dataStart)
      height = readU32BE(buf, dataStart + 4)
      bitDepth = buf[dataStart + 8]
      colorType = buf[dataStart + 9]
      interlace = buf[dataStart + 12]
    } else if (type === 'PLTE') {
      palette = buf.subarray(dataStart, dataEnd)
    } else if (type === 'tRNS') {
      trns = buf.subarray(dataStart, dataEnd)
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataEnd))
    } else if (type === 'IEND') {
      break
    }
    pos = dataEnd + 4 // skip CRC
  }

  if (width <= 0 || height <= 0) throw new Error('PNG missing/invalid IHDR')
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (only 8 supported)`)
  if (interlace !== 0) throw new Error('interlaced PNG not supported')
  const channels = CHANNELS[colorType]
  if (channels === undefined) throw new Error(`unsupported PNG color type ${colorType}`)
  if (idatChunks.length === 0) throw new Error('PNG has no IDAT data')

  const raw = inflateSync(Buffer.concat(idatChunks))
  const pixels = unfilter(raw, width, height, channels)
  const data = toRgba(pixels, width, height, colorType, palette, trns)
  return { width, height, data }
}

/** Decode a JPEG buffer into RGBA via the pure-JS `jpeg-js` decoder. */
export function decodeJpegImage(buf: Buffer): DecodedImage {
  const decoded = decodeJpeg(buf, { formatAsRGBA: true, useTArray: true, tolerantDecoding: true })
  return {
    width: decoded.width,
    height: decoded.height,
    data: Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
  }
}

/**
 * Decode raw image bytes into RGBA, dispatching on the byte signature (with the
 * `mimeType` hint as a fallback). Supports PNG and JPEG — the two formats the AI
 * image gateway and asset library emit. Throws on anything else.
 */
export function decodeImageBytes(bytes: Buffer, mimeType?: string): DecodedImage {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return decodePng(bytes)
  if (bytes.length >= 2 && bytes.subarray(0, 2).equals(JPEG_SOI)) return decodeJpegImage(bytes)
  // Signature unknown — fall back to the mime hint.
  if (mimeType === 'image/jpeg') return decodeJpegImage(bytes)
  if (mimeType === 'image/png') return decodePng(bytes)
  throw new Error(`unsupported image format${mimeType ? ` (${mimeType})` : ''}`)
}

function crcChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'latin1')
  const body = Buffer.concat([typeBuf, data])
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([lenBuf, body, crcBuf])
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Encode an RGBA pixel buffer into a PNG (8-bit RGBA, filter None, zlib
 * deflate). `data` must be length width*height*4.
 */
export function encodePng(width: number, height: number, data: Buffer): Buffer {
  const stride = width * 4
  if (data.length < stride * height) {
    throw new Error(`encodePng: data too short (${data.length} < ${stride * height})`)
  }
  // Prepend a filter byte (0 = None) to every scanline.
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  return Buffer.concat([
    PNG_SIGNATURE,
    crcChunk('IHDR', ihdr),
    crcChunk('IDAT', deflateSync(raw)),
    crcChunk('IEND', Buffer.alloc(0)),
  ])
}
