/**
 * cosmos_terrain_variation: 将 terrainGridList 中各地形网格合并为单张地形网格，
 * 并通过细节噪声在格子边界处随机扰动（混合相邻地形），增加自然感。
 * 输入：terrainGridList (array) — 来自 cosmos_biome_mapper，多张单值地形网格
 *        inputNameList (array) — 来自 cosmos_biome_mapper.nameList，地形名称清单
 *        seed (number) — 随机种子
 *        variationStrength (number) — 扰动强度，0=不扰动，1=正常
 * 输出：variedGridList (array) — 单元素列表，内含合并+扰动后的地形网格
 *        nameList (array) — 合并网格中实际出现的地形条目（透传自 inputNameList，按实际id过滤）
 *
 * 合并规则：每格取 terrainGridList 中第一个非零值作为该格的地形 ID；
 * 扰动规则：在地形边界格子（周围存在不同地形ID的格子），
 *           以细节噪声概率替换为相邻地形ID，模拟自然过渡。
 */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const perm2 = new Uint8Array(512);

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initNoise(seed: number): void {
  const p = new Uint8Array(256);
  const rng = mulberry32(seed);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm2[i] = p[i & 255];
}

function grad2(index: number): [number, number] {
  const g = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  return g[index % 8] as [number, number];
}

function noise2D(x: number, y: number): number {
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  const g0 = grad2(perm2[ii + perm2[jj]] % 8);
  const g1 = grad2(perm2[ii + i1 + perm2[jj + j1]] % 8);
  const g2v = grad2(perm2[ii + 1 + perm2[jj + 1]] % 8);
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0*x0 - y0*y0; if (t0 >= 0) { t0 *= t0; n0 = t0*t0*(g0[0]*x0+g0[1]*y0); }
  let t1 = 0.5 - x1*x1 - y1*y1; if (t1 >= 0) { t1 *= t1; n1 = t1*t1*(g1[0]*x1+g1[1]*y1); }
  let t2 = 0.5 - x2*x2 - y2*y2; if (t2 >= 0) { t2 *= t2; n2 = t2*t2*(g2v[0]*x2+g2v[1]*y2); }
  return 70 * (n0 + n1 + n2);
}

function normalizedFbm(x: number, y: number, octaves: number, scale: number): number {
  let total = 0, amp = 1, freq = scale, maxV = 0;
  for (let i = 0; i < octaves; i++) {
    total += noise2D(x * freq, y * freq) * amp;
    maxV += amp; amp *= 0.5; freq *= 2.0;
  }
  return (total / maxV + 1) * 0.5;
}

const NEIGHBORS = [[-1,0],[1,0],[0,-1],[0,1]];

type NameEntry = { id: number; name: string; type?: string; height?: number };

export function cosmosTerrainVariation(input: Record<string, unknown>): Record<string, unknown> {
  const terrainGridList = input.terrainGridList as number[][][] | undefined;
  const inputNameList = Array.isArray(input.inputNameList) ? (input.inputNameList as NameEntry[]) : [];

  if (!Array.isArray(terrainGridList) || terrainGridList.length === 0) {
    return { error: "terrainGridList is required" };
  }

  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const variationStrength = typeof input.variationStrength === "number" ? input.variationStrength : 1.0;

  const H = terrainGridList[0].length;
  const W = terrainGridList[0][0]?.length ?? 0;
  if (H === 0 || W === 0) {
    return { error: "terrainGridList grids are empty" };
  }

  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  initNoise(seed);
  const rng = mulberry32(seed + 1);

  // ── Step 1: 合并为单张地形网格（每格取第一个非零值） ──
  const merged: number[][] = Array.from({ length: H }, () => new Array(W).fill(0));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (const layer of terrainGridList) {
        const v = layer[y]?.[x] ?? 0;
        if (v !== 0) {
          merged[y][x] = v;
          break;
        }
      }
    }
  }

  // ── Step 2: 边界扰动——在细节噪声高的边界格子，随机替换为相邻地形ID ──
  const variedGrid: number[][] = merged.map(row => [...row]);

  if (variationStrength > 0) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const base = merged[y][x];
        if (base === 0) continue;

        // 收集周围不同地形的 id
        const neighborIds: number[] = [];
        for (const [dy, dx] of NEIGHBORS) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
          const nv = merged[ny][nx];
          if (nv !== 0 && nv !== base && !neighborIds.includes(nv)) {
            neighborIds.push(nv);
          }
        }
        if (neighborIds.length === 0) continue;

        // 细节噪声控制扰动概率
        const noise = normalizedFbm(x * 0.1, y * 0.1, 2, 1.0);
        const prob = noise * 0.3 * variationStrength; // 最大30%概率
        if (rng() < prob) {
          variedGrid[y][x] = neighborIds[Math.floor(rng() * neighborIds.length)];
        }
      }
    }
  }

  // ── Step 3: 过滤实际出现的 nameList ──
  const usedIds = new Set<number>();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (variedGrid[y][x] !== 0) usedIds.add(variedGrid[y][x]); }
  const nameList = inputNameList.filter(e => usedIds.has(e.id));

  // ── Step 4: 拆分为单值网格列表，每张只填充一种地形 id，其余为 0 ──
  // 按 nameList 顺序，保持与 nameList 一一对应
  const idToGridIdx = new Map<number, number>();
  const variedGridList: number[][][] = nameList.map((entry, idx) => {
    idToGridIdx.set(entry.id, idx);
    return Array.from({ length: H }, () => new Array(W).fill(0));
  });

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const id = variedGrid[y][x];
      if (id === 0) continue;
      const idx = idToGridIdx.get(id);
      if (idx !== undefined) variedGridList[idx][y][x] = id;
    }
  }

  return { variedGridList, nameList };
}
