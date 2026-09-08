/**
 * image_seamless_poisson — Poisson 边带局部修正使贴图无缝可平铺
 *
 * 只对接缝两侧 ±band 像素做余弦渐变修正（raised cosine taper，C¹ 光滑，
 * 等价一维 Poisson 谐波解），带外区域不动；相比 Moisan 对有明显主体的非周期
 * 图保留中心更干净。横向修正让左右接边一致，纵向同理，四角两两相等。
 *
 * 算法移植自共享电池库 (materials/batteries/ts/image/tiles/image_seamless_poisson)，
 * I/O 改为通过 `processImage`（_shared/asset2d.ts）委托后端 asset2d 服务解码/编码。
 */

import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

function asInt(v: unknown, fallback: number, min?: number, max?: number): number {
  let n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
  if (min !== undefined) n = Math.max(min, n)
  if (max !== undefined) n = Math.min(max, n)
  return n
}

function clampU8(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v)
}

function buildCosTaper(b: number): Float64Array {
  const out = new Float64Array(b)
  for (let i = 0; i < b; i++) out[i] = 0.5 * (1 + Math.cos((Math.PI * i) / b))
  return out
}

function fixHorizontalSeam(u: Float64Array, M: number, N: number, taper: Float64Array): { maxJumpBefore: number; maxJumpAfter: number } {
  const b = taper.length
  let maxJumpBefore = 0
  for (let y = 0; y < M; y++) {
    const off = y * N
    const jump = u[off + N - 1] - u[off]
    if (Math.abs(jump) > maxJumpBefore) maxJumpBefore = Math.abs(jump)
    const half = jump * 0.5
    for (let x = 0; x < b; x++) u[off + x] += half * taper[x]
    for (let x = 0; x < b; x++) u[off + (N - 1 - x)] -= half * taper[x]
  }
  let maxJumpAfter = 0
  for (let y = 0; y < M; y++) {
    const j = Math.abs(u[y * N + N - 1] - u[y * N])
    if (j > maxJumpAfter) maxJumpAfter = j
  }
  return { maxJumpBefore, maxJumpAfter }
}

function fixVerticalSeam(u: Float64Array, M: number, N: number, taper: Float64Array): { maxJumpBefore: number; maxJumpAfter: number } {
  const b = taper.length
  let maxJumpBefore = 0
  for (let x = 0; x < N; x++) {
    const jump = u[(M - 1) * N + x] - u[x]
    if (Math.abs(jump) > maxJumpBefore) maxJumpBefore = Math.abs(jump)
    const half = jump * 0.5
    for (let y = 0; y < b; y++) u[y * N + x] += half * taper[y]
    for (let y = 0; y < b; y++) u[(M - 1 - y) * N + x] -= half * taper[y]
  }
  let maxJumpAfter = 0
  for (let x = 0; x < N; x++) {
    const j = Math.abs(u[(M - 1) * N + x] - u[x])
    if (j > maxJumpAfter) maxJumpAfter = j
  }
  return { maxJumpBefore, maxJumpAfter }
}

/** 纯像素 Poisson 边带无缝化：RGBA in → RGBA out。导出供单测直接验证。 */
export function seamlessPoisson(
  src: Uint8Array, width: number, height: number,
  band: number, doH: boolean, doV: boolean, processAlpha: boolean,
): { pixels: Uint8Array; w: number; h: number; maxBefore: number; maxAfterH: number; maxAfterV: number; effBandH: number; effBandV: number } {
  const M = height, N = width
  const effBandH = Math.max(1, Math.min(band, Math.floor(N / 2)))
  const effBandV = Math.max(1, Math.min(band, Math.floor(M / 2)))
  const taperH = doH ? buildCosTaper(effBandH) : new Float64Array(0)
  const taperV = doV ? buildCosTaper(effBandV) : new Float64Array(0)
  const channels = processAlpha ? 4 : 3
  const out = new Uint8Array(src.length)
  out.set(src)
  const u = new Float64Array(M * N)
  let aggMaxBefore = 0, aggMaxAfterH = 0, aggMaxAfterV = 0
  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < M * N; i++) u[i] = src[i * 4 + c]
    let jh = { maxJumpBefore: 0, maxJumpAfter: 0 }
    let jv = { maxJumpBefore: 0, maxJumpAfter: 0 }
    if (doH) jh = fixHorizontalSeam(u, M, N, taperH)
    if (doV) jv = fixVerticalSeam(u, M, N, taperV)
    const before = Math.max(jh.maxJumpBefore, jv.maxJumpBefore)
    if (before > aggMaxBefore) aggMaxBefore = before
    if (jh.maxJumpAfter > aggMaxAfterH) aggMaxAfterH = jh.maxJumpAfter
    if (jv.maxJumpAfter > aggMaxAfterV) aggMaxAfterV = jv.maxJumpAfter
    for (let i = 0; i < M * N; i++) out[i * 4 + c] = clampU8(u[i])
  }
  return { pixels: out, w: width, h: height, maxBefore: aggMaxBefore, maxAfterH: aggMaxAfterH, maxAfterV: aggMaxAfterV, effBandH, effBandV }
}

export async function imageSeamlessPoisson(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const band = asInt(input.band, 16, 1, 256)
  const axesRaw = typeof input.axes === 'string' ? input.axes : 'both'
  const doH = axesRaw === 'both' || axesRaw === 'horizontal'
  const doV = axesRaw === 'both' || axesRaw === 'vertical'
  if (!doH && !doV) return { image: '', info: '', error: `axes must be "both"/"horizontal"/"vertical", got "${axesRaw}"` }
  const processAlpha = input.process_alpha === true || input.process_alpha === 'true'

  let info = ''
  const res = processImage(input, ctx, 'image_seamless_poisson', (img: DecodedImage) => {
    if (img.width < 2 || img.height < 2) throw new Error(`image too small: ${img.width}x${img.height} (need >= 2x2)`)
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = seamlessPoisson(src, img.width, img.height, band, doH, doV, processAlpha)
    const axesShort = doH && doV ? 'both' : doH ? 'horizontal' : 'vertical'
    const bandInfo = out.effBandH === out.effBandV && out.effBandH === band ? `band=${band}` : `band=${band} (eff H=${out.effBandH} V=${out.effBandV})`
    info = `${img.width}x${img.height}, channels=${processAlpha ? 4 : 3}, ${bandInfo}, axes=${axesShort}, max jump before≈${out.maxBefore.toFixed(1)} → after H≈${out.maxAfterH.toFixed(2)} V≈${out.maxAfterV.toFixed(2)}`
    return { width: out.w, height: out.h, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix: '_seamless_p' })

  if (res.error) return { image: '', info: '', error: res.error }
  return { image: res.image, info, error: '' }
}
