/**
 * PersistentStringMap<V>：不可变、结构共享的 string-keyed map（HAMT，32-way，5-bit fragments）。
 *
 * 这是 SceneGraph 的底层容器：每次 `set`/`delete` 返回一个新 map，只重写从根到
 * 改动分支的那条路径（O(log32 N) ≈ O(1) 摊销），未触及的分支与旧 map 引用共享。
 * 这就是「重构规格」里「引用相等（Object.is）判断子树是否变化」这条结论的物理基础——
 * 没有变化的分支永远是同一个对象引用。
 *
 * 与内置 Map 的关键差异：`set`/`delete` 不就地修改，而是返回一个新的
 * PersistentStringMap 实例；旧实例继续有效（这正是允许"打乱调用顺序不影响其他分支"
 * 的独立性保证 —— 见 scene-graph-v3-clean-slate-design canvas 的节点独立性审计）。
 */

const BITS = 5;
const WIDTH = 1 << BITS; // 32
const MASK = WIDTH - 1;

function hashString(s: string): number {
  // FNV-1a 32-bit — deterministic, no external dependency, good-enough avalanche
  // for trie fragment distribution (we are not defending against adversarial keys).
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function popcount(x: number): number {
  x -= (x >> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  x = (x + (x >> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >> 24;
}

interface Entry<V> {
  readonly key: string;
  readonly value: V;
}

type TrieNode<V> =
  | { readonly kind: 'leaf'; readonly hash: number; readonly key: string; readonly value: V }
  | { readonly kind: 'collision'; readonly hash: number; readonly entries: ReadonlyArray<Entry<V>> }
  | { readonly kind: 'branch'; readonly bitmap: number; readonly children: ReadonlyArray<TrieNode<V>> };

function makeLeaf<V>(hash: number, key: string, value: V): TrieNode<V> & { kind: 'leaf' } {
  return { kind: 'leaf', hash, key, value };
}

function entriesOf<V>(node: TrieNode<V> & { kind: 'leaf' | 'collision' }): ReadonlyArray<Entry<V>> {
  return node.kind === 'collision' ? node.entries : [{ key: node.key, value: node.value }];
}

/** 合并两个 hash 不同（或恰好相同即真碰撞）的叶子/碰撞节点，从 shift 位开始逐级下钻直到分叉。 */
function mergeLeaves<V>(
  hashA: number,
  nodeA: TrieNode<V> & { kind: 'leaf' | 'collision' },
  hashB: number,
  nodeB: TrieNode<V> & { kind: 'leaf' | 'collision' },
  shift: number,
): TrieNode<V> {
  if (shift >= 32) {
    // 32 bit 已耗尽仍未分叉 —— 真正的 hash 碰撞（key 不同但 hash 相同）。
    return { kind: 'collision', hash: hashA, entries: [...entriesOf(nodeA), ...entriesOf(nodeB)] };
  }
  const fragA = (hashA >>> shift) & MASK;
  const fragB = (hashB >>> shift) & MASK;
  if (fragA === fragB) {
    const child = mergeLeaves(hashA, nodeA, hashB, nodeB, shift + BITS);
    return { kind: 'branch', bitmap: 1 << fragA, children: [child] };
  }
  const bitA = 1 << fragA;
  const bitB = 1 << fragB;
  const children = fragA < fragB ? [nodeA, nodeB] : [nodeB, nodeA];
  return { kind: 'branch', bitmap: bitA | bitB, children };
}

function nodeGet<V>(node: TrieNode<V> | null, hash: number, key: string, shift: number): V | undefined {
  if (node === null) return undefined;
  if (node.kind === 'leaf') {
    return node.hash === hash && node.key === key ? node.value : undefined;
  }
  if (node.kind === 'collision') {
    if (node.hash !== hash) return undefined;
    return node.entries.find((e) => e.key === key)?.value;
  }
  const frag = (hash >>> shift) & MASK;
  const bit = 1 << frag;
  if ((node.bitmap & bit) === 0) return undefined;
  const idx = popcount(node.bitmap & (bit - 1));
  return nodeGet(node.children[idx]!, hash, key, shift + BITS);
}

/** 返回 { node, isNew }；isNew=true 表示这是一次新增 key（用于维护 size）。 */
function nodeSet<V>(
  node: TrieNode<V> | null,
  hash: number,
  key: string,
  value: V,
  shift: number,
): { node: TrieNode<V>; isNew: boolean; changed: boolean } {
  if (node === null) {
    return { node: makeLeaf(hash, key, value), isNew: true, changed: true };
  }
  if (node.kind === 'leaf') {
    if (node.hash === hash && node.key === key) {
      if (Object.is(node.value, value)) return { node, isNew: false, changed: false };
      return { node: makeLeaf(hash, key, value), isNew: false, changed: true };
    }
    const merged = mergeLeaves(node.hash, node, hash, makeLeaf(hash, key, value), shift);
    return { node: merged, isNew: true, changed: true };
  }
  if (node.kind === 'collision') {
    if (node.hash !== hash) {
      const merged = mergeLeaves(node.hash, node, hash, makeLeaf(hash, key, value), shift);
      return { node: merged, isNew: true, changed: true };
    }
    const idx = node.entries.findIndex((e) => e.key === key);
    if (idx >= 0) {
      if (Object.is(node.entries[idx]!.value, value)) return { node, isNew: false, changed: false };
      const nextEntries = node.entries.slice();
      nextEntries[idx] = { key, value };
      return { node: { kind: 'collision', hash, entries: nextEntries }, isNew: false, changed: true };
    }
    return {
      node: { kind: 'collision', hash, entries: [...node.entries, { key, value }] },
      isNew: true,
      changed: true,
    };
  }
  // branch
  const frag = (hash >>> shift) & MASK;
  const bit = 1 << frag;
  const idx = popcount(node.bitmap & (bit - 1));
  if ((node.bitmap & bit) === 0) {
    const children = node.children.slice();
    children.splice(idx, 0, makeLeaf(hash, key, value));
    return { node: { kind: 'branch', bitmap: node.bitmap | bit, children }, isNew: true, changed: true };
  }
  const child = node.children[idx]!;
  const result = nodeSet(child, hash, key, value, shift + BITS);
  if (!result.changed) return { node, isNew: false, changed: false };
  const children = node.children.slice();
  children[idx] = result.node;
  return { node: { kind: 'branch', bitmap: node.bitmap, children }, isNew: result.isNew, changed: true };
}

function nodeDelete<V>(node: TrieNode<V> | null, hash: number, key: string, shift: number): TrieNode<V> | null {
  if (node === null) return null;
  if (node.kind === 'leaf') {
    return node.hash === hash && node.key === key ? null : node;
  }
  if (node.kind === 'collision') {
    if (node.hash !== hash) return node;
    const idx = node.entries.findIndex((e) => e.key === key);
    if (idx < 0) return node;
    const nextEntries = node.entries.filter((_, i) => i !== idx);
    if (nextEntries.length === 1) return makeLeaf(hash, nextEntries[0]!.key, nextEntries[0]!.value);
    return { kind: 'collision', hash, entries: nextEntries };
  }
  const frag = (hash >>> shift) & MASK;
  const bit = 1 << frag;
  if ((node.bitmap & bit) === 0) return node;
  const idx = popcount(node.bitmap & (bit - 1));
  const child = node.children[idx]!;
  const newChild = nodeDelete(child, hash, key, shift + BITS);
  if (newChild === child) return node;
  if (newChild === null) {
    const newBitmap = node.bitmap & ~bit;
    if (newBitmap === 0) return null;
    const children = node.children.slice();
    children.splice(idx, 1);
    if (children.length === 1 && children[0]!.kind === 'leaf') return children[0]!;
    return { kind: 'branch', bitmap: newBitmap, children };
  }
  const children = node.children.slice();
  children[idx] = newChild;
  return { kind: 'branch', bitmap: node.bitmap, children };
}

function* nodeEntries<V>(node: TrieNode<V> | null): IterableIterator<[string, V]> {
  if (node === null) return;
  if (node.kind === 'leaf') {
    yield [node.key, node.value];
    return;
  }
  if (node.kind === 'collision') {
    for (const e of node.entries) yield [e.key, e.value];
    return;
  }
  for (const child of node.children) yield* nodeEntries(child);
}

/**
 * 深度拍平成纯 JSON 值——不知道也不关心 V 的字段名，只认值的"形状"：
 * PersistentStringMap → 递归调它自己的 toJSON；Map → 变成 plain object；
 * TypedArray → 变成 number[]；剩下按数组/object/原样递归。这是
 * PersistentStringMap.toJSON() 的唯一职责：让 JSON.stringify(图里任何一个
 * 值) 自动、正确地把 map/trie 变成能跨 HTTP/JSON.parse 边界存活的形状，
 * 不需要每个调用方各自记得"这里面藏了一个 Map，序列化前要转"。
 * 反向复原（revive）因为无法从"它现在是 plain object"反推"它原来是不是
 * Map"，做不到通用化，必须由知道字段语义的调用方显式处理（见 graph.ts 的
 * reviveGraphFromWire / volume.ts 的 reviveVolumeFromWire）。
 */
function deepToJSON(value: unknown): unknown {
  if (value instanceof PersistentStringMap) return value.toJSON();
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value) out[String(k)] = deepToJSON(v);
    return out;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  if (Array.isArray(value)) return value.map(deepToJSON);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepToJSON(v);
    return out;
  }
  return value;
}

export class PersistentStringMap<V> {
  private constructor(
    private readonly root: TrieNode<V> | null,
    readonly size: number,
  ) {}

  static empty<V>(): PersistentStringMap<V> {
    return new PersistentStringMap<V>(null, 0);
  }

  get(key: string): V | undefined {
    return nodeGet(this.root, hashString(key), key, 0);
  }

  has(key: string): boolean {
    return nodeGet(this.root, hashString(key), key, 0) !== undefined;
  }

  /** 引用相等（Object.is）表示"没有任何 key 的 value 改变"——用于结构共享判断。 */
  set(key: string, value: V): PersistentStringMap<V> {
    const hash = hashString(key);
    const result = nodeSet(this.root, hash, key, value, 0);
    if (!result.changed) return this;
    return new PersistentStringMap<V>(result.node, result.isNew ? this.size + 1 : this.size);
  }

  delete(key: string): PersistentStringMap<V> {
    const hash = hashString(key);
    const node = nodeDelete(this.root, hash, key, 0);
    if (node === this.root) return this;
    return new PersistentStringMap<V>(node, this.size - 1);
  }

  entries(): IterableIterator<[string, V]> {
    return nodeEntries(this.root);
  }

  *keys(): IterableIterator<string> {
    for (const [k] of nodeEntries(this.root)) yield k;
  }

  *values(): IterableIterator<V> {
    for (const [, v] of nodeEntries(this.root)) yield v;
  }

  [Symbol.iterator](): IterableIterator<[string, V]> {
    return this.entries();
  }

  /**
   * JSON.stringify 会自动调用它（标准 JS 语义，不需要调用方特殊处理）——把整棵
   * 持久化 map 拍平成 { [key]: value } 的纯 JSON 对象，value 内部任何 Map/嵌套
   * PersistentStringMap/TypedArray 也一并拍平（见 deepToJSON）。这是 SceneGraph
   * 能安全穿过 HTTP JSON 响应、到达前端 `JSON.parse` 之后仍然可读的唯一原因——
   * 不依赖任何调用方记得手动转换。
   */
  toJSON(): Record<string, V> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.entries()) out[k] = deepToJSON(v);
    return out as Record<string, V>;
  }
}
