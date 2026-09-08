/**
 * pointsScatter: 在输入区域内撒种子点，输出 0/1 点掩码（与输入同形状）。支持两种模式：
 *
 * - mode="spacing"（默认，严格向后兼容旧行为）：随机选点 + 每点用 minSpacing 步 4-邻接 BFS
 *   建禁区，后续点必须避开；最多产 count 个点。搬自 lake_gen 的「候选格 + 多次尝试 + 禁区」思路。
 *
 * - mode="poisson"（复刻老 natural_decoration fillPoisson / fillPoissonCount）：
 *     · countMode="density"：minDist = max(1.5, 8 - density*6)，对洗牌后的全部候选格顺序贪心，
 *       欧氏圆距离 dr*dr+dc*dc < minDist*minDist 判冲突，放置所有不冲突格（铺满，不限 count、不建 BFS 禁区）。
 *     · countMode="count"：minDist = sqrt(area/(count*π))（area=候选格数），洗牌后贪心放置到 count 个；
 *       若间距约束导致放不满，再从剩余候选随机补足到精确 count。
 *
 * PRNG 用项目约定的 mulberry32（与 region_blocky_carve 一致），给定 seed 可复现。单 region 输入由
 * autoIterate fanout。
 */

type Grid = number[][];

function makeMulberry32(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function get4Neighbors(r: number, c: number, rows: number, cols: number): [number, number][] {
  const out: [number, number][] = [];
  if (r > 0) out.push([r - 1, c]);
  if (r < rows - 1) out.push([r + 1, c]);
  if (c > 0) out.push([r, c - 1]);
  if (c < cols - 1) out.push([r, c + 1]);
  return out;
}

/** 从 cells 出发做 spacing 步 4-邻接 BFS，返回覆盖到的全部格键集合（含起点）。 */
function buildForbiddenZone(
  cells: [number, number][],
  rows: number,
  cols: number,
  spacing: number,
): Set<string> {
  const forbidden = new Set(cells.map(([r, c]) => `${r},${c}`));
  let frontier: [number, number][] = [...cells];
  for (let d = 0; d < spacing; d++) {
    const next: [number, number][] = [];
    for (const [r, c] of frontier) {
      for (const [nr, nc] of get4Neighbors(r, c, rows, cols)) {
        const key = `${nr},${nc}`;
        if (!forbidden.has(key)) {
          forbidden.add(key);
          next.push([nr, nc]);
        }
      }
    }
    frontier = next;
  }
  return forbidden;
}

export function pointsScatter(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0].length;

  const targetValue = typeof input.targetValue === "number" ? Math.round(input.targetValue) : 0;
  const count = typeof input.count === "number" ? Math.max(1, Math.round(input.count)) : 5;
  const minSpacing = typeof input.minSpacing === "number" ? Math.max(0, Math.round(input.minSpacing)) : 4;
  const mode = input.mode === "poisson" ? "poisson" : "spacing";
  const countMode = input.countMode === "count" ? "count" : "density";
  const density = typeof input.density === "number" ? Math.max(0, Math.min(1, input.density)) : 0.3;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  const rng = makeMulberry32(seed);

  const points: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  if (mode === "poisson") {
    // 收集有效候选格坐标
    const cells: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = region[r][c];
        const valid = targetValue === 0 ? v !== 0 : v === targetValue;
        if (valid) cells.push([r, c]);
      }
    }
    if (cells.length === 0) return { points, count: 0 };

    if (countMode === "count") {
      // 复刻老 fillPoissonCount：minDist = sqrt(area/(count*π))，贪心放置，不足随机补足到精确 count
      const target = count;
      if (target <= 0) return { points, count: 0 };
      const area = cells.length;
      const minDist = Math.max(1.0, Math.sqrt(area / (target * Math.PI)));
      const minDist2 = minDist * minDist;

      const shuffled = shuffle(cells, rng);
      const placed: [number, number][] = [];
      for (const [r, c] of shuffled) {
        if (placed.length >= target) break;
        let tooClose = false;
        for (const [pr, pc] of placed) {
          const dr = r - pr;
          const dc = c - pc;
          if (dr * dr + dc * dc < minDist2) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) {
          placed.push([r, c]);
          points[r][c] = 1;
        }
      }
      if (placed.length < target) {
        const remaining = shuffled.filter(([r, c]) => points[r][c] === 0);
        const need = target - placed.length;
        for (let i = 0; i < need && i < remaining.length; i++) {
          const [r, c] = remaining[i];
          points[r][c] = 1;
          placed.push([r, c]);
        }
      }
      return { points, count: placed.length };
    }

    // countMode === "density": 复刻老 fillPoisson，铺满全部不冲突格
    const minDist = Math.max(1.5, 8 - density * 6);
    const minDist2 = minDist * minDist;
    const shuffled = shuffle(cells, rng);
    const placed: [number, number][] = [];
    for (const [r, c] of shuffled) {
      let tooClose = false;
      for (const [pr, pc] of placed) {
        const dr = r - pr;
        const dc = c - pc;
        if (dr * dr + dc * dc < minDist2) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        placed.push([r, c]);
        points[r][c] = 1;
      }
    }
    return { points, count: placed.length };
  }

  // mode === "spacing": 原行为（严格向后兼容）
  // 收集所有有效候选格键
  let candidates: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = region[r][c];
      const valid = targetValue === 0 ? v !== 0 : v === targetValue;
      if (valid) candidates.push(`${r},${c}`);
    }
  }

  if (candidates.length === 0) return { points, count: 0 };

  const forbidden = new Set<string>();
  let placed = 0;

  for (let i = 0; i < count; i++) {
    if (candidates.length === 0) break;
    // 多次尝试从剩余候选里选一个未被禁区命中的点
    const maxAttempts = Math.min(80, candidates.length);
    let chosenR = -1, chosenC = -1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const idx = Math.floor(rng() * candidates.length);
      const key = candidates[idx];
      if (forbidden.has(key)) {
        candidates.splice(idx, 1); // 剔除已失效候选
        continue;
      }
      const [r, c] = key.split(",").map(Number);
      chosenR = r; chosenC = c;
      break;
    }
    if (chosenR === -1) break;

    points[chosenR][chosenC] = 1;
    placed++;

    // 以该点为中心建 minSpacing 禁区（spacing=0 时仅禁自身格）
    const zone = buildForbiddenZone([[chosenR, chosenC]], rows, cols, minSpacing);
    for (const k of zone) forbidden.add(k);
    candidates = candidates.filter((k) => !forbidden.has(k));
  }

  return { points, count: placed };
}
