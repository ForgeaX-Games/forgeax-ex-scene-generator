/**
 * room_layout_placer — 独立版（所有依赖内联，无外部 import 依赖其他电池）
 *
 * DataTree 数据格式：roomGrid / doorGrid / outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张房间网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：
 *   roomGrid      — 房间网格
 *   doorGrid      — 门网格（可选）
 *   furnitureList — 全量家具清单（rank 1-7 → main，rank 8-9 → fill）
 *   layoutMode    — "grid" | "nested" | "symmetric" | "one_open"
 *   layoutConfig  — JSON 字符串，模式专属参数
 *   seed          — 随机种子，0 = 当前时间
 */

import singleLibraryData from "./simple_furniture_demo.json" assert { type: "json" };
import groupLibraryData from "./desk_chair_set.json" assert { type: "json" };

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

type Grid = number[][];
type FurnitureDirection = "top" | "right" | "bottom" | "left" | "square" | "h" | "v";

interface FurnitureTemplate {
  id: string; size: string; shape: string;
  placementEdges: number[]; mask: Grid; rows: number; cols: number;
  isGroup: boolean; components: Record<string, string>;
}

interface PlacedFurniture {
  name: string; rank: number; effectiveRank: number;
  templateId: string; templateMask: Grid;
  anchor: [number, number]; edge: number;
  isGroup: boolean; groupSlots: number;
  components: Record<string, string>;
}

type TemplateLibrary = Record<string, FurnitureTemplate[]>;

interface FurnitureListItem {
  rank: number; name: string; furniture_id: string;
  type?: "single" | "group"; placement?: "edge" | "center";
}

interface FurnitureIndexEntry {
  rank: number; name: string; isGroup: boolean; direction: FurnitureDirection;
}

// ═══════════════════════════════════════════════════════════════════════════
// direction 辅助函数
// ═══════════════════════════════════════════════════════════════════════════

function edgeToDirection(edge: number): FurnitureDirection {
  switch (edge) {
    case 0: return "top"; case 1: return "right";
    case 2: return "bottom"; case 3: return "left";
    default: return "square";
  }
}

function shapeDirectionFromId(templateId: string, edge: number): FurnitureDirection {
  if (edge >= 0) return edgeToDirection(edge);
  const lower = templateId.toLowerCase();
  if (lower.includes("_h_") || lower.endsWith("_h")) return "h";
  if (lower.includes("_v_") || lower.endsWith("_v")) return "v";
  return "square";
}

function calcPlacedDirection(p: { edge: number; templateId: string }): FurnitureDirection {
  return shapeDirectionFromId(p.templateId, p.edge);
}

function calcGroupSlotDirection(mask: Grid, slotIndex: number, overallDirection: FurnitureDirection): FurnitureDirection {
  if (slotIndex === 1) return overallDirection;
  let r1 = 0, c1 = 0, n1 = 0, r2 = 0, c2 = 0, n2 = 0;
  for (let r = 0; r < mask.length; r++) {
    for (let c = 0; c < (mask[r]?.length ?? 0); c++) {
      const v = mask[r][c];
      if (v === 1) { r1 += r; c1 += c; n1++; }
      else if (v === slotIndex) { r2 += r; c2 += c; n2++; }
    }
  }
  if (n1 === 0 || n2 === 0) return overallDirection;
  const dr = r2 / n2 - r1 / n1, dc = c2 / n2 - c1 / n1;
  if (Math.abs(dr) >= Math.abs(dc)) return dr > 0 ? "top" : "bottom";
  return dc > 0 ? "left" : "right";
}

// ═══════════════════════════════════════════════════════════════════════════
// furnitureNameCollapse（内联）
// ═══════════════════════════════════════════════════════════════════════════

type NameListItem = { id: number; name: string; type: string; direction?: string };

function furnitureNameCollapse(input: Record<string, unknown>): Record<string, unknown> {
  const rawList = input.list, maskA = input.maskA as Grid | undefined;
  const typeValue = typeof input.type === "string" ? input.type : "asset";
  if (!Array.isArray(rawList)) return { error: "list 必须是数组" };
  if (!maskA || !Array.isArray(maskA) || maskA.length === 0) return { error: "maskA 必须是非空网格" };
  const rankToNewId = new Map<number, number>(), nameList: NameListItem[] = [];
  for (const item of rawList) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const rank = typeof obj.rank === "number" ? obj.rank : Number(obj.rank);
    const name = typeof obj.name === "string" ? obj.name.trim() : String(obj.name ?? "").trim();
    if (isNaN(rank) || !name || rankToNewId.has(rank)) continue;
    const newId = nameList.length + 1;
    rankToNewId.set(rank, newId);
    const entry: NameListItem = { id: newId, name, type: typeValue };
    if (typeof obj.direction === "string") entry.direction = obj.direction;
    nameList.push(entry);
  }
  const rows = maskA.length, cols = maskA[0]?.length ?? 0;
  const outputGrid: Grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => { const v = maskA[r][c]; return v === 0 ? 0 : (rankToNewId.get(v) ?? 0); })
  );
  return { outputGrid, nameList, count: nameList.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// roomMaskInit（内联）
// ═══════════════════════════════════════════════════════════════════════════

function roomMaskInit(input: Record<string, unknown>): Record<string, unknown> {
  const roomGrid = input.roomGrid as Grid | undefined;
  const doorGrid = input.doorGrid as Grid | undefined;
  if (!roomGrid || !Array.isArray(roomGrid) || roomGrid.length === 0) return { error: "roomGrid is required" };
  if (!doorGrid || !Array.isArray(doorGrid) || doorGrid.length === 0) return { error: "doorGrid is required" };
  const rows = roomGrid.length, cols = roomGrid[0].length;
  const maskA: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const maskB: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (doorGrid[r][c] === 0) continue;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) maskB[nr][nc] = 1;
      }
    }
  }
  return { maskA, maskB };
}

// ═══════════════════════════════════════════════════════════════════════════
// furniturePositionStamp（内联）
// ═══════════════════════════════════════════════════════════════════════════

function positionToDirection(position: number): FurnitureDirection {
  switch (position) {
    case 1: return "top"; case 2: return "right"; case 3: return "bottom"; case 4: return "left";
    case 5: case 6: return "top"; case 7: case 8: return "bottom"; default: return "square";
  }
}

function furniturePositionStamp(input: Record<string, unknown>): Record<string, unknown> {
  const furnitureMask = input.furnitureMask as Grid | undefined;
  const furnitureName = typeof input.furnitureName === "string" ? input.furnitureName : "未命名家具";
  const position = typeof input.position === "number" ? Math.floor(input.position) : 0;
  const roomGrid = input.roomGrid as Grid | undefined;
  const maskA = input.maskA as Grid | undefined;
  const maskB = input.maskB as Grid | undefined;
  const oldIdx = Array.isArray(input.oldFurnitureIndex) ? (input.oldFurnitureIndex as FurnitureIndexEntry[]) : [];
  if (!furnitureMask || !roomGrid || !maskA || !maskB) return { error: "missing required input" };
  const roomRows = roomGrid.length, roomCols = roomGrid[0]?.length ?? 0;
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (let r = 0; r < roomGrid.length; r++) {
    for (let c = 0; c < (roomGrid[r]?.length ?? 0); c++) {
      if (roomGrid[r][c] === 1) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
    }
  }
  if (!isFinite(minR)) return { error: "roomGrid has no valid cells" };
  let minDr = Infinity, maxDr = -Infinity, minDc = Infinity, maxDc = -Infinity;
  for (let dr = 0; dr < furnitureMask.length; dr++) {
    for (let dc = 0; dc < (furnitureMask[dr]?.length ?? 0); dc++) {
      if (furnitureMask[dr][dc] >= 1) { minDr = Math.min(minDr, dr); maxDr = Math.max(maxDr, dr); minDc = Math.min(minDc, dc); maxDc = Math.max(maxDc, dc); }
    }
  }
  if (!isFinite(minDr)) return { error: "furnitureMask has no body cells" };
  const rCR = Math.floor((minR + maxR) / 2), rCC = Math.floor((minC + maxC) / 2);
  const bCDr = Math.floor((minDr + maxDr) / 2), bCDc = Math.floor((minDc + maxDc) / 2);
  let aR: number, aC: number;
  switch (position) {
    case 0: aR = rCR - bCDr; aC = rCC - bCDc; break;
    case 1: aR = minR - minDr; aC = rCC - bCDc; break;
    case 2: aR = rCR - bCDr; aC = maxC - maxDc; break;
    case 3: aR = maxR - maxDr; aC = rCC - bCDc; break;
    case 4: aR = rCR - bCDr; aC = minC - minDc; break;
    case 5: aR = minR - minDr; aC = minC - minDc; break;
    case 6: aR = minR - minDr; aC = maxC - maxDc; break;
    case 7: aR = maxR - maxDr; aC = maxC - maxDc; break;
    case 8: aR = maxR - maxDr; aC = minC - minDc; break;
    default: aR = rCR - bCDr; aC = rCC - bCDc;
  }
  for (let dr = 0; dr < furnitureMask.length; dr++) {
    const maskRow = furnitureMask[dr]; if (!maskRow) continue;
    for (let dc = 0; dc < maskRow.length; dc++) {
      const v = maskRow[dc], gr = aR + dr, gc = aC + dc;
      if (v >= 1) {
        if (gr < 0 || gr >= roomRows || gc < 0 || gc >= roomCols || roomGrid[gr][gc] !== 1 || maskA[gr][gc] !== 0 || maskB[gr][gc] !== 0) {
          return { newMaskA: maskA, newMaskB: maskB, furnitureIndex: oldIdx, placementFailed: true, failReason: `conflict at (${gr},${gc})` };
        }
      }
    }
  }
  const maxOldRank = oldIdx.reduce((m, e) => Math.max(m, e.rank), 0);
  const unitValues = new Set<number>();
  for (const row of furnitureMask) for (const v of row) if (v >= 1) unitValues.add(v);
  const sortedUnits = Array.from(unitValues).sort((a, b) => a - b);
  const unitToRank = new Map<number, number>();
  sortedUnits.forEach((u, i) => unitToRank.set(u, maxOldRank + 1 + i));
  const outMaskA: Grid = maskA.map(r => [...r]), outMaskB: Grid = maskB.map(r => [...r]);
  for (let dr = 0; dr < furnitureMask.length; dr++) {
    const maskRow = furnitureMask[dr]; if (!maskRow) continue;
    for (let dc = 0; dc < maskRow.length; dc++) {
      const v = maskRow[dc], gr = aR + dr, gc = aC + dc;
      if (gr < 0 || gr >= roomRows || gc < 0 || gc >= roomCols) continue;
      if (v >= 1) { const rank = unitToRank.get(v); if (rank !== undefined) outMaskA[gr][gc] = rank; }
      else if (roomGrid[gr][gc] === 1) outMaskB[gr][gc] = 1;
    }
  }
  const dir = positionToDirection(position);
  const newEntries: FurnitureIndexEntry[] = sortedUnits.map(u => ({ rank: unitToRank.get(u)!, name: furnitureName, isGroup: false, direction: dir }));
  return { newMaskA: outMaskA, newMaskB: outMaskB, furnitureIndex: [...oldIdx, ...newEntries], placementFailed: false, failReason: "" };
}

// ═══════════════════════════════════════════════════════════════════════════
// 模板库构建
// ═══════════════════════════════════════════════════════════════════════════

function buildSingleLibrary(libraryData: unknown): TemplateLibrary {
  const data = libraryData as { furniture_categories?: Array<{ items?: unknown[] }> };
  const lib: TemplateLibrary = {};
  for (const cat of data.furniture_categories ?? []) {
    for (const raw of cat.items ?? []) {
      const item = raw as Record<string, unknown>, mask = item["mask"] as Grid;
      const tpl: FurnitureTemplate = { id: item["id"] as string, size: item["size"] as string, shape: item["shape"] as string, placementEdges: item["placement_edges"] as number[], mask, rows: mask.length, cols: mask[0]?.length ?? 0, isGroup: false, components: {} };
      (lib[`${tpl.size}_${tpl.shape}`] ??= []).push(tpl);
    }
  }
  return lib;
}

function extractGroupBaseName(id: string): string { return id.replace(/_(edge\d+|center_\w+)$/, ""); }

function buildGroupLibrary(libraryData: unknown): TemplateLibrary {
  const data = libraryData as { furniture_categories?: Array<{ items?: unknown[] }> };
  const lib: TemplateLibrary = {};
  for (const cat of data.furniture_categories ?? []) {
    for (const raw of cat.items ?? []) {
      const item = raw as Record<string, unknown>, mask = item["mask"] as Grid;
      const tpl: FurnitureTemplate = { id: item["id"] as string, size: (item["size"] as string) ?? "small", shape: (item["shape"] as string) ?? "square", placementEdges: (item["placement_edges"] as number[]) ?? [], mask, rows: mask.length, cols: mask[0]?.length ?? 0, isGroup: true, components: (item["components"] as Record<string, string>) ?? {} };
      (lib[extractGroupBaseName(tpl.id)] ??= []).push(tpl);
    }
  }
  return lib;
}

// ═══════════════════════════════════════════════════════════════════════════
// 放置算法共用部分
// ═══════════════════════════════════════════════════════════════════════════

function computeEdgeCells(layout: Grid, rows: number, cols: number): Record<number, Array<[number, number]>> {
  const top: Array<[number, number]> = [], right: Array<[number, number]> = [], bottom: Array<[number, number]> = [], left: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!layout[r][c]) continue;
    if (r === 0 || !layout[r - 1][c]) top.push([r, c]);
    if (r === rows - 1 || !layout[r + 1][c]) bottom.push([r, c]);
    if (c === 0 || !layout[r][c - 1]) left.push([r, c]);
    if (c === cols - 1 || !layout[r][c + 1]) right.push([r, c]);
  }
  return { 0: top, 1: right, 2: bottom, 3: left };
}

function bodyCells(tpl: FurnitureTemplate): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < tpl.rows; r++) for (let c = 0; c < tpl.cols; c++) { const v = tpl.mask[r][c]; if (tpl.isGroup ? v !== 0 : v === 1) cells.push([r, c]); }
  return cells;
}

function aisleCells(tpl: FurnitureTemplate): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < tpl.rows; r++) for (let c = 0; c < tpl.cols; c++) if (!tpl.mask[r][c]) cells.push([r, c]);
  return cells;
}

function isRoomCell(layout: Grid, rows: number, cols: number, r: number, c: number): boolean {
  return r >= 0 && r < rows && c >= 0 && c < cols && layout[r][c] !== 0;
}

function isValidPlacement(layout: Grid, maskA: Grid, maskB: Grid, rows: number, cols: number, tpl: FurnitureTemplate, ar: number, ac: number, doorZone?: Set<string>): boolean {
  for (const [dr, dc] of bodyCells(tpl)) {
    const r = ar + dr, c = ac + dc;
    if (!isRoomCell(layout, rows, cols, r, c) || maskA[r][c] !== 0 || maskB[r][c] !== 0 || doorZone?.has(`${r},${c}`)) return false;
  }
  for (const [dr, dc] of aisleCells(tpl)) {
    const r = ar + dr, c = ac + dc;
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    if (isRoomCell(layout, rows, cols, r, c) && maskA[r][c] !== 0) return false;
  }
  return true;
}

function isEdgeAligned(tpl: FurnitureTemplate, ar: number, ac: number, edge: number, edgeCells: Record<number, Array<[number, number]>>): boolean {
  const body = bodyCells(tpl); if (!body.length) return false;
  const es = new Set(edgeCells[edge].map(([r, c]) => `${r},${c}`));
  if (edge === 0) { const minR = Math.min(...body.map(([dr]) => ar + dr)); return body.some(([dr, dc]) => ar + dr === minR && es.has(`${minR},${ac + dc}`)); }
  if (edge === 2) { const maxR = Math.max(...body.map(([dr]) => ar + dr)); return body.some(([dr, dc]) => ar + dr === maxR && es.has(`${maxR},${ac + dc}`)); }
  if (edge === 1) { const maxC = Math.max(...body.map(([, dc]) => ac + dc)); return body.some(([dr, dc]) => ac + dc === maxC && es.has(`${ar + dr},${maxC}`)); }
  const minC = Math.min(...body.map(([, dc]) => ac + dc)); return body.some(([dr, dc]) => ac + dc === minC && es.has(`${ar + dr},${minC}`));
}

function makePrng(seed: number): () => number {
  let s = seed >>> 0;
  return function () { s += 0x6d2b79f5; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function shuffleArray<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a;
}

const MAX_CANDIDATES = 30;

function dedupPairs(pairs: Array<[number, number]>): Array<[number, number]> {
  const seen = new Set<string>(); return pairs.filter(([r, c]) => { const k = `${r},${c}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function sampleCandidates(cands: Array<[number, number]>, rand: () => number): Array<[number, number]> {
  if (cands.length <= MAX_CANDIDATES) return cands;
  const result: Array<[number, number]> = [], pool = [...cands];
  for (let i = 0; i < MAX_CANDIDATES; i++) { const j = Math.floor(rand() * pool.length); result.push(pool[j]); pool.splice(j, 1); }
  return result;
}

function generateEdgeCandidates(layout: Grid, maskA: Grid, maskB: Grid, rows: number, cols: number, tpl: FurnitureTemplate, edge: number, edgeCells: Record<number, Array<[number, number]>>, rand: () => number, doorZone?: Set<string>): Array<[number, number]> {
  const valid: Array<[number, number]> = [], body = bodyCells(tpl);
  if (edge === 0) { const minDr = Math.min(...body.map(([dr]) => dr)), bDcs = body.filter(([dr]) => dr === minDr).map(([, dc]) => dc); for (const [er, ec] of edgeCells[0]) { const aR = er - minDr; for (const dc of bDcs) { const aC = ec - dc; if (isValidPlacement(layout, maskA, maskB, rows, cols, tpl, aR, aC, doorZone) && isEdgeAligned(tpl, aR, aC, 0, edgeCells)) valid.push([aR, aC]); } } }
  else if (edge === 2) { const maxDr = Math.max(...body.map(([dr]) => dr)), bDcs = body.filter(([dr]) => dr === maxDr).map(([, dc]) => dc); for (const [er, ec] of edgeCells[2]) { const aR = er - maxDr; for (const dc of bDcs) { const aC = ec - dc; if (isValidPlacement(layout, maskA, maskB, rows, cols, tpl, aR, aC, doorZone) && isEdgeAligned(tpl, aR, aC, 2, edgeCells)) valid.push([aR, aC]); } } }
  else if (edge === 1) { const maxDc = Math.max(...body.map(([, dc]) => dc)), bDrs = body.filter(([, dc]) => dc === maxDc).map(([dr]) => dr); for (const [er, ec] of edgeCells[1]) { const aC = ec - maxDc; for (const dr of bDrs) { const aR = er - dr; if (isValidPlacement(layout, maskA, maskB, rows, cols, tpl, aR, aC, doorZone) && isEdgeAligned(tpl, aR, aC, 1, edgeCells)) valid.push([aR, aC]); } } }
  else { const minDc = Math.min(...body.map(([, dc]) => dc)), bDrs = body.filter(([, dc]) => dc === minDc).map(([dr]) => dr); for (const [er, ec] of edgeCells[3]) { const aC = ec - minDc; for (const dr of bDrs) { const aR = er - dr; if (isValidPlacement(layout, maskA, maskB, rows, cols, tpl, aR, aC, doorZone) && isEdgeAligned(tpl, aR, aC, 3, edgeCells)) valid.push([aR, aC]); } } }
  return sampleCandidates(dedupPairs(valid), rand);
}

function generateCenterCandidates(layout: Grid, maskA: Grid, maskB: Grid, rows: number, cols: number, tpl: FurnitureTemplate, rand: () => number, doorZone?: Set<string>): Array<[number, number]> {
  const valid: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (isValidPlacement(layout, maskA, maskB, rows, cols, tpl, r, c, doorZone)) valid.push([r, c]);
  return sampleCandidates(valid, rand);
}

function scorePlacement(placed: PlacedFurniture[], anchor: [number, number], edge: number, usedEdges: Record<number, number>, edgeCells: Record<number, Array<[number, number]>>, rows: number, cols: number, isCenter: boolean): number {
  let score = 0;
  if (placed.length > 0) { const sR = placed.reduce((s, p) => s + p.anchor[0], 0) / placed.length, sC = placed.reduce((s, p) => s + p.anchor[1], 0) / placed.length; score += Math.min(Math.sqrt((anchor[0] - sR) ** 2 + (anchor[1] - sC) ** 2), 8) * 1.5; }
  if (!isCenter) { const mU = Math.max(0, ...Object.values(usedEdges)); score += (mU - (usedEdges[edge] ?? 0)) * 2; }
  else { const aE = Object.values(edgeCells).flat(); if (aE.length > 0) { const mW = Math.min(...aE.map(([br, bc]) => Math.sqrt((anchor[0] - br) ** 2 + (anchor[1] - bc) ** 2))); if (mW < 3) score -= (3 - mW) * 2; } score += Math.max(0, 4 - Math.sqrt((anchor[0] - rows / 2) ** 2 + (anchor[1] - cols / 2) ** 2)) * 2; }
  if (placed.length > 0) { const mD = Math.min(...placed.map(p => Math.sqrt((anchor[0] - p.anchor[0]) ** 2 + (anchor[1] - p.anchor[1]) ** 2))); if (mD < 2) score -= (2 - mD) * 3; }
  return score;
}

function maxMaskValue(tpl: FurnitureTemplate): number { let m = 1; for (let r = 0; r < tpl.rows; r++) for (let c = 0; c < tpl.cols; c++) if (tpl.mask[r][c] > m) m = tpl.mask[r][c]; return m; }

function applyPlacerMask(maskA: Grid, maskB: Grid, layout: Grid, rows: number, cols: number, tpl: FurnitureTemplate, ar: number, ac: number, effectiveRank: number): void {
  for (let r = 0; r < tpl.rows; r++) for (let c = 0; c < tpl.cols; c++) { const v = tpl.mask[r][c], gr = ar + r, gc = ac + c; if (gr < 0 || gr >= rows || gc < 0 || gc >= cols) continue; if (v === 1 && layout[gr][gc] !== 0) maskA[gr][gc] = effectiveRank; else if (v > 1 && layout[gr][gc] !== 0) maskA[gr][gc] = effectiveRank + (v - 1); else if (v === 0 && layout[gr][gc] !== 0) maskB[gr][gc] = 1; }
}

function applyFillerMask(maskA: Grid, maskB: Grid, layout: Grid, rows: number, cols: number, tpl: FurnitureTemplate, ar: number, ac: number, effectiveRank: number): void {
  for (let r = 0; r < tpl.rows; r++) for (let c = 0; c < tpl.cols; c++) { const v = tpl.mask[r][c], gr = ar + r, gc = ac + c; if (gr < 0 || gr >= rows || gc < 0 || gc >= cols) continue; if (v === 1 && layout[gr][gc] !== 0) maskA[gr][gc] = effectiveRank; else if (v > 1 && layout[gr][gc] !== 0) maskA[gr][gc] = effectiveRank + 10; else if (v === 0 && layout[gr][gc] !== 0) maskB[gr][gc] = 1; }
}

function resolveTemplates(item: FurnitureListItem, singleLib: TemplateLibrary, groupLib: TemplateLibrary): FurnitureTemplate[] {
  return item.type === "group" ? (groupLib[item.furniture_id] ?? []) : (singleLib[item.furniture_id] ?? []);
}

// ═══════════════════════════════════════════════════════════════════════════
// furniturePlacer（内联）
// ═══════════════════════════════════════════════════════════════════════════

function furniturePlacer(input: Record<string, unknown>): Record<string, unknown> {
  const roomGrid = input.roomGrid as Grid | undefined, maskA = input.maskA as Grid | undefined, maskB = input.maskB as Grid | undefined;
  const oldIdx = (input.oldFurnitureIndex as FurnitureIndexEntry[] | undefined) ?? [];
  const furnitureList = input.furnitureList as FurnitureListItem[] | undefined;
  const seed = typeof input.seed === "number" ? Math.floor(input.seed) : 42;
  if (!roomGrid || !Array.isArray(roomGrid) || !roomGrid.length) return { error: "roomGrid required" };
  if (!maskA || !maskB) return { error: "maskA/maskB required" };
  if (!Array.isArray(furnitureList) || !furnitureList.length) return { newMaskA: maskA, newMaskB: maskB, furnitureIndex: oldIdx, diagnostics: [] };
  const sLib = buildSingleLibrary(singleLibraryData), gLib = buildGroupLibrary(groupLibraryData);
  const rankOffset = oldIdx.reduce((m, e) => Math.max(m, e.rank), 0);
  const bRG: Grid = roomGrid.map(row => row.map(v => v !== 0 ? 1 : 0));
  const sorted = [...furnitureList].sort((a, b) => a.rank - b.rank);
  const edgeItems = sorted.filter(i => (i.placement ?? "edge") === "edge"), centerItems = sorted.filter(i => i.placement === "center");
  const rows = bRG.length, cols = bRG[0]?.length ?? 0;
  const eCells = computeEdgeCells(bRG, rows, cols), usedEdges: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const placed: PlacedFurniture[] = [], diag: string[] = [], rand = makePrng(seed);
  const oMA: Grid = maskA.map(r => [...r]), oMB: Grid = maskB.map(r => [...r]);
  let rankShift = 0;
  function placeOne(item: FurnitureListItem, isCenter: boolean): void {
    const eR = rankOffset + item.rank + rankShift, allT = resolveTemplates(item, sLib, gLib);
    const tmpls = isCenter ? allT.filter(t => !t.placementEdges.length) : allT.filter(t => t.placementEdges.length > 0);
    if (!tmpls.length) { diag.push(`[skip] ${item.name}`); return; }
    let bS = -Infinity, bA: [number, number] | null = null, bT: FurnitureTemplate | null = null, bE = -1;
    if (!isCenter) { for (const tpl of shuffleArray(tmpls, rand)) for (const edge of tpl.placementEdges) { const cs = generateEdgeCandidates(bRG, oMA, oMB, rows, cols, tpl, edge, eCells, rand); for (const a of cs) { const s = scorePlacement(placed, a, edge, usedEdges, eCells, rows, cols, false); if (s > bS) { bS = s; bA = a; bT = tpl; bE = edge; } } } }
    else { for (const tpl of shuffleArray(tmpls, rand)) { const cs = generateCenterCandidates(bRG, oMA, oMB, rows, cols, tpl, rand); for (const a of cs) { const s = scorePlacement(placed, a, -1, usedEdges, eCells, rows, cols, true); if (s > bS) { bS = s; bA = a; bT = tpl; } } } }
    if (!bA || !bT) { diag.push(`[skip] ${item.name}: no position`); return; }
    applyPlacerMask(oMA, oMB, bRG, rows, cols, bT, bA[0], bA[1], eR);
    if (!isCenter) usedEdges[bE] = (usedEdges[bE] ?? 0) + 1;
    const slots = maxMaskValue(bT); if (bT.isGroup && slots > 1) rankShift += slots - 1;
    placed.push({ name: item.name, rank: item.rank, effectiveRank: eR, templateId: bT.id, templateMask: bT.mask, anchor: bA, edge: bE, isGroup: bT.isGroup, groupSlots: slots, components: bT.components });
  }
  for (const i of edgeItems) placeOne(i, false);
  for (const i of centerItems) placeOne(i, true);
  const newEntries: FurnitureIndexEntry[] = [];
  for (const p of placed) { const od = calcPlacedDirection(p); for (let i = 0; i < p.groupSlots; i++) { const si = i + 1, sl = p.components[String(si)], en = sl ? `${p.name}_${sl}` : i === 0 ? p.name : `${p.name}_组件${i}`; newEntries.push({ rank: p.effectiveRank + i, name: en, isGroup: p.isGroup, direction: p.isGroup ? calcGroupSlotDirection(p.templateMask, si, od) : od }); } }
  return { newMaskA: oMA, newMaskB: oMB, furnitureIndex: [...oldIdx, ...newEntries], diagnostics: diag };
}

// ═══════════════════════════════════════════════════════════════════════════
// furnitureFiller（内联）
// ═══════════════════════════════════════════════════════════════════════════

const EDGE_OCC = 0.65, CTR_OCC = 0.80, MX_FAIL = 5;

function roomOccRatio(layout: Grid, maskA: Grid, maskB: Grid, rows: number, cols: number): number {
  let t = 0, o = 0; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { if (!layout[r][c]) continue; t++; if (maskA[r][c] || maskB[r][c]) o++; } return t ? o / t : 1;
}

function edgeOccRatio(maskA: Grid, maskB: Grid, eCells: Record<number, Array<[number, number]>>): number {
  const all = Object.values(eCells).flat(); if (!all.length) return 1; let o = 0; for (const [r, c] of all) if (maskA[r][c] || maskB[r][c]) o++; return o / all.length;
}

function furnitureFiller(input: Record<string, unknown>): Record<string, unknown> {
  const roomGrid = input.roomGrid as Grid | undefined, maskA = input.maskA as Grid | undefined, maskB = input.maskB as Grid | undefined;
  const oldIdx = (input.oldFurnitureIndex as FurnitureIndexEntry[] | undefined) ?? [];
  const furnitureList = input.furnitureList as FurnitureListItem[] | undefined;
  const seed = typeof input.seed === "number" ? Math.floor(input.seed) : 42;
  if (!roomGrid || !Array.isArray(roomGrid) || !roomGrid.length) return { error: "roomGrid required" };
  if (!maskA || !maskB) return { error: "maskA/maskB required" };
  if (!Array.isArray(furnitureList) || !furnitureList.length) return { newMaskA: maskA, newMaskB: maskB, furnitureIndex: oldIdx, diagnostics: [] };
  const sLib = buildSingleLibrary(singleLibraryData), gLib = buildGroupLibrary(groupLibraryData);
  const rankOffset = oldIdx.reduce((m, e) => Math.max(m, e.rank), 0);
  const bRG: Grid = roomGrid.map(row => row.map(v => v !== 0 ? 1 : 0));
  const sorted = [...furnitureList].sort((a, b) => a.rank - b.rank);
  const rows = bRG.length, cols = bRG[0]?.length ?? 0;
  const eCells = computeEdgeCells(bRG, rows, cols), usedEdges: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const placed: PlacedFurniture[] = [], diag: string[] = [], rand = makePrng(seed);
  const oMA: Grid = maskA.map(r => [...r]), oMB: Grid = maskB.map(r => [...r]);
  let instanceCounter = 0;
  for (const item of sorted) {
    const isEdge = (item.placement ?? "edge") === "edge", oLim = isEdge ? EDGE_OCC : CTR_OCC;
    const allT = resolveTemplates(item, sLib, gLib), tmpls = isEdge ? allT.filter(t => t.placementEdges.length > 0) : allT.filter(t => !t.placementEdges.length);
    if (!tmpls.length) { diag.push(`[skip] ${item.name}`); continue; }
    let failCount = 0;
    while (failCount < MX_FAIL) {
      const ratio = isEdge ? edgeOccRatio(oMA, oMB, eCells) : roomOccRatio(bRG, oMA, oMB, rows, cols);
      if (ratio >= oLim) break;
      let bS = -Infinity, bA: [number, number] | null = null, bT: FurnitureTemplate | null = null, bE = -1;
      if (isEdge) { for (const tpl of shuffleArray(tmpls, rand)) for (const edge of tpl.placementEdges) { const cs = generateEdgeCandidates(bRG, oMA, oMB, rows, cols, tpl, edge, eCells, rand); for (const a of cs) { const s = scorePlacement(placed, a, edge, usedEdges, eCells, rows, cols, false); if (s > bS) { bS = s; bA = a; bT = tpl; bE = edge; } } } }
      else { for (const tpl of shuffleArray(tmpls, rand)) { const cs = generateCenterCandidates(bRG, oMA, oMB, rows, cols, tpl, rand); for (const a of cs) { const s = scorePlacement(placed, a, -1, usedEdges, eCells, rows, cols, true); if (s > bS) { bS = s; bA = a; bT = tpl; } } } }
      if (!bA || !bT) { failCount++; continue; }
      instanceCounter++; const iR = rankOffset + instanceCounter;
      applyFillerMask(oMA, oMB, bRG, rows, cols, bT, bA[0], bA[1], iR);
      if (isEdge) usedEdges[bE] = (usedEdges[bE] ?? 0) + 1;
      placed.push({ name: item.name, rank: item.rank, effectiveRank: iR, templateId: bT.id, templateMask: bT.mask, anchor: bA, edge: bE, isGroup: bT.isGroup, groupSlots: 1, components: bT.components });
      failCount = 0;
    }
  }
  const newE: FurnitureIndexEntry[] = placed.map(p => ({ rank: p.effectiveRank, name: p.name, isGroup: p.isGroup, direction: p.isGroup ? calcGroupSlotDirection(p.templateMask, 1, calcPlacedDirection(p)) : calcPlacedDirection(p) }));
  const subE: FurnitureIndexEntry[] = placed.filter(p => p.isGroup).map(p => ({ rank: p.effectiveRank + 10, name: `${p.name}_子组件`, isGroup: true, direction: calcGroupSlotDirection(p.templateMask, 2, calcPlacedDirection(p)) }));
  return { newMaskA: oMA, newMaskB: oMB, furnitureIndex: [...oldIdx, ...newE, ...subE].sort((a, b) => a.rank - b.rank), diagnostics: diag };
}

// ═══════════════════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════════════════

class LCG {
  private s: bigint;
  constructor(seed: number) { this.s = BigInt(seed || Date.now()); }
  next(): number { this.s = (this.s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn; return Number(this.s & 0x7fffffffn); }
  intn(n: number): number { return n <= 0 ? 0 : this.next() % n; }
}

function makeZeroGrid(rows: number, cols: number): Grid { return Array.from({ length: rows }, () => new Array(cols).fill(0)); }

function buildGridMask(unitW: number, unitH: number, cols: number, rows: number): Grid {
  const cG = 1, rG = 1, iR = rows * unitH + (rows - 1) * rG, iC = cols * unitW + (cols - 1) * cG, inner = makeZeroGrid(iR, iC);
  let uid = 1; for (let ri = 0; ri < rows; ri++) for (let ci = 0; ci < cols; ci++) { for (let r = 0; r < unitH; r++) for (let c = 0; c < unitW; c++) inner[ri * (unitH + rG) + r][ci * (unitW + cG) + c] = uid; uid++; }
  const out = makeZeroGrid(iR + 2, iC + 2); for (let r = 0; r < iR; r++) for (let c = 0; c < iC; c++) out[r + 1][c + 1] = inner[r][c]; return out;
}

function getRoomBBox(g: Grid): { minR: number; maxR: number; minC: number; maxC: number } | null {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0].length; c++) if (g[r][c]) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  return isFinite(minR) ? { minR, maxR, minC, maxC } : null;
}

function splitFurnitureList(list: unknown[]): { mainList: unknown[]; fillList: unknown[] } {
  const m: unknown[] = [], f: unknown[] = [];
  for (const item of list) { const o = item as Record<string, unknown>, rank = o["rank"]; if (typeof rank === "number" && rank >= 8) f.push({ ...o, rank: f.length + 1 }); else m.push(o); }
  return { mainList: m, fillList: f };
}

function parseConfig(s: unknown): Record<string, unknown> {
  if (typeof s !== "string" || !s.trim()) return {}; try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}

// ═══════════════════════════════════════════════════════════════════════════
// grid 模式
// ═══════════════════════════════════════════════════════════════════════════

function autoGridParams(bbox: { minR: number; maxR: number; minC: number; maxC: number }, uW: number, uH: number, tH: number): { cols: number; rows: number } {
  return { cols: Math.min(Math.max(1, Math.floor((bbox.maxC - bbox.minC - 1) / (uW + 1))), 8), rows: Math.min(Math.max(1, Math.floor((bbox.maxR - bbox.minR - tH - 3) / (uH + 1))), 10) };
}

function layoutGridMode(p: { roomGrid: Grid; doorGrid: Grid; mainList: unknown[]; fillList: unknown[]; gridFurnitureName: string; gridUnitW: number; gridUnitH: number; topFurnitureName: string; topUnitW: number | null; topUnitH: number; placerSeed: number; fillerSeed: number }): Record<string, unknown> {
  const ir = roomMaskInit({ roomGrid: p.roomGrid, doorGrid: p.doorGrid }); if (ir.error) return ir;
  let mA = ir.maskA as Grid, mB = ir.maskB as Grid, fi: unknown[] = [];
  const bbox = getRoomBBox(p.roomGrid); if (!bbox) return { error: "no valid cells" };
  const initParams = autoGridParams(bbox, p.gridUnitW, p.gridUnitH, p.topUnitH);

  // 对非矩形房间：如果课桌网格放置失败则逐步缩减行列数重试，最多缩减到 1×1
  let placedGrid = false;
  let finalCols = initParams.cols, finalRows = initParams.rows;
  for (let attempt = 0; attempt < (initParams.cols + initParams.rows) && !placedGrid; attempt++) {
    const gm = buildGridMask(p.gridUnitW, p.gridUnitH, finalCols, finalRows);
    const cr = furniturePositionStamp({ furnitureMask: gm, furnitureName: p.gridFurnitureName, position: 0, roomGrid: p.roomGrid, maskA: mA, maskB: mB, oldFurnitureIndex: fi });
    if (!cr.placementFailed) {
      mA = (cr.newMaskA ?? mA) as Grid; mB = (cr.newMaskB ?? mB) as Grid; fi = (cr.furnitureIndex ?? fi) as unknown[];
      placedGrid = true;
    } else {
      // 交替缩减列数和行数
      if (attempt % 2 === 0 && finalCols > 1) finalCols--;
      else if (finalRows > 1) finalRows--;
      else break;
    }
  }

  // 讲台宽度跟随最终实际列数
  const tW = p.topUnitW !== null ? p.topUnitW : finalCols * (p.gridUnitW + 1) - 1;
  const tM: Grid = Array.from({ length: p.topUnitH }, () => new Array(Math.max(1, tW)).fill(1));
  const tr = furniturePositionStamp({ furnitureMask: tM, furnitureName: p.topFurnitureName, position: 1, roomGrid: p.roomGrid, maskA: mA, maskB: mB, oldFurnitureIndex: fi });
  mA = (tr.newMaskA ?? mA) as Grid; mB = (tr.newMaskB ?? mB) as Grid; fi = (tr.furnitureIndex ?? fi) as unknown[];

  const pr = furniturePlacer({ roomGrid: p.roomGrid, maskA: mA, maskB: mB, oldFurnitureIndex: fi, furnitureList: p.mainList, seed: p.placerSeed });
  mA = (pr.newMaskA ?? mA) as Grid; mB = (pr.newMaskB ?? mB) as Grid; fi = (pr.furnitureIndex ?? fi) as unknown[];
  const fr = furnitureFiller({ roomGrid: p.roomGrid, maskA: mA, maskB: mB, oldFurnitureIndex: fi, furnitureList: p.fillList, seed: p.fillerSeed });
  mA = (fr.newMaskA ?? mA) as Grid; fi = (fr.furnitureIndex ?? fi) as unknown[];
  return furnitureNameCollapse({ list: fi, maskA: mA, type: "tile" });
}

// ═══════════════════════════════════════════════════════════════════════════
// nested 模式
// ═══════════════════════════════════════════════════════════════════════════

function buildZoneGrid(roomGrid: Grid, ratio: number, rng: LCG): Grid {
  const rows = roomGrid.length, cols = roomGrid[0].length, bbox = getRoomBBox(roomGrid);
  if (!bbox) return makeZeroGrid(rows, cols);
  const rH = bbox.maxR - bbox.minR + 1, rW = bbox.maxC - bbox.minC + 1, tc = Math.max(4, Math.floor(rH * rW * ratio));
  const zH = Math.max(2, Math.floor(Math.sqrt(tc * rH / rW))), zW = Math.max(2, Math.floor(tc / zH));
  const cH = Math.min(zH, rH - 1), cW = Math.min(zW, rW - 1);
  const corners: [number, number][] = [[bbox.minR, bbox.minC], [bbox.minR, bbox.maxC - cW + 1], [bbox.maxR - cH + 1, bbox.minC], [bbox.maxR - cH + 1, bbox.maxC - cW + 1]];
  const [sR, sC] = corners[rng.intn(4)], zg = makeZeroGrid(rows, cols);
  for (let r = sR; r < sR + cH && r < rows; r++) for (let c = sC; c < sC + cW && c < cols; c++) if (roomGrid[r][c]) zg[r][c] = 1;
  return zg;
}

function buildRemainingGrid(rg: Grid, zg: Grid): Grid {
  const rows = rg.length, cols = rg[0].length, out = makeZeroGrid(rows, cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (rg[r][c] && !zg[r][c]) out[r][c] = 1;
  return out;
}

function layoutNestedMode(p: { roomGrid: Grid; doorGrid: Grid; mainList: unknown[]; fillList: unknown[]; zoneMainList: unknown[]; zoneFillList: unknown[]; nestedZoneRatio: number; seed: number }): Record<string, unknown> {
  const rng = new LCG(p.seed), ir = roomMaskInit({ roomGrid: p.roomGrid, doorGrid: p.doorGrid }); if (ir.error) return ir;
  let mA = ir.maskA as Grid, mB = ir.maskB as Grid, fi: unknown[] = [];
  const zg = buildZoneGrid(p.roomGrid, p.nestedZoneRatio, rng), s1 = rng.next(), s2 = rng.next(), s3 = rng.next(), s4 = rng.next();
  const p1 = furniturePlacer({ roomGrid: zg, maskA: mA, maskB: mB, oldFurnitureIndex: fi, furnitureList: p.zoneMainList, seed: s1 }); mA = (p1.newMaskA ?? mA) as Grid; mB = (p1.newMaskB ?? mB) as Grid; fi = (p1.furnitureIndex ?? fi) as unknown[];
  const f1 = furnitureFiller({ roomGrid: zg, maskA: mA, maskB: mB, oldFurnitureIndex: fi, furnitureList: p.zoneFillList, seed: s2 }); mA = (f1.newMaskA ?? mA) as Grid; mB = (f1.newMaskB ?? mB) as Grid; fi = (f1.furnitureIndex ?? fi) as unknown[];
  const rg2 = buildRemainingGrid(p.roomGrid, zg);
  const p2 = furniturePlacer({ roomGrid: rg2, maskA: mA, maskB: mB, oldFurnitureIndex: fi, furnitureList: p.mainList, seed: s3 }); mA = (p2.newMaskA ?? mA) as Grid; mB = (p2.newMaskB ?? mB) as Grid; fi = (p2.furnitureIndex ?? fi) as unknown[];
  const f2 = furnitureFiller({ roomGrid: rg2, maskA: mA, maskB: mB, oldFurnitureIndex: fi, furnitureList: p.fillList, seed: s4 }); mA = (f2.newMaskA ?? mA) as Grid; fi = (f2.furnitureIndex ?? fi) as unknown[];
  return furnitureNameCollapse({ list: fi, maskA: mA, type: "tile" });
}

// ═══════════════════════════════════════════════════════════════════════════
// symmetric 模式
// ═══════════════════════════════════════════════════════════════════════════

function buildSimpleMask(h: number, w: number): Grid { return Array.from({ length: h }, () => new Array(w).fill(1)); }
function checkSym(mask: Grid, aR: number, aC: number, rg: Grid, mA: Grid, mB: Grid): string | null {
  const rows = rg.length, cols = rg[0].length;
  for (let dr = 0; dr < mask.length; dr++) for (let dc = 0; dc < mask[dr].length; dc++) { const v = mask[dr][dc], gr = aR + dr, gc = aC + dc; if (v >= 1) { if (gr < 0 || gr >= rows || gc < 0 || gc >= cols) return "oob"; if (!rg[gr][gc]) return "nr"; if (mA[gr][gc]) return "mA"; if (mB[gr][gc]) return "mB"; } else if (gr >= 0 && gr < rows && gc >= 0 && gc < cols && rg[gr][gc] && mA[gr][gc]) return "cor"; } return null;
}
function writeM(mask: Grid, aR: number, aC: number, rank: number, rg: Grid, mA: Grid, mB: Grid): void {
  const rows = rg.length, cols = rg[0].length;
  for (let dr = 0; dr < mask.length; dr++) for (let dc = 0; dc < mask[dr].length; dc++) { const v = mask[dr][dc], gr = aR + dr, gc = aC + dc; if (gr < 0 || gr >= rows || gc < 0 || gc >= cols) continue; if (v >= 1) mA[gr][gc] = rank; else if (rg[gr][gc]) mB[gr][gc] = 1; }
}
function flipH(m: Grid): Grid { return m.map(r => [...r].reverse()); }
function flipV(m: Grid): Grid { return [...m].reverse().map(r => [...r]); }
function mirrorA(aR: number, aC: number, mH: number, mW: number, bbox: { minR: number; maxR: number; minC: number; maxC: number }, sH: boolean, sV: boolean): { r: number; c: number } {
  let mr = aR, mc = aC; if (sH) mr = (bbox.minR + bbox.maxR) - (aR + mH - 1); if (sV) mc = (bbox.minC + bbox.maxC) - (aC + mW - 1); return { r: mr, c: mc };
}

function layoutSymmetricMode(p: { roomGrid: Grid; doorGrid: Grid; mainList: unknown[]; fillList: unknown[]; symmetryH: boolean; symmetryV: boolean; seed: number }): Record<string, unknown> {
  const rng = new LCG(p.seed), ir = roomMaskInit({ roomGrid: p.roomGrid, doorGrid: p.doorGrid }); if (ir.error) return ir;
  const mA = ir.maskA as Grid, mB = ir.maskB as Grid;
  const fi: { rank: number; name: string; isGroup: boolean; direction: FurnitureDirection }[] = [];
  const bbox = getRoomBBox(p.roomGrid); if (!bbox) return { error: "no cells" };
  const { symmetryH: sH, symmetryV: sV } = p;
  if (!sH && !sV) {
    const r1 = furniturePlacer({ roomGrid: p.roomGrid, maskA: mA, maskB: mB, oldFurnitureIndex: [], furnitureList: p.mainList, seed: p.seed });
    const ma = (r1.newMaskA ?? mA) as Grid, mb = (r1.newMaskB ?? mB) as Grid, fii = (r1.furnitureIndex ?? []) as unknown[];
    const r2 = furnitureFiller({ roomGrid: p.roomGrid, maskA: ma, maskB: mb, oldFurnitureIndex: fii, furnitureList: p.fillList, seed: p.seed + 10 });
    return furnitureNameCollapse({ list: (r2.furnitureIndex ?? fii) as unknown[], maskA: (r2.newMaskA ?? ma) as Grid, type: "tile" });
  }
  const hC = Math.floor((bbox.minC + bbox.maxC) / 2), hR = Math.floor((bbox.minR + bbox.maxR) / 2);
  let cr = 1;
  for (const item of p.mainList) {
    const o = item as Record<string, unknown>, nm = typeof o.name === "string" ? o.name : "家具", bW = 2, bH = 1, bM = buildSimpleMask(bH, bW), rank = cr++; let placed = false;
    for (let t = 0; t < 80 && !placed; t++) {
      const sMinR = bbox.minR, sMaxR = sH ? hR : bbox.maxR, sMinC = bbox.minC, sMaxC = sV ? hC : bbox.maxC;
      const rR = sMaxR - sMinR - bH + 2, rC = sMaxC - sMinC - bW + 2; if (rR <= 0 || rC <= 0) break;
      const tR = sMinR + rng.intn(rR), tC = sMinC + rng.intn(rC); if (checkSym(bM, tR, tC, p.roomGrid, mA, mB) !== null) continue;
      const mmask = sH && sV ? flipH(flipV(bM)) : sH ? flipV(bM) : flipH(bM);
      const ma2 = mirrorA(tR, tC, bH, bW, bbox, sH, sV), onA = ma2.r === tR && ma2.c === tC;
      if (!onA && checkSym(mmask, ma2.r, ma2.c, p.roomGrid, mA, mB) !== null) continue;
      writeM(bM, tR, tC, rank, p.roomGrid, mA, mB); fi.push({ rank, name: nm, isGroup: false, direction: "square" });
      if (!onA) { const mR = cr++; writeM(mmask, ma2.r, ma2.c, mR, p.roomGrid, mA, mB); fi.push({ rank: mR, name: nm, isGroup: false, direction: "square" }); }
      placed = true;
    }
    if (!placed) { const cR2 = Math.floor((bbox.minR + bbox.maxR - bH + 1) / 2), cC2 = Math.floor((bbox.minC + bbox.maxC - bW + 1) / 2); if (checkSym(bM, cR2, cC2, p.roomGrid, mA, mB) === null) { writeM(bM, cR2, cC2, rank, p.roomGrid, mA, mB); fi.push({ rank, name: nm, isGroup: false, direction: "square" }); } }
  }
  if (sH && sV && p.mainList.length > 0) { const ci = p.mainList[p.mainList.length - 1] as Record<string, unknown>, cn = typeof ci.name === "string" ? ci.name : "中心", cm = buildSimpleMask(1, 1), cRow = Math.floor((bbox.minR + bbox.maxR) / 2), cCol = Math.floor((bbox.minC + bbox.maxC) / 2); if (checkSym(cm, cRow, cCol, p.roomGrid, mA, mB) === null) { const nr = cr++; writeM(cm, cRow, cCol, nr, p.roomGrid, mA, mB); fi.push({ rank: nr, name: cn, isGroup: false, direction: "square" }); } }
  for (const fillItem of p.fillList) {
    const o = fillItem as Record<string, unknown>, nm = typeof o.name === "string" ? o.name : "填充", fM = buildSimpleMask(1, 1);
    let placed = false;
    for (let fc = 0; fc < 200 && !placed; fc++) {
      const sMinR = bbox.minR, sMaxR = sH ? hR : bbox.maxR, sMinC = bbox.minC, sMaxC = sV ? hC : bbox.maxC;
      const rR = sMaxR - sMinR + 2, rC = sMaxC - sMinC + 2; if (rR <= 0 || rC <= 0) break;
      const tR = sMinR + rng.intn(rR), tC = sMinC + rng.intn(rC);
      if (checkSym(fM, tR, tC, p.roomGrid, mA, mB) !== null) continue;
      const fmm = sH && sV ? flipH(flipV(fM)) : sH ? flipV(fM) : flipH(fM), fma = mirrorA(tR, tC, 1, 1, bbox, sH, sV), onA = fma.r === tR && fma.c === tC;
      if (!onA && checkSym(fmm, fma.r, fma.c, p.roomGrid, mA, mB) !== null) continue;
      const fR = cr++; writeM(fM, tR, tC, fR, p.roomGrid, mA, mB); fi.push({ rank: fR, name: nm, isGroup: false, direction: "square" });
      if (!onA) { const fmR = cr++; writeM(fmm, fma.r, fma.c, fmR, p.roomGrid, mA, mB); fi.push({ rank: fmR, name: nm, isGroup: false, direction: "square" }); }
      placed = true;
    }
  }
  return furnitureNameCollapse({ list: fi, maskA: mA, type: "tile" });
}

// ═══════════════════════════════════════════════════════════════════════════
// one_open 模式
// ═══════════════════════════════════════════════════════════════════════════

function buildActiveGrid(rg: Grid, side: string, ratio: number): Grid {
  const rows = rg.length, cols = rg[0].length, bbox = getRoomBBox(rg); if (!bbox) return makeZeroGrid(rows, cols);
  const rH = bbox.maxR - bbox.minR + 1, rW = bbox.maxC - bbox.minC + 1, r = Math.min(0.9, Math.max(0.1, ratio));
  let oMinR = bbox.minR, oMaxR = bbox.maxR, oMinC = bbox.minC, oMaxC = bbox.maxC;
  if (side === "top") oMaxR = bbox.minR + Math.max(1, Math.round(rH * r)) - 1;
  else if (side === "bottom") oMinR = bbox.maxR - Math.max(1, Math.round(rH * r)) + 1;
  else if (side === "left") oMaxC = bbox.minC + Math.max(1, Math.round(rW * r)) - 1;
  else oMinC = bbox.maxC - Math.max(1, Math.round(rW * r)) + 1;
  const ag = makeZeroGrid(rows, cols);
  for (let row = 0; row < rows; row++) for (let c = 0; c < cols; c++) { if (!rg[row][c]) continue; if (!(row >= oMinR && row <= oMaxR && c >= oMinC && c <= oMaxC)) ag[row][c] = 1; }
  return ag;
}

function layoutOneOpenMode(p: { roomGrid: Grid; doorGrid: Grid; mainList: unknown[]; fillList: unknown[]; openSide: string; openRatio: number; placerSeed: number; fillerSeed: number }): Record<string, unknown> {
  const ir = roomMaskInit({ roomGrid: p.roomGrid, doorGrid: p.doorGrid }); if (ir.error) return ir;
  let mA = ir.maskA as Grid, mB = ir.maskB as Grid, fi: unknown[] = [];
  const ag = buildActiveGrid(p.roomGrid, p.openSide, p.openRatio);
  const pr = furniturePlacer({ roomGrid: ag, maskA: mA, maskB: mB, oldFurnitureIndex: fi, furnitureList: p.mainList, seed: p.placerSeed }); mA = (pr.newMaskA ?? mA) as Grid; mB = (pr.newMaskB ?? mB) as Grid; fi = (pr.furnitureIndex ?? fi) as unknown[];
  const fr = furnitureFiller({ roomGrid: ag, maskA: mA, maskB: mB, oldFurnitureIndex: fi, furnitureList: p.fillList, seed: p.fillerSeed }); mA = (fr.newMaskA ?? mA) as Grid; fi = (fr.furnitureIndex ?? fi) as unknown[];
  return furnitureNameCollapse({ list: fi, maskA: mA, type: "tile" });
}

// ═══════════════════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════════════════

export function roomLayoutPlacer(input: Record<string, unknown>): Record<string, unknown> {
  const roomGrid = input.roomGrid as Grid | undefined, doorGrid = input.doorGrid as Grid | undefined;
  const furnitureListRaw = (input.furnitureList as unknown[] | undefined) ?? [];
  const layoutMode = typeof input.layoutMode === "string" ? input.layoutMode : "grid";
  const seedRaw = typeof input.seed === "number" ? Math.floor(input.seed) : 0;
  const config = parseConfig(input.layoutConfig);
  if (!roomGrid || !Array.isArray(roomGrid) || !roomGrid.length) return { error: "roomGrid is required" };
  const rows = roomGrid.length, cols = roomGrid[0].length;
  const dg: Grid = (doorGrid && Array.isArray(doorGrid) && doorGrid.length === rows) ? doorGrid as Grid : makeZeroGrid(rows, cols);
  const { mainList, fillList } = splitFurnitureList(furnitureListRaw);
  const eSeed = seedRaw === 0 ? Date.now() % 0x7fffffff : seedRaw, pSeed = eSeed, fSeed = eSeed + 10;
  if (layoutMode === "symmetric") return layoutSymmetricMode({ roomGrid, doorGrid: dg, mainList, fillList, symmetryV: config.symmetryV !== false, symmetryH: config.symmetryH === true, seed: eSeed });
  if (layoutMode === "one_open") { const oS = typeof config.openSide === "string" && ["top", "bottom", "left", "right"].includes(config.openSide) ? config.openSide : "top"; const oR = typeof config.openRatio === "number" ? Math.min(0.9, Math.max(0.1, config.openRatio)) : 0.3; return layoutOneOpenMode({ roomGrid, doorGrid: dg, mainList, fillList, openSide: oS, openRatio: oR, placerSeed: pSeed, fillerSeed: fSeed }); }
  if (layoutMode === "nested") { const nzr = typeof config.nestedZoneRatio === "number" ? Math.min(0.7, Math.max(0.1, config.nestedZoneRatio)) : 0.4; const zfl = Array.isArray(config.zoneFurnitureList) ? config.zoneFurnitureList as unknown[] : furnitureListRaw; const { mainList: zm, fillList: zf } = splitFurnitureList(zfl); return layoutNestedMode({ roomGrid, doorGrid: dg, mainList, fillList, zoneMainList: zm, zoneFillList: zf, nestedZoneRatio: nzr, seed: eSeed }); }
  const gFN = typeof config.gridFurnitureName === "string" ? config.gridFurnitureName : "课桌";
  const gUW = typeof config.gridUnitW === "number" ? Math.max(1, Math.floor(config.gridUnitW)) : 2;
  const gUH = typeof config.gridUnitH === "number" ? Math.max(1, Math.floor(config.gridUnitH)) : 1;
  const tFN = typeof config.topFurnitureName === "string" ? config.topFurnitureName : "讲台";
  const tUW = typeof config.topUnitW === "number" ? Math.max(1, Math.floor(config.topUnitW)) : null;
  const tUH = typeof config.topUnitH === "number" ? Math.max(1, Math.floor(config.topUnitH)) : 1;
  return layoutGridMode({ roomGrid, doorGrid: dg, mainList, fillList, gridFurnitureName: gFN, gridUnitW: gUW, gridUnitH: gUH, topFurnitureName: tFN, topUnitW: tUW, topUnitH: tUH, placerSeed: pSeed, fillerSeed: fSeed });
}
