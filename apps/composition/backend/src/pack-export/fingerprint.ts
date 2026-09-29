import { createHash } from 'node:crypto'
import { surfaceKey, type PackProjection } from './engineBridge.js'

/**
 * Mesh identity of one projection. Shared by the in-app run and the child
 * process that re-runs the emitted pack, so both sides hash the same way.
 */
export interface PackFingerprint {
  readonly entities: readonly {
    readonly slug: string
    readonly vertexCount: number
    readonly triangleCount: number
    /** Local `Transform.pos`. Vertices are object-space, so placement is only here. */
    readonly transform?: unknown
    readonly parentIndex?: number | null
    readonly translation: readonly [number, number, number]
    /** `material/<key>` per draw range, in index order. */
    readonly materials: readonly string[]
    readonly digest: string
  }[]
  /** Scene-global material table: key plus its appearance, in table order. */
  readonly materials: readonly string[]
}

function digestMesh(vertices: Float32Array, indices: Uint32Array, colors?:Float32Array): string {
  return createHash('sha256')
    .update(Buffer.from(vertices.buffer, vertices.byteOffset, vertices.byteLength))
    .update(Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength))
    .update(colors ? Buffer.from(colors.buffer,colors.byteOffset,colors.byteLength) : Buffer.alloc(0))
    .digest('hex')
}

export function fingerprintProjection(projection: PackProjection): PackFingerprint {
  return {
    materials: projection.materials.map((material) => `${material.key}=${surfaceKey(material.surface)}`),
    entities: projection.entities.map((entity) => ({
      slug: entity.slug,
      vertexCount: entity.mesh?.vertexCount ?? 0,
      triangleCount: entity.mesh?.triangleCount ?? 0,
      translation: entity.translation,
      transform: entity.transform, parentIndex: entity.parentIndex,
      materials: entity.mesh
        ? entity.mesh.runs.map((run) => `${projection.materials[run.material]?.key ?? '?'}@${run.indexOffset}+${run.indexCount}`)
        : [],
      digest: entity.mesh ? digestMesh(entity.mesh.vertices, entity.mesh.indices,entity.mesh.colors) : '',
    })),
  }
}

/** First place the two projections disagree, in human words. `null` = identical. */
export function firstDifference(expected: PackFingerprint, actual: PackFingerprint): string | null {
  if (expected.materials.length !== actual.materials.length) {
    return `material table has ${expected.materials.length} entries in app vs ${actual.materials.length} standalone`
  }
  for (let i = 0; i < expected.materials.length; i++) {
    if (expected.materials[i] !== actual.materials[i]) {
      return `material ${i} is "${expected.materials[i]}" in app but "${actual.materials[i]}" standalone`
    }
  }
  if (expected.entities.length !== actual.entities.length) {
    return `entity count ${expected.entities.length} in app vs ${actual.entities.length} standalone`
  }
  for (let i = 0; i < expected.entities.length; i++) {
    const a = expected.entities[i]!
    const b = actual.entities[i]!
    if (a.slug !== b.slug) return `entity ${i} is "${a.slug}" in app but "${b.slug}" standalone`
    if (a.vertexCount !== b.vertexCount || a.triangleCount !== b.triangleCount) {
      return `"${a.slug}" has ${a.vertexCount}v/${a.triangleCount}t in app but ${b.vertexCount}v/${b.triangleCount}t standalone`
    }
    for (let axis = 0; axis < 3; axis++) {
      if (a.translation[axis] !== b.translation[axis]) {
        return `"${a.slug}" sits at ${JSON.stringify(a.translation)} in app but ${JSON.stringify(b.translation)} standalone`
      }
    }
    if (JSON.stringify(a.transform) !== JSON.stringify(b.transform) || a.parentIndex !== b.parentIndex) return `"${a.slug}" has a different local transform or parent`
    if (a.materials.join(',') !== b.materials.join(',')) {
      return `"${a.slug}" draws [${a.materials.join(', ')}] in app but [${b.materials.join(', ')}] standalone`
    }
    if (a.digest !== b.digest) return `"${a.slug}" has the same counts but different vertex data`
  }
  return null
}
