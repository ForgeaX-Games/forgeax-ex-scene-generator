/**
 * Geometry DSL 算子注册表。
 *
 * 这里只声明 op 的"签名"（期望参数名 + 类型 + 是否必填），用于：
 *   - validate() 阶段静态校验
 *   - 未来 LSP / 自动完成
 *
 * 每个 op 的具体语义由电池 `index.ts` 实现（电池负责生成对应的 DSL 行）；
 * op 的"求值"（DSL → URDF / mesh）由 evaluator（如 g_to_urdf 电池）按 op.name 分发。
 *
 * 添加新 op：在此处加一条 OpSpec，并写对应电池。两者解耦的好处是
 * registry 同时给电池开发与 DSL 校验提供单一真源。
 */

import type { Arg } from './types.js';

/** 期望的 Arg 类别（与 Arg.kind 一对一对应；'any' = 不约束） */
export type ExpectedKind = 'number' | 'string' | 'bool' | 'list' | 'ref' | 'any';

export interface ParamSpec {
  /** 参数名 */
  name: string;
  /** 期望类型；可多选 */
  kinds: readonly ExpectedKind[];
  /** 是否必填；默认 false */
  required?: boolean;
  /** 简短人类描述（中文） */
  desc?: string;
}

export interface OpSpec {
  /** op 名（DSL 中 `id = NAME(...)` 的 NAME） */
  name: string;
  /** 简短说明 */
  desc: string;
  /** 参数表 */
  params: readonly ParamSpec[];
  /** 该 op 产出的语义类别——给下游电池筛选/拼接用 */
  produces: 'shape' | 'material' | 'part' | 'joint' | 'sketch' | 'misc';
}

/**
 * v1 内建 op 集合。
 *
 * 范围对齐 URDF：basic primitives + material + part + joint。
 * CSG（boolean / extrude / fillet）留给后续阶段再补，schema 升级即可。
 */
const SPECS: OpSpec[] = [
  // — Primitives (kind=shape) —
  {
    name: 'box',
    desc: '立方体；size=[w, d, h]',
    produces: 'shape',
    params: [
      { name: 'size', kinds: ['list'], required: true, desc: '[w, d, h] 三轴尺寸' },
    ],
  },
  {
    name: 'cylinder',
    desc: '圆柱；radius + length',
    produces: 'shape',
    params: [
      { name: 'radius', kinds: ['number'], required: true },
      { name: 'length', kinds: ['number'], required: true },
    ],
  },
  {
    name: 'sphere',
    desc: '球体',
    produces: 'shape',
    params: [
      { name: 'radius', kinds: ['number'], required: true },
    ],
  },
  {
    name: 'cone',
    desc: '圆锥；radius + height，轴向 Z',
    produces: 'shape',
    params: [
      { name: 'radius', kinds: ['number'], required: true },
      { name: 'height', kinds: ['number'], required: true },
    ],
  },
  {
    name: 'capsule',
    desc: '胶囊体；radius + length，轴向 Z，length 为总长',
    produces: 'shape',
    params: [
      { name: 'radius', kinds: ['number'], required: true },
      { name: 'length', kinds: ['number'], required: true },
    ],
  },
  {
    name: 'torus',
    desc: '圆环；major_radius + minor_radius，圆环位于 XY 平面',
    produces: 'shape',
    params: [
      { name: 'major_radius', kinds: ['number'], required: true },
      { name: 'minor_radius', kinds: ['number'], required: true },
    ],
  },
  {
    name: 'dome',
    desc: '球冠/穹顶；radius + height，底面在 XY 平面',
    produces: 'shape',
    params: [
      { name: 'radius', kinds: ['number'], required: true },
      { name: 'height', kinds: ['number'], required: true },
    ],
  },
  {
    name: 'mesh',
    desc: '外部 mesh 文件引用',
    produces: 'shape',
    params: [
      { name: 'filename', kinds: ['string'], required: true },
      { name: 'scale',    kinds: ['list'],   desc: '[sx, sy, sz]' },
    ],
  },

  // — Profile / CSG —
  {
    name: 'profile_polygon',
    desc: '2D 多边形 profile；points=[x1,y1,x2,y2,...]',
    produces: 'sketch',
    params: [
      { name: 'points', kinds: ['list'], required: true, desc: '扁平点列 [x1,y1,x2,y2,...]' },
    ],
  },
  {
    name: 'profile_rect',
    desc: '矩形 profile；w + d，位于 XY 平面',
    produces: 'sketch',
    params: [
      { name: 'w', kinds: ['number'], required: true },
      { name: 'd', kinds: ['number'], required: true },
    ],
  },
  {
    name: 'profile_circle',
    desc: '圆形 profile；radius + segments，离散为多边形',
    produces: 'sketch',
    params: [
      { name: 'radius', kinds: ['number'], required: true },
      { name: 'segments', kinds: ['number'], desc: '离散段数，默认 48' },
    ],
  },
  {
    name: 'profile_rounded_rect',
    desc: '圆角矩形 profile；w + d + radius',
    produces: 'sketch',
    params: [
      { name: 'w', kinds: ['number'], required: true },
      { name: 'd', kinds: ['number'], required: true },
      { name: 'radius', kinds: ['number'], required: true },
      { name: 'segments', kinds: ['number'], desc: '每个圆角离散段数，默认 8' },
    ],
  },
  {
    name: 'profile_regular_polygon',
    desc: '正多边形 profile；radius + sides',
    produces: 'sketch',
    params: [
      { name: 'radius', kinds: ['number'], required: true },
      { name: 'sides', kinds: ['number'], required: true },
    ],
  },
  {
    name: 'extrude',
    desc: '沿 Z 拉伸 profile 为实体 shape',
    produces: 'shape',
    params: [
      { name: 'profile', kinds: ['ref'], required: true, desc: 'profile_* 引用' },
      { name: 'height', kinds: ['number'], required: true },
      { name: 'center', kinds: ['bool'], desc: '是否以 Z=0 居中，默认 true' },
    ],
  },
  {
    name: 'extrude_with_holes',
    desc: '沿 Z 拉伸带孔 profile；outer - hole_profiles',
    produces: 'shape',
    params: [
      { name: 'outer', kinds: ['ref'], required: true, desc: '外轮廓 profile 引用' },
      { name: 'holes', kinds: ['list'], desc: '孔洞 profile ref 列表' },
      { name: 'height', kinds: ['number'], required: true },
      { name: 'center', kinds: ['bool'], desc: '是否以 Z=0 居中，默认 true' },
    ],
  },
  {
    name: 'loft',
    desc: '多个 profile 截面 loft 成实体；V1 要求点数一致',
    produces: 'shape',
    params: [
      { name: 'profiles', kinds: ['list'], required: true, desc: 'profile ref 列表' },
      { name: 'height', kinds: ['number'], desc: '未给 z_values 时的总高度，默认 1' },
      { name: 'z_values', kinds: ['list'], desc: '每个 profile 的 Z 坐标' },
      { name: 'ruled', kinds: ['bool'], desc: '是否直纹 loft，默认 false' },
    ],
  },
  {
    name: 'pipe',
    desc: '沿 3D 路径生成圆管；支持 polyline/catmull_rom/bezier',
    produces: 'shape',
    params: [
      { name: 'path', kinds: ['list'], required: true, desc: '扁平点列 [x1,y1,z1,...]' },
      { name: 'radius', kinds: ['number'], required: true },
      { name: 'spline', kinds: ['string'], desc: 'polyline/catmull_rom/bezier，默认 polyline' },
      { name: 'samples_per_segment', kinds: ['number'], desc: '样条每段采样数，默认 12' },
      { name: 'radial_segments', kinds: ['number'], desc: '圆截面段数，默认 16' },
      { name: 'closed', kinds: ['bool'], desc: '路径是否闭合，默认 false' },
      { name: 'cap', kinds: ['bool'], desc: '是否封端，默认 !closed' },
      { name: 'up_hint', kinds: ['list'], desc: '扫掠 frame 上方向提示 [x,y,z]' },
    ],
  },
  {
    name: 'sweep',
    desc: '沿 3D 路径扫掠 profile；可选择沿切向对齐',
    produces: 'shape',
    params: [
      { name: 'profile', kinds: ['ref'], required: true },
      { name: 'path', kinds: ['list'], required: true, desc: '扁平点列 [x1,y1,z1,...]' },
      { name: 'ruled', kinds: ['bool'], desc: '是否直纹 loft，默认 false' },
      { name: 'spline', kinds: ['string'], desc: 'polyline/catmull_rom/bezier，默认 polyline' },
      { name: 'samples_per_segment', kinds: ['number'], desc: '样条每段采样数，默认 12' },
      { name: 'align', kinds: ['bool'], desc: '是否让截面随路径切向旋转，默认 false' },
      { name: 'closed', kinds: ['bool'], desc: '路径是否闭合，默认 false' },
      { name: 'cap', kinds: ['bool'], desc: 'mesh sweep 是否封端，默认 !closed' },
      { name: 'up_hint', kinds: ['list'], desc: '扫掠 frame 上方向提示 [x,y,z]' },
    ],
  },
  {
    name: 'section_loft',
    desc: '多个 3D 截面环 loft 成 mesh 实体；各截面点数需一致',
    produces: 'shape',
    params: [
      { name: 'sections', kinds: ['list'], required: true, desc: '嵌套点列 [[x,y,z,...], ...]' },
      { name: 'cap', kinds: ['bool'], desc: '是否封端，默认 true' },
      { name: 'closed', kinds: ['bool'], desc: '首尾截面是否闭合成环，默认 false' },
    ],
  },
  {
    name: 'lathe',
    desc: '绕 Z 轴旋转 [r,z] profile 为实体 shape',
    produces: 'shape',
    params: [
      { name: 'profile', kinds: ['ref'], required: true, desc: '点解释为 [r,z] 的 profile 引用' },
    ],
  },
  {
    name: 'revolve',
    desc: '绕 Z 轴旋转 [r,z] profile 为实体 shape；lathe 的别名',
    produces: 'shape',
    params: [
      { name: 'profile', kinds: ['ref'], required: true, desc: '点解释为 [r,z] 的 profile 引用' },
    ],
  },
  {
    name: 'union',
    desc: '实体布尔并集；a ∪ b',
    produces: 'shape',
    params: [
      { name: 'a', kinds: ['ref'], required: true },
      { name: 'b', kinds: ['ref'], required: true },
    ],
  },
  {
    name: 'difference',
    desc: '实体布尔差集；base - tool',
    produces: 'shape',
    params: [
      { name: 'base', kinds: ['ref'], required: true },
      { name: 'tool', kinds: ['ref'], required: true },
    ],
  },
  {
    name: 'intersection',
    desc: '实体布尔交集；a ∩ b',
    produces: 'shape',
    params: [
      { name: 'a', kinds: ['ref'], required: true },
      { name: 'b', kinds: ['ref'], required: true },
    ],
  },
  {
    name: 'translate',
    desc: '平移 shape；offset=[x,y,z]',
    produces: 'shape',
    params: [
      { name: 'shape', kinds: ['ref'], required: true },
      { name: 'offset', kinds: ['list'], required: true, desc: '[x,y,z]' },
    ],
  },
  {
    name: 'rotate',
    desc: '绕轴旋转 shape；angle_deg + axis',
    produces: 'shape',
    params: [
      { name: 'shape', kinds: ['ref'], required: true },
      { name: 'angle_deg', kinds: ['number'], required: true },
      { name: 'axis', kinds: ['list'], desc: '[x,y,z]，默认 [0,0,1]' },
      { name: 'origin', kinds: ['list'], desc: '[x,y,z]，默认 [0,0,0]' },
    ],
  },
  {
    name: 'scale',
    desc: '等比缩放 shape；factor',
    produces: 'shape',
    params: [
      { name: 'shape', kinds: ['ref'], required: true },
      { name: 'factor', kinds: ['number'], required: true },
      { name: 'center', kinds: ['list'], desc: '[x,y,z]，默认 [0,0,0]' },
    ],
  },
  {
    name: 'mirror',
    desc: '按平面镜像 shape；plane=XY/YZ/XZ',
    produces: 'shape',
    params: [
      { name: 'shape', kinds: ['ref'], required: true },
      { name: 'plane', kinds: ['string'], required: true },
      { name: 'origin', kinds: ['list'], desc: '[x,y,z]，默认 [0,0,0]' },
    ],
  },
  {
    name: 'array_linear',
    desc: '沿向量线性阵列 shape',
    produces: 'shape',
    params: [
      { name: 'shape', kinds: ['ref'], required: true },
      { name: 'count', kinds: ['number'], required: true },
      { name: 'step', kinds: ['list'], required: true, desc: '[dx,dy,dz]' },
    ],
  },
  {
    name: 'array_radial',
    desc: '绕轴径向阵列 shape',
    produces: 'shape',
    params: [
      { name: 'shape', kinds: ['ref'], required: true },
      { name: 'count', kinds: ['number'], required: true },
      { name: 'angle_deg', kinds: ['number'], desc: '总角度，默认 360' },
      { name: 'axis', kinds: ['list'], desc: '[x,y,z]，默认 [0,0,1]' },
      { name: 'origin', kinds: ['list'], desc: '[x,y,z]，默认 [0,0,0]' },
    ],
  },

  // — Material —
  {
    name: 'material',
    desc: 'RGBA 颜色 / 贴图材质',
    produces: 'material',
    params: [
      { name: 'rgba',    kinds: ['list'],   desc: '[r, g, b, a]' },
      { name: 'texture', kinds: ['string'], desc: '贴图文件路径' },
    ],
  },

  // — Part (URDF link) —
  {
    name: 'part',
    desc: 'URDF link：把一个 shape 包成可装配的 part；可选 material/origin/mass',
    produces: 'part',
    params: [
      { name: 'shape',    kinds: ['ref'],    required: true, desc: '引用一个 shape 类 op' },
      { name: 'material', kinds: ['ref'],    desc: '引用一个 material' },
      { name: 'origin',   kinds: ['list'],   desc: '[x, y, z]，相对 part 局部原点的可视偏移' },
      { name: 'rpy',      kinds: ['list'],   desc: '[r, p, y] roll/pitch/yaw 弧度' },
      { name: 'mass',     kinds: ['number'], desc: '惯性质量；缺省 0 表示不参与物理' },
    ],
  },

  // — Inertial（附着到 part 的物理参数；URDF 编译时会塞进 <link>/<inertial>）—
  {
    name: 'inertial',
    desc: '把质量 / 惯性张量 / 质心 attach 到指定 part；URDF 编译时变成 <inertial>',
    produces: 'misc',
    params: [
      { name: 'link',   kinds: ['ref'],    required: true, desc: '目标 part id' },
      { name: 'mass',   kinds: ['number'], required: true, desc: '质量（kg）' },
      { name: 'origin', kinds: ['list'],   desc: '质心 [x, y, z]，相对 part 局部原点' },
      { name: 'rpy',    kinds: ['list'],   desc: '惯性张量主轴 [r, p, y]' },
      { name: 'ixx',    kinds: ['number'], desc: 'Ixx' },
      { name: 'ixy',    kinds: ['number'], desc: 'Ixy' },
      { name: 'ixz',    kinds: ['number'], desc: 'Ixz' },
      { name: 'iyy',    kinds: ['number'], desc: 'Iyy' },
      { name: 'iyz',    kinds: ['number'], desc: 'Iyz' },
      { name: 'izz',    kinds: ['number'], desc: 'Izz' },
    ],
  },

  // — Joint —
  {
    name: 'joint',
    desc: 'URDF joint：连接两个 part；type=fixed/revolute/continuous/prismatic/planar/floating',
    produces: 'joint',
    params: [
      { name: 'type',     kinds: ['string'], required: true, desc: '"fixed"/"revolute"/"continuous"/"prismatic"/"planar"/"floating"' },
      { name: 'parent',   kinds: ['ref'],    required: true, desc: 'parent part' },
      { name: 'child',    kinds: ['ref'],    required: true, desc: 'child part' },
      { name: 'origin',   kinds: ['list'],   desc: 'joint 原点 [x, y, z]，相对 parent' },
      { name: 'rpy',      kinds: ['list'],   desc: '[r, p, y]' },
      { name: 'axis',     kinds: ['list'],   desc: '[x, y, z] 旋转/平移轴；revolute/prismatic 必填' },
      { name: 'lower',    kinds: ['number'], desc: '运动下限（弧度/米）' },
      { name: 'upper',    kinds: ['number'], desc: '运动上限' },
      { name: 'effort',   kinds: ['number'], desc: '最大力矩/力' },
      { name: 'velocity', kinds: ['number'], desc: '最大速度' },
      { name: 'mimic_joint',      kinds: ['ref'],    desc: 'URDF mimic 源 joint' },
      { name: 'mimic_multiplier', kinds: ['number'], desc: 'mimic multiplier，默认 1' },
      { name: 'mimic_offset',     kinds: ['number'], desc: 'mimic offset，默认 0' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════
  // Composite shapes (semantic parts; sidecar bakes to mesh at export time)
  // 与 box/cylinder/sphere/mesh 在 part(shape=ref(...)) 消费侧完全一致；
  // 区别只是 g_to_urdf 编译期需要先调 articraft sidecar 烘成 OBJ，再写 <mesh filename="..."/>。
  // ════════════════════════════════════════════════════════════════════

  // — Brackets & mounts (sdk._mesh.brackets) —
  {
    name: 'clevis_bracket',
    desc: 'U 形耳轴支架 (articraft ClevisBracketGeometry)',
    produces: 'shape',
    params: [
      { name: 'overall_size',   kinds: ['list'],   required: true, desc: '[w, d, h]' },
      { name: 'gap_width',      kinds: ['number'], required: true, desc: '两颊间净间距' },
      { name: 'bore_diameter',  kinds: ['number'], required: true, desc: '横向通孔直径' },
      { name: 'bore_center_z',  kinds: ['number'], required: true, desc: '孔心距底面高度' },
      { name: 'base_thickness', kinds: ['number'], required: true, desc: '底座厚度' },
      { name: 'corner_radius',  kinds: ['number'], desc: '外角倒圆 (默认 0)' },
      { name: 'center',         kinds: ['bool'],   desc: '是否居中 (默认 true)' },
    ],
  },
  {
    name: 'pivot_fork',
    desc: '前开式枢轴叉 (articraft PivotForkGeometry)',
    produces: 'shape',
    params: [
      { name: 'overall_size',     kinds: ['list'],   required: true, desc: '[w, d, h]' },
      { name: 'gap_width',        kinds: ['number'], required: true, desc: '叉齿间净间距' },
      { name: 'bore_diameter',    kinds: ['number'], required: true },
      { name: 'bore_center_z',    kinds: ['number'], required: true },
      { name: 'bridge_thickness', kinds: ['number'], required: true, desc: '后桥厚度 (沿 Y)' },
      { name: 'corner_radius',    kinds: ['number'] },
      { name: 'center',           kinds: ['bool'] },
    ],
  },
  {
    name: 'trunnion_yoke',
    desc: '耳轴支座 (articraft TrunnionYokeGeometry)',
    produces: 'shape',
    params: [
      { name: 'overall_size',      kinds: ['list'],   required: true, desc: '[w, d, h]' },
      { name: 'span_width',        kinds: ['number'], required: true, desc: '两颊间净开口' },
      { name: 'trunnion_diameter', kinds: ['number'], required: true },
      { name: 'trunnion_center_z', kinds: ['number'], required: true },
      { name: 'base_thickness',    kinds: ['number'], required: true },
      { name: 'corner_radius',     kinds: ['number'] },
      { name: 'center',            kinds: ['bool'] },
    ],
  },

  // — Panels & grilles (sdk._mesh.panels) —
  {
    name: 'perforated_panel',
    desc: '穿孔板 (articraft PerforatedPanelGeometry)',
    produces: 'shape',
    params: [
      { name: 'panel_size',    kinds: ['list'],   required: true, desc: '[w, h]' },
      { name: 'thickness',     kinds: ['number'], required: true },
      { name: 'hole_diameter', kinds: ['number'], required: true },
      { name: 'pitch',         kinds: ['list'],   required: true, desc: '[px, py]' },
      { name: 'frame',         kinds: ['number'], desc: '外框宽度 (默认 0.008)' },
      { name: 'corner_radius', kinds: ['number'] },
      { name: 'stagger',       kinds: ['bool'],   desc: '交错排布 (默认 false)' },
      { name: 'center',        kinds: ['bool'] },
    ],
  },
  {
    name: 'slot_panel',
    desc: '槽孔板 (articraft SlotPatternPanelGeometry)',
    produces: 'shape',
    params: [
      { name: 'panel_size',     kinds: ['list'],   required: true, desc: '[w, h]' },
      { name: 'thickness',      kinds: ['number'], required: true },
      { name: 'slot_size',      kinds: ['list'],   required: true, desc: '[w, h]' },
      { name: 'pitch',          kinds: ['list'],   required: true, desc: '[px, py]' },
      { name: 'frame',          kinds: ['number'] },
      { name: 'corner_radius',  kinds: ['number'] },
      { name: 'slot_angle_deg', kinds: ['number'], desc: '槽倾角 (度)' },
      { name: 'stagger',        kinds: ['bool'] },
      { name: 'center',         kinds: ['bool'] },
    ],
  },
  {
    name: 'vent_grille',
    desc: '通风格栅 (articraft VentGrilleGeometry)',
    produces: 'shape',
    params: [
      { name: 'panel_size',     kinds: ['list'],   required: true, desc: '[w, h]' },
      { name: 'frame',          kinds: ['number'] },
      { name: 'face_thickness', kinds: ['number'] },
      { name: 'duct_depth',     kinds: ['number'] },
      { name: 'duct_wall',      kinds: ['number'] },
      { name: 'slat_pitch',     kinds: ['number'] },
      { name: 'slat_width',     kinds: ['number'] },
      { name: 'slat_angle_deg', kinds: ['number'] },
      { name: 'slat_thickness', kinds: ['number'] },
      { name: 'corner_radius',  kinds: ['number'] },
      { name: 'center',         kinds: ['bool'] },
    ],
  },

  // — Fans & rotors (sdk._mesh.fans) —
  {
    name: 'fan_rotor',
    desc: '轴流风扇转子 (articraft FanRotorGeometry)',
    produces: 'shape',
    params: [
      { name: 'outer_radius',    kinds: ['number'], required: true },
      { name: 'hub_radius',      kinds: ['number'], required: true },
      { name: 'blade_count',     kinds: ['number'], required: true },
      { name: 'thickness',       kinds: ['number'], required: true },
      { name: 'blade_pitch_deg', kinds: ['number'] },
      { name: 'blade_sweep_deg', kinds: ['number'] },
      { name: 'blade_root_chord', kinds: ['number'] },
      { name: 'blade_tip_chord',  kinds: ['number'] },
      { name: 'center',          kinds: ['bool'] },
    ],
  },
  {
    name: 'blower_wheel',
    desc: '离心鼓风机叶轮 (articraft BlowerWheelGeometry)',
    produces: 'shape',
    params: [
      { name: 'outer_radius',    kinds: ['number'], required: true },
      { name: 'inner_radius',    kinds: ['number'], required: true },
      { name: 'width',           kinds: ['number'], required: true },
      { name: 'blade_count',     kinds: ['number'], required: true },
      { name: 'blade_thickness', kinds: ['number'], required: true },
      { name: 'blade_sweep_deg', kinds: ['number'] },
      { name: 'backplate',       kinds: ['bool'] },
      { name: 'shroud',          kinds: ['bool'] },
      { name: 'center',          kinds: ['bool'] },
    ],
  },

  // — Controls (sdk._mesh.controls) —
  {
    name: 'knob',
    desc: '旋钮 / 控制帽 (articraft KnobGeometry)',
    produces: 'shape',
    params: [
      { name: 'diameter',       kinds: ['number'], required: true },
      { name: 'height',         kinds: ['number'], required: true },
      { name: 'body_style',     kinds: ['string'], desc: 'cylindrical/tapered/domed/mushroom/skirted/hourglass/faceted/lobed' },
      { name: 'top_diameter',   kinds: ['number'] },
      { name: 'base_diameter',  kinds: ['number'] },
      { name: 'crown_radius',   kinds: ['number'] },
      { name: 'edge_radius',    kinds: ['number'] },
      { name: 'side_draft_deg', kinds: ['number'] },
      { name: 'center',         kinds: ['bool'] },
    ],
  },
  {
    name: 'bezel',
    desc: '框边 / 显示框 (articraft BezelGeometry)',
    produces: 'shape',
    params: [
      { name: 'opening_size',          kinds: ['list'],   required: true, desc: '[w, h]' },
      { name: 'outer_size',            kinds: ['list'],   required: true, desc: '[w, h]' },
      { name: 'depth',                 kinds: ['number'], required: true },
      { name: 'opening_shape',         kinds: ['string'], desc: 'rect/rounded_rect/circle/ellipse/superellipse' },
      { name: 'outer_shape',           kinds: ['string'] },
      { name: 'opening_corner_radius', kinds: ['number'] },
      { name: 'outer_corner_radius',   kinds: ['number'] },
      { name: 'wall',                  kinds: ['number','list'], desc: '标量或 [t,b,l,r]' },
      { name: 'center',                kinds: ['bool'] },
    ],
  },

  // — Wheels & tires (sdk._mesh.wheels) —
  {
    name: 'wheel',
    desc: '车轮（沿 local X 旋转）(articraft WheelGeometry)',
    produces: 'shape',
    params: [
      { name: 'radius',   kinds: ['number'], required: true },
      { name: 'width',    kinds: ['number'], required: true },
      { name: 'center',   kinds: ['bool'] },
    ],
  },
  {
    name: 'tire',
    desc: '轮胎（沿 local X 旋转）(articraft TireGeometry)',
    produces: 'shape',
    params: [
      { name: 'outer_radius', kinds: ['number'], required: true },
      { name: 'width',        kinds: ['number'], required: true },
      { name: 'inner_radius', kinds: ['number'] },
      { name: 'center',       kinds: ['bool'] },
    ],
  },

  // — Hinges (sdk._mesh.hinges) —
  {
    name: 'barrel_hinge',
    desc: '桶式两叶铰链 (articraft BarrelHingeGeometry)',
    produces: 'shape',
    params: [
      { name: 'length',                  kinds: ['number'], required: true },
      { name: 'leaf_width_a',            kinds: ['number'], required: true },
      { name: 'leaf_width_b',            kinds: ['number'] },
      { name: 'leaf_thickness',          kinds: ['number'], required: true },
      { name: 'pin_diameter',            kinds: ['number'], required: true },
      { name: 'knuckle_outer_diameter',  kinds: ['number'] },
      { name: 'knuckle_count',           kinds: ['number'] },
      { name: 'clearance',               kinds: ['number'] },
      { name: 'open_angle_deg',          kinds: ['number'] },
      { name: 'center',                  kinds: ['bool'] },
    ],
  },
  {
    name: 'piano_hinge',
    desc: '钢琴 / 连续铰链 (articraft PianoHingeGeometry)',
    produces: 'shape',
    params: [
      { name: 'length',         kinds: ['number'], required: true },
      { name: 'leaf_width_a',   kinds: ['number'], required: true },
      { name: 'leaf_width_b',   kinds: ['number'] },
      { name: 'leaf_thickness', kinds: ['number'], required: true },
      { name: 'pin_diameter',   kinds: ['number'], required: true },
      { name: 'knuckle_pitch',  kinds: ['number'], required: true },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'open_angle_deg', kinds: ['number'] },
      { name: 'center',         kinds: ['bool'] },
    ],
  },

  // ════════════════════════════════════════════════════════════════════
  // Gears (sdk.gears.* via cadquery + articraft mesh_from_cadquery)
  // ════════════════════════════════════════════════════════════════════

  // — Single gears —
  {
    name: 'spur_gear',
    desc: '直齿轮 (cq_gears SpurGear)',
    produces: 'shape',
    params: [
      { name: 'module',         kinds: ['number'], required: true },
      { name: 'teeth_number',   kinds: ['number'], required: true },
      { name: 'width',          kinds: ['number'], required: true },
      { name: 'pressure_angle', kinds: ['number'], desc: '默认 20°' },
      { name: 'helix_angle',    kinds: ['number'], desc: '默认 0°；非零→斜齿' },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'backlash',       kinds: ['number'] },
      { name: 'bore_d',         kinds: ['number'] },
      { name: 'hub_d',          kinds: ['number'] },
      { name: 'hub_length',     kinds: ['number'] },
      { name: 'chamfer',        kinds: ['number'] },
    ],
  },
  {
    name: 'herringbone_gear',
    desc: '人字齿轮 (cq_gears HerringboneGear)；签名同 spur_gear',
    produces: 'shape',
    params: [
      { name: 'module',         kinds: ['number'], required: true },
      { name: 'teeth_number',   kinds: ['number'], required: true },
      { name: 'width',          kinds: ['number'], required: true },
      { name: 'pressure_angle', kinds: ['number'] },
      { name: 'helix_angle',    kinds: ['number'] },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'backlash',       kinds: ['number'] },
      { name: 'bore_d',         kinds: ['number'] },
      { name: 'hub_d',          kinds: ['number'] },
      { name: 'hub_length',     kinds: ['number'] },
      { name: 'chamfer',        kinds: ['number'] },
    ],
  },
  {
    name: 'ring_gear',
    desc: '内齿圈 (cq_gears RingGear)',
    produces: 'shape',
    params: [
      { name: 'module',         kinds: ['number'], required: true },
      { name: 'teeth_number',   kinds: ['number'], required: true },
      { name: 'width',          kinds: ['number'], required: true },
      { name: 'rim_width',      kinds: ['number'], required: true, desc: '齿外径外的额外径向壁厚' },
      { name: 'pressure_angle', kinds: ['number'] },
      { name: 'helix_angle',    kinds: ['number'] },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'backlash',       kinds: ['number'] },
      { name: 'chamfer',        kinds: ['number'] },
    ],
  },
  {
    name: 'herringbone_ring_gear',
    desc: '人字内齿圈 (cq_gears HerringboneRingGear)',
    produces: 'shape',
    params: [
      { name: 'module',         kinds: ['number'], required: true },
      { name: 'teeth_number',   kinds: ['number'], required: true },
      { name: 'width',          kinds: ['number'], required: true },
      { name: 'rim_width',      kinds: ['number'], required: true },
      { name: 'pressure_angle', kinds: ['number'] },
      { name: 'helix_angle',    kinds: ['number'] },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'backlash',       kinds: ['number'] },
      { name: 'chamfer',        kinds: ['number'] },
    ],
  },
  {
    name: 'bevel_gear',
    desc: '锥齿轮 (cq_gears BevelGear)',
    produces: 'shape',
    params: [
      { name: 'module',         kinds: ['number'], required: true },
      { name: 'teeth_number',   kinds: ['number'], required: true },
      { name: 'cone_angle',     kinds: ['number'], required: true, desc: '节锥角 (度)' },
      { name: 'face_width',     kinds: ['number'], required: true },
      { name: 'pressure_angle', kinds: ['number'] },
      { name: 'helix_angle',    kinds: ['number'] },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'backlash',       kinds: ['number'] },
      { name: 'bore_d',         kinds: ['number'] },
      { name: 'trim_bottom',    kinds: ['bool'] },
      { name: 'trim_top',       kinds: ['bool'] },
    ],
  },
  {
    name: 'rack_gear',
    desc: '齿条 (cq_gears RackGear)',
    produces: 'shape',
    params: [
      { name: 'module',         kinds: ['number'], required: true },
      { name: 'length',         kinds: ['number'], required: true },
      { name: 'width',          kinds: ['number'], required: true },
      { name: 'height',         kinds: ['number'], required: true, desc: '齿根下背高' },
      { name: 'pressure_angle', kinds: ['number'] },
      { name: 'helix_angle',    kinds: ['number'] },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'backlash',       kinds: ['number'] },
    ],
  },
  {
    name: 'herringbone_rack_gear',
    desc: '人字齿条 (cq_gears HerringboneRackGear)',
    produces: 'shape',
    params: [
      { name: 'module',         kinds: ['number'], required: true },
      { name: 'length',         kinds: ['number'], required: true },
      { name: 'width',          kinds: ['number'], required: true },
      { name: 'height',         kinds: ['number'], required: true },
      { name: 'pressure_angle', kinds: ['number'] },
      { name: 'helix_angle',    kinds: ['number'] },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'backlash',       kinds: ['number'] },
    ],
  },
  {
    name: 'worm',
    desc: '蜗杆 (cq_gears Worm)',
    produces: 'shape',
    params: [
      { name: 'module',         kinds: ['number'], required: true },
      { name: 'lead_angle',     kinds: ['number'], required: true, desc: '导程角 (度)' },
      { name: 'n_threads',      kinds: ['number'], required: true, desc: '螺纹头数' },
      { name: 'length',         kinds: ['number'], required: true },
      { name: 'pressure_angle', kinds: ['number'] },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'backlash',       kinds: ['number'] },
      { name: 'bore_d',         kinds: ['number'] },
    ],
  },
  {
    name: 'crossed_helical_gear',
    desc: '交错斜齿轮 (cq_gears CrossedHelicalGear)',
    produces: 'shape',
    params: [
      { name: 'module',         kinds: ['number'], required: true },
      { name: 'teeth_number',   kinds: ['number'], required: true },
      { name: 'width',          kinds: ['number'], required: true },
      { name: 'pressure_angle', kinds: ['number'] },
      { name: 'helix_angle',    kinds: ['number'] },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'backlash',       kinds: ['number'] },
      { name: 'bore_d',         kinds: ['number'] },
    ],
  },
  {
    name: 'hyperbolic_gear',
    desc: '双曲齿轮 (cq_gears HyperbolicGear)',
    produces: 'shape',
    params: [
      { name: 'module',         kinds: ['number'], required: true },
      { name: 'teeth_number',   kinds: ['number'], required: true },
      { name: 'width',          kinds: ['number'], required: true },
      { name: 'twist_angle',    kinds: ['number'], required: true, desc: '总扭转角 (度)' },
      { name: 'pressure_angle', kinds: ['number'] },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'backlash',       kinds: ['number'] },
      { name: 'bore_d',         kinds: ['number'] },
    ],
  },

  // — Gear assemblies (compound shape, single mesh)；多 part+joint 展开留待 v2 —
  {
    name: 'planetary_gearset',
    desc: '行星齿轮组 (cq_gears PlanetaryGearset)',
    produces: 'shape',
    params: [
      { name: 'module',              kinds: ['number'], required: true },
      { name: 'sun_teeth_number',    kinds: ['number'], required: true },
      { name: 'planet_teeth_number', kinds: ['number'], required: true },
      { name: 'width',               kinds: ['number'], required: true },
      { name: 'rim_width',           kinds: ['number'], required: true },
      { name: 'n_planets',           kinds: ['number'], required: true },
      { name: 'pressure_angle',      kinds: ['number'] },
      { name: 'helix_angle',         kinds: ['number'] },
      { name: 'clearance',           kinds: ['number'] },
      { name: 'backlash',            kinds: ['number'] },
    ],
  },
  {
    name: 'herringbone_planetary_gearset',
    desc: '人字行星齿轮组 (cq_gears HerringbonePlanetaryGearset)',
    produces: 'shape',
    params: [
      { name: 'module',              kinds: ['number'], required: true },
      { name: 'sun_teeth_number',    kinds: ['number'], required: true },
      { name: 'planet_teeth_number', kinds: ['number'], required: true },
      { name: 'width',               kinds: ['number'], required: true },
      { name: 'rim_width',           kinds: ['number'], required: true },
      { name: 'n_planets',           kinds: ['number'], required: true },
      { name: 'pressure_angle',      kinds: ['number'] },
      { name: 'helix_angle',         kinds: ['number'] },
      { name: 'clearance',           kinds: ['number'] },
      { name: 'backlash',            kinds: ['number'] },
    ],
  },
  {
    name: 'bevel_gear_pair',
    desc: '锥齿轮对 (cq_gears BevelGearPair)',
    produces: 'shape',
    params: [
      { name: 'module',         kinds: ['number'], required: true },
      { name: 'gear_teeth',     kinds: ['number'], required: true },
      { name: 'pinion_teeth',   kinds: ['number'], required: true },
      { name: 'face_width',     kinds: ['number'], required: true },
      { name: 'axis_angle',     kinds: ['number'], desc: '轴夹角 (度)，默认 90' },
      { name: 'pressure_angle', kinds: ['number'] },
      { name: 'helix_angle',    kinds: ['number'] },
      { name: 'clearance',      kinds: ['number'] },
      { name: 'backlash',       kinds: ['number'] },
    ],
  },
  {
    name: 'crossed_gear_pair',
    desc: '交错齿轮对 (cq_gears CrossedGearPair)',
    produces: 'shape',
    params: [
      { name: 'module',              kinds: ['number'], required: true },
      { name: 'gear1_teeth_number',  kinds: ['number'], required: true },
      { name: 'gear2_teeth_number',  kinds: ['number'], required: true },
      { name: 'gear1_width',         kinds: ['number'], required: true },
      { name: 'gear2_width',         kinds: ['number'], required: true },
      { name: 'shaft_angle',         kinds: ['number'], desc: '轴夹角 (度)，默认 90' },
      { name: 'gear1_helix_angle',   kinds: ['number'] },
      { name: 'pressure_angle',      kinds: ['number'] },
      { name: 'clearance',           kinds: ['number'] },
      { name: 'backlash',            kinds: ['number'] },
    ],
  },
  {
    name: 'hyperbolic_gear_pair',
    desc: '双曲齿轮对 (cq_gears HyperbolicGearPair)',
    produces: 'shape',
    params: [
      { name: 'module',              kinds: ['number'], required: true },
      { name: 'gear1_teeth_number',  kinds: ['number'], required: true },
      { name: 'width',               kinds: ['number'], required: true },
      { name: 'shaft_angle',         kinds: ['number'], required: true, desc: '(度)' },
      { name: 'gear2_teeth_number',  kinds: ['number'] },
      { name: 'pressure_angle',      kinds: ['number'] },
      { name: 'clearance',           kinds: ['number'] },
      { name: 'backlash',            kinds: ['number'] },
    ],
  },
];

const OP_INDEX: ReadonlyMap<string, OpSpec> = new Map(SPECS.map(s => [s.name, s]));

/** 取 op 规格；未知 op 返回 undefined */
export function getOpSpec(name: string): OpSpec | undefined {
  return OP_INDEX.get(name);
}

/** 列出全部已注册 op（v1 用 const，未来可换 dynamic register） */
export function listOpSpecs(): readonly OpSpec[] {
  return SPECS;
}

/** Arg.kind 与 ExpectedKind 匹配 */
export function argMatchesKind(arg: Arg, expected: ExpectedKind): boolean {
  if (expected === 'any') return true;
  return arg.kind === expected;
}
