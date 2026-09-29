import { pathToFileURL } from 'node:url'

import type { HostImpl } from '@forgeax/scene'

import {
  sampleHeightfieldSurfaceHit,
  sampleHeightfieldWorld,
  unwrapHeightfield,
} from '../../../../vendor/dist/shared/types/scene/heightfieldField.js'
import {
  defineMaterialHost,
  paintSurfaceHost,
} from '../../../../vendor/dist/shared/types/scene/surfacePaint.js'
import { resolveFirstBatchLibraryEntries } from '../firstBatchBatteries.js'

/**
 * First-batch library bodies. Scene Script calls these as TypeScript functions.
 * OpSpec on the canvas is the last-run projection of the same functions,
 * not the execution engine.
 *
 * Loaded by runtime URL so backend `tsc` rootDir stays `src/` — the files
 * live under `apps/composition/batteries/`.
 */
let cache: Promise<Record<string, HostImpl>> | undefined

async function loadLibrary(): Promise<Record<string, HostImpl>> {
  const impls: Record<string, HostImpl> = {}
  for (const entry of resolveFirstBatchLibraryEntries()) {
    const mod = await import(pathToFileURL(entry.file).href) as Record<string, HostImpl>
    const fn = mod[entry.exportName]
    if (typeof fn !== 'function') {
      throw new Error(`First-batch library missing ${entry.exportName} in ${entry.file}`)
    }
    impls[entry.exportName] = fn
  }
  impls.sampleHeight = (args) => {
    const field = unwrapHeightfield(args.heightfield)
    const x = Number(args.x)
    const y = Number(args.y)
    if (!field || !Number.isFinite(x) || !Number.isFinite(y)) {
      return { z: null, error: 'sampleHeight requires heightfield, x, y in authoring metres' }
    }
    const z = sampleHeightfieldWorld(field, x, y)
    return { z: z ?? null }
  }
  impls.sampleSurface = (args) => {
    const field = unwrapHeightfield(args.surface ?? args.heightfield)
    const x = Number(args.x)
    const y = Number(args.y)
    if (!field || !Number.isFinite(x) || !Number.isFinite(y)) {
      return {
        point: null,
        normal: null,
        uv: null,
        face: null,
        error: 'sampleSurface requires surface, x, y in authoring metres',
      }
    }
    const hit = sampleHeightfieldSurfaceHit(field, x, y)
    if (!hit) {
      return {
        point: null,
        normal: null,
        uv: null,
        face: null,
        error: `SCENE_NOT_ON_SURFACE: (${x}, ${y}) is outside the Heightfield`,
      }
    }
    return hit
  }
  // Materials are not batteries: their arguments carry the agent's closure, which
  // an op call would hash into `host.memo`'s argsKey as nothing (see
  // `packages/scene/src/host.ts` `defineMaterial`). Both bodies live in
  // `vendor/shared/types/scene/surfacePaint.ts` so the emitted pack's
  // `platform/material.ts` runs the same partition rather than a second copy.
  impls.defineMaterial = (args) => defineMaterialHost(args)
  impls.paintSurface = (args) => paintSurfaceHost(args)
  return impls
}

export function firstBatchImplementations(): Promise<Record<string, HostImpl>> {
  cache ??= loadLibrary()
  return cache
}
