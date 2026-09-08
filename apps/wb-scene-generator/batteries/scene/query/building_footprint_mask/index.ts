/**
 * building_footprint_mask — 从 focus 建筑 scene 节点提取占地掩码 grid。
 *
 * 输入 scene（focus 指向单栋建筑或其子树根），遍历该子树体素，输出裁剪到
 * 建筑实际包围盒的 0/1/2 grid：
 *   0 = 空
 *   1 = 占地（非门子树的体素列投影）
 *   2 = 门（door 子树体素，默认子节点名 outer_door）
 *
 * 输出尺寸是体素并集的最小包围盒，不使用节点 bounds 画布尺寸。
 */

import {
  childrenOf,
  getNode,
  iterCells,
  parseScenePort,
  type SceneGraph,
  type SceneNode,
} from '../../../../vendor/dist/shared/types/index.js';

const DEFAULT_DOOR_NAMES = ['outer_door'];

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function collectFootprint(
  graph: SceneGraph,
  node: SceneNode,
  doorNames: Set<string>,
  inDoorBranch: boolean,
  occupancy: Set<string>,
  doors: Set<string>,
  zFilter: number | null,
): void {
  const doorBranch = inDoorBranch || doorNames.has(node.name);

  if (node.content) {
    for (const c of iterCells(node.content)) {
      if (zFilter !== null && c.z !== zFilter) continue;
      const key = cellKey(c.x, c.y);
      if (doorBranch) doors.add(key);
      else occupancy.add(key);
    }
  }

  for (const child of childrenOf(graph, node.id)) {
    collectFootprint(graph, child, doorNames, doorBranch, occupancy, doors, zFilter);
  }
}

function parseDoorNames(raw: unknown): Set<string> {
  if (typeof raw === 'string' && raw.trim()) {
    return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  }
  if (Array.isArray(raw)) {
    const names = raw.filter((v) => typeof v === 'string' && v.trim()).map((v) => (v as string).trim());
    if (names.length > 0) return new Set(names);
  }
  return new Set(DEFAULT_DOOR_NAMES);
}

function bboxFromKeys(keys: Iterable<string>): { minR: number; maxR: number; minC: number; maxC: number } | null {
  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;

  for (const key of keys) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (y < minR) minR = y;
    if (y > maxR) maxR = y;
    if (x < minC) minC = x;
    if (x > maxC) maxC = x;
  }

  if (maxR === -Infinity) return null;
  return { minR, maxR, minC, maxC };
}

function makeZeroGrid(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

const EMPTY = {
  exists: false,
  grid: [] as number[][],
  width: 0,
  height: 0,
  cellCount: 0,
  doorCount: 0,
};

export function buildingFootprintMask(input: Record<string, unknown>): Record<string, unknown> {
  const port = parseScenePort(input.scene);
  if (!port) return { ...EMPTY, error: 'scene is required and must be a ScenePortValue' };

  const focusNode = getNode(port.graph, port.focus);
  if (focusNode === null) return { ...EMPTY, error: `focus path does not exist: "${port.focus}"` };

  const zRaw = input.z;
  const zFilter = zRaw === undefined || zRaw === null
    ? null
    : Number(zRaw);
  if (zFilter !== null && !Number.isFinite(zFilter)) {
    return { ...EMPTY, error: 'z must be a finite number when provided' };
  }

  const doorNames = parseDoorNames(input.doorNames);

  const occupancy = new Set<string>();
  const doors = new Set<string>();
  collectFootprint(port.graph, focusNode, doorNames, false, occupancy, doors, zFilter);

  const allKeys = new Set<string>([...occupancy, ...doors]);
  const bbox = bboxFromKeys(allKeys);
  if (!bbox) return EMPTY;

  const height = bbox.maxR - bbox.minR + 1;
  const width = bbox.maxC - bbox.minC + 1;
  const grid = makeZeroGrid(height, width);

  for (const key of occupancy) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    grid[y - bbox.minR]![x - bbox.minC] = 1;
  }

  let doorCount = 0;
  for (const key of doors) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    const r = y - bbox.minR;
    const c = x - bbox.minC;
    if (r < 0 || r >= height || c < 0 || c >= width) continue;
    grid[r]![c] = 2;
    doorCount += 1;
  }

  let cellCount = 0;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (grid[r]![c] !== 0) cellCount += 1;
    }
  }

  return {
    exists: true,
    grid,
    width,
    height,
    cellCount,
    doorCount,
    originX: bbox.minC,
    originY: bbox.minR,
  };
}
