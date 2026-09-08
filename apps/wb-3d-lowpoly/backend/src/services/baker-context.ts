/**
 * Baker service wiring — wraps the ported baker.service + slim library into the
 * handle shape the `g_to_urdf` battery reads off `ctx.services.baker`.
 *
 * Mirrors the legacy `battery-context.factory.ts` baker/library bag, minus the
 * scene-store, image-codec, and notifier handles this plugin does not have.
 *
 *   - lazy-imports baker.service so non-baking executions never pull in the
 *     OCCT WASM (only the actual bake call triggers `import('./baker/...')`)
 *   - `listBakeableOps` is imported statically: ops/index.ts only references
 *     types + errors, so it is safe to load without booting the WASM module
 *   - the library handle is the narrow `BakerLibraryHandle` subset, backed by
 *     the filesystem blob store under `<projectRoot>/library`
 */

import type { Arg, Geometry } from './baker/shared-types.js'
import type { BakerLibraryHandle } from './baker/types.js'
import { listBakeableOps } from './baker/ops/index.js'
import { getLibraryService } from './library.service.js'
import { withTimeout, bakeTimeoutMs, warmupTimeoutMs } from './timeout.js'

export interface BakeResultShape {
  url: string
  sha256: string
  vertexCount: number
  triangleCount: number
  byteSize: number
  cacheHit: boolean
  blobSha256?: string
}

export interface ColoredAssemblyPartTextureInput {
  imageBytes: Buffer
  mime: string
  repeatU?: number
  repeatV?: number
  offsetU?: number
  offsetV?: number
  rotation?: number
}

export interface ColoredAssemblyPartInput {
  shapeId: string
  rgba: [number, number, number, number]
  origin?: [number, number, number]
  rpy?: [number, number, number]
  metalness?: number
  roughness?: number
  texture?: ColoredAssemblyPartTextureInput
}

export interface BakeResultShapeWithBbox extends BakeResultShape {
  bboxMin?: [number, number, number]
  bboxMax?: [number, number, number]
}

export interface BakerHandle {
  bake(opName: string, args: Record<string, unknown>): Promise<BakeResultShape>
  bakeGeometryShape(rootId: string, geometry: Geometry): Promise<BakeResultShape>
  /** 把多个带色 part 烘成单个多材质 GLB（g_bake_object 用）。 */
  bakeColoredAssembly(
    parts: readonly ColoredAssemblyPartInput[],
    geometry: Geometry,
  ): Promise<BakeResultShapeWithBbox>
  listBakeableOps(): readonly string[]
}

export interface BakerServices {
  baker: BakerHandle
  library: BakerLibraryHandle
}

function makeLibraryHandle(libRoot: string): BakerLibraryHandle {
  const svc = getLibraryService(libRoot)
  return {
    getByAlias(alias, zone) {
      const record = svc.getByAlias(alias, zone)
      if (!record) return null
      return { alias: record.alias, blobId: record.blobSha256, sizeBytes: record.sizeBytes }
    },
    resolveBlobPath(alias, zone) {
      return svc.resolveBlobPath(alias, zone)
    },
    resolveBlobPathBySha(sha256) {
      return svc.resolveBlobPathBySha(sha256)
    },
    async importFromBuffer(buffer, filename, alias, opts) {
      const record = await svc.importFromBuffer(buffer, filename, alias, opts)
      return { alias: record.alias, blobId: record.blobSha256 }
    },
  }
}

/**
 * Build the `{ baker, library }` services bag for the execution context.
 * `libRoot` is the filesystem blob root (e.g. `<projectRoot>/library`).
 */
export function createBakerServices(libRoot: string): BakerServices {
  const library = makeLibraryHandle(libRoot)

  // Every bake path is wrapped in withTimeout: a pathological CSG / gear input can
  // make the OCCT WASM kernel spin (or hang) indefinitely, which previously froze
  // the tool call and kept burning tokens. On timeout the bake rejects with a clear
  // TimeoutError the caller surfaces as an actionable failure instead of hanging.
  const baker: BakerHandle = {
    async bake(opName, args) {
      const { bakeShape } = await import('./baker/baker.service.js')
      // The battery passes args as Record<string, unknown>; it guarantees they
      // are DSL Args, so the cast is safe — a bad arg throws BakerError inside
      // the op builder and is caught by the caller's Promise.allSettled.
      return withTimeout(bakeShape(opName, args as Record<string, Arg>, library), bakeTimeoutMs(), `bake(${opName})`)
    },
    async bakeGeometryShape(rootId, geometry) {
      const { bakeGeometryShape } = await import('./baker/baker.service.js')
      return withTimeout(bakeGeometryShape(rootId, geometry, library), bakeTimeoutMs(), `bakeGeometryShape(${rootId})`)
    },
    async bakeColoredAssembly(parts, geometry) {
      const { bakeColoredAssembly } = await import('./baker/baker.service.js')
      return withTimeout(bakeColoredAssembly(parts, geometry, library), bakeTimeoutMs(), 'bakeColoredAssembly')
    },
    listBakeableOps() {
      return listBakeableOps()
    },
  }

  return { baker, library }
}

/** Non-blocking OCCT WASM warmup; safe to call once after the server listens.
 * Bounded by a timeout so a stuck WASM boot can never wedge the caller. */
export async function warmUpBaker(): Promise<void> {
  const { initBakerService } = await import('./baker/baker.service.js')
  await withTimeout(Promise.resolve(initBakerService()), warmupTimeoutMs(), 'baker warmup')
}
