/**
 * grid2node — 由 2D grid 构造一个携带体素的独立场景节点，返回单节点 scene。
 *
 * 不接受 scene 输入；输出 emptyScene() 的根下挂一个 名为 <name> 的子节点，
 * focus 指向该子节点。多个 grid2node 输出再经 add_child 挂到父节点下，即可
 * 构成完整 scene 树；该节点本身既可当父也可当子。
 *
 * autoIterate 下，name / grid 的列表会被分别迭代，每轮产出一个独立 ScenePortValue；
 * scene 输出无同名 scene 输入，dispatcher 把每轮 scene 收成 list（rank 1）——可直接喂 add_child.nodes。
 */

import {
  ROOT_ID,
  addChildren,
  emptyScene,
  makeScenePort,
  volumeFromCells,
  voxelContent,
  type Cell,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';

interface Grid2NodeResult {
  scene?: ScenePortValue;
  voxelCount: number;
  error?: string;
}

export function grid2Node(input: Record<string, unknown>): Grid2NodeResult {
  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  if (!rawName) return { voxelCount: 0, error: 'name is required' };
  if (rawName.includes('/')) return { voxelCount: 0, error: "name must not contain '/'" };

  const grid = input.grid;
  if (!Array.isArray(grid) || grid.length === 0) {
    return { voxelCount: 0, error: 'grid is required and non-empty' };
  }

  const schema = typeof input.schema === 'string' && input.schema.trim()
    ? input.schema.trim()
    : 'voxel-mass';
  const token = typeof input.token === 'string' && input.token
    ? input.token
    : 'cell';

  // Elevation tiers (MountainContour): optional `z` = layer index. When set,
  // fill a solid column [0..z]. Mutually exclusive contour partitions must use
  // this — leaving zRange at the default [0] puts every tier on the ground plane.
  // `z` wins over a default/unwired zRange; an explicitly longer zRange (e.g.
  // PlaceOne building height [0..H]) should leave `z` unwired.
  const zTopRaw = input.z ?? input.zBase ?? input.zLevel;
  const zTop = typeof zTopRaw === 'number' ? zTopRaw : Number(zTopRaw);
  let zRange: number[];
  if (Number.isFinite(zTop)) {
    const top = Math.max(0, Math.round(zTop));
    zRange = Array.from({ length: top + 1 }, (_, i) => i);
  } else {
    const rawZRange = Array.isArray(input.zRange) ? input.zRange : [input.zRange ?? 0];
    zRange = rawZRange
      .map((v: unknown) => Number(v))
      .filter((v: number) => Number.isFinite(v));
  }
  if (zRange.length === 0) {
    return { voxelCount: 0, error: 'zRange must contain at least one finite number' };
  }

  // Per-cell tag channel: a parallel grid whose non-zero value indexes
  // `stateValues` and lands on `cell.state[stateKey]`. Autotile rules read it
  // via `face.variants[].when.stateEquals` for distinctions the neighbourhood
  // key cannot express (bridge_25's entry-strip orientation, slope_24's
  // slopeDir). Unwired → cells carry no state, exactly as before.
  const stateKey = typeof input.stateKey === 'string' && input.stateKey.trim()
    ? input.stateKey.trim()
    : 'tag';
  const stateGrid = Array.isArray(input.stateGrid) ? input.stateGrid : null;
  const stateValues = Array.isArray(input.stateValues)
    ? input.stateValues.map((v: unknown) => String(v))
    : [];
  const tagAt = (x: number, y: number): string | null => {
    if (!stateGrid) return null;
    const row = stateGrid[y];
    if (!Array.isArray(row)) return null;
    const raw = row[x];
    const v = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(v) || v === 0) return null;
    const mapped = stateValues[v];
    const label = mapped !== undefined && mapped !== '' ? mapped : String(v);
    return label;
  };

  const cells: Cell[] = [];
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    if (!Array.isArray(row)) continue;
    for (let x = 0; x < row.length; x++) {
      const v = row[x];
      if (typeof v === 'number' && v !== 0) {
        const tag = tagAt(x, y);
        for (const z of zRange) {
          cells.push(tag === null ? { x, y, z, token } : { x, y, z, token, state: { [stateKey]: tag } });
        }
      }
    }
  }

  // bounds 来自输入 grid 的尺寸；即使该 grid 内部没有非零 cell，下游仍能知道画布大小。
  const height = grid.length;
  const width = Array.isArray(grid[0]) ? (grid[0] as unknown[]).length : 0;

  const { graph, ids } = addChildren(emptyScene().graph, ROOT_ID, [
    { name: rawName, schema, bounds: { width, height }, content: voxelContent(volumeFromCells(cells)) },
  ]);

  return {
    scene: makeScenePort(graph, ids[0]!),
    voxelCount: cells.length,
  };
}
