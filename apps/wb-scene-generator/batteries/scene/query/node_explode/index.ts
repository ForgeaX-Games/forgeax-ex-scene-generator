/**
 * node_explode — 展开 focus 节点的全部属性。
 *
 * 元信息（exists/schema/version/voxelCount/childCount）+
 * 节点自身体素列表（voxels:Point3D[], tokens:string[]）+
 * 直接子节点的绝对路径列表（childPaths:string[]）。
 *
 * 节点扁平化后任意节点都可既有 content 又有 children，因此 voxels/childPaths 同时存在并不互斥。
 *
 * 纯只读，不输出 scene。
 *
 * version：v3 去掉了"修订号"字段（见 graph.ts 顶部注释——子树是否变化直接靠引用
 * 相等判断，不需要专门字段）。这里保留 version 输出端口的形状（下游/UI 可能还在
 * 读这个字段名），但恒为 0——不编造一个新的、语义不对齐的替代值。
 */

import {
  childrenOf,
  getNode,
  iterCells,
  makePoint2D,
  makePoint3D,
  parseScenePort,
  pathOf,
} from '../../../../vendor/dist/shared/types/index.js';

const EMPTY = {
  exists: false,
  schema: '',
  version: 0,
  voxelCount: 0,
  childCount: 0,
  width: 0,
  height: 0,
  voxels: [],
  tokens: [],
  '2dPoints': [],
  childPaths: [],
};

export function nodeExplode(input: Record<string, unknown>): Record<string, unknown> {
  const sin = parseScenePort(input.scene);
  if (!sin) return EMPTY;

  const node = getNode(sin.graph, sin.focus);
  if (node === null) return EMPTY;

  const cells = node.content ? [...iterCells(node.content)] : [];
  const voxels = cells.map(c => makePoint3D(c.x, c.y, c.z));
  const tokens = cells.map(c => c.token);

  // 2D 投影：丢弃 z，按 (x,y) 去重得到节点体素的平面足迹点集。
  const seen2D = new Set<string>();
  const points2D = [];
  for (const c of cells) {
    const key = `${c.x},${c.y}`;
    if (seen2D.has(key)) continue;
    seen2D.add(key);
    points2D.push(makePoint2D(c.x, c.y));
  }

  const kids = childrenOf(sin.graph, node.id);
  const selfPath = pathOf(sin.graph, node.id) ?? '/';
  const childPaths = kids.map(c => selfPath === '/' ? `/${c.name}` : `${selfPath}/${c.name}`);

  return {
    exists: true,
    schema: node.schema ?? '',
    version: 0,
    voxelCount: cells.length,
    childCount: childPaths.length,
    width: node.bounds?.width ?? 0,
    height: node.bounds?.height ?? 0,
    voxels,
    tokens,
    '2dPoints': points2D,
    childPaths,
  };
}
