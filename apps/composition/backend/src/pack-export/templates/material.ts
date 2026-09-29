/**
 * `defineMaterial` / `paintSurface` for the emitted pack. Copied verbatim into
 * `platform/`.
 *
 * Unlike `hostExtras.ts`, this delegates instead of re-implementing: the
 * partition (evaluate the rule per triangle, dedupe into a palette, regroup the
 * index buffer) is real logic, and a second copy would drift from the app's.
 * `vendor/shared/types/**` is already mirrored into the closure, so both sides
 * import the same `surfacePaint.ts`.
 *
 * A pack has no ambient scene host, so these skip the `host.implementations`
 * indirection and call the bodies directly. Warnings are dropped rather than
 * turned into diagnostics: a pack has nowhere to show them, and the export
 * already surfaced them from the in-app run.
 */

import {
  defineMaterialHost,
  paintSurfaceHost,
} from '../../../../vendor/shared/types/scene/surfacePaint.js'

export function defineMaterial(definition: Record<string, unknown>): unknown {
  return defineMaterialHost(definition)
}

export function paintSurface(args: Record<string, unknown>): unknown {
  const result = paintSurfaceHost(args)
  if (result.error) throw new Error(`paintSurface: ${result.error}`)
  return result
}
