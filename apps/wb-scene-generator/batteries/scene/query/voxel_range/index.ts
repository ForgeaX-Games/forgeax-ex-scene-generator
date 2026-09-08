/**
 * voxel_range — 统计体素列表在三个轴上出现过的坐标值。
 *
 * 输入：
 *   - voxels : Point3D[]（rank=1，整组消费；通常来自 node_explode.voxels）
 *
 * 输出（均为升序、去重的数值列表）：
 *   - xRange : voxels 中出现过的所有不重复 x 值
 *   - yRange : voxels 中出现过的所有不重复 y 值
 *   - zRange : voxels 中出现过的所有不重复 z 值
 *
 * 空列表 → 三个空 range。voxels 中非法 Point3D 直接报错。
 */

import { isPoint3D } from '../../../../vendor/dist/shared/types/index.js';

interface VoxelRangeResult {
  xRange: number[];
  yRange: number[];
  zRange: number[];
  error?: string;
}

function sortedUnique(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

export function voxelRange(input: Record<string, unknown>): VoxelRangeResult {
  const voxels = input.voxels;
  if (!Array.isArray(voxels)) {
    return { xRange: [], yRange: [], zRange: [], error: 'voxels is required (Point3D[])' };
  }

  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < voxels.length; i++) {
    const v = voxels[i];
    if (!isPoint3D(v)) {
      return { xRange: [], yRange: [], zRange: [], error: `voxels[${i}] is not a valid Point3D` };
    }
    xs.push(v.x);
    ys.push(v.y);
    zs.push(v.z);
  }

  return {
    xRange: sortedUnique(xs),
    yRange: sortedUnique(ys),
    zRange: sortedUnique(zs),
  };
}
