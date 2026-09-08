// Pure, deterministic force-directed layout. Runs the whole simulation to a
// near-rest state synchronously (graphs here are small — dozens of nodes), so a
// given structure always yields the same positions and the component can compute
// it inside a useMemo keyed by the structure hash (no animation loop / no jitter).

export interface ForceEdge {
  from: string
  to: string
  /** preferred edge length; defaults to opts.springLength */
  restLength?: number
}

export interface ForceLayoutOptions {
  iterations?: number
  springLength?: number
  springStrength?: number
  repulsion?: number
  centerStrength?: number
  damping?: number
  /** stop early when the largest per-node displacement drops below this */
  minMovement?: number
}

export type Positions = Record<string, { x: number; y: number }>

const DEFAULTS: Required<ForceLayoutOptions> = {
  iterations: 400,
  springLength: 90,
  springStrength: 0.04,
  repulsion: 9000,
  centerStrength: 0.012,
  damping: 0.85,
  minMovement: 0.01,
}

// Deterministic 32-bit hash → seed, so layout is stable for a given node set.
function hashSeed(ids: string[]): number {
  let h = 2166136261
  for (const id of ids) {
    for (let i = 0; i < id.length; i += 1) {
      h ^= id.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x2c // separator between ids
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Compute settled 2D positions for `nodeIds` connected by `edges`. Positions are
 * centered roughly around the origin; the caller fits them into a viewBox.
 */
export function computeForceLayout(
  nodeIds: string[],
  edges: ForceEdge[],
  options: ForceLayoutOptions = {},
): Positions {
  const opts = { ...DEFAULTS, ...options }
  const n = nodeIds.length
  const positions: Positions = {}
  if (n === 0) return positions
  if (n === 1) {
    positions[nodeIds[0]] = { x: 0, y: 0 }
    return positions
  }

  // Deterministic initial placement on a jittered circle.
  const rand = mulberry32(hashSeed([...nodeIds].sort()))
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  const vx = new Float64Array(n)
  const vy = new Float64Array(n)
  const index = new Map<string, number>()
  const radius = opts.springLength * Math.sqrt(n)
  nodeIds.forEach((id, i) => {
    index.set(id, i)
    const angle = (i / n) * Math.PI * 2 + rand() * 0.5
    const r = radius * (0.5 + rand() * 0.5)
    px[i] = Math.cos(angle) * r
    py[i] = Math.sin(angle) * r
  })

  const validEdges = edges
    .map((e) => ({ a: index.get(e.from), b: index.get(e.to), rest: e.restLength ?? opts.springLength }))
    .filter((e): e is { a: number; b: number; rest: number } => e.a !== undefined && e.b !== undefined && e.a !== e.b)

  for (let iter = 0; iter < opts.iterations; iter += 1) {
    const fx = new Float64Array(n)
    const fy = new Float64Array(n)

    // Pairwise repulsion (Coulomb).
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = px[i] - px[j]
        let dy = py[i] - py[j]
        let distSq = dx * dx + dy * dy
        if (distSq < 0.01) {
          // Deterministic nudge for coincident nodes.
          dx = (rand() - 0.5) * 0.1
          dy = (rand() - 0.5) * 0.1
          distSq = dx * dx + dy * dy || 0.01
        }
        const dist = Math.sqrt(distSq)
        const force = opts.repulsion / distSq
        const ux = dx / dist
        const uy = dy / dist
        fx[i] += ux * force
        fy[i] += uy * force
        fx[j] -= ux * force
        fy[j] -= uy * force
      }
    }

    // Spring attraction along edges (Hooke).
    for (const e of validEdges) {
      const dx = px[e.b] - px[e.a]
      const dy = py[e.b] - py[e.a]
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01
      const displacement = dist - e.rest
      const force = displacement * opts.springStrength
      const ux = dx / dist
      const uy = dy / dist
      fx[e.a] += ux * force
      fy[e.a] += uy * force
      fx[e.b] -= ux * force
      fy[e.b] -= uy * force
    }

    // Gravity toward the center keeps disconnected components from drifting away.
    for (let i = 0; i < n; i += 1) {
      fx[i] -= px[i] * opts.centerStrength
      fy[i] -= py[i] * opts.centerStrength
    }

    let maxMove = 0
    for (let i = 0; i < n; i += 1) {
      vx[i] = (vx[i] + fx[i]) * opts.damping
      vy[i] = (vy[i] + fy[i]) * opts.damping
      px[i] += vx[i]
      py[i] += vy[i]
      const move = Math.abs(vx[i]) + Math.abs(vy[i])
      if (move > maxMove) maxMove = move
    }
    if (maxMove < opts.minMovement) break
  }

  // Recenter on the centroid.
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i += 1) {
    cx += px[i]
    cy += py[i]
  }
  cx /= n
  cy /= n
  nodeIds.forEach((id, i) => {
    positions[id] = { x: px[i] - cx, y: py[i] - cy }
  })
  return positions
}
