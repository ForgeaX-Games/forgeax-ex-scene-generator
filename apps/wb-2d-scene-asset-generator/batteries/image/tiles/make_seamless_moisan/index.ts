/**
 * make_seamless_moisan — 无缝贴图（Moisan 2011 周期+平滑分解）
 *
 * 任意图像 u 可唯一分解为 u = p + s：p 为严格周期分量、s 为承载边界跳跃的平滑
 * 分量。仅保留 p 即得到四边可无缝平铺的贴图（频域闭式解，O(MN log MN)）。
 *
 * 非 power-of-2 尺寸走 "reflect-pad 到 pow2 → Moisan → 裁回左上角" 策略；纯
 * pow2 尺寸直接原地处理。算法移植自共享电池库
 * (materials/batteries/ts/image/tiles/make_seamless_moisan)，I/O 改为通过
 * `processImage`（_shared/asset2d.ts）委托后端 asset2d 服务解码/编码。
 */

import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

function nextPow2(n: number): number {
  if (n <= 1) return 1
  let p = 1
  while (p < n) p <<= 1
  return p
}

function reflectIndex(i: number, n: number): number {
  if (n <= 1) return 0
  const period = 2 * (n - 1)
  let r = i % period
  if (r < 0) r += period
  return r < n ? r : period - r
}

function reflectPadChannel(u: Float64Array, M: number, N: number, Mp: number, Np: number): Float64Array {
  if (Mp === M && Np === N) return u
  const out = new Float64Array(Mp * Np)
  const colMap = new Int32Array(Np)
  for (let j = 0; j < Np; j++) colMap[j] = reflectIndex(j, N)
  for (let i = 0; i < Mp; i++) {
    const srcOff = reflectIndex(i, M) * N
    const dstOff = i * Np
    for (let j = 0; j < Np; j++) out[dstOff + j] = u[srcOff + colMap[j]]
  }
  return out
}

/** 原地 1D radix-2 Cooley-Tukey FFT/iFFT（n 必须为 2 的幂）。 */
function fft1dPow2(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const ang = ((inverse ? 2 : -2) * Math.PI) / size
    const wRe0 = Math.cos(ang)
    const wIm0 = Math.sin(ang)
    for (let i = 0; i < n; i += size) {
      let wRe = 1, wIm = 0
      for (let k = 0; k < half; k++) {
        const a = i + k
        const b = a + half
        const tRe = wRe * re[b] - wIm * im[b]
        const tIm = wRe * im[b] + wIm * re[b]
        re[b] = re[a] - tRe; im[b] = im[a] - tIm
        re[a] += tRe; im[a] += tIm
        const nwRe = wRe * wRe0 - wIm * wIm0
        wIm = wRe * wIm0 + wIm * wRe0
        wRe = nwRe
      }
    }
  }
  if (inverse) {
    const inv = 1 / n
    for (let i = 0; i < n; i++) { re[i] *= inv; im[i] *= inv }
  }
}

/** O(n²) DFT，用于非 2 的幂的尺寸。 */
function dft1dGeneric(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)
  const sign = inverse ? 1 : -1
  for (let k = 0; k < n; k++) {
    let sRe = 0, sIm = 0
    for (let t = 0; t < n; t++) {
      const a = (sign * 2 * Math.PI * k * t) / n
      const c = Math.cos(a), s = Math.sin(a)
      sRe += re[t] * c - im[t] * s
      sIm += re[t] * s + im[t] * c
    }
    outRe[k] = sRe; outIm[k] = sIm
  }
  const inv = inverse ? 1 / n : 1
  for (let i = 0; i < n; i++) { re[i] = outRe[i] * inv; im[i] = outIm[i] * inv }
}

function transform1d(re: Float64Array, im: Float64Array, inverse: boolean): void {
  if (isPow2(re.length)) fft1dPow2(re, im, inverse)
  else dft1dGeneric(re, im, inverse)
}

function fft2d(re: Float64Array, im: Float64Array, M: number, N: number, inverse: boolean): void {
  const rowRe = new Float64Array(N)
  const rowIm = new Float64Array(N)
  for (let i = 0; i < M; i++) {
    const off = i * N
    for (let j = 0; j < N; j++) { rowRe[j] = re[off + j]; rowIm[j] = im[off + j] }
    transform1d(rowRe, rowIm, inverse)
    for (let j = 0; j < N; j++) { re[off + j] = rowRe[j]; im[off + j] = rowIm[j] }
  }
  const colRe = new Float64Array(M)
  const colIm = new Float64Array(M)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < M; i++) { colRe[i] = re[i * N + j]; colIm[i] = im[i * N + j] }
    transform1d(colRe, colIm, inverse)
    for (let i = 0; i < M; i++) { re[i * N + j] = colRe[i]; im[i * N + j] = colIm[i] }
  }
}

/** 对单通道执行 Moisan 周期+平滑分解，返回周期分量 p（未裁剪）。 */
function moisanPeriodic(u: Float64Array, M: number, N: number): Float64Array {
  const vRe = new Float64Array(M * N)
  const vIm = new Float64Array(M * N)
  for (let j = 0; j < N; j++) {
    const d = u[(M - 1) * N + j] - u[j]
    vRe[j] += d
    vRe[(M - 1) * N + j] -= d
  }
  for (let i = 0; i < M; i++) {
    const off = i * N
    const d = u[off + (N - 1)] - u[off]
    vRe[off] += d
    vRe[off + (N - 1)] -= d
  }
  fft2d(vRe, vIm, M, N, false)
  const cosM = new Float64Array(M)
  for (let k = 0; k < M; k++) cosM[k] = Math.cos(((2 * Math.PI) / M) * k)
  const cosN = new Float64Array(N)
  for (let l = 0; l < N; l++) cosN[l] = Math.cos(((2 * Math.PI) / N) * l)
  for (let k = 0; k < M; k++) {
    const off = k * N
    const c1 = 2 * cosM[k]
    for (let l = 0; l < N; l++) {
      const idx = off + l
      if (k === 0 && l === 0) { vRe[idx] = 0; vIm[idx] = 0; continue }
      const denom = c1 + 2 * cosN[l] - 4
      vRe[idx] /= denom; vIm[idx] /= denom
    }
  }
  fft2d(vRe, vIm, M, N, true)
  const p = new Float64Array(M * N)
  for (let i = 0; i < M * N; i++) p[i] = u[i] - vRe[i]
  return p
}

/** 纯像素无缝化：RGBA in → RGBA out。导出供单测直接验证。 */
export function seamlessMoisan(
  src: Uint8Array, width: number, height: number, processAlpha: boolean,
): { pixels: Uint8Array; w: number; h: number } {
  const M = height, N = width
  const Mp = nextPow2(M), Np = nextPow2(N)
  const channels = processAlpha ? 4 : 3
  const out = new Uint8Array(src.length)
  out.set(src)
  const u = new Float64Array(M * N)
  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < M * N; i++) u[i] = src[i * 4 + c]
    const padded = reflectPadChannel(u, M, N, Mp, Np)
    const p = moisanPeriodic(padded, Mp, Np)
    for (let i = 0; i < M; i++) {
      const srcOff = i * Np
      const dstRow = i * N
      for (let j = 0; j < N; j++) {
        let v = Math.round(p[srcOff + j])
        if (v < 0) v = 0
        else if (v > 255) v = 255
        out[(dstRow + j) * 4 + c] = v
      }
    }
  }
  return { pixels: out, w: width, h: height }
}

export async function makeSeamlessMoisan(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const processAlpha = input.process_alpha === true || input.process_alpha === 'true'
  let info = ''

  const res = processImage(input, ctx, 'make_seamless_moisan', (img: DecodedImage) => {
    if (img.width < 2 || img.height < 2) throw new Error(`image too small: ${img.width}x${img.height} (need >= 2x2)`)
    const Mp = nextPow2(img.height), Np = nextPow2(img.width)
    if (Mp > 4096 || Np > 4096) throw new Error(`image too large: ${img.width}x${img.height} → padded ${Np}x${Mp}; downscale to <= 2048 first`)
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = seamlessMoisan(src, img.width, img.height, processAlpha)
    const padInfo = Mp !== img.height || Np !== img.width ? `pad ${img.width}x${img.height}→${Np}x${Mp} (reflect)` : 'pow2 native'
    info = `${img.width}x${img.height}, channels=${processAlpha ? 4 : 3}, ${padInfo}`
    return { width: out.w, height: out.h, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix: '_seamless' })

  if (res.error) return { error: res.error }
  return { image: res.image, info }
}
