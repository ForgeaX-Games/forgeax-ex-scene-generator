/**
 * `sampleHeight` / `sampleSurface` for the emitted pack. Copied verbatim into
 * `platform/`.
 *
 * These two are the only `@forgeax/scene` names with no battery behind them —
 * the app inlines them in `scene-script/run/hostImplementations.ts`. Both sides
 * call the same `heightfieldField` helpers, which the closure vendors anyway.
 */

import {
  sampleHeightfieldSurfaceHit,
  sampleHeightfieldWorld,
  unwrapHeightfield,
} from '../../../../vendor/shared/types/scene/heightfieldField.js'

export function sampleHeight(args: Record<string, unknown>): Record<string, unknown> {
  const field = unwrapHeightfield(args.heightfield)
  const x = Number(args.x)
  const y = Number(args.y)
  if (!field || !Number.isFinite(x) || !Number.isFinite(y)) {
    return { z: null, error: 'sampleHeight requires heightfield, x, y in authoring metres' }
  }
  return { z: sampleHeightfieldWorld(field, x, y) ?? null }
}

export function sampleSurface(args: Record<string, unknown>): Record<string, unknown> {
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
  return hit as unknown as Record<string, unknown>
}
