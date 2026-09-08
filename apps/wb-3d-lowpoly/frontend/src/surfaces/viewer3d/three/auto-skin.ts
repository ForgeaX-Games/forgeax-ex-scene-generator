// 💡 自动蒙皮：从可蒙皮网格顶点 + 骨架骨段求每顶点 4 骨 skinIndex / skinWeight。
//    预览（useViewer3DScene 的 character 分支）与导出（exportCharacterGlbBlob）共用同一
//    求解器；结果按 cacheKey 缓存，避免每帧 / 每次导出重算。
//
//    方法（"auto"，真体素测地绑定——不再是"网格测地距离，非真体素"的旧描述）：
//    - 传入 triangle `index` 时，**主路径**是 `voxel-skin.ts` 的体素测地绑定：体素化
//      （表面栅格化 + flood fill 定内外）+ 每根骨一次 26-邻域 Dijkstra，在网格自身体积
//      内部测量真实最短路径，天生支持"贴身但不共享顶点的独立 part"（不需要顶点焊接）。
//    - 体素化前置检查失败时（包围盒退化、三角面不足、或判定 mesh 不是近似封闭体——比如
//      敞口薄片/发夹带这类拓扑），**降级为 fallback**：`computeSkinWeightsGeodesic`
//      （旧的表面图实现：顶点焊接 + 邻接图 + 多源 Dijkstra，沿网格表面走测地距离），并打一条
//      console.warn 说明降级原因，避免用户在结果变差时毫无线索。
//    - 未传 `index`（或 `method="rigid"`）时：整体退化为纯欧氏点到骨段距离（原始基线
//      算法），行为与升级前一致——用作没有网格拓扑信息时的兜底路径。
//    - 三条路径（体素测地 / 表面图测地 / 欧氏）求出距离后统一走同一套「相对截止 top-K +
//      1/(d^falloff+eps) 归一化」选骨逻辑（`resolveVertexBinding`），只是距离来源不同。
//    - "rigid"：每顶点 100% 绑定到最近的单根骨（等价 maxInfluences=1，始终走欧氏，语义
//      简单明确，不受体素化/图拓扑影响）。
//
//    默认偏「硬」：falloff=5、maxInfluences=2、radiusFactor=1.6——低模角色动作时形变
//    更克制（radiusFactor 收紧后，远骨更难混入某顶点的候选集，减少"belly"区域被邻段
//    拉扯的幅度）；要更软可在 DSL `skin(falloff=2, max_influences=4)` 显式放宽
//    （radiusFactor 目前未经 DSL 暴露，只能改此文件常量）。
//
//    `resolution`（DSL `skin(resolution=)`）现在直接是体素网格分辨率本身（每轴体素数，
//    夹取到 [4,96]），语义比旧版"顶点焊接容差启发值"更贴近字面含义；表面图 fallback 路径
//    仍按旧公式把它当"焊接容差启发值"用（`weldEpsilonForResolution`），因为该路径没有
//    体素网格，这是两条路径分别复用同一个数值的合理折中，不需要 DSL 再加一个参数。
import * as THREE from 'three'
import { computeSkinWeightsVoxel, type VoxelSkinDiagnostics } from './voxel-skin'

export interface BoneSegment {
  head: THREE.Vector3
  tail: THREE.Vector3
}

export interface AutoSkinParams {
  method: 'auto' | 'rigid'
  /** 每顶点最大影响骨数（1..4）。默认 2（低模更硬）。 */
  maxInfluences: number
  /** 权重随骨距衰减的指数（越大越"硬"，越贴近最近骨）。默认 5。 */
  falloff: number
  /**
   * 相对距离截止：只保留 dist ≤ radiusFactor × nearestDist 的骨（另加绝对地板）。
   * 越大越「软 / 远骨也能拉」；默认 1.6（原 2.5 偏软，容易让邻段骨蹭进权重导致
   * 形变幅度偏大）。≤1 等于只绑最近骨。
   */
  radiusFactor?: number
  /**
   * DSL `skin(resolution=)`，[4, 96]（与 g_to_rig/voxel-skin.ts 的夹取范围一致），默认 48。
   * 有 `index`（网格拓扑）时直接当体素网格分辨率传给 computeSkinWeightsVoxel；voxel 路径
   * 不可用时退化到表面图测地路径，此时复用同一个数字换算顶点焊接容差（越高越保守，只焊
   * 真正重合/近重合的顶点）。欧氏兜底路径（无 `index`）不使用。
   */
  resolution?: number
}

export interface SkinBinding {
  /** 每顶点 4 个骨下标（不足补 0）。长度 = vertexCount * 4。 */
  skinIndex: Uint16Array
  /** 每顶点 4 个骨权重（已归一化，和为 1）。长度 = vertexCount * 4。 */
  skinWeight: Float32Array
  /**
   * 仅体素路径填充：`unreachableVertexCount` / `unreachableBones` 等诊断信号，供
   * `g_skin_qc` 输出非致命警告。表面图 / 欧氏路径不产生该字段（undefined）。
   */
  diagnostics?: VoxelSkinDiagnostics
}

const EPS = 1e-6
/**
 * 权重距离的最小值（米）。必须在距离进入幂运算前截断；若把 EPS 加到 d^falloff 后，
 * falloff=5 时 6.3cm 内的距离差都会被 1e-6 淹没，肩部两根骨会错误趋近 50:50。
 */
const MIN_WEIGHT_DISTANCE = 1e-5
/** 未传参时的默认——偏硬，压低动作形变幅度。 */
const DEFAULT_FALLOFF = 5
const DEFAULT_MAX_INFLUENCES = 2
const DEFAULT_RADIUS_FACTOR = 1.6
/** 绝对距离地板（米）：最近骨几乎贴面时仍允许少量邻骨过渡，避免全模型变 rigid。 */
const MIN_RADIUS_ABS = 0.02
/** `resolution` 未传时的默认体素分辨率启发值。 */
const DEFAULT_RESOLUTION = 48
/** 每根骨采样多少个种子点（沿 head→tail 等分）；越多对长骨的近似越贴合连续线段。 */
const SEGMENT_SAMPLE_COUNT: number = 17

/** 点 p 到线段 [a,b] 的最近距离平方（沿段夹取 t∈[0,1]）。 */
function pointSegmentDistanceSq(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const apx = px - ax
  const apy = py - ay
  const apz = pz - az
  const abLenSq = abx * abx + aby * aby + abz * abz
  let t = abLenSq > EPS ? (apx * abx + apy * aby + apz * abz) / abLenSq : 0
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const cx = ax + abx * t
  const cy = ay + aby * t
  const cz = az + abz * t
  const dx = px - cx
  const dy = py - cy
  const dz = pz - cz
  return dx * dx + dy * dy + dz * dz
}

/**
 * 给定某顶点到每根骨的距离（测地/欧氏/体素，同一数组内可混用——见模块头注释④），选出
 * top maxInfluences 根骨并算出归一化权重。三条距离来源路径（欧氏、表面图测地、体素
 * 测地）共用此函数——导出给 `voxel-skin.ts` 直接 import，不复制这段选骨/归一化逻辑。
 */
export function resolveVertexBinding(
  distances: Float64Array,
  boneCount: number,
  maxInfluences: number,
  falloff: number,
  radiusFactor: number,
): { index: number[]; weight: number[] } {
  let nearestDist = Infinity
  for (let b = 0; b < boneCount; b += 1) {
    if (distances[b] < nearestDist) nearestDist = distances[b]
  }
  const radius = Math.max(MIN_RADIUS_ABS, nearestDist * radiusFactor)

  const topIdx: number[] = []
  for (let k = 0; k < maxInfluences; k += 1) {
    let best = -1
    let bestD = Infinity
    for (let b = 0; b < boneCount; b += 1) {
      if (topIdx.includes(b)) continue
      if (distances[b] > radius) continue
      if (distances[b] < bestD) {
        bestD = distances[b]
        best = b
      }
    }
    if (best < 0) break
    topIdx.push(best)
  }
  // 兜底：截止太严时至少绑最近骨。
  if (topIdx.length === 0) {
    let best = 0
    for (let b = 1; b < boneCount; b += 1) {
      if (distances[b] < distances[best]) best = b
    }
    topIdx.push(best)
  }

  let sum = 0
  const w: number[] = []
  for (let k = 0; k < topIdx.length; k += 1) {
    const d = distances[topIdx[k]]
    const weight = 1 / Math.pow(Math.max(d, MIN_WEIGHT_DISTANCE), falloff)
    w.push(weight)
    sum += weight
  }
  if (sum <= 0) {
    const even = 1 / Math.max(1, topIdx.length)
    return { index: topIdx, weight: topIdx.map(() => even) }
  }
  return { index: topIdx, weight: w.map((x) => x / sum) }
}

/** 纯欧氏点到骨段距离路径（原始基线算法）：没有三角面拓扑信息时的兜底。 */
function computeSkinWeightsEuclidean(
  positions: Float32Array,
  bones: readonly BoneSegment[],
  maxInfluences: number,
  falloff: number,
  radiusFactor: number,
): SkinBinding {
  const vertexCount = Math.floor(positions.length / 3)
  const boneCount = bones.length
  const skinIndex = new Uint16Array(vertexCount * 4)
  const skinWeight = new Float32Array(vertexCount * 4)
  const distances = new Float64Array(boneCount)

  for (let v = 0; v < vertexCount; v += 1) {
    const px = positions[v * 3]
    const py = positions[v * 3 + 1]
    const pz = positions[v * 3 + 2]
    for (let b = 0; b < boneCount; b += 1) {
      const seg = bones[b]
      distances[b] = Math.sqrt(pointSegmentDistanceSq(
        px, py, pz,
        seg.head.x, seg.head.y, seg.head.z,
        seg.tail.x, seg.tail.y, seg.tail.z,
      ))
    }
    const { index: topIdx, weight: w } = resolveVertexBinding(distances, boneCount, maxInfluences, falloff, radiusFactor)
    for (let k = 0; k < topIdx.length; k += 1) {
      skinIndex[v * 4 + k] = topIdx[k]
      skinWeight[v * 4 + k] = w[k]
    }
  }
  return { skinIndex, skinWeight }
}

// ── 测地路径：顶点焊接 + 邻接图 + 多源 Dijkstra ─────────────────────────────

interface WeldResult {
  /** 原始顶点下标 → 焊接后顶点 id。长度 = 原始顶点数。 */
  weldedIndexOf: Int32Array
  /** 焊接后顶点位置（同一簇取质心）。长度 = weldedCount * 3。 */
  weldedPositions: Float64Array
  weldedCount: number
}

/**
 * 网格顶点焊接：以 `eps` 为阈值合并空间上几乎重合的顶点（同簇取质心代表位置）。
 * 用于把分别 bake、互不共享顶点的各 part 网格在物理接触处"缝"进同一张连通图，
 * 否则测地距离在不连通分量之间是未定义的。用空间哈希网格（cell=eps）分桶，检查
 * 3×3×3 邻域桶做近似最近邻匹配，均摊 O(V)。
 */
function weldVertices(positions: Float32Array, vertexCount: number, eps: number): WeldResult {
  const cellSize = Math.max(eps, 1e-9)
  const eps2 = eps * eps
  const buckets = new Map<string, number[]>()
  const weldedIndexOf = new Int32Array(vertexCount)
  const sumX: number[] = []
  const sumY: number[] = []
  const sumZ: number[] = []
  const counts: number[] = []
  let weldedCount = 0

  const keyOf = (cx: number, cy: number, cz: number): string => `${cx}_${cy}_${cz}`

  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3]
    const y = positions[v * 3 + 1]
    const z = positions[v * 3 + 2]
    const cx = Math.floor(x / cellSize)
    const cy = Math.floor(y / cellSize)
    const cz = Math.floor(z / cellSize)

    let found = -1
    for (let dx = -1; dx <= 1 && found < 0; dx += 1) {
      for (let dy = -1; dy <= 1 && found < 0; dy += 1) {
        for (let dz = -1; dz <= 1 && found < 0; dz += 1) {
          const ids = buckets.get(keyOf(cx + dx, cy + dy, cz + dz))
          if (!ids) continue
          for (const id of ids) {
            const ox = sumX[id] / counts[id]
            const oy = sumY[id] / counts[id]
            const oz = sumZ[id] / counts[id]
            const ddx = x - ox
            const ddy = y - oy
            const ddz = z - oz
            if (ddx * ddx + ddy * ddy + ddz * ddz <= eps2) {
              found = id
              break
            }
          }
        }
      }
    }

    if (found < 0) {
      found = weldedCount
      weldedCount += 1
      sumX.push(0)
      sumY.push(0)
      sumZ.push(0)
      counts.push(0)
      const key = keyOf(cx, cy, cz)
      const bucket = buckets.get(key)
      if (bucket) bucket.push(found)
      else buckets.set(key, [found])
    }
    sumX[found] += x
    sumY[found] += y
    sumZ[found] += z
    counts[found] += 1
    weldedIndexOf[v] = found
  }

  const weldedPositions = new Float64Array(weldedCount * 3)
  for (let i = 0; i < weldedCount; i += 1) {
    weldedPositions[i * 3] = sumX[i] / counts[i]
    weldedPositions[i * 3 + 1] = sumY[i] / counts[i]
    weldedPositions[i * 3 + 2] = sumZ[i] / counts[i]
  }
  return { weldedIndexOf, weldedPositions, weldedCount }
}

interface AdjacencyEdge {
  to: number
  weight: number
}

/** 由焊接后三角面的边构建顶点邻接表（边权 = 焊接顶点间欧氏距离）；重复边取最小权。 */
function buildAdjacency(
  weldedIndexOf: Int32Array,
  weldedCount: number,
  weldedPositions: Float64Array,
  index: ArrayLike<number>,
): AdjacencyEdge[][] {
  const maps: Array<Map<number, number>> = new Array(weldedCount)
  for (let i = 0; i < weldedCount; i += 1) maps[i] = new Map()

  const addEdge = (a: number, b: number): void => {
    if (a === b) return
    const dx = weldedPositions[a * 3] - weldedPositions[b * 3]
    const dy = weldedPositions[a * 3 + 1] - weldedPositions[b * 3 + 1]
    const dz = weldedPositions[a * 3 + 2] - weldedPositions[b * 3 + 2]
    const w = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const cur = maps[a].get(b)
    if (cur === undefined || w < cur) maps[a].set(b, w)
  }

  const triCount = Math.floor(index.length / 3)
  for (let t = 0; t < triCount; t += 1) {
    const a = weldedIndexOf[index[t * 3]]
    const b = weldedIndexOf[index[t * 3 + 1]]
    const c = weldedIndexOf[index[t * 3 + 2]]
    addEdge(a, b)
    addEdge(b, a)
    addEdge(b, c)
    addEdge(c, b)
    addEdge(c, a)
    addEdge(a, c)
  }

  return maps.map((m) => Array.from(m, ([to, weight]) => ({ to, weight })))
}

/** 简单二叉最小堆（(dist,vertex) 对，惰性删除过期条目），供 Dijkstra 用。 */
class MinHeap {
  private items: Array<{ dist: number; v: number }> = []

  get size(): number {
    return this.items.length
  }

  push(item: { dist: number; v: number }): void {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent].dist <= items[i].dist) break
      const tmp = items[parent]
      items[parent] = items[i]
      items[i] = tmp
      i = parent
    }
  }

  pop(): { dist: number; v: number } | undefined {
    const items = this.items
    if (items.length === 0) return undefined
    const top = items[0]
    const last = items.pop()!
    if (items.length > 0) {
      items[0] = last
      let i = 0
      const n = items.length
      for (;;) {
        const l = 2 * i + 1
        const r = 2 * i + 2
        let smallest = i
        if (l < n && items[l].dist < items[smallest].dist) smallest = l
        if (r < n && items[r].dist < items[smallest].dist) smallest = r
        if (smallest === i) break
        const tmp = items[smallest]
        items[smallest] = items[i]
        items[i] = tmp
        i = smallest
      }
    }
    return top
  }
}

/** 多源 Dijkstra：`seeds` 是「焊接顶点 id → 初始距离」（种子到该顶点自身的入图代价）。 */
function multiSourceDijkstra(
  adjacency: readonly AdjacencyEdge[][],
  seeds: ReadonlyMap<number, number>,
  vertexCount: number,
): Float64Array {
  const dist = new Float64Array(vertexCount).fill(Infinity)
  const heap = new MinHeap()
  for (const [v, d] of seeds) {
    if (d < dist[v]) {
      dist[v] = d
      heap.push({ dist: d, v })
    }
  }
  for (;;) {
    const top = heap.pop()
    if (!top) break
    const { dist: d, v } = top
    if (d > dist[v]) continue // 过期条目（已被更短路径覆盖）
    const neighbors = adjacency[v]
    for (let i = 0; i < neighbors.length; i += 1) {
      const { to, weight } = neighbors[i]
      const nd = d + weight
      if (nd < dist[to]) {
        dist[to] = nd
        heap.push({ dist: nd, v: to })
      }
    }
  }
  return dist
}

/**
 * 由 `resolution` 推导顶点焊接容差。焊接只负责合并 bake 后本应重合的 seam，不能把手贴
 * 身体这类彼此靠近但拓扑无关的表面缝起来。旧比例 1/(res*8) 在 2m 角色上默认约 5mm，
 * 足以制造明显的跨表面捷径；这里收紧 8 倍，仍能覆盖浮点/矩阵 bake 误差。
 */
function weldEpsilonForResolution(resolution: number | undefined, bboxDiagonal: number): number {
  const res = Number.isFinite(resolution) && (resolution as number) > 0 ? (resolution as number) : DEFAULT_RESOLUTION
  const ratio = Math.min(0.0005, Math.max(0.00001, 1 / (res * 64)))
  return Math.max(bboxDiagonal * ratio, 1e-6)
}

/**
 * 沿骨段采样测地种子。先以骨段中点最近顶点作为拓扑锚点，再只接受与锚点的表面路径长度
 * 符合该采样点沿骨段位移的候选。这样即使手骨某个采样点在空间上更靠近躯干表面，也不会
 * 越过整条手臂的表面路径把躯干顶点直接变成手骨的零距离种子。
 */
function pickBoneSeeds(
  weld: WeldResult,
  adjacency: readonly AdjacencyEdge[][],
  seg: BoneSegment,
  weldEps: number,
): Map<number, number> {
  const seeds = new Map<number, number>()
  const { weldedPositions, weldedCount } = weld
  if (weldedCount === 0) return seeds

  const nearestVertex = (x: number, y: number, z: number): { vertex: number; distance: number } => {
    let best = -1
    let bestD2 = Infinity
    for (let w = 0; w < weldedCount; w += 1) {
      const dx = weldedPositions[w * 3] - x
      const dy = weldedPositions[w * 3 + 1] - y
      const dz = weldedPositions[w * 3 + 2] - z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < bestD2) {
        bestD2 = d2
        best = w
      }
    }
    return { vertex: best, distance: Math.sqrt(bestD2) }
  }

  const mx = (seg.head.x + seg.tail.x) * 0.5
  const my = (seg.head.y + seg.tail.y) * 0.5
  const mz = (seg.head.z + seg.tail.z) * 0.5
  const anchor = nearestVertex(mx, my, mz)
  if (anchor.vertex < 0) return seeds
  const anchorDistances = multiSourceDijkstra(
    adjacency,
    new Map([[anchor.vertex, 0]]),
    weldedCount,
  )
  const segmentLength = seg.head.distanceTo(seg.tail)
  const localSlack = Math.max(segmentLength * 0.15, anchor.distance * 2, weldEps * 4)

  for (let i = 0; i < SEGMENT_SAMPLE_COUNT; i += 1) {
    const t = SEGMENT_SAMPLE_COUNT === 1 ? 0 : i / (SEGMENT_SAMPLE_COUNT - 1)
    const sx = seg.head.x + (seg.tail.x - seg.head.x) * t
    const sy = seg.head.y + (seg.tail.y - seg.head.y) * t
    const sz = seg.head.z + (seg.tail.z - seg.head.z) * t

    const candidate = nearestVertex(sx, sy, sz)
    if (candidate.vertex >= 0) {
      const expectedAlongSurface = Math.abs(t - 0.5) * segmentLength * 1.75 + localSlack
      if (anchorDistances[candidate.vertex] > expectedAlongSurface) continue
      const existing = seeds.get(candidate.vertex)
      if (existing === undefined || candidate.distance < existing) {
        seeds.set(candidate.vertex, candidate.distance)
      }
    }
  }
  // 极端退化/稀疏网格下仍保证锚点入图。
  if (seeds.size === 0) seeds.set(anchor.vertex, anchor.distance)
  return seeds
}

/**
 * 测地距离路径：焊接 → 建图 → 每根骨一次多源 Dijkstra → 每顶点按（测地距离，缺省退化
 * 欧氏距离）选骨归一化。`index` 是三角面顶点下标（与 `positions` 同一坐标系/顶点顺序，
 * 可以是合并多个 part 后的三角面——只要顶点下标与 `positions` 对应即可）。
 */
function computeSkinWeightsGeodesic(
  positions: Float32Array,
  index: ArrayLike<number>,
  bones: readonly BoneSegment[],
  maxInfluences: number,
  falloff: number,
  radiusFactor: number,
  resolution: number | undefined,
): SkinBinding {
  const vertexCount = Math.floor(positions.length / 3)
  const boneCount = bones.length
  const skinIndex = new Uint16Array(vertexCount * 4)
  const skinWeight = new Float32Array(vertexCount * 4)

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3]
    const y = positions[v * 3 + 1]
    const z = positions[v * 3 + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const bboxDiagonal = Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2)
  const weldEps = weldEpsilonForResolution(resolution, bboxDiagonal)

  const weld = weldVertices(positions, vertexCount, weldEps)
  const adjacency = buildAdjacency(weld.weldedIndexOf, weld.weldedCount, weld.weldedPositions, index)

  // 每根骨一次多源 Dijkstra，得到它到全图所有焊接顶点的近似测地距离场。
  const boneDistanceFields: Float64Array[] = new Array(boneCount)
  for (let b = 0; b < boneCount; b += 1) {
    const seeds = pickBoneSeeds(weld, adjacency, bones[b], weldEps)
    boneDistanceFields[b] = multiSourceDijkstra(adjacency, seeds, weld.weldedCount)
  }

  const distances = new Float64Array(boneCount)
  for (let v = 0; v < vertexCount; v += 1) {
    const weldedId = weld.weldedIndexOf[v]
    const px = positions[v * 3]
    const py = positions[v * 3 + 1]
    const pz = positions[v * 3 + 2]
    let hasReachableBone = false
    for (let b = 0; b < boneCount; b += 1) {
      const gd = boneDistanceFields[b][weldedId]
      if (Number.isFinite(gd)) {
        distances[b] = gd
        hasReachableBone = true
      } else {
        // 只要当前分量已有可达骨，就必须排除不可达骨，不能让手骨通过欧氏距离串到躯干。
        distances[b] = Infinity
      }
    }
    if (!hasReachableBone) {
      // 整个分量没有任何骨种子（例如独立道具）时，才整体退化为欧氏距离。
      for (let b = 0; b < boneCount; b += 1) {
        const seg = bones[b]
        distances[b] = Math.sqrt(pointSegmentDistanceSq(
          px, py, pz,
          seg.head.x, seg.head.y, seg.head.z,
          seg.tail.x, seg.tail.y, seg.tail.z,
        ))
      }
    }
    const { index: topIdx, weight: w } = resolveVertexBinding(distances, boneCount, maxInfluences, falloff, radiusFactor)
    for (let k = 0; k < topIdx.length; k += 1) {
      skinIndex[v * 4 + k] = topIdx[k]
      skinWeight[v * 4 + k] = w[k]
    }
  }

  return { skinIndex, skinWeight }
}

/**
 * 求解每顶点 4 骨 skinIndex / skinWeight。`positions` 与 `bones` 必须在同一坐标系
 * （模型根帧）。返回的两个 typed array 可直接 setAttribute 到 BufferGeometry。
 *
 * `index`（可选）：三角面顶点下标，与 `positions` 同顶点顺序——传入时 `method="auto"`
 * 优先走体素测地路径（`voxel-skin.ts`，见模块头注释）；体素化前置检查失败时自动降级为
 * 表面图测地路径（焊接+建图+多源 Dijkstra）。不传或 `method="rigid"` 时整体走欧氏点到
 * 骨段距离（原始基线算法）。
 */
export function computeSkinWeights(
  positions: Float32Array,
  bones: readonly BoneSegment[],
  params: AutoSkinParams,
  index?: ArrayLike<number> | null,
): SkinBinding {
  const vertexCount = Math.floor(positions.length / 3)
  const boneCount = bones.length
  if (boneCount === 0 || vertexCount === 0) {
    return { skinIndex: new Uint16Array(vertexCount * 4), skinWeight: new Float32Array(vertexCount * 4) }
  }

  const maxInfluences = params.method === 'rigid'
    ? 1
    : Math.max(1, Math.min(4, Math.floor(params.maxInfluences) || DEFAULT_MAX_INFLUENCES))
  const falloff = Number.isFinite(params.falloff) && params.falloff > 0 ? params.falloff : DEFAULT_FALLOFF
  const radiusFactor = Number.isFinite(params.radiusFactor) && (params.radiusFactor as number) > 0
    ? (params.radiusFactor as number)
    : DEFAULT_RADIUS_FACTOR

  const canUseMeshTopology = params.method === 'auto' && !!index && index.length >= 3
  if (canUseMeshTopology) {
    const meshIndex = index as ArrayLike<number>
    const resolution = Number.isFinite(params.resolution) && (params.resolution as number) > 0
      ? (params.resolution as number)
      : DEFAULT_RESOLUTION
    const voxelResult = computeSkinWeightsVoxel(positions, meshIndex, bones, maxInfluences, falloff, radiusFactor, resolution)
    if (voxelResult.ok) {
      return { ...voxelResult.binding, diagnostics: voxelResult.diagnostics }
    }
    console.warn(`[auto-skin] voxel geodesic binding unavailable (${voxelResult.reason}); falling back to surface-graph geodesic path`)
    return computeSkinWeightsGeodesic(positions, meshIndex, bones, maxInfluences, falloff, radiusFactor, params.resolution)
  }
  return computeSkinWeightsEuclidean(positions, bones, maxInfluences, falloff, radiusFactor)
}

// ── 缓存 ────────────────────────────────────────────────────────────────────
// 权重求解对每个（网格 + 骨架 + 参数）组合是纯函数，按 cacheKey 记忆，供预览的每帧
// 渲染与后续导出复用。小上限 LRU：切换模型/迭代会持续产生新 key。
const MAX_CACHE_ENTRIES = 16
const bindingCache = new Map<string, SkinBinding>()

/** 求解并缓存（相同 cacheKey 直接命中）。 */
export function computeSkinWeightsCached(
  cacheKey: string,
  positions: Float32Array,
  bones: readonly BoneSegment[],
  params: AutoSkinParams,
  index?: ArrayLike<number> | null,
): SkinBinding {
  const hit = bindingCache.get(cacheKey)
  if (hit) {
    // 移到 LRU 末尾
    bindingCache.delete(cacheKey)
    bindingCache.set(cacheKey, hit)
    return hit
  }
  const binding = computeSkinWeights(positions, bones, params, index)
  bindingCache.set(cacheKey, binding)
  while (bindingCache.size > MAX_CACHE_ENTRIES) {
    const oldest = bindingCache.keys().next()
    if (oldest.done) break
    bindingCache.delete(oldest.value)
  }
  return binding
}

/** 测试 / 手动失效用。 */
export function clearSkinWeightCache(): void {
  bindingCache.clear()
}
