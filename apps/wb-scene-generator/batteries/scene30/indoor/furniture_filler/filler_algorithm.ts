import {
  Grid, FurnitureTemplate, PlacedFurniture,
  TemplateLibrary, FurnitureListItem,
} from "./types";

// ---------------------------------------------------------------------------
// 模板库构建（与 furniture_placer 相同）
// ---------------------------------------------------------------------------

export function buildSingleLibrary(libraryData: unknown): TemplateLibrary {
  const data = libraryData as { furniture_categories?: Array<{ items?: unknown[] }> };
  const lib: TemplateLibrary = {};
  for (const cat of data.furniture_categories ?? []) {
    for (const raw of cat.items ?? []) {
      const item = raw as Record<string, unknown>;
      const mask = item["mask"] as Grid;
      const tpl: FurnitureTemplate = {
        id: item["id"] as string,
        size: item["size"] as string,
        shape: item["shape"] as string,
        placementEdges: item["placement_edges"] as number[],
        mask,
        rows: mask.length,
        cols: mask[0]?.length ?? 0,
        isGroup: false,
        components: {},
      };
      const key = `${tpl.size}_${tpl.shape}`;
      (lib[key] ??= []).push(tpl);
    }
  }
  return lib;
}

function extractGroupBaseName(id: string): string {
  return id.replace(/_(edge\d+|center_\w+)$/, "");
}

export function buildGroupLibrary(libraryData: unknown): TemplateLibrary {
  const data = libraryData as { furniture_categories?: Array<{ items?: unknown[] }> };
  const lib: TemplateLibrary = {};
  for (const cat of data.furniture_categories ?? []) {
    for (const raw of cat.items ?? []) {
      const item = raw as Record<string, unknown>;
      const mask = item["mask"] as Grid;
      const tpl: FurnitureTemplate = {
        id: item["id"] as string,
        size: (item["size"] as string) ?? "small",
        shape: (item["shape"] as string) ?? "square",
        placementEdges: (item["placement_edges"] as number[]) ?? [],
        mask,
        rows: mask.length,
        cols: mask[0]?.length ?? 0,
        isGroup: true,
        components: (item["components"] as Record<string, string>) ?? {},
      };
      const key = extractGroupBaseName(tpl.id);
      (lib[key] ??= []).push(tpl);
    }
  }
  return lib;
}

// ---------------------------------------------------------------------------
// 房间边界预计算
// ---------------------------------------------------------------------------

export function computeEdgeCells(
  layout: Grid, rows: number, cols: number
): Record<number, Array<[number, number]>> {
  const top: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  const bottom: Array<[number, number]> = [];
  const left: Array<[number, number]> = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (layout[r][c] === 0) continue;
      if (r === 0 || layout[r - 1][c] === 0) top.push([r, c]);
      if (r === rows - 1 || layout[r + 1][c] === 0) bottom.push([r, c]);
      if (c === 0 || layout[r][c - 1] === 0) left.push([r, c]);
      if (c === cols - 1 || layout[r][c + 1] === 0) right.push([r, c]);
    }
  }
  return { 0: top, 1: right, 2: bottom, 3: left };
}

// ---------------------------------------------------------------------------
// 家具掩码辅助
// ---------------------------------------------------------------------------

function bodyCells(tpl: FurnitureTemplate): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < tpl.rows; r++) {
    for (let c = 0; c < tpl.cols; c++) {
      const v = tpl.mask[r][c];
      if (tpl.isGroup ? v !== 0 : v === 1) cells.push([r, c]);
    }
  }
  return cells;
}

function aisleCells(tpl: FurnitureTemplate): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < tpl.rows; r++) {
    for (let c = 0; c < tpl.cols; c++) {
      if (tpl.mask[r][c] === 0) cells.push([r, c]);
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// 合法性判断
// ---------------------------------------------------------------------------

function isRoomCell(layout: Grid, rows: number, cols: number, r: number, c: number): boolean {
  return r >= 0 && r < rows && c >= 0 && c < cols && layout[r][c] !== 0;
}

function isValidPlacement(
  layout: Grid, maskA: Grid, maskB: Grid,
  rows: number, cols: number,
  tpl: FurnitureTemplate, ar: number, ac: number,
  doorZone?: Set<string>
): boolean {
  for (const [dr, dc] of bodyCells(tpl)) {
    const r = ar + dr, c = ac + dc;
    if (!isRoomCell(layout, rows, cols, r, c)) return false;
    if (maskA[r][c] !== 0 || maskB[r][c] !== 0) return false;
    if (doorZone?.has(`${r},${c}`)) return false;
  }
  for (const [dr, dc] of aisleCells(tpl)) {
    const r = ar + dr, c = ac + dc;
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    if (isRoomCell(layout, rows, cols, r, c) && maskA[r][c] !== 0) return false;
  }
  return true;
}

function isEdgeAligned(
  tpl: FurnitureTemplate, ar: number, ac: number,
  edge: number, edgeCells: Record<number, Array<[number, number]>>
): boolean {
  const body = bodyCells(tpl);
  if (body.length === 0) return false;
  const edgeSet = new Set(edgeCells[edge].map(([r, c]) => `${r},${c}`));

  if (edge === 0) {
    const minR = Math.min(...body.map(([dr]) => ar + dr));
    return body.some(([dr, dc]) => ar + dr === minR && edgeSet.has(`${minR},${ac + dc}`));
  } else if (edge === 2) {
    const maxR = Math.max(...body.map(([dr]) => ar + dr));
    return body.some(([dr, dc]) => ar + dr === maxR && edgeSet.has(`${maxR},${ac + dc}`));
  } else if (edge === 1) {
    const maxC = Math.max(...body.map(([, dc]) => ac + dc));
    return body.some(([dr, dc]) => ac + dc === maxC && edgeSet.has(`${ar + dr},${maxC}`));
  } else {
    const minC = Math.min(...body.map(([, dc]) => ac + dc));
    return body.some(([dr, dc]) => ac + dc === minC && edgeSet.has(`${ar + dr},${minC}`));
  }
}

// ---------------------------------------------------------------------------
// 伪随机工具（mulberry32，seed 可复现）
// ---------------------------------------------------------------------------

function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleArray<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// 候选位置生成
// ---------------------------------------------------------------------------

const MAX_CANDIDATES = 30;

function dedupPairs(pairs: Array<[number, number]>): Array<[number, number]> {
  const seen = new Set<string>();
  return pairs.filter(([r, c]) => {
    const k = `${r},${c}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 候选超过 MAX_CANDIDATES 时用 PRNG 随机采样，保证计算量上限 */
function sampleCandidates(
  candidates: Array<[number, number]>,
  rand: () => number
): Array<[number, number]> {
  if (candidates.length <= MAX_CANDIDATES) return candidates;
  const result: Array<[number, number]> = [];
  const pool = [...candidates];
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const j = Math.floor(rand() * pool.length);
    result.push(pool[j]);
    pool.splice(j, 1);
  }
  return result;
}

function generateEdgeCandidates(
  layout: Grid, maskA: Grid, maskB: Grid,
  rows: number, cols: number,
  tpl: FurnitureTemplate, edge: number,
  edgeCells: Record<number, Array<[number, number]>>,
  rand: () => number,
  doorZone?: Set<string>
): Array<[number, number]> {
  const valid: Array<[number, number]> = [];
  const body = bodyCells(tpl);

  // 性能优化：从每个边缘格直接反推合法 anchor，避免 O(边缘格数 × 全宽/全高) 的暴力扫描
  // 对于贴边 anchor (ar, ac)，必须满足 isEdgeAligned：
  //   body 中某个处于对齐边的格子 (ar+dr, ac+dc) 属于对应方向的 edgeCells
  // 因此：对每个 edgeCell (er, ec)，枚举对齐行/列上的 body 列/行偏移 dc/dr
  //   anchor = (er - dr_edge, ec - dc_edge)，其中 dr_edge/dc_edge 来自对齐行/列的 body 格

  if (edge === 0) {
    const minDr = Math.min(...body.map(([dr]) => dr));
    const bodyDcsAtMinDr = body.filter(([dr]) => dr === minDr).map(([, dc]) => dc);
    for (const [er, ec] of edgeCells[0]) {
      const anchorR = er - minDr;
      for (const dc of bodyDcsAtMinDr) {
        const anchorC = ec - dc;
        if (
          isValidPlacement(layout, maskA, maskB, rows, cols, tpl, anchorR, anchorC, doorZone) &&
          isEdgeAligned(tpl, anchorR, anchorC, 0, edgeCells)
        ) valid.push([anchorR, anchorC]);
      }
    }
  } else if (edge === 2) {
    const maxDr = Math.max(...body.map(([dr]) => dr));
    const bodyDcsAtMaxDr = body.filter(([dr]) => dr === maxDr).map(([, dc]) => dc);
    for (const [er, ec] of edgeCells[2]) {
      const anchorR = er - maxDr;
      for (const dc of bodyDcsAtMaxDr) {
        const anchorC = ec - dc;
        if (
          isValidPlacement(layout, maskA, maskB, rows, cols, tpl, anchorR, anchorC, doorZone) &&
          isEdgeAligned(tpl, anchorR, anchorC, 2, edgeCells)
        ) valid.push([anchorR, anchorC]);
      }
    }
  } else if (edge === 1) {
    const maxDc = Math.max(...body.map(([, dc]) => dc));
    const bodyDrsAtMaxDc = body.filter(([, dc]) => dc === maxDc).map(([dr]) => dr);
    for (const [er, ec] of edgeCells[1]) {
      const anchorC = ec - maxDc;
      for (const dr of bodyDrsAtMaxDc) {
        const anchorR = er - dr;
        if (
          isValidPlacement(layout, maskA, maskB, rows, cols, tpl, anchorR, anchorC, doorZone) &&
          isEdgeAligned(tpl, anchorR, anchorC, 1, edgeCells)
        ) valid.push([anchorR, anchorC]);
      }
    }
  } else {
    const minDc = Math.min(...body.map(([, dc]) => dc));
    const bodyDrsAtMinDc = body.filter(([, dc]) => dc === minDc).map(([dr]) => dr);
    for (const [er, ec] of edgeCells[3]) {
      const anchorC = ec - minDc;
      for (const dr of bodyDrsAtMinDc) {
        const anchorR = er - dr;
        if (
          isValidPlacement(layout, maskA, maskB, rows, cols, tpl, anchorR, anchorC, doorZone) &&
          isEdgeAligned(tpl, anchorR, anchorC, 3, edgeCells)
        ) valid.push([anchorR, anchorC]);
      }
    }
  }

  return sampleCandidates(dedupPairs(valid), rand);
}

function generateCenterCandidates(
  layout: Grid, maskA: Grid, maskB: Grid,
  rows: number, cols: number,
  tpl: FurnitureTemplate,
  rand: () => number,
  doorZone?: Set<string>
): Array<[number, number]> {
  const valid: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isValidPlacement(layout, maskA, maskB, rows, cols, tpl, r, c, doorZone)) {
        valid.push([r, c]);
      }
    }
  }
  return sampleCandidates(valid, rand);
}

// ---------------------------------------------------------------------------
// 评分
// ---------------------------------------------------------------------------

function scorePlacement(
  placed: PlacedFurniture[], anchor: [number, number],
  edge: number, usedEdges: Record<number, number>,
  edgeCells: Record<number, Array<[number, number]>>,
  rows: number, cols: number,
  isCenter: boolean
): number {
  let score = 0;

  if (placed.length > 0) {
    const sumR = placed.reduce((s, p) => s + p.anchor[0], 0) / placed.length;
    const sumC = placed.reduce((s, p) => s + p.anchor[1], 0) / placed.length;
    const dist = Math.sqrt((anchor[0] - sumR) ** 2 + (anchor[1] - sumC) ** 2);
    score += Math.min(dist, 8) * 1.5;
  }

  if (!isCenter) {
    const maxUsed = Math.max(0, ...Object.values(usedEdges));
    score += (maxUsed - (usedEdges[edge] ?? 0)) * 2;
  } else {
    const allEdge = Object.values(edgeCells).flat();
    if (allEdge.length > 0) {
      const minWall = Math.min(
        ...allEdge.map(([br, bc]) => Math.sqrt((anchor[0] - br) ** 2 + (anchor[1] - bc) ** 2))
      );
      if (minWall < 3) score -= (3 - minWall) * 2;
    }
    const distCenter = Math.sqrt((anchor[0] - rows / 2) ** 2 + (anchor[1] - cols / 2) ** 2);
    score += Math.max(0, 4 - distCenter) * 2;
  }

  if (placed.length > 0) {
    const minDist = Math.min(
      ...placed.map(p => Math.sqrt((anchor[0] - p.anchor[0]) ** 2 + (anchor[1] - p.anchor[1]) ** 2))
    );
    if (minDist < 2) score -= (2 - minDist) * 3;
  }

  return score;
}

// ---------------------------------------------------------------------------
// 放置执行
// ---------------------------------------------------------------------------

function applyPlacement(
  maskA: Grid, maskB: Grid, layout: Grid,
  rows: number, cols: number,
  tpl: FurnitureTemplate, ar: number, ac: number,
  effectiveRank: number
): void {
  for (let r = 0; r < tpl.rows; r++) {
    for (let c = 0; c < tpl.cols; c++) {
      const v = tpl.mask[r][c];
      const gr = ar + r, gc = ac + c;
      if (v === 1) {
        maskA[gr][gc] = effectiveRank;
      } else if (v > 1) {
        maskA[gr][gc] = effectiveRank + 10;
      } else {
        if (gr >= 0 && gr < rows && gc >= 0 && gc < cols && layout[gr][gc] !== 0) {
          maskB[gr][gc] = 1;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 占用率计算
// ---------------------------------------------------------------------------

/** 全房间占用率（居中家具用） */
function roomOccupancyRatio(layout: Grid, maskA: Grid, maskB: Grid, rows: number, cols: number): number {
  let total = 0, occupied = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (layout[r][c] === 0) continue;
      total++;
      if (maskA[r][c] !== 0 || maskB[r][c] !== 0) occupied++;
    }
  }
  return total > 0 ? occupied / total : 1;
}

/** 贴边格占用率：只统计四条内边界格中 maskA/maskB 已占用的比例 */
function edgeOccupancyRatio(
  maskA: Grid, maskB: Grid,
  edgeCells: Record<number, Array<[number, number]>>
): number {
  const allEdge = Object.values(edgeCells).flat();
  if (allEdge.length === 0) return 1;
  let occupied = 0;
  for (const [r, c] of allEdge) {
    if (maskA[r][c] !== 0 || maskB[r][c] !== 0) occupied++;
  }
  return occupied / allEdge.length;
}

// ---------------------------------------------------------------------------
// 模板选择
// ---------------------------------------------------------------------------

function resolveTemplates(
  item: FurnitureListItem,
  singleLib: TemplateLibrary,
  groupLib: TemplateLibrary
): FurnitureTemplate[] {
  const fid = item.furniture_id;
  if (item.type === "group") return groupLib[fid] ?? [];
  return singleLib[fid] ?? [];
}

// ---------------------------------------------------------------------------
// 核心：单类家具填充循环
// ---------------------------------------------------------------------------

const EDGE_OCCUPY_LIMIT = 0.65;
const CENTER_OCCUPY_LIMIT = 0.80;
const MAX_FAIL = 5;

export interface FillResult {
  maskA: Grid;
  maskB: Grid;
  placed: PlacedFurniture[];
  diagnostics: string[];
}

export function fillAll(
  layout: Grid,
  maskA: Grid,
  maskB: Grid,
  singleLib: TemplateLibrary,
  groupLib: TemplateLibrary,
  fillList: FurnitureListItem[],
  rankOffset: number,
  seed: number = 42,
  doorZone?: Set<string>
): FillResult {
  const rows = layout.length;
  const cols = layout[0]?.length ?? 0;
  const edgeCells = computeEdgeCells(layout, rows, cols);
  const usedEdges: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const placed: PlacedFurniture[] = [];
  const diagnostics: string[] = [];
  const rand = makePrng(seed);

  diagnostics.push(`房间: ${rows}x${cols}  seed=${seed}`);
  diagnostics.push(`单件库 keys: ${Object.keys(singleLib).join(", ")}`);
  diagnostics.push(`组合库 keys: ${Object.keys(groupLib).join(", ")}`);
  diagnostics.push(`填充家具: ${fillList.map(i => `${i.name}(${i.furniture_id})`).join(", ")}`);

  // 深拷贝掩码
  const outMaskA: Grid = maskA.map(row => [...row]);
  const outMaskB: Grid = maskB.map(row => [...row]);

  // 全局实例计数器，每次成功放置递增，确保每个实例有唯一 effectiveRank
  let instanceCounter = 0;

  for (const item of fillList) {
    const isEdge = (item.placement ?? "edge") === "edge";
    const occupyLimit = isEdge ? EDGE_OCCUPY_LIMIT : CENTER_OCCUPY_LIMIT;

    const allTemplates = resolveTemplates(item, singleLib, groupLib);
    const templates = isEdge
      ? allTemplates.filter(t => t.placementEdges.length > 0)
      : allTemplates.filter(t => t.placementEdges.length === 0);

    if (templates.length === 0) {
      diagnostics.push(`[填充跳过] ${item.name}(${item.furniture_id}): 找不到${isEdge ? "贴边" : "居中"}模板`);
      continue;
    }

    let failCount = 0;
    let placedCount = 0;

    // 反复放置同一类家具，直到占用率上限或连续失败
    while (failCount < MAX_FAIL) {
      const ratio = isEdge
        ? edgeOccupancyRatio(outMaskA, outMaskB, edgeCells)
        : roomOccupancyRatio(layout, outMaskA, outMaskB, rows, cols);
      if (ratio >= occupyLimit) {
        diagnostics.push(`[填充停止] ${item.name}: ${isEdge ? "贴边格" : "房间"}占用率 ${(ratio * 100).toFixed(0)}% 已达上限 ${(occupyLimit * 100).toFixed(0)}%，共放置 ${placedCount} 个`);
        break;
      }

      let bestScore = -Infinity;
      let bestAnchor: [number, number] | null = null;
      let bestTpl: FurnitureTemplate | null = null;
      let bestEdge = -1;

      if (isEdge) {
        for (const tpl of shuffleArray(templates, rand)) {
          for (const edge of tpl.placementEdges) {
            const candidates = generateEdgeCandidates(
              layout, outMaskA, outMaskB, rows, cols, tpl, edge, edgeCells, rand, doorZone
            );
            for (const anchor of candidates) {
              const s = scorePlacement(placed, anchor, edge, usedEdges, edgeCells, rows, cols, false);
              if (s > bestScore) { bestScore = s; bestAnchor = anchor; bestTpl = tpl; bestEdge = edge; }
            }
          }
        }
      } else {
        for (const tpl of shuffleArray(templates, rand)) {
          const candidates = generateCenterCandidates(
            layout, outMaskA, outMaskB, rows, cols, tpl, rand, doorZone
          );
          for (const anchor of candidates) {
            const s = scorePlacement(placed, anchor, -1, usedEdges, edgeCells, rows, cols, true);
            if (s > bestScore) { bestScore = s; bestAnchor = anchor; bestTpl = tpl; }
          }
        }
      }

      if (!bestAnchor || !bestTpl) {
        failCount++;
        continue;
      }

      instanceCounter++;
      const instanceRank = rankOffset + instanceCounter;
      applyPlacement(outMaskA, outMaskB, layout, rows, cols, bestTpl, bestAnchor[0], bestAnchor[1], instanceRank);
      if (isEdge) usedEdges[bestEdge] = (usedEdges[bestEdge] ?? 0) + 1;

      const edgeName: Record<number, string> = { 0: "上", 1: "右", 2: "下", 3: "左", "-1": "居中" };
      diagnostics.push(`[填充#${placedCount + 1}] ${item.name} → ${bestTpl.id} @ (${bestAnchor[0]},${bestAnchor[1]}) 贴${edgeName[bestEdge] ?? "?"}边`);

      placed.push({
        name: item.name,
        rank: item.rank,
        effectiveRank: instanceRank,
        templateId: bestTpl.id,
        templateMask: bestTpl.mask,
        anchor: bestAnchor,
        edge: bestEdge,
        isGroup: bestTpl.isGroup,
      });

      placedCount++;
      failCount = 0;
    }

    if (failCount >= MAX_FAIL) {
      diagnostics.push(`[填充停止] ${item.name}: 连续 ${MAX_FAIL} 次无合法位置，共放置 ${placedCount} 个`);
    }
  }

  return { maskA: outMaskA, maskB: outMaskB, placed, diagnostics };
}
