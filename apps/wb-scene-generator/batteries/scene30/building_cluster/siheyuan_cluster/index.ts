/**
 * siheyuanCluster — 四合院组群：生成传统四合院院落布局。
 *
 * 基本组合（参考标准三进院落）：
 *   - 外围一圈围墙，贴齐区域外边界（region 非零包围盒）。
 *   - 沿进深方向叠 N 个院落（进数 courtyards）：
 *       · N+1 条横向房屋带（正房 / 厅堂… / 倒座房），贯穿院落宽度；
 *       · 每个院落左右各一座纵向厢房（西厢房 / 东厢房）；
 *       · 每个院落中心留空，四周一圈围廊（游廊）把四面房屋串起来。
 *   - 可选在底墙开一个院门（gateWidth）。
 *
 * 房屋数量 = 3 × 进数 + 1（N=1 即标准四合院 4 座房屋）。
 *
 * 输入：
 *   region      (grid)   — 区域网格，围墙贴齐其非零包围盒外边界
 *   courtyards  (number) — 进数（院落数），默认 1，房屋数=3N+1
 *   wallThk     (number) — 围墙厚度，默认 1
 *   hallDepth   (number) — 横向房屋进深（行数），默认 4
 *   wingWidth   (number) — 纵向厢房宽度（列数），默认 4
 *   corridorThk (number) — 围廊宽度，0=不生成围廊，默认 1
 *   gateWidth   (number) — 院门开口宽度，0=封闭，默认 2
 *
 * 输出：
 *   outputGrid     (grid)        — 合并多值网格（房屋各递增 id、围廊、围墙各一值）
 *   houses         (grid, list)  — 每座房屋一张 0/1 网格
 *   wall           (grid)        — 围墙 0/1 网格
 *   corridor       (grid)        — 围廊 0/1 网格
 *   outputNameList (array)       — 名称清单 [{id,name,type}]
 *
 * 坐标约定：x→列、y→行；grid[r][c]。
 */

type Grid = number[][]

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

function zeros(rows: number, cols: number): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(0))
}

export function siheyuanCluster(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined
  if (!region || region.length === 0 || !Array.isArray(region[0]) || region[0].length === 0) {
    return { error: 'region is required and must be a non-empty grid' }
  }
  const R = region.length
  const C = region[0].length

  // 围墙贴齐 region 非零包围盒外边界；全空则用整张网格。
  let r0 = Infinity
  let r1 = -1
  let c0 = Infinity
  let c1 = -1
  for (let r = 0; r < R; r++) {
    const row = region[r]
    if (!Array.isArray(row)) continue
    for (let c = 0; c < row.length; c++) {
      if (Number.isFinite(row[c]) && row[c] !== 0) {
        if (r < r0) r0 = r
        if (r > r1) r1 = r
        if (c < c0) c0 = c
        if (c > c1) c1 = c
      }
    }
  }
  if (r1 < 0) {
    r0 = 0
    r1 = R - 1
    c0 = 0
    c1 = C - 1
  }

  const N = Math.max(1, Math.round(num(input.courtyards, 1)))
  const wallThk = Math.max(1, Math.round(num(input.wallThk, 1)))
  let hallDepth = Math.max(1, Math.round(num(input.hallDepth, 4)))
  let wingWidth = Math.max(1, Math.round(num(input.wingWidth, 4)))
  const corridorThk = Math.max(0, Math.round(num(input.corridorThk, 1)))
  const gateWidth = Math.max(0, Math.round(num(input.gateWidth, 2)))

  // 内部可用区域（围墙以内）。
  const ir0 = r0 + wallThk
  const ir1 = r1 - wallThk
  const ic0 = c0 + wallThk
  const ic1 = c1 - wallThk
  const innerH = ir1 - ir0 + 1
  const innerW = ic1 - ic0 + 1
  if (innerH < 3 || innerW < 3) {
    return { error: 'region too small for a siheyuan layout (inner area < 3x3)' }
  }

  // 横向房屋带需放得下：(N+1)*hallDepth + N 个至少 1 行的院落 <= innerH。
  const maxHall = Math.floor((innerH - N) / (N + 1))
  if (maxHall < 1) {
    return { error: `region too small for ${N} courtyards` }
  }
  if (hallDepth > maxHall) hallDepth = maxHall

  // 厢房宽度不能吃满整宽，至少留 1 列开敞中庭。
  wingWidth = Math.min(wingWidth, Math.floor((innerW - 1) / 2))
  if (wingWidth < 1) wingWidth = 1

  // 横向带顶行：线性分布，band0 顶贴 ir0，bandN 底贴 ir1（围墙内）。
  const span = ir1 - hallDepth + 1 - ir0
  const bands: Array<[number, number]> = []
  for (let i = 0; i <= N; i++) {
    const top = Math.round(ir0 + (span * i) / N)
    bands.push([top, top + hallDepth - 1])
  }

  const outputGrid = zeros(R, C)
  const wallGrid = zeros(R, C)
  const corridorGrid = zeros(R, C)
  const houses: Grid[] = []
  const names: Array<{ id: number; name: string; type: string }> = []
  let id = 0

  const clampR = (r: number) => Math.max(0, Math.min(R - 1, r))
  const clampC = (c: number) => Math.max(0, Math.min(C - 1, c))

  function addHouse(rr0: number, rr1: number, cc0: number, cc1: number, name: string): void {
    if (rr1 < rr0 || cc1 < cc0) return
    id += 1
    const mask = zeros(R, C)
    for (let r = clampR(rr0); r <= clampR(rr1); r++) {
      for (let c = clampC(cc0); c <= clampC(cc1); c++) {
        mask[r][c] = 1
        outputGrid[r][c] = id
      }
    }
    houses.push(mask)
    names.push({ id, name, type: 'tile' })
  }

  // 横向房屋带（贯穿院落宽度）。
  for (let i = 0; i <= N; i++) {
    const name = i === 0 ? '正房' : i === N ? '倒座房' : `厅堂${i}`
    addHouse(bands[i][0], bands[i][1], ic0, ic1, name)
  }

  // 每个院落：左右厢房 + 围廊环。
  const ccL = ic0 + wingWidth // 中庭左界（左厢房右侧）
  const ccR = ic1 - wingWidth // 中庭右界（右厢房左侧）
  for (let i = 0; i < N; i++) {
    const cr0 = bands[i][1] + 1
    const cr1 = bands[i + 1][0] - 1
    if (cr1 < cr0) continue

    addHouse(cr0, cr1, ic0, ic0 + wingWidth - 1, `西厢房${i + 1}`)
    addHouse(cr0, cr1, ic1 - wingWidth + 1, ic1, `东厢房${i + 1}`)

    // 围廊：环绕开敞中庭一圈，连接四面房屋。
    if (corridorThk > 0 && ccR >= ccL) {
      const t = corridorThk
      const stamp = (rr0: number, rr1: number, cc0: number, cc1: number) => {
        for (let r = clampR(rr0); r <= clampR(rr1); r++) {
          for (let c = clampC(cc0); c <= clampC(cc1); c++) {
            corridorGrid[r][c] = 1
          }
        }
      }
      stamp(cr0, cr0 + t - 1, ccL, ccR) // 上：正房/厅堂前
      stamp(cr1 - t + 1, cr1, ccL, ccR) // 下：下方房屋前
      stamp(cr0, cr1, ccL, ccL + t - 1) // 左：西厢房前
      stamp(cr0, cr1, ccR - t + 1, ccR) // 右：东厢房前
    }
  }

  const corridorVal = id + 1
  const wallVal = id + 2

  // 围廊落入合并网格（不覆盖房屋）。
  let hasCorridor = false
  for (let r = 0; r < R; r++) {
    for (let c = 0; c < C; c++) {
      if (corridorGrid[r][c] === 1) {
        hasCorridor = true
        if (outputGrid[r][c] === 0) outputGrid[r][c] = corridorVal
      }
    }
  }
  if (hasCorridor) names.push({ id: corridorVal, name: '围廊', type: 'corridor' })

  // 围墙：贴齐外边界的一圈，可选在底墙开院门。
  const gateC1 = ic1
  const gateC0 = Math.max(ic0, gateC1 - gateWidth + 1)
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const onBorder = r < r0 + wallThk || r > r1 - wallThk || c < c0 + wallThk || c > c1 - wallThk
      if (!onBorder) continue
      // 院门：底墙处的一段开口。
      const inBottomWall = r > r1 - wallThk
      if (gateWidth > 0 && inBottomWall && c >= gateC0 && c <= gateC1) continue
      wallGrid[r][c] = 1
      if (outputGrid[r][c] === 0) outputGrid[r][c] = wallVal
    }
  }
  names.push({ id: wallVal, name: '围墙', type: 'wall' })

  return {
    outputGrid,
    houses,
    wall: wallGrid,
    corridor: corridorGrid,
    outputNameList: names,
  }
}
