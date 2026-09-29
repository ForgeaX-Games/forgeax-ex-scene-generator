import type { SceneNode as AuthoringSceneNode } from '@forgeax/scene-authoring/scene-tree';
/** Persistent scene editing index. Names are labels, not reusable identity slots.
 * Edits return new snapshots; deletion removes the complete subtree from the new
 * snapshot. Existing snapshots and shared geometry remain untouched.
 */

import { PersistentStringMap } from './persistent-map.js';
import type { Transform } from './types.js';
import { reviveContentFromWire, type SceneNodeContent } from './content.js';

export type NodeId = string;

/** Graph 的根节点固定 id；不参与 childId 的 hash 空间（后者产出的是 16 位 hex）。 */
export const ROOT_ID: NodeId = 'root';

export type SceneNode = AuthoringSceneNode<SceneNodeContent, ReadonlyMap<string, NodeId>> & { readonly order: number };

export type SceneGraph = PersistentStringMap<SceneNode>;

/**
 * childId(parentId, name) —— 纯函数，无副作用，无全局状态。
 *
 * 用 FNV-1a（与 persistent-map.ts 的 hashString 同款非加密哈希，两个不同种子各
 * 出 32 bit 拼成 64 bit）而不是 node:crypto——这个模块的只读部分（getNode /
 * childrenOf / pathOf / reviveGraphFromWire 等）会被前端直接按源码引用（见
 * frontend/src/authoring/sceneStructureUtils.ts），一旦顶层出现 `node:crypto`
 * 这类 Node-only 内建模块，Vite/Rollup 打包浏览器 bundle 会直接失败。id 只需要
 * "确定性 + 抗碰撞"，不需要真正的密码学强度，64 bit 空间对现实场景规模的碰撞率
 * 已经远低于可观测阈值。
 */
function fnv1a(seed: number, s: string): number {
  let h = seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function childId(parentId: NodeId, name: string): NodeId {
  const key = `${parentId}\u0000${name}`;
  const h1 = fnv1a(0x811c9dc5, key).toString(16).padStart(8, '0');
  const h2 = fnv1a(0x9e3779b9, `${key}\u0001`).toString(16).padStart(8, '0');
  return h1 + h2;
}

/** Allocate within this snapshot, without global state or overwriting renamed nodes. */
function allocateId(graph: SceneGraph, parent: NodeId, key: string, next?:Map<string,number>): NodeId {
  const base=childId(parent,key)
  let occurrence=next?.get(base) ?? 0
  let id=occurrence ? childId(base,String(occurrence)) : base
  while(graph.get(id)) {occurrence++;id=childId(base,String(occurrence))}
  next?.set(base,occurrence+1)
  return id
}

export function emptyGraph(): SceneGraph {
  const root: SceneNode = {
    id: ROOT_ID,
    name: '',
    parent: null,
    children: new Map(),
    order: 0,
  };
  return PersistentStringMap.empty<SceneNode>().set(ROOT_ID, root);
}

export function getNode(graph: SceneGraph, id: NodeId): SceneNode | null {
  return graph.get(id) ?? null;
}

function requireNode(graph: SceneGraph, id: NodeId, op: string): SceneNode {
  const node = graph.get(id);
  if (!node) throw new Error(`SceneGraph.${op}: node does not exist: "${id}"`);
  return node;
}

/** 按 (order, id) 排序返回直接子节点（升序）；order 只在同一次 addChildren 调用内有意义， tie 按 id 兜底，全程无全局状态参与。 */
export function childrenOf(graph: SceneGraph, id: NodeId): SceneNode[] {
  const node = graph.get(id);
  if (!node) return [];
  const kids: SceneNode[] = [];
  for (const childId_ of node.children.values()) {
    const child = graph.get(childId_);
    if (child) kids.push(child);
  }
  kids.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return kids;
}

export interface ChildSpec {
  readonly name: string;
  readonly key?: string;
  readonly transform?: Transform;
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly content?: SceneNodeContent;
  readonly schema?: string;
  readonly bounds?: Readonly<{ width: number; height: number }>;
}

/**
 * 单次调用新建一个子节点，返回 { graph, id }。等价于 addChildren 的单子版本，
 * 但保留独立命名以匹配规格「9 个操作原语」的清单（见 batteries 迁移清单里
 * "createNode" 一行）。
 */
export function createNode(
  graph: SceneGraph,
  parentId: NodeId,
  name: string,
  opts?: { key?: string; transform?: Transform; attributes?: Readonly<Record<string, unknown>>; content?: SceneNodeContent },
): { graph: SceneGraph; id: NodeId } {
  const result = addChildren(graph, parentId, [{ name, ...opts }]);
  return { graph: result.graph, id: result.ids[0]! };
}

/**
 * 批量新增 N 个子节点：一次性重写 parent 一次（children map 拷贝一次 + N 次
 * insert），然后为每个 spec 各写一条新节点记录。O(F+N)，F = parent 现有子节点数——
 * 不是 add_child 旧实现里"循环 graftAt 逐项重建整棵祖先 spine"的 O(N²)。
 *
 * Duplicate sibling names or explicit keys are errors. Use a distinct label/key
 * or an explicit edit; creation never replaces existing descendants.
 */
export function addChildren(
  graph: SceneGraph,
  parentId: NodeId,
  specs: readonly ChildSpec[],
): { graph: SceneGraph; ids: NodeId[] } {
  const parent = requireNode(graph, parentId, 'addChildren');
  const nextChildren = new Map(parent.children);
  const ids: NodeId[] = [];
  let g = graph;
  // order 必须接着这个 parent 已有子节点的最大值往后排，不能每次调用都从 0 起——
  // 否则同一个 parent 被拆成多次 addChildren 调用（哪怕只是被其它无关分支的调用
  // 打断）时，各次调用产出的子节点会撞上同一批 order 值，(order,id) 排序的 tie
  // 只能退化到"看 id 字符串谁小"，与调用发生的真实先后顺序无关——见「purity /
  // independence regression」回归测试：这正是它要防的坍缩。O(F) 一次扫描
  // （F = parent 现有子节点数），不改变本函数原有的 O(F+N) 复杂度。
  let nextOrder = 0;
  for (const existingId of parent.children.values()) {
    const existing = graph.get(existingId);
    if (existing && existing.order >= nextOrder) nextOrder = existing.order + 1;
  }
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    if (nextChildren.has(spec.name)) throw new Error(`SceneGraph.addChildren: duplicate child name "${spec.name}"`);
    const id = spec.key === undefined ? allocateId(g, parentId, spec.name) : childId(parentId, spec.key);
    if (g.get(id)) throw new Error(`SceneGraph.addChildren: duplicate key "${spec.key}"`);
    const node: SceneNode = {
      id,
      name: spec.name,
      parent: parentId,
      children: new Map(),
      order: nextOrder + i,
      ...(spec.transform !== undefined ? { transform: spec.transform } : {}),
      ...(spec.attributes !== undefined ? { attributes: spec.attributes } : {}),
      ...(spec.content !== undefined ? { content: spec.content } : {}),
      ...(spec.schema !== undefined ? { schema: spec.schema } : {}),
      ...(spec.bounds !== undefined ? { bounds: spec.bounds } : {}),
    };
    nextChildren.set(spec.name, id);
    g = g.set(id, node);
    ids.push(id);
  }
  g = g.set(parentId, { ...parent, children: nextChildren });
  return { graph: g, ids };
}

/** Remove the entire subtree from this snapshot; old persistent snapshots remain valid. */
export function removeNode(graph: SceneGraph, id: NodeId): SceneGraph {
  if (id === ROOT_ID) throw new Error('SceneGraph.removeNode: cannot remove root');
  const node = requireNode(graph, id, 'removeNode');
  let g = graph;
  const pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    const descendant = requireNode(g, current, 'removeNode');
    pending.push(...descendant.children.values());
    g = g.delete(current);
  }
  if (node.parent !== null) {
    const parent = requireNode(g, node.parent, 'removeNode');
    const children = new Map(parent.children);
    children.delete(node.name);
    g = g.set(node.parent, { ...parent, children });
  }
  return g;
}

export function setTransform(graph: SceneGraph, id: NodeId, transform: Transform): SceneGraph {
  const node = requireNode(graph, id, 'setTransform');
  return graph.set(id, { ...node, transform: Object.freeze({ ...transform }) });
}

export function setAttribute(graph: SceneGraph, id: NodeId, key: string, value: unknown): SceneGraph {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('SceneGraph.setAttribute: attribute key must be a non-empty string');
  }
  const node = requireNode(graph, id, 'setAttribute');
  const nextAttrs = Object.freeze({ ...(node.attributes ?? {}), [key]: value });
  return graph.set(id, { ...node, attributes: nextAttrs });
}

export function getAttribute(graph: SceneGraph, id: NodeId, key: string): { value: unknown; exists: boolean } {
  if (typeof key !== 'string' || key.length === 0) return { value: undefined, exists: false };
  const node = graph.get(id);
  if (!node) return { value: undefined, exists: false };
  const attrs = node.attributes;
  if (!attrs || !Object.prototype.hasOwnProperty.call(attrs, key)) return { value: undefined, exists: false };
  return { value: attrs[key], exists: true };
}

/** 整体替换节点自身的体素内容；O(1) 摊销——引用替换，与 volume 内部大小无关。 */
export function setContent(graph: SceneGraph, id: NodeId, content: SceneNodeContent): SceneGraph {
  const node = requireNode(graph, id, 'setContent');
  return graph.set(id, { ...node, content });
}

export function setSchema(graph: SceneGraph, id: NodeId, schema: string): SceneGraph {
  const node = requireNode(graph, id, 'setSchema');
  return graph.set(id, { ...node, schema });
}

/** 见 SceneNode.bounds 字段注释：只有 bridge 层（grid2node/voxels2scene/json2voxels）在节点诞生时才需要写它。 */
export function setBounds(graph: SceneGraph, id: NodeId, bounds: Readonly<{ width: number; height: number }>): SceneGraph {
  const node = requireNode(graph, id, 'setBounds');
  return graph.set(id, { ...node, bounds });
}

/** 从旧 parent 摘下，挂到新 parent；只重写旧/新 parent 与节点本身三条记录。 */
export function moveNode(graph: SceneGraph, id: NodeId, newParentId: NodeId, newName?: string): SceneGraph {
  if (id === ROOT_ID) throw new Error('SceneGraph.moveNode: cannot move root');
  const node = requireNode(graph, id, 'moveNode');
  const newParent = requireNode(graph, newParentId, 'moveNode');
  const name = newName ?? node.name;
  for (let ancestor: SceneNode | undefined = newParent; ancestor; ancestor = ancestor.parent === null ? undefined : graph.get(ancestor.parent)) {
    if (ancestor.id === id) throw new Error('SceneGraph.moveNode: cannot parent a node to itself or its descendant');
  }
  const occupied = newParent.children.get(name);
  if (occupied !== undefined && occupied !== id) throw new Error(`SceneGraph.moveNode: duplicate child name "${name}"`);

  let g = graph;
  if (node.parent !== null) {
    const oldParent = requireNode(g, node.parent, 'moveNode');
    const oldChildren = new Map(oldParent.children);
    oldChildren.delete(node.name);
    g = g.set(node.parent, { ...oldParent, children: oldChildren });
  }
  const newChildren = new Map(g.get(newParentId)!.children);
  newChildren.set(name, id);
  g = g.set(newParentId, { ...g.get(newParentId)!, children: newChildren });
  g = g.set(id, { ...node, parent: newParentId, name });
  return g;
}

/**
 * 确保 rootId 下 segs 描述的路径存在，中间缺失的段自动创建为空容器节点（无 content）。
 * 用于 voxels2scene 之类"district/building"式嵌套命名——不是 9 个核心原语之一，
 * 而是 addChildren 的组合封装（多次单段 addChildren），公开出来给电池复用而不必
 * 各自重新实现"自动补中间节点"这段逻辑。
 */
export function ensurePath(graph: SceneGraph, rootId: NodeId, segs: readonly string[]): { graph: SceneGraph; id: NodeId } {
  let g = graph;
  let cur = rootId;
  for (const seg of segs) {
    const node = requireNode(g, cur, 'ensurePath');
    const existing = node.children.get(seg);
    if (existing && g.get(existing)) {
      cur = existing;
      continue;
    }
    const result = addChildren(g, cur, [{ name: seg }]);
    g = result.graph;
    cur = result.ids[0]!;
  }
  return { graph: g, id: cur };
}

export interface SubtreeSpec {
  readonly name: string
  readonly graph: SceneGraph
  readonly focus: NodeId
  readonly order?: number
}

/** Clone many subtrees with one parent-index copy; geometry remains shared. */
export function graftSubtrees(target: SceneGraph, parentId: NodeId, sources: readonly SubtreeSpec[]): {graph:SceneGraph;ids:NodeId[]} {
  const parent=requireNode(target,parentId,'graftSubtrees')
  const children=new Map(parent.children), ids:NodeId[]=[]
  let graph=target
  const next=new Map<string,number>()
  function clone(source:SceneGraph,sourceId:NodeId,parentId:NodeId,name:string,ancestors:Set<NodeId>):NodeId {
    if(ancestors.has(sourceId)) throw new Error('SceneGraph.graftSubtrees: source hierarchy contains a cycle')
    const node=requireNode(source,sourceId,'graftSubtrees'), id=allocateId(graph,parentId,node.id,next)
    const clonedChildren=new Map<string,NodeId>()
    graph=graph.set(id,{...node,id,parent:parentId,name,children:clonedChildren})
    ancestors.add(sourceId)
    for(const [childName,childId] of node.children) clonedChildren.set(childName,clone(source,childId,id,childName,ancestors))
    ancestors.delete(sourceId)
    return id
  }
  for(const source of sources) {
    if(children.has(source.name)) throw new Error(`SceneGraph.graftSubtrees: destination already has a child named "${source.name}"`)
    const id=clone(source.graph,source.focus,parentId,source.name,new Set())
    if(source.order!==undefined) graph=graph.set(id,{...graph.get(id)!,order:source.order})
    ids.push(id);children.set(source.name,id)
  }
  return {graph:graph.set(parentId,{...parent,children}),ids}
}

export function graftSubtree(target:SceneGraph,parent:NodeId,name:string,source:SceneGraph,focus:NodeId,opts?:{order?:number}):{graph:SceneGraph;id:NodeId} {
  const result=graftSubtrees(target,parent,[{name,graph:source,focus,order:opts?.order}])
  return {graph:result.graph,id:result.ids[0]!}
}

/** 人类可读路径 → NodeId；不存在返回 null（约定：非法/不存在的路径按空结果处理，不抛错）。 */
export function resolvePath(graph: SceneGraph, rootId: NodeId, pathStr: string): NodeId | null {
  const segs = splitPath(pathStr);
  let cur = rootId;
  for (const seg of segs) {
    const node = graph.get(cur);
    if (!node) return null;
    const next = node.children.get(seg);
    if (!next) return null;
    cur = next;
  }
  return graph.get(cur) ? cur : null;
}

/**
 * 把 graph 裁剪到只含 focus 节点自身 + 其全部后代——祖先与旁支（含它们各自的
 * content/attributes 等一切负载）不进入返回的新 graph，靠底层 GC 回收，不是
 * "标记但仍保留引用"。focus 节点在新 graph 里的 parent 被改写成 null（它成为
 * 这张裁剪后子图的本地根），但节点自身的 id/name/order/content 等一律不变——
 * 不走 graftSubtree 的"重新派生 id"路径，因为这里没有换挂载点，只是砍掉了看
 * 不到的那一侧。
 *
 * originPath：裁剪前 focus 在原 graph 里的绝对路径（'/' 代表原 graph 的根），
 * 只是一条记录用的字符串标签，不能拿它去在裁剪后的新 graph 上做任何解析——
 * 祖先节点已经不在新 graph 里了，resolvePath(new graph, ROOT_ID, originPath)
 * 只会失败。调用方（scene_prune_to_focus 电池）负责把它写进
 * ScenePortValue.focusOrigin，供展示/审计用。
 *
 * 复杂度 O(子树节点数)：只新建"id → node"这层索引的条目，节点对象本身（含
 * Volume/attributes 等大负载）按引用复用，不做深拷贝。
 */
export function pruneToFocus(graph: SceneGraph, focus: NodeId): { graph: SceneGraph; originPath: string | null } {
  requireNode(graph, focus, 'pruneToFocus');
  const originPath = pathOf(graph, focus);

  let g = PersistentStringMap.empty<SceneNode>();
  const stack: NodeId[] = [focus];
  const seen = new Set<NodeId>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = graph.get(id);
    if (!node) continue;
    g = g.set(id, id === focus && node.parent !== null ? { ...node, parent: null } : node);
    for (const childId_ of node.children.values()) stack.push(childId_);
  }
  return { graph: g, originPath };
}

/** NodeId → 人类可读路径（从 root 开始一路收集 name，不依赖任何"记住怎么来的"全局状态——纯粹沿 parent 链上溯）。 */
export function pathOf(graph: SceneGraph, id: NodeId): string | null {
  const segs: string[] = [];
  let cur: NodeId | null = id;
  while (cur !== null) {
    const node = graph.get(cur);
    if (!node) return null;
    if (node.parent === null) break;
    segs.unshift(node.name);
    cur = node.parent;
  }
  return segs.length === 0 ? '/' : '/' + segs.join('/');
}

export function splitPath(path: string): string[] {
  if (path === '/' || path === '') return [];
  if (!path.startsWith('/')) throw new Error(`SceneGraph: path must start with "/" (got "${path}")`);
  if (path.endsWith('/')) throw new Error(`SceneGraph: path must not end with "/" (got "${path}")`);
  const segs = path.slice(1).split('/');
  for (const s of segs) {
    if (!s) throw new Error(`SceneGraph: empty segment in path "${path}"`);
  }
  return segs;
}

/** 便捷构造：一个空场景 + 根节点 id。等价于旧 tree.ts 的 emptyTree()。 */
export function emptyScene(): { graph: SceneGraph; focus: NodeId } {
  return { graph: emptyGraph(), focus: ROOT_ID };
}

/**
 * 从 JSON 线上形态复原 SceneGraph。
 *
 * PersistentStringMap.toJSON()（见 persistent-map.ts）会在任何一次
 * JSON.stringify 时自动把图拍平成 { [id]: plainNode }，plainNode.children 从
 * Map 变成 { name: id } 的 plain object，plainNode.content 从 Volume 变成
 * WireVolume（dense.data: number[] / sparse.cells: plain object）。通用拍平
 * "回不去"——一个 plain object 曾经是 Map 还是本来就是 object 已经无法反推，
 * 所以复原必须由知道 SceneNode 字段语义的这一层显式做，不能指望通用反序列化。
 * 这是 ScenePortValue 跨 HTTP/JSON.parse 边界之后（例如前端读取 execute 的响应）
 * 仍能正确调用 getNode / childrenOf / cellCount 等的唯一原因。
 */
export function reviveGraphFromWire(raw: Record<string, unknown>): SceneGraph {
  let g = PersistentStringMap.empty<SceneNode>();
  for (const [id, value] of Object.entries(raw)) {
    const w = value as {
      id: NodeId;
      name: string;
      parent: NodeId | null;
      children: Record<string, NodeId>;
      order: number;
      transform?: Transform;
      attributes?: Readonly<Record<string, unknown>>;
      content?: unknown;
      schema?: string;
      bounds?: Readonly<{ width: number; height: number }>;
    };
    const node: SceneNode = {
      id: w.id,
      name: w.name,
      parent: w.parent,
      children: new Map(Object.entries(w.children ?? {})),
      order: w.order,
      ...(w.transform !== undefined ? { transform: w.transform } : {}),
      ...(w.attributes !== undefined ? { attributes: w.attributes } : {}),
      ...(w.content !== undefined ? { content: reviveContentFromWire(w.content) } : {}),
      ...(w.schema !== undefined ? { schema: w.schema } : {}),
      ...(w.bounds !== undefined ? { bounds: w.bounds } : {}),
    };
    g = g.set(id, node);
  }
  return g;
}

/** Duck-type check: is `value` a live PersistentStringMap-shaped graph (has real .get/.set)? */
export function isLiveSceneGraph(value: unknown): value is SceneGraph {
  if (!value || typeof value !== 'object') return false;
  const g = value as { get?: unknown; set?: unknown };
  return typeof g.get === 'function' && typeof g.set === 'function';
}
