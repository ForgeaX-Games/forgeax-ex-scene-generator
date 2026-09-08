import zlib from 'node:zlib'

/**
 * Minimal, dependency-free PNG codec used by the scene-export atlas packer.
 *
 * Supports decoding 8-bit truecolour and truecolour-with-alpha PNGs (colour
 * types 2 and 6) plus 8-bit greyscale / greyscale+alpha and 8-bit indexed
 * (palette) images — i.e. the full range emitted by the asset pipeline. All
 * images are normalised to straight RGBA8 so they can be composited into a
 * single atlas surface. Encoding always writes 8-bit RGBA (colour type 6),
 * which the canonical viewer loads via the browser's <img>/drawImage path.
 *
 * We intentionally avoid a third-party PNG library: the runtime has no native
 * image module available and we only need a narrow, well-specified subset of
 * the PNG spec. zlib (inflate/deflate) is provided by Node core.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export interface RgbaImage {
  width: number
  height: number
  /** Straight (non-premultiplied) RGBA8, row-major, length = width*height*4. */
  data: Buffer
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
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

/** Reverse the PNG per-scanline filters in place, returning raw sample bytes. */
function unfilter(raw: Buffer, height: number, bytesPerRow: number, bpp: number): Buffer {
  const out = Buffer.allocUnsafe(height * bytesPerRow)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filterType = raw[pos++]!
    const rowStart = y * bytesPerRow
    const prevStart = rowStart - bytesPerRow
    for (let x = 0; x < bytesPerRow; x++) {
      const rawByte = raw[pos++]!
      const left = x >= bpp ? out[rowStart + x - bpp]! : 0
      const up = y > 0 ? out[prevStart + x]! : 0
      const upLeft = y > 0 && x >= bpp ? out[prevStart + x - bpp]! : 0
      let value: number
      switch (filterType) {
        case 0: value = rawByte; break
        case 1: value = rawByte + left; break
        case 2: value = rawByte + up; break
        case 3: value = rawByte + ((left + up) >> 1); break
        case 4: value = rawByte + paethPredictor(left, up, upLeft); break
        default: throw new Error(`unsupported PNG filter type ${filterType}`)
      }
      out[rowStart + x] = value & 0xff
    }
  }
  return out
}

/** Decode a PNG buffer into straight RGBA8. */
export function decodePng(buffer: Buffer): RgbaImage {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG (bad signature)')
  }
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let palette: Buffer | null = null
  let transparency: Buffer | null = null
  const idatChunks: Buffer[] = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const data = buffer.subarray(dataStart, dataStart + length)
    switch (type) {
      case 'IHDR':
        width = data.readUInt32BE(0)
        height = data.readUInt32BE(4)
        bitDepth = data[8]!
        colorType = data[9]!
        if (data[12] !== 0) throw new Error('interlaced PNGs are not supported')
        break
      case 'PLTE':
        palette = Buffer.from(data)
        break
      case 'tRNS':
        transparency = Buffer.from(data)
        break
      case 'IDAT':
        idatChunks.push(Buffer.from(data))
        break
      default:
        break
    }
    offset = dataStart + length + 4 // skip data + CRC
    if (type === 'IEND') break
  }

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (only 8 supported)`)
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks))

  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 3 ? 1 : 0
  if (channels === 0) throw new Error(`unsupported PNG colour type ${colorType}`)
  const bpp = channels
  const bytesPerRow = width * bpp
  const samples = unfilter(inflated, height, bytesPerRow, bpp)

  const rgba = Buffer.allocUnsafe(width * height * 4)
  for (let i = 0, px = 0; px < width * height; px++) {
    const s = px * bpp
    let r: number, g: number, b: number, a: number
    switch (colorType) {
      case 2: r = samples[s]!; g = samples[s + 1]!; b = samples[s + 2]!; a = 255; break
      case 6: r = samples[s]!; g = samples[s + 1]!; b = samples[s + 2]!; a = samples[s + 3]!; break
      case 0: r = g = b = samples[s]!; a = 255; break
      case 4: r = g = b = samples[s]!; a = samples[s + 1]!; break
      case 3: {
        const idx = samples[s]!
        r = palette ? palette[idx * 3]! : 0
        g = palette ? palette[idx * 3 + 1]! : 0
        b = palette ? palette[idx * 3 + 2]! : 0
        a = transparency && idx < transparency.length ? transparency[idx]! : 255
        break
      }
      default: r = g = b = 0; a = 255
    }
    rgba[i++] = r
    rgba[i++] = g
    rgba[i++] = b
    rgba[i++] = a
  }
  return { width, height, data: rgba }
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.allocUnsafe(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

/** Encode straight RGBA8 into an 8-bit truecolour-with-alpha PNG. */
export function encodePng(image: RgbaImage): Buffer {
  const { width, height, data } = image
  const bytesPerRow = width * 4
  // Prepend the (none) filter byte to each scanline before deflating.
  const raw = Buffer.allocUnsafe(height * (bytesPerRow + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (bytesPerRow + 1)] = 0
    data.copy(raw, y * (bytesPerRow + 1) + 1, y * bytesPerRow, y * bytesPerRow + bytesPerRow)
  }
  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Create a fully transparent RGBA image. */
export function blankImage(width: number, height: number): RgbaImage {
  return { width: Math.max(1, width), height: Math.max(1, height), data: Buffer.alloc(Math.max(1, width) * Math.max(1, height) * 4) }
}

/** Blit `src` into `dst` at (dx, dy) using source-over compositing. */
export function blit(dst: RgbaImage, src: RgbaImage, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x
      if (tx < 0 || tx >= dst.width) continue
      const si = (y * src.width + x) * 4
      const di = (ty * dst.width + tx) * 4
      const sa = src.data[si + 3]! / 255
      if (sa <= 0) continue
      if (sa >= 1) {
        dst.data[di] = src.data[si]!
        dst.data[di + 1] = src.data[si + 1]!
        dst.data[di + 2] = src.data[si + 2]!
        dst.data[di + 3] = 255
        continue
      }
      const da = dst.data[di + 3]! / 255
      const outA = sa + da * (1 - sa)
      for (let c = 0; c < 3; c++) {
        const sc = src.data[si + c]!
        const dc = dst.data[di + c]!
        dst.data[di + c] = outA > 0 ? Math.round((sc * sa + dc * da * (1 - sa)) / outA) : 0
      }
      dst.data[di + 3] = Math.round(outA * 255)
    }
  }
}

/**
 * Extract a sub-rect of `src` into a new image. Out-of-bounds pixels are
 * transparent. Used to slice tile-group sheets into per-sub-tile images.
 */
export function cropImage(src: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage {
  const out = blankImage(w, h)
  for (let row = 0; row < h; row++) {
    const sy = y + row
    if (sy < 0 || sy >= src.height) continue
    for (let col = 0; col < w; col++) {
      const sx = x + col
      if (sx < 0 || sx >= src.width) continue
      const si = (sy * src.width + sx) * 4
      const di = (row * w + col) * 4
      out.data[di] = src.data[si]!
      out.data[di + 1] = src.data[si + 1]!
      out.data[di + 2] = src.data[si + 2]!
      out.data[di + 3] = src.data[si + 3]!
    }
  }
  return out
}
