/**
 * DataTree<T>：path-keyed 不可变数据树（每条 wire 的运行时载荷）。
 *
 * 设计参考节点编辑器 `GH_Structure<T>`（参见 docs/refactor/datatree.md §3.1）：
 *   - branch 主键是整数序列 path（int[]），可序列化、可比较、可作 Map key
 *   - 同一 branch 内 items 同质；不同 branch 之间 items 异质
 *   - 实例不可变，所有算子返回新实例
 *
 * 序列化：toJSON 直接返回内部 entries 数组（JSON.stringify 友好）；
 *         反序列化用 fromJSON（== fromEntries），保持 path 唯一性校验。
 */

import {
  type DataTreeEntry,
  type Path,
  comparePaths,
  pathsEqual,
  pathToString,
  validatePath,
} from './types.js';
import {
  graftEntries,
  flattenEntries,
  trimEntries,
  shiftEntries,
  simplifyEntries,
  renumberEntries,
  mergeEntriesWithPrefix,
  concatEntriesByPath,
} from './operators.js';

export class DataTree<T> {
  private constructor(private readonly _entries: ReadonlyArray<DataTreeEntry<T>>) {}

  /** 校验 + 深拷贝 + 字典序排序后构造。重复 path / 非法 path 抛错。 */
  static fromEntries<T>(entries: ReadonlyArray<DataTreeEntry<T>>): DataTree<T> {
    const seen = new Set<string>();
    const normalized: DataTreeEntry<T>[] = [];
    for (const e of entries) {
      validatePath(e.path);
      const key = e.path.join('.');
      if (seen.has(key)) {
        throw new Error(`DataTree: duplicate path ${pathToString(e.path)}`);
      }
      seen.add(key);
      normalized.push({ path: [...e.path], items: [...e.items] });
    }
    normalized.sort((a, b) => comparePaths(a.path, b.path));
    return new DataTree<T>(normalized);
  }

  /** 标量：单 branch [0]，单个 item。 */
  static fromItem<T>(value: T): DataTree<T> {
    return new DataTree<T>([{ path: [0], items: [value] }]);
  }

  /** 列表：单 branch [0]，N 个 items（保留输入顺序）。 */
  static fromList<T>(values: ReadonlyArray<T>): DataTree<T> {
    return new DataTree<T>([{ path: [0], items: [...values] }]);
  }

  /** 空树：0 个 branch。 */
  static empty<T>(): DataTree<T> {
    return new DataTree<T>([]);
  }

  /** JSON 反序列化：复用 fromEntries 的校验语义。 */
  static fromJSON<T>(arr: ReadonlyArray<DataTreeEntry<T>>): DataTree<T> {
    return DataTree.fromEntries(arr);
  }

  /**
   * 跨模块实例安全的 DataTree 身份检测（duck-type）。
   * 动态 import 会产生独立模块实例，导致 instanceof 失效；此方法通过结构特征判断，
   * 在任意模块边界都可靠。
   */
  static isDataTree(v: unknown): v is DataTree<unknown> {
    if (v === null || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return typeof o['branches'] === 'function' && typeof o['branchCount'] === 'function' && typeof o['toJSON'] === 'function';
  }

  /** JSON 序列化：返回内部 entries 数组（不可变）。 */
  toJSON(): ReadonlyArray<DataTreeEntry<T>> {
    return this._entries;
  }

  /** 按 path 字典序遍历所有 branch。 */
  *branches(): IterableIterator<DataTreeEntry<T>> {
    for (const e of this._entries) yield e;
  }

  /** 按 path 取一支 items；找不到返回 undefined。 */
  get(path: Path): readonly T[] | undefined {
    for (const e of this._entries) {
      if (pathsEqual(e.path, path)) return e.items;
    }
    return undefined;
  }

  branchCount(): number {
    return this._entries.length;
  }

  /** 全部 branch 的 items 数量之和。 */
  itemCount(): number {
    let n = 0;
    for (const e of this._entries) n += e.items.length;
    return n;
  }

  graft(): DataTree<T> {
    return DataTree.fromEntries(graftEntries(this._entries));
  }

  flatten(): DataTree<T> {
    return DataTree.fromEntries(flattenEntries(this._entries));
  }

  trim(n: number): DataTree<T> {
    return DataTree.fromEntries(trimEntries(this._entries, n));
  }

  shift(n: number): DataTree<T> {
    return DataTree.fromEntries(shiftEntries(this._entries, n));
  }

  simplify(): DataTree<T> {
    return DataTree.fromEntries(simplifyEntries(this._entries));
  }

  renumber(): DataTree<T> {
    return DataTree.fromEntries(renumberEntries(this._entries));
  }

  mergeWithPrefix(other: DataTree<T>, prefix: number): DataTree<T> {
    return DataTree.fromEntries(mergeEntriesWithPrefix(this._entries, other._entries, prefix));
  }

  /** 多 slot 按 path 并集 + 各 slot items 顺序串联（用于 item-级 merge）。 */
  static concatByPath<T>(slots: ReadonlyArray<DataTree<T>>): DataTree<T> {
    return DataTree.fromEntries(
      concatEntriesByPath(slots.map(s => s._entries)),
    );
  }

  /** 转换每个 item 的值；path 与 items 数量保持不变。 */
  map<U>(fn: (value: T, path: Path, idx: number) => U): DataTree<U> {
    const mapped: DataTreeEntry<U>[] = this._entries.map(({ path, items }) => ({
      path,
      items: items.map((v, i) => fn(v, path, i)),
    }));
    return new DataTree<U>(mapped);
  }
}
