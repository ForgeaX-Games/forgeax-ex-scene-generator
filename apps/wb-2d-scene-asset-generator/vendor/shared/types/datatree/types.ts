/**
 * DataTree 数据结构基础类型与 path 工具。
 *
 * 约束（编码层强制）：
 *   - path.length >= 1（禁止空 path；标量统一为 [0]）
 *   - path 元素 >= 0 且为有限整数
 *   - 同一 tree 内 path 唯一（由 DataTree.fromEntries 验证）
 */

export type Path = readonly number[];

export interface DataTreeEntry<T> {
  readonly path: Path;
  readonly items: ReadonlyArray<T>;
}

/** 人读字符串："{0;1;2}"，与节点编辑器 一致便于跨工具讨论。 */
export function pathToString(path: Path): string {
  return `{${path.join(';')}}`;
}

/** 字典序比较两条 path：相同前缀下短者小。 */
export function comparePaths(a: Path, b: Path): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/** path 等价。 */
export function pathsEqual(a: Path, b: Path): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 校验单条 path：非空、整数、>=0、有限。失败抛 Error。 */
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
