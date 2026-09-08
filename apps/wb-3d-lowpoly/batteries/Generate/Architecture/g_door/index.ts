/**
 * g_door —— 追加门框 + 独立门扇两条 shape。
 *
 *   `<id>      = door_frame(size=[w,h], depth, frame)`
 *   `<id>_leaf = door_leaf(size=[leaf_w,leaf_h], thickness, hinge)`
 *
 * 门扇作为**独立 shape** 发出（不在 baker 里融进门框），这样生成器可以选择把它
 * 用 `g_joint_revolute`（可开）或 `g_joint_fixed`（静态）连到门框 / 墙上。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gDoor(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const w = Number(input.width ?? 0.9);
  const h = Number(input.height ?? 2.1);
  const depth = Number(input.depth ?? 0.2);
  if (![w, h, depth].every(Number.isFinite) || w <= 0 || h <= 0 || depth <= 0) {
    return { geometry: incoming, id: '', error: 'door: width, height, depth must be positive finite numbers' };
  }
  const frame = (() => {
    const f = Number(input.frame ?? Math.min(w * 0.1, 0.08));
    return Number.isFinite(f) && f > 0 ? f : Math.min(w * 0.1, 0.08);
  })();
  const leafT = (() => {
    const t = Number(input.leaf_thickness ?? 0.045);
    return Number.isFinite(t) && t > 0 ? t : 0.045;
  })();
  const hinge = String(input.hinge ?? 'left').trim().toLowerCase() === 'right' ? 'right' : 'left';
  const leaves = Math.round(Number(input.leaves ?? 1)) === 2 ? 2 : 1;
  const VALID_STYLE = new Set(['flush', 'panel', 'glazed']);
  const style = String(input.style ?? 'flush').trim().toLowerCase();
  if (!VALID_STYLE.has(style)) {
    return { geometry: incoming, id: '', error: `door: style must be flush/panel/glazed, got "${style}"` };
  }

  if (frame * 2 >= w) {
    return { geometry: incoming, id: '', error: 'door: frame must be < half of width' };
  }
  // 与 baker door_frame 对齐：门框上槛宽必须 < 洞口高度。
  if (frame >= h) {
    return { geometry: incoming, id: '', error: 'door: frame must be < height' };
  }

  const transom = Number(input.transom ?? 0);
  const hasTransom = Number.isFinite(transom) && transom > 0;
  if (hasTransom && transom >= h - frame) {
    return { geometry: incoming, id: '', error: 'door: transom must be < height - frame' };
  }
  const sidelight = Number(input.sidelight ?? 0);
  const hasSidelight = Number.isFinite(sidelight) && sidelight > 0;
  if (hasSidelight && 2 * (frame + sidelight) >= w) {
    return { geometry: incoming, id: '', error: 'door: sidelight too wide for opening' };
  }

  const rawId = String(input.id ?? '').trim();
  const frameId = rawId !== '' ? rawId : freshId(incoming, 'door');
  if (!isValidId(frameId)) return { geometry: incoming, id: '', error: `invalid id "${frameId}"` };

  const gap = 0.01;
  // With sidelights the central leaf opening is bounded by the two divider
  // bars: outer jambs (2×frame) plus two half-divider contributions (1×frame).
  const clearW = hasSidelight ? w - 3 * frame - 2 * sidelight : w - 2 * frame;
  if (clearW <= 0.1) {
    return { geometry: incoming, id: '', error: 'door: opening too narrow after sidelights' };
  }
  const leafTop = hasTransom ? h - transom - frame : h - frame;
  const leafH = Math.max(0.1, leafTop - gap);

  const panelRows = Math.round(Number(input.panel_rows ?? 0));
  const panelCols = Math.round(Number(input.panel_cols ?? 0));

  const frameArgs: Record<string, Arg> = {
    size: numList([w, h]),
    depth: num(depth),
    frame: num(frame),
  };
  if (hasTransom) frameArgs.transom = num(transom);
  if (hasSidelight) frameArgs.sidelight = num(sidelight);
  let geom = emit(incoming, frameId, 'door_frame', frameArgs);

  // 门扇：单扇 = 一块；双扇 = 两块对开（铰接边各在两侧，合起来填满洞口）。
  // door_leaf 的局部原点在**铰链边**（不是几何中心）：hinge=left → 扇身占局部
  // X∈[0,leafW]、转轴在 X=0；hinge=right → 占 X∈[-leafW,0]。因此把门扇填进门框
  // 洞口时，关节 origin（相对门框中心）要落在对应门挺处：left → -clearW/2、
  // right → +clearW/2。此处把该 origin 一并返回（leaf_origin/leaf_origins），
  // 生成器可直接喂给连门扇的 joint，避免把扇按门框同心摆而戳出框外。
  const leafIds: string[] = [];
  const leafOrigins: number[][] = [];
  const emitLeaf = (suffix: string, leafW: number, lhinge: string): string | null => {
    const id = `${frameId}_${suffix}`;
    if (!isValidId(id)) return null;
    const leafArgs: Record<string, Arg> = {
      size: numList([Math.max(0.1, leafW), leafH]),
      thickness: num(leafT),
      hinge: str(lhinge),
      style: str(style),
    };
    if (style === 'panel') {
      if (Number.isFinite(panelRows) && panelRows >= 1) leafArgs.panel_rows = num(panelRows);
      if (Number.isFinite(panelCols) && panelCols >= 1) leafArgs.panel_cols = num(panelCols);
    }
    geom = emit(geom, id, 'door_leaf', leafArgs);
    leafIds.push(id);
    leafOrigins.push([lhinge === 'left' ? -clearW / 2 : clearW / 2, 0, 0]);
    return id;
  };

  if (leaves === 2) {
    const leafW = Math.max(0.1, (clearW - gap) / 2);
    // 双扇对开：铰链边落在各自局部 X=0（door_leaf 的旋转轴）。左扇铰接在洞口左
    // 门框（hinge=left → 扇身占 X∈[0,w]，向 +X/中心伸展），右扇铰接在右门框
    // (hinge=right → 扇身占 X∈[-w,0]，向 -X/中心伸展)，两扇在中间合拢。此前 l/r
    // 的 hinge 侧被写反，导致两扇都把轴放在中心、朝外错开。
    if (emitLeaf('leaf_l', leafW, 'left') === null || emitLeaf('leaf_r', leafW, 'right') === null) {
      return { geometry: incoming, id: '', error: 'door: invalid leaf id' };
    }
  } else {
    if (emitLeaf('leaf', clearW - gap, hinge) === null) {
      return { geometry: incoming, id: '', error: 'door: invalid leaf id' };
    }
  }

  return {
    geometry: geom,
    id: frameId,
    frame_id: frameId,
    frame_origin: JSON.stringify([0, 0, 0]),
    leaf_id: leafIds[0],
    leaf_ids: leafIds,
    // 门扇相对门框中心的建议关节 origin（米，Z 上）。把门框放到墙洞的 [x,0,0] 后，
    // 门扇 origin 若以门框为父 = 下值；若以墙为父 = [x+ox, 0, 0]。
    leaf_origin: JSON.stringify(leafOrigins[0] ?? [0, 0, 0]),
    leaf_origins: JSON.stringify(leafOrigins),
    leaves,
    style,
    // 默认 false：低模静态建筑推荐用 g_joint_fixed 连门扇。用 revolute 可开门会让
    // g_geometry_qc 把全楼 AABB 交叠升级为致命（见 meta 的 QC 警告），需 allow_pairs 白名单。
    openable: input.openable === undefined ? false : Boolean(input.openable),
  };
}

export default gDoor;
