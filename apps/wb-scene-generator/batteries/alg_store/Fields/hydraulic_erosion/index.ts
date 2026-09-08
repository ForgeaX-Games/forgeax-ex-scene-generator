/**
 * hydraulic_erosion
 * Sebastian Lague 雨滴水力侵蚀算法的轻量 TS 实现。
 * 每滴雨在双线性插值高度图上滚动，按坡度携沙/沉积，多次迭代生成自然沟壑。
 */

type Grid = number[][];

class LCG {
  private s: number;
  constructor(seed: number) { this.s = seed > 0 ? seed : 48271; }
  next(): number { this.s = (this.s * 1103515245 + 12345) & 0x7fffffff; return this.s; }
  rand(): number { return this.next() / 0x80000000; }
}

function cloneGrid(g: Grid): Grid {
  const h = g.length;
  const out: Grid = new Array(h);
  for (let y = 0; y < h; y++) out[y] = g[y].slice();
  return out;
}

interface BrushEntry { ox: number; oy: number; weight: number; }

function buildBrush(radius: number): BrushEntry[] {
  const out: BrushEntry[] = [];
  let total = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      const w = 1 - dist / radius;
      out.push({ ox: dx, oy: dy, weight: w });
      total += w;
    }
  }
  for (const e of out) e.weight /= total;
  return out;
}

function heightAndGrad(map: Float64Array, w: number, h: number, x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x1 = Math.min(w - 1, xi + 1);
  const y1 = Math.min(h - 1, yi + 1);
  const xc = Math.max(0, Math.min(w - 1, xi));
  const yc = Math.max(0, Math.min(h - 1, yi));
  const hNW = map[yc * w + xc];
  const hNE = map[yc * w + x1];
  const hSW = map[y1 * w + xc];
  const hSE = map[y1 * w + x1];
  const gx = (hNE - hNW) * (1 - yf) + (hSE - hSW) * yf;
  const gy = (hSW - hNW) * (1 - xf) + (hSE - hNE) * xf;
  const height = hNW * (1 - xf) * (1 - yf) + hNE * xf * (1 - yf) + hSW * (1 - xf) * yf + hSE * xf * yf;
  return { height, gx, gy };
}

export function hydraulicErosion(input: Record<string, unknown>): Record<string, unknown> {
  const src = input.heightGrid as Grid | undefined;
  if (!src || src.length === 0 || !src[0] || src[0].length === 0) {
    return { heightGrid: [] };
  }
  const h = src.length;
  const w = src[0].length;

  const iterations = Math.max(100, Math.min(500000, Math.floor(typeof input.iterations === "number" ? input.iterations : 50000)));
  const inertia = typeof input.inertia === "number" ? input.inertia : 0.05;
  const capacityFactor = typeof input.sedimentCapacity === "number" ? input.sedimentCapacity : 4;
  const erodeSpeed = typeof input.erodeSpeed === "number" ? input.erodeSpeed : 0.3;
  const depositSpeed = typeof input.depositSpeed === "number" ? input.depositSpeed : 0.3;
  const evaporate = typeof input.evaporateSpeed === "number" ? input.evaporateSpeed : 0.01;
  const gravity = typeof input.gravity === "number" ? input.gravity : 4;
  const maxLifetime = Math.max(1, Math.floor(typeof input.maxLifetime === "number" ? input.maxLifetime : 30));
  const radius = Math.max(1, Math.min(10, Math.floor(typeof input.radius === "number" ? input.radius : 3)));
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? (Date.now() & 0x7fffffff) : seedRaw;
  const rng = new LCG(seed);

  const map = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) map[y * w + x] = src[y][x];

  const brush = buildBrush(radius);
  const minSlope = 0.01;
  const initialSpeed = 1;
  const initialWater = 1;

  for (let drop = 0; drop < iterations; drop++) {
    let posX = rng.rand() * (w - 1);
    let posY = rng.rand() * (h - 1);
    let dirX = 0;
    let dirY = 0;
    let speed = initialSpeed;
    let water = initialWater;
    let sediment = 0;

    for (let life = 0; life < maxLifetime; life++) {
      const nodeX = Math.floor(posX);
      const nodeY = Math.floor(posY);
      const offsetX = posX - nodeX;
      const offsetY = posY - nodeY;
      const { height: hOld, gx, gy } = heightAndGrad(map, w, h, posX, posY);

      dirX = dirX * inertia - gx * (1 - inertia);
      dirY = dirY * inertia - gy * (1 - inertia);
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len !== 0) { dirX /= len; dirY /= len; }
      posX += dirX;
      posY += dirY;

      if ((dirX === 0 && dirY === 0) || posX < 0 || posX >= w - 1 || posY < 0 || posY >= h - 1) break;

      const { height: hNew } = heightAndGrad(map, w, h, posX, posY);
      const deltaH = hNew - hOld;
      const capacity = Math.max(-deltaH * speed * water * capacityFactor, minSlope);

      if (sediment > capacity || deltaH > 0) {
        const amount = deltaH > 0 ? Math.min(deltaH, sediment) : (sediment - capacity) * depositSpeed;
        sediment -= amount;
        const idxNW = nodeY * w + nodeX;
        map[idxNW] += amount * (1 - offsetX) * (1 - offsetY);
        map[nodeY * w + (nodeX + 1)] += amount * offsetX * (1 - offsetY);
        map[(nodeY + 1) * w + nodeX] += amount * (1 - offsetX) * offsetY;
        map[(nodeY + 1) * w + (nodeX + 1)] += amount * offsetX * offsetY;
      } else {
        const amount = Math.min((capacity - sediment) * erodeSpeed, -deltaH);
        for (const b of brush) {
          const bx = nodeX + b.ox;
          const by = nodeY + b.oy;
          if (bx < 0 || bx >= w || by < 0 || by >= h) continue;
          const idx = by * w + bx;
          const erodeAmt = amount * b.weight;
          const remove = Math.min(map[idx], erodeAmt);
          map[idx] -= remove;
          sediment += remove;
        }
      }

      speed = Math.sqrt(Math.max(0, speed * speed + deltaH * gravity * -1));
      water *= 1 - evaporate;
      if (water < 0.001) break;
    }
  }

  const heightGrid: Grid = new Array(h);
  for (let y = 0; y < h; y++) {
    heightGrid[y] = new Array(w);
    for (let x = 0; x < w; x++) heightGrid[y][x] = Math.round(map[y * w + x] * 100000) / 100000;
  }

  return { heightGrid };
}
