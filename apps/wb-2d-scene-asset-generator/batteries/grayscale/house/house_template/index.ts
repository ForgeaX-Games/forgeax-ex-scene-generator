/**
 * house_template — 房屋模板：只画「房顶掩码」，程序自动生成立面，门由掩码控制，渲染成灰度图。
 *
 * 输入端口 spec 为 string，接收一个**只表达房顶**的二维数组字符串
 * `[[1,1,0],[1,1,1],...]`（1=房顶占位，0=空，**2=在该列开门**）。立面由程序按屋顶形状自动
 * 生成；门不再随机生成，而是由掩码里的 2 标记控制：
 *
 *   1. expand        每个 mask 顶部插入 height 行 0
 *   2. offset        对房顶(1)按 height 向上投影，路径标记为 2（立面）
 *   3. differentiate 多段建筑下沿：第 2 段起把其下方连续的 2 改为 3、4、5…
 *   4. placeDoors    按掩码门标记开门（缩放前的掩格域）：门标记 (r,c) 映射到立面 (r+height,c)，
 *                    在该墙脚立面格置门（标 9），**固定 1 格高**；相邻列标记连成更宽的门。
 *   4b resize        等比缩放居中到 size×size（门随网格一并缩放，故门尺寸只由掩码+height 决定）。
 *   5. placeWindows  在各立面连通块上按网格自动排布窗户（标 8），窗数/行列由立面尺寸
 *                    推导，避开门与边缘留白。
 *   5b makeDoorsAjar 把每扇门做半虚掩示意：靠一侧留一道竖向门缝（标 10，近黑室内）。
 *   6. render        逐格映射灰度：顶面按 roofType 着色——pitched 由 ComputeRoof 从屋顶
 *                    轮廓（多源 BFS 草火法）算出朝上/下/左/右坡面，按朝向纯色平涂，坡面
 *                    交界（屋脊/斜脊/天沟）经描边自动成线，呈现真实屋顶结构：矩形=直脊、
 *                    L=L 脊、T=T 脊、十字=十字脊，斜脊以 45° 连到中轴端点；flat=纯色屋面板
 *                    + 外缘女儿墙/檐口收边圈。立面=浅灰平涂（多段微压暗区分）；窗=较深灰、
 *                    门扇=深灰、门缝=近黑；背景=白。最后沿建筑外缘与各区域交界描深色细线。
 *
 * 单个二维数组产出一张灰度图，经 ctx.services.asset2d.createImage 双写
 * （顶层 .forgeax/grayscale/ 归档 + 资产库 image 端口）。
 *
 * 纯算法（MaskToHouseGray 等）以 Uppercase 命名导出供单测，避免被电池加载器误
 * 当作 entry —— 加载器取「首个小写字母开头的导出函数」作为入口，故 houseTemplate
 * 必须是本文件唯一的小写开头导出函数。
 */

import { createImage, type DecodedImage } from '../../../_shared/asset2d.js'

type Grid = number[][]

// mask 语义值
const V_ROOF = 1 // 房顶/顶面（输入）
const V_FACADE = 2 // 立面（投影生成；多段时 3,4,5…）
const V_WINDOW = 8 // 窗户（placeWindows 标记，独立于立面分段值）
const V_DOOR = 9 // 门扇/门叶（placeDoorsFromMask 标记，独立于立面分段值）
const V_DOOR_OPEN = 10 // 半虚掩门的「门缝/露出的室内」（makeDoorsAjar 标记）

// 屋顶类型
export type RoofType = 'pitched' | 'flat'

// 渲染配色（扁平着色：顶面=深灰、立面=浅灰、门=近黑、背景=白；
// 三个明度层级拉开对比，使「顶面 / 立面 / 门」清晰可辨，便于大模型识别建筑轮廓）
const COLOR_ROOF = 120 // 平屋顶顶面/屋面板（深灰，纯色平涂）
const COLOR_PARAPET = 158 // 平屋顶女儿墙顶帽（比屋面板亮一档，沿顶面外缘成一圈）
const COLOR_PARAPET_SHADOW = 96 // 女儿墙顶帽内侧的投影带（比屋面板更暗，制造立体「看线」+阴影）
const COLOR_FACADE = 192 // 立面（浅灰，纯色平涂，与顶面拉开对比）
const COLOR_DOOR = 100 // 门扇/门叶（比顶面更深的灰，在浅灰立面上清晰可见）
const COLOR_DOOR_OPEN = 58 // 半虚掩门缝（近黑，表示露出的室内深处）
const COLOR_WINDOW = 132 // 窗（比立面深、比门浅，在浅灰立面上读作窗洞）
const COLOR_BG = 255 // 白底
// 坡屋顶（pitched）：从屋顶轮廓算出各坡面（朝上/下/左/右），按朝向给不同明度纯色平涂，
// 坡面交界（屋脊/斜脊/天沟）由描边自动勾出真实屋顶线条——异形屋顶(T/十字)交接同样成立。
const ROOF_FACE_N = 120 // 朝上（远端）坡面：最暗（背光）
const ROOF_FACE_S = 182 // 朝下（近端）坡面：最亮（受光）
const ROOF_FACE_W = 150 // 朝左坡面
const ROOF_FACE_E = 138 // 朝右坡面
const ROOF_FACE_GRAY = [ROOF_FACE_N, ROOF_FACE_S, ROOF_FACE_W, ROOF_FACE_E]
// 描边：沿建筑外缘与各区域交界画深色细线，强化建筑硬直线轮廓，便于大模型识别。
const COLOR_OUTLINE = 64
// 多段建筑：后一段整体微压暗一档，仅用于区分相邻立面段，幅度小以保持平涂观感
const FACADE_SEGMENT_STEP = 14

function toInt(v: unknown, def = 0): number {
  if (v === null || v === undefined) return def
  const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : def
}

/** 归一化 roof mask：按最小行宽截断，非 0 视为房顶(1)，其余 0。空/非法返回 null。 */
export function NormalizeMask(mask: unknown): Grid | null {
  if (!Array.isArray(mask) || mask.length === 0) return null
  if (!Array.isArray(mask[0])) return null
  const widths = (mask as unknown[]).filter((r) => Array.isArray(r)).map((r) => (r as unknown[]).length)
  if (widths.length === 0) return null
  const w = Math.min(...widths)
  if (w <= 0) return null
  const out: Grid = []
  for (const r of mask as unknown[]) {
    if (!Array.isArray(r)) { out.push(new Array(w).fill(0)); continue }
    const row: number[] = []
    for (let i = 0; i < w; i++) row.push(toInt((r as unknown[])[i], 0) !== 0 ? V_ROOF : 0)
    out.push(row)
  }
  return out
}

/** 1) expand：在 mask 顶部插入 n=height 行 0。 */
export function ExpandMask(mask: Grid, n: number): Grid {
  if (n <= 0 || mask.length === 0 || !Array.isArray(mask[0])) return mask
  const w = mask[0].length
  const zeros: Grid = Array.from({ length: n }, () => new Array(w).fill(0))
  return zeros.concat(mask)
}

/** 2) offset：对房顶(1)按 k=height 向上投影，路径标记为 2（立面）。 */
export function OffsetByHeight(mask: Grid, k: number): Grid {
  if (k <= 0) return mask
  const H = mask.length
  const W = H > 0 ? mask[0].length : 0
  const dst: Grid = mask.map((row) => row.slice())
  const ones: Array<[number, number]> = []
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (mask[r][c] === V_ROOF) ones.push([r, c])
  for (const [r, c] of ones) {
    const top = r - k
    if (top >= 0 && top < H && dst[top][c] !== V_ROOF) dst[top][c] = V_ROOF
    for (let rr = r - k + 1; rr <= r; rr++) if (rr >= 0 && rr < H && dst[rr][c] !== V_FACADE) dst[rr][c] = V_FACADE
  }
  return dst
}

function findBottomEdges(mask: Grid): Array<[number, number]> {
  const H = mask.length
  const W = H > 0 ? mask[0].length : 0
  const edges: Array<[number, number]> = []
  for (let c = 0; c < W; c++) {
    let inRun = false
    let last: number | null = null
    for (let r = 0; r < H; r++) {
      if (mask[r][c] === V_ROOF) { inRun = true; last = r }
      else if (inRun) { if (last !== null) edges.push([last, c]); inRun = false; last = null }
    }
    if (inRun && last !== null) edges.push([last, c])
  }
  return edges
}

function groupEdgesByRow(edges: Array<[number, number]>): Array<Array<[number, number]>> {
  const byRow = new Map<number, Array<[number, number]>>()
  for (const [row, col] of edges) {
    const arr = byRow.get(row) ?? []
    arr.push([row, col])
    byRow.set(row, arr)
  }
  return [...byRow.keys()].sort((a, b) => a - b).map((row) => byRow.get(row)!.slice().sort((a, b) => a[1] - b[1]))
}

function findContinuous2Below(mask: Grid, row: number, cols: number[]): number[] {
  const H = mask.length
  if (row >= H - 1) return []
  const rows: number[] = []
  for (let r = row + 1; r < H; r++) {
    let all2 = true
    for (const c of cols) { if (c >= mask[r].length || mask[r][c] !== V_FACADE) { all2 = false; break } }
    if (all2) rows.push(r); else break
  }
  return rows
}

/** 3) differentiate：多段下沿，第 2 段起把其下方连续 2 改为 3、4、5…。 */
export function DifferentiateFacades(mask: Grid): Grid {
  const edges = findBottomEdges(mask)
  if (edges.length === 0) return mask
  const groups = groupEdgesByRow(edges)
  if (groups.length <= 1) return mask
  const dst: Grid = mask.map((row) => row.slice())
  const sorted = groups.slice().sort((a, b) => (a[0]?.[0] ?? Infinity) - (b[0]?.[0] ?? Infinity))
  for (let i = 1; i < sorted.length; i++) {
    const group = sorted[i]
    if (group.length === 0) continue
    const newValue = i + 2 // 第2段(i=1)→3, 第3段→4 …
    const row = group[0][0]
    const cols = group.map(([, c]) => c)
    for (const r of findContinuous2Below(dst, row, cols)) {
      for (const c of cols) if (c < dst[r].length && dst[r][c] === V_FACADE) dst[r][c] = newValue
    }
  }
  return dst
}

/** 等比缩放居中到 size×size，非 0 区域用最近邻映射，其余补 0。 */
export function ResizeMask(mask: Grid, size: number): Grid {
  const H = mask.length
  const W = H > 0 ? mask[0].length : 0
  const out: Grid = Array.from({ length: size }, () => new Array(size).fill(0))
  if (H === 0 || W === 0) return out
  const scale = Math.min(size / W, size / H)
  const newW = Math.trunc(W * scale)
  const newH = Math.trunc(H * scale)
  const offX = Math.trunc((size - newW) / 2)
  const offY = Math.trunc((size - newH) / 2)
  for (let r = 0; r < newH; r++) {
    for (let c = 0; c < newW; c++) {
      const sr = Math.trunc(r / scale)
      const sc = Math.trunc(c / scale)
      if (sr < H && sc < W) {
        const val = mask[sr][sc]
        if (val !== 0) {
          const tr = offY + r
          const tc = offX + c
          if (tr < size && tc < size) out[tr][tc] = val
        }
      }
    }
  }
  return out
}

/**
 * 4) placeDoorsFromMask：按掩码门标记开门（不再随机生成）。
 *
 * 约定：输入房顶掩码里把「某列底部」的格子由 1 改成 2，即在该列的立面上开一扇门。
 * 门标记 (r,c)（原始掩码坐标）经 ExpandMask 上移 height 行后落到 (r+height,c)，而
 * OffsetByHeight 恰好把该列原底部格投影成「墙脚立面」格——即门所在的立面。故门目标
 * 单元 = (r+height, c)。门固定 **1 格高**，仅占该墙脚立面格本身（不向上延伸）。相邻
 * 列的门标记自然连成更宽的门。该格仍是立面(>=V_FACADE)时才置为 V_DOOR，避免误标到
 * 屋顶/空白（如 height=0 无立面、或标记不在列底部）。
 */
export function PlaceDoorsFromMask(mask: Grid, doors: Array<[number, number]>, height: number): Grid {
  if (doors.length === 0) return mask
  const H = mask.length
  const W = H > 0 ? mask[0].length : 0
  const dst: Grid = mask.map((row) => row.slice())
  for (const [r, c] of doors) {
    const tr = r + height
    if (tr < 0 || tr >= H || c < 0 || c >= W) continue
    const v = dst[tr][c]
    if (v >= V_FACADE && v !== V_DOOR) dst[tr][c] = V_DOOR
  }
  return dst
}

/**
 * 4c) insetDoors：在已缩放的像素网格上把每扇门**横向**两侧各内缩 insetPx 个像素（还原成立面），
 * 使门与墙体/墙角之间始终留出一圈立面边框，经描边后门框与墙轮廓分离、不再糊在一起。
 * 内缩让出的格用门正上方的立面值回填（同段立面，颜色一致）；门过窄时按比例缩减内缩量，至少留 1 列门。
 */
export function InsetDoors(mask: Grid, insetPx: number): Grid {
  if (insetPx <= 0) return mask
  const H = mask.length
  const W = H > 0 ? mask[0].length : 0
  if (H === 0 || W === 0) return mask
  const dst: Grid = mask.map((row) => row.slice())
  const isDoor = (r: number, c: number) => r >= 0 && r < H && c >= 0 && c < dst[r].length && dst[r][c] === V_DOOR
  // 门正上方的立面值（用于回填内缩列），找不到则退回基础立面 V_FACADE。
  const facadeAbove = (top: number, c: number): number => {
    const v = top - 1 >= 0 ? dst[top - 1][c] : 0
    return v >= V_FACADE && v !== V_DOOR && v !== V_WINDOW ? v : V_FACADE
  }
  const seen = Array.from({ length: H }, () => new Array<boolean>(W).fill(false))
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (seen[r][c] || !isDoor(r, c)) continue
      let left = c, right = c, top = r, bot = r
      const stack: Array<[number, number]> = [[r, c]]
      seen[r][c] = true
      while (stack.length) {
        const [cr, cc] = stack.pop()!
        if (cc < left) left = cc; if (cc > right) right = cc
        if (cr < top) top = cr; if (cr > bot) bot = cr
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nr = cr + dr, nc = cc + dc
          if (nr >= 0 && nr < H && nc >= 0 && nc < W && !seen[nr][nc] && isDoor(nr, nc)) { seen[nr][nc] = true; stack.push([nr, nc]) }
        }
      }
      const width = right - left + 1
      // 至少留 1 列门；门越窄内缩越少，避免把门吃没。
      const inset = Math.max(0, Math.min(insetPx, Math.floor((width - 1) / 2)))
      if (inset <= 0) continue
      for (let rr = top; rr <= bot; rr++) {
        for (let cc = left; cc < left + inset; cc++) if (dst[rr][cc] === V_DOOR) dst[rr][cc] = facadeAbove(top, cc)
        for (let cc = right - inset + 1; cc <= right; cc++) if (dst[rr][cc] === V_DOOR) dst[rr][cc] = facadeAbove(top, cc)
      }
    }
  }
  return dst
}

/**
 * 5b) placeWindows：在各立面连通块上按网格自动排布窗户（标 V_WINDOW）。
 * 窗数/行列由立面块尺寸自动推导（不引入参数）；只覆盖当前仍是立面的格子，
 * 避开门与块边缘留白，使窗户四周保有立面框，经描边后读作窗洞。
 */
export function PlaceWindows(mask: Grid, size: number): Grid {
  const H = mask.length
  const W = H > 0 ? mask[0].length : 0
  if (H === 0 || W === 0) return mask
  const dst: Grid = mask.map((row) => row.slice())
  const isFac = (r: number, c: number): boolean =>
    r >= 0 && r < H && c >= 0 && c < dst[r].length && dst[r][c] >= V_FACADE && dst[r][c] !== V_DOOR && dst[r][c] !== V_WINDOW
  const isDoor = (r: number, c: number): boolean => r >= 0 && r < H && c >= 0 && c < dst[r].length && dst[r][c] === V_DOOR

  // 立面连通块（4 连通）。
  const seen = Array.from({ length: H }, () => new Array<boolean>(W).fill(false))
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (seen[r][c] || !isFac(r, c)) continue
      let top = r, bot = r, left = c, right = c
      const stack: Array<[number, number]> = [[r, c]]
      seen[r][c] = true
      while (stack.length) {
        const [cr, cc] = stack.pop()!
        if (cr < top) top = cr
        if (cr > bot) bot = cr
        if (cc < left) left = cc
        if (cc > right) right = cc
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nr = cr + dr, nc = cc + dc
          if (nr >= 0 && nr < H && nc >= 0 && nc < W && !seen[nr][nc] && isFac(nr, nc)) {
            seen[nr][nc] = true
            stack.push([nr, nc])
          }
        }
      }
      stampWindowsInBox(dst, isFac, isDoor, top, bot, left, right, size)
    }
  }
  return dst
}

/** 在一个立面连通块的包围盒内按网格落窗：留边、按目标窗距推导行列、避开门。 */
function stampWindowsInBox(
  dst: Grid,
  isFac: (r: number, c: number) => boolean,
  isDoor: (r: number, c: number) => boolean,
  top: number,
  bot: number,
  left: number,
  right: number,
  size: number,
): void {
  const margin = Math.max(1, Math.round(Math.min(right - left + 1, bot - top + 1) * 0.14))
  const x0 = left + margin, x1 = right - margin
  const y0 = top + margin, y1 = bot - margin
  const aw = x1 - x0 + 1, ah = y1 - y0 + 1
  if (aw < 3 || ah < 3) return // 立面太小，放窗反而成噪点
  const cols = Math.max(1, Math.min(4, Math.round(aw / (size * 0.13))))
  const rows = Math.max(1, Math.min(3, Math.round(ah / (size * 0.16))))
  const cellW = aw / cols, cellH = ah / rows
  // 窗宽收窄到原 0.56 的约 ~0.45 倍（落在「原来 1/4–1/2」区间），使窗呈竖向矩形、更像窗洞而非整面墙。
  const winW = Math.max(1, Math.round(cellW * 0.26))
  const winH = Math.max(1, Math.round(cellH * 0.62))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const cx = x0 + Math.round((j + 0.5) * cellW)
      const cy = y0 + Math.round((i + 0.5) * cellH)
      const wl = cx - Math.floor(winW / 2)
      const wt = cy - Math.floor(winH / 2)
      const wr = wl + winW - 1
      const wb = wt + winH - 1
      let ok = true
      for (let r = wt; r <= wb && ok; r++) for (let c = wl; c <= wr; c++) if (!isFac(r, c) || isDoor(r, c)) { ok = false; break }
      if (!ok) continue // 越界/压门则跳过本窗
      for (let r = wt; r <= wb; r++) for (let c = wl; c <= wr; c++) dst[r][c] = V_WINDOW
    }
  }
}

/**
 * 5c) makeDoorsAjar：把每扇门做成「半虚掩」示意——门洞靠一侧留出一道竖向门缝
 * （标 V_DOOR_OPEN，渲染为近黑的室内深处），其余为门扇。门缝与门扇分属不同类别，
 * 经描边自动勾出门缝线，读作一扇微微开启的门。纯示意，不改门的位置/数量。
 */
export function MakeDoorsAjar(mask: Grid): Grid {
  const H = mask.length
  const W = H > 0 ? mask[0].length : 0
  if (H === 0 || W === 0) return mask
  const dst: Grid = mask.map((row) => row.slice())
  const isDoor = (r: number, c: number) => r >= 0 && r < H && c >= 0 && c < dst[r].length && dst[r][c] === V_DOOR
  const seen = Array.from({ length: H }, () => new Array<boolean>(W).fill(false))
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (seen[r][c] || !isDoor(r, c)) continue
      let left = c, right = c, top = r, bot = r
      const stack: Array<[number, number]> = [[r, c]]
      seen[r][c] = true
      while (stack.length) {
        const [cr, cc] = stack.pop()!
        if (cc < left) left = cc; if (cc > right) right = cc
        if (cr < top) top = cr; if (cr > bot) bot = cr
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nr = cr + dr, nc = cc + dc
          if (nr >= 0 && nr < H && nc >= 0 && nc < W && !seen[nr][nc] && isDoor(nr, nc)) { seen[nr][nc] = true; stack.push([nr, nc]) }
        }
      }
      const width = right - left + 1
      if (width < 3) continue // 太窄，留实门，避免门缝糊成噪点
      const openW = Math.max(1, Math.round(width * 0.34))
      const openFrom = right - openW + 1 // 门缝靠右侧（合页在左）
      for (let rr = top; rr <= bot; rr++) for (let cc = openFrom; cc <= right; cc++) if (dst[rr][cc] === V_DOOR) dst[rr][cc] = V_DOOR_OPEN
    }
  }
  return dst
}

/**
 * 计算立面平涂灰度：基础为 COLOR_FACADE 纯色，仅按立面段次（0 起）整体微压暗一档，
 * 用以区分相邻立面段，不做 AO 渐变，保持「扁平纯色」的清晰建筑观感。
 */
function facadeColor(segment: number): number {
  const g = COLOR_FACADE - segment * FACADE_SEGMENT_STEP
  return Math.max(0, Math.min(255, Math.trunc(g)))
}

// 像素类别（用于描边：仅在「不同类别」相邻处画线）
const K_BG = 0
const K_ROOF = 1 // 平屋顶屋面板（单一类别）
const K_FACADE = 2
const K_WINDOW = 3
const K_DOOR = 4 // 门扇
const K_PARAPET = 9 // 平屋顶女儿墙顶帽（与屋面板不同类别 → 檐口线由描边成线）
const K_DOOR_OPEN = 10 // 半虚掩门缝
const K_PARAPET_SHADOW = 11 // 女儿墙顶帽内侧投影带（与顶帽/屋面板均不同类别 → 自动成「看线」）
// 坡屋顶四个朝向坡面各占一个类别 → 坡面交界处（屋脊/斜脊/天沟）由描边自动成线
const K_ROOF_FACE = [5, 6, 7, 8] // 对应朝向 N,S,W,E

/**
 * 从屋顶轮廓算出 45° 坡屋顶结构。屋面高度场取**到最近屋檐的 Chebyshev(L∞) 距离** `dist`
 * ——这正是「各坡面 45°、四向角平分」的攒尖/四坡屋顶高度：**宽顶条得到一条横屋脊、窄竖条
 * 得到竖屋脊，二者垂直相交即 T 形**；L 形得 L 脊、十字得十字脊、矩形得直脊（不再像 L1 那样
 * 在交接处下凹成 M）。每个屋顶格的坡面朝向 `faces`（0=N,1=S,2=W,3=E）取「最矮的相邻格方向」
 * （即顺坡下泄、指向最近屋檐的方向）；屋脊/斜脊/天沟即相邻格朝向不同处，经描边自动成线。
 * 非屋顶格 faces=-1、dist=-1。
 */
export function ComputeRoof(mask: Grid): { faces: Int8Array; dist: Int32Array } {
  const H = mask.length
  const W = H > 0 ? mask[0].length : 0
  const faces = new Int8Array(H * W).fill(-1)
  const dist = new Int32Array(H * W).fill(-1)
  if (H === 0 || W === 0) return { faces, dist }
  const isRoof = (r: number, c: number) => r >= 0 && r < H && c >= 0 && c < mask[r].length && mask[r][c] === V_ROOF
  const INF = H * W + 5
  const ht = new Int32Array(H * W)
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) ht[r * W + c] = isRoof(r, c) ? INF : 0
  // 越界视作空白(0)。Chebyshev 两遍倒角：八邻接代价均为 1 → 得到到最近屋檐的 L∞ 距离。
  const get = (r: number, c: number) => (r < 0 || r >= H || c < 0 || c >= W) ? 0 : ht[r * W + c]
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (!isRoof(r, c)) continue
    const i = r * W + c
    ht[i] = Math.min(ht[i], get(r - 1, c - 1) + 1, get(r - 1, c) + 1, get(r - 1, c + 1) + 1, get(r, c - 1) + 1)
  }
  for (let r = H - 1; r >= 0; r--) for (let c = W - 1; c >= 0; c--) {
    if (!isRoof(r, c)) continue
    const i = r * W + c
    ht[i] = Math.min(ht[i], get(r + 1, c + 1) + 1, get(r + 1, c) + 1, get(r + 1, c - 1) + 1, get(r, c + 1) + 1)
  }
  // 坡面朝向：指向「最矮的相邻格」（顺坡下泄、朝最近屋檐）；空白邻居视作高度 -1（最矮）。
  const nh = (r: number, c: number) => isRoof(r, c) ? ht[r * W + c] : -1
  const DR = [-1, 1, 0, 0], DC = [0, 0, -1, 1] // N,S,W,E
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (!isRoof(r, c)) continue
    const i = r * W + c
    dist[i] = ht[i]
    let best = 0, bestH = Infinity
    for (let k = 0; k < 4; k++) { const v = nh(r + DR[k], c + DC[k]); if (v < bestH) { bestH = v; best = k } }
    faces[i] = best as 0 | 1 | 2 | 3
  }
  return { faces, dist }
}

/**
 * 5) render：mask → size×size 灰度 RGBA Buffer。
 * 顶面按 roofType 着色：pitched=由 ComputeRoof（Chebyshev 高度场）拆出朝上/下/左/右坡面，
 * 按朝向纯色平涂，坡面交界（屋脊/斜脊/天沟）经描边自动成线、呈现真实屋顶结构；flat=纯色平屋顶。
 * 立面纯色平涂、窗/门更深；最后沿建筑外缘与各区域交界描深色细线，使结构清晰可辨。
 */
export function RenderGray(mask: Grid, size: number, roofType: RoofType = 'pitched'): Buffer {
  const H = mask.length
  const W = H > 0 ? mask[0].length : 0
  const data = Buffer.alloc(size * size * 4, 0)
  for (let i = 0; i < size * size; i++) { data[i * 4] = COLOR_BG; data[i * 4 + 1] = COLOR_BG; data[i * 4 + 2] = COLOR_BG; data[i * 4 + 3] = 255 }
  const kind = new Uint8Array(size * size) // 默认 K_BG=0
  if (H === 0 || W === 0) return data

  const roof = ComputeRoof(mask)
  const faces = roofType === 'flat' ? null : roof.faces
  // 平屋顶女儿墙：外缘做「顶帽（亮）+ 内侧投影带（暗）」两层（像素深度，随 size 自适应）。
  // 顶帽读作女儿墙的受光顶面；其内侧的投影带制造一条「看线」并以阴影体现女儿墙的厚度/立体感。
  const parapetCapPx = Math.max(2, Math.round(size * 0.012))
  const parapetShadowPx = Math.max(2, Math.round(size * 0.022))

  const scaleX = size / W
  const scaleY = size / H
  const put = (r: number, c: number, gray: number, k: number) => {
    const x1 = Math.trunc(c * scaleX), y1 = Math.trunc(r * scaleY)
    const x2 = Math.trunc((c + 1) * scaleX), y2 = Math.trunc((r + 1) * scaleY)
    for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) {
      const di = (y * size + x) * 4
      data[di] = gray; data[di + 1] = gray; data[di + 2] = gray; data[di + 3] = 255
      kind[y * size + x] = k
    }
  }
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const val = c < mask[r].length ? mask[r][c] : 0
      if (val === 0) continue
      if (val === V_ROOF) {
        if (faces) { const f = faces[r * W + c]; const face = f >= 0 ? f : 0; put(r, c, ROOF_FACE_GRAY[face], K_ROOF_FACE[face]) }
        else {
          // 平屋顶：外缘女儿墙顶帽（亮）→ 内侧投影带（暗）→ 屋面板。三类相邻 → 描边自动在
          // 顶帽下方勾出一条「看线」，投影带提供阴影，整体读作有厚度的女儿墙（立体感）。
          const d = roof.dist[r * W + c]
          let gray = COLOR_ROOF, k = K_ROOF
          if (d >= 1 && d <= parapetCapPx) { gray = COLOR_PARAPET; k = K_PARAPET }
          else if (d >= 1 && d <= parapetCapPx + parapetShadowPx) { gray = COLOR_PARAPET_SHADOW; k = K_PARAPET_SHADOW }
          put(r, c, gray, k)
        }
        continue
      }
      if (val === V_DOOR) { put(r, c, COLOR_DOOR, K_DOOR); continue }
      if (val === V_DOOR_OPEN) { put(r, c, COLOR_DOOR_OPEN, K_DOOR_OPEN); continue }
      if (val === V_WINDOW) { put(r, c, COLOR_WINDOW, K_WINDOW); continue }
      const segment = Math.max(0, val - V_FACADE)
      put(r, c, facadeColor(segment), K_FACADE)
    }
  }
  applyOutline(data, kind, size)
  return data
}

/**
 * 描边：对每个非背景像素，若其 Chebyshev 半径 t 内存在「不同类别」像素，则压成
 * 深色描边。如此沿建筑外缘、屋顶/立面交界、门窗框都会出现硬直线，强化建筑特征。
 */
function applyOutline(data: Buffer, kind: Uint8Array, size: number): void {
  const t = Math.max(1, Math.round(size / 220))
  const edge = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = kind[y * size + x]
      if (k === K_BG) continue
      let isEdge = false
      for (let dy = -t; dy <= t && !isEdge; dy++) {
        for (let dx = -t; dx <= t; dx++) {
          const ny = y + dy, nx = x + dx
          const nk = ny < 0 || ny >= size || nx < 0 || nx >= size ? K_BG : kind[ny * size + nx]
          if (nk !== k) { isEdge = true; break }
        }
      }
      if (isEdge) edge[y * size + x] = 1
    }
  }
  for (let i = 0; i < size * size; i++) if (edge[i]) { data[i * 4] = COLOR_OUTLINE; data[i * 4 + 1] = COLOR_OUTLINE; data[i * 4 + 2] = COLOR_OUTLINE }
}

/**
 * 单个房顶 mask → 灰度 RGBA（完整管线，导出供单测）。
 * 门由掩码门标记（值 2）驱动：在缩放前的掩格域开门（1 格高），随网格一并缩放，
 * 故门尺寸/位置与 size 无关、只由掩码与 height 决定。
 */
export function MaskToHouseGray(roof: Grid, doors: Array<[number, number]>, height: number, size: number, roofType: RoofType = 'pitched'): Buffer {
  let m = ExpandMask(roof, height)
  m = OffsetByHeight(m, height)
  m = DifferentiateFacades(m)
  m = PlaceDoorsFromMask(m, doors, height)
  m = ResizeMask(m, size)
  m = InsetDoors(m, Math.max(2, Math.round(size / 120)))
  m = PlaceWindows(m, size)
  m = MakeDoorsAjar(m)
  return RenderGray(m, size, roofType)
}

/** 一份输入掩码解析结果：房顶网格(0/1) + 门标记单元（原始坐标，值 2 的格）。 */
export interface MaskEntry { roof: Grid; doors: Array<[number, number]> }

/**
 * 从（按 NormalizeMask 同样的最小行宽归一化的）原始掩码中提取门标记：值为 2 的格 [r,c]。
 * 行索引与 NormalizeMask 输出对齐（输入数组每个元素算一行）。
 */
export function ExtractDoorCells(mask: unknown): Array<[number, number]> {
  if (!Array.isArray(mask) || mask.length === 0 || !Array.isArray(mask[0])) return []
  const arr = mask as unknown[]
  const widths = arr.filter((r) => Array.isArray(r)).map((r) => (r as unknown[]).length)
  if (widths.length === 0) return []
  const w = Math.min(...widths)
  if (w <= 0) return []
  const out: Array<[number, number]> = []
  for (let r = 0; r < arr.length; r++) {
    const row = arr[r]
    if (!Array.isArray(row)) continue
    for (let c = 0; c < w; c++) if (toInt((row as unknown[])[c], 0) === 2) out.push([r, c])
  }
  return out
}

/**
 * 解析输入字符串为一组掩码条目（房顶 + 门标记）。约定输入是单个二维数组 `[[...],[...]]`，
 * 也兼容三维 `[[[...]],[[...]]]`（多栋）以便批量产出。值 1=房顶，0=空，2=该列开门标记。
 */
export function ParseMaskEntries(spec: unknown): MaskEntry[] {
  let raw: unknown = spec
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return []
    try { raw = JSON.parse(text) } catch { return [] }
  }
  if (!Array.isArray(raw)) return []
  const is3d = raw.length > 0 && Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0])
  const rawMasks = is3d ? (raw as unknown[]) : [raw]
  const out: MaskEntry[] = []
  for (const m of rawMasks) {
    const roof = NormalizeMask(m)
    if (roof) out.push({ roof, doors: ExtractDoorCells(m) })
  }
  return out
}

/** 仅取房顶网格（向后兼容；house_footprint 复用此函数，门标记格按非 0 仍计入底面）。 */
export function ParseMasks(spec: unknown): Grid[] {
  return ParseMaskEntries(spec).map((e) => e.roof)
}

/**
 * 电池入口：唯一小写开头导出函数（被加载器选作 entry）。
 */
export async function houseTemplate(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const size = typeof input.imageSize === 'number' && input.imageSize > 0 ? Math.trunc(input.imageSize) : 300
  const height = typeof input.height === 'number' && input.height >= 0 ? Math.trunc(input.height) : 1
  const roofType: RoofType = input.roofType === 'flat' ? 'flat' : 'pitched'

  const entries = ParseMaskEntries(input.spec)
  if (entries.length === 0) {
    return { image: [], error: 'invalid spec: expected a roof-mask 2D array string like [[1,1,0],[1,1,1]] (use 2 to open a door in that column)' }
  }

  const images: string[] = []
  const errors: string[] = []

  for (let i = 0; i < entries.length; i++) {
    const rgba = MaskToHouseGray(entries[i].roof, entries[i].doors, height, size, roofType)
    const res = createImage(ctx, rgba, size, size, { name: `house_${String(i + 1).padStart(3, '0')}`, nodeId: 'house_template', folder: 'grayscale' })
    if (res.error && !res.image) errors.push(`entry ${i + 1}: ${res.error}`)
    else {
      images.push(res.image)
      if (res.error) errors.push(`entry ${i + 1} (archive): ${res.error}`)
    }
  }

  return { image: images, error: errors.join('; ') }
}

export type { DecodedImage }
