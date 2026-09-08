// DataTree fundamental types and path utilities — the data-shape contract the rest of the datatree cluster builds on. Three invariants are enforced by the codec: a path has length >= 1 (no empty path, scalars live at [0]), every path element is a non-negative finite integer, and paths within one tree are unique (validated by DataTree.fromEntries).

export type Path = readonly number[];

export interface DataTreeEntry<T> {
  readonly path: Path;
  readonly items: ReadonlyArray<T>;
}

// Render a path in the human-readable '{0;1;2}' form, matching the node-editor convention so logs read the same across tools.
export function pathToString(path: Path): string {
  return `{${path.join(';')}}`;
}

// Lexicographic path comparison where, on a shared prefix, the shorter path sorts first.
export function comparePaths(a: Path, b: Path): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

// Path equality.
export function pathsEqual(a: Path, b: Path): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Whether `prefix` is a (non-strict) path prefix of `path`: every segment of
// `prefix` matches the leading segments of `path`. An equal path counts as a
// prefix. Used by hierarchy-aware lacing to broadcast a parent-level branch
// (e.g. per-building {b}) across its descendant branches (e.g. per-room {b;r}).
export function isPrefix(prefix: Path, path: Path): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== path[i]) return false;
  return true;
}

// Enforce the path invariants (non-empty, non-negative finite integers), throwing on the first violation.
export function validatePath(path: Path): void {
  if (path.length === 0) {
    throw new Error('DataTree: path must have length >= 1 (use [0] for scalar)');
  }
  for (const seg of path) {
    if (!Number.isInteger(seg) || seg < 0 || !Number.isFinite(seg)) {
      throw new Error(
        `DataTree: path segments must be non-negative finite integers (got ${pathToString(path)})`,
      );
    }
  }
}
