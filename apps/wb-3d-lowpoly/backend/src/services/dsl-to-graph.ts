/**
 * dsl-to-graph —— DSL-first 建模的编译器（Workstream A 核心）。
 *
 * 职责：把一段 Geometry DSL 文本编译成一张 legacy-pipeline-v1 图，规则：
 *   - 每条 DSL 语句 → 一个节点（op → 电池 id 映射，见 OP_REGISTRY）
 *   - geometry 端口沿语句顺序线性串联（node[i].geometry → node[i+1].geometry）
 *   - ref 参数（shape=b1、parent=p1 …）→ 从被引用语句的 `id` 输出端口连一条边
 *   - 末尾自动追加终端节点 g_geometry_qc → g_to_urdf
 *   - 遇到映射表里没有的 op（未知 / 未映射）**显式报错并给出行号**，绝不静默降级
 *
 * 设计要点：op ↔ 电池的字段映射是**双向**的（FieldSpec），因此本模块同时提供
 *   - compileDslToGraph(source)  DSL → 图
 *   - graphToDsl(nodes)          图 → DSL（round-trip；人改图后仍能读回等价 DSL）
 *
 * 本模块是纯函数、无副作用、不依赖 runtime；导入交给调用方（routes/model.ts）。
 */

import {
  parseDSL,
  validateStatements,
  formatStatements,
  type Arg,
  type GeometryError,
  type Statement,
} from '../../../vendor/dist/shared/types/index.js'

// ── 图/节点类型（与 @forgeax/node-runtime 的 legacy-pipeline-v1 对齐）──────────

export interface CompiledNode {
  id: string
  batteryId: string
  name?: string
  position?: { x: number; y: number }
  params?: Record<string, unknown>
}

export interface CompiledEdge {
  id: string
  source: { nodeId: string; port: string }
  target: { nodeId: string; port: string }
}

export interface CompiledGraph {
  id?: string
  name?: string
  nodes: CompiledNode[]
  edges: CompiledEdge[]
  metadata?: Record<string, unknown>
}

export interface CompileError {
  line: number
  message: string
  kind: GeometryError['kind'] | 'unmapped-op'
}

export interface CompileResult {
  /** 是否零错误（可安全执行）。有非阻断性语义错误时 graph 仍可能非空。 */
  ok: boolean
  /** 结构良好、可导入的图；解析错误 / 未知 op / 重复 id 时为 null。 */
  graph: CompiledGraph | null
  /** 所有错误（parse + semantic + unmapped），均带 1-based 行号。 */
  errors: CompileError[]
  /** nodeId → 该节点对应的 DSL 行号（终端节点为 0）。 */
  lineByNodeId: Record<string, number>
  /** 语句节点 id（按 DSL 顺序）。 */
  statementNodeIds: string[]
  /** 终端 QC 节点 id（三路共用 g_geometry_qc；角色路为空，用 skinQcNodeId）。 */
  qcNodeId: string
  /** 非阻断量化建议节点（三路共用 g_metrics）。 */
  metricsNodeId: string
  /** 终端 URDF 节点 id（mode='urdf' 时非空）。 */
  urdfNodeId: string
  /**
   * 编译走的是哪条终端链：
   *   - 'static'    —— 纯静态物体 / 场景组装（无 joint、无 skin）→ g_geometry_qc → [g_bake_object] → g_to_scene → scene_preview
   *   - 'urdf'      —— 机械 / 关节装配（含 joint）→ g_geometry_qc → g_to_urdf
   *   - 'character' —— 角色 / 生物（含 skin/skeleton）→ g_skin_qc → g_bake_object → g_to_rig → rig_preview
   */
  mode: 'static' | 'urdf' | 'character'
  /** 角色路终端节点 id（mode='character' 时非空）。 */
  skinQcNodeId: string
  rigNodeId: string
  rigPreviewNodeId: string
  /** 静态路终端节点 id（mode='static' 时非空）。 */
  sceneNodeId: string
  scenePreviewNodeId: string
}

/** 编译期强制指定管线（override，绕过 DSL 内容推断）。'mechanical' 归一化到 'urdf'。 */
export type PipelineOverride = 'static' | 'mechanical' | 'urdf' | 'character'

// ════════════════════════════════════════════════════════════════════
// op ↔ 电池 双向字段映射
// ════════════════════════════════════════════════════════════════════

type FieldSpec =
  | { arg: string; kind: 'num' | 'str' | 'bool'; field: string }
  | { arg: string; kind: 'vec'; fields: string[] } // list<number> ↔ 标量字段
  | { arg: string; kind: 'ref'; field: string } // ref ↔ 字符串 + 连边
  | { arg: string; kind: 'refList'; field: string } // list<ref> ↔ 字符串数组 + 连边
  | { arg: string; kind: 'list'; field: string } // list 原样透传为数组
  | { arg: string; kind: 'json'; field: string } // 嵌套 list ↔ JSON 字符串端口

interface OpEntry {
  /** DSL op 名（graph→DSL 反向重建用）。 */
  op: string
  /** 该 op 对应的电池 id；joint 等按语句内容动态解析。 */
  battery: string | ((stmt: Statement) => string | null)
  /** 字段映射；未列出的 op 用 generic（arg 名即字段名）。 */
  fields?: FieldSpec[]
  /** 反向重建时注入的固定 args（如 g_joint_fixed 的 type="fixed"）。 */
  reverseFixedArgs?: Record<string, Arg>
  /** 正向编译时注入的固定电池 params（如 chamfer → g_fillet{type:'chamfer'}）。 */
  fixedParams?: Record<string, unknown>
}

const VEC = (arg: string, fields: string[]): FieldSpec => ({ arg, kind: 'vec', fields })

/** joint 语句 → 具体 joint 电池 id（按 type + mimic 判定）。 */
function resolveJointBattery(stmt: Statement): string | null {
  if (stmt.args.mimic_joint) return 'g_joint_mimic'
  const type = stmt.args.type?.kind === 'string' ? stmt.args.type.value : 'fixed'
  switch (type) {
    case 'fixed': return 'g_joint_fixed'
    case 'revolute': return 'g_joint_revolute'
    case 'continuous': return 'g_joint_continuous'
    case 'prismatic': return 'g_joint_prismatic'
    case 'planar': return 'g_joint_planar'
    case 'floating': return 'g_joint_floating'
    default: return null
  }
}

const JOINT_FIELDS: FieldSpec[] = [
  { arg: 'parent', kind: 'ref', field: 'parent_id' },
  { arg: 'child', kind: 'ref', field: 'child_id' },
  VEC('axis', ['ax', 'ay', 'az']),
  { arg: 'lower', kind: 'num', field: 'lower' },
  { arg: 'upper', kind: 'num', field: 'upper' },
  VEC('origin', ['ox', 'oy', 'oz']),
  VEC('rpy', ['rr', 'rp', 'ry']),
  { arg: 'effort', kind: 'num', field: 'effort' },
  { arg: 'velocity', kind: 'num', field: 'velocity' },
  // mimic 专属
  { arg: 'type', kind: 'str', field: 'type' },
  { arg: 'mimic_joint', kind: 'ref', field: 'source_joint_id' },
  { arg: 'mimic_multiplier', kind: 'num', field: 'multiplier' },
  { arg: 'mimic_offset', kind: 'num', field: 'offset' },
]

/**
 * 特例映射表（含 ref / 向量拆分 / 非同名字段的 op）。
 * 表外的 op（gears / architecture / composite parts 等，均无 ref 参数）走 generic。
 */
const OP_TABLE: Record<string, OpEntry> = {
  // — Primitives —
  box: { op: 'box', battery: 'g_box', fields: [VEC('size', ['w', 'd', 'h'])] },
  mesh: {
    op: 'mesh',
    battery: 'g_mesh',
    fields: [
      { arg: 'filename', kind: 'str', field: 'filename' },
      VEC('scale', ['sx', 'sy', 'sz']),
      { arg: 'bbox_min', kind: 'list', field: 'bbox_min' },
      { arg: 'bbox_max', kind: 'list', field: 'bbox_max' },
    ],
  },

  // — Architecture —
  // Architecture DSL uses compact vector fields (`size`, `footprint`,
  // `panel_size`), while the editor batteries expose separate scalar ports.
  // Keep the adapters explicit: generic name-to-name forwarding silently made
  // slabs, roofs, panels and windows fall back to their editor defaults.
  wall: {
    op: 'wall',
    battery: 'g_wall',
    fields: [
      { arg: 'length', kind: 'num', field: 'length' },
      { arg: 'height', kind: 'num', field: 'height' },
      { arg: 'thickness', kind: 'num', field: 'thickness' },
      { arg: 'openings', kind: 'json', field: 'openings' },
      { arg: 'plinth_height', kind: 'num', field: 'plinth_height' },
      { arg: 'plinth_projection', kind: 'num', field: 'plinth_projection' },
      { arg: 'window_band', kind: 'bool', field: 'window_band' },
      { arg: 'band_sill', kind: 'num', field: 'band_sill' },
      { arg: 'band_head', kind: 'num', field: 'band_head' },
      { arg: 'band_margin', kind: 'num', field: 'band_margin' },
      { arg: 'pane_width', kind: 'num', field: 'pane_width' },
      { arg: 'mullion', kind: 'num', field: 'mullion' },
    ],
  },
  floor_slab: {
    op: 'floor_slab',
    battery: 'g_floor_slab',
    fields: [
      VEC('size', ['width', 'depth']),
      { arg: 'thickness', kind: 'num', field: 'thickness' },
      { arg: 'holes', kind: 'json', field: 'holes' },
      { arg: 'beam_depth', kind: 'num', field: 'beam_depth' },
      { arg: 'beam_width', kind: 'num', field: 'beam_width' },
      { arg: 'edge_chamfer', kind: 'num', field: 'edge_chamfer' },
    ],
  },
  roof: {
    op: 'roof',
    battery: 'g_roof',
    fields: [
      VEC('footprint', ['width', 'depth']),
      { arg: 'type', kind: 'str', field: 'type' },
      { arg: 'height', kind: 'num', field: 'height' },
      { arg: 'thickness', kind: 'num', field: 'thickness' },
      { arg: 'overhang', kind: 'num', field: 'overhang' },
      { arg: 'eave_overhang', kind: 'num', field: 'eave_overhang' },
      { arg: 'verge_overhang', kind: 'num', field: 'verge_overhang' },
      { arg: 'parapet_height', kind: 'num', field: 'parapet_height' },
      { arg: 'parapet_thickness', kind: 'num', field: 'parapet_thickness' },
      { arg: 'coping_width', kind: 'num', field: 'coping_width' },
    ],
  },
  facade_panel: {
    op: 'facade_panel',
    battery: 'g_facade_panel',
    fields: [
      VEC('panel_size', ['panel_w', 'panel_h']),
      { arg: 'thickness', kind: 'num', field: 'thickness' },
      { arg: 'orientation', kind: 'str', field: 'orientation' },
      { arg: 'groove_count', kind: 'num', field: 'groove_count' },
      { arg: 'groove_depth', kind: 'num', field: 'groove_depth' },
      { arg: 'groove_width', kind: 'num', field: 'groove_width' },
      { arg: 'groove_direction', kind: 'str', field: 'groove_direction' },
      { arg: 'groove_spacing', kind: 'num', field: 'groove_spacing' },
      { arg: 'board_style', kind: 'str', field: 'board_style' },
    ],
  },
  window: {
    op: 'window',
    battery: 'g_window',
    fields: [
      VEC('size', ['width', 'height']),
      { arg: 'depth', kind: 'num', field: 'depth' },
      { arg: 'frame', kind: 'num', field: 'frame' },
      { arg: 'mullion', kind: 'num', field: 'mullion' },
      { arg: 'glass', kind: 'num', field: 'glass' },
      { arg: 'type', kind: 'str', field: 'type' },
      { arg: 'rows', kind: 'num', field: 'rows' },
      { arg: 'cols', kind: 'num', field: 'cols' },
      { arg: 'pane_width', kind: 'num', field: 'pane_width' },
      { arg: 'sill', kind: 'num', field: 'sill' },
      { arg: 'arch_top', kind: 'bool', field: 'arch_top' },
    ],
  },
  door_frame: {
    op: 'door_frame',
    battery: 'g_door_frame',
    fields: [
      VEC('size', ['width', 'height']),
      { arg: 'depth', kind: 'num', field: 'depth' },
      { arg: 'frame', kind: 'num', field: 'frame' },
      { arg: 'transom', kind: 'num', field: 'transom' },
      { arg: 'sidelight', kind: 'num', field: 'sidelight' },
    ],
  },
  door_leaf: {
    op: 'door_leaf',
    battery: 'g_door_leaf',
    fields: [
      VEC('size', ['width', 'height']),
      { arg: 'thickness', kind: 'num', field: 'thickness' },
      { arg: 'hinge', kind: 'str', field: 'hinge' },
      { arg: 'style', kind: 'str', field: 'style' },
      { arg: 'panel_rows', kind: 'num', field: 'panel_rows' },
      { arg: 'panel_cols', kind: 'num', field: 'panel_cols' },
    ],
  },
  // "boulder" 是 "rock" 的同义 op（同一电池 g_rock）；boulder 条目放前面、rock 放后面——
  // buildBatteryIndex() 按 OP_TABLE 遍历顺序覆写 g_rock 反查条目，后者胜出，
  // 确保 graphToDsl 反解统一落回 "rock"（boulder 只在正向编译时可用，不保证反解回 boulder）。
  boulder: {
    op: 'boulder',
    battery: 'g_rock',
    fields: [
      { arg: 'radius', kind: 'num', field: 'radius' },
      { arg: 'irregularity', kind: 'num', field: 'irregularity' },
      { arg: 'seed', kind: 'num', field: 'seed' },
      { arg: 'detail', kind: 'num', field: 'detail' },
      VEC('stretch', ['sx', 'sy', 'sz']),
    ],
  },
  rock: {
    op: 'rock',
    battery: 'g_rock',
    fields: [
      { arg: 'radius', kind: 'num', field: 'radius' },
      { arg: 'irregularity', kind: 'num', field: 'irregularity' },
      { arg: 'seed', kind: 'num', field: 'seed' },
      { arg: 'detail', kind: 'num', field: 'detail' },
      VEC('stretch', ['sx', 'sy', 'sz']),
    ],
  },
  // sdf_blob：primitives/operations 是嵌套 list（定长 tuple，见 op-registry.ts 描述），
  // 走 'json' 编码（电池侧以 JSON 字符串收发，DSL 层仍是真正的嵌套 list Arg）——
  // 与 wall.openings / floor_slab.holes 同一模式。
  sdf_blob: {
    op: 'sdf_blob',
    battery: 'g_sdf_blob',
    fields: [
      { arg: 'primitives', kind: 'json', field: 'primitives' },
      { arg: 'operations', kind: 'json', field: 'operations' },
      { arg: 'resolution', kind: 'num', field: 'resolution' },
      { arg: 'bounds', kind: 'list', field: 'bounds' },
    ],
  },

  // — Material —
  texture: {
    op: 'texture',
    battery: 'g_texture',
    fields: [
      { arg: 'image', kind: 'str', field: 'image' },
      VEC('repeat', ['repeat_u', 'repeat_v']),
      VEC('offset', ['offset_u', 'offset_v']),
      { arg: 'rotation', kind: 'num', field: 'rotation' },
    ],
  },
  material: {
    op: 'material',
    battery: 'g_material',
    fields: [
      VEC('rgba', ['r', 'g', 'b', 'a']),
      { arg: 'texture', kind: 'ref', field: 'texture_id' },
      { arg: 'metalness', kind: 'num', field: 'metalness' },
      { arg: 'roughness', kind: 'num', field: 'roughness' },
    ],
  },

  // — CSG (refs) —
  extrude: {
    op: 'extrude',
    battery: 'g_extrude',
    fields: [
      { arg: 'profile', kind: 'ref', field: 'profile_id' },
      { arg: 'height', kind: 'num', field: 'height' },
      { arg: 'center', kind: 'bool', field: 'center' },
    ],
  },
  extrude_with_holes: {
    op: 'extrude_with_holes',
    battery: 'g_extrude_with_holes',
    fields: [
      { arg: 'outer', kind: 'ref', field: 'outer_id' },
      { arg: 'holes', kind: 'refList', field: 'hole_ids' },
      { arg: 'height', kind: 'num', field: 'height' },
      { arg: 'center', kind: 'bool', field: 'center' },
    ],
  },
  union: {
    op: 'union',
    battery: 'g_union',
    fields: [{ arg: 'a', kind: 'ref', field: 'a_id' }, { arg: 'b', kind: 'ref', field: 'b_id' }],
  },
  difference: {
    op: 'difference',
    battery: 'g_difference',
    fields: [{ arg: 'base', kind: 'ref', field: 'base_id' }, { arg: 'tool', kind: 'ref', field: 'tool_id' }],
  },
  intersection: {
    op: 'intersection',
    battery: 'g_intersection',
    fields: [{ arg: 'a', kind: 'ref', field: 'a_id' }, { arg: 'b', kind: 'ref', field: 'b_id' }],
  },
  revolve: { op: 'revolve', battery: 'g_revolve', fields: [{ arg: 'profile', kind: 'ref', field: 'profile_id' }] },
  loft: {
    op: 'loft',
    battery: 'g_loft',
    fields: [
      { arg: 'profiles', kind: 'refList', field: 'profile_ids' },
      { arg: 'height', kind: 'num', field: 'height' },
      { arg: 'z_values', kind: 'list', field: 'z_values' },
      { arg: 'ruled', kind: 'bool', field: 'ruled' },
    ],
  },
  sweep: {
    op: 'sweep',
    battery: 'g_sweep',
    fields: [
      { arg: 'profile', kind: 'ref', field: 'profile_id' },
      { arg: 'path', kind: 'list', field: 'path' },
      { arg: 'ruled', kind: 'bool', field: 'ruled' },
      { arg: 'spline', kind: 'str', field: 'spline' },
      { arg: 'samples_per_segment', kind: 'num', field: 'samples_per_segment' },
      { arg: 'align', kind: 'bool', field: 'align' },
      { arg: 'closed', kind: 'bool', field: 'closed' },
      { arg: 'cap', kind: 'bool', field: 'cap' },
      { arg: 'up_hint', kind: 'list', field: 'up_hint' },
    ],
  },
  fillet: {
    op: 'fillet',
    battery: 'g_fillet',
    // g_fillet 用 type 选 fillet/chamfer；正向注入 type=round 确保执行成圆角、反向也能判回 fillet。
    fixedParams: { type: 'round' },
    fields: [
      { arg: 'shape', kind: 'ref', field: 'shape_id' },
      { arg: 'radius', kind: 'num', field: 'radius' },
      { arg: 'edges', kind: 'str', field: 'edges' },
    ],
  },
  chamfer: {
    op: 'chamfer',
    battery: 'g_fillet',
    // g_fillet 用 type 选择 op；正向必须注入 type=chamfer（否则执行成 fillet、round-trip 也丢 chamfer）。
    fixedParams: { type: 'chamfer' },
    fields: [
      { arg: 'shape', kind: 'ref', field: 'shape_id' },
      { arg: 'radius', kind: 'num', field: 'radius' },
      { arg: 'edges', kind: 'str', field: 'edges' },
    ],
  },

  // — Transforms (refs + vec) —
  translate: {
    op: 'translate',
    battery: 'g_translate',
    fields: [{ arg: 'shape', kind: 'ref', field: 'shape_id' }, VEC('offset', ['x', 'y', 'z'])],
  },
  rotate: {
    op: 'rotate',
    battery: 'g_rotate',
    fields: [
      { arg: 'shape', kind: 'ref', field: 'shape_id' },
      { arg: 'angle_deg', kind: 'num', field: 'angle_deg' },
      VEC('axis', ['ax', 'ay', 'az']),
      VEC('origin', ['ox', 'oy', 'oz']),
    ],
  },
  scale: {
    op: 'scale',
    battery: 'g_scale',
    fields: [
      { arg: 'shape', kind: 'ref', field: 'shape_id' },
      { arg: 'factor', kind: 'num', field: 'factor' },
      VEC('center', ['cx', 'cy', 'cz']),
    ],
  },
  mirror: {
    op: 'mirror',
    battery: 'g_mirror',
    fields: [
      { arg: 'shape', kind: 'ref', field: 'shape_id' },
      { arg: 'plane', kind: 'str', field: 'plane' },
      VEC('origin', ['ox', 'oy', 'oz']),
    ],
  },
  array_linear: {
    op: 'array_linear',
    battery: 'g_array_linear',
    fields: [
      { arg: 'shape', kind: 'ref', field: 'shape_id' },
      { arg: 'count', kind: 'num', field: 'count' },
      VEC('step', ['dx', 'dy', 'dz']),
    ],
  },
  array_radial: {
    op: 'array_radial',
    battery: 'g_array_radial',
    fields: [
      { arg: 'shape', kind: 'ref', field: 'shape_id' },
      { arg: 'count', kind: 'num', field: 'count' },
      { arg: 'angle_deg', kind: 'num', field: 'angle_deg' },
      VEC('axis', ['ax', 'ay', 'az']),
      VEC('origin', ['ox', 'oy', 'oz']),
    ],
  },

  // — Architecture assembly macro (refs) —
  // storey_stack rewrites the storey into plain part/joint lines at runtime (merged
  // into one baked GLB by default), so only its own statement needs a mapping; the
  // rewrite never re-enters the compiler.
  storey_stack: {
    op: 'storey_stack',
    battery: 'g_storey_stack',
    fields: [
      { arg: 'parts', kind: 'refList', field: 'part_ids' },
      { arg: 'root', kind: 'ref', field: 'root_id' },
      { arg: 'mode', kind: 'str', field: 'mode' },
      { arg: 'count', kind: 'num', field: 'count' },
      { arg: 'storey_height', kind: 'num', field: 'storey_height' },
      { arg: 'levels', kind: 'list', field: 'levels' },
      { arg: 'prefix', kind: 'str', field: 'prefix' },
    ],
  },

  // — Part —
  part: {
    op: 'part',
    battery: 'g_part',
    fields: [
      { arg: 'shape', kind: 'ref', field: 'shape_id' },
      { arg: 'material', kind: 'ref', field: 'material_id' },
      VEC('origin', ['ox', 'oy', 'oz']),
      VEC('rpy', ['rr', 'rp', 'ry']),
      { arg: 'mass', kind: 'num', field: 'mass' },
    ],
  },
  align_centers: {
    op: 'align_centers',
    battery: 'g_align_centers',
    fields: [
      { arg: 'parent', kind: 'ref', field: 'parent_id' },
      { arg: 'child', kind: 'ref', field: 'child_id' },
      { arg: 'axes', kind: 'str', field: 'axes' },
    ],
  },
  place_on_face: {
    op: 'place_on_face',
    battery: 'g_place_on_face',
    fields: [
      { arg: 'parent', kind: 'ref', field: 'parent_id' },
      { arg: 'child', kind: 'ref', field: 'child_id' },
      { arg: 'face', kind: 'str', field: 'face' },
      { arg: 'face_u', kind: 'num', field: 'face_u' },
      { arg: 'face_v', kind: 'num', field: 'face_v' },
      { arg: 'proud', kind: 'num', field: 'proud' },
    ],
  },
  place_local: {
    op: 'place_local',
    battery: 'g_place_local',
    fields: [
      { arg: 'parent', kind: 'ref', field: 'parent_id' },
      { arg: 'child', kind: 'ref', field: 'child_id' },
      VEC('offset', ['ox', 'oy', 'oz']),
      VEC('rpy', ['rr', 'rp', 'ry']),
    ],
  },
  place_on_surface: {
    op: 'place_on_surface',
    battery: 'g_place_on_surface',
    fields: [
      { arg: 'parent', kind: 'ref', field: 'parent_id' },
      { arg: 'child', kind: 'ref', field: 'child_id' },
      { arg: 'mode', kind: 'str', field: 'mode' },
      VEC('direction', ['dx', 'dy', 'dz']),
      VEC('point', ['px', 'py', 'pz']),
      { arg: 'child_axis', kind: 'str', field: 'child_axis' },
      { arg: 'clearance', kind: 'num', field: 'clearance' },
      { arg: 'spin', kind: 'num', field: 'spin' },
      VEC('up_hint', ['upx', 'upy', 'upz']),
    ],
  },

  // — Joint (type-dispatched) —
  joint: { op: 'joint', battery: resolveJointBattery, fields: JOINT_FIELDS },

  // — Collision / Inertial (refs) —
  collision: {
    op: 'collision',
    battery: 'g_collision_box',
    fields: [{ arg: 'link', kind: 'ref', field: 'part_id' }],
  },
  inertial: {
    op: 'inertial',
    battery: 'g_inertial_from_geometry',
    fields: [
      { arg: 'link', kind: 'ref', field: 'part_id' },
      { arg: 'mass', kind: 'num', field: 'mass' },
      VEC('origin', ['ox', 'oy', 'oz']),
      { arg: 'ixx', kind: 'num', field: 'ixx' },
      { arg: 'ixy', kind: 'num', field: 'ixy' },
      { arg: 'ixz', kind: 'num', field: 'ixz' },
      { arg: 'iyy', kind: 'num', field: 'iyy' },
      { arg: 'iyz', kind: 'num', field: 'iyz' },
      { arg: 'izz', kind: 'num', field: 'izz' },
    ],
  },
  animation: { op: 'animation', battery: 'g_bake_animation' },

  // — Character rig (bone / skeleton / skin) —
  bone: {
    op: 'bone',
    battery: 'g_bone',
    fields: [
      { arg: 'parent', kind: 'ref', field: 'parent_id' },
      { arg: 'source_part', kind: 'ref', field: 'source_part_id' },
      VEC('origin', ['hx', 'hy', 'hz']),
      VEC('tail', ['tx', 'ty', 'tz']),
      // 弯曲铰链轴（模型根帧）：作者在 DSL 写 axis=[…]；缺省前端启发式推。
      VEC('axis', ['ax', 'ay', 'az']),
      VEC('rpy', ['rr', 'rp', 'ry']),
    ],
  },
  bone_chain: {
    op: 'bone_chain',
    battery: 'g_bone_chain',
    fields: [
      { arg: 'parent', kind: 'ref', field: 'parent_id' },
      { arg: 'source_part', kind: 'ref', field: 'source_part_id' },
      VEC('origin', ['hx', 'hy', 'hz']),
      VEC('tail', ['tx', 'ty', 'tz']),
      { arg: 'count', kind: 'num', field: 'count' },
      // 弯曲铰链轴（模型根帧），应用到链上每一段。
      VEC('axis', ['ax', 'ay', 'az']),
    ],
  },
  skeleton: {
    op: 'skeleton',
    battery: 'g_skeleton',
    fields: [{ arg: 'root', kind: 'ref', field: 'root_id' }],
  },
  skin: {
    op: 'skin',
    battery: 'g_skin',
    fields: [
      { arg: 'skeleton', kind: 'ref', field: 'skeleton_id' },
      { arg: 'mesh', kind: 'ref', field: 'mesh_id' },
      { arg: 'method', kind: 'str', field: 'method' },
      { arg: 'resolution', kind: 'num', field: 'resolution' },
      { arg: 'max_influences', kind: 'num', field: 'max_influences' },
      { arg: 'falloff', kind: 'num', field: 'falloff' },
    ],
  },
}

/** 无 ref 参数、字段名与 arg 名一致的 op → 走 generic 映射，仅需知道电池 id。 */
const GENERIC_BATTERY: Record<string, string> = {
  cylinder: 'g_cylinder',
  sphere: 'g_sphere',
  cone: 'g_cone',
  capsule: 'g_capsule',
  torus: 'g_torus',
  dome: 'g_dome',
  profile_rect: 'g_profile_rect',
  profile_circle: 'g_profile_circle',
  profile_polygon: 'g_profile_polygon',
  profile_rounded_rect: 'g_profile_rounded_rect',
  profile_regular_polygon: 'g_profile_regular_polygon',
  // CSG mesh ops（无 ref、arg 名即字段名；直接产 mesh，不能作布尔输入）
  pipe: 'g_pipe',
  section_loft: 'g_section_loft',
  // 注：机械件/齿轮家族（clevis_bracket/wheel/spur_gear/…）已随对应电池一起在
  // 3b752a7c（"重整 Generate/Parts 为 CAD/Parts"）中删除——电池实现从未迁移到
  // 承诺的 CAD/Parts 目录，保留这些映射会让 op-registry 校验通过、但在图导入阶段
  // 报不出电池目录的 "unknown opId"。baker 层的形状构建代码仍保留在
  // backend/src/services/baker/ops/*（供 baker-gears-all.smoke.ts 等内部测试直接调用），
  // 但已不再是 DSL 可达 op——不要在这里重新加映射，除非同时把电池实现补回来。
  // Architecture
  stairs: 'g_stairs',
  railing: 'g_railing',
  column: 'g_column',
}

const TERMINAL_QC_BATTERY = 'g_geometry_qc'
const TERMINAL_METRICS_BATTERY = 'g_metrics'
const TERMINAL_URDF_BATTERY = 'g_to_urdf'

// — Character（角色路）终端链电池 —
const TERMINAL_SKIN_QC_BATTERY = 'g_skin_qc'
const TERMINAL_BAKE_OBJECT_BATTERY = 'g_bake_object'
const TERMINAL_RIG_BATTERY = 'g_to_rig'
const TERMINAL_RIG_PREVIEW_BATTERY = 'rig_preview'

// — Static（静态路）终端链电池 —
const TERMINAL_SCENE_BATTERY = 'g_to_scene'
const TERMINAL_SCENE_PREVIEW_BATTERY = 'scene_preview'

/** 非语句（编译器自动追加）的终端电池集合——graphToDsl 反解时跳过。 */
const TERMINAL_BATTERIES: ReadonlySet<string> = new Set([
  TERMINAL_QC_BATTERY,
  TERMINAL_URDF_BATTERY,
  TERMINAL_SKIN_QC_BATTERY,
  TERMINAL_BAKE_OBJECT_BATTERY,
  TERMINAL_RIG_BATTERY,
  TERMINAL_RIG_PREVIEW_BATTERY,
  TERMINAL_SCENE_BATTERY,
  TERMINAL_SCENE_PREVIEW_BATTERY,
])

/** DSL 含 bone / skeleton / skin 算子即判定为"角色路"。 */
function isCharacterDsl(statements: readonly Statement[]): boolean {
  return statements.some(
    (s) => s.op === 'skin' || s.op === 'skeleton' || s.op === 'bone' || s.op === 'bone_chain',
  )
}

/** 显式 rig 算子（skin/skeleton/bone/bone_chain）—— 与 joint 并存即判混合模型冲突（机械与角色分文件）。 */
function hasExplicitRig(statements: readonly Statement[]): boolean {
  return statements.some(
    (s) => s.op === 'skin' || s.op === 'skeleton' || s.op === 'bone' || s.op === 'bone_chain',
  )
}

/**
 * 三路管线判定（从 DSL 内容推断，可被 override 强制覆盖）：
 *   - 含 bone/bone_chain/skeleton/skin → 'character'（角色/生物软体蒙皮）
 *   - 含 joint              → 'urdf'（机械/关节装配）
 *   - 两者皆无              → 'static'（纯静态物体 / 场景组装 → 单个 .glb）
 */
function resolvePipelineMode(
  statements: readonly Statement[],
  override?: PipelineOverride,
): 'static' | 'urdf' | 'character' {
  if (override) return override === 'mechanical' ? 'urdf' : override
  if (isCharacterDsl(statements)) return 'character'
  if (statements.some((s) => s.op === 'joint')) return 'urdf'
  return 'static'
}

/**
 * 静态路是否需要先 g_bake_object 把真形状 part 合并成单个多材质 GLB。
 * 判据：存在**任一**引用真形状（非已 bake 的 mesh）的 part。
 *
 * 真形状件与 mesh-ref 件可以共存，两者分区处理、互不吞并：
 *   - 真形状 part  → 进合并 GLB（bake 的 `filename` → g_to_scene 的 `object_filename`）
 *   - mesh-ref part → 各自一条 SceneSpec item（g_to_scene 现有逻辑，与 object_filename 并存）
 * 所以这里不能因为看到一个 mesh-ref part 就短路成"不烘焙"——那会把手写的真形状件静默丢掉。
 * 分区靠给 bake 节点传 include_mesh_parts=false 落实（见 STATIC_BAKE_PARAMS）。
 */
function staticNeedsObjectBake(statements: readonly Statement[]): boolean {
  const byId = new Map(statements.map((s) => [s.id, s]))
  for (const p of statements) {
    if (p.op !== 'part') continue
    const shapeRef = p.args.shape
    if (!shapeRef || shapeRef.kind !== 'ref') continue
    const shape = byId.get(shapeRef.name)
    if (!shape) continue
    if (shape.op !== 'mesh') return true
  }
  return false
}

/**
 * 静态路 bake 节点的固定 params：只烘真形状 part。mesh-ref part 由 g_to_scene 各列一条
 * item，两边都收会让同一件在场景里出现两遍。
 */
const STATIC_BAKE_PARAMS: Readonly<Record<string, unknown>> = { include_mesh_parts: false }

/**
 * 角色路 bake 节点的固定 params：必须收 mesh-ref part——它正是靠回读逐件预烘的
 * `<sha>.obj` 合并成单张可蒙皮网格。这里显式传 `true`，不依赖 `g_bake_object` 电池的
 * 默认值：默认值只是给手工搭图/手改图的人一个"多数场景下更常用"的兜底，编译器生成的图
 * 不应该依赖它——以后若默认值改了，角色路不能跟着默默改变行为。
 */
const CHARACTER_BAKE_PARAMS: Readonly<Record<string, unknown>> = { include_mesh_parts: true }

// ── Arg 读写辅助 ─────────────────────────────────────────────────────────────

function argToJs(a: Arg): unknown {
  switch (a.kind) {
    case 'number': return a.value
    case 'string': return a.value
    case 'bool': return a.value
    case 'ref': return a.name
    case 'list': return a.items.map(argToJs)
  }
}

/** 反向：JS 值 → Arg（generic 用；仅出现于无 ref 的 op，故 string → str 无歧义）。 */
function jsToArg(v: unknown): Arg | null {
  if (typeof v === 'number') return { kind: 'number', value: v }
  if (typeof v === 'boolean') return { kind: 'bool', value: v }
  if (typeof v === 'string') return { kind: 'string', value: v }
  if (Array.isArray(v)) {
    const items = v.map(jsToArg).filter((x): x is Arg => x !== null)
    return { kind: 'list', items }
  }
  return null
}

function num(v: number): Arg { return { kind: 'number', value: v } }
function readVecArg(a: Arg): number[] | null {
  if (a.kind !== 'list') return null
  const out: number[] = []
  for (const it of a.items) {
    if (it.kind !== 'number') return null
    out.push(it.value)
  }
  return out
}

// ════════════════════════════════════════════════════════════════════
// forward: statement → { params, refEdges }
// ════════════════════════════════════════════════════════════════════

interface ForwardOut {
  batteryId: string
  params: Record<string, unknown>
  /** ref 连边：目标端口 ← 被引用的语句 id 列表。 */
  refs: Array<{ port: string; ids: string[] }>
}

function forwardStatement(stmt: Statement, character = false): ForwardOut | { error: string } {
  const entry = OP_TABLE[stmt.op]
  let batteryId = entry
    ? (typeof entry.battery === 'function' ? entry.battery(stmt) : entry.battery)
    : GENERIC_BATTERY[stmt.op] ?? null

  // 角色路：`animation` 语句的通道键是骨骼名（非 URDF 关节名），走 g_bake_skin_animation
  // （对照 bone 校验、不做限位夹取），而不是关节路的 g_bake_animation。
  if (character && stmt.op === 'animation') batteryId = 'g_bake_skin_animation'

  if (!batteryId) {
    return { error: `op "${stmt.op}" has no battery mapping (unknown or unmapped op)` }
  }

  const params: Record<string, unknown> = { id: stmt.id, ...(entry?.fixedParams ?? {}) }
  const refs: Array<{ port: string; ids: string[] }> = []

  if (!entry?.fields) {
    // generic：arg 名即字段名（无 ref op）
    for (const [k, v] of Object.entries(stmt.args)) params[k] = argToJs(v)
    return { batteryId, params, refs }
  }

  for (const spec of entry.fields) {
    const arg = stmt.args[spec.arg]
    if (arg === undefined) continue
    switch (spec.kind) {
      case 'num':
        if (arg.kind === 'number') params[spec.field] = arg.value
        break
      case 'str':
        if (arg.kind === 'string') params[spec.field] = arg.value
        break
      case 'bool':
        if (arg.kind === 'bool') params[spec.field] = arg.value
        break
      case 'vec': {
        const vals = readVecArg(arg)
        if (vals) spec.fields.forEach((f, i) => { if (i < vals.length) params[f] = vals[i] })
        break
      }
      case 'list':
        params[spec.field] = argToJs(arg)
        break
      case 'json':
        params[spec.field] = JSON.stringify(argToJs(arg))
        break
      case 'ref':
        if (arg.kind === 'ref') {
          params[spec.field] = arg.name
          refs.push({ port: spec.field, ids: [arg.name] })
        }
        break
      case 'refList':
        if (arg.kind === 'list') {
          const ids = arg.items.filter((i) => i.kind === 'ref').map((i) => (i as { name: string }).name)
          params[spec.field] = ids
          // NB: do NOT wire id→port edges for a ref-LIST. A runtime input port is
          // single-valued (resolveNodeInputs is last-write-wins), so N edges into
          // one port collapse to a single id, and that wire value then shadows the
          // correct `ids` array in node.params (dataInputs override params in the
          // layer1 executor) — loft/extrude_with_holes then only see 1 id and fail
          // "must contain at least two profile ids". The list travels via the params
          // array above; the battery validates each id against the linear geometry
          // chain, so no per-id edge is needed. (Single `ref` still wires an edge.)
        }
        break
    }
  }
  return { batteryId, params, refs }
}

// ════════════════════════════════════════════════════════════════════
// compileDslToGraph
// ════════════════════════════════════════════════════════════════════

export interface CompileOptions {
  graphId?: string
  graphName?: string
  /** 是否追加终端 QC + 导出节点（默认 true）。 */
  appendTerminals?: boolean
  /** 强制指定管线（绕过 DSL 内容推断）；'mechanical' 归一化到 'urdf'。 */
  pipeline?: PipelineOverride
}

export function compileDslToGraph(source: string, opts: CompileOptions = {}): CompileResult {
  const { statements, errors: parseErrors } = parseDSL(source)
  const { errors: semErrors } = validateStatements(statements)

  const errors: CompileError[] = [
    ...parseErrors.map((e) => ({ line: e.line, message: e.message, kind: e.kind })),
    ...semErrors.map((e) => ({ line: e.line, message: e.message, kind: e.kind })),
  ]

  // 阻断性错误：parse 错误 / 重复 id / 未映射 op（不能建出可导入的图）
  const dupIds = new Set(semErrors.filter((e) => e.kind === 'duplicate-id').map((e) => e.line))
  let blocking = parseErrors.length > 0 || dupIds.size > 0

  // 三路管线判定（可被 opts.pipeline 强制覆盖）。
  const mode = resolvePipelineMode(statements, opts.pipeline)
  const character = mode === 'character'

  // 混合模型护栏：同一 DSL 既有角色 skin/skeleton 又有 URDF joint —— 两条终端链互斥，
  // 走哪条都会丢弃另一半语义。显式报错并提示分文件（后续可再议 hybrid rig）。
  if (hasExplicitRig(statements)) {
    const jointStmt = statements.find((s) => s.op === 'joint')
    if (jointStmt) {
      errors.push({
        line: jointStmt.line,
        message:
          'mixed model: this DSL has both character skin/skeleton and URDF joint() statements. ' +
          'These take mutually-exclusive compile paths — split the articulated (URDF) parts and the ' +
          'skinned character into separate files.',
        kind: 'bad-arg',
      })
      blocking = true
    }
  }

  // 预解析每条语句的 battery + params，未映射 op → 显式错误（带行号）
  const forwards: Array<{ stmt: Statement; fwd: ForwardOut }> = []
  for (const stmt of statements) {
    const fwd = forwardStatement(stmt, character)
    if ('error' in fwd) {
      errors.push({ line: stmt.line, message: fwd.error, kind: 'unmapped-op' })
      blocking = true
      continue
    }
    forwards.push({ stmt, fwd })
  }

  errors.sort((a, b) => a.line - b.line)

  if (blocking) {
    return {
      ok: false,
      graph: null,
      errors,
      lineByNodeId: {},
      statementNodeIds: [],
      qcNodeId: '',
      metricsNodeId: '',
      urdfNodeId: '',
      mode,
      skinQcNodeId: '',
      rigNodeId: '',
      rigPreviewNodeId: '',
      sceneNodeId: '',
      scenePreviewNodeId: '',
    }
  }

  // 结构良好 → 建图
  const nodes: CompiledNode[] = []
  const edges: CompiledEdge[] = []
  const lineByNodeId: Record<string, number> = {}
  const statementNodeIds: string[] = []
  const usedIds = new Set(statements.map((s) => s.id))

  let x = 0
  let prevGeomNode: string | null = null
  for (const { stmt, fwd } of forwards) {
    const nodeId = stmt.id
    nodes.push({
      id: nodeId,
      batteryId: fwd.batteryId,
      name: `${stmt.id} = ${stmt.op}`,
      position: { x, y: 0 },
      params: fwd.params,
    })
    lineByNodeId[nodeId] = stmt.line
    statementNodeIds.push(nodeId)

    // 线性 geometry 边
    if (prevGeomNode) {
      edges.push({
        id: `e_geom_${prevGeomNode}_${nodeId}`,
        source: { nodeId: prevGeomNode, port: 'geometry' },
        target: { nodeId, port: 'geometry' },
      })
    }
    prevGeomNode = nodeId

    // ref id 边（被引用语句的 id 输出 → 本节点对应输入端口）
    for (const r of fwd.refs) {
      for (const refId of r.ids) {
        if (!usedIds.has(refId)) continue
        edges.push({
          id: `e_ref_${refId}_${nodeId}_${r.port}`,
          source: { nodeId: refId, port: 'id' },
          target: { nodeId, port: r.port },
        })
      }
    }
    x += 220
  }

  const appendTerminals = opts.appendTerminals !== false
  let qcNodeId = ''
  let metricsNodeId = ''
  let urdfNodeId = ''
  let skinQcNodeId = ''
  let rigNodeId = ''
  let rigPreviewNodeId = ''
  let sceneNodeId = ''
  let scenePreviewNodeId = ''

  const linkGeom = (from: string | null, to: string): void => {
    if (!from) return
    edges.push({
      id: `e_geom_${from}_${to}`,
      source: { nodeId: from, port: 'geometry' },
      target: { nodeId: to, port: 'geometry' },
    })
  }

  // Metrics is deliberately a parallel, read-only terminal. Its score and
  // suggestions never participate in ok/valid, so richer feedback cannot turn
  // an otherwise successful model into a hard failure.
  if (appendTerminals) {
    metricsNodeId = freshTerminalId('metrics', usedIds)
    nodes.push({
      id: metricsNodeId,
      batteryId: TERMINAL_METRICS_BATTERY,
      name: 'Metrics',
      position: { x, y: 180 },
      params: {},
    })
    lineByNodeId[metricsNodeId] = 0
    linkGeom(prevGeomNode, metricsNodeId)
  }

  if (appendTerminals && mode === 'character') {
    // 角色路终端链：… → g_skin_qc → g_bake_object（合并可蒙皮网格） → g_to_rig（RigSpec）→ rig_preview
    skinQcNodeId = freshTerminalId('skin_qc', usedIds)
    const bakeNodeId = freshTerminalId('rig_bake', usedIds)
    rigNodeId = freshTerminalId('rig', usedIds)
    rigPreviewNodeId = freshTerminalId('rig_preview', usedIds)
    nodes.push({ id: skinQcNodeId, batteryId: TERMINAL_SKIN_QC_BATTERY, name: 'SkinQC', position: { x, y: 0 }, params: {} })
    nodes.push({ id: bakeNodeId, batteryId: TERMINAL_BAKE_OBJECT_BATTERY, name: 'BakeObject', position: { x: x + 220, y: 0 }, params: { ...CHARACTER_BAKE_PARAMS } })
    nodes.push({ id: rigNodeId, batteryId: TERMINAL_RIG_BATTERY, name: 'Rig', position: { x: x + 440, y: 0 }, params: {} })
    nodes.push({ id: rigPreviewNodeId, batteryId: TERMINAL_RIG_PREVIEW_BATTERY, name: 'RigPreview', position: { x: x + 660, y: 0 }, params: {} })
    lineByNodeId[skinQcNodeId] = 0
    lineByNodeId[bakeNodeId] = 0
    lineByNodeId[rigNodeId] = 0
    lineByNodeId[rigPreviewNodeId] = 0
    linkGeom(prevGeomNode, skinQcNodeId)
    linkGeom(skinQcNodeId, bakeNodeId)
    linkGeom(bakeNodeId, rigNodeId)
    linkGeom(rigNodeId, rigPreviewNodeId)
    // g_bake_object 产出的合并网格文件名 → g_to_rig 的可蒙皮网格引用
    edges.push({
      id: `e_mesh_${bakeNodeId}_${rigNodeId}`,
      source: { nodeId: bakeNodeId, port: 'filename' },
      target: { nodeId: rigNodeId, port: 'mesh_filename' },
    })
    // g_to_rig 的 rigSpec → rig_preview（供 live-sync 拉取）
    edges.push({
      id: `e_rig_${rigNodeId}_${rigPreviewNodeId}`,
      source: { nodeId: rigNodeId, port: 'rigSpec' },
      target: { nodeId: rigPreviewNodeId, port: 'rigSpec' },
    })
  } else if (appendTerminals && mode === 'static') {
    // 静态路终端链：… → g_geometry_qc → [g_bake_object] → g_to_scene → scene_preview
    // 真形状 part 先 g_bake_object 合并成单个多材质 GLB，mesh-ref part 直接列引用；两者可以
    // 共存于同一个模型（一栋手写墙板 + 若干预烘构件的楼），分区规则见 staticNeedsObjectBake。
    qcNodeId = freshTerminalId('qc', usedIds)
    sceneNodeId = freshTerminalId('scene', usedIds)
    scenePreviewNodeId = freshTerminalId('scene_preview', usedIds)
    const needBake = staticNeedsObjectBake(statements)
    nodes.push({ id: qcNodeId, batteryId: TERMINAL_QC_BATTERY, name: 'QC', position: { x, y: 0 }, params: {} })
    lineByNodeId[qcNodeId] = 0
    linkGeom(prevGeomNode, qcNodeId)
    let chainTail = qcNodeId
    let bakeNodeId = ''
    let colX = x + 220
    if (needBake) {
      bakeNodeId = freshTerminalId('scene_bake', usedIds)
      nodes.push({ id: bakeNodeId, batteryId: TERMINAL_BAKE_OBJECT_BATTERY, name: 'BakeObject', position: { x: colX, y: 0 }, params: { ...STATIC_BAKE_PARAMS } })
      lineByNodeId[bakeNodeId] = 0
      linkGeom(chainTail, bakeNodeId)
      chainTail = bakeNodeId
      colX += 220
    }
    nodes.push({ id: sceneNodeId, batteryId: TERMINAL_SCENE_BATTERY, name: 'Scene', position: { x: colX, y: 0 }, params: {} })
    nodes.push({ id: scenePreviewNodeId, batteryId: TERMINAL_SCENE_PREVIEW_BATTERY, name: 'ScenePreview', position: { x: colX + 220, y: 0 }, params: {} })
    lineByNodeId[sceneNodeId] = 0
    lineByNodeId[scenePreviewNodeId] = 0
    linkGeom(chainTail, sceneNodeId)
    linkGeom(sceneNodeId, scenePreviewNodeId)
    // g_bake_object 合并 GLB 文件名 → g_to_scene 的单物体网格引用
    if (bakeNodeId) {
      edges.push({
        id: `e_mesh_${bakeNodeId}_${sceneNodeId}`,
        source: { nodeId: bakeNodeId, port: 'filename' },
        target: { nodeId: sceneNodeId, port: 'object_filename' },
      })
    }
    // g_to_scene 的 sceneSpec → scene_preview（供 live-sync 拉取）
    edges.push({
      id: `e_scene_${sceneNodeId}_${scenePreviewNodeId}`,
      source: { nodeId: sceneNodeId, port: 'sceneSpec' },
      target: { nodeId: scenePreviewNodeId, port: 'sceneSpec' },
    })
  } else if (appendTerminals) {
    qcNodeId = freshTerminalId('qc', usedIds)
    urdfNodeId = freshTerminalId('urdf', usedIds)
    nodes.push({ id: qcNodeId, batteryId: TERMINAL_QC_BATTERY, name: 'QC', position: { x, y: 0 }, params: {} })
    nodes.push({ id: urdfNodeId, batteryId: TERMINAL_URDF_BATTERY, name: 'URDF', position: { x: x + 220, y: 0 }, params: {} })
    lineByNodeId[qcNodeId] = 0
    lineByNodeId[urdfNodeId] = 0
    linkGeom(prevGeomNode, qcNodeId)
    linkGeom(qcNodeId, urdfNodeId)
  }

  const graph: CompiledGraph = {
    id: opts.graphId,
    name: opts.graphName,
    nodes,
    edges,
    metadata: { source, compiledBy: 'dsl-to-graph', statementCount: statements.length, mode },
  }

  return {
    ok: errors.length === 0,
    graph,
    errors,
    lineByNodeId,
    statementNodeIds,
    qcNodeId,
    metricsNodeId,
    urdfNodeId,
    mode,
    skinQcNodeId,
    rigNodeId,
    rigPreviewNodeId,
    sceneNodeId,
    scenePreviewNodeId,
  }
}

function freshTerminalId(base: string, used: Set<string>): string {
  let id = `__${base}__`
  let i = 1
  while (used.has(id)) id = `__${base}_${i++}__`
  used.add(id)
  return id
}

// ════════════════════════════════════════════════════════════════════
// graphToDsl —— 反向：图 → DSL（round-trip）
// ════════════════════════════════════════════════════════════════════

/** batteryId → OpEntry（反向重建用）。 */
const BATTERY_TO_ENTRY: Record<string, OpEntry> = buildBatteryIndex()

function buildBatteryIndex(): Record<string, OpEntry> {
  const idx: Record<string, OpEntry> = {}
  // 特例表：非函数 battery 直接建索引
  for (const entry of Object.values(OP_TABLE)) {
    if (typeof entry.battery === 'string') idx[entry.battery] = entry
  }
  // joint：6 个电池共享 JOINT_FIELDS，各自注入固定 type
  const jointFixed: Record<string, string> = {
    g_joint_fixed: 'fixed',
    g_joint_revolute: 'revolute',
    g_joint_continuous: 'continuous',
    g_joint_prismatic: 'prismatic',
    g_joint_planar: 'planar',
    g_joint_floating: 'floating',
  }
  for (const [bat, type] of Object.entries(jointFixed)) {
    idx[bat] = { op: 'joint', battery: bat, fields: JOINT_FIELDS, reverseFixedArgs: { type: { kind: 'string', value: type } } }
  }
  idx.g_joint_mimic = { op: 'joint', battery: 'g_joint_mimic', fields: JOINT_FIELDS }
  // generic 电池 → op 名
  for (const [op, bat] of Object.entries(GENERIC_BATTERY)) {
    if (!idx[bat]) idx[bat] = { op, battery: bat }
  }
  // g_fillet 既产 fillet 又产 chamfer：反向按 type 参数决定 op（下方特判）
  idx.g_fillet = { op: 'fillet', battery: 'g_fillet', fields: OP_TABLE.fillet.fields }
  // 角色路的 g_bake_skin_animation 与关节路的 g_bake_animation 都反解为 `animation` 语句
  // （通道键区分骨骼名 / 关节名，反解无需区分——DSL 层同为 animation）。
  idx.g_bake_skin_animation = { op: 'animation', battery: 'g_bake_skin_animation' }
  return idx
}

interface GraphNodeLike {
  id: string
  batteryId: string
  params?: Record<string, unknown>
}

/**
 * 图 → DSL：按 geometry 边的线性顺序遍历语句节点，从各节点 params 反推出 Statement，
 * 再序列化成 DSL 文本。跳过终端 QC / URDF 节点与非语句电池。
 */
export function graphToDsl(
  nodes: readonly GraphNodeLike[],
  edges: readonly CompiledEdge[],
): string {
  const stmtNodes = nodes.filter((n) => !TERMINAL_BATTERIES.has(n.batteryId) && BATTERY_TO_ENTRY[n.batteryId])
  const ordered = orderByGeometryChain(stmtNodes, edges)

  const statements: Statement[] = []
  ordered.forEach((n, index) => {
    const entry = BATTERY_TO_ENTRY[n.batteryId]!
    const params = n.params ?? {}
    const args = paramsToArgs(entry, n.batteryId, params)
    const op = resolveReverseOp(entry, n.batteryId, params)
    const id = typeof params.id === 'string' && params.id ? params.id : n.id
    statements.push(Object.freeze({ id, op, args: Object.freeze(args), line: index + 1 }) as Statement)
  })
  return formatStatements(statements)
}

function resolveReverseOp(entry: OpEntry, batteryId: string, params: Record<string, unknown>): string {
  if (batteryId === 'g_fillet') {
    const t = String(params.type ?? 'round').toLowerCase()
    return t === 'chamfer' ? 'chamfer' : 'fillet'
  }
  return entry.op
}

function paramsToArgs(entry: OpEntry, batteryId: string, params: Record<string, unknown>): Record<string, Arg> {
  const args: Record<string, Arg> = {}
  // 反向固定 args（如 joint type）
  if (entry.reverseFixedArgs) Object.assign(args, entry.reverseFixedArgs)

  if (!entry.fields) {
    for (const [k, v] of Object.entries(params)) {
      if (k === 'id' || k === 'geometry') continue
      const a = jsToArg(v)
      if (a) args[k] = a
    }
    return args
  }

  for (const spec of entry.fields) {
    switch (spec.kind) {
      case 'num': {
        const v = params[spec.field]
        if (typeof v === 'number') args[spec.arg] = num(v)
        break
      }
      case 'str': {
        const v = params[spec.field]
        // g_fillet 的 type 只选 op，不进 DSL args
        if (batteryId === 'g_fillet' && spec.arg === 'type') break
        if (typeof v === 'string' && v !== '') args[spec.arg] = { kind: 'string', value: v }
        break
      }
      case 'bool': {
        const v = params[spec.field]
        if (typeof v === 'boolean') args[spec.arg] = { kind: 'bool', value: v }
        break
      }
      case 'vec': {
        const vals = spec.fields.map((f) => params[f])
        if (vals.every((v) => typeof v === 'number')) {
          args[spec.arg] = { kind: 'list', items: (vals as number[]).map(num) }
        }
        break
      }
      case 'list': {
        const v = params[spec.field]
        if (Array.isArray(v)) {
          const a = jsToArg(v)
          if (a) args[spec.arg] = a
        }
        break
      }
      case 'json': {
        const v = params[spec.field]
        if (typeof v !== 'string' || v === '') break
        try {
          const a = jsToArg(JSON.parse(v))
          if (a) args[spec.arg] = a
        } catch {
          // Keep graphToDsl total for manually edited legacy graphs.
        }
        break
      }
      case 'ref': {
        const v = params[spec.field]
        if (typeof v === 'string' && v !== '') args[spec.arg] = { kind: 'ref', name: v }
        break
      }
      case 'refList': {
        const v = params[spec.field]
        const ids = Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x !== '') as string[] : []
        if (ids.length) args[spec.arg] = { kind: 'list', items: ids.map((n) => ({ kind: 'ref', name: n } as Arg)) }
        break
      }
    }
  }
  return args
}

/** 按 geometry 边把语句节点排成线性链（拓扑序；回退到给定顺序）。 */
function orderByGeometryChain(
  nodes: readonly GraphNodeLike[],
  edges: readonly CompiledEdge[],
): GraphNodeLike[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const geomNext = new Map<string, string>()
  const hasIncomingGeom = new Set<string>()
  for (const e of edges) {
    if (e.source.port !== 'geometry' || e.target.port !== 'geometry') continue
    if (!nodeById.has(e.source.nodeId) || !nodeById.has(e.target.nodeId)) continue
    geomNext.set(e.source.nodeId, e.target.nodeId)
    hasIncomingGeom.add(e.target.nodeId)
  }
  // 起点：无 incoming geometry 的语句节点
  const start = nodes.find((n) => !hasIncomingGeom.has(n.id))
  if (!start) return [...nodes]
  const out: GraphNodeLike[] = []
  const seen = new Set<string>()
  let cur: string | undefined = start.id
  while (cur && nodeById.has(cur) && !seen.has(cur)) {
    seen.add(cur)
    out.push(nodeById.get(cur)!)
    cur = geomNext.get(cur)
  }
  // 补上未被链覆盖的节点（防御）
  for (const n of nodes) if (!seen.has(n.id)) out.push(n)
  return out
}
