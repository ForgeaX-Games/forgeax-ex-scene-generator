/**
 * image_terrain_extract — 从单张图像提取一张干净的大块纹理
 *
 * 流水线：K-means(k=5) 找主纹理聚类 + 形态学开运算得装饰物 mask →
 * Image Quilting (Efros-Freeman 2001) 在无装饰物小块上跑最小割接缝拼接 →
 * 输出 size×size 纹理。算法移植自共享电池库
 * (materials/batteries/ts/image/tiles/image_terrain_extract)，I/O 改为通过
 * `processImage`（_shared/asset2d.ts）委托后端 asset2d 服务解码/编码。
 */

import { processImage, type DecodedImage } from '../../../_shared/asset2d.js'

function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n) % n
}

function sampleWithoutReplacement(rng: () => number, n: number, k: number): Int32Array {
  const out = new Int32Array(k)
  const pool = new Int32Array(n)
  for (let i = 0; i < n; i++) pool[i] = i
  for (let i = 0; i < k; i++) {
    const j = i + randInt(rng, n - i)
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp
    out[i] = pool[i]
  }
  return out
}

function kmeansCenters(pixels: Float64Array, pixelCount: number, k: number, iters: number, rng: () => number): Float64Array {
  const idx = sampleWithoutReplacement(rng, pixelCount, k)
  const centers = new Float64Array(k * 3)
  for (let c = 0; c < k; c++) {
    centers[c * 3] = pixels[idx[c] * 3]
    centers[c * 3 + 1] = pixels[idx[c] * 3 + 1]
    centers[c * 3 + 2] = pixels[idx[c] * 3 + 2]
  }
  const labels = new Int32Array(pixelCount)
  const newCenters = new Float64Array(k * 3)
  const counts = new Int32Array(k)
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < pixelCount; i++) {
      const pr = pixels[i * 3], pg = pixels[i * 3 + 1], pb = pixels[i * 3 + 2]
      let best = 0, bestD = Infinity
      for (let c = 0; c < k; c++) {
        const dr = pr - centers[c * 3], dg = pg - centers[c * 3 + 1], db = pb - centers[c * 3 + 2]
        const d = dr * dr + dg * dg + db * db
        if (d < bestD) { bestD = d; best = c }
      }
      labels[i] = best
    }
    newCenters.fill(0); counts.fill(0)
    for (let i = 0; i < pixelCount; i++) {
      const c = labels[i]
      newCenters[c * 3] += pixels[i * 3]
      newCenters[c * 3 + 1] += pixels[i * 3 + 1]
      newCenters[c * 3 + 2] += pixels[i * 3 + 2]
      counts[c]++
    }
    let converged = true
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        newCenters[c * 3] = centers[c * 3]
        newCenters[c * 3 + 1] = centers[c * 3 + 1]
        newCenters[c * 3 + 2] = centers[c * 3 + 2]
      } else {
        newCenters[c * 3] /= counts[c]
        newCenters[c * 3 + 1] /= counts[c]
        newCenters[c * 3 + 2] /= counts[c]
      }
      if (Math.abs(newCenters[c * 3] - centers[c * 3]) > 0.5 ||
          Math.abs(newCenters[c * 3 + 1] - centers[c * 3 + 1]) > 0.5 ||
          Math.abs(newCenters[c * 3 + 2] - centers[c * 3 + 2]) > 0.5) converged = false
    }
    centers.set(newCenters)
    if (converged) break
  }
  return centers
}

function scoreCluster(center: Float64Array, c: number, population: number): number {
  const r = center[c * 3], g = center[c * 3 + 1], b = center[c * 3 + 2]
  const saturation = Math.max(r, g, b) - Math.min(r, g, b)
  const brightness = (r + g + b) / 3
  const brightPenalty = brightness > 25 && brightness < 230 ? 1.0 : 0.2
  return population * (saturation + 5.0) * brightPenalty
}

function binaryDilate(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const dst = new Uint8Array(w * h)
  const half = Math.floor(k / 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0
      const y0 = Math.max(0, y - half), y1 = Math.min(h - 1, y + half)
      const x0 = Math.max(0, x - half), x1 = Math.min(w - 1, x + half)
      for (let ny = y0; ny <= y1 && !hit; ny++) {
        for (let nx = x0; nx <= x1; nx++) { if (mask[ny * w + nx]) { hit = 1; break } }
      }
      dst[y * w + x] = hit
    }
  }
  return dst
}

function binaryErode(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const dst = new Uint8Array(w * h)
  const half = Math.floor(k / 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y - half < 0 || y + half >= h || x - half < 0 || x + half >= w) { dst[y * w + x] = 0; continue }
      let allOne = 1
      for (let ky = -half; ky <= half && allOne; ky++) {
        for (let kx = -half; kx <= half; kx++) { if (!mask[(y + ky) * w + (x + kx)]) { allOne = 0; break } }
      }
      dst[y * w + x] = allOne
    }
  }
  return dst
}

function binaryOpening(mask: Uint8Array, w: number, h: number, k: number): Uint8Array {
  if (k <= 1) return mask
  return binaryDilate(binaryErode(mask, w, h, k), w, h, k)
}

interface DecorationResult { targetColor: Float64Array; decorationMask: Uint8Array }

function dominantTerrainCluster(
  rgba: Uint8Array, w: number, h: number, k: number,
  terrainRadius: number, minDecorationSize: number, sampleCap: number, rng: () => number,
): DecorationResult {
  const N = w * h
  const opaqueIdx: number[] = []
  for (let i = 0; i < N; i++) if (rgba[i * 4 + 3] > 200) opaqueIdx.push(i)
  if (opaqueIdx.length < k) throw new Error(`too few opaque pixels (${opaqueIdx.length}) for K-means (k=${k})`)
  let sampleIdx: number[]
  if (opaqueIdx.length > sampleCap) {
    const picks = sampleWithoutReplacement(rng, opaqueIdx.length, sampleCap)
    sampleIdx = new Array(sampleCap)
    for (let i = 0; i < sampleCap; i++) sampleIdx[i] = opaqueIdx[picks[i]]
  } else sampleIdx = opaqueIdx
  const sample = new Float64Array(sampleIdx.length * 3)
  for (let i = 0; i < sampleIdx.length; i++) {
    const pi = sampleIdx[i] * 4
    sample[i * 3] = rgba[pi]; sample[i * 3 + 1] = rgba[pi + 1]; sample[i * 3 + 2] = rgba[pi + 2]
  }
  const centers = kmeansCenters(sample, sampleIdx.length, k, 20, rng)
  const populations = new Int32Array(k)
  for (let i = 0; i < sampleIdx.length; i++) {
    const pr = sample[i * 3], pg = sample[i * 3 + 1], pb = sample[i * 3 + 2]
    let best = 0, bestD = Infinity
    for (let c = 0; c < k; c++) {
      const dr = pr - centers[c * 3], dg = pg - centers[c * 3 + 1], db = pb - centers[c * 3 + 2]
      const d = dr * dr + dg * dg + db * db
      if (d < bestD) { bestD = d; best = c }
    }
    populations[best]++
  }
  let terrainLabel = 0, bestScore = -Infinity
  for (let c = 0; c < k; c++) {
    const sc = scoreCluster(centers, c, populations[c])
    if (sc > bestScore) { bestScore = sc; terrainLabel = c }
  }
  const targetColor = new Float64Array([centers[terrainLabel * 3], centers[terrainLabel * 3 + 1], centers[terrainLabel * 3 + 2]])
  const terrainLabels = new Set<number>()
  const radiusSq = terrainRadius * terrainRadius
  for (let c = 0; c < k; c++) {
    const dr = centers[c * 3] - targetColor[0], dg = centers[c * 3 + 1] - targetColor[1], db = centers[c * 3 + 2] - targetColor[2]
    if (dr * dr + dg * dg + db * db <= radiusSq) terrainLabels.add(c)
  }
  const terrainMask = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    const pi = i * 4
    const pr = rgba[pi], pg = rgba[pi + 1], pb = rgba[pi + 2]
    let best = 0, bestD = Infinity
    for (let c = 0; c < k; c++) {
      const dr = pr - centers[c * 3], dg = pg - centers[c * 3 + 1], db = pb - centers[c * 3 + 2]
      const d = dr * dr + dg * dg + db * db
      if (d < bestD) { bestD = d; best = c }
    }
    if (terrainLabels.has(best)) terrainMask[i] = 1
  }
  const opaqueMask = new Uint8Array(N)
  for (let i = 0; i < N; i++) {
    opaqueMask[i] = rgba[i * 4 + 3] > 200 ? 1 : 0
    if (!opaqueMask[i]) terrainMask[i] = 0
  }
  const nonTerrain = new Uint8Array(N)
  for (let i = 0; i < N; i++) nonTerrain[i] = !terrainMask[i] && opaqueMask[i] ? 1 : 0
  return { targetColor, decorationMask: binaryOpening(nonTerrain, w, h, minDecorationSize) }
}

function buildSAT(mask: Uint8Array, w: number, h: number): Int32Array {
  const sat = new Int32Array((h + 1) * (w + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x]
      sat[(y + 1) * (w + 1) + (x + 1)] = sat[y * (w + 1) + (x + 1)] + row
    }
  }
  return sat
}

function satCount(sat: Int32Array, w: number, y: number, x: number, size: number): number {
  const W1 = w + 1
  return sat[(y + size) * W1 + (x + size)] - sat[y * W1 + (x + size)] - sat[(y + size) * W1 + x] + sat[y * W1 + x]
}

function minCutPathLR(E: Float64Array, h: number, wPath: number): Int32Array {
  const dp = new Float64Array(h * wPath)
  const back = new Int32Array(h * wPath)
  for (let r = 0; r < h; r++) dp[r * wPath] = E[r * wPath]
  for (let j = 1; j < wPath; j++) {
    for (let r = 0; r < h; r++) {
      let best = dp[r * wPath + (j - 1)], bestRow = r
      if (r > 0 && dp[(r - 1) * wPath + (j - 1)] < best) { best = dp[(r - 1) * wPath + (j - 1)]; bestRow = r - 1 }
      if (r < h - 1 && dp[(r + 1) * wPath + (j - 1)] < best) { best = dp[(r + 1) * wPath + (j - 1)]; bestRow = r + 1 }
      dp[r * wPath + j] = E[r * wPath + j] + best
      back[r * wPath + j] = bestRow
    }
  }
  const path = new Int32Array(wPath)
  let lastRow = 0, lastVal = Infinity
  for (let r = 0; r < h; r++) {
    if (dp[r * wPath + (wPath - 1)] < lastVal) { lastVal = dp[r * wPath + (wPath - 1)]; lastRow = r }
  }
  path[wPath - 1] = lastRow
  for (let j = wPath - 2; j >= 0; j--) { lastRow = back[lastRow * wPath + (j + 1)]; path[j] = lastRow }
  return path
}

interface QuiltingResult { pixels: Uint8Array; w: number; h: number; sourcePatches: number }

function synthesizeQuilting(
  rgba: Uint8Array, decorationMask: Uint8Array, srcW: number, srcH: number,
  outputSize: number, patchSize: number, overlap: number, candidates: number,
  maxSourcePatches: number, rng: () => number,
): QuiltingResult {
  if (overlap >= patchSize) throw new Error(`overlap (${overlap}) must be < patch_size (${patchSize})`)
  if (srcH < patchSize || srcW < patchSize) throw new Error(`source ${srcW}x${srcH} smaller than patch ${patchSize}`)
  const P = patchSize, O = overlap, stride = P - O
  const sat = buildSAT(decorationMask, srcW, srcH)
  const cleanPositions: number[] = []
  for (let y = 0; y <= srcH - P; y++) {
    for (let x = 0; x <= srcW - P; x++) if (satCount(sat, srcW, y, x, P) === 0) cleanPositions.push(y, x)
  }
  let M = cleanPositions.length / 2
  if (M === 0) throw new Error(`no ${P}x${P} decoration-free patch; try smaller patch_size / larger min_decoration_size / larger terrain_radius`)
  let positions: Int32Array
  if (M > maxSourcePatches) {
    const picks = sampleWithoutReplacement(rng, M, maxSourcePatches)
    positions = new Int32Array(maxSourcePatches * 2)
    for (let i = 0; i < maxSourcePatches; i++) {
      positions[i * 2] = cleanPositions[picks[i] * 2]
      positions[i * 2 + 1] = cleanPositions[picks[i] * 2 + 1]
    }
    M = maxSourcePatches
  } else positions = new Int32Array(cleanPositions)
  const patchStride = P * P * 4
  const patches = new Uint8Array(M * patchStride)
  for (let i = 0; i < M; i++) {
    const py = positions[i * 2], px = positions[i * 2 + 1]
    for (let r = 0; r < P; r++) {
      const srcRowStart = ((py + r) * srcW + px) * 4
      patches.set(rgba.subarray(srcRowStart, srcRowStart + P * 4), i * patchStride + r * P * 4)
    }
  }
  const G = Math.max(1, Math.ceil((outputSize - O) / stride))
  const canvasSize = G * stride + O
  const canvas = new Uint8Array(canvasSize * canvasSize * 4)
  const firstIdx = randInt(rng, M) * patchStride
  for (let r = 0; r < P; r++) {
    const src = firstIdx + r * P * 4
    canvas.set(patches.subarray(src, src + P * 4), r * canvasSize * 4)
  }
  const k = Math.min(candidates, M)
  for (let row = 0; row < G; row++) {
    for (let col = 0; col < G; col++) {
      if (row === 0 && col === 0) continue
      const cy = row * stride, cx = col * stride
      const hasTop = row > 0, hasLeft = col > 0
      const ssd = new Float64Array(M)
      if (hasTop) {
        for (let r = 0; r < O; r++) {
          const canvasRow = (cy + r) * canvasSize * 4 + cx * 4
          for (let c = 0; c < P; c++) {
            const cv = canvasRow + c * 4
            const cR = canvas[cv], cG = canvas[cv + 1], cB = canvas[cv + 2]
            for (let p = 0; p < M; p++) {
              const pv = p * patchStride + (r * P + c) * 4
              const dR = patches[pv] - cR, dG = patches[pv + 1] - cG, dB = patches[pv + 2] - cB
              ssd[p] += dR * dR + dG * dG + dB * dB
            }
          }
        }
      }
      if (hasLeft) {
        const rStart = hasTop ? O : 0
        for (let r = rStart; r < P; r++) {
          const canvasRow = (cy + r) * canvasSize * 4 + cx * 4
          for (let c = 0; c < O; c++) {
            const cv = canvasRow + c * 4
            const cR = canvas[cv], cG = canvas[cv + 1], cB = canvas[cv + 2]
            for (let p = 0; p < M; p++) {
              const pv = p * patchStride + (r * P + c) * 4
              const dR = patches[pv] - cR, dG = patches[pv + 1] - cG, dB = patches[pv + 2] - cB
              ssd[p] += dR * dR + dG * dG + dB * dB
            }
          }
        }
      }
      const idxArr = new Int32Array(M)
      for (let i = 0; i < M; i++) idxArr[i] = i
      for (let i = 0; i < k; i++) {
        let minIdx = i
        for (let j = i + 1; j < M; j++) if (ssd[idxArr[j]] < ssd[idxArr[minIdx]]) minIdx = j
        const tmp = idxArr[i]; idxArr[i] = idxArr[minIdx]; idxArr[minIdx] = tmp
      }
      const chosenBase = idxArr[randInt(rng, k)] * patchStride
      const useNew = new Uint8Array(P * P)
      useNew.fill(1)
      if (hasTop) {
        const E = new Float64Array(O * P)
        for (let r = 0; r < O; r++) {
          const canvasRow = (cy + r) * canvasSize * 4 + cx * 4
          for (let c = 0; c < P; c++) {
            const cv = canvasRow + c * 4
            const pv = chosenBase + (r * P + c) * 4
            const dR = patches[pv] - canvas[cv], dG = patches[pv + 1] - canvas[cv + 1], dB = patches[pv + 2] - canvas[cv + 2]
            E[r * P + c] = dR * dR + dG * dG + dB * dB
          }
        }
        const path = minCutPathLR(E, O, P)
        for (let c = 0; c < P; c++) for (let r = 0; r < O; r++) if (r < path[c]) useNew[r * P + c] = 0
      }
      if (hasLeft) {
        const ET = new Float64Array(O * P)
        for (let r = 0; r < P; r++) {
          const canvasRow = (cy + r) * canvasSize * 4 + cx * 4
          for (let c = 0; c < O; c++) {
            const cv = canvasRow + c * 4
            const pv = chosenBase + (r * P + c) * 4
            const dR = patches[pv] - canvas[cv], dG = patches[pv + 1] - canvas[cv + 1], dB = patches[pv + 2] - canvas[cv + 2]
            ET[c * P + r] = dR * dR + dG * dG + dB * dB
          }
        }
        const path = minCutPathLR(ET, O, P)
        for (let r = 0; r < P; r++) for (let c = 0; c < O; c++) if (c < path[r]) useNew[r * P + c] = 0
      }
      for (let r = 0; r < P; r++) {
        const canvasRow = (cy + r) * canvasSize * 4 + cx * 4
        for (let c = 0; c < P; c++) {
          if (useNew[r * P + c]) {
            const cv = canvasRow + c * 4
            const pv = chosenBase + (r * P + c) * 4
            canvas[cv] = patches[pv]; canvas[cv + 1] = patches[pv + 1]
            canvas[cv + 2] = patches[pv + 2]; canvas[cv + 3] = patches[pv + 3]
          }
        }
      }
    }
  }
  const out = new Uint8Array(outputSize * outputSize * 4)
  for (let r = 0; r < outputSize; r++) {
    const srcOff = r * canvasSize * 4
    out.set(canvas.subarray(srcOff, srcOff + outputSize * 4), r * outputSize * 4)
  }
  return { pixels: out, w: outputSize, h: outputSize, sourcePatches: M }
}

function asInt(v: unknown, fallback: number, min?: number, max?: number): number {
  let n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
  if (min !== undefined) n = Math.max(min, n)
  if (max !== undefined) n = Math.min(max, n)
  return n
}

function asNum(v: unknown, fallback: number, min?: number, max?: number): number {
  let n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  if (min !== undefined) n = Math.max(min, n)
  if (max !== undefined) n = Math.min(max, n)
  return n
}

/** 纯像素地形提取：RGBA in → size×size RGBA out。导出供单测直接验证。 */
export function terrainExtractPixels(
  src: Uint8Array, width: number, height: number,
  opts: { size: number; patchSize: number; overlap: number; candidates: number; seed: number; kClusters: number; terrainRadius: number; minDecorationSize: number; maxSourcePatches: number },
): QuiltingResult {
  const rng = mulberry32(opts.seed)
  const { decorationMask } = dominantTerrainCluster(src, width, height, opts.kClusters, opts.terrainRadius, opts.minDecorationSize, 8000, rng)
  return synthesizeQuilting(src, decorationMask, width, height, opts.size, opts.patchSize, opts.overlap, opts.candidates, opts.maxSourcePatches, rng)
}

type TerrainExtractOpts = Parameters<typeof terrainExtractPixels>[3]

/** Retry with progressively relaxed patch/decoration params when high-contrast textures leave no clean patch. */
function terrainExtractWithFallback(
  src: Uint8Array, width: number, height: number, base: TerrainExtractOpts,
): QuiltingResult {
  const attempts: TerrainExtractOpts[] = [
    base,
    {
      ...base,
      minDecorationSize: Math.min(10, base.minDecorationSize + 3),
      patchSize: Math.max(8, base.patchSize - 8),
    },
    {
      ...base,
      minDecorationSize: Math.min(10, base.minDecorationSize + 5),
      patchSize: Math.max(8, base.patchSize - 16),
      terrainRadius: Math.min(200, base.terrainRadius + 30),
    },
  ]
  let lastErr: Error | undefined
  for (const opts of attempts) {
    try {
      return terrainExtractPixels(src, width, height, opts)
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (!lastErr.message.includes('decoration-free patch')) throw lastErr
    }
  }
  throw lastErr ?? new Error('terrain extract failed')
}

export async function imageTerrainExtract(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const size = asInt(input.size, 128, 16, 2048)
  const patchSize = asInt(input.patch_size, 32, 8, 128)
  const overlap = asInt(input.overlap, 6, 2, 32)
  const candidates = asInt(input.candidates, 30, 1, 200)
  const seed = asInt(input.seed, 0, 0, 2147483647)
  const kClusters = asInt(input.k_clusters, 5, 2, 12)
  const terrainRadius = asNum(input.terrain_radius, 80, 10, 200)
  const minDecorationSize = asInt(input.min_decoration_size, 3, 1, 10)
  const maxSourcePatches = asInt(input.max_source_patches, 4096, 256, 16384)
  const suffix = typeof input.suffix === 'string' && input.suffix.trim() ? input.suffix.trim() : '_terrain'

  if (overlap >= patchSize) return { image: '', width: 0, height: 0, source_patches: 0, error: `overlap (${overlap}) must be < patch_size (${patchSize})` }

  let sourcePatches = 0
  const res = processImage(input, ctx, 'image_terrain_extract', (img: DecodedImage) => {
    if (img.width < patchSize || img.height < patchSize) throw new Error(`source ${img.width}x${img.height} smaller than patch ${patchSize}; reduce patch_size`)
    const src = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
    const out = terrainExtractWithFallback(src, img.width, img.height, { size, patchSize, overlap, candidates, seed, kClusters, terrainRadius, minDecorationSize, maxSourcePatches })
    sourcePatches = out.sourcePatches
    return { width: out.w, height: out.h, data: Buffer.from(out.pixels.buffer, out.pixels.byteOffset, out.pixels.byteLength) }
  }, { suffix })

  if (res.error) return { image: '', width: 0, height: 0, source_patches: 0, error: res.error }
  return { image: res.image, width: res.width, height: res.height, source_patches: sourcePatches, error: '' }
}
