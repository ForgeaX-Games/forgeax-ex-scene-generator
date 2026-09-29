import type { SceneMesh } from './scene-tree.js'
import type { MeshAsset } from './scene-asset.js'

/** Build the static triangle-mesh protocol: pos3, normal3, uv2, tangent4.
 * Input coordinates are already in the destination frame. No renderer dependency.
 */
export function staticMeshAsset(mesh: SceneMesh): MeshAsset {
  const position = Float32Array.from(mesh.positions),
    count = position.length / 3
  if (!Number.isInteger(count) || !position.every(Number.isFinite))
    throw new Error('Mesh positions must contain finite xyz triples')
  const indices =
    mesh.indices instanceof Uint16Array
      ? mesh.indices
      : Uint32Array.from(mesh.indices)
  if (
    mesh.indices.length % 3 ||
    Array.from(mesh.indices).some(
      (i) => !Number.isInteger(i) || i < 0 || i >= count,
    )
  )
    throw new Error('Mesh indices must contain in-range triangle triples')
  if (count && !indices.includes(count - 1))
    throw new Error(
      'Native mesh requires its final vertex to be referenced; compact unused trailing vertices before publishing',
    )
  const attribute = (
    value: ArrayLike<number> | undefined,
    width: number,
    label: string,
  ) => {
    if (
      value &&
      (value.length !== count * width ||
        !Array.from(value).every(Number.isFinite))
    )
      throw new Error(
        `Mesh ${label} must contain ${width} finite values per vertex`,
      )
    return value ? Float32Array.from(value) : new Float32Array(count * width)
  }
  const normal = attribute(mesh.normals, 3, 'normals'),
    uv = attribute(mesh.uvs, 2, 'uvs')
  const tangent = new Float32Array(count * 4),
    tan = new Float32Array(count * 3),
    bitan = new Float32Array(count * 3)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!,
      b = indices[i + 1]!,
      c = indices[i + 2]!
    const e1 = [0, 1, 2].map((k) => position[b * 3 + k]! - position[a * 3 + k]!)
    const e2 = [0, 1, 2].map((k) => position[c * 3 + k]! - position[a * 3 + k]!)
    if (!mesh.normals) {
      const n = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ]
      for (const vertex of [a, b, c])
        for (let k = 0; k < 3; k++) normal[vertex * 3 + k] += n[k]!
    }
    const du1 = uv[b * 2]! - uv[a * 2]!,
      dv1 = uv[b * 2 + 1]! - uv[a * 2 + 1]!,
      du2 = uv[c * 2]! - uv[a * 2]!,
      dv2 = uv[c * 2 + 1]! - uv[a * 2 + 1]!
    const det = du1 * dv2 - du2 * dv1
    if (Math.abs(det) > 1e-12)
      for (const vertex of [a, b, c])
        for (let k = 0; k < 3; k++) {
          tan[vertex * 3 + k] += (e1[k]! * dv2 - e2[k]! * dv1) / det
          bitan[vertex * 3 + k] += (e2[k]! * du1 - e1[k]! * du2) / det
        }
  }
  const vertices = new Float32Array(count * 12),
    aabb = new Float32Array(6)
  if (count)
    aabb.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
  for (let i = 0; i < count; i++) {
    const at = i * 3,
      length = Math.hypot(normal[at]!, normal[at + 1]!, normal[at + 2]!)
    if (length > 1e-12) for (let k = 0; k < 3; k++) normal[at + k] /= length
    else normal.set([0, 1, 0], at)
    const n = normal.subarray(at, at + 3),
      t = Array.from(tan.subarray(at, at + 3))
    const dot = n[0]! * t[0]! + n[1]! * t[1]! + n[2]! * t[2]!
    for (let k = 0; k < 3; k++) t[k] -= n[k]! * dot
    let tl = Math.hypot(...t)
    if (tl < 1e-12) {
      t.splice(
        0,
        3,
        ...(Math.abs(n[0]!) < 0.9 ? [0, n[2]!, -n[1]!] : [-n[2]!, 0, n[0]!]),
      )
      tl = Math.hypot(...t)
    }
    for (let k = 0; k < 3; k++) t[k] /= tl
    const cross = [
      n[1]! * t[2]! - n[2]! * t[1]!,
      n[2]! * t[0]! - n[0]! * t[2]!,
      n[0]! * t[1]! - n[1]! * t[0]!,
    ]
    tangent.set(
      [
        ...t,
        cross.reduce((sum, v, k) => sum + v * bitan[at + k]!, 0) < 0 ? -1 : 1,
      ],
      i * 4,
    )
    vertices.set(position.subarray(at, at + 3), i * 12)
    vertices.set(n, i * 12 + 3)
    vertices.set(uv.subarray(i * 2, i * 2 + 2), i * 12 + 6)
    vertices.set(tangent.subarray(i * 4, i * 4 + 4), i * 12 + 8)
    for (let k = 0; k < 3; k++) {
      aabb[k] = Math.min(aabb[k]!, position[at + k]!)
      aabb[k + 3] = Math.max(aabb[k + 3]!, position[at + k]!)
    }
  }
  let color: Float32Array | undefined
  if (mesh.colors) {
    const rgb = attribute(mesh.colors, 3, 'colors')
    color = new Float32Array(count * 4)
    for (let i = 0; i < count; i++)
      color.set([rgb[i * 3]!, rgb[i * 3 + 1]!, rgb[i * 3 + 2]!, 1], i * 4)
  }
  const runs = mesh.material?.runs ?? [
    { indexOffset: 0, indexCount: indices.length, surface: 0 },
  ]
  if (!runs.length) throw new Error('Mesh must have at least one material run')
  for (const run of runs)
    if (
      !Number.isInteger(run.indexOffset) ||
      !Number.isInteger(run.indexCount) ||
      run.indexOffset < 0 ||
      run.indexCount < 0 ||
      run.indexOffset + run.indexCount > indices.length ||
      run.indexCount % 3
    )
      throw new Error('Mesh material run exceeds the triangle index buffer')
  return {
    kind: 'mesh',
    vertices,
    indices,
    // Static attributes live once in the canonical interleaved buffer.
    attributes: color ? { color } : {},
    aabb,
    submeshes: runs.map((run, slot) => ({
      indexOffset: run.indexOffset,
      indexCount: run.indexCount,
      vertexCount: count,
      topology: 'triangle-list',
      materialSlot: slot,
    })),
    materialSlots: runs.map((_, slot) => ({ slotName: `surface-${slot}` })),
  }
}
