/**
 * L-System (Lindenmayer System) Path Generator
 *
 * Generates branching and fractal structures on a 2D grid via turtle-graphics
 * interpretation of L-system grammar strings.
 *
 * Algorithm:
 *   1. Start with an axiom string
 *   2. Apply production rules for N iterations (supports stochastic rules)
 *   3. Interpret the final string as turtle-graphics commands
 *   4. Auto-scale the result to fit within the grid mask bounding box
 *   5. Rasterize turtle path segments onto the grid
 *
 * Turtle command set:
 *   F, G — move forward by stepLength and draw a line
 *   f    — move forward by stepLength without drawing
 *   +    — turn clockwise by angle
 *   -    — turn counter-clockwise by angle
 *   [    — push state onto stack; width and stepLength decay on push
 *   ]    — pop state from stack
 *   |    — reverse heading (turn 180°)
 *   Other characters participate in rewriting but are ignored by the turtle.
 *
 * Rule format: "symbol=replacement" separated by ";".
 * Stochastic rules: separate alternatives with "|", optional ":weight" suffix.
 *   Example: "F=F[+F]F[-F]F" or "F=FF[+F]:2|F[-F]F:1;X=FX"
 *
 * Heading convention (grid coordinates, row-0 is top):
 *   0° = up (−y), 90° = right (+x), 180° = down (+y), 270° = left (−x)
 *
 * Self-contained — no external imports.
 */

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed > 0 ? seed : 31337);
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

/* ================================================================
 * Constants & types
 * ================================================================ */

const MAX_STR_LEN = 500_000;

interface RuleAlt {
  replacement: string;
  weight: number;
}

interface TurtleState {
  x: number;
  y: number;
  angle: number;
  stepLen: number;
  width: number;
}

interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
}

/* ================================================================
 * Presets — each produces a distinct branching/fractal topology
 * ================================================================ */

interface PresetConfig {
  axiom: string;
  rules: string;
  angle: number;
  iterations: number;
  startAngle: number;
  widthDecay: number;
  lengthDecay: number;
}

const PRESETS: Record<string, PresetConfig> = {
  organic_branch: {
    axiom: "X",
    rules: "X=F-[[X]+X]+F[+FX]-X;F=FF",
    angle: 22.5,
    iterations: 5,
    startAngle: 0,
    widthDecay: 0.75,
    lengthDecay: 0.8,
  },
  river_delta: {
    axiom: "F",
    rules: "F=F[+F]F[-F]F",
    angle: 25.7,
    iterations: 4,
    startAngle: 180,
    widthDecay: 0.7,
    lengthDecay: 0.75,
  },
  road_network: {
    axiom: "F",
    rules: "F=FF[+F][-F]",
    angle: 90,
    iterations: 4,
    startAngle: 0,
    widthDecay: 0.85,
    lengthDecay: 0.7,
  },
  fractal_tree: {
    axiom: "F",
    rules: "F=FF+[+F-F-F]-[-F+F+F]",
    angle: 22.5,
    iterations: 4,
    startAngle: 0,
    widthDecay: 0.7,
    lengthDecay: 0.75,
  },
  dragon_curve: {
    axiom: "F",
    rules: "F=F+G;G=F-G",
    angle: 90,
    iterations: 12,
    startAngle: 0,
    widthDecay: 1.0,
    lengthDecay: 1.0,
  },
  hilbert_curve: {
    axiom: "A",
    rules: "A=-BF+AFA+FB-;B=+AF-BFB-FA+",
    angle: 90,
    iterations: 4,
    startAngle: 90,
    widthDecay: 1.0,
    lengthDecay: 1.0,
  },
};

/* ================================================================
 * Rule parsing
 * ================================================================ */

function parseRules(rulesStr: string): Map<string, RuleAlt[]> {
  const map = new Map<string, RuleAlt[]>();
  const parts = rulesStr.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const sym = trimmed.substring(0, eqIdx).trim();
    if (sym.length !== 1) continue;
    const rhs = trimmed.substring(eqIdx + 1);
    const altStrs = rhs.split("|");
    const parsed: RuleAlt[] = [];
    for (const alt of altStrs) {
      const lastColon = alt.lastIndexOf(":");
      if (lastColon > 0) {
        const w = parseFloat(alt.substring(lastColon + 1).trim());
        if (!isNaN(w) && w > 0) {
          parsed.push({ replacement: alt.substring(0, lastColon), weight: w });
          continue;
        }
      }
      parsed.push({ replacement: alt, weight: 1 });
    }
    if (parsed.length > 0) {
      map.set(sym, parsed);
    }
  }
  return map;
}

/* ================================================================
 * L-system string generation
 * ================================================================ */

function pickAlt(alts: RuleAlt[], rng: LCG): string {
  if (alts.length === 1) return alts[0].replacement;
  let total = 0;
  for (const a of alts) total += a.weight;
  let r = rng.float01() * total;
  for (const a of alts) {
    r -= a.weight;
    if (r <= 0) return a.replacement;
  }
  return alts[alts.length - 1].replacement;
}

function generateString(
  axiom: string,
  rules: Map<string, RuleAlt[]>,
  iterations: number,
  rng: LCG,
): string {
  let current = axiom;
  for (let iter = 0; iter < iterations; iter++) {
    let next = "";
    for (let i = 0; i < current.length; i++) {
      const ch = current.charAt(i);
      const alts = rules.get(ch);
      next += alts ? pickAlt(alts, rng) : ch;
      if (next.length > MAX_STR_LEN) break;
    }
    current = next.length > MAX_STR_LEN
      ? next.substring(0, MAX_STR_LEN)
      : next;
  }
  return current;
}

/* ================================================================
 * Turtle-graphics interpretation
 *
 * Heading: 0° = up (−y), 90° = right (+x).
 * dx = sin(angle), dy = −cos(angle)  (grid coords, y grows downward).
 * ================================================================ */

function interpret(
  str: string,
  startAngle: number,
  turnAngle: number,
  angleJitter: number,
  widthDecay: number,
  lengthDecay: number,
  rng: LCG,
): Segment[] {
  const segments: Segment[] = [];
  const stack: TurtleState[] = [];
  let state: TurtleState = {
    x: 0,
    y: 0,
    angle: startAngle,
    stepLen: 1,
    width: 1,
  };

  for (let i = 0; i < str.length; i++) {
    const ch = str.charAt(i);
    switch (ch) {
      case "F":
      case "G": {
        const rad = (state.angle * Math.PI) / 180;
        const nx = state.x + Math.sin(rad) * state.stepLen;
        const ny = state.y - Math.cos(rad) * state.stepLen;
        segments.push({
          x0: state.x,
          y0: state.y,
          x1: nx,
          y1: ny,
          width: state.width,
        });
        state.x = nx;
        state.y = ny;
        break;
      }
      case "f": {
        const rad = (state.angle * Math.PI) / 180;
        state.x += Math.sin(rad) * state.stepLen;
        state.y -= Math.cos(rad) * state.stepLen;
        break;
      }
      case "+": {
        const jit =
          angleJitter > 0 ? (rng.float01() - 0.5) * 2 * angleJitter : 0;
        state.angle += turnAngle + jit;
        break;
      }
      case "-": {
        const jit =
          angleJitter > 0 ? (rng.float01() - 0.5) * 2 * angleJitter : 0;
        state.angle -= turnAngle + jit;
        break;
      }
      case "[":
        stack.push({
          x: state.x,
          y: state.y,
          angle: state.angle,
          stepLen: state.stepLen,
          width: state.width,
        });
        state = {
          x: state.x,
          y: state.y,
          angle: state.angle,
          stepLen: state.stepLen * lengthDecay,
          width: state.width * widthDecay,
        };
        break;
      case "]":
        if (stack.length > 0) {
          state = stack.pop()!;
        }
        break;
      case "|":
        state.angle += 180;
        break;
    }
  }

  return segments;
}

/* ================================================================
 * Rasterization helpers
 * ================================================================ */

function paintDisk(
  grid: number[][],
  W: number,
  H: number,
  cx: number,
  cy: number,
  radius: number,
  mask: number[][] | null,
): void {
  const ri = Math.ceil(radius);
  const r2 = radius * radius;
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px >= 0 && px < W && py >= 0 && py < H) {
        if (mask !== null && mask[py][px] === 0) continue;
        grid[py][px] = 1;
      }
    }
  }
}

function rasterSegment(
  grid: number[][],
  W: number,
  H: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pixelWidth: number,
  mask: number[][] | null,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  const radius = Math.max(0.5, pixelWidth / 2);

  if (len < 0.5) {
    paintDisk(grid, W, H, Math.round(x0), Math.round(y0), radius, mask);
    return;
  }

  const steps = Math.max(1, Math.ceil(len));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    paintDisk(
      grid,
      W,
      H,
      Math.round(x0 + dx * t),
      Math.round(y0 + dy * t),
      radius,
      mask,
    );
  }
}

/* ================================================================
 * Main export
 * ================================================================ */

export function generateLSystem(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const srcGrid = input.grid as number[][] | undefined;
  if (
    !srcGrid ||
    srcGrid.length === 0 ||
    !srcGrid[0] ||
    srcGrid[0].length === 0
  ) {
    return { error: "grid is required" };
  }

  const H = srcGrid.length;
  const W = srcGrid[0].length;

  /* ---- Resolve preset ---- */

  const presetName = (input.preset as string) ?? "none";
  const preset = PRESETS[presetName] ?? null;

  /* ---- Parameters ----
   * When a preset is active, its core L-system parameters (axiom, rules,
   * iterations, angle, startAngle, widthDecay, lengthDecay) take effect
   * unconditionally — the UI always sends meta.json defaults for these
   * fields so we cannot rely on nullish-coalescing to detect "user didn't
   * set it". Drawing/variation params (lineWidth, angleJitter, padding …)
   * remain freely user-controllable.
   * ---- */

  const axiom = preset
    ? preset.axiom
    : ((input.axiom as string) || "X");
  const rulesStr = preset
    ? preset.rules
    : ((input.rules as string) || "X=F-[[X]+X]+F[+FX]-X;F=FF");
  const iterations = Math.max(1, Math.min(15, Math.floor(
    preset ? preset.iterations : ((input.iterations as number) ?? 5),
  )));
  const angle = Math.max(0.1, Math.min(180,
    preset ? preset.angle : ((input.angle as number) ?? 22.5),
  ));
  const startAngle = preset
    ? preset.startAngle
    : ((input.startAngle as number) ?? 0);
  const widthDecay = Math.max(0.1, Math.min(1,
    preset ? preset.widthDecay : ((input.widthDecay as number) ?? 0.75),
  ));
  const lengthDecay = Math.max(0.1, Math.min(1,
    preset ? preset.lengthDecay : ((input.lengthDecay as number) ?? 0.8),
  ));

  const lineWidth = Math.max(
    1,
    Math.min(20, (input.lineWidth as number) ?? 2),
  );
  const angleJitter = Math.max(
    0,
    Math.min(45, (input.angleJitter as number) ?? 3),
  );
  const padding = Math.max(
    0,
    Math.min(20, Math.floor((input.padding as number) ?? 2)),
  );
  const constrainToMask = input.constrainToMask !== false;

  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  // seed=0 → 当前时间戳（与 meta/README 描述一致：0=自动随机）。
  const baseSeed = seedRaw > 0 ? Math.floor(seedRaw) : (Date.now() & 0x7fffffff);
  const rng = new LCG(baseSeed);

  /* ---- Mask bounding box ---- */

  let mxMin = W;
  let myMin = H;
  let mxMax = -1;
  let myMax = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (srcGrid[y][x] !== 0) {
        if (x < mxMin) mxMin = x;
        if (x > mxMax) mxMax = x;
        if (y < myMin) myMin = y;
        if (y > myMax) myMax = y;
      }
    }
  }

  if (mxMax < 0) {
    return { grid: srcGrid.map((r) => r.map(() => 0)) };
  }

  const pxMin = Math.min(mxMin + padding, mxMax);
  const pyMin = Math.min(myMin + padding, myMax);
  const pxMax = Math.max(mxMax - padding, pxMin);
  const pyMax = Math.max(myMax - padding, pyMin);
  const targetW = pxMax - pxMin;
  const targetH = pyMax - pyMin;

  if (targetW < 1 || targetH < 1) {
    return { grid: srcGrid.map((r) => r.map(() => 0)) };
  }

  /* ---- Phase 1: Generate L-system string ---- */

  const rules = parseRules(rulesStr);
  const lStr = generateString(axiom, rules, iterations, rng);

  /* ---- Phase 2: Turtle-graphics interpretation ---- */

  const segments = interpret(
    lStr,
    startAngle,
    angle,
    angleJitter,
    widthDecay,
    lengthDecay,
    rng,
  );

  if (segments.length === 0) {
    return { grid: srcGrid.map((r) => r.map(() => 0)) };
  }

  /* ---- Phase 3: Compute bounding box of all segments ---- */

  let sxMin = Infinity;
  let syMin = Infinity;
  let sxMax = -Infinity;
  let syMax = -Infinity;
  for (const seg of segments) {
    if (seg.x0 < sxMin) sxMin = seg.x0;
    if (seg.x1 < sxMin) sxMin = seg.x1;
    if (seg.y0 < syMin) syMin = seg.y0;
    if (seg.y1 < syMin) syMin = seg.y1;
    if (seg.x0 > sxMax) sxMax = seg.x0;
    if (seg.x1 > sxMax) sxMax = seg.x1;
    if (seg.y0 > syMax) syMax = seg.y0;
    if (seg.y1 > syMax) syMax = seg.y1;
  }

  const sW = sxMax - sxMin;
  const sH = syMax - syMin;
  if (sW < 1e-6 && sH < 1e-6) {
    return { grid: srcGrid.map((r) => r.map(() => 0)) };
  }

  /* ---- Phase 4: Scale & translate to fit target area ---- */

  const scaleX = sW > 1e-6 ? targetW / sW : 1;
  const scaleY = sH > 1e-6 ? targetH / sH : 1;
  const scale = Math.min(scaleX, scaleY);
  const offX = pxMin + (targetW - sW * scale) / 2;
  const offY = pyMin + (targetH - sH * scale) / 2;

  /* ---- Phase 5: Rasterize segments onto output grid ---- */

  const outGrid: number[][] = Array.from({ length: H }, () =>
    new Array(W).fill(0),
  );
  const mask = constrainToMask ? srcGrid : null;

  for (const seg of segments) {
    const gx0 = (seg.x0 - sxMin) * scale + offX;
    const gy0 = (seg.y0 - syMin) * scale + offY;
    const gx1 = (seg.x1 - sxMin) * scale + offX;
    const gy1 = (seg.y1 - syMin) * scale + offY;
    const pw = Math.max(1, seg.width * lineWidth);
    rasterSegment(outGrid, W, H, gx0, gy0, gx1, gy1, pw, mask);
  }

  return { grid: outGrid };
}
