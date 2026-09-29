import { isNumericBuffer } from '@forgeax/scene-authoring/scene-tree'
import { SURFACE_TEXTURE_CHANNELS, surfaceTextureMapsKey, validateSurfaceTextureMaps, type SurfaceTextureMaps } from './surfaceTexture.js'
/**
 * `paintSurface` / `defineMaterial` / `sampleGrid` — the whole of code-authored
 * materials.
 *
 * Lives under `vendor/shared/types/` on purpose: that tree is mirrored verbatim
 * into the emitted pack's `platform/lib/` by `pack-export/vendorClosure.ts`, so
 * the app host and the pack run the SAME partition code. `templates/hostExtras.ts`
 * had to re-implement `sampleHeight` because the logic was two lines; the
 * partition here is not, and a second copy would drift.
 *
 * The split of labour is the point (CLAUDE.md §4): the agent writes one pure
 * function saying what a point of surface *is*, and everything mechanical —
 * evaluating it over every triangle, deduping appearances into a palette,
 * reordering the index buffer so each palette entry is one contiguous run —
 * happens here. The engine's own multi-material mechanism is
 * `MeshAsset.submeshes[]` + `materialSlots[]`, and a run maps onto it 1:1.
 *
 * Why the index buffer is reordered *here* rather than in each consumer: the
 * exporter and the viewport both need the same partition, and re-deriving it
 * twice is how the two sides drift. Reordered once, both just read `runs`.
 */

import type { SceneMesh, SurfaceAppearance, SurfaceRun } from './content.js'

/** A grid is a plain nested array, so a rule can also just index it directly. */
export type PaintGrid = readonly (readonly number[])[]

/**
 * What a rule is handed for one triangle. Deliberately minimal: anything else
 * is one line of the agent's own code (slope is `Math.acos(s.nz)`), and guessing
 * at extras is exactly the "冗余规范" CLAUDE.md §4 says to avoid.
 */
export interface SurfaceSample {
  /** Triangle centroid, scene metres (+X east, +Y south, +Z up). */
  readonly x: number
  readonly y: number
  readonly z: number
  /** Unit face normal on the same axes. */
  readonly nx: number
  readonly ny: number
  readonly nz: number
  /** Mean uv over the triangle, when the mesh carries uvs. */
  readonly u?: number
  readonly v?: number
  /** 0-based triangle ordinal in the *authored* index order. */
  readonly triangle: number
}

export interface MaterialRule {
  readonly kind: 'material'
  readonly name: string
  readonly surface: (sample: SurfaceSample) => SurfaceAppearance
}

/** Brands a rule with the identity the exporter derives its asset key from. */
export function defineMaterial(definition: {
  name: string
  surface: (sample: SurfaceSample) => SurfaceAppearance
}): MaterialRule {
  const name = definition.name.trim()
  if (!name) throw new Error('defineMaterial requires a non-empty name')
  if (typeof definition.surface !== 'function') {
    throw new Error(`defineMaterial('${name}') requires a surface(sample) function`)
  }
  return { kind: 'material', name, surface: definition.surface }
}

export function isMaterialRule(value: unknown): value is MaterialRule {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { kind?: unknown }).kind === 'material'
    && typeof (value as { surface?: unknown }).surface === 'function',
  )
}

/**
 * Bilinear read of a grid at normalized `(u, v)`, v down the rows. `undefined`
 * for a missing grid or an out-of-range coordinate, so a rule can `?? fallback`.
 *
 * This is the grid counterpart of the existing `sampleHeight` host helper: a
 * `heightfieldMesh` uv is the 0–1 plane parameterization, so any attribute grid
 * of that heightfield lines up with it directly.
 */
export function sampleGrid(grid: PaintGrid | undefined, u?: number, v?: number): number | undefined {
  if (!grid || grid.length === 0) return undefined
  if (typeof u !== 'number' || typeof v !== 'number' || !Number.isFinite(u) || !Number.isFinite(v)) return undefined
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  if (cols === 0) return undefined
  const fy = Math.min(Math.max(v, 0), 1) * (rows - 1)
  const fx = Math.min(Math.max(u, 0), 1) * (cols - 1)
  const r0 = Math.floor(fy)
  const c0 = Math.floor(fx)
  const r1 = Math.min(r0 + 1, rows - 1)
  const c1 = Math.min(c0 + 1, cols - 1)
  const ty = fy - r0
  const tx = fx - c0
  const a = grid[r0]?.[c0] ?? 0
  const b = grid[r0]?.[c1] ?? 0
  const c = grid[r1]?.[c0] ?? 0
  const d = grid[r1]?.[c1] ?? 0
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

/**
 * Appearances closer than this on every channel are the same palette entry.
 * Without it a rule that divides by a float ("roughness: 0.8 * wetness") emits a
 * distinct material per triangle, which is a silent 148k-draw-call export.
 */
const QUANTUM = 1e-4

const quantize = (value: number): number => Math.round(value / QUANTUM) * QUANTUM

/** Palette entries beyond this are almost always an accident; warn, don't block. */
export const SURFACE_VARIANT_BUDGET = 32

function normalizeAppearance(raw: unknown, name: string, triangle: number): SurfaceAppearance {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`material '${name}' returned ${raw === undefined ? 'undefined' : String(raw)} for triangle ${triangle}; surface() must return an appearance`)
  }
  const rec = raw as SurfaceTextureMaps & { baseColor?: unknown; roughness?: unknown; metallic?: unknown; emissive?: unknown; emissiveIntensity?: unknown; alphaCutoff?: unknown }
  const rgba = rec.baseColor
  if (!Array.isArray(rgba) || rgba.length < 3) {
    throw new Error(`material '${name}' returned no baseColor for triangle ${triangle}; expected [r, g, b] or [r, g, b, a] in 0–1`)
  }
  const channel = (at: number, fallback: number): number => {
    const value = at < rgba.length ? Number(rgba[at]) : fallback
    if (!Number.isFinite(value)) {
      throw new Error(`material '${name}' returned a non-finite baseColor channel for triangle ${triangle}`)
    }
    return quantize(value)
  }
  const scalar = (value: unknown, label: string): number | undefined => {
    if (value === undefined) return undefined
    const num = Number(value)
    if (!Number.isFinite(num)) {
      throw new Error(`material '${name}' returned a non-finite ${label} for triangle ${triangle}`)
    }
    return quantize(num)
  }
  const emissive = Array.isArray(rec.emissive) && rec.emissive.length >= 3
    ? ([quantize(Number(rec.emissive[0])), quantize(Number(rec.emissive[1])), quantize(Number(rec.emissive[2]))] as const)
    : undefined
  validateSurfaceTextureMaps(rec)
  if (rec.alphaCutoff !== undefined && (typeof rec.alphaCutoff !== 'number' || !Number.isFinite(rec.alphaCutoff) || rec.alphaCutoff < 0 || rec.alphaCutoff > 1)) {
    throw new Error(`material '${name}' returned invalid alphaCutoff for triangle ${triangle}; expected a finite number in [0, 1]`)
  }
  return {
    ...(rec.alphaCutoff === undefined ? {} : { alphaCutoff: rec.alphaCutoff as number }),
    ...Object.fromEntries(SURFACE_TEXTURE_CHANNELS.filter(k => rec[k]).map(k => [k, rec[k]])),
    baseColor: [channel(0, 0), channel(1, 0), channel(2, 0), channel(3, 1)],
    ...(scalar(rec.roughness, 'roughness') === undefined ? {} : { roughness: scalar(rec.roughness, 'roughness')! }),
    ...(scalar(rec.metallic, 'metallic') === undefined ? {} : { metallic: scalar(rec.metallic, 'metallic')! }),
    ...(emissive ? { emissive: emissive as unknown as readonly [number, number, number] } : {}),
    ...(scalar(rec.emissiveIntensity, 'emissiveIntensity') === undefined
      ? {}
      : { emissiveIntensity: scalar(rec.emissiveIntensity, 'emissiveIntensity')! }),
  }
}

/** Stable key over the quantized values, so dedupe is by appearance not identity. */
export function appearanceKey(appearance: SurfaceAppearance): string {
  const { baseColor: c, roughness, metallic, emissive, emissiveIntensity } = appearance
  return [
    c[0], c[1], c[2], c[3],
    roughness ?? '', metallic ?? '',
    emissive ? `${emissive[0]},${emissive[1]},${emissive[2]}` : '',
    emissiveIntensity ?? '', ...(surfaceTextureMapsKey(appearance) ? [surfaceTextureMapsKey(appearance)] : []),
    ...(appearance.alphaCutoff === undefined ? [] : [`alphaCutoff:${appearance.alphaCutoff}`]),
  ].join('|')
}

export interface PaintedMesh {
  readonly mesh: SceneMesh
  readonly warnings: readonly { readonly code: string; readonly message: string }[]
}

/**
 * Evaluate `rule` over every triangle of `mesh` and return the mesh with its
 * index buffer grouped by appearance plus the `material` metadata describing the
 * grouping. Vertex data (positions / normals / uvs / colors) is untouched — only
 * the order of whole triangles inside `indices` changes, so nothing downstream
 * has to re-index anything.
 */
export function paintSurfaceMesh(mesh: SceneMesh, rule: MaterialRule): PaintedMesh {
  const { positions, indices, uvs } = mesh
  const triangleCount = Math.floor(indices.length / 3)
  const hasUvs = isNumericBuffer(uvs) && uvs.length === (positions.length / 3) * 2
  const palette: SurfaceAppearance[] = []
  const paletteIndex = new Map<string, number>()
  // Triangle ordinals bucketed by palette entry; concatenating the buckets in
  // palette order is what makes every run contiguous.
  const buckets: number[][] = []

  for (let t = 0; t < triangleCount; t++) {
    const ia = indices[t * 3]! * 3
    const ib = indices[t * 3 + 1]! * 3
    const ic = indices[t * 3 + 2]! * 3
    const ax = positions[ia]!, ay = positions[ia + 1]!, az = positions[ia + 2]!
    const bx = positions[ib]!, by = positions[ib + 1]!, bz = positions[ib + 2]!
    const cx = positions[ic]!, cy = positions[ic + 1]!, cz = positions[ic + 2]!
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz)
    if (length === 0) {
      // Degenerate triangle: no meaningful facing. +Z keeps the sample usable
      // instead of handing the rule NaN.
      nx = 0; ny = 0; nz = 1
    } else {
      nx /= length; ny /= length; nz /= length
    }
    const sample: SurfaceSample = {
      x: (ax + bx + cx) / 3,
      y: (ay + by + cy) / 3,
      z: (az + bz + cz) / 3,
      nx, ny, nz,
      ...(hasUvs
        ? {
            u: (uvs![(ia / 3) * 2]! + uvs![(ib / 3) * 2]! + uvs![(ic / 3) * 2]!) / 3,
            v: (uvs![(ia / 3) * 2 + 1]! + uvs![(ib / 3) * 2 + 1]! + uvs![(ic / 3) * 2 + 1]!) / 3,
          }
        : {}),
      triangle: t,
    }
    const appearance = normalizeAppearance(rule.surface(sample), rule.name, t)
    const key = appearanceKey(appearance)
    let slot = paletteIndex.get(key)
    if (slot === undefined) {
      slot = palette.length
      paletteIndex.set(key, slot)
      palette.push(appearance)
      buckets.push([])
    }
    buckets[slot]!.push(t)
  }

  const grouped: number[] = []
  const runs: SurfaceRun[] = []
  for (let slot = 0; slot < palette.length; slot++) {
    const bucket = buckets[slot]!
    const indexOffset = grouped.length
    for (const t of bucket) {
      grouped.push(indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!)
    }
    runs.push({ surface: slot, indexOffset, indexCount: bucket.length * 3 })
  }

  const warnings: { code: string; message: string }[] = []
  if (palette.length > SURFACE_VARIANT_BUDGET) {
    warnings.push({
      code: 'SCENE_MATERIAL_VARIANTS',
      message: `material '${rule.name}' produced ${palette.length} distinct appearances over ${triangleCount} triangles; each becomes its own submesh and draw call. Quantize the rule (bucket the value you branch on) or wait for texture baking.`,
    })
  }

  return {
    mesh: {
      ...mesh,
      indices: grouped,
      material: {
        ...mesh.material,
        id: rule.name,
        // The single-appearance slot stays populated so every consumer that only
        // knows about a constant material still reads something sane.
        surface: palette[0] ?? { baseColor: [0.62, 0.62, 0.62, 1] },
        palette,
        runs,
      },
    },
    warnings,
  }
}

/**
 * Accepts what a scene script actually holds: a Geometry kind mesh, or the
 * `{ geometry }` / `{ mesh }` wrapper a battery returns (`heightfieldMesh` gives
 * `{ geometry, _warnings }`), or a one-element list of either.
 *
 * Deliberately narrow rather than reusing `scene_node`'s 6-level generic peel:
 * paint only ever receives a mesh, and a loud failure beats guessing.
 */
function meshFromGeometryInput(raw: unknown, depth = 0): SceneMesh | undefined {
  if (!raw || typeof raw !== 'object' || depth > 3) return undefined
  if (Array.isArray(raw)) return raw.length === 1 ? meshFromGeometryInput(raw[0], depth + 1) : undefined
  const rec = raw as { positions?: unknown; indices?: unknown; geometry?: unknown; mesh?: unknown }
  if (isNumericBuffer(rec.positions) && isNumericBuffer(rec.indices)) return raw as SceneMesh
  return meshFromGeometryInput(rec.geometry, depth + 1) ?? meshFromGeometryInput(rec.mesh, depth + 1)
}

/**
 * Host entry point for `paintSurface({ geometry, material })`. Returns the
 * battery-shaped `{ geometry, _warnings }` so `sceneNode({ geometry: painted })`
 * peels it exactly like any other geometry producer.
 */
export function paintSurfaceHost(args: Record<string, unknown>): {
  geometry?: SceneMesh
  _warnings?: readonly { readonly code: string; readonly message: string }[]
  error?: string
} {
  const mesh = meshFromGeometryInput(args.geometry ?? args.mesh)
  if (!mesh) return { error: 'paintSurface requires a Geometry kind mesh (positions + indices)' }
  if (!isMaterialRule(args.material)) {
    return { error: 'paintSurface requires material: a value returned by defineMaterial' }
  }
  if (mesh.indices.length < 3) return { error: 'paintSurface requires at least one triangle' }
  const painted = paintSurfaceMesh(mesh, args.material)
  return {
    geometry: painted.mesh,
    ...(painted.warnings.length > 0 ? { _warnings: painted.warnings } : {}),
  }
}

/** Host entry point for `defineMaterial({ name, surface })`. */
export function defineMaterialHost(args: Record<string, unknown>): MaterialRule {
  return defineMaterial({
    name: String(args.name ?? ''),
    surface: args.surface as MaterialRule['surface'],
  })
}
