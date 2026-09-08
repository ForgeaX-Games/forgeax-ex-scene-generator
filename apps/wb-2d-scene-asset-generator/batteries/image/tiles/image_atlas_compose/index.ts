/**
 * image_atlas_compose — 用模版把纹理合成为 Wang/Autotile (cardinal-16) atlas
 *
 * 针对 forgeax_wb_scene 渲染器：所有内部格子画同一份 sprite，故 sprite 自身
 * 必须自平铺。流程：在 terrain 上滑窗找环绕接边差最小的 S×S 起点（S=模版宽÷4），
 * 对该子块逐通道 Moisan 周期分解得自平铺 sprite；所有 cell 共用该内容，模版
 * alpha 决定 mask、RGB 编码相对参考格的色调修饰。
 *
 * 算法移植自共享电池库 (materials/batteries/ts/image/tiles/image_atlas_compose)，
 * I/O 改为通过 `processImages`（_shared/asset2d.ts）委托后端 asset2d 服务
 * （terrain + template 两路输入，单路 atlas 输出）。
 */

import { createHash } from 'node:crypto'
import { processImages, type DecodedImage } from '../../../_shared/asset2d.js'

// The plugin ships ONE canonical tile template (`presets-assets/tiles/tile模板.png`,
// a 4×5 "field" mask → 64×80 atlas = the scene side's `common_16` rule). It is the
// template for virtually every tile the agent generates, so requiring callers to
// hunt down its alias+blobId and wire a separate `image_source` was pure friction
// (the `preset:` alias prefix vs the `presets` folder name tripped agents up for
// dozens of wasted tool calls). When `template` is left unconnected we now resolve
// this built-in automatically. The ref must be the `{alias,blobId}` JSON shape that
// the backend's `parseImageRef` accepts; `blobId` is the deterministic sha256 of
// `presets/<rel>` that `assets/presetAssets.ts` derives, kept in sync here.
const BUILTIN_TEMPLATE_REL = 'tiles/tile模板.png'

function builtinTemplateRef(): string {
  return JSON.stringify({
    alias: `preset:${BUILTIN_TEMPLATE_REL}`,
    blobId: createHash('sha256').update(`presets/${BUILTIN_TEMPLATE_REL}`).digest('hex'),
  })
}

function clampU8(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v)
}

function asInt(v: unknown, fallback: number, min?: number, max?: number): number {
  let n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
  if (min !== undefined) n = Math.max(min, n)
  if (max !== undefined) n = Math.min(max, n)
  return n
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v === 'true'
  return fallback
}

function medianRGB(rgbList: Uint8Array, count: number): [number, number, number] {
  if (count === 0) return [0, 0, 0]
  const med: number[] = [0, 0, 0]
  const buf = new Float64Array(count)
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < count; i++) buf[i] = rgbList[i * 3 + c]
    const arr = Array.from(buf).sort((a, b) => a - b)
    med[c] = count % 2 === 1 ? arr[(count - 1) >> 1] : 0.5 * (arr[(count >> 1) - 1] + arr[count >> 1])
  }
  return [med[0], med[1], med[2]]
}

function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

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
    const wRe0 = Math.cos(ang), wIm0 = Math.sin(ang)
    for (let i = 0; i < n; i += size) {
      let wRe = 1, wIm = 0
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half
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

function dft1dGeneric(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  const outRe = new Float64Array(n), outIm = new Float64Array(n)
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
  const rowRe = new Float64Array(N), rowIm = new Float64Array(N)
  for (let i = 0; i < M; i++) {
    const off = i * N
    for (let j = 0; j < N; j++) { rowRe[j] = re[off + j]; rowIm[j] = im[off + j] }
    transform1d(rowRe, rowIm, inverse)
    for (let j = 0; j < N; j++) { re[off + j] = rowRe[j]; im[off + j] = rowIm[j] }
  }
  const colRe = new Float64Array(M), colIm = new Float64Array(M)
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < M; i++) { colRe[i] = re[i * N + j]; colIm[i] = im[i * N + j] }
    transform1d(colRe, colIm, inverse)
    for (let i = 0; i < M; i++) { re[i * N + j] = colRe[i]; im[i * N + j] = colIm[i] }
  }
}

function moisanPeriodic(u: Float64Array, M: number, N: number): Float64Array {
  const vRe = new Float64Array(M * N), vIm = new Float64Array(M * N)
  for (let j = 0; j < N; j++) {
    const d = u[(M - 1) * N + j] - u[j]
    vRe[j] += d; vRe[(M - 1) * N + j] -= d
  }
  for (let i = 0; i < M; i++) {
    const off = i * N
    const d = u[off + (N - 1)] - u[off]
    vRe[off] += d; vRe[off + (N - 1)] -= d
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

function boundaryDiscontinuity(terrain: Uint8Array, terrainW: number, ox: number, oy: number, S: number): number {
  let score = 0
  const topRow = oy * terrainW
  const botRow = (oy + S - 1) * terrainW
  for (let x = 0; x < S; x++) {
    const ti = (topRow + ox + x) * 4
    const bi = (botRow + ox + x) * 4
    const dr = terrain[ti] - terrain[bi], dg = terrain[ti + 1] - terrain[bi + 1], db = terrain[ti + 2] - terrain[bi + 2]
    score += dr * dr + dg * dg + db * db
  }
  for (let y = 0; y < S; y++) {
    const row = (oy + y) * terrainW
    const li = (row + ox) * 4
    const ri = (row + ox + S - 1) * 4
    const dr = terrain[li] - terrain[ri], dg = terrain[li + 1] - terrain[ri + 1], db = terrain[li + 2] - terrain[ri + 2]
    score += dr * dr + dg * dg + db * db
  }
  return score
}

function findLowDiscontinuityOffset(terrain: Uint8Array, terrainW: number, terrainH: number, S: number): { ox: number; oy: number } {
  if (terrainW < S || terrainH < S) throw new Error(`terrain ${terrainW}x${terrainH} smaller than required patch ${S}x${S} (need >= cellW=${S} in both dims)`)
  const maxOx = terrainW - S, maxOy = terrainH - S
  if (maxOx === 0 && maxOy === 0) return { ox: 0, oy: 0 }
  let bestScore = Infinity, bestOx = Math.floor(maxOx / 2), bestOy = Math.floor(maxOy / 2)
  for (let oy = 0; oy <= maxOy; oy++) {
    for (let ox = 0; ox <= maxOx; ox++) {
      const s = boundaryDiscontinuity(terrain, terrainW, ox, oy, S)
      if (s < bestScore) { bestScore = s; bestOx = ox; bestOy = oy }
    }
  }
  return { ox: bestOx, oy: bestOy }
}

function extractSelfTileablePatch(terrain: Uint8Array, terrainW: number, terrainH: number, S: number): Uint8Array {
  const { ox, oy } = findLowDiscontinuityOffset(terrain, terrainW, terrainH, S)
  const patch = new Uint8Array(S * S * 4)
  for (let y = 0; y < S; y++) {
    const sy = oy + y
    for (let x = 0; x < S; x++) {
      const si = (sy * terrainW + (ox + x)) * 4
      const di = (y * S + x) * 4
      patch[di] = terrain[si]; patch[di + 1] = terrain[si + 1]
      patch[di + 2] = terrain[si + 2]; patch[di + 3] = terrain[si + 3]
    }
  }
  const u = new Float64Array(S * S)
  for (let ch = 0; ch < 3; ch++) {
    for (let i = 0; i < S * S; i++) u[i] = patch[i * 4 + ch]
    const p = moisanPeriodic(u, S, S)
    for (let i = 0; i < S * S; i++) patch[i * 4 + ch] = clampU8(p[i])
  }
  return patch
}

interface InteriorRefResult { ref: [number, number, number]; refCellUsed: number; refPixelCount: number }

function deriveInteriorRef(tpl: Uint8Array, tplW: number, cellW: number, cellH: number, numCells: number, thr: number, preferredCell: number): InteriorRefResult {
  const tryCell = (idx: number): InteriorRefResult | null => {
    if (idx < 0 || idx >= numCells) return null
    const r = Math.floor(idx / 4), c = idx % 4
    const buf = new Uint8Array(cellW * cellH * 3)
    let count = 0
    for (let y = 0; y < cellH; y++) {
      const ty = r * cellH + y
      for (let x = 0; x < cellW; x++) {
        const ti = (ty * tplW + (c * cellW + x)) * 4
        if (tpl[ti + 3] >= thr) {
          buf[count * 3] = tpl[ti]; buf[count * 3 + 1] = tpl[ti + 1]; buf[count * 3 + 2] = tpl[ti + 2]
          count++
        }
      }
    }
    if (count === 0) return null
    return { ref: medianRGB(buf, count), refCellUsed: idx, refPixelCount: count }
  }
  const primary = tryCell(preferredCell)
  if (primary) return primary
  for (let i = 0; i < numCells; i++) {
    if (i === preferredCell) continue
    const fallback = tryCell(i)
    if (fallback) return fallback
  }
  throw new Error(`template has no inside pixels (alpha >= ${thr}) in any of the ${numCells} cells; check the template or lower alpha_threshold`)
}

function compositeTile(
  spriteContent: Uint8Array, tpl: Uint8Array, tplW: number,
  cellW: number, cellH: number, cellR: number, cellC: number, thr: number,
  applyTone: boolean, refR: number, refG: number, refB: number,
): Uint8Array {
  const out = new Uint8Array(cellW * cellH * 4)
  const invR = 1 / Math.max(1e-3, refR), invG = 1 / Math.max(1e-3, refG), invB = 1 / Math.max(1e-3, refB)
  for (let y = 0; y < cellH; y++) {
    const ty = cellR * cellH + y
    for (let x = 0; x < cellW; x++) {
      const ti = (ty * tplW + (cellC * cellW + x)) * 4
      const ci = (y * cellW + x) * 4
      if (tpl[ti + 3] < thr) continue
      let r = spriteContent[ci], g = spriteContent[ci + 1], b = spriteContent[ci + 2]
      if (applyTone) {
        r = clampU8(r * (tpl[ti] * invR))
        g = clampU8(g * (tpl[ti + 1] * invG))
        b = clampU8(b * (tpl[ti + 2] * invB))
      }
      out[ci] = r; out[ci + 1] = g; out[ci + 2] = b; out[ci + 3] = spriteContent[ci + 3]
    }
  }
  return out
}

function stitchAtlas(tiles: Uint8Array[], cellW: number, cellH: number, numRows: number): Uint8Array {
  const W = cellW * 4
  const H = cellH * numRows
  const out = new Uint8Array(W * H * 4)
  for (let i = 0; i < tiles.length; i++) {
    const r = Math.floor(i / 4), c = i % 4
    const tile = tiles[i]
    for (let y = 0; y < cellH; y++) {
      const dstStart = ((r * cellH + y) * W + c * cellW) * 4
      const srcStart = y * cellW * 4
      out.set(tile.subarray(srcStart, srcStart + cellW * 4), dstStart)
    }
  }
  return out
}

/**
 * 纯像素 atlas 合成：[terrain, template] RGBA → atlas RGBA。导出供单测验证。
 *
 * ⚠️ 名称的 `_` 前缀是刻意的、不能去掉：battery loader 取模块「首个导出的、名字以
 * 小写字母开头的函数」(正则 `/^[a-z]/`，见
 * packages/node-runtime/src/layer1/loader/battery-loader.ts) 作为 op execute 入口，
 * 而 ESM 命名空间按字母序枚举。若叫 `composeAtlas` 会排在真正入口 `imageAtlasCompose`
 * 之前被误选为 execute——届时整个 input 当 terrain、ctx 当 template，
 * `template.width` 为 undefined → 抛 `template width undefined must be divisible by 4`，
 * 节点永远失败。`_` 前缀落在正则之外，确保唯一 execute 候选是 `imageAtlasCompose`。
 */
export function _composeAtlas(
  terrain: DecodedImage, template: DecodedImage,
  alphaThreshold: number, applyTone: boolean, refCell: number,
): { pixels: Uint8Array; w: number; h: number; terrainSize: number } {
  if (template.width % 4 !== 0) throw new Error(`template width ${template.width} must be divisible by 4 (4-column grid)`)
  const cellW = template.width / 4
  const cellH = cellW
  if (template.height % cellH !== 0) throw new Error(`template ${template.width}x${template.height}: height must be a multiple of cellW=${cellW}`)
  const numRows = template.height / cellH
  if (numRows < 1) throw new Error(`template too small: needs >= 1 row of cells, got ${numRows}`)
  const numCells = 4 * numRows
  const atlasW = template.width, atlasH = template.height
  const terrainBuf = new Uint8Array(terrain.data.buffer, terrain.data.byteOffset, terrain.data.byteLength)
  const templateBuf = new Uint8Array(template.data.buffer, template.data.byteOffset, template.data.byteLength)
  const refInfo = deriveInteriorRef(templateBuf, atlasW, cellW, cellH, numCells, alphaThreshold, refCell)
  const [refR, refG, refB] = refInfo.ref
  const spriteContent = extractSelfTileablePatch(terrainBuf, terrain.width, terrain.height, cellW)
  const tiles: Uint8Array[] = new Array(numCells)
  for (let i = 0; i < numCells; i++) {
    const r = Math.floor(i / 4), c = i % 4
    tiles[i] = compositeTile(spriteContent, templateBuf, atlasW, cellW, cellH, r, c, alphaThreshold, applyTone, refR, refG, refB)
  }
  const atlas = stitchAtlas(tiles, cellW, cellH, numRows)
  return { pixels: atlas, w: atlasW, h: atlasH, terrainSize: Math.min(terrain.width, terrain.height) }
}

export async function imageAtlasCompose(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  // 总开关：关闭时跳过加工，所有端口返回空（不产生任何输出值）。
  if (!asBool(input.enable, true)) return {}

  const alphaThreshold = asInt(input.alpha_threshold, 127, 0, 255)
  const applyTone = asBool(input.apply_tone, true)
  const refCell = asInt(input.ref_cell, 6, 0, 63)

  // Default the template to the shipped built-in (common_16 / 64×80) when the
  // `template` port is left unconnected, so the common case needs no template
  // source node at all. An explicitly-wired template ref always wins.
  const templateRef = typeof input.template === 'string' ? input.template.trim() : ''
  const effectiveInput = templateRef ? input : { ...input, template: builtinTemplateRef() }

  let terrainSize = 0
  const res = processImages(effectiveInput, ctx, 'image_atlas_compose', ['terrain', 'template'], (imgs: DecodedImage[]) => {
    const [terrain, template] = imgs
    const out = _composeAtlas(terrain, template, alphaThreshold, applyTone, refCell)
    terrainSize = out.terrainSize
    return { width: out.w, height: out.h, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix: '_atlas' })

  if (res.error) return { image: '', width: 0, height: 0, terrain_size: 0, error: res.error }
  return { image: res.image, width: res.width, height: res.height, terrain_size: terrainSize, error: '' }
}
