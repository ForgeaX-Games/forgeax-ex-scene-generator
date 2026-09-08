/**
 * furniture_template — 室内家具模板：按「家具类型 + 朝向」程序化绘制可识别的家具
 * 立面剪影，渲染成灰度图（与 house_template 同角色：作为形状底图喂给 image_gen，
 * 配合「严格遵守灰度图形状」的提示词约束生图）。
 *
 * 支持四种家具：桌子 table / 椅子 chair / 衣柜 wardrobe / 床 bed。
 * 朝向 orientation（下=正面 / 上=背面 / 左 / 右）——并非每种家具都区分所有朝向：
 *   - 椅子：四向皆有意义（正面见座+靠背、背面见靠背、左右为侧影）。
 *   - 床：左右为侧影（床头+床垫+枕头），下=床尾、上=床头。
 *   - 衣柜：下=正面（双门+把手），上/侧=素柜面。
 *   - 桌子：基本无朝向（各向同形）。
 *
 * 采用扁平灰度 + 外轮廓描边：先把各部件以不同「类别」填进画布，再沿外缘与部件
 * 交界画深色细线，使家具轮廓/部件接缝清晰可辨，便于大模型识别。
 *
 * 视角为 2.5D 斜投影（cavalier oblique，深度朝右上方后退）：每个部件先作为
 * 正面矩形登记，渲染时在其后上方补画一块退缩的「顶面」与「侧面」平行四边形，
 * 使家具能看到一部分顶面（而非纯水平立面）。绘制顺序：先所有背面（顶/侧），
 * 再所有正面，最后描边——既露出顶面，又保留原本可辨的正面剪影。
 *
 * 纯绘制函数以 Uppercase 命名导出供单测；电池入口为唯一小写开头导出函数
 * `furnitureTemplate`（加载器取首个小写字母开头导出函数作为 entry）。
 */

import { createImage, type DecodedImage } from '../../../_shared/asset2d.js'

export type FurnitureKind = 'table' | 'chair' | 'wardrobe' | 'bed'
export type Orientation = 'down' | 'up' | 'left' | 'right'

// 灰度配色（扁平：主体/腿/软垫/门板，三四档明度 + 深色描边）
const G_BODY = 150 // 主体（桌面、座面、柜体、床垫托）
const G_LEG = 118 // 腿/支撑（更深）
const G_SOFT = 190 // 软垫/床垫/枕头（更浅）
const G_PANEL = 138 // 柜门/靠背/床头（中间调）
const G_OUTLINE = 64 // 描边
const G_BG = 255 // 白底
// 部件色调别名（语义化复用上面几档明度）
const G_SEAT_TONE = G_BODY
const G_BACK_TONE = G_PANEL
const G_HEAD_TONE = G_PANEL
const G_DOOR_L_TONE = G_PANEL
const G_DOOR_R_TONE = G_BODY

// 像素类别（仅用于描边：不同类别相邻处画线）
const K_BG = 0
// 2.5D 斜投影专用类别：所有顶面共用一档、所有侧面共用一档（与正面部件类别恒不同，
// 从而在「顶/侧 ↔ 正面」交界自动描出 2.5D 的转折棱线）。
const K_TOPFACE = 100
const K_SIDEFACE = 101

// 斜投影深度（归一化坐标）：顶面向右上方后退。dy<0 = 向上。
const DEPTH_X = 0.05
const DEPTH_Y = -0.06

/** 一个正面矩形部件（x 右、y 下，归一化坐标），先登记后统一渲染。 */
type Part = { x: number; y: number; w: number; h: number; gray: number; k: number }

type Canvas = { size: number; data: Buffer; kind: Uint8Array; flip: boolean; parts: Part[] }

function makeCanvas(size: number, flip: boolean): Canvas {
  const data = Buffer.alloc(size * size * 4, 0)
  for (let i = 0; i < size * size; i++) { data[i * 4] = G_BG; data[i * 4 + 1] = G_BG; data[i * 4 + 2] = G_BG; data[i * 4 + 3] = 255 }
  return { size, data, kind: new Uint8Array(size * size), flip, parts: [] }
}

/** 顶/侧面相对正面的明度偏移：顶面更亮（受光）、侧面更暗（背光）。 */
const lighten = (g: number): number => Math.min(245, g + 30)
const darken = (g: number): number => Math.max(40, g - 28)

/** 单个像素着色（带 flip 水平镜像）。px/py 为整数像素坐标（未 flip）。 */
function putPixel(cv: Canvas, px: number, py: number, gray: number, k: number): void {
  const { size, flip } = cv
  const fx = flip ? size - 1 - px : px
  if (fx < 0 || fx >= size || py < 0 || py >= size) return
  const i = py * size + fx
  cv.data[i * 4] = gray; cv.data[i * 4 + 1] = gray; cv.data[i * 4 + 2] = gray; cv.data[i * 4 + 3] = 255
  cv.kind[i] = k
}

/** 在归一化坐标 [0,1]（x 右、y 下）立即填一个矩形，gray 着色、k 作为描边类别。flip 时水平镜像。 */
function fillRect(cv: Canvas, x: number, y: number, w: number, h: number, gray: number, k: number): void {
  const { size } = cv
  const px0 = Math.max(0, Math.round(x * size))
  const px1 = Math.min(size, Math.round((x + w) * size))
  const py0 = Math.max(0, Math.round(y * size))
  const py1 = Math.min(size, Math.round((y + h) * size))
  for (let py = py0; py < py1; py++) {
    for (let px = px0; px < px1; px++) putPixel(cv, px, py, gray, k)
  }
}

/** 凸四边形填充（归一化坐标顶点，顺/逆时针均可）；用于 2.5D 顶面/侧面平行四边形。 */
function fillQuad(cv: Canvas, pts: Array<[number, number]>, gray: number, k: number): void {
  const { size } = cv
  const xs = pts.map((p) => p[0] * size)
  const ys = pts.map((p) => p[1] * size)
  const minX = Math.max(0, Math.floor(Math.min(...xs)))
  const maxX = Math.min(size - 1, Math.ceil(Math.max(...xs)))
  const minY = Math.max(0, Math.floor(Math.min(...ys)))
  const maxY = Math.min(size - 1, Math.ceil(Math.max(...ys)))
  const n = pts.length
  for (let py = minY; py <= maxY; py++) {
    const cy = py + 0.5
    for (let px = minX; px <= maxX; px++) {
      const cx = px + 0.5
      let pos = false, neg = false
      for (let e = 0; e < n; e++) {
        const ax = xs[e], ay = ys[e]
        const bx = xs[(e + 1) % n], by = ys[(e + 1) % n]
        const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        if (cross > 1e-6) pos = true
        else if (cross < -1e-6) neg = true
      }
      if (!(pos && neg)) putPixel(cv, px, py, gray, k)
    }
  }
}

/**
 * 登记一个正面矩形部件（绘制函数统一调用此函数，沿用原 `rect` 语义），
 * 统一渲染时再补其 2.5D 顶/侧面。
 */
function rect(cv: Canvas, x: number, y: number, w: number, h: number, gray: number, k: number): void {
  cv.parts.push({ x, y, w, h, gray, k })
}

/** 渲染所有部件：先画全部背面（顶/侧），再画全部正面，使正面剪影压在最上、顶面从其后上方露出。 */
function renderParts(cv: Canvas): void {
  const dx = DEPTH_X, dy = DEPTH_Y
  for (const p of cv.parts) {
    const { x, y, w, h, gray } = p
    // 顶面：正面上边沿向右上后退的平行四边形
    fillQuad(cv, [[x, y], [x + w, y], [x + w + dx, y + dy], [x + dx, y + dy]], lighten(gray), K_TOPFACE)
    // 侧面：正面右边沿向右上后退的平行四边形
    fillQuad(cv, [[x + w, y], [x + w + dx, y + dy], [x + w + dx, y + h + dy], [x + w, y + h]], darken(gray), K_SIDEFACE)
  }
  for (const p of cv.parts) fillRect(cv, p.x, p.y, p.w, p.h, p.gray, p.k)
}

/** 描边：对每个非背景像素，若 Chebyshev 半径 t 内存在不同类别像素，则压成深色细线。 */
function applyOutline(cv: Canvas): void {
  const { size, kind, data } = cv
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
  for (let i = 0; i < size * size; i++) if (edge[i]) { data[i * 4] = G_OUTLINE; data[i * 4 + 1] = G_OUTLINE; data[i * 4 + 2] = G_OUTLINE }
}

type Rng = () => number

// 部件类别 id（不同 id → 接缝处自动描边）
const K_TOP = 1, K_LEG = 2, K_SEAT = 3, K_BACK = 4, K_SOFT = 5, K_DOORL = 6, K_DOORR = 7, K_HEAD = 8, K_BASE = 9

/** 桌子：桌面横板 + 若干腿。各朝向同形（桌子基本无朝向）。 */
function drawTable(cv: Canvas, rng: Rng): void {
  const topY = 0.34, topH = 0.08, topX = 0.14, topW = 0.72
  rect(cv, topX, topY, topW, topH, G_BODY, K_TOP)
  const legH = 0.86 - (topY + topH)
  const legW = 0.07
  const legTop = topY + topH
  const inset = 0.04
  rect(cv, topX + inset, legTop, legW, legH, G_LEG, K_LEG)
  rect(cv, topX + topW - inset - legW, legTop, legW, legH, G_LEG, K_LEG)
  // 偶尔多画一对内侧腿，增加桌子辨识度
  if (rng() < 0.5) {
    rect(cv, 0.5 - 0.16 - legW / 2, legTop, legW, legH, G_LEG, K_LEG)
    rect(cv, 0.5 + 0.16 - legW / 2, legTop, legW, legH, G_LEG, K_LEG)
  }
}

/** 椅子：分朝向。左右=侧影（靠背+座面+前后腿）；下=正面；上=背面。 */
function drawChair(cv: Canvas, orient: Orientation, _rng: Rng): void {
  if (orient === 'left' || orient === 'right') {
    // 侧影：靠背在左、座面向右伸出、前后两腿
    const backX = 0.26, backTop = 0.18, backW = 0.08, backBot = 0.58
    rect(cv, backX, backTop, backW, backBot - backTop, G_BACK_TONE, K_BACK)
    const seatY = 0.5, seatH = 0.08, seatX = backX, seatW = 0.46
    rect(cv, seatX, seatY, seatW, seatH, G_SEAT_TONE, K_SEAT)
    const legTop = seatY + seatH, legH = 0.84 - legTop, legW = 0.07
    rect(cv, backX, legTop, legW, legH, G_LEG, K_LEG) // 后腿（与靠背同列）
    rect(cv, seatX + seatW - legW, legTop, legW, legH, G_LEG, K_LEG) // 前腿
    return
  }
  // 正面 / 背面：座面 + 靠背面板 + 两前腿
  const seatY = 0.52, seatH = 0.09, seatX = 0.28, seatW = 0.44
  const backTop = orient === 'up' ? 0.16 : 0.2
  const backBot = orient === 'up' ? seatY + seatH : seatY // 背面时靠背盖住座面
  rect(cv, seatX + 0.02, backTop, seatW - 0.04, backBot - backTop, G_PANEL, K_BACK)
  if (orient === 'down') rect(cv, seatX, seatY, seatW, seatH, G_SEAT_TONE, K_SEAT)
  const legTop = seatY + seatH, legH = 0.84 - legTop, legW = 0.07
  rect(cv, seatX + 0.03, legTop, legW, legH, G_LEG, K_LEG)
  rect(cv, seatX + seatW - 0.03 - legW, legTop, legW, legH, G_LEG, K_LEG)
}

/** 衣柜：高柜体；下=正面（双门+把手+底座）；上=背面素面；左右=较窄侧面。 */
function drawWardrobe(cv: Canvas, orient: Orientation, _rng: Rng): void {
  const top = 0.12, bot = 0.84
  if (orient === 'left' || orient === 'right') {
    const x = 0.36, w = 0.28 // 侧面更窄（进深）
    rect(cv, x, top, w, bot - top, G_BODY, K_TOP)
    rect(cv, x, bot, w, 0.04, G_LEG, K_BASE)
    return
  }
  const x = 0.28, w = 0.44
  if (orient === 'up') {
    rect(cv, x, top, w, bot - top, G_BODY, K_TOP) // 背面素柜
    rect(cv, x, bot, w, 0.04, G_LEG, K_BASE)
    return
  }
  // 正面：双门（中缝由两类别接缝描出）+ 把手 + 底座
  const half = w / 2
  rect(cv, x, top, half, bot - top, G_DOOR_L_TONE, K_DOORL)
  rect(cv, x + half, top, half, bot - top, G_DOOR_R_TONE, K_DOORR)
  // 把手：贴中缝两侧的小竖条（用腿色压深 → 描边勾出）
  const hh = 0.12, hy = (top + bot) / 2 - hh / 2, hw = 0.022
  rect(cv, x + half - hw - 0.012, hy, hw, hh, G_LEG, K_LEG)
  rect(cv, x + half + 0.012, hy, hw, hh, G_LEG, K_LEG)
  rect(cv, x, bot, w, 0.04, G_LEG, K_BASE)
}

/** 床：左右=侧影（床头板+床垫+枕头+腿）；下=床尾；上=床头。 */
function drawBed(cv: Canvas, orient: Orientation, _rng: Rng): void {
  if (orient === 'left' || orient === 'right') {
    const headX = 0.14, headTop = 0.28, headW = 0.1, headBot = 0.66
    rect(cv, headX, headTop, headW, headBot - headTop, G_HEAD_TONE, K_HEAD) // 床头板（左）
    const mY = 0.5, mH = 0.1, mX = headX + headW, mW = 0.66
    rect(cv, mX, mY, mW, mH, G_BODY, K_TOP) // 床垫托/床框
    rect(cv, mX, mY - 0.05, mW, 0.05, G_SOFT, K_SOFT) // 床垫面（浅）
    rect(cv, mX + 0.02, mY - 0.085, 0.16, 0.04, G_SOFT, K_SOFT) // 枕头
    const legTop = mY + mH, legH = 0.78 - legTop, legW = 0.06
    rect(cv, mX, legTop, legW, legH, G_LEG, K_LEG)
    rect(cv, mX + mW - legW, legTop, legW, legH, G_LEG, K_LEG)
    return
  }
  if (orient === 'up') {
    // 床头视角：宽床头板 + 其前一条床垫
    const x = 0.16, w = 0.68
    rect(cv, x, 0.22, w, 0.14, G_HEAD_TONE, K_HEAD)
    rect(cv, x + 0.04, 0.36, w - 0.08, 0.34, G_SOFT, K_SOFT)
    rect(cv, x, 0.7, w, 0.05, G_BODY, K_TOP)
    return
  }
  // 床尾视角（down）：宽矮床框 + 后方床垫 + 露出的床头顶
  const x = 0.16, w = 0.68
  rect(cv, x + 0.06, 0.3, w - 0.12, 0.06, G_HEAD_TONE, K_HEAD) // 远端床头露头
  rect(cv, x + 0.04, 0.36, w - 0.08, 0.3, G_SOFT, K_SOFT) // 床垫
  rect(cv, x, 0.62, w, 0.12, G_BODY, K_TOP) // 床尾框（近）
  const legTop = 0.74, legH = 0.84 - legTop, legW = 0.07
  rect(cv, x, legTop, legW, legH, G_LEG, K_LEG)
  rect(cv, x + w - legW, legTop, legW, legH, G_LEG, K_LEG)
}

/** 单件家具 → 灰度 RGBA（完整绘制管线，导出供单测）。 */
export function DrawFurnitureGray(kind: FurnitureKind, orient: Orientation, size: number, rng: Rng): Buffer {
  const flip = orient === 'right'
  const cv = makeCanvas(size, flip)
  switch (kind) {
    case 'table': drawTable(cv, rng); break
    case 'chair': drawChair(cv, orient, rng); break
    case 'wardrobe': drawWardrobe(cv, orient, rng); break
    case 'bed': drawBed(cv, orient, rng); break
  }
  renderParts(cv)
  applyOutline(cv)
  return cv.data
}

function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KINDS: FurnitureKind[] = ['table', 'chair', 'wardrobe', 'bed']
const ORIENTS: Orientation[] = ['down', 'up', 'left', 'right']

function normKind(v: unknown): FurnitureKind {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return (KINDS as string[]).includes(s) ? (s as FurnitureKind) : 'chair'
}
function normOrient(v: unknown): Orientation {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return (ORIENTS as string[]).includes(s) ? (s as Orientation) : 'down'
}

/** 电池入口：唯一小写开头导出函数（被加载器选作 entry）。 */
export async function furnitureTemplate(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const size = typeof input.imageSize === 'number' && input.imageSize > 0 ? Math.trunc(input.imageSize) : 300
  const kind = normKind(input.kind)
  const orient = normOrient(input.orientation)
  const seed = typeof input.seed === 'number' ? Math.trunc(input.seed) : 0
  const rng: Rng = seed > 0 ? mulberry32(seed) : Math.random

  const rgba = DrawFurnitureGray(kind, orient, size, rng)
  const res = createImage(ctx, rgba, size, size, { name: `${kind}_${orient}`, nodeId: 'furniture_template', folder: 'grayscale' })
  if (res.error && !res.image) return { image: [], error: res.error }
  return { image: [res.image], error: res.error ?? '' }
}

export type { DecodedImage }
