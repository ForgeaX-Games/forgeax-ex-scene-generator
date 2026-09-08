/**
 * SceneNode.content 判别联合：场景不只是 Volume。
 *
 * 线上旧图把 Volume 直接写在 content 上（kind: empty|uniform|dense|sparse）。
 * 缺省 Volume 视为 voxel。新写入走 { schema, … }；mesh payload 由 S4 填。
 */

import { reviveVolumeFromWire, type Volume } from './volume.js'

export const SCENE_CONTENT_SCHEMAS = ['voxel', 'grid', 'mesh', 'points', 'curves', 'ref', 'unknown'] as const
export type SceneContentSchema = (typeof SCENE_CONTENT_SCHEMAS)[number]

export type SceneMeshRole = 'terrain' | 'road' | 'houses'

/** Wire-stable triangle mesh. S3 types it; S4 fills it. */
export interface SceneMesh {
  readonly positions: readonly number[]
  readonly indices: readonly number[]
  readonly normals?: readonly number[]
  readonly colors?: readonly number[]
  readonly color?: readonly [number, number, number]
  readonly role?: SceneMeshRole
  readonly material?: {
    readonly id?: string
    readonly surface?: {
      readonly baseColor?: readonly number[]
      readonly roughness?: number
      readonly metallic?: number
    }
  }
}

export type SceneContent =
  | { readonly schema: 'voxel'; readonly volume: Volume }
  | { readonly schema: 'grid'; readonly grid?: unknown }
  | { readonly schema: 'mesh'; readonly mesh?: SceneMesh }
  | { readonly schema: 'points'; readonly points?: ReadonlyArray<readonly [number, number]> }
  | { readonly schema: 'curves' }
  | {
      readonly schema: 'ref'
      readonly module: string
      readonly exportName?: string
      readonly mesh?: SceneMesh
    }
  | { readonly schema: 'unknown' }

export type SceneNodeContent = SceneContent | Volume

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
}): SceneContent {
  return {
    schema: 'ref',
    module: opts.module,
    ...(opts.exportName ? { exportName: opts.exportName } : {}),
    ...(opts.mesh ? { mesh: opts.mesh } : {}),
  }
}

export function pointsContent(points: ReadonlyArray<readonly [number, number]>): SceneContent {
  return { schema: 'points', points }
}

export function isRawVolume(value: unknown): value is Volume {
  if (!value || typeof value !== 'object') return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'empty' || kind === 'uniform' || kind === 'dense' || kind === 'sparse'
}

export function contentSchema(content: SceneNodeContent | undefined): SceneContentSchema {
  if (!content) return 'unknown'
  if (isRawVolume(content)) return 'voxel'
  const schema = (content as SceneContent).schema
  return (SCENE_CONTENT_SCHEMAS as readonly string[]).includes(schema) ? schema : 'unknown'
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
    const pts = Array.isArray((rec as { points?: unknown }).points) ? (rec as { points: Array<readonly [number, number]> }).points : []
    return { schema: 'points', points: pts }
  }
  if (rec.schema === 'grid' || rec.schema === 'curves' || rec.schema === 'unknown') {
    return rec as SceneContent
  }
  return reviveVolumeFromWire(w)
}
