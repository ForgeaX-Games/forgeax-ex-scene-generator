/**
 * voxels2scene — 由体素坐标列表构造 scene 树（单节点或多层子节点）。
 *
 * 模式：
 *   - nodes[]：按 JSON 分层描述，每个 node 一个子节点（推荐多层建筑）
 *   - groupBy=z|token：自动按 z 层或 token 分组
 *   - 默认：全部体素写入单个节点 name
 */

import {
  ROOT_ID,
  addChildren,
  emptyGraph,
  ensurePath,
  makeScenePort,
  resolvePath,
  setBounds,
  setContent,
  setSchema,
  volumeFromCells,
  type Cell,
  type NodeId,
  type SceneGraph,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';
import {
  computeBounds,
  normalizeNodePath,
  parseVoxelCell,
  type ParsedVoxelCell,
  type ParsedVoxelNode,
} from '../json2voxels/parse.ts';

type GroupBy = 'none' | 'z' | 'token';

interface Voxels2SceneResult {
  scene?: ScenePortValue;
  voxelCount: number;
  nodeCount: number;
  error?: string;
}

function sanitizeName(raw: unknown, fallback: string): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return fallback;
  if (name.includes('/')) return fallback;
  return name;
}

function parseVoxelList(raw: unknown, defaultToken: string): ParsedVoxelCell[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedVoxelCell[] = [];
  for (const item of raw) {
    const cell = parseVoxelCell(item, defaultToken);
    if (cell) out.push(cell);
  }
  return out;
}

function parseTokenList(raw: unknown, count: number, defaultToken: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return new Array(count).fill(defaultToken);
  }
  return Array.from({ length: count }, (_, i) => {
    const t = raw[i];
    return typeof t === 'string' && t.trim() ? t.trim() : defaultToken;
  });
}

function attachTokens(cells: ParsedVoxelCell[], tokens: string[], defaultToken: string): Cell[] {
  return cells.map((c, i) => ({
    x: c.x,
    y: c.y,
    z: c.z,
    token: tokens[i] ?? c.token ?? defaultToken,
  }));
}

/** 在 rootId 下按 relPath（可能是嵌套的 "district/building"）落一个携带内容的节点。relPath 已存在则报错（对照旧 upsertCells 遇到已存在路径直接覆盖——这里保持旧 buildSceneFromNodes 的"重复即报错"行为，不是新引入的限制）。 */
function upsertContentNode(
  graph: SceneGraph,
  rootId: NodeId,
  relPath: string,
  schema: string,
  cells: readonly Cell[],
): { graph: SceneGraph; id: NodeId } | { error: string } {
  const segs = relPath.split('/').filter(Boolean);
  if (resolvePath(graph, rootId, `/${segs.join('/')}`) !== null) {
    return { error: `duplicate node name "${relPath}"` };
  }
  const { graph: g1, id } = ensurePath(graph, rootId, segs);
  let g = setContent(g1, id, volumeFromCells(cells));
  g = setSchema(g, id, schema);
  g = setBounds(g, id, computeBounds(cells));
  return { graph: g, id };
}

function buildSceneFromNodes(
  nodeSpecs: ParsedVoxelNode[],
  rootName: string,
  schema: string,
  defaultToken: string,
  tokens?: string[],
): Voxels2SceneResult {
  if (nodeSpecs.length === 0) {
    return { voxelCount: 0, nodeCount: 0, error: 'no voxels to write' };
  }

  let graph: SceneGraph = addChildren(emptyGraph(), ROOT_ID, [{ name: rootName }]).graph;
  const rootId: NodeId = resolvePath(graph, ROOT_ID, `/${rootName}`)!;
  let total = 0;

  if (nodeSpecs.length === 1 && nodeSpecs[0]!.name === rootName) {
    const only = nodeSpecs[0]!;
    const voxelCells = attachTokens(only.cells, tokens ?? only.cells.map((c) => c.token), defaultToken);
    total = voxelCells.length;
    graph = setContent(graph, rootId, volumeFromCells(voxelCells));
    graph = setSchema(graph, rootId, schema);
    graph = setBounds(graph, rootId, computeBounds(voxelCells));
    return {
      scene: makeScenePort(graph, rootId),
      voxelCount: total,
      nodeCount: 1,
    };
  }

  for (const spec of nodeSpecs) {
    const voxelCells = attachTokens(spec.cells, spec.cells.map((c) => c.token), defaultToken);
    const result = upsertContentNode(graph, rootId, spec.name, schema, voxelCells);
    if ('error' in result) {
      return { voxelCount: 0, nodeCount: 0, error: result.error };
    }
    graph = result.graph;
    total += voxelCells.length;
  }

  return {
    scene: makeScenePort(graph, rootId),
    voxelCount: total,
    nodeCount: nodeSpecs.length,
  };
}

function parseNodesInput(raw: unknown, defaultToken: string): ParsedVoxelNode[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedVoxelNode[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    // Allow nested "district/building" names to build a hierarchical tree.
    const name = normalizeNodePath(rec.name);
    if (!name) continue;
    const cells = parseVoxelList(rec.cells ?? rec.voxels, defaultToken);
    if (cells.length === 0) continue;
    out.push({ name, cells });
  }
  return out;
}

function groupCells(
  cells: ParsedVoxelCell[],
  tokens: string[],
  groupBy: GroupBy,
): ParsedVoxelNode[] {
  if (groupBy === 'none') {
    return [{ name: 'Voxels', cells }];
  }

  const buckets = new Map<string, ParsedVoxelCell[]>();
  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i]!;
    const key = groupBy === 'z' ? `z${c.z}` : (tokens[i] ?? c.token ?? 'cell');
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, bucketCells]) => ({ name, cells: bucketCells }));
}

export function voxels2Scene(input: Record<string, unknown>): Voxels2SceneResult {
  const schema = typeof input.schema === 'string' && input.schema.trim()
    ? input.schema.trim()
    : 'voxel-mass';
  const defaultToken = typeof input.token === 'string' && input.token.trim()
    ? input.token.trim()
    : 'cell';
  const rootName = sanitizeName(input.root ?? input.name, 'Voxels');

  const structuredNodes = parseNodesInput(input.nodes, defaultToken);
  if (structuredNodes.length > 0) {
    return buildSceneFromNodes(structuredNodes, rootName, schema, defaultToken);
  }

  const cells = parseVoxelList(input.voxels, defaultToken);
  if (cells.length === 0) {
    return { voxelCount: 0, nodeCount: 0, error: 'voxels is required and must be a non-empty list' };
  }

  const tokens = parseTokenList(input.tokens, cells.length, defaultToken);
  const groupByRaw = typeof input.groupBy === 'string' ? input.groupBy.trim().toLowerCase() : 'none';
  const groupBy: GroupBy = groupByRaw === 'z' || groupByRaw === 'token' ? groupByRaw : 'none';

  const nodeSpecs = groupBy === 'none'
    ? [{ name: rootName, cells }]
    : groupCells(cells, tokens, groupBy).map((n) => ({
      ...n,
      name: groupBy === 'z' ? n.name : n.name,
    }));

  if (groupBy === 'none') {
    return buildSceneFromNodes(nodeSpecs, rootName, schema, defaultToken, tokens);
  }

  return buildSceneFromNodes(nodeSpecs, rootName, schema, defaultToken);
}

export default voxels2Scene;
