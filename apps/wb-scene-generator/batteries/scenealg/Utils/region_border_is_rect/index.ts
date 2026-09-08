/**
 * regionBorderIsRect: 检测区域有效格的外接矩形四条边是否被完全填满。
 *
 * 先找出所有非零格的紧贴外接矩形（minR/maxR/minC/maxC），再检查该矩形的四条边
 * 上是否每一格都非零：
 *   - 完全填满（true） — 区域外缘正好是一个方正矩形，比如被裁切的开放海域/
 *     无限延伸的地表——这条边并不代表天然边界，不该被当作「近岸」。
 *   - 存在空缺（false） — 外缘凹凸不规则，是天然海岸线/地形轮廓，可以当作
 *     距离场的源（如 alg_field_inner_distance 的 includeOuterBoundary）。
 *
 * 输入：region (grid) — 0/1 或多值区域，非零格为有效格
 * 输出：isRect (bool) — 无有效格时输出 false
 */

type Grid = number[][];

export function regionBorderIsRect(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: 'region is required' };
  }

  const rows = region.length;
  const cols = region[0].length;

  let minR = -1, maxR = -1, minC = cols, maxC = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((region[r]?.[c] ?? 0) === 0) continue;
      if (minR === -1) minR = r;
      maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    }
  }

  if (minR === -1) {
    return { isRect: false };
  }

  const isValid = (r: number, c: number): boolean => (region[r]?.[c] ?? 0) !== 0;

  for (let c = minC; c <= maxC; c++) {
    if (!isValid(minR, c) || !isValid(maxR, c)) return { isRect: false };
  }
  for (let r = minR; r <= maxR; r++) {
    if (!isValid(r, minC) || !isValid(r, maxC)) return { isRect: false };
  }

  return { isRect: true };
}
