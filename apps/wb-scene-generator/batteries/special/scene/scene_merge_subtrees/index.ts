/**
 * scene_merge_subtrees — 把多个 scene（每个在不同 focus 下展开了子树）合并成一个 master scene。
 *
 * 输入：scenes (access:list) — 一组 ScenePortValue，每个的 focus 子树是该 branch 独立展开的结果
 * 输出：scene (access:item) — 把每个 scene 在自己 focus 位置下的子树深合并进 master，输出 focus 固定为根节点
 *
 * v3 与旧 tree.ts 版本的关键差异（这是让本电池变简单、不是变复杂的那部分）：
 * 旧模型按 path 寻址，两个 branch 就算共享同一段祖先，也得靠字符串路径比较才知道
 * "这是同一个位置"。新模型 NodeId = hash(parentId, name) 是纯函数——只要两个 branch
 * 由同一个 scene_focus_children fanout 产生（共享同一棵 base，只是 focus 不同），
 * base 部分的每个节点在两个 branch 的 graph 里天然算出同一个 id。合并不再需要
 * "先落 focus 节点壳、按路径逐层下钻"，直接按 id 做"master 有没有这个 id"的
 * map-union 即可：
 *   - master 没有这个 id → 这是某个 branch 新增的内容，整棵搬入（逐节点递归搬，
 *     不是一次性整块拷贝——这样子树内部任何位置的"同名冲突"也会被同一套逻辑捕获，
 *     不止是顶层）。搬入时 order 接着 master 里对应 parent 现有子节点的最大值往后
 *     排（同 add_child 的理由：避免多个新增子节点的 order 撞车）。
 *   - master 已经有这个 id → 只补 master 缺失的标量字段（content/schema/transform/
 *     bounds/attributes 逐 key），绝不覆盖已有内容（"同名冲突保留先到者"），
 *     再递归深合并其子节点（后代仍可能有新增）。
 *
 * ensureAnchored 处理的是防御性边界情况：万一某个 branch 的 focus 本身在 master 里
 * 还没出现（例如 base 之外的位置），沿 source 的 parent 链一路上溯补齐——对照旧
 * tree.ts 路径寻址下 upsertSubtree 自动补中间段的效果。文档化的正常调用场景下
 * （focus 都来自同一次 scene_focus_children fanout）这一步基本是 no-op。
 *
 * 已知局限（继承自旧实现，非本次引入）：多个 branch 处理顺序 = scenes[] 数组顺序，
 * 决定了"先到者"是谁；不依赖任何全局状态，只依赖调用方传入的数组顺序。
 *
 * 对 scene_prune_to_focus 裁剪过的输入的处理：裁剪会把本地根的 parent 强改成
 * null，这条信息真的丢了——ensureAnchored 沿 parent 链往上爬，爬到这样一个
 * "parent:null 但不是 ROOT_ID"的节点时，唯一能用的只有 focusOrigin（裁剪前
 * 记录的一串名字，不含任何祖先的 content/attributes/兄弟节点——那些是真的丢了，
 * 也不该、不能凭空找回来）。用这串名字里除最后一段外的前缀去 ensurePath：
 * master 里如果已经有同名节点（比如同一次 merge 里另一个没被裁剪的 branch 带来
 * 的真实数据）就用那个真的；没有就地补一个同名空节点——"空节点占位，输入没给
 * 的东西一律不脑补"，就是这么简单，不比 add_child/ensurePath 本身复杂。
 */

import {
  ROOT_ID,
  ensurePath,
  getNode,
  parseScenePort,
  splitPath,
  type NodeId,
  type SceneGraph,
  type SceneNode,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';

interface Result {
  scene?: ScenePortValue;
  mergedCount?: number;
  error?: string;
}

const DBG = process.env.MERGE_SUBTREES_DEBUG === '1';
const dbg = (...a: unknown[]) => { if (DBG) console.log('[merge_subtrees]', ...a); };

/** emptyGraph() 造的根节点等价物，只在 master 自己也没有真根时用一次（见下）。 */
const BLANK_ROOT: SceneNode = { id: ROOT_ID, name: '', parent: null, children: new Map(), order: 0 };

/** 把 master 缺失的祖先链条从 id 往上一路补齐到已存在的祖先（或它自己没有 parent）为止。 */
function ensureAnchored(master: SceneGraph, source: SceneGraph, id: NodeId, focusOrigin: string | undefined): SceneGraph {
  const src = source.get(id);
  if (!src) throw new Error(`scene_merge_subtrees: node not found in its own graph: "${id}"`);

  if (src.parent === null) {
    if (id === ROOT_ID) return master.get(id) ? master : master.set(id, src);

    // 被 scene_prune_to_focus 裁剪过的本地根：真正的 parent 已经不在 source 里了
    // （不是不知道，是真丢了）。注意不能直接 `if (master.get(id)) return master`
    // 短路——当 master 本身就是这张被裁剪过的图时（scenes[0] 就是 prunedA），
    // master.get(id) 恒为真，但它带的 parent 仍然是错的 null，必须继续往下修。
    // 只有当 master 里已经有一份"parent 不是 null"的真实版本（比如另一个没被
    // 裁剪的 branch 带来的）时，才说明已经被修好了，可以跳过。
    const existing = master.get(id);
    if (existing && existing.parent !== null) return master;

    // 没留 focusOrigin 就没法知道该接哪——维持旧行为，当成浮空根接进来
    // （不猜测、不报错）。
    const segs = focusOrigin ? splitPath(focusOrigin) : [];
    if (segs.length === 0) return existing ? master : master.set(id, src);

    const name = segs[segs.length - 1]!;
    const g0 = master.get(ROOT_ID) ? master : master.set(ROOT_ID, BLANK_ROOT);
    const { graph: g1, id: parentId } = ensurePath(g0, ROOT_ID, segs.slice(0, -1));
    const parent = g1.get(parentId)!;
    const g2 = parent.children.get(name) === id ? g1 : g1.set(parentId, { ...parent, children: new Map(parent.children).set(name, id) });
    return g2.set(id, { ...(g2.get(id) ?? src), parent: parentId, name });
  }

  if (master.get(id)) return master;
  let m = ensureAnchored(master, source, src.parent, focusOrigin);
  const parent = m.get(src.parent)!;
  if (!parent.children.has(src.name)) {
    const nextChildren = new Map(parent.children);
    nextChildren.set(src.name, id);
    m = m.set(src.parent, { ...parent, children: nextChildren });
  }
  return m.get(id) ? m : m.set(id, src);
}

function fillScalarProps(existing: SceneNode, src: SceneNode): { node: SceneNode; changed: boolean } {
  let merged = existing;
  let changed = false;
  if (merged.content === undefined && src.content !== undefined) {
    merged = { ...merged, content: src.content };
    changed = true;
  }
  if (merged.schema === undefined && src.schema !== undefined) {
    merged = { ...merged, schema: src.schema };
    changed = true;
  }
  if (merged.transform === undefined && src.transform !== undefined) {
    merged = { ...merged, transform: src.transform };
    changed = true;
  }
  if (merged.bounds === undefined && src.bounds !== undefined) {
    merged = { ...merged, bounds: src.bounds };
    changed = true;
  }
  if (src.attributes) {
    const nextAttrs: Record<string, unknown> = { ...(merged.attributes ?? {}) };
    let attrsChanged = false;
    for (const [k, v] of Object.entries(src.attributes)) {
      if (!Object.prototype.hasOwnProperty.call(nextAttrs, k)) {
        nextAttrs[k] = v;
        attrsChanged = true;
      }
    }
    if (attrsChanged) {
      merged = { ...merged, attributes: Object.freeze(nextAttrs) };
      changed = true;
    }
  }
  return { node: merged, changed };
}

function nextOrderUnder(graph: SceneGraph, parentId: NodeId): number {
  const parent = graph.get(parentId);
  if (!parent) return 0;
  let maxOrder = -1;
  for (const cid of parent.children.values()) {
    const c = graph.get(cid);
    if (c && c.order > maxOrder) maxOrder = c.order;
  }
  return maxOrder + 1;
}

function mergeNode(
  master: SceneGraph,
  source: SceneGraph,
  id: NodeId,
  visited: WeakSet<object>,
): SceneGraph {
  const src = source.get(id);
  if (!src || visited.has(src)) return master;
  visited.add(src);

  let m = master;
  const existing = m.get(id);
  if (!existing) {
    const order = src.parent !== null && m.get(src.parent) ? nextOrderUnder(m, src.parent) : src.order;
    m = m.set(id, { ...src, order, children: new Map() });
    if (src.parent !== null) {
      const parent = m.get(src.parent);
      if (parent && !parent.children.has(src.name)) {
        const nextChildren = new Map(parent.children);
        nextChildren.set(src.name, id);
        m = m.set(src.parent, { ...parent, children: nextChildren });
      }
    }
    dbg(`  graft new node ${id} (${src.name})`);
  } else {
    const { node, changed } = fillScalarProps(existing, src);
    if (changed) {
      m = m.set(id, node);
      dbg(`  fill scalar props @${id}`);
    }
  }

  const childIds = [...src.children.values()].sort((a, b) => {
    const na = source.get(a);
    const nb = source.get(b);
    if (!na || !nb) return 0;
    return na.order - nb.order || (na.id < nb.id ? -1 : na.id > nb.id ? 1 : 0);
  });
  for (const childId of childIds) {
    m = mergeNode(m, source, childId, visited);
  }
  return m;
}

export function sceneMergeSubtrees(input: Record<string, unknown>): Result {
  const raw = input.scenes;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'scenes is required and must be a non-empty list' };
  }
  const scenes: ScenePortValue[] = [];
  for (let i = 0; i < raw.length; i++) {
    const port = parseScenePort(raw[i]);
    if (!port) return { error: `scenes[${i}] is not a valid ScenePortValue` };
    scenes.push(port);
  }

  let master = scenes[0]!.graph;
  let mergedCount = 0;

  dbg(`== invoke == scenes.length=${scenes.length}`);

  for (const scene of scenes) {
    const focusNode = getNode(scene.graph, scene.focus);
    if (focusNode === null) {
      dbg(`  focus "${scene.focus}" missing in its own graph → skip`);
      continue;
    }
    master = ensureAnchored(master, scene.graph, scene.focus, scene.focusOrigin);
    master = mergeNode(master, scene.graph, scene.focus, new WeakSet());
    mergedCount++;
  }

  dbg(`== result == mergedCount=${mergedCount}`);
  return { scene: { graph: master, focus: ROOT_ID }, mergedCount };
}
