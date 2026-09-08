/**
 * voxel_slice — 在指定 z 高度对体素列表切片，输出与基准 grid 同形状的 0/1 grid。
 *
 * 输入：
 *   - voxels : Point3D[]（rank=1，整组消费；通常来自 node_explode.voxels）
 *   - grid   : number[][] —— 基准 grid，仅用于决定输出形状（值不参与计算）
 *   - z      : number（可选）；切片高度。未提供时自动取所有 voxel 中最大的 z 作为切片高度。
 *
 * 输出：
 *   - slice    : number[][]，形状同 grid；voxel.z === z 且 (x,y) 落在 grid 范围内 → 1，否则 0
 *   - z        : number，本次实际用于切片的 z（外部传入则回显，未传入则为自动选取的最大 z）
 *   - hitCount : 切片中被置 1 的格子数
 *
 * autoIterate：
 *   - voxels 为 rank=1 端口，整组喂入，不参与 dispatcher 拆分；
 *   - grid / z 在调用方提供列表时由 dispatcher 标准 zip+merge 迭代，输出 slice 列表（rank=1）。
 *     例如给定 z=[0,1,2] → 三层 slice grids，可后续打包动画或重新塞进 grid2node 重建多层 scene。
 */

import { isPoint3D } from '../../../../vendor/dist/shared/types/index.js';

interface VoxelSliceResult {
  slice: number[][];
  z: number;
  hitCount: number;
  error?: string;
}

function computeShape(grid: unknown[]): { rows: number; cols: number } | string {
  if (grid.length === 0) return 'grid is required and non-empty';
  const firstRow = grid[0];
  if (!Array.isArray(firstRow)) return 'grid must be a 2D array (number[][])';
  const cols = firstRow.length;
  if (cols === 0) return 'grid rows must be non-empty';
  // 校验所有行长一致；不要求严格 number 元素，只用形状
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!Array.isArray(row) || row.length !== cols) {
      return `grid rows must have uniform length (row ${r} differs)`;
    }
  }
  return { rows: grid.length, cols };
}

function makeZeroGrid(rows: number, cols: number): number[][] {
  const out: number[][] = new Array(rows);
  for (let y = 0; y < rows; y++) {
    out[y] = new Array(cols).fill(0);
  }
  return out;
}

export function voxelSlice(input: Record<string, unknown>): VoxelSliceResult {
  const grid = input.grid;
  if (!Array.isArray(grid)) {
    return { slice: [], z: 0, hitCount: 0, error: 'grid is required (number[][])' };
  }
  const shape = computeShape(grid);
  if (typeof shape === 'string') {
    return { slice: [], z: 0, hitCount: 0, error: shape };
  }

  const voxels = input.voxels;
  if (!Array.isArray(voxels)) {
    return { slice: [], z: 0, hitCount: 0, error: 'voxels is required (Point3D[])' };
  }

  // 先校验所有 voxel，确保后续既能自动选取最大 z，也能安全参与切片。
  for (let i = 0; i < voxels.length; i++) {
    if (!isPoint3D(voxels[i])) {
      return { slice: [], z: 0, hitCount: 0, error: `voxels[${i}] is not a valid Point3D` };
    }
  }

  // z 解析：外部提供则按其切片；否则自动取所有 voxel 中最大的 z。
  const hasExternalZ = input.z !== undefined && input.z !== null && input.z !== '';
  let z: number;
  if (hasExternalZ) {
    z = Number(input.z);
    if (!Number.isFinite(z)) {
      return { slice: [], z: 0, hitCount: 0, error: 'z must be a finite number' };
    }
  } else {
    if (voxels.length === 0) {
      return {
        slice: [],
        z: 0,
        hitCount: 0,
        error: 'z is not provided and voxels is empty, cannot infer slice height',
      };
    }
    z = -Infinity;
    for (const v of voxels) {
      const vz = (v as { z: number }).z;
      if (vz > z) z = vz;
    }
  }

  const out = makeZeroGrid(shape.rows, shape.cols);
  let hitCount = 0;

  for (const v of voxels as Array<{ x: number; y: number; z: number }>) {
    if (v.z !== z) continue;
    // 体素 (x,y) 通常为整数索引；保险起见用 Math.round 对齐到 grid 索引空间
    const ix = Math.round(v.x);
    const iy = Math.round(v.y);
    if (ix < 0 || ix >= shape.cols || iy < 0 || iy >= shape.rows) continue;
    if (out[iy]![ix] === 0) {
      out[iy]![ix] = 1;
      hitCount += 1;
    }
  }

  return { slice: out, z, hitCount };
}
