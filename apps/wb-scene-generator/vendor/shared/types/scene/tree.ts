/**
 * SceneTree 纯函数实现：immutable 嵌套树 + 路径复制（path copying）。
 *
 * 设计要点：
 *   - 树对外完全 immutable，每次 mutation 返回新根；只复制从根到改动点的路径上的节点，
 *     未触及的兄弟子树通过引用共享（结构共享，省内存且支持快照-版本对比）。
 *   - 每次成功 mutation 调用方需提供 newVersion（外部维持单调递增）；
 *     被复制重建的节点带上新版本号，未触子树保留旧版本号
 *     → 子树级别的"内容相等 ↔ 版本相等"。
 *   - 节点统一形态：任何节点都可同时携带 cells（自身体素）与 children（子节点）。
 */

import type {
  SceneNodeSnapshot,
  Transform,
  VoxelCell,
} from './types.js';

/**
 * 节点形态别名（不导出，外部通过 SceneNodeSnapshot 别名访问）。
 */
type SceneNode = SceneNodeSnapshot;

/** 校验 + 拆分路径："/Houses/House01" → ["Houses", "House01"]；"/" → []。 */
export function splitPath(path: string): string[] {
  if (path === '/' || path === '') return [];
  if (!path.startsWith('/')) {
    throw new Error(`SceneTree: path must start with "/" (got "${path}")`);
  }
  if (path.endsWith('/')) {
    throw new Error(`SceneTree: path must not end with "/" (got "${path}")`);
  }
  const segs = path.slice(1).split('/');
  for (const s of segs) {
    if (!s) throw new Error(`SceneTree: empty segment in path "${path}"`);
  }
  return segs;
}

/** 段名拼接成路径。 */
function joinPath(segments: readonly string[]): string {
  return segments.length === 0 ? '/' : '/' + segments.join('/');
}

/** 二分查找按 name 字典序排序的 children 中 name 的下标；找不到返回 -1。 */
function findChildIdx(children: readonly SceneNode[], name: string): number {
  let lo = 0;
  let hi = children.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const cmp = children[mid]!.name.localeCompare(name);
    if (cmp === 0) return mid;
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** 把 child 插入 children 数组，保持 name 字典序；返回新数组。 */
function insertChildSorted(
  children: readonly SceneNode[],
  child: SceneNode,
): readonly SceneNode[] {
  if (children.length === 0) return Object.freeze([child]);
  let lo = 0;
  let hi = children.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (children[mid]!.name.localeCompare(child.name) < 0) lo = mid + 1;
    else hi = mid;
  }
  const next = [...children.slice(0, lo), child, ...children.slice(lo)];
  return Object.freeze(next);
}

/** 替换 children[idx] 为新 child（数组保持字典序，因为 name 不变）。 */
function replaceChildAt(
  children: readonly SceneNode[],
  idx: number,
  child: SceneNode,
): readonly SceneNode[] {
  const next = [...children.slice(0, idx), child, ...children.slice(idx + 1)];
  return Object.freeze(next);
}

/** 创建空节点（无 cells，children=[]）。 */
function makeNode(name: string, path: string, version: number): SceneNode {
  return Object.freeze({
    name,
    path,
    version,
    children: Object.freeze([] as SceneNode[]),
  }) as SceneNode;
}

// ── 公共 API ──────────────────────────────────────────────────────────────

/** 构造一个空 SceneTree。版本从 0 开始，第一次 mutation 进入版本 1。 */
export function emptyTree(): SceneNode {
  return makeNode('', '/', 0);
}

/** 读取 path 处的子树快照；不存在返回 null。 */
export function readNode(root: SceneNode, path: string): SceneNode | null {
  const segs = splitPath(path);
  let cur: SceneNode = root;
  for (const seg of segs) {
    const idx = findChildIdx(cur.children, seg);
    if (idx < 0) return null;
    cur = cur.children[idx]!;
  }
  return cur;
}

/** 列出 path 下的直接子节点 name；path 不存在返回 []。 */
export function listChildren(root: SceneNode, path: string): string[] {
  const node = readNode(root, path);
  if (!node) return [];
  return node.children.map(c => c.name);
}

/**
 * 内部递归：在 segs 路径上执行 mutator（应用于路径终点节点），从叶向根复制路径。
 * mutator 必须返回非 null 节点；中间不存在的节点按需创建为空节点。
 */
function rewriteAtPath(
  node: SceneNode,
  segs: readonly string[],
  segIdx: number,
  newVersion: number,
  mutator: (current: SceneNode | null, path: string) => SceneNode,
): SceneNode {
  if (segIdx === segs.length) {
    return mutator(node, node.path);
  }

  const children = node.children;
  const seg = segs[segIdx]!;
  const childIdx = findChildIdx(children, seg);

  let nextChildren: readonly SceneNode[];
  if (childIdx >= 0) {
    const child = children[childIdx]!;
    const newChild = rewriteAtPath(child, segs, segIdx + 1, newVersion, mutator);
    if (newChild === child) return node; // 子树未变 → 复用当前节点
    nextChildren = replaceChildAt(children, childIdx, newChild);
  } else {
    const placeholderPath = joinPath(segs.slice(0, segIdx + 1));
    const placeholder = makeNode(seg, placeholderPath, newVersion);
    const newChild = rewriteAtPath(placeholder, segs, segIdx + 1, newVersion, mutator);
    nextChildren = insertChildSorted(children, newChild);
  }

  return Object.freeze({
    ...node,
    version: newVersion,
    children: nextChildren,
  }) as SceneNode;
}

/**
 * 写入 / 替换 path 处节点的 cells 与 schema，返回新树。
 * 路径中间不存在的节点自动创建。已有 children / transform / attributes 全部保留。
 * 不能在 path = "/" 处直接写（保留根节点不可携带 cells 的语义；如确需可用其他 mutation）。
 */
export function upsertCells(
  root: SceneNode,
  path: string,
  data: { schema: string; cells: readonly VoxelCell[]; bounds?: { width: number; height: number } },
  newVersion: number,
): SceneNode {
  const segs = splitPath(path);
  if (segs.length === 0) {
    throw new Error('SceneTree: cannot upsertCells at root "/"');
  }
  const frozenCells = Object.freeze(data.cells.map(c => Object.freeze({ ...c })));
  const frozenBounds = data.bounds !== undefined
    ? Object.freeze({ width: data.bounds.width, height: data.bounds.height })
    : undefined;
  return rewriteAtPath(root, segs, 0, newVersion, (current, p) => {
    // 终点节点可能存在（保留 children/transform/attributes/bounds）也可能是中间补建的占位节点
    if (current) {
      return Object.freeze({
        ...current,
        path: p,
        version: newVersion,
        schema: data.schema,
        cells: frozenCells,
        ...(frozenBounds !== undefined ? { bounds: frozenBounds } : {}),
      }) as SceneNode;
    }
    return Object.freeze({
      name: segs[segs.length - 1]!,
      path: p,
      version: newVersion,
      schema: data.schema,
      cells: frozenCells,
      children: Object.freeze([] as SceneNode[]),
      ...(frozenBounds !== undefined ? { bounds: frozenBounds } : {}),
    }) as SceneNode;
  });
}

/** 设置 path 节点的 transform；path 必须存在；不能是根节点。 */
export function setTransform(
  root: SceneNode,
  path: string,
  transform: Transform,
  newVersion: number,
): SceneNode {
  const segs = splitPath(path);
  if (segs.length === 0) {
    throw new Error('SceneTree: cannot setTransform on root "/"');
  }
  if (readNode(root, path) === null) {
    throw new Error(`SceneTree: setTransform target does not exist: "${path}"`);
  }
  const frozenT: Transform = Object.freeze({ ...transform }) as Transform;
  return rewriteAtPath(root, segs, 0, newVersion, (current) => {
    return Object.freeze({ ...current!, transform: frozenT, version: newVersion }) as SceneNode;
  });
}

/**
 * 在 path 节点的 attributes 上写入 (key, value)；path 必须存在（含根节点）。
 * 同 key 直接覆盖；其他 key 通过 spread 保留。整张 attributes record 在写入处冻结。
 */
export function setAttribute(
  root: SceneNode,
  path: string,
  key: string,
  value: unknown,
  newVersion: number,
): SceneNode {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('SceneTree: attribute key must be a non-empty string');
  }
  if (readNode(root, path) === null) {
    throw new Error(`SceneTree: setAttribute target does not exist: "${path}"`);
  }
  const segs = splitPath(path);
  return rewriteAtPath(root, segs, 0, newVersion, (current) => {
    const nextAttrs = Object.freeze({
      ...(current!.attributes ?? {}),
      [key]: value,
    }) as Readonly<Record<string, unknown>>;
    return Object.freeze({
      ...current!,
      attributes: nextAttrs,
      version: newVersion,
    }) as SceneNode;
  });
}

/** 读 path 节点 attributes[key]；节点缺失 / 无 attributes / key 未命中均返回 exists=false。 */
export function getAttribute(
  root: SceneNode,
  path: string,
  key: string,
): { value: unknown; exists: boolean } {
  if (typeof key !== 'string' || key.length === 0) {
    return { value: undefined, exists: false };
  }
  const node = readNode(root, path);
  if (node === null) return { value: undefined, exists: false };
  const attrs = node.attributes;
  if (!attrs || !Object.prototype.hasOwnProperty.call(attrs, key)) {
    return { value: undefined, exists: false };
  }
  return { value: attrs[key], exists: true };
}

/**
 * 深克隆 source 子树作为 destPath 处的新节点：所有节点的 path/name 重新计算，
 * 版本统一打成 newVersion；cells 直接共享（已 freeze）。
 */
function recloneSubtree(
  src: SceneNodeSnapshot,
  newName: string,
  newPath: string,
  newVersion: number,
): SceneNode {
  const children = Object.freeze(
    src.children.map(c =>
      recloneSubtree(c, c.name, `${newPath}/${c.name}`, newVersion),
    ),
  );
  return Object.freeze({
    name: newName,
    path: newPath,
    version: newVersion,
    ...(src.schema !== undefined ? { schema: src.schema } : {}),
    ...(src.transform !== undefined ? { transform: src.transform } : {}),
    ...(src.attributes !== undefined ? { attributes: src.attributes } : {}),
    ...(src.cells !== undefined ? { cells: src.cells } : {}),
    ...(src.bounds !== undefined ? { bounds: src.bounds } : {}),
    children,
  }) as SceneNode;
}

/**
 * 在 destPath 处插入 source 子树（克隆并重写 path/name/version），返回新树。
 *
 * 约束：
 *   - destPath ≠ "/"（不能整树替换）
 *   - destPath 必须不存在（否则报错；显式冲突而非静默覆盖）
 *   - destPath 的父节点缺失时自动创建中间空节点
 */
export function graftAt(
  root: SceneNode,
  destPath: string,
  source: SceneNodeSnapshot,
  newVersion: number,
): SceneNode {
  const segs = splitPath(destPath);
  if (segs.length === 0) {
    throw new Error('SceneTree: cannot graft at root "/"');
  }
  if (readNode(root, destPath) !== null) {
    throw new Error(`SceneTree: graft destination already exists: "${destPath}"`);
  }
  const lastName = segs[segs.length - 1]!;
  return rewriteAtPath(root, segs, 0, newVersion, (_current, p) => {
    return recloneSubtree(source, lastName, p, newVersion);
  });
}

/**
 * 在 destPath 处插入或覆盖 source 子树（克隆并重写 path/name/version），返回新树。
 *
 * 与 graftAt 的区别：destPath 已存在时**直接整体替换**，而非报错。
 * 用于场景合并（scene_merge_subtrees）：每个 branch 在自己 focus 下展开了不同子树，
 * 收束时把各自的 focus 子树写入 master，会有"覆盖既有空节点"的合法场景。
 *
 * 约束：destPath ≠ "/"；中间路径缺失时自动创建空占位节点。
 */
export function upsertSubtree(
  root: SceneNode,
  destPath: string,
  source: SceneNodeSnapshot,
  newVersion: number,
): SceneNode {
  const segs = splitPath(destPath);
  if (segs.length === 0) {
    throw new Error('SceneTree: cannot upsertSubtree at root "/"');
  }
  const lastName = segs[segs.length - 1]!;
  return rewriteAtPath(root, segs, 0, newVersion, (_current, p) => {
    return recloneSubtree(source, lastName, p, newVersion);
  });
}
