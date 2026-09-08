// 💡 体素测地蒙皮：voxelize（三角面亚体素栅格化 + flood fill 定内外）+ 26-邻域 Dijkstra，
//    在网格自身体积内部测量"这个顶点到这根骨最短路径要走多远"，取代欧氏点到骨段距离/
//    旧的表面图测地距离（auto-skin.ts 的 computeSkinWeightsGeodesic，仍保留作 fallback）。
//
//    算法依据 Dionne & de Lasa, SCA 2013 "Geodesic Voxel Binding"：
//    - `VoxelGrid`：`rasterizeTriangle` 按最长边 / 半体素步长细分做重心坐标采样标出表面
//      体素，保证不留缝——缝会让下一步的外部 flood fill 从缝里漏进"应该是内部"的体素，
//      把模型判成空心。`floodFillExterior` 从 padding 后必然空的角点 BFS 标出体素网格里
//      的"外部"，取补集（表面 ∪ 未被标记为外部的格子）得到 `solid`。
//    - `dijkstraGeodesicField`：26-邻域（不是 6-邻域——6-邻域会把对角移动算成 2 步，在斜
//      着的肢体上出现方块状衰减）堆优先队列 Dijkstra，边权按真实欧氏步长
//      `sqrt(dx²+dy²+dz²)`（面步长 1、边步长 √2、角步长 √3），只在 `solid` 体素间传播。
//    - `computeSkinWeightsVoxel`：每根骨沿 head→tail 采样种子体素、各跑一次 Dijkstra 得到
//      它到全部 solid 体素的测地距离场，每个 mesh 顶点按落格取该骨的测地距离，最后调用
//      **现有** `resolveVertexBinding()`（auto-skin.ts 导出，不复制这段选骨/归一化逻辑）
//      产出 SkinBinding。顶点/骨落在同一体素内视为距离 0（体素分辨率下的最小可分辨距离）。
//
//    诊断字段 `unreachableVertexCount` / `unreachableBones`：某骨的种子体素全落在非 solid
//    区域（骨在模型体外）记入 `unreachableBones`；某顶点所在体素对任何骨都没有测地距离
//    记入 `unreachableVertexCount`（该顶点退化为 `resolveVertexBinding` 对全 Infinity 距离
//    的兜底行为——100% 绑定到骨 0）。这两个字段供
//    `auto-skin.ts` 判断是否需要整体回退到表面图路径，以及供 `g_skin_qc` 打诊断信号。
import * as THREE from 'three'
import type { BoneSegment, SkinBinding } from './auto-skin'
import { resolveVertexBinding } from './auto-skin'

/**
 * `resolution` 越界时的静默夹取范围：过低格子太粗判不出内外，过高在浏览器主线程会卡。
 * 后端 g_to_rig/index.ts 编译 RigSpec 时也按同样的 [4, 96] 夹一次（早于这里，为了让回执里的
 * resolution 字段不撒谎）——两处边界值必须保持一致，改这里务必同步改那边的 clampInt 调用。
 */
const MIN_RESOLUTION = 4
const MAX_RESOLUTION = 96
/** 三角面/骨段栅格化的过采样系数：按 step*RASTER_OVERSAMPLE 定采样步长，< step 才能不留缝。 */
const RASTER_OVERSAMPLE = 0.5
/** solid/surface 体素数比值低于此阈值，判定 mesh 不是近似封闭体（是敞口薄片/非流形）。 */
const MIN_SOLID_TO_SURFACE_RATIO = 1.5
/** 顶点/骨自身落在同一体素时的最小可分辨距离（体素单位），避免除零。 */
const MIN_VOXEL_DISTANCE = 0.5

export interface VoxelSkinDiagnostics {
  /** 没有任何骨的测地距离场覆盖到的顶点数（该顶点退化为「绑定骨 0，权重 1」的兜底）。 */
  unreachableVertexCount: number
  /** 种子体素整体落在非 solid 区域（骨完全在模型体外）的骨下标（对应 `bones` 数组序）。 */
  unreachableBones: number[]
  /** 实际使用的体素分辨率（夹取后）。 */
  resolution: number
  solidVoxelCount: number
  surfaceVoxelCount: number
}

export type VoxelSkinOutcome =
  | { ok: true; binding: SkinBinding; diagnostics: VoxelSkinDiagnostics }
  /** 体素化前置检查失败（退化包围盒/非封闭体积）：调用方应回退到表面图测地路径。 */
  | { ok: false; reason: string }

type Vec3I = readonly [number, number, number]

const NEIGHBORS_26: ReadonlyArray<readonly [number, number, number, number]> = (() => {
  const out: Array<[number, number, number, number]> = []
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        if (dx === 0 && dy === 0 && dz === 0) continue
        out.push([dx, dy, dz, Math.sqrt(dx * dx + dy * dy + dz * dz)])
      }
    }
  }
  return out
})()

/**
 * padding 后的占用体素网格：`surface`（三角面栅格化标出的表面体素）与 `solid`
 * （表面 ∪ 内部——由外部 flood fill 的补集得到）。
 */
class VoxelGrid {
  readonly step: number
  readonly low: [number, number, number]
  readonly dims: [number, number, number]
  readonly strideY: number
  readonly strideZ: number
  readonly total: number
  surface: Uint8Array
  solid: Uint8Array
  surfaceVoxelCount = 0
  solidVoxelCount = 0

  constructor(bboxMin: Vec3I, bboxMax: Vec3I, resolution: number) {
    const extent = Math.max(bboxMax[0] - bboxMin[0], bboxMax[1] - bboxMin[1], bboxMax[2] - bboxMin[2]) || 1
    this.step = extent / resolution
    this.low = [bboxMin[0] - this.step, bboxMin[1] - this.step, bboxMin[2] - this.step]
    this.dims = [0, 1, 2].map((axis) => Math.ceil((bboxMax[axis] - bboxMin[axis]) / this.step) + 3) as [number, number, number]
    this.strideY = this.dims[0]
    this.strideZ = this.dims[0] * this.dims[1]
    this.total = this.dims[0] * this.dims[1] * this.dims[2]
    this.surface = new Uint8Array(this.total)
    this.solid = new Uint8Array(this.total)
  }

  /** 世界坐标 → 网格坐标（夹取到网格范围内，供顶点/骨采样点落格用）。 */
  cellOf(x: number, y: number, z: number): Vec3I {
    const cx = Math.min(this.dims[0] - 1, Math.max(0, Math.floor((x - this.low[0]) / this.step)))
    const cy = Math.min(this.dims[1] - 1, Math.max(0, Math.floor((y - this.low[1]) / this.step)))
    const cz = Math.min(this.dims[2] - 1, Math.max(0, Math.floor((z - this.low[2]) / this.step)))
    return [cx, cy, cz]
  }

  flat(cx: number, cy: number, cz: number): number {
    return cz * this.strideZ + cy * this.strideY + cx
  }

  inBounds(cx: number, cy: number, cz: number): boolean {
    return cx >= 0 && cy >= 0 && cz >= 0 && cx < this.dims[0] && cy < this.dims[1] && cz < this.dims[2]
  }

  /**
   * 按最长边 / (step*RASTER_OVERSAMPLE) 细分三角形，重心坐标采样标出触及的表面体素。
   * 采样步长小于体素尺寸才能保证同一三角形跨越的所有体素都被标到，不留缝。
   */
  rasterizeTriangle(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3): void {
    const longest = Math.max(p0.distanceTo(p1), p1.distanceTo(p2), p2.distanceTo(p0))
    const steps = Math.max(1, Math.ceil(longest / (this.step * RASTER_OVERSAMPLE)))
    for (let i = 0; i <= steps; i += 1) {
      const a = i / steps
      for (let j = 0; j <= steps - i; j += 1) {
        const b = j / steps
        const c = 1 - a - b
        const x = p0.x * c + p1.x * a + p2.x * b
        const y = p0.y * c + p1.y * a + p2.y * b
        const z = p0.z * c + p1.z * a + p2.z * b
        const [cx, cy, cz] = this.cellOf(x, y, z)
        const flat = this.flat(cx, cy, cz)
        if (this.surface[flat] === 0) {
          this.surface[flat] = 1
          this.surfaceVoxelCount += 1
        }
      }
    }
  }

  /**
   * 从网格角点 (0,0,0)（padding 保证必空）BFS 标出「外部」体素，`solid` = 表面 ∪ 未被
   * 标为外部的格子。三角面必须已全部栅格化完毕才能调用。
   */
  computeSolid(): void {
    const [dx, dy, dz] = this.dims
    const total = this.total
    const outside = new Uint8Array(total)
    if (this.surface[this.flat(0, 0, 0)] === 1) {
      // padding 理论上保证角点必空；万一发生（比如 resolution 极端小把 padding 吃掉），
      // 保守地把全网格当 solid，而不是悄悄返回一个空模型。
      this.solid.set(this.surface)
      for (let i = 0; i < total; i += 1) this.solid[i] = 1
      this.solidVoxelCount = total
      return
    }
    // 数组实现的 FIFO 队列（避免 Array.shift 的 O(n)）。
    const queue = new Int32Array(total)
    let head = 0
    let tail = 0
    const startFlat = this.flat(0, 0, 0)
    outside[startFlat] = 1
    queue[tail] = startFlat
    tail += 1
    while (head < tail) {
      const cur = queue[head]
      head += 1
      const cz = Math.floor(cur / this.strideZ)
      const rem = cur - cz * this.strideZ
      const cy = Math.floor(rem / this.strideY)
      const cx = rem - cy * this.strideY
      for (let n = 0; n < NEIGHBORS_26.length; n += 1) {
        const [ox, oy, oz] = NEIGHBORS_26[n]
        const nx = cx + ox, ny = cy + oy, nz = cz + oz
        if (nx < 0 || ny < 0 || nz < 0 || nx >= dx || ny >= dy || nz >= dz) continue
        const nf = this.flat(nx, ny, nz)
        if (outside[nf] === 1 || this.surface[nf] === 1) continue
        outside[nf] = 1
        queue[tail] = nf
        tail += 1
      }
    }
    let solidCount = 0
    for (let i = 0; i < total; i += 1) {
      const isSolid = this.surface[i] === 1 || outside[i] === 0
      this.solid[i] = isSolid ? 1 : 0
      if (isSolid) solidCount += 1
    }
    this.solidVoxelCount = solidCount
  }
}

/** 沿骨段以半体素步长采样，收集其经过的（去重）solid 体素下标；非 solid 的采样点被跳过。 */
function segmentSolidVoxels(grid: VoxelGrid, seg: BoneSegment): Set<number> {
  const length = seg.head.distanceTo(seg.tail)
  const steps = Math.max(1, Math.ceil(length / (grid.step * RASTER_OVERSAMPLE)))
  const cells = new Set<number>()
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const x = seg.head.x + (seg.tail.x - seg.head.x) * t
    const y = seg.head.y + (seg.tail.y - seg.head.y) * t
    const z = seg.head.z + (seg.tail.z - seg.head.z) * t
    const [cx, cy, cz] = grid.cellOf(x, y, z)
    const flat = grid.flat(cx, cy, cz)
    if (grid.solid[flat] === 1) cells.add(flat)
  }
  return cells
}

/** 简单二叉最小堆（(dist,cell) 对，惰性删除过期条目），供 Dijkstra 用（同 auto-skin.ts 的 MinHeap）。 */
class MinHeap {
  private items: Array<{ dist: number; cell: number }> = []
  get size(): number { return this.items.length }
  push(item: { dist: number; cell: number }): void {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent].dist <= items[i].dist) break
      const tmp = items[parent]; items[parent] = items[i]; items[i] = tmp
      i = parent
    }
  }
  pop(): { dist: number; cell: number } | undefined {
    const items = this.items
    if (items.length === 0) return undefined
    const top = items[0]
    const last = items.pop()!
    if (items.length > 0) {
      items[0] = last
      let i = 0
      const n = items.length
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2
        let smallest = i
        if (l < n && items[l].dist < items[smallest].dist) smallest = l
        if (r < n && items[r].dist < items[smallest].dist) smallest = r
        if (smallest === i) break
        const tmp = items[smallest]; items[smallest] = items[i]; items[i] = tmp
        i = smallest
      }
    }
    return top
  }
}

/** 26-邻域 Dijkstra：`sources` 是种子体素的 flat 下标集合，只在 `grid.solid` 内传播。 */
function dijkstraGeodesicField(grid: VoxelGrid, sources: ReadonlySet<number>): Float64Array {
  const dist = new Float64Array(grid.total).fill(Infinity)
  if (sources.size === 0) return dist
  const heap = new MinHeap()
  const [dx, dy, dz] = grid.dims
  for (const cell of sources) {
    if (0 < dist[cell]) { dist[cell] = 0; heap.push({ dist: 0, cell }) }
  }
  while (heap.size > 0) {
    const top = heap.pop()!
    const { dist: d, cell } = top
    if (d > dist[cell]) continue
    const cz = Math.floor(cell / grid.strideZ)
    const rem = cell - cz * grid.strideZ
    const cy = Math.floor(rem / grid.strideY)
    const cx = rem - cy * grid.strideY
    for (let n = 0; n < NEIGHBORS_26.length; n += 1) {
      const [ox, oy, oz, cost] = NEIGHBORS_26[n]
      const nx = cx + ox, ny = cy + oy, nz = cz + oz
      if (nx < 0 || ny < 0 || nz < 0 || nx >= dx || ny >= dy || nz >= dz) continue
      const nf = grid.flat(nx, ny, nz)
      if (grid.solid[nf] === 0) continue
      const nd = d + cost
      if (nd < dist[nf]) { dist[nf] = nd; heap.push({ dist: nd, cell: nf }) }
    }
  }
  return dist
}

function boxOf(positions: Float32Array, vertexCount: number): { min: Vec3I; max: Vec3I } {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
}

/**
 * 体素测地蒙皮：voxelize（表面栅格化 + flood fill 定内外）+ 每根骨一次 26-邻域 Dijkstra +
 * 复用 `resolveVertexBinding` 归一化。前置检查失败（退化包围盒/三角面不足/网格判定不是
 * 近似封闭体）时返回 `{ ok: false, reason }`，调用方（`auto-skin.ts`）应回退到表面图路径。
 */
export function computeSkinWeightsVoxel(
  positions: Float32Array,
  index: ArrayLike<number>,
  bones: readonly BoneSegment[],
  maxInfluences: number,
  falloff: number,
  radiusFactor: number,
  resolution: number,
): VoxelSkinOutcome {
  const vertexCount = Math.floor(positions.length / 3)
  const boneCount = bones.length
  const triCount = Math.floor(index.length / 3)
  if (vertexCount === 0 || boneCount === 0) return { ok: false, reason: 'empty mesh or no bones' }
  if (triCount === 0) return { ok: false, reason: 'no triangle faces to voxelize' }

  const { min: bboxMin, max: bboxMax } = boxOf(positions, vertexCount)
  const extent: Vec3I = [bboxMax[0] - bboxMin[0], bboxMax[1] - bboxMin[1], bboxMax[2] - bboxMin[2]]
  if (!extent.every((e) => Number.isFinite(e) && e > 1e-9)) {
    return { ok: false, reason: `degenerate bounding box (extent=${JSON.stringify(extent)})` }
  }

  const res = Math.round(Math.min(MAX_RESOLUTION, Math.max(MIN_RESOLUTION, Number.isFinite(resolution) ? resolution : MIN_RESOLUTION)))
  const grid = new VoxelGrid(bboxMin, bboxMax, res)

  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3()
  for (let t = 0; t < triCount; t += 1) {
    const ia = index[t * 3], ib = index[t * 3 + 1], ic = index[t * 3 + 2]
    p0.set(positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2])
    p1.set(positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2])
    p2.set(positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2])
    grid.rasterizeTriangle(p0, p1, p2)
  }
  if (grid.surfaceVoxelCount === 0) return { ok: false, reason: 'triangle rasterization produced no surface voxels' }

  grid.computeSolid()
  // 敞口/非流形网格（薄片、发夹带）：flood fill 会从表面的洞漏进"内部"，几乎没有格子被
  // 判为内部，此时 solid ≈ surface——判定体素化不可靠，交回表面图路径。
  if (grid.solidVoxelCount < grid.surfaceVoxelCount * MIN_SOLID_TO_SURFACE_RATIO) {
    return {
      ok: false,
      reason: `mesh does not appear to be a closed volume (solid=${grid.solidVoxelCount} vs surface=${grid.surfaceVoxelCount})`,
    }
  }

  const boneFields: Float64Array[] = new Array(boneCount)
  const unreachableBones: number[] = []
  for (let b = 0; b < boneCount; b += 1) {
    const seeds = segmentSolidVoxels(grid, bones[b])
    boneFields[b] = dijkstraGeodesicField(grid, seeds)
    if (seeds.size === 0) unreachableBones.push(b)
  }
  if (unreachableBones.length === boneCount) {
    return { ok: false, reason: 'no bone segment intersects the solid volume' }
  }

  const skinIndex = new Uint16Array(vertexCount * 4)
  const skinWeight = new Float32Array(vertexCount * 4)
  const distances = new Float64Array(boneCount)
  let unreachableVertexCount = 0

  for (let v = 0; v < vertexCount; v += 1) {
    const [cx, cy, cz] = grid.cellOf(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
    const flat = grid.flat(cx, cy, cz)
    let hasReachable = false
    for (let b = 0; b < boneCount; b += 1) {
      const d = boneFields[b][flat]
      distances[b] = Number.isFinite(d) ? Math.max(d, MIN_VOXEL_DISTANCE) * grid.step : Infinity
      if (Number.isFinite(d)) hasReachable = true
    }
    if (!hasReachable) unreachableVertexCount += 1
    const { index: topIdx, weight: w } = resolveVertexBinding(distances, boneCount, maxInfluences, falloff, radiusFactor)
    for (let k = 0; k < topIdx.length; k += 1) {
      skinIndex[v * 4 + k] = topIdx[k]
      skinWeight[v * 4 + k] = w[k]
    }
  }

  return {
    ok: true,
    binding: { skinIndex, skinWeight },
    diagnostics: {
      unreachableVertexCount,
      unreachableBones,
      resolution: res,
      solidVoxelCount: grid.solidVoxelCount,
      surfaceVoxelCount: grid.surfaceVoxelCount,
    },
  }
}
