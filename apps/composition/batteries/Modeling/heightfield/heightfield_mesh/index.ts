/**
 * heightfieldMesh — weave a Heightfield packet into Geometry kind mesh.
 * Reads plane + height only. Mask is control state, not holes.
 */

import { buildHeightfieldMesh, heightfieldStretchMetrics } from '../../../../vendor/shared/types/scene/heightfield.js'
import { sampleHeightfieldUv, sampleHeightfieldWorld, unwrapHeightfield } from '../../../../vendor/shared/types/scene/heightfieldField.js'
import { asPlane, planePointToWorld } from '../../../../vendor/shared/types/scene/spatial.js'

export function heightfieldMesh(input: Record<string, unknown>): {
  geometry?: {
    kind: 'mesh'
    positions: number[]
    indices: number[]
    uvs?: number[]
    colors?: number[]
    role: 'terrain'
  }
  _warnings?: Array<{ code: string; message: string }>
  error?: string
} {
  const field = unwrapHeightfield(input.heightfield)
  if (!field) return { error: 'heightfieldMesh requires a Heightfield packet' }
  const plane = asPlane(field.geometry)
  if (!plane) return { error: 'heightfieldMesh requires the packet plane' }
  const metrics = heightfieldStretchMetrics(plane.width, plane.height, field.columns, field.rows)
  const built = buildHeightfieldMesh(field.height, {
    cellSizeX: metrics.cellSizeX,
    cellSizeY: metrics.cellSizeY,
    origin: [0, 0],
    heightScale: 1,
  })
  if (!built) return { error: 'heightfieldMesh could not weave the height grid' }
  const positions = built.positions.slice()
  const uvs: number[] = []
  for (let i = 0; i < positions.length; i += 3) {
    const localZ = positions[i + 2] ?? 0
    const [wx, wy, wz] = planePointToWorld(plane, positions[i]!, positions[i + 1]!)
    positions[i] = wx
    positions[i + 1] = wy
    const sampled = sampleHeightfieldWorld(field, wx, wy)
    positions[i + 2] = sampled ?? wz + localZ
    const uv = sampleHeightfieldUv(field, wx, wy) ?? [0, 0]
    uvs.push(uv[0], uv[1])
  }
  const _warnings = metrics.anisotropic
    ? [{
        code: 'SCENE_GRID_STRETCH',
        message: [
          `heightfieldMesh: Height grid ${metrics.columns}×${metrics.rows} covers plane ${metrics.planeWidth.toFixed(1)}×${metrics.planeHeight.toFixed(1)} m`,
          `cell ${metrics.cellSizeX.toFixed(3)}×${metrics.cellSizeY.toFixed(3)} m`,
          `stretch ratio ${metrics.stretchRatio.toFixed(3)} (anisotropic)`,
        ].join('; '),
      }]
    : undefined
  return {
    geometry: {
      kind: 'mesh',
      positions,
      indices: [...built.indices],
      uvs,
      ...(built.colors ? { colors: [...built.colors] } : {}),
      role: 'terrain',
    },
    ...(_warnings ? { _warnings } : {}),
  }
}
