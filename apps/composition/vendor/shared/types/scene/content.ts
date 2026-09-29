import type { SurfaceTextureMaps } from './surfaceTexture.js'

/**
 * SceneNode.content. Official SceneTree schemas are voxel and mesh only.
 *
 * Must match `packages/scene-authoring/src/types/scene-tree.ts`.
 * Grid / points / curves / ref are leftover wire only — not scene-tree content.
 * Live graph ops stay in graph.ts. Do not add a second SceneContent union.
 */

import { reviveVolumeFromWire, type Volume } from './volume.js'

export const SCENE_CONTENT_SCHEMAS = ['voxel', 'mesh'] as const
export type SceneContentSchema = (typeof SCENE_CONTENT_SCHEMAS)[number]

export const WIRE_SCENE_SCHEMAS = ['voxel', 'mesh', 'grid', 'points', 'curves', 'ref', 'unknown'] as const
export type WireSceneSchema = (typeof WIRE_SCENE_SCHEMAS)[number]

export type { SceneMesh, SurfaceAppearance, SurfaceRun } from '@forgeax/scene-authoring/scene-tree'
import type { SceneMesh } from '@forgeax/scene-authoring/scene-tree'
export type SceneMeshRole = NonNullable<SceneMesh['role']>

export type SceneContent =
  | { readonly schema: 'voxel'; readonly volume: Volume }
  | { readonly schema: 'mesh'; readonly mesh?: SceneMesh }

/** Leftover cached graphs may still carry these. New writes must not. */
export type LeftoverSceneContent =
  | { readonly schema: 'grid'; readonly grid?: unknown }
  | { readonly schema: 'points'; readonly points?: ReadonlyArray<readonly [number, number]> }
  | { readonly schema: 'curves' }
  | {
      readonly schema: 'ref'
      readonly module: string
      readonly exportName?: string
      readonly mesh?: SceneMesh
    }
  | { readonly schema: 'unknown' }

export type SceneNodeContent = SceneContent | LeftoverSceneContent | Volume

export function voxelContent(volume: Volume): SceneContent {
  return { schema: 'voxel', volume }
}

export function meshContent(mesh: SceneMesh): SceneContent {
  return { schema: 'mesh', mesh }
}

export function refContent(opts: {
  module: string
  exportName?: string
  mesh?: SceneMesh
}): LeftoverSceneContent {
  return {
    schema: 'ref',
    module: opts.module,
    ...(opts.exportName ? { exportName: opts.exportName } : {}),
    ...(opts.mesh ? { mesh: opts.mesh } : {}),
  }
}

export function pointsContent(points: ReadonlyArray<readonly [number, number]>): LeftoverSceneContent {
  return { schema: 'points', points }
}

export function isRawVolume(value: unknown): value is Volume {
  if (!value || typeof value !== 'object') return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'empty' || kind === 'uniform' || kind === 'dense' || kind === 'sparse'
}

export function contentSchema(content: SceneNodeContent | undefined): WireSceneSchema {
  if (!content) return 'unknown'
  if (isRawVolume(content)) return 'voxel'
  const schema = (content as { schema?: unknown }).schema
  return (WIRE_SCENE_SCHEMAS as readonly string[]).includes(schema as string)
    ? schema as WireSceneSchema
    : 'unknown'
}

export function reviveContentFromWire(w: unknown): SceneNodeContent {
  if (!w || typeof w !== 'object') return { kind: 'empty' }
  const rec = w as { schema?: unknown; volume?: unknown; mesh?: unknown }
  if (rec.schema === 'voxel') return { schema: 'voxel', volume: reviveVolumeFromWire(rec.volume) }
  if (rec.schema === 'mesh') {
    const mesh = rec.mesh && typeof rec.mesh === 'object' ? (rec.mesh as SceneMesh) : undefined
    return mesh ? { schema: 'mesh', mesh } : { schema: 'mesh' }
  }
  if (rec.schema === 'ref') {
    const modulePath = typeof (rec as { module?: unknown }).module === 'string'
      ? (rec as { module: string }).module
      : ''
    const exportName = typeof (rec as { exportName?: unknown }).exportName === 'string'
      ? (rec as { exportName: string }).exportName
      : undefined
    const mesh = rec.mesh && typeof rec.mesh === 'object' ? (rec.mesh as SceneMesh) : undefined
    return refContent({ module: modulePath, ...(exportName ? { exportName } : {}), ...(mesh ? { mesh } : {}) })
  }
  if (rec.schema === 'points') {
    const pts = Array.isArray((rec as { points?: unknown }).points)
      ? (rec as { points: Array<readonly [number, number]> }).points
      : []
    return { schema: 'points', points: pts }
  }
  if (rec.schema === 'grid' || rec.schema === 'curves' || rec.schema === 'unknown') {
    return rec as LeftoverSceneContent
  }
  return reviveVolumeFromWire(w)
}
