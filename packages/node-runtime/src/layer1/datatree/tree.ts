// DataTree<T> — the immutable, path-keyed data tree that a wire carries as its runtime payload. It wraps the pure operators from operators.ts as instance methods and adds JSON isomorphism (toJSON returns the internal entries, fromJSON re-validates them through fromEntries). Modelled on upstream node-editor's GH_Structure<T>: branches are keyed by an integer path, items within a branch are homogeneous, and every operator returns a fresh instance rather than mutating in place.

import { type DataTreeEntry, type Path, comparePaths, pathsEqual, pathToString, validatePath } from './types.js';
import { graftEntries, flattenEntries, trimEntries, shiftEntries, simplifyEntries, renumberEntries, mergeEntriesWithPrefix, concatEntriesByPath } from './operators.js';

export class DataTree<T> {
  private constructor(private readonly _entries: ReadonlyArray<DataTreeEntry<T>>) {}

  // Constructors: the validated entry path plus shape-specific shortcuts (scalar, list, empty) and the JSON inverse.
  // Canonical constructor that validates, deep-copies and sorts entries, throwing on duplicate or illegal paths.
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

  // Scalar: a single branch [0] holding one item.
  static fromItem<T>(value: T): DataTree<T> {
    return new DataTree<T>([{ path: [0], items: [value] }]);
  }

  // List: a single branch [0] holding N items, preserving input order.
  static fromList<T>(values: ReadonlyArray<T>): DataTree<T> {
    return new DataTree<T>([{ path: [0], items: [...values] }]);
  }

  // Empty tree: zero branches.
  static empty<T>(): DataTree<T> {
    return new DataTree<T>([]);
  }

  // JSON deserialization that reuses fromEntries so the same validation applies.
  static fromJSON<T>(arr: ReadonlyArray<DataTreeEntry<T>>): DataTree<T> {
    return DataTree.fromEntries(arr);
  }

  // Cross-module-safe identity check: dynamic imports yield independent module instances that break instanceof, so duck-type on the shape instead.
  static isDataTree(v: unknown): v is DataTree<unknown> {
    if (v === null || typeof v !== 'object') return false;
    const o = v as Record<string, unknown>;
    return typeof o['branches'] === 'function' && typeof o['branchCount'] === 'function' && typeof o['toJSON'] === 'function';
  }

  // Inspection: JSON view, branch iteration, lookup, and counts.
  // JSON serialization that returns the immutable internal entries array.
  toJSON(): ReadonlyArray<DataTreeEntry<T>> {
    return this._entries;
  }

  // Iterate every branch in lexicographic path order.
  *branches(): IterableIterator<DataTreeEntry<T>> {
    for (const e of this._entries) yield e;
  }

  // Items at a path, or undefined when absent.
  get(path: Path): readonly T[] | undefined {
    for (const e of this._entries) {
      if (pathsEqual(e.path, path)) return e.items;
    }
    return undefined;
  }

  branchCount(): number {
    return this._entries.length;
  }

  // Sum of items.length across all branches.
  itemCount(): number {
    let n = 0;
    for (const e of this._entries) n += e.items.length;
    return n;
  }

  // Operator methods: thin wrappers over the pure operators in operators.ts (each returns a fresh tree).
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

  // Concatenate items across slots that share a path (item-level merge).
  static concatByPath<T>(slots: ReadonlyArray<DataTree<T>>): DataTree<T> {
    return DataTree.fromEntries(
      concatEntriesByPath(slots.map(s => s._entries)),
    );
  }

  // Map every item while preserving paths and items.length.
  map<U>(fn: (value: T, path: Path, idx: number) => U): DataTree<U> {
    const mapped: DataTreeEntry<U>[] = this._entries.map(({ path, items }) => ({
      path,
      items: items.map((v, i) => fn(v, path, i)),
    }));
    return new DataTree<U>(mapped);
  }
}
