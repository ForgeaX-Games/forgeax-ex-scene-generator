/**
 * regionClusterScatter: 簇状散布填充 —— 在区域内随机选若干簇心，以距离衰减概率向周围散点，
 * 形成自然聚团的 0/1 点掩码（与输入同形状）。
 *
 * 输入：region (grid) — 0/1（或多值）约束区，点只能落在非零有效格内
 *       density (number, 0..1) — 目标铺设密度（占有效格比例），决定簇心数量与扩散强度
 *       clusterRadius (number) — 每个簇心的扩散半径（格）
 *       seed (number) — 随机种子，0 用当前时间
 * 输出：region (grid) — 与输入同形状的 0/1 点掩码（选中格=1，其余=0）
 *       count (number) — 实际选中的格数
 *
 * 来源：通用化老 natural_decoration 里的 fillCluster —— 随机取 ~targetCount/6 个簇心，在半径内
 * 按 (1 - dist/(R+1)) * density * 2 的衰减概率散点，达到 targetCount 截停。去掉装饰语义后是一个
 * 纯通用的「簇状/聚集散布」算子。PRNG 用项目约定的 mulberry32，给定 seed 可复现。单 region 输入由
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

export function regionClusterScatter(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0].length;

  const density = typeof input.density === "number" ? Math.max(0, Math.min(1, input.density)) : 0.3;
  const radius = typeof input.clusterRadius === "number" ? Math.max(1, Math.round(input.clusterRadius)) : 4;
  const mode = input.mode === "count" ? "count" : "density";
  const count = typeof input.count === "number" ? Math.max(0, Math.floor(input.count)) : 0;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  const rng = makeMulberry32(seed);

  const cells: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    const row = region[r];
    for (let c = 0; c < cols; c++) {
      if ((row[c] ?? 0) !== 0) cells.push([r, c]);
    }
  }

  const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  if (cells.length === 0) return { region: out, count: 0 };

  if (mode === "count") {
    // 复刻老 fillClusterCount：簇心打分 score=(1-dist/(R+1))+rng()*0.2，按 score 降序取前 N
    const targetCount = Math.min(count, cells.length);
    if (targetCount <= 0) return { region: out, count: 0 };
    const clusterCount = Math.max(1, Math.round(targetCount / 6));

    const cellSet = new Set(cells.map(([r, c]) => `${r},${c}`));
    const shuffled = shuffle(cells, rng);
    const centers = shuffled.slice(0, clusterCount);

    const scores = new Map<string, number>();
    for (const [cr, cc] of centers) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const dist = Math.sqrt(dr * dr + dc * dc);
          if (dist > radius) continue;
          const nr = cr + dr;
          const nc = cc + dc;
          const key = `${nr},${nc}`;
          if (!cellSet.has(key)) continue;
          const score = (1 - dist / (radius + 1)) + rng() * 0.2;
          if (!scores.has(key) || scores.get(key)! < score) {
            scores.set(key, score);
          }
        }
      }
    }

    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    let placed = 0;
    for (let i = 0; i < targetCount && i < sorted.length; i++) {
      const [key] = sorted[i];
      const [rs, cs] = key.split(",").map(Number);
      out[rs][cs] = 1;
      placed++;
    }
    return { region: out, count: placed };
  }

  // mode === "density"：向后兼容老 fillCluster
  const targetCount = Math.round(cells.length * density);
  if (targetCount <= 0) return { region: out, count: 0 };

  const clusterCount = Math.max(1, Math.round(targetCount / 6));

  const cellSet = new Set(cells.map(([r, c]) => `${r},${c}`));
  const shuffled = shuffle(cells, rng);
  const centers = shuffled.slice(0, clusterCount);

  const placed = new Set<string>();
  let count2 = 0;
  for (const [cr, cc] of centers) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const dist = Math.sqrt(dr * dr + dc * dc);
        if (dist > radius) continue;
        const nr = cr + dr;
        const nc = cc + dc;
        const key = `${nr},${nc}`;
        if (!cellSet.has(key) || placed.has(key)) continue;
        const prob = (1 - dist / (radius + 1)) * density * 2;
        if (rng() < prob) {
          placed.add(key);
          out[nr][nc] = 1;
          count2++;
        }
      }
    }
    if (count2 >= targetCount) break;
  }

  return { region: out, count: count2 };
}
