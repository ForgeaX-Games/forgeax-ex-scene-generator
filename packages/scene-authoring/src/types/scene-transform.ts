import type { SceneTransform } from './scene-tree.js'

/** Column-major affine matrices. Pure data math; no Engine, renderer or ECS. */
export type Matrix4 = readonly number[]
export const IDENTITY_MATRIX: Matrix4 = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]

export function transformMatrix(transform?: SceneTransform): Matrix4 {
  const [x, y, z, w] = transform?.quat ?? [0, 0, 0, 1]
  const [sx, sy, sz] = transform?.scale ?? [1, 1, 1]
  const [px, py, pz] = transform?.pos ?? [0, 0, 0]
  if (![sx, sy, sz, px, py, pz].every(Number.isFinite))
    throw new Error('Scene Transform position and scale must be finite')
  const norm = x * x + y * y + z * z + w * w
  if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-5)
    throw new Error('Scene Transform.quat must be a unit quaternion [x,y,z,w]')
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    px,
    py,
    pz,
    1,
  ]
}

export function multiplyMatrices(a: Matrix4, b: Matrix4): Matrix4 {
  const result = new Array<number>(16).fill(0)
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++)
        result[column * 4 + row]! += a[k * 4 + row]! * b[column * 4 + k]!
    }
  return result
}

export function transformPoint(
  matrix: Matrix4,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
    matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
    matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
  ]
}

/** Inverse transpose, including non-uniform and negative scale. */
export function transformNormal(
  m: Matrix4,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const a = m[0]!,
    b = m[4]!,
    c = m[8]!,
    d = m[1]!,
    e = m[5]!,
    f = m[9]!,
    g = m[2]!,
    h = m[6]!,
    i = m[10]!
  const determinant =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(determinant) < 1e-12)
    throw new Error('Scene normal transform is singular (zero scale)')
  const nx =
    ((e * i - f * h) * x + (f * g - d * i) * y + (d * h - e * g) * z) /
    determinant
  const ny =
    ((c * h - b * i) * x + (a * i - c * g) * y + (b * g - a * h) * z) /
    determinant
  const nz =
    ((b * f - c * e) * x + (c * d - a * f) * y + (a * e - b * d) * z) /
    determinant
  const length = Math.hypot(nx, ny, nz)
  return length ? [nx / length, ny / length, nz / length] : [0, 0, 0]
}

export function determinant3(m: Matrix4): number {
  return (
    m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) -
    m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) +
    m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!)
  )
}
