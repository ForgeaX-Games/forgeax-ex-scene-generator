/**
 * cliff_atlas_extract — 从任意含悬崖的源图像 + 一张悬崖模版合成一张全新的悬崖 atlas
 *
 * 端口自 Tilemap/Ours/ours/cliff_extract.py + extract.py + quilting.py + cliff.py.
 * 输出尺寸/形状与模版完全一致, 适用于 ours.cliff.render_cliff 类型的 2.5D 悬崖渲染器.
 *
 * 模版约定 (canonical CLIFF_SPRITES, 见 ours/cliff.py):
 *   原生尺寸 50×82 (3 列 × 5 行, 列宽 17|16|17, 行高 17|16|17|16|16).
 *   本电池接受 50k × 82k 的整数倍模版, 自动把 sprite 网格按 k 缩放, 输出 atlas 与
 *   模版同尺寸. 模版自身是 RGBA:
 *     · alpha 通道 = 每个 sprite 的形状 mask (透明区域 = 不绘制)
 *     · RGB    通道 = 每像素的 "亮度修饰" 编码 (cell_lum / ref_lum 重建出来的色调)
 *
 * 流水线 (4 stage):
 *   Stage A  segmentCliffImage(source):
 *            K-means k=2 (opaque-only) → 亮簇 = plateau, 暗簇 = facade 候选.
 *            形态学闭运算补 plateau 边缘, 连通块 < min_plateau_area 丢弃.
 *            facade = 暗簇 ∩ {plateau 下方 facade_search_height 行内} ∩ 非 plateau ∩
 *                     非 plateau 紧贴下方 1 行 (杀掉 K-means 在边界处的"halo").
 *            形态学闭+开清掉 facade 噪声, 估计 facade 带高度 (每列最长连续 True 段
 *            长度的中位数).
 *
 *   Stage B  extractPlateauTerrain(source, plateauMask):
 *            Image Quilting (Efros-Freeman 2001) 限制在 plateau 像素上 (decoration
 *            mask = ~plateau_mask). 输出 N×N 拼接画布. 最后 Moisan 2011 周期+平滑
 *            分解使其严格无缝. 给 Stage D toroidal 采样用.
 *
 *   Stage C  extractFacadeStrip(source, facadeMask):
 *            1-D Image Quilting 沿 facade 弧形带: SAT 枚举满足 coverage 的 facade
 *            块 → 左到右放置 → 重叠带 SSD + min-cut 接缝 → 裁剪到 target_width →
 *            逐行 1-D Moisan 让首尾接边 (水平 tileable). 给 Stage D toroidal 采样用.
 *
 *   Stage D  buildCliffTemplateData(template) + bakeAtlas(...):
 *            对模版做同一套 segmentCliffImage + 单向饱和度回流 (refineTemplateMasks).
 *            回流: 把 facade 簇里满足 [sat > thr & hue 靠 plateau & 紧贴 plateau 下方]
 *            的像素移回 plateau 簇 — 这是为了把 facade sprite 顶端的 "scallop"
 *            (色相属于 plateau, 但 RGB 距离更近 facade) 正确归到 plateau material.
 *            单向以防 plateau 高光乱跳到 facade.
 *            recompute plateau/facade 参考色 → 对每个 sprite cell 抽出
 *              mask        = alpha 通道
 *              source_flag = 1 (facade) / 0 (plateau), 透明像素回落到 sprite 区域默认
 *              modifier    = clip(cell_lum / ref_lum, 0, 2)  (标量, 保色相)
 *            然后逐 sprite:
 *              · facade sprite (9,10,11): 从 facade strip 采样
 *              · variant  sprite (12,13,14): plateau 采样起点随机
 *              · 其它: plateau toroidal 采样起点 = (sprite.x, sprite.y),
 *                      facade  toroidal 采样起点 = (sprite.x, 0) — 让相邻 sprite
 *                      读到连续 stretch, 内部接缝消失
 *              · 逐像素 flag==1 → rgb_f, flag==0 → rgb_p, 乘 modifier (clip),
 *                通过 mask alpha 印出到 atlas[sprite.y..sprite.y+sh, sprite.x..sprite.x+sw]
 *
 * 鲁棒性:
 *   - 模版 width % 50 != 0 或 height != width * 82 / 50: 返回 error
 *   - 模版 / 源图 不是 RGBA 或太小: 返回 error
 *   - source K-means 分不出两类 / facade 像素为 0: 返回 error
 *   - facade quilting 找不到任何 coverage ≥ threshold 的 patch: 自动放宽到 0.9 / 0.75 / 0.5
 *   - 所有浮点 → uint8 全部 clip 到 [0, 255]
 */

import { processImages, type DecodedImage } from '../../../_shared/asset2d.js'

// ─── 通用小工具 ──────────────────────────────────────────────────────────────

function clampU8(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

function asInt(v: unknown, fallback: number, min?: number, max?: number): number {
  let n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  if (min !== undefined) n = Math.max(min, n);
  if (max !== undefined) n = Math.min(max, n);
  return n;
}

function asNum(v: unknown, fallback: number, min?: number, max?: number): number {
  let n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  if (min !== undefined) n = Math.max(min, n);
  if (max !== undefined) n = Math.min(max, n);
  return n;
}

/** mulberry32: tiny seedable PRNG. 同 image_terrain_extract 一致, 保证可复现. */
function mulberry32(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n) % n;
}

/** 不放回采样 k 个 [0, n) 的唯一索引 (k <= n). */
function sampleWithoutReplacement(rng: () => number, n: number, k: number): Int32Array {
  const out = new Int32Array(k);
  const pool = new Int32Array(n);
  for (let i = 0; i < n; i++) pool[i] = i;
  for (let i = 0; i < k; i++) {
    const j = i + randInt(rng, n - i);
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    out[i] = pool[i];
  }
  return out;
}

// ─── FFT / Moisan 2011《Periodic plus Smooth Image Decomposition》 ──────────
// 端口自 make_seamless_moisan/index.ts. 完整推导见那里; 这里只放精简内联版.

function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** 原地 1D radix-2 Cooley-Tukey FFT/iFFT (要求 n = 2^k). */
function fft1dPow2(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const ang = (inverse ? 2 : -2) * Math.PI / size;
    const wRe0 = Math.cos(ang);
    const wIm0 = Math.sin(ang);
    for (let i = 0; i < n; i += size) {
      let wRe = 1, wIm = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tRe = wRe * re[b] - wIm * im[b];
        const tIm = wRe * im[b] + wIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nwRe = wRe * wRe0 - wIm * wIm0;
        wIm = wRe * wIm0 + wIm * wRe0;
        wRe = nwRe;
      }
    }
  }
  if (inverse) {
    const inv = 1 / n;
    for (let i = 0; i < n; i++) { re[i] *= inv; im[i] *= inv; }
  }
}

/** O(n²) DFT 回退路径 (非 2 的幂尺寸). */
function dft1dGeneric(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  const sign = inverse ? 1 : -1;
  for (let k = 0; k < n; k++) {
    let sRe = 0, sIm = 0;
    for (let t = 0; t < n; t++) {
      const a = sign * 2 * Math.PI * k * t / n;
      const c = Math.cos(a), s = Math.sin(a);
      sRe += re[t] * c - im[t] * s;
      sIm += re[t] * s + im[t] * c;
    }
    outRe[k] = sRe;
    outIm[k] = sIm;
  }
  const inv = inverse ? 1 / n : 1;
  for (let i = 0; i < n; i++) { re[i] = outRe[i] * inv; im[i] = outIm[i] * inv; }
}

function transform1d(re: Float64Array, im: Float64Array, inverse: boolean): void {
  if (isPow2(re.length)) fft1dPow2(re, im, inverse);
  else dft1dGeneric(re, im, inverse);
}

function fft2d(re: Float64Array, im: Float64Array, M: number, N: number, inverse: boolean): void {
  const rowRe = new Float64Array(N);
  const rowIm = new Float64Array(N);
  for (let i = 0; i < M; i++) {
    const off = i * N;
    for (let j = 0; j < N; j++) { rowRe[j] = re[off + j]; rowIm[j] = im[off + j]; }
    transform1d(rowRe, rowIm, inverse);
    for (let j = 0; j < N; j++) { re[off + j] = rowRe[j]; im[off + j] = rowIm[j]; }
  }
  const colRe = new Float64Array(M);
  const colIm = new Float64Array(M);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < M; i++) { colRe[i] = re[i * N + j]; colIm[i] = im[i * N + j]; }
    transform1d(colRe, colIm, inverse);
    for (let i = 0; i < M; i++) { re[i * N + j] = colRe[i]; im[i * N + j] = colIm[i]; }
  }
}

/** 2D Moisan: 返回单通道周期分量 p = u - s. */
function moisanPeriodic2D(u: Float64Array, M: number, N: number): Float64Array {
  const vRe = new Float64Array(M * N);
  const vIm = new Float64Array(M * N);
  for (let j = 0; j < N; j++) {
    const d = u[(M - 1) * N + j] - u[j];
    vRe[j] += d;
    vRe[(M - 1) * N + j] -= d;
  }
  for (let i = 0; i < M; i++) {
    const off = i * N;
    const d = u[off + (N - 1)] - u[off];
    vRe[off] += d;
    vRe[off + (N - 1)] -= d;
  }
  fft2d(vRe, vIm, M, N, false);

  const cosM = new Float64Array(M);
  for (let k = 0; k < M; k++) cosM[k] = Math.cos((2 * Math.PI * k) / M);
  const cosN = new Float64Array(N);
  for (let l = 0; l < N; l++) cosN[l] = Math.cos((2 * Math.PI * l) / N);

  for (let k = 0; k < M; k++) {
    const off = k * N;
    const c1 = 2 * cosM[k];
    for (let l = 0; l < N; l++) {
      const idx = off + l;
      if (k === 0 && l === 0) { vRe[idx] = 0; vIm[idx] = 0; continue; }
      const denom = c1 + 2 * cosN[l] - 4;
      vRe[idx] /= denom;
      vIm[idx] /= denom;
    }
  }
  fft2d(vRe, vIm, M, N, true);

  const p = new Float64Array(M * N);
  for (let i = 0; i < M * N; i++) p[i] = u[i] - vRe[i];
  return p;
}

/** 对 RGBA buffer 做逐通道 Moisan (alpha 不动). 输入/输出均 (M*N*4) uint8. */
function makeSeamlessRGBA(buf: Uint8Array, M: number, N: number): Uint8Array {
  const out = new Uint8Array(buf);
  const u = new Float64Array(M * N);
  for (let ch = 0; ch < 3; ch++) {
    for (let i = 0; i < M * N; i++) u[i] = buf[i * 4 + ch];
    const p = moisanPeriodic2D(u, M, N);
    for (let i = 0; i < M * N; i++) out[i * 4 + ch] = clampU8(p[i]);
  }
  return out;
}

/** 1-D 逐行 Moisan: 修 strip 的左右接边而不动垂直结构 (scallop 顶 + drip 底). */
function rowWiseMoisanRGBA(buf: Uint8Array, h: number, w: number): Uint8Array {
  const out = new Uint8Array(buf);
  const cos2pi = new Float64Array(w);
  for (let k = 0; k < w; k++) cos2pi[k] = Math.cos((2 * Math.PI * k) / w);

  const u = new Float64Array(w);
  for (let ch = 0; ch < 3; ch++) {
    for (let r = 0; r < h; r++) {
      const rowOff = r * w * 4;
      for (let c = 0; c < w; c++) u[c] = buf[rowOff + c * 4 + ch];
      // 1D Moisan: V[0] = u[w-1] - u[0], V[w-1] = -d, 其余 0; S_hat = V / denom; s = ifft(S_hat); p = u - s
      const vRe = new Float64Array(w);
      const vIm = new Float64Array(w);
      const d = u[w - 1] - u[0];
      vRe[0] += d;
      vRe[w - 1] -= d;
      transform1d(vRe, vIm, false);
      for (let k = 0; k < w; k++) {
        if (k === 0) { vRe[k] = 0; vIm[k] = 0; continue; }
        const denom = 2 * cos2pi[k] - 2;
        vRe[k] /= denom;
        vIm[k] /= denom;
      }
      transform1d(vRe, vIm, true);
      for (let c = 0; c < w; c++) {
        out[rowOff + c * 4 + ch] = clampU8(u[c] - vRe[c]);
      }
    }
  }
  return out;
}

// ─── 二值形态学 (closing / opening, 任意 iteration) ──────────────────────────
// scipy.ndimage 默认结构元 = 3x3 cross (即 4-connected). 与 Python 严格对齐.

/** 3×3 cross (4-connected) dilation 1 次. */
function binaryDilateCross(mask: Uint8Array, w: number, h: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = mask[y * w + x];
      if (!v) {
        if (y > 0     && mask[(y - 1) * w + x]) v = 1;
        else if (y + 1 < h && mask[(y + 1) * w + x]) v = 1;
        else if (x > 0     && mask[y * w + (x - 1)]) v = 1;
        else if (x + 1 < w && mask[y * w + (x + 1)]) v = 1;
      }
      dst[y * w + x] = v;
    }
  }
  return dst;
}

/** 3×3 cross erosion 1 次 (边界视为 0, 与 scipy 默认 border_value=0 一致). */
function binaryErodeCross(mask: Uint8Array, w: number, h: number): Uint8Array {
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) { dst[y * w + x] = 0; continue; }
      if (y === 0 || y === h - 1 || x === 0 || x === w - 1) {
        dst[y * w + x] = 0;
        continue;
      }
      const ok =
        mask[(y - 1) * w + x] &&
        mask[(y + 1) * w + x] &&
        mask[y * w + (x - 1)] &&
        mask[y * w + (x + 1)];
      dst[y * w + x] = ok ? 1 : 0;
    }
  }
  return dst;
}

/** scipy.ndimage.binary_closing: iter 次 dilate → iter 次 erode. */
function binaryClosing(mask: Uint8Array, w: number, h: number, iters: number): Uint8Array {
  let cur = mask;
  for (let i = 0; i < iters; i++) cur = binaryDilateCross(cur, w, h);
  for (let i = 0; i < iters; i++) cur = binaryErodeCross(cur, w, h);
  return cur;
}

/** scipy.ndimage.binary_opening: iter 次 erode → iter 次 dilate. */
function binaryOpening(mask: Uint8Array, w: number, h: number, iters: number): Uint8Array {
  let cur = mask;
  for (let i = 0; i < iters; i++) cur = binaryErodeCross(cur, w, h);
  for (let i = 0; i < iters; i++) cur = binaryDilateCross(cur, w, h);
  return cur;
}

/**
 * 4-连通 connected components labeling.
 * 返回 (labels, count). labels[i] = 0 表示背景, 1..count 表示组件 id.
 * 算法: 两遍扫描 + Union-Find, O(N · α(N)).
 */
function labelComponents4(mask: Uint8Array, w: number, h: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h);
  const parent: number[] = [0]; // parent[0] is unused (id 0 = background)

  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra; else parent[ra] = rb;
  };

  let nextId = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const up   = y > 0 ? labels[(y - 1) * w + x] : 0;
      const left = x > 0 ? labels[y * w + (x - 1)] : 0;
      if (up === 0 && left === 0) {
        labels[y * w + x] = nextId;
        parent.push(nextId);
        nextId++;
      } else if (up !== 0 && left === 0) {
        labels[y * w + x] = up;
      } else if (up === 0 && left !== 0) {
        labels[y * w + x] = left;
      } else {
        const m = Math.min(up, left);
        labels[y * w + x] = m;
        if (up !== left) union(up, left);
      }
    }
  }

  // 第二遍: 把每个像素的 label 替换为其 root, 同时压缩 root 到密集 id [1..count].
  const rootToId = new Map<number, number>();
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    if (!labels[i]) continue;
    const r = find(labels[i]);
    let id = rootToId.get(r);
    if (id === undefined) {
      count++;
      id = count;
      rootToId.set(r, id);
    }
    labels[i] = id;
  }
  return { labels, count };
}

// ─── K-means k=2 (用于 cliff 分割) ───────────────────────────────────────────

/**
 * 对 (M, 3) 像素样本做 K-means (Forgy 初始化 + Lloyd 迭代).
 * 返回 (k, 3) 聚类中心. 与 ours/extract.py 的 _kmeans_centers 严格对齐.
 */
function kmeansCenters(
  pixels: Float64Array, // length = M*3
  pixelCount: number,
  k: number,
  iters: number,
  rng: () => number,
): Float64Array {
  const idx = sampleWithoutReplacement(rng, pixelCount, k);
  const centers = new Float64Array(k * 3);
  for (let c = 0; c < k; c++) {
    centers[c * 3]     = pixels[idx[c] * 3];
    centers[c * 3 + 1] = pixels[idx[c] * 3 + 1];
    centers[c * 3 + 2] = pixels[idx[c] * 3 + 2];
  }
  const labels = new Int32Array(pixelCount);
  const newCenters = new Float64Array(k * 3);
  const counts = new Int32Array(k);

  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < pixelCount; i++) {
      const pr = pixels[i * 3], pg = pixels[i * 3 + 1], pb = pixels[i * 3 + 2];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = pr - centers[c * 3];
        const dg = pg - centers[c * 3 + 1];
        const db = pb - centers[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      labels[i] = best;
    }
    newCenters.fill(0);
    counts.fill(0);
    for (let i = 0; i < pixelCount; i++) {
      const c = labels[i];
      newCenters[c * 3]     += pixels[i * 3];
      newCenters[c * 3 + 1] += pixels[i * 3 + 1];
      newCenters[c * 3 + 2] += pixels[i * 3 + 2];
      counts[c]++;
    }
    let converged = true;
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        newCenters[c * 3]     = centers[c * 3];
        newCenters[c * 3 + 1] = centers[c * 3 + 1];
        newCenters[c * 3 + 2] = centers[c * 3 + 2];
      } else {
        newCenters[c * 3]     /= counts[c];
        newCenters[c * 3 + 1] /= counts[c];
        newCenters[c * 3 + 2] /= counts[c];
      }
      if (
        Math.abs(newCenters[c * 3]     - centers[c * 3])     > 0.5 ||
        Math.abs(newCenters[c * 3 + 1] - centers[c * 3 + 1]) > 0.5 ||
        Math.abs(newCenters[c * 3 + 2] - centers[c * 3 + 2]) > 0.5
      ) converged = false;
    }
    centers.set(newCenters);
    if (converged) break;
  }
  return centers;
}

// ─── Stage A: segmentCliffImage ──────────────────────────────────────────────

interface CliffSegmentation {
  plateauMask: Uint8Array;
  facadeMask: Uint8Array;
  plateauColor: [number, number, number]; // raw K-means center (alpha-only)
  facadeColor: [number, number, number];
  facadeHeightPx: number;
  w: number;
  h: number;
}

/** 把 mask 沿"向下"方向膨胀 n 行 (每个像素 True iff 其上方 n 行内任一像素 True). */
function verticalDilateDown(mask: Uint8Array, w: number, h: number, n: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let dy = 1; dy <= n; dy++) {
    if (dy >= h) break;
    for (let y = dy; y < h; y++) {
      const src = (y - dy) * w;
      const dst = y * w;
      for (let x = 0; x < w; x++) {
        if (mask[src + x]) out[dst + x] = 1;
      }
    }
  }
  return out;
}

/** 估计 facade 带高度 (每列最长连续 True 段长度的中位数). */
function estimateFacadeHeight(mask: Uint8Array, w: number, h: number): number {
  const heights: number[] = [];
  for (let x = 0; x < w; x++) {
    let best = 0, run = 0, any = false;
    for (let y = 0; y < h; y++) {
      if (mask[y * w + x]) {
        run++;
        any = true;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
    if (any && best > 0) heights.push(best);
  }
  if (heights.length === 0) return 0;
  heights.sort((a, b) => a - b);
  const m = heights.length;
  return m % 2 === 1
    ? heights[(m - 1) >> 1]
    : Math.floor((heights[(m >> 1) - 1] + heights[m >> 1]) / 2);
}

function segmentCliffImage(
  rgba: Uint8Array,
  w: number,
  h: number,
  facadeSearchHeight: number,
  minPlateauArea: number,
  rng: () => number,
): CliffSegmentation {
  const N = w * h;

  // 收集不透明像素 (alpha > 200)
  const opaque = new Uint8Array(N);
  const opaqueIdx: number[] = [];
  for (let i = 0; i < N; i++) {
    if (rgba[i * 4 + 3] > 200) { opaque[i] = 1; opaqueIdx.push(i); }
  }
  if (opaqueIdx.length < 8) {
    throw new Error('Source image has no opaque pixels to cluster (need at least 8).');
  }

  // 在不透明像素上做 K-means k=2
  const sampleCap = 8000;
  let sampleIdx: number[];
  if (opaqueIdx.length > sampleCap) {
    const picks = sampleWithoutReplacement(rng, opaqueIdx.length, sampleCap);
    sampleIdx = new Array(sampleCap);
    for (let i = 0; i < sampleCap; i++) sampleIdx[i] = opaqueIdx[picks[i]];
  } else {
    sampleIdx = opaqueIdx;
  }
  const sample = new Float64Array(sampleIdx.length * 3);
  for (let i = 0; i < sampleIdx.length; i++) {
    const pi = sampleIdx[i] * 4;
    sample[i * 3]     = rgba[pi];
    sample[i * 3 + 1] = rgba[pi + 1];
    sample[i * 3 + 2] = rgba[pi + 2];
  }
  const centers = kmeansCenters(sample, sampleIdx.length, 2, 20, rng);

  // 亮 = plateau, 暗 = facade. Rec.601 灰度.
  const lum0 = 0.299 * centers[0] + 0.587 * centers[1] + 0.114 * centers[2];
  const lum1 = 0.299 * centers[3] + 0.587 * centers[4] + 0.114 * centers[5];
  const plateauLbl = lum0 >= lum1 ? 0 : 1;
  const facadeLbl  = plateauLbl === 0 ? 1 : 0;
  const plateauColor: [number, number, number] = [
    centers[plateauLbl * 3], centers[plateauLbl * 3 + 1], centers[plateauLbl * 3 + 2],
  ];
  const facadeColor: [number, number, number] = [
    centers[facadeLbl * 3], centers[facadeLbl * 3 + 1], centers[facadeLbl * 3 + 2],
  ];

  // 全分辨率分类 (transparent 像素归入 label 但不算 plateau/facade)
  let plateauRaw = new Uint8Array(N);
  let facadeRaw  = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!opaque[i]) continue;
    const pi = i * 4;
    const pr = rgba[pi], pg = rgba[pi + 1], pb = rgba[pi + 2];
    const d0 = (pr - centers[0]) ** 2 + (pg - centers[1]) ** 2 + (pb - centers[2]) ** 2;
    const d1 = (pr - centers[3]) ** 2 + (pg - centers[4]) ** 2 + (pb - centers[5]) ** 2;
    const lbl = d0 <= d1 ? 0 : 1;
    if (lbl === plateauLbl) plateauRaw[i] = 1;
    else facadeRaw[i] = 1;
  }

  // 1 次闭运算把 plateau 边缘的暗"齿"补回 plateau (与 Python iterations=1 一致)
  let plateauMask = binaryClosing(plateauRaw, w, h, 1);

  // 连通块 < minPlateauArea 丢弃 (噪声)
  const { labels: plabels, count: pCount } = labelComponents4(plateauMask, w, h);
  if (pCount > 0) {
    const sizes = new Int32Array(pCount + 1);
    for (let i = 0; i < N; i++) {
      if (plabels[i]) sizes[plabels[i]]++;
    }
    let keep = new Uint8Array(pCount + 1);
    let anyKept = false;
    for (let id = 1; id <= pCount; id++) {
      if (sizes[id] >= minPlateauArea) { keep[id] = 1; anyKept = true; }
    }
    if (!anyKept) {
      // 至少保留最大那一块
      let argmax = 1;
      for (let id = 2; id <= pCount; id++) if (sizes[id] > sizes[argmax]) argmax = id;
      keep = new Uint8Array(pCount + 1);
      keep[argmax] = 1;
    }
    const filtered = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (plabels[i] && keep[plabels[i]]) filtered[i] = 1;
    }
    plateauMask = filtered;
  }

  // facade "ring trick": facade = (darker cluster) ∩ (plateau 下方 search 行内)
  //                       ∩ (非 plateau) ∩ (非 plateau 紧贴下方 1 行)
  const dilStrict = verticalDilateDown(plateauMask, w, h, facadeSearchHeight);
  const dilClose  = verticalDilateDown(plateauMask, w, h, 1);
  let facadeMask: Uint8Array = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    facadeMask[i] = (
      facadeRaw[i] &&
      dilStrict[i] &&
      !plateauMask[i] &&
      !dilClose[i]
    ) ? 1 : 0;
  }
  // 形态学 close + open 清理噪声
  facadeMask = binaryClosing(facadeMask, w, h, 1);
  facadeMask = binaryOpening(facadeMask, w, h, 1);
  // 丢弃 facade 噪声 (阈值 = max(16, minPlateauArea/4))
  const fThr = Math.max(16, Math.floor(minPlateauArea / 4));
  const { labels: flabels, count: fCount } = labelComponents4(facadeMask, w, h);
  if (fCount > 0) {
    const sizes = new Int32Array(fCount + 1);
    for (let i = 0; i < N; i++) if (flabels[i]) sizes[flabels[i]]++;
    let keep = new Uint8Array(fCount + 1);
    let anyKept = false;
    for (let id = 1; id <= fCount; id++) {
      if (sizes[id] >= fThr) { keep[id] = 1; anyKept = true; }
    }
    if (!anyKept) {
      let argmax = 1;
      for (let id = 2; id <= fCount; id++) if (sizes[id] > sizes[argmax]) argmax = id;
      keep = new Uint8Array(fCount + 1);
      keep[argmax] = 1;
    }
    const filtered = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (flabels[i] && keep[flabels[i]]) filtered[i] = 1;
    }
    facadeMask = filtered;
  }

  let facadeHeightPx = estimateFacadeHeight(facadeMask, w, h);
  if (facadeHeightPx <= 0) facadeHeightPx = 16;

  return { plateauMask, facadeMask, plateauColor, facadeColor, facadeHeightPx, w, h };
}

// ─── Min-cut DP (用于 Stage B/C quilting 接缝) ──────────────────────────────

/**
 * 从左到右找一条单调路径 path[j] for j ∈ [0, W),
 * 使 sum E[path[j], j] 最小, 约束 |path[j+1] - path[j]| ≤ 1.
 * E shape: (H, W) 行主序; 返回 length=W 的 Int32Array.
 */
function minCutPathLR(E: Float64Array, H: number, W: number): Int32Array {
  const dp = new Float64Array(H * W);
  const back = new Int32Array(H * W);
  for (let r = 0; r < H; r++) dp[r * W] = E[r * W];

  for (let j = 1; j < W; j++) {
    for (let r = 0; r < H; r++) {
      let best = dp[r * W + (j - 1)];
      let bestRow = r;
      if (r > 0 && dp[(r - 1) * W + (j - 1)] < best) {
        best = dp[(r - 1) * W + (j - 1)];
        bestRow = r - 1;
      }
      if (r < H - 1 && dp[(r + 1) * W + (j - 1)] < best) {
        best = dp[(r + 1) * W + (j - 1)];
        bestRow = r + 1;
      }
      dp[r * W + j] = E[r * W + j] + best;
      back[r * W + j] = bestRow;
    }
  }
  const path = new Int32Array(W);
  let lastRow = 0, lastVal = Infinity;
  for (let r = 0; r < H; r++) {
    const v = dp[r * W + (W - 1)];
    if (v < lastVal) { lastVal = v; lastRow = r; }
  }
  path[W - 1] = lastRow;
  for (let j = W - 2; j >= 0; j--) {
    lastRow = back[lastRow * W + (j + 1)];
    path[j] = lastRow;
  }
  return path;
}

// ─── Stage B: extractPlateauTerrain (Image Quilting + 2D Moisan) ─────────────

/**
 * 端口自 ours.quilting.synthesize_quilting (decoration-aware).
 * 返回 (outputSize × outputSize × 4) RGBA Uint8.
 */
function synthesizeQuilting(
  rgba: Uint8Array,
  decorationMask: Uint8Array, // 1 = 必须避开的像素
  srcW: number,
  srcH: number,
  outputSize: number,
  patchSize: number,
  overlap: number,
  candidates: number,
  maxSourcePatches: number,
  rng: () => number,
): Uint8Array {
  if (overlap >= patchSize) {
    throw new Error(`overlap (${overlap}) must be < patch_size (${patchSize}).`);
  }
  if (srcW < patchSize || srcH < patchSize) {
    throw new Error(
      `Source ${srcW}x${srcH} smaller than patch ${patchSize}x${patchSize}; reduce patch_size.`,
    );
  }

  const P = patchSize;
  const O = overlap;
  const stride = P - O;

  // SAT 枚举无装饰物 P×P 源块
  const sat = new Int32Array((srcH + 1) * (srcW + 1));
  for (let y = 0; y < srcH; y++) {
    let row = 0;
    for (let x = 0; x < srcW; x++) {
      row += decorationMask[y * srcW + x];
      sat[(y + 1) * (srcW + 1) + (x + 1)] = sat[y * (srcW + 1) + (x + 1)] + row;
    }
  }
  const W1 = srcW + 1;
  const satCount = (y: number, x: number, size: number): number =>
    sat[(y + size) * W1 + (x + size)]
    - sat[y * W1 + (x + size)]
    - sat[(y + size) * W1 + x]
    + sat[y * W1 + x];

  const cleanPositions: number[] = [];
  for (let y = 0; y <= srcH - P; y++) {
    for (let x = 0; x <= srcW - P; x++) {
      if (satCount(y, x, P) === 0) cleanPositions.push(y, x);
    }
  }
  let M = cleanPositions.length / 2;
  if (M === 0) {
    throw new Error(
      `No ${P}x${P} plateau-only patch in the source — try smaller patch_size, or check that the source has a plateau region at all.`,
    );
  }

  let positions: Int32Array;
  if (M > maxSourcePatches) {
    const picks = sampleWithoutReplacement(rng, M, maxSourcePatches);
    positions = new Int32Array(maxSourcePatches * 2);
    for (let i = 0; i < maxSourcePatches; i++) {
      positions[i * 2]     = cleanPositions[picks[i] * 2];
      positions[i * 2 + 1] = cleanPositions[picks[i] * 2 + 1];
    }
    M = maxSourcePatches;
  } else {
    positions = new Int32Array(cleanPositions);
  }

  // 把候选块预先拷贝成 (M, P*P*4) 扁平 uint8
  const patchStride = P * P * 4;
  const patches = new Uint8Array(M * patchStride);
  for (let i = 0; i < M; i++) {
    const py = positions[i * 2];
    const px = positions[i * 2 + 1];
    for (let r = 0; r < P; r++) {
      const src = ((py + r) * srcW + px) * 4;
      const dst = i * patchStride + r * P * 4;
      patches.set(rgba.subarray(src, src + P * 4), dst);
    }
  }

  // 画布 (放下整数个 stride + O), 最后裁到 outputSize
  const G = Math.max(1, Math.ceil((outputSize - O) / stride));
  const canvasSize = G * stride + O;
  const canvas = new Uint8Array(canvasSize * canvasSize * 4);

  // 第一个块随机
  const firstBase = randInt(rng, M) * patchStride;
  for (let r = 0; r < P; r++) {
    canvas.set(
      patches.subarray(firstBase + r * P * 4, firstBase + (r + 1) * P * 4),
      r * canvasSize * 4,
    );
  }

  const k = Math.min(candidates, M);
  const idxArr = new Int32Array(M);

  for (let row = 0; row < G; row++) {
    for (let col = 0; col < G; col++) {
      if (row === 0 && col === 0) continue;
      const cy = row * stride;
      const cx = col * stride;
      const hasTop = row > 0;
      const hasLeft = col > 0;

      // 计算每候选块在 L 形重叠带上的 SSD
      const ssd = new Float64Array(M);
      if (hasTop) {
        for (let r = 0; r < O; r++) {
          const canvasRow = (cy + r) * canvasSize * 4 + cx * 4;
          for (let c = 0; c < P; c++) {
            const cv = canvasRow + c * 4;
            const cR = canvas[cv], cG = canvas[cv + 1], cB = canvas[cv + 2];
            for (let p = 0; p < M; p++) {
              const pv = p * patchStride + (r * P + c) * 4;
              const dR = patches[pv]     - cR;
              const dG = patches[pv + 1] - cG;
              const dB = patches[pv + 2] - cB;
              ssd[p] += dR * dR + dG * dG + dB * dB;
            }
          }
        }
      }
      if (hasLeft) {
        const rStart = hasTop ? O : 0;
        for (let r = rStart; r < P; r++) {
          const canvasRow = (cy + r) * canvasSize * 4 + cx * 4;
          for (let c = 0; c < O; c++) {
            const cv = canvasRow + c * 4;
            const cR = canvas[cv], cG = canvas[cv + 1], cB = canvas[cv + 2];
            for (let p = 0; p < M; p++) {
              const pv = p * patchStride + (r * P + c) * 4;
              const dR = patches[pv]     - cR;
              const dG = patches[pv + 1] - cG;
              const dB = patches[pv + 2] - cB;
              ssd[p] += dR * dR + dG * dG + dB * dB;
            }
          }
        }
      }

      // 部分排序选 SSD 最低的前 K, 然后均匀抽一个
      for (let i = 0; i < M; i++) idxArr[i] = i;
      for (let i = 0; i < k; i++) {
        let minIdx = i;
        for (let j = i + 1; j < M; j++) {
          if (ssd[idxArr[j]] < ssd[idxArr[minIdx]]) minIdx = j;
        }
        const tmp = idxArr[i]; idxArr[i] = idxArr[minIdx]; idxArr[minIdx] = tmp;
      }
      const chosenBase = idxArr[randInt(rng, k)] * patchStride;

      // 计算 use_new mask: 默认全 True, 在重叠带上用 min-cut 接缝覆盖
      const useNew = new Uint8Array(P * P);
      useNew.fill(1);

      if (hasTop) {
        const E = new Float64Array(O * P);
        for (let r = 0; r < O; r++) {
          const canvasRow = (cy + r) * canvasSize * 4 + cx * 4;
          for (let c = 0; c < P; c++) {
            const cv = canvasRow + c * 4;
            const pv = chosenBase + (r * P + c) * 4;
            const dR = patches[pv]     - canvas[cv];
            const dG = patches[pv + 1] - canvas[cv + 1];
            const dB = patches[pv + 2] - canvas[cv + 2];
            E[r * P + c] = dR * dR + dG * dG + dB * dB;
          }
        }
        const path = minCutPathLR(E, O, P);
        for (let c = 0; c < P; c++) {
          for (let r = 0; r < O; r++) {
            if (r < path[c]) useNew[r * P + c] = 0;
          }
        }
      }
      if (hasLeft) {
        const ET = new Float64Array(O * P);
        for (let r = 0; r < P; r++) {
          const canvasRow = (cy + r) * canvasSize * 4 + cx * 4;
          for (let c = 0; c < O; c++) {
            const cv = canvasRow + c * 4;
            const pv = chosenBase + (r * P + c) * 4;
            const dR = patches[pv]     - canvas[cv];
            const dG = patches[pv + 1] - canvas[cv + 1];
            const dB = patches[pv + 2] - canvas[cv + 2];
            ET[c * P + r] = dR * dR + dG * dG + dB * dB;
          }
        }
        const path = minCutPathLR(ET, O, P);
        for (let r = 0; r < P; r++) {
          for (let c = 0; c < O; c++) {
            if (c < path[r]) useNew[r * P + c] = 0;
          }
        }
      }

      for (let r = 0; r < P; r++) {
        const canvasRow = (cy + r) * canvasSize * 4 + cx * 4;
        for (let c = 0; c < P; c++) {
          if (useNew[r * P + c]) {
            const cv = canvasRow + c * 4;
            const pv = chosenBase + (r * P + c) * 4;
            canvas[cv]     = patches[pv];
            canvas[cv + 1] = patches[pv + 1];
            canvas[cv + 2] = patches[pv + 2];
            canvas[cv + 3] = patches[pv + 3];
          }
        }
      }
    }
  }

  // 裁到 outputSize × outputSize
  const out = new Uint8Array(outputSize * outputSize * 4);
  for (let r = 0; r < outputSize; r++) {
    out.set(
      canvas.subarray(r * canvasSize * 4, r * canvasSize * 4 + outputSize * 4),
      r * outputSize * 4,
    );
  }
  return out;
}

function extractPlateauTerrain(
  rgba: Uint8Array,
  w: number,
  h: number,
  plateauMask: Uint8Array,
  outputSize: number,
  patchSize: number,
  overlap: number,
  candidates: number,
  rng: () => number,
): Uint8Array {
  // decoration_mask = ~plateau_mask
  const decoration = new Uint8Array(plateauMask.length);
  for (let i = 0; i < plateauMask.length; i++) decoration[i] = plateauMask[i] ? 0 : 1;

  const tile = synthesizeQuilting(
    rgba, decoration, w, h, outputSize, patchSize, overlap, candidates, 4096, rng,
  );
  return makeSeamlessRGBA(tile, outputSize, outputSize);
}

// ─── Stage C: extractFacadeStrip (1-D Quilting + row-wise Moisan) ────────────

/** 枚举 facade_mask 中满足 coverage 阈值的 (row, col) patch 位置. */
function enumerateFacadePatches(
  mask: Uint8Array,
  W: number,
  H: number,
  hPatch: number,
  wPatch: number,
  coverage: number,
): { rows: Int32Array; cols: Int32Array } {
  if (H < hPatch || W < wPatch) {
    return { rows: new Int32Array(0), cols: new Int32Array(0) };
  }
  const sat = new Int32Array((H + 1) * (W + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += mask[y * W + x];
      sat[(y + 1) * (W + 1) + (x + 1)] = sat[y * (W + 1) + (x + 1)] + row;
    }
  }
  const W1 = W + 1;
  const threshold = Math.ceil(coverage * hPatch * wPatch);
  const rs: number[] = [];
  const cs: number[] = [];
  for (let y = 0; y <= H - hPatch; y++) {
    for (let x = 0; x <= W - wPatch; x++) {
      const cnt =
        sat[(y + hPatch) * W1 + (x + wPatch)]
        - sat[y * W1 + (x + wPatch)]
        - sat[(y + hPatch) * W1 + x]
        + sat[y * W1 + x];
      if (cnt >= threshold) { rs.push(y); cs.push(x); }
    }
  }
  return { rows: Int32Array.from(rs), cols: Int32Array.from(cs) };
}

function extractFacadeStrip(
  rgba: Uint8Array,
  w: number,
  h: number,
  facadeMask: Uint8Array,
  facadeHeight: number,
  targetWidth: number,
  patchWidth: number,
  overlap: number,
  candidates: number,
  coverageThreshold: number,
  rng: () => number,
): Uint8Array {
  let pw = patchWidth;
  let ov = overlap;
  if (pw >= targetWidth) pw = Math.floor(targetWidth / 2);
  if (ov >= pw) ov = Math.max(2, Math.floor(pw / 4));
  const hh = facadeHeight;

  let positions = enumerateFacadePatches(facadeMask, w, h, hh, pw, coverageThreshold);
  if (positions.rows.length === 0 && coverageThreshold > 0.5) {
    for (const relax of [0.9, 0.75, 0.5]) {
      positions = enumerateFacadePatches(facadeMask, w, h, hh, pw, relax);
      if (positions.rows.length > 0) break;
    }
  }
  if (positions.rows.length === 0) {
    throw new Error(
      `No ${pw}x${hh} facade-only patch found in source. ` +
      'Try lowering facade_height, facade_patch_width, or facade_coverage.',
    );
  }

  let nPos = positions.rows.length;
  const maxKeep = 2048;
  if (nPos > maxKeep) {
    const picks = sampleWithoutReplacement(rng, nPos, maxKeep);
    const rs = new Int32Array(maxKeep);
    const cs = new Int32Array(maxKeep);
    for (let i = 0; i < maxKeep; i++) {
      rs[i] = positions.rows[picks[i]];
      cs[i] = positions.cols[picks[i]];
    }
    positions = { rows: rs, cols: cs };
    nPos = maxKeep;
  }

  // 预拷贝 patches: (nPos, hh, pw, 4) 扁平 uint8
  const patchStride = hh * pw * 4;
  const patches = new Uint8Array(nPos * patchStride);
  for (let i = 0; i < nPos; i++) {
    const py = positions.rows[i];
    const px = positions.cols[i];
    for (let r = 0; r < hh; r++) {
      const src = ((py + r) * w + px) * 4;
      const dst = i * patchStride + r * pw * 4;
      patches.set(rgba.subarray(src, src + pw * 4), dst);
    }
  }

  const stride = pw - ov;
  const G = Math.max(1, Math.ceil((targetWidth - ov) / stride));
  const canvasW = G * stride + ov;
  const canvas = new Uint8Array(hh * canvasW * 4);

  // 第一个块随机放在 col 0
  const firstBase = randInt(rng, nPos) * patchStride;
  for (let r = 0; r < hh; r++) {
    canvas.set(
      patches.subarray(firstBase + r * pw * 4, firstBase + (r + 1) * pw * 4),
      r * canvasW * 4,
    );
  }

  const kCand = Math.min(candidates, nPos);
  const idxArr = new Int32Array(nPos);

  for (let colIdx = 1; colIdx < G; colIdx++) {
    const cx = colIdx * stride;
    // SSD 仅在左侧 (hh, ov) 重叠带上
    const ssd = new Float64Array(nPos);
    for (let r = 0; r < hh; r++) {
      const canvasRow = r * canvasW * 4 + cx * 4;
      for (let c = 0; c < ov; c++) {
        const cv = canvasRow + c * 4;
        const cR = canvas[cv], cG = canvas[cv + 1], cB = canvas[cv + 2];
        for (let p = 0; p < nPos; p++) {
          const pv = p * patchStride + (r * pw + c) * 4;
          const dR = patches[pv]     - cR;
          const dG = patches[pv + 1] - cG;
          const dB = patches[pv + 2] - cB;
          ssd[p] += dR * dR + dG * dG + dB * dB;
        }
      }
    }
    for (let i = 0; i < nPos; i++) idxArr[i] = i;
    for (let i = 0; i < kCand; i++) {
      let minIdx = i;
      for (let j = i + 1; j < nPos; j++) {
        if (ssd[idxArr[j]] < ssd[idxArr[minIdx]]) minIdx = j;
      }
      const tmp = idxArr[i]; idxArr[i] = idxArr[minIdx]; idxArr[minIdx] = tmp;
    }
    const chosenBase = idxArr[randInt(rng, kCand)] * patchStride;

    // Min-cut left seam: E shape (hh, ov), 转置成 (ov, hh) 跑 LR
    const ET = new Float64Array(ov * hh);
    for (let r = 0; r < hh; r++) {
      const canvasRow = r * canvasW * 4 + cx * 4;
      for (let c = 0; c < ov; c++) {
        const cv = canvasRow + c * 4;
        const pv = chosenBase + (r * pw + c) * 4;
        const dR = patches[pv]     - canvas[cv];
        const dG = patches[pv + 1] - canvas[cv + 1];
        const dB = patches[pv + 2] - canvas[cv + 2];
        ET[c * hh + r] = dR * dR + dG * dG + dB * dB;
      }
    }
    const path = minCutPathLR(ET, ov, hh);
    const useNew = new Uint8Array(hh * pw);
    useNew.fill(1);
    for (let r = 0; r < hh; r++) {
      for (let c = 0; c < ov; c++) {
        if (c < path[r]) useNew[r * pw + c] = 0;
      }
    }
    for (let r = 0; r < hh; r++) {
      const canvasRow = r * canvasW * 4 + cx * 4;
      for (let c = 0; c < pw; c++) {
        if (useNew[r * pw + c]) {
          const cv = canvasRow + c * 4;
          const pv = chosenBase + (r * pw + c) * 4;
          canvas[cv]     = patches[pv];
          canvas[cv + 1] = patches[pv + 1];
          canvas[cv + 2] = patches[pv + 2];
          canvas[cv + 3] = patches[pv + 3];
        }
      }
    }
  }

  // 裁到 targetWidth
  const strip = new Uint8Array(hh * targetWidth * 4);
  for (let r = 0; r < hh; r++) {
    strip.set(
      canvas.subarray(r * canvasW * 4, r * canvasW * 4 + targetWidth * 4),
      r * targetWidth * 4,
    );
  }

  return rowWiseMoisanRGBA(strip, hh, targetWidth);
}

// ─── Stage D: 模版数据 (mask + flag + modifier) ──────────────────────────────

interface Sprite {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Canonical 50×82 CLIFF_SPRITES, 端口自 ours/cliff.py.
 *   行 0  y= 0  height=17  plateau 顶边 (上方无 plateau)
 *   行 1  y=17  height=16  plateau 中部
 *   行 2  y=33  height=17  plateau 底边 (下方无 plateau)
 *   行 3  y=50  height=16  facade 墙面 (索引 9/10/11)
 *   行 4  y=66  height=16  variants 替换 sprite 4 (索引 12/13/14)
 * 列宽 17|16|17, x = 0|17|33. Variant 行的 sprite 12 起点 x=1 (与 Python 一致).
 */
const CLIFF_SPRITES_NATIVE: readonly Sprite[] = [
  { x:  0, y:  0, w: 17, h: 17 },
  { x: 17, y:  0, w: 16, h: 17 },
  { x: 33, y:  0, w: 17, h: 17 },
  { x:  0, y: 17, w: 17, h: 16 },
  { x: 17, y: 17, w: 16, h: 16 },
  { x: 33, y: 17, w: 17, h: 16 },
  { x:  0, y: 33, w: 17, h: 17 },
  { x: 17, y: 33, w: 16, h: 17 },
  { x: 33, y: 33, w: 17, h: 17 },
  { x:  0, y: 50, w: 17, h: 16 },
  { x: 17, y: 50, w: 16, h: 16 },
  { x: 33, y: 50, w: 17, h: 16 },
  { x:  1, y: 66, w: 16, h: 16 },
  { x: 17, y: 66, w: 16, h: 16 },
  { x: 33, y: 66, w: 16, h: 16 },
];

const FACADE_SPRITE_INDICES = new Set([9, 10, 11]);
const VARIANT_SPRITE_INDICES = new Set([12, 13, 14]);

type Region = 'facade' | 'variant' | 'plateau';
function spriteRegion(idx: number): Region {
  if (FACADE_SPRITE_INDICES.has(idx)) return 'facade';
  if (VARIANT_SPRITE_INDICES.has(idx)) return 'variant';
  return 'plateau';
}

/** 把 (idx, ...) 按 facade idx 顺序映射: 9→0, 10→1, 11→2. */
function facadeIdxInRow(idx: number): number {
  return idx === 9 ? 0 : idx === 10 ? 1 : 2;
}

/**
 * 单向 facade → plateau 回流, 把 facade 簇里 (sat > thr & 色相靠 plateau &
 * 紧贴 plateau 下方 proximityRows 行内) 的像素移回 plateau. 这把 facade
 * sprite 顶端的 scallop (色相属 plateau, RGB 距离误判到 facade) 正确归类.
 */
function refineTemplateMasks(
  rgba: Uint8Array,
  w: number,
  h: number,
  plateauIn: Uint8Array,
  facadeIn: Uint8Array,
  plateauRef: [number, number, number],
  facadeRef: [number, number, number],
  satThreshold: number,
  proximityRows: number,
): { plateau: Uint8Array; facade: Uint8Array } {
  const N = w * h;
  const plateau = new Uint8Array(plateauIn);
  const facade  = new Uint8Array(facadeIn);

  const pNorm = Math.hypot(plateauRef[0], plateauRef[1], plateauRef[2]) + 1e-6;
  const fNorm = Math.hypot(facadeRef[0],  facadeRef[1],  facadeRef[2])  + 1e-6;
  const pN = [plateauRef[0] / pNorm, plateauRef[1] / pNorm, plateauRef[2] / pNorm];
  const fN = [facadeRef[0]  / fNorm, facadeRef[1]  / fNorm, facadeRef[2]  / fNorm];

  const nearPlateau = verticalDilateDown(plateauIn, w, h, proximityRows);

  for (let i = 0; i < N; i++) {
    if (!facade[i]) continue;
    if (!nearPlateau[i]) continue;
    const pi = i * 4;
    const r = rgba[pi], g = rgba[pi + 1], b = rgba[pi + 2];
    const cmax = Math.max(r, g, b), cmin = Math.min(r, g, b);
    const sat = (cmax - cmin) / Math.max(cmax, 1.0);
    if (sat <= satThreshold) continue;
    const norm = Math.hypot(r, g, b) + 1e-6;
    const dirR = r / norm, dirG = g / norm, dirB = b / norm;
    const simP = dirR * pN[0] + dirG * pN[1] + dirB * pN[2];
    const simF = dirR * fN[0] + dirG * fN[1] + dirB * fN[2];
    if (simP > simF) {
      plateau[i] = 1;
      facade[i] = 0;
    }
  }

  return { plateau, facade };
}

interface CliffTemplateData {
  w: number;
  h: number;
  scale: number; // = w / 50
  sprites: readonly Sprite[]; // CLIFF_SPRITES_NATIVE × scale
  masks: Float32Array[];    // [numSprites] (sh*sw) ∈ [0, 1]
  modifiers: Float32Array[]; // [numSprites] (sh*sw) ∈ [0, 2], 标量
  sourceFlags: Uint8Array[]; // [numSprites] (sh*sw) 0=plateau 1=facade
}

function buildCliffTemplateData(
  rgba: Uint8Array,
  w: number,
  h: number,
  facadeSearchHeight: number,
  satThreshold: number,
  proximityRows: number,
  rng: () => number,
): CliffTemplateData {
  // 模版尺寸约定: w = 50k, h = 82k, k 为正整数
  if (w % 50 !== 0 || h % 82 !== 0 || w / 50 !== h / 82) {
    throw new Error(
      `Template ${w}x${h} is not a canonical cliff template. ` +
      `Expected width=50k, height=82k for integer k≥1 (e.g. 50x82, 100x164, 150x246). ` +
      `Got width/50=${w / 50}, height/82=${h / 82}.`,
    );
  }
  const scale = w / 50;
  const sprites: Sprite[] = CLIFF_SPRITES_NATIVE.map(s => ({
    x: s.x * scale, y: s.y * scale, w: s.w * scale, h: s.h * scale,
  }));

  // 边界检查 (理论上模版尺寸正确就一定 ok, 安全起见再校一次)
  for (let i = 0; i < sprites.length; i++) {
    const s = sprites[i];
    if (s.x < 0 || s.y < 0 || s.x + s.w > w || s.y + s.h > h) {
      throw new Error(
        `Sprite #${i} (${s.x},${s.y},${s.w}x${s.h}) out of template bounds ${w}x${h}.`,
      );
    }
  }

  const seg = segmentCliffImage(rgba, w, h, facadeSearchHeight, 64, rng);

  // 计算 plateau / facade raw reference (refined 前)
  const N = w * h;
  let pSumR = 0, pSumG = 0, pSumB = 0, pCount = 0;
  let fSumR = 0, fSumG = 0, fSumB = 0, fCount = 0;
  for (let i = 0; i < N; i++) {
    const pi = i * 4;
    if (seg.plateauMask[i]) {
      pSumR += rgba[pi]; pSumG += rgba[pi + 1]; pSumB += rgba[pi + 2]; pCount++;
    }
    if (seg.facadeMask[i]) {
      fSumR += rgba[pi]; fSumG += rgba[pi + 1]; fSumB += rgba[pi + 2]; fCount++;
    }
  }
  if (pCount === 0) throw new Error('Cliff template has no plateau pixels after segmentation.');
  if (fCount === 0) throw new Error('Cliff template has no facade pixels after segmentation.');
  const pRef0: [number, number, number] = [pSumR / pCount, pSumG / pCount, pSumB / pCount];
  const fRef0: [number, number, number] = [fSumR / fCount, fSumG / fCount, fSumB / fCount];

  const { plateau: plateauR, facade: facadeR } = refineTemplateMasks(
    rgba, w, h, seg.plateauMask, seg.facadeMask, pRef0, fRef0, satThreshold, proximityRows,
  );

  // 用 refined mask 重新算参考色
  pSumR = pSumG = pSumB = 0; pCount = 0;
  fSumR = fSumG = fSumB = 0; fCount = 0;
  for (let i = 0; i < N; i++) {
    const pi = i * 4;
    if (plateauR[i]) {
      pSumR += rgba[pi]; pSumG += rgba[pi + 1]; pSumB += rgba[pi + 2]; pCount++;
    }
    if (facadeR[i]) {
      fSumR += rgba[pi]; fSumG += rgba[pi + 1]; fSumB += rgba[pi + 2]; fCount++;
    }
  }
  const pRef: [number, number, number] = pCount > 0
    ? [pSumR / pCount, pSumG / pCount, pSumB / pCount] : pRef0;
  const fRef: [number, number, number] = fCount > 0
    ? [fSumR / fCount, fSumG / fCount, fSumB / fCount] : fRef0;

  const plateauLum = Math.max(0.299 * pRef[0] + 0.587 * pRef[1] + 0.114 * pRef[2], 1.0);
  const facadeLum  = Math.max(0.299 * fRef[0] + 0.587 * fRef[1] + 0.114 * fRef[2], 1.0);

  const masks: Float32Array[] = [];
  const modifiers: Float32Array[] = [];
  const sourceFlags: Uint8Array[] = [];

  for (let idx = 0; idx < sprites.length; idx++) {
    const s = sprites[idx];
    const sh = s.h, sw = s.w;
    const mask = new Float32Array(sh * sw);
    const mod  = new Float32Array(sh * sw);
    const flag = new Uint8Array(sh * sw);
    const regionDefault = spriteRegion(idx) === 'facade' ? 1 : 0;

    for (let yy = 0; yy < sh; yy++) {
      const ty = s.y + yy;
      for (let xx = 0; xx < sw; xx++) {
        const tx = s.x + xx;
        const ti = (ty * w + tx) * 4;
        const ci = yy * sw + xx;
        const alpha01 = rgba[ti + 3] / 255.0;
        mask[ci] = alpha01;

        const fac = facadeR[ty * w + tx];
        const plat = plateauR[ty * w + tx];
        let f: number;
        if (fac) f = 1;
        else if (plat) f = 0;
        else f = regionDefault;
        if (alpha01 <= 0.01) f = regionDefault;
        flag[ci] = f;

        const refLum = f === 1 ? facadeLum : plateauLum;
        const cellLum = 0.299 * rgba[ti] + 0.587 * rgba[ti + 1] + 0.114 * rgba[ti + 2];
        let m = cellLum / refLum;
        if (m < 0) m = 0; else if (m > 2) m = 2;
        if (alpha01 <= 0.01) m = 1.0;
        mod[ci] = m;
      }
    }

    masks.push(mask);
    modifiers.push(mod);
    sourceFlags.push(flag);
  }

  return { w, h, scale, sprites, masks, modifiers, sourceFlags };
}

// ─── Atlas baking (build_cliff_atlas_from_template) ──────────────────────────

/** Toroidal sample: 在 (srcW × srcH × 4) RGBA 上, 从 (ox, oy) 起始绕回采 (sh × sw × 4). */
function wrapSample(
  src: Uint8Array, srcW: number, srcH: number,
  ox: number, oy: number, sh: number, sw: number,
): Uint8Array {
  const out = new Uint8Array(sh * sw * 4);
  const ox0 = ((ox % srcW) + srcW) % srcW;
  const oy0 = ((oy % srcH) + srcH) % srcH;
  for (let yy = 0; yy < sh; yy++) {
    const sy = (oy0 + yy) % srcH;
    for (let xx = 0; xx < sw; xx++) {
      const sx = (ox0 + xx) % srcW;
      const si = (sy * srcW + sx) * 4;
      const di = (yy * sw + xx) * 4;
      out[di]     = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return out;
}

function bakeAtlas(
  plateauTerrain: Uint8Array, terrainW: number, terrainH: number,
  facadeStrip: Uint8Array, facadeStripW: number, facadeStripH: number,
  tpl: CliffTemplateData,
  rng: () => number,
): Uint8Array {
  const W = tpl.w, H = tpl.h;
  const atlas = new Uint8Array(W * H * 4); // 全 0 (RGBA(0,0,0,0))

  for (let idx = 0; idx < tpl.sprites.length; idx++) {
    const s = tpl.sprites[idx];
    const sh = s.h, sw = s.w;
    const mask = tpl.masks[idx];
    const mod  = tpl.modifiers[idx];
    const flag = tpl.sourceFlags[idx];
    const region = spriteRegion(idx);

    // facade 采样起点
    let xOffF: number, yOffF: number;
    if (region === 'facade') {
      const fi = facadeIdxInRow(idx);
      xOffF = fi * sw;
      yOffF = facadeStripH >= sh ? facadeStripH - sh : 0;
    } else {
      xOffF = s.x;
      yOffF = 0;
    }
    const facadeMat = wrapSample(facadeStrip, facadeStripW, facadeStripH, xOffF, yOffF, sh, sw);

    // plateau 采样起点
    let oxP: number, oyP: number;
    if (region === 'variant') {
      oxP = randInt(rng, terrainW);
      oyP = randInt(rng, terrainH);
    } else {
      oxP = s.x; oyP = s.y;
    }
    const plateauMat = wrapSample(plateauTerrain, terrainW, terrainH, oxP, oyP, sh, sw);

    // 逐像素合成 → 写入 atlas[s.y..s.y+sh, s.x..s.x+sw]
    for (let yy = 0; yy < sh; yy++) {
      for (let xx = 0; xx < sw; xx++) {
        const ci = yy * sw + xx;
        const ai = ((s.y + yy) * W + (s.x + xx)) * 4;

        const f = flag[ci];
        const m = mod[ci];
        const rgbBase = f === 1 ? facadeMat : plateauMat;
        const bi = ci * 4;

        atlas[ai]     = clampU8(rgbBase[bi]     * m);
        atlas[ai + 1] = clampU8(rgbBase[bi + 1] * m);
        atlas[ai + 2] = clampU8(rgbBase[bi + 2] * m);

        // alpha = max(existing, mask*255)
        const a = clampU8(mask[ci] * 255.0);
        if (a > atlas[ai + 3]) atlas[ai + 3] = a;
      }
    }
  }
  return atlas;
}

// ─── 电池入口 ────────────────────────────────────────────────────────────────

function failOutput(error: string): Record<string, unknown> {
  return {
    image: '', width: 0, height: 0,
    plateau_pixels: 0, facade_pixels: 0, facade_height_detected: 0,
    error,
  };
}

export async function cliffAtlasExtract(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  // 总开关：关闭时跳过加工，所有端口返回空（不产生任何输出值）。
  const enable = typeof input.enable === 'boolean'
    ? input.enable
    : typeof input.enable === 'string'
      ? input.enable === 'true'
      : true;
  if (!enable) return {};

  const sourceAlias   = typeof input.image    === 'string' ? input.image.trim()    : '';
  const templateAlias = typeof input.template === 'string' ? input.template.trim() : '';
  if (!sourceAlias)   return failOutput('image (source) alias is required');
  if (!templateAlias) return failOutput('template alias is required');

  // Stage B (plateau) params
  const terrainSize    = asInt(input.terrain_size,         128, 32, 512);
  const patchSize      = asInt(input.patch_size,            16,  6,  64);
  const overlap        = asInt(input.overlap,                4,  2,  16);
  const candidates     = asInt(input.candidates,            30,  1, 200);
  const quiltingSeed   = asInt(input.quilting_seed,          0,  0, 2147483647);

  // Stage C (facade) params
  const facadeHeightIn = asInt(input.facade_height,         16,  0,  64);
  const facadeWidth    = asInt(input.facade_width,         128, 16, 1024);
  const facadePW       = asInt(input.facade_patch_width,    16,  4, 128);
  const facadeOverlap  = asInt(input.facade_overlap,         4,  1,  32);
  const facadeCand     = asInt(input.facade_candidates,     10,  1, 100);
  const facadeCoverage = asNum(input.facade_coverage,      1.0, 0.3, 1.0);
  const facadeSeed     = asInt(input.facade_seed,            0,  0, 2147483647);

  // Stage D / baking
  const variantSeed    = asInt(input.variant_seed,           1,  0, 2147483647);

  // Stage A
  const facadeSearchH  = asInt(input.facade_search_height,  24,  4, 128);
  const minPlateauArea = asInt(input.min_plateau_area,      64,  4, 4096);

  // refine
  const satThr         = asNum(input.sat_reclassify_threshold, 0.30, 0.0, 1.0);
  const proxRows       = asInt(input.reclassify_proximity_rows,  5,  1,  64);

  if (overlap >= patchSize) {
    return failOutput(`overlap (${overlap}) must be < patch_size (${patchSize}).`);
  }
  if (terrainSize < patchSize) {
    return failOutput(`terrain_size (${terrainSize}) must be ≥ patch_size (${patchSize}).`);
  }

  let plateauPixels = 0;
  let facadePixels = 0;
  let facadeHeightDetected = 0;

  const res = processImages(input, ctx, 'cliff_atlas_extract', ['image', 'template'], (imgs: DecodedImage[]) => {
    const [sourceImg, templateImg] = imgs;

    if (sourceImg.width < 4 || sourceImg.height < 4) {
      throw new Error(`Source image too small: ${sourceImg.width}x${sourceImg.height}.`);
    }
    if (templateImg.width < 50 || templateImg.height < 82) {
      throw new Error(
        `Template too small: ${templateImg.width}x${templateImg.height}. ` +
        'Need at least 50x82 (canonical cliff template).',
      );
    }

    const sourceRGBA = new Uint8Array(
      sourceImg.data.buffer, sourceImg.data.byteOffset, sourceImg.data.byteLength,
    );
    const templateRGBA = new Uint8Array(
      templateImg.data.buffer, templateImg.data.byteOffset, templateImg.data.byteLength,
    );

    // ── Stage A: segmentation on source
    const segRng = mulberry32(quiltingSeed);
    const seg = segmentCliffImage(
      sourceRGBA, sourceImg.width, sourceImg.height,
      facadeSearchH, minPlateauArea, segRng,
    );

    plateauPixels = 0;
    for (let i = 0; i < seg.plateauMask.length; i++) plateauPixels += seg.plateauMask[i];
    facadePixels = 0;
    for (let i = 0; i < seg.facadeMask.length; i++) facadePixels += seg.facadeMask[i];
    facadeHeightDetected = seg.facadeHeightPx;

    if (plateauPixels < Math.max(16, patchSize * patchSize)) {
      throw new Error(
        `Source segmentation found only ${plateauPixels} plateau pixels (need ≥ ${patchSize * patchSize}). ` +
        'The source must contain a visible bright "cliff top" cluster.',
      );
    }
    if (facadePixels < Math.max(8, facadePW)) {
      throw new Error(
        `Source segmentation found only ${facadePixels} facade pixels. ` +
        'The source must contain a visible darker "cliff wall" cluster below the plateau.',
      );
    }

    // ── Stage B: plateau terrain via Image Quilting + Moisan
    const plateauRng = mulberry32(quiltingSeed);
    const effPatch = Math.min(patchSize, Math.min(sourceImg.width, sourceImg.height));
    const effOverlap = Math.min(overlap, Math.max(2, effPatch - 1));
    const plateauTerrain = extractPlateauTerrain(
      sourceRGBA, sourceImg.width, sourceImg.height,
      seg.plateauMask, terrainSize, effPatch, effOverlap, candidates, plateauRng,
    );

    // ── Stage C: facade strip via 1D Quilting + row-wise Moisan
    const facadeH = facadeHeightIn === 0
      ? Math.max(4, seg.facadeHeightPx)
      : Math.max(4, facadeHeightIn);
    const facadeRng = mulberry32(facadeSeed);
    const facadeStrip = extractFacadeStrip(
      sourceRGBA, sourceImg.width, sourceImg.height,
      seg.facadeMask, facadeH, facadeWidth,
      facadePW, facadeOverlap, facadeCand, facadeCoverage, facadeRng,
    );

    // ── Stage D: template segmentation + refine → per-sprite mask/flag/modifier
    const tplRng = mulberry32(quiltingSeed + 1);
    const tplData = buildCliffTemplateData(
      templateRGBA, templateImg.width, templateImg.height,
      facadeSearchH, satThr, proxRows, tplRng,
    );

    // ── Bake atlas
    const bakeRng = mulberry32(variantSeed);
    const atlas = bakeAtlas(
      plateauTerrain, terrainSize, terrainSize,
      facadeStrip, facadeWidth, facadeH,
      tplData,
      bakeRng,
    );

    return {
      width: tplData.w,
      height: tplData.h,
      data: Buffer.from(atlas.buffer, atlas.byteOffset, atlas.byteLength),
    };
  }, { suffix: '_cliff_atlas' });

  if (res.error) {
    return failOutput(res.error);
  }

  return {
    image: res.image,
    width: res.width,
    height: res.height,
    plateau_pixels: plateauPixels,
    facade_pixels: facadePixels,
    facade_height_detected: facadeHeightDetected,
    error: '',
  };
}
