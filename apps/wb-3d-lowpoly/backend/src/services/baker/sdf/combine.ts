/**
 * SDF 布尔组合算子 —— `smoothUnion` 是多项式 smin，`subtract`/`intersect` 是标准 SDF
 * 布尔公式（`max(a,-b)` / `max(a,b)`）。
 *
 * `compileSdf` 把 `SdfDescriptor`（primitives + 二元操作树）编译成单个采样函数：按操作
 * 声明顺序把节点表建成 `id → 距离函数` 的查找表，只允许引用已声明的 primitive/operation
 * （禁止前向引用/环）。
 */
import { BakerError } from '../errors.js';
import { sdfPrimitiveDistance } from './primitives.js';
import type { SdfDescriptor, SdfSampleFn } from './types.js';

/**
 * 平滑最小值（多项式 smin）：融合半径越大，两个表面之间的过渡越圆润；
 * radius→0 时退化为普通 `min`（硬边缘并集）。
 */
export function smoothUnion(a: number, b: number, radius: number): number {
  if (radius <= 0) return Math.min(a, b);
  const blend = Math.max(radius - Math.abs(a - b), 0) / radius;
  return Math.min(a, b) - blend * blend * radius * 0.25;
}

/** 从 `a` 里挖掉 `b`（a 的内部 minus b 的内部）。 */
export function subtractSdf(a: number, b: number): number {
  return Math.max(a, -b);
}

/** `a` 与 `b` 的交集（两者内部的公共部分）。 */
export function intersectSdf(a: number, b: number): number {
  return Math.max(a, b);
}

/**
 * 编译 `SdfDescriptor` 为单个采样函数：`primitives` 各自是一个叶子节点，`operations`
 * 按声明顺序依次组合成新节点；最终结果是最后一个 operation 的输出，若没有 operations
 * 则是第一个（也理应是唯一被使用的）primitive。
 *
 * 校验（越界必须报 `BakerError`，不能静默忽略/截断）：
 *   - primitive id 不能重复；
 *   - operation.left/right 必须引用一个*已经声明过*的 id（primitive 或更早的 operation），
 *     禁止引用自身/尚未出现的 id/不存在的 id——这同时防止了环。
 */
export function compileSdf(descriptor: SdfDescriptor): SdfSampleFn {
  const nodes = new Map<string, SdfSampleFn>();

  for (const primitive of descriptor.primitives) {
    if (nodes.has(primitive.id)) {
      throw new BakerError(`sdf_blob: duplicate primitive id "${primitive.id}"`);
    }
    nodes.set(primitive.id, (x, y, z) => sdfPrimitiveDistance(x, y, z, primitive));
  }

  const resolve = (ref: string, opId: string, side: 'left' | 'right'): SdfSampleFn => {
    const fn = nodes.get(ref);
    if (!fn) {
      throw new BakerError(
        `sdf_blob: operation "${opId}" ${side}="${ref}" does not reference a previously declared ` +
        `primitive or operation id (forward references and cycles are not allowed)`,
      );
    }
    return fn;
  };

  let lastId: string | undefined;
  for (const op of descriptor.operations) {
    if (nodes.has(op.id)) {
      throw new BakerError(`sdf_blob: duplicate operation id "${op.id}" (collides with a primitive or earlier operation id)`);
    }
    const left = resolve(op.left, op.id, 'left');
    const right = resolve(op.right, op.id, 'right');
    let combined: SdfSampleFn;
    switch (op.type) {
      case 'smooth-union': {
        const radius = op.radius;
        combined = (x, y, z) => smoothUnion(left(x, y, z), right(x, y, z), radius);
        break;
      }
      case 'subtract':
        combined = (x, y, z) => subtractSdf(left(x, y, z), right(x, y, z));
        break;
      case 'intersect':
        combined = (x, y, z) => intersectSdf(left(x, y, z), right(x, y, z));
        break;
    }
    nodes.set(op.id, combined);
    lastId = op.id;
  }

  if (lastId) return nodes.get(lastId)!;
  if (descriptor.primitives.length > 0) return nodes.get(descriptor.primitives[0].id)!;
  // organic.ts 在调用前已经校验 primitives 非空；这里兜底防御式返回一个恒为"外部"的场。
  return () => Infinity;
}
