/**
 * 黏菌算法 (Physarum Polycephalum / Slime Mold Algorithm)
 * Algorithm structure based on the Jones (2010) model / slime-sim-webgpu reference:
 *   1. Motor: agents advance along heading by stepSize
 *   2. Sensory: 3×3 block sensors at three directions guide steering
 *   3. Deposit: trail deposited (additive) in a disk footprint
 *   4. Trail update: partial diffusion toward neighbor mean, then multiplicative decay
 *
 * Deposit/decay model uses additive deposit + multiplicative decay + partial diffusion,
 * which produces strong concentration contrast suitable for threshold-based binary output
 * on small grids (unlike the WebGPU replacement-deposit + subtractive-decay model that
 * targets continuous high-resolution visual display).
 *
 * 输入：grid (grid) — 掩码网格，非零区域为仿真域
 * 输出：grid (grid) — 输出网格，路径区域为 1，其余为 0
 */

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed > 0 ? seed : 13337);
  }
  next(): bigint {
    this.s =
      (this.s * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.s;
  }
  float01(): number {
    return Number((this.next() >> 33n) % 1000000n) / 1000000;
  }
}

interface Agent {
  x: number;
  y: number;
  angle: number;
}

/**
 * 3×3 block sensor: sums trail values in a 3×3 neighborhood centered on the
 * rounded sensor position. Matches the WebGPU checkTrail implementation.
 */
function senseTrail(
  trail: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const cx = Math.round(x);
  const cy = Math.round(y);
  let sum = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        sum += trail[ny * width + nx];
      }
    }
  }
  return sum;
}

/**
 * Partial diffusion + multiplicative decay.
 * Only `diffuseRate` fraction mixes toward neighbor mean; the rest stays.
 * Then the whole field is scaled by `decay`.
 *
 * This preserves strong contrast between high-traffic paths and background:
 * - Isolated cells (neighborMean ≈ 0) retain ≈ (1-diffuseRate)*decay per step
 * - Cells in uniform regions retain ≈ decay per step
 *
 * With diffuseRate=0.05, decay=0.98 → isolated half-life ≈ 10 steps;
 * uniform-region half-life ≈ 34 steps. Paths survive; background fades.
 */
function diffuseAndDecay(
  trail: Float32Array,
  width: number,
  height: number,
  diffuseRate: number,
  decay: number,
): Float32Array<ArrayBuffer> {
  const next = new Float32Array(trail.length);
  const keep = 1 - diffuseRate;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const center = trail[idx];
      let neighborSum = 0;
      let neighborCount = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx === 0) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            neighborSum += trail[ny * width + nx];
            neighborCount++;
          }
        }
      }
      const neighborMean = neighborCount > 0 ? neighborSum / neighborCount : 0;
      next[idx] = (keep * center + diffuseRate * neighborMean) * decay;
    }
  }
  return next;
}

/**
 * Greedy farthest-point sampling: pick `k` food sites from `cells` so they
 * spread across the domain instead of clumping randomly.
 */
function farthestPointSample(
  cells: [number, number][],
  k: number,
  rng: LCG,
): [number, number][] {
  if (cells.length <= k) return cells.slice();
  const chosen: [number, number][] = [];
  const dist = new Float32Array(cells.length).fill(Infinity);
  const firstIdx = Math.floor(rng.float01() * cells.length);
  chosen.push(cells[firstIdx]);
  for (let i = 0; i < cells.length; i++) {
    const dx = cells[i][0] - cells[firstIdx][0];
    const dy = cells[i][1] - cells[firstIdx][1];
    dist[i] = dx * dx + dy * dy;
  }
  for (let c = 1; c < k; c++) {
    let bestIdx = 0;
    let bestDist = -1;
    for (let i = 0; i < cells.length; i++) {
      if (dist[i] > bestDist) {
        bestDist = dist[i];
        bestIdx = i;
      }
    }
    chosen.push(cells[bestIdx]);
    for (let i = 0; i < cells.length; i++) {
      const dx = cells[i][0] - cells[bestIdx][0];
      const dy = cells[i][1] - cells[bestIdx][1];
      dist[i] = Math.min(dist[i], dx * dx + dy * dy);
    }
  }
  return chosen;
}

export function algSlimeMold(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const srcGrid = input.grid as number[][] | undefined;
  if (!srcGrid || srcGrid.length === 0 || !srcGrid[0] || srcGrid[0].length === 0) {
    return { error: "grid is required" };
  }

  const height = srcGrid.length;
  const width = srcGrid[0].length;

  const agentCount = Math.max(
    10,
    Math.min(5000, Math.floor((input.agentCount as number) ?? 500)),
  );
  const steps = Math.max(
    10,
    Math.min(800, Math.floor((input.steps as number) ?? 200)),
  );
  const sensorAngleDeg = Math.max(
    5,
    Math.min(90, (input.sensorAngle as number) ?? 45),
  );
  const sensorDist = Math.max(
    1,
    Math.min(20, (input.sensorDistance as number) ?? 8),
  );
  const turnSpeedDeg = Math.max(
    1,
    Math.min(90, (input.turnSpeed as number) ?? 45),
  );
  const stepSize = Math.max(
    0.1,
    Math.min(3, (input.stepSize as number) ?? 0.5),
  );
  const decayRate = Math.max(
    0.8,
    Math.min(0.999, (input.decayRate as number) ?? 0.99),
  );
  const depositAmount = Math.max(
    0.1,
    Math.min(10, (input.depositAmount as number) ?? 1.0),
  );
  const depositRadius = Math.max(
    0.5,
    Math.min(5, (input.depositRadius as number) ?? 1.5),
  );
  const trailThreshold = Math.max(
    0.01,
    Math.min(0.99, (input.trailThreshold as number) ?? 0.15),
  );

  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  // seed=0 → 当前时间戳（与 meta/README 描述一致：0=自动随机）。
  const baseSeed = seedRaw > 0 ? Math.floor(seedRaw) : (Date.now() & 0x7fffffff);
  const rng = new LCG(baseSeed);

  const sensorAngleRad = (sensorAngleDeg * Math.PI) / 180;
  const turnSpeedRad = (turnSpeedDeg * Math.PI) / 180;
  const wanderRad = turnSpeedRad * 0.15;
  const diffuseRate = 0.05;

  const validCells: [number, number][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (srcGrid[y][x] !== 0) {
        validCells.push([x, y]);
      }
    }
  }

  if (validCells.length === 0) {
    return { grid: srcGrid.map((row) => Array.from(row)) };
  }

  let trail = new Float32Array(width * height);

  const foodCount = Math.max(3, Math.min(8, Math.floor(Math.sqrt(validCells.length) / 8)));
  const foodSites = farthestPointSample(validCells, foodCount, rng);
  for (const [fx, fy] of foodSites) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ny = fy + dy;
        const nx = fx + dx;
        if (ny >= 0 && ny < height && nx >= 0 && nx < width && srcGrid[ny][nx] !== 0) {
          trail[ny * width + nx] += depositAmount * 5;
        }
      }
    }
  }

  const agents: Agent[] = [];
  for (let i = 0; i < agentCount; i++) {
    const idx = Math.floor(rng.float01() * validCells.length);
    const [cx, cy] = validCells[idx];
    agents.push({
      x: cx + rng.float01() - 0.5,
      y: cy + rng.float01() - 0.5,
      angle: rng.float01() * Math.PI * 2,
    });
    trail[cy * width + cx] += depositAmount;
  }

  const depRi = Math.ceil(depositRadius);
  const depR2 = depositRadius * depositRadius;

  for (let step = 0; step < steps; step++) {
    for (const agent of agents) {
      // Stage A: Motor — advance along current heading
      const newX = agent.x + Math.cos(agent.angle) * stepSize;
      const newY = agent.y + Math.sin(agent.angle) * stepSize;
      const fnx = Math.floor(newX);
      const fny = Math.floor(newY);

      if (
        fnx >= 0 && fnx < width &&
        fny >= 0 && fny < height &&
        srcGrid[fny][fnx] !== 0
      ) {
        agent.x = newX;
        agent.y = newY;
      } else {
        agent.angle = rng.float01() * Math.PI * 2;
        continue;
      }

      // Stage B: Sensory — 3×3 block sensors at three directions
      const sFL = senseTrail(
        trail, width, height,
        agent.x + Math.cos(agent.angle - sensorAngleRad) * sensorDist,
        agent.y + Math.sin(agent.angle - sensorAngleRad) * sensorDist,
      );
      const sF = senseTrail(
        trail, width, height,
        agent.x + Math.cos(agent.angle) * sensorDist,
        agent.y + Math.sin(agent.angle) * sensorDist,
      );
      const sFR = senseTrail(
        trail, width, height,
        agent.x + Math.cos(agent.angle + sensorAngleRad) * sensorDist,
        agent.y + Math.sin(agent.angle + sensorAngleRad) * sensorDist,
      );

      if (sF > sFL && sF > sFR) {
        agent.angle += (rng.float01() - 0.5) * 2 * wanderRad;
      } else if (sF < sFL && sF < sFR) {
        agent.angle += (rng.float01() < 0.5 ? -1 : 1) * turnSpeedRad;
      } else if (sFR > sFL) {
        agent.angle += turnSpeedRad;
      } else if (sFL > sFR) {
        agent.angle -= turnSpeedRad;
      }

      // Stage C: Deposit — additive, disk footprint at agent position
      const cx = Math.floor(agent.x);
      const cy = Math.floor(agent.y);
      for (let dy = -depRi; dy <= depRi; dy++) {
        for (let dx = -depRi; dx <= depRi; dx++) {
          if (dx * dx + dy * dy < depR2) {
            const px = cx + dx;
            const py = cy + dy;
            if (px >= 0 && px < width && py >= 0 && py < height) {
              trail[py * width + px] += depositAmount;
            }
          }
        }
      }
    }

    trail = diffuseAndDecay(trail, width, height, diffuseRate, decayRate);
  }

  let maxTrail = 0;
  for (let i = 0; i < trail.length; i++) {
    if (trail[i] > maxTrail) maxTrail = trail[i];
  }

  const outputGrid = srcGrid.map((row) => Array.from(row).map(() => 0));
  if (maxTrail > 0) {
    const cutoff = maxTrail * trailThreshold;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (srcGrid[y][x] !== 0 && trail[y * width + x] >= cutoff) {
          outputGrid[y][x] = 1;
        }
      }
    }
  }

  return { grid: outputGrid };
}
