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
  produces: 'shape' | 'material' | 'part' | 'joint' | 'sketch' | 'misc' | 'bone' | 'skeleton' | 'skin';
}

export type ProducesKind = OpSpec['produces'];

const URDF_NATIVE_SHAPE_OPS = ['box', 'cylinder', 'sphere', 'mesh'] as const;

const SUBGRAPH_BAKE_OPS = [
  'profile_polygon', 'profile_rect', 'profile_circle',
  'profile_rounded_rect', 'profile_regular_polygon',
  'union', 'difference', 'intersection',
  'extrude', 'extrude_with_holes', 'revolve',
  'fillet', 'chamfer',
  'translate', 'rotate', 'scale', 'mirror', 'array_linear', 'array_radial',
  'loft', 'section_loft', 'pipe', 'sweep',
] as const;

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
      { name: 'bbox_min', kinds: ['list'],   desc: '可选未缩放局部 AABB 最小角 [x, y, z]（米）；填上后 mesh 可解 AABB' },
      { name: 'bbox_max', kinds: ['list'],   desc: '可选未缩放局部 AABB 最大角 [x, y, z]（米）' },
    ],
  },
  {
    name: 'rock',
    desc: '不规则石头/岩块（三角网格，非 OCCT 实体）：icosphere 细分 + 基于 seed 的确定性顶点位移。' +
      '用于地形装饰/瓦砾/岩石，不是规则占位方块——形态本身即最终形态，不受"裸 primitive 堆叠"QC 判罚。' +
      '与 pipe/sweep/section_loft 一样是三角网格产物，不能参与 union/difference/intersection（继承现有系统限制）。' +
      '同义 op："boulder"。',
    produces: 'shape',
    params: [
      { name: 'radius',       kinds: ['number'], required: true, desc: '基准半径（米）' },
      { name: 'irregularity', kinds: ['number'], desc: '凹凸幅度占半径的比例，0~1，默认 0.35' },
      { name: 'seed',         kinds: ['number'], desc: '整数随机种子；同参数重复 apply 形状确定不变（DSL 复算/缓存要求确定性），默认 0' },
      { name: 'detail',       kinds: ['number'], desc: 'icosphere 细分级别 0~2（越大越多面，越圆润），默认 1' },
      { name: 'stretch',      kinds: ['list'],   desc: '[sx, sy, sz] 非等比拉伸，做椭圆状/长条状石头；默认 [1,1,1]' },
    ],
  },
  {
    name: 'boulder',
    desc: 'rock 的同义 op（更大块的石头场景语义相同），参数与 rock 完全一致。',
    produces: 'shape',
    params: [
      { name: 'radius',       kinds: ['number'], required: true, desc: '基准半径（米）' },
      { name: 'irregularity', kinds: ['number'], desc: '凹凸幅度占半径的比例，0~1，默认 0.35' },
      { name: 'seed',         kinds: ['number'], desc: '整数随机种子；同参数重复 apply 形状确定不变，默认 0' },
      { name: 'detail',       kinds: ['number'], desc: 'icosphere 细分级别 0~2，默认 1' },
      { name: 'stretch',      kinds: ['list'],   desc: '[sx, sy, sz] 非等比拉伸；默认 [1,1,1]' },
    ],
  },
  {
    name: 'sdf_blob',
    desc: '有机造型（三角网格，非 OCCT 实体）：多个 primitive（sphere/capsule/box/cone/ellipsoid）' +
      '通过 smooth-union/subtract/intersect 组合成一个隐式标量场，再用真正的 Marching Cubes（沿边线性' +
      '插值找零点，非二值化体素方块面片）提取出光滑连续的等值面。用于需要多个球/胶囊/盒平滑融合成一个' +
      '连续有机体的场景（怪物躯干、根须、融合肌肉块）——常规倒角/圆边继续用 fillet，不是所有圆角需求都' +
      '该用它。与 rock/pipe/sweep/section_loft 一样是三角网格产物，不能参与 union/difference/intersection' +
      '/fillet/chamfer（继承现有系统限制）。',
    produces: 'shape',
    params: [
      {
        name: 'primitives', kinds: ['list'], required: true,
        desc: '嵌套 list，每项 [type, id, cx, cy, cz, p0, p1, p2, rx, ry, rz]（定长 11）。' +
          'type ∈ sphere/capsule/box/cone/ellipsoid；id 为该 primitive 的唯一引用名；' +
          'cx/cy/cz 是局部坐标系中心；p0..p2 按 type 解释（sphere=[radius,_,_]，' +
          'capsule=[radius,height,_]，box=[sx,sy,sz]，cone=[radius,height,_]，' +
          'ellipsoid=[rx,ry,rz]）；rx/ry/rz 是局部坐标系相对世界的 XYZ 欧拉旋转（弧度）。' +
          '最多 64 个。',
      },
      {
        name: 'operations', kinds: ['list'],
        desc: '嵌套 list，每项 [type, id, left, right, radius]（定长 5）。' +
          'type ∈ smooth-union/subtract/intersect；left/right 引用一个更早声明的 primitive 或 ' +
          'operation id（禁止前向引用/环）；radius 是 smooth-union 的融合半径（米），其余类型忽略但仍需' +
          '填一个有限数（约定 0）。最多 128 个；省略时结果就是第一个 primitive。',
      },
      { name: 'resolution', kinds: ['number'], desc: '体素网格分辨率（每轴 cell 数），[4, 64]，默认 32。' },
      { name: 'bounds', kinds: ['list'], desc: '[minx,miny,minz,maxx,maxy,maxz]；省略时按 primitives 外接球外扩推导。' },
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
    name: 'revolve',
    desc: '绕 Z 轴旋转 [r,z] profile 为实体 shape',
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
    name: 'fillet',
    desc: '实体倒圆角；对 shape 的边做半径 radius 的圆角（弧面过渡）',
    produces: 'shape',
    params: [
      { name: 'shape',  kinds: ['ref'],    required: true, desc: '被倒角的实体 shape 引用' },
      { name: 'radius', kinds: ['number'], required: true, desc: '圆角半径（米）' },
      { name: 'edges',  kinds: ['string'], desc: '选边：all（默认，所有边）/ vertical（仅平行 Z 的竖直边）' },
    ],
  },
  {
    name: 'chamfer',
    desc: '实体倒斜角；对 shape 的边做距离 radius 的平切斜角',
    produces: 'shape',
    params: [
      { name: 'shape',  kinds: ['ref'],    required: true, desc: '被倒角的实体 shape 引用' },
      { name: 'radius', kinds: ['number'], required: true, desc: '斜角边长/距离（米）' },
      { name: 'edges',  kinds: ['string'], desc: '选边：all（默认，所有边）/ vertical（仅平行 Z 的竖直边）' },
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
    name: 'texture',
    desc: '贴图定义：image 路径（相对工程 assets/textures/）+ repeat/offset/rotation',
    produces: 'misc',
    params: [
      { name: 'image',    kinds: ['string'], required: true, desc: '贴图文件路径，相对 assets/textures/' },
      { name: 'repeat',   kinds: ['list'],   desc: '[repeat_u, repeat_v]，默认 [1,1]' },
      { name: 'offset',   kinds: ['list'],   desc: '[offset_u, offset_v]，默认 [0,0]' },
      { name: 'rotation', kinds: ['number'], desc: 'UV 旋转（弧度），默认 0' },
    ],
  },
  {
    name: 'material',
    desc: 'RGBA 颜色 / PBR 材质；可选 texture(ref) 贴图（只在 g_bake_object 烘 GLB 时生效）',
    produces: 'material',
    params: [
      { name: 'rgba',      kinds: ['list'],   desc: '[r, g, b, a]' },
      { name: 'texture',   kinds: ['ref'],    desc: '引用一条 texture 语句' },
      { name: 'metalness', kinds: ['number'], desc: '金属度 0..1，默认 0.05' },
      { name: 'roughness', kinds: ['number'], desc: '粗糙度 0..1，默认 0.48' },
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

  // — Placement（使用当前 Geometry 中 part/shape 的真实可解 AABB 计算位姿）—
  {
    name: 'align_centers',
    desc: '按指定轴把 child 的 AABB 中心对齐到 parent，并把结果写回 child part origin',
    produces: 'misc',
    params: [
      { name: 'parent', kinds: ['ref'], required: true, desc: 'parent part 或 shape' },
      { name: 'child', kinds: ['ref'], required: true, desc: 'child part 或 shape' },
      { name: 'axes', kinds: ['string'], desc: '参与对齐的轴，例如 xyz / xy / z' },
    ],
  },
  {
    name: 'place_on_face',
    desc: '把 child 贴到 parent 的轴对齐外表面，并写回 child part origin',
    produces: 'misc',
    params: [
      { name: 'parent', kinds: ['ref'], required: true },
      { name: 'child', kinds: ['ref'], required: true },
      { name: 'face', kinds: ['string'], required: true, desc: '+x/-x/+y/-y/+z/-z' },
      { name: 'face_u', kinds: ['number'], desc: '面内 U 偏移' },
      { name: 'face_v', kinds: ['number'], desc: '面内 V 偏移' },
      { name: 'proud', kinds: ['number'], desc: '沿法线突出量；负值表示嵌入' },
    ],
  },
  {
    name: 'place_local',
    desc: '按相对 parent 的局部位姿摆 child（编译期展平成绝对 origin/rpy，不建 joint）——静态路表达"窗嵌墙洞 / 门框嵌墙洞 / 门扇挂门框"用它',
    produces: 'misc',
    params: [
      { name: 'parent', kinds: ['ref'], required: true, desc: 'parent part 或 shape，读它的 origin/rpy 当参考系' },
      { name: 'child', kinds: ['ref'], required: true, desc: 'child part 或 shape，其 origin/rpy 被改写为复合结果' },
      { name: 'offset', kinds: ['list'], desc: '父件坐标系里的 [x,y,z]，默认 [0,0,0]' },
      { name: 'rpy', kinds: ['list'], desc: '相对父件的 [r,p,y] 弧度，默认 [0,0,0]' },
    ],
  },
  {
    name: 'place_on_surface',
    desc: '按 parent 实际表面法线放置并定向 child；复杂形状回退 AABB',
    produces: 'misc',
    params: [
      { name: 'parent', kinds: ['ref'], required: true },
      { name: 'child', kinds: ['ref'], required: true },
      { name: 'mode', kinds: ['string'], desc: 'direction 或 point' },
      { name: 'direction', kinds: ['list'], desc: '方向查询 [x,y,z]' },
      { name: 'point', kinds: ['list'], desc: '点查询 [x,y,z]' },
      { name: 'child_axis', kinds: ['string'], desc: 'child 对准表面法线的局部轴，默认 +z' },
      { name: 'clearance', kinds: ['number'], desc: '离表间隙' },
      { name: 'spin', kinds: ['number'], desc: '绕表面法线旋转弧度' },
      { name: 'up_hint', kinds: ['list'], desc: '稳定姿态的参考上方向 [x,y,z]' },
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

  // — Collision（附着到 part 的简化碰撞体；URDF 编译时变成 <link>/<collision>）—
  // 一个 part 可以挂多条 collision 语句，对应多 <collision> 元素（box-cluster 模式）。
  // 若一个 part 没有任何 collision 语句，编译器仍会用 visual 当 collision（保持现状向后兼容）。
  {
    name: 'collision',
    desc: '为 part 附加一个简化碰撞体（box / cylinder / sphere / 或 mesh ref）；URDF 编译时变成 <collision>',
    produces: 'misc',
    params: [
      { name: 'link',   kinds: ['ref'],    required: true, desc: '目标 part id' },
      // 形状描述：四选一（box=[w,d,h] / cylinder=[radius,length] / sphere_radius / shape=ref(...)）
      { name: 'box',         kinds: ['list'],   desc: '盒型碰撞体尺寸 [w, d, h]' },
      { name: 'cylinder',    kinds: ['list'],   desc: '圆柱碰撞体 [radius, length]，轴 = +Z' },
      { name: 'sphere_radius', kinds: ['number'], desc: '球形碰撞体半径' },
      { name: 'shape',       kinds: ['ref'],    desc: '直接引用一个 shape 语句（mesh / box / cylinder 等），URDF 会复用该 shape 的 geometry' },
      { name: 'origin', kinds: ['list'],   desc: 'collision 局部 [x, y, z]（相对 part 原点）' },
      { name: 'rpy',    kinds: ['list'],   desc: '[r, p, y]' },
      { name: 'name',   kinds: ['string'], desc: '可选 collision 名（URDF <collision name=...>）' },
    ],
  },

  // — Animation（作者关节轨迹 q(t)；不产出 URDF，由前端 GLB 烘焙链路消费）—
  // 以 URDF 关节名为键的每关节标量轨迹。轴/类型/限位由 URDF 提供，clip 不带几何。
  // 三种互斥的 q(t) 来源，按 q_json > keyframes > q_path 取第一个非空的（电池侧实现）：
  //   - q_json：完整逐帧 clip JSON（{name,fps,frameCount,loop,channels,rootTranslation?}）——人工/脚本预烘好的场景。
  //   - keyframes：稀疏关键帧 JSON（{ 关节名: [{t,q}, ...] }）——agent 对话描述动作的首选：
  //     只需给每个关节几个"关键时刻的值"，电池按 fps/duration 采样、关键帧间线性插值
  //     （或阶梯保持）展开成逐帧数组，不需要手打/生成几百帧的完整数组。
  //   - q_path：项目相对（或绝对）路径的 q(t) JSON 文件——大体量 / 复用 clip。
  {
    name: 'animation',
    desc: '动画 clip：骨骼旋转 q(t) + 可选角色根位移。通道键既可是 URDF 关节名（机械路），也可是骨骼名（角色路，绕轴弧度）。root_motion 是模型根帧（Z-up、+X 向前）中相对根骨 bind position 的米制稀疏位移关键帧。',
    produces: 'misc',
    params: [
      { name: 'name',   kinds: ['string'], desc: 'clip 名（可空）' },
      { name: 'fps',    kinds: ['number'], desc: '采样帧率（帧/秒），默认 30' },
      { name: 'loop',   kinds: ['bool'],   desc: '是否循环播放' },
      { name: 'q_json', kinds: ['string'], desc: '完整逐帧 q(t) JSON：{name?,fps?,frameCount?,loop?,channels:{骨/关节名:number[]},rootTranslation?:[[x,y,z],...]}' },
      { name: 'keyframes', kinds: ['string'], desc: '稀疏关键帧 JSON：{ 关节名: [{"t":秒,"q":值}, ...], ... }；按 fps/duration 采样展开（agent 描述动作首选，比手打逐帧数组更省 token 更不容易出错）' },
      { name: 'root_motion', kinds: ['string'], desc: '角色根位移稀疏关键帧 JSON：[{"t":秒,"x":米,"y":米,"z":米}, ...]；按 fps/duration 和 interpolation 采样到 rootTranslation' },
      { name: 'duration', kinds: ['number'], desc: 'keyframes 采样时长（秒）；省略 = 自动取所有关键帧里最大的 t' },
      { name: 'interpolation', kinds: ['string'], desc: 'keyframes 插值方式："linear"（默认）或 "step"（保持前一关键帧值，适合开合/切换类动作）' },
      { name: 'q_path', kinds: ['string'], desc: '项目相对（或绝对）路径的 q(t) JSON 文件；仅当 q_json 和 keyframes 都为空时读取' },
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
  // Character rig（软体角色：自由骨树 + 平滑蒙皮；不走 URDF 关节约束）
  //   bone/skeleton/skin 三个算子出现即触发"角色路"编译（见 dsl-to-graph）。
  //   与 joint 的关键区别：bone 是**自由骨骼**（无轴/限位），蒙皮权重连续（非 100% 刚性），
  //   权重不在 DSL / 后端存储——由前端测地体素绑定按需求解。
  // ════════════════════════════════════════════════════════════════════
  {
    name: 'bone',
    desc: '骨骼：角色骨架的一根骨。origin=head 位置（模型根/世界帧，米），tail=末端位置（缺省沿父→子方向或 +Z 一小段），axis=弯曲铰链轴（模型根帧；动画绕此轴转——作者显式声明优先，行走腿写 [0,1,0]），parent=父骨（缺省=根骨）。source_part/rpy 可选，两者目前只写入并校验、不影响 g_to_rig 的输出或蒙皮结果（见下）。骨骼为自由变换，不带 URDF 轴/限位。',
    produces: 'bone',
    params: [
      { name: 'parent',      kinds: ['ref'],  desc: '父骨 bone id；缺省=根骨' },
      // 注意：仅存进 Geometry 并做 ref 校验（必须指向一个真的 part），g_to_rig 的 RigBone
      // 和自动蒙皮目前都不读它——纯粹是给人/agent看的"这根骨对应哪个 part"提示，不是绑定实现。
      { name: 'source_part', kinds: ['ref'],  desc: '可选：该骨对应的 part id（仅记录+校验引用有效，当前不影响蒙皮/g_to_rig 输出）' },
      { name: 'origin',      kinds: ['list'], required: true, desc: 'head 位置 [x, y, z]（模型根帧，米）' },
      { name: 'tail',        kinds: ['list'], desc: 'tail 末端位置 [x, y, z]（模型根帧）；缺省自动推导' },
      { name: 'axis',        kinds: ['list'], desc: '弯曲铰链轴 [x,y,z]（模型根帧）；会动的骨强烈建议写——行走腿 [0,1,0] 前后摆；未写时前端启发式推' },
      // 注意：g_to_rig 的 RigBone 只读 origin/tail/parent/axis，不读这个——当前不影响
      // rest 朝向或蒙皮，纯粹存进 Geometry 供未来使用/人工检视。
      { name: 'rpy',         kinds: ['list'], desc: '可选 [r, p, y] 骨骼朝向（弧度）——当前仅记录，g_to_rig 不读取，不影响 rest 朝向/蒙皮' },
    ],
  },
  {
    name: 'bone_chain',
    desc: '骨骼链：在 origin→tail 之间等分展开成 count 条首尾相接的标准 bone（内部复用 bone 逐段生成，等价于手写 N 行 bone 再逐段挂 parent）。用于一整根连续 part（尾巴/蛇身/长鞭/多节触手）想要多节平滑弯曲，避免手算每段坐标。生成的骨骼 id 形如 <chainId>_0、<chainId>_1……<chainId>_{count-1}（chainId=本语句的 DSL id），可被 animation 的关键帧通道按骨骼名单独驱动；本语句自身的 id（可作为其它 bone/bone_chain 的 parent 引用）指向链的最后一段（tip），适合再挂一个末端 bone（如尾尖装饰）。axis/source_part 应用到链上每一段（source_part 同 bone：仅记录+校验，不影响蒙皮/g_to_rig 输出）。',
    produces: 'bone',
    params: [
      { name: 'origin', kinds: ['list'], required: true, desc: '链起点 head 位置 [x, y, z]（模型根帧，米）' },
      { name: 'tail', kinds: ['list'], required: true, desc: '链终点位置 [x, y, z]（模型根帧，米）' },
      { name: 'count', kinds: ['number'], required: true, desc: '分几段骨骼（整数 ≥1，如尾巴 4~6 段）' },
      { name: 'parent', kinds: ['ref'], desc: '链第一段的父骨 bone id；缺省=根骨' },
      { name: 'axis', kinds: ['list'], desc: '弯曲铰链轴 [x,y,z]（模型根帧）；应用到链上每一段，缺省=前端启发式推' },
      { name: 'source_part', kinds: ['ref'], desc: '可选：该链对应的 part id；应用到链上每一段（仅记录+校验引用有效，当前不影响蒙皮/g_to_rig 输出）' },
    ],
  },
  {
    name: 'skeleton',
    desc: '骨架：由 bone 父子链构成的骨树。root=根 bone id（其余骨骼通过 parent 链隐式挂到 root 上）。',
    produces: 'skeleton',
    params: [
      { name: 'root', kinds: ['ref'], required: true, desc: '根 bone id' },
    ],
  },
  {
    name: 'skin',
    desc: '蒙皮：把可蒙皮网格绑定到骨架。skeleton=skeleton id；mesh=可蒙皮网格（mesh shape ref，通常来自 g_bake_object 的 <sha>.glb；缺省=对所有 part 合并网格自动蒙皮）；method="auto"（测地体素绑定，默认，平滑软体蒙皮）或 "rigid"（每顶点绑到最近单骨）。权重在前端按需求解、不写进 DSL，也不在后端存储。',
    produces: 'skin',
    params: [
      { name: 'skeleton',       kinds: ['ref'],    required: true, desc: 'skeleton id' },
      { name: 'mesh',           kinds: ['ref'],    desc: '可蒙皮网格 shape id（如 g_mesh(filename=<sha>.glb)）；缺省=对所有 part 合并网格自动蒙皮' },
      { name: 'method',         kinds: ['string'], desc: '"auto"（测地体素绑定，默认）或 "rigid"（每顶点最近单骨刚性）' },
      { name: 'resolution',     kinds: ['number'], desc: '体素网格分辨率（每轴 cell 数），默认 48，写入前和前端求解时都各夹一次到 [4, 96]（两处边界须一致，见 g_to_rig 与前端 voxel-skin.ts）。同时也是表面图 geodesic fallback 路径（无体素网格时）换算顶点焊接容差的启发值（越高越保守）——两条路径复用同一个数字，不是撒谎，只是两种用法。' },
      { name: 'max_influences', kinds: ['number'], desc: '每顶点最大骨数（1..4），默认 2（低模更硬；要软可调到 4）' },
      { name: 'falloff',        kinds: ['number'], desc: '权重随骨距衰减的指数，默认 4（越大越硬；旧默认 2 偏软易扯形变）' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════
  // Architecture（静态 low-poly 建筑元素 + 开口/门窗；baker ops/architecture.ts）
  // 单位 = 米，Z 朝上。墙/楼板/楼梯/窗/门扇底面落在 Z=0，便于按层 translateZ。
  // ════════════════════════════════════════════════════════════════════
  {
    name: 'wall',
    desc: '直墙段：length(X) × height(Z) × thickness(Y)，减去 openings 门/窗洞',
    produces: 'shape',
    params: [
      { name: 'length',    kinds: ['number'], required: true, desc: '墙长（X）' },
      { name: 'height',    kinds: ['number'], required: true, desc: '墙高（Z）' },
      { name: 'thickness', kinds: ['number'], required: true, desc: '墙厚（Y）' },
      { name: 'openings',  kinds: ['list'],   desc: '开口列表，每项 [x, width, sill, head]（米）' },
      { name: 'plinth_height',     kinds: ['number'], desc: '底部勒脚基座高度（Z），0=无' },
      { name: 'plinth_projection', kinds: ['number'], desc: '勒脚相对墙面每侧外挑（Y）' },
      { name: 'window_band',       kinds: ['bool'],   desc: '开自动水平窗带（连续窗洞）' },
      { name: 'band_sill',         kinds: ['number'], desc: '窗带下沿高度（Z）' },
      { name: 'band_head',         kinds: ['number'], desc: '窗带上沿高度（Z）' },
      { name: 'band_margin',       kinds: ['number'], desc: '窗带两端预留墙垛宽（X）' },
      { name: 'pane_width',        kinds: ['number'], desc: '窗带按目标单块宽度加竖挺划分，0=不划分' },
      { name: 'mullion',           kinds: ['number'], desc: '窗带竖挺宽度' },
    ],
  },
  {
    name: 'floor_slab',
    desc: '矩形楼板：size=[w, d]，thickness(Z)，可选 holes（楼梯井 / 竖井）',
    produces: 'shape',
    params: [
      { name: 'size',      kinds: ['list'],   required: true, desc: '[w, d]' },
      { name: 'thickness', kinds: ['number'], required: true, desc: '板厚（Z）' },
      { name: 'holes',     kinds: ['list'],   desc: '矩形洞列表，每项 [x, y, w, d]（米）' },
      { name: 'beam_depth',   kinds: ['number'], desc: '周边下翻梁深度（Z，向下），0=无' },
      { name: 'beam_width',   kinds: ['number'], desc: '下翻梁宽度（水平）' },
      { name: 'edge_chamfer', kinds: ['number'], desc: '楼板底缘倒角尺寸，0=无' },
    ],
  },
  {
    name: 'stairs',
    desc: 'type=straight 直梯段（逐级叠高盒体）/ spiral 螺旋梯（绕中柱盘升）',
    produces: 'shape',
    params: [
      { name: 'total_rise',   kinds: ['number'], required: true, desc: '总爬升高度（Z）' },
      { name: 'run',          kinds: ['number'], required: true, desc: '每级踏步进深（X，直梯）' },
      { name: 'width',        kinds: ['number'], required: true, desc: '梯段宽（Y，直梯）' },
      { name: 'step_count',   kinds: ['number'], required: true, desc: '踏步数量' },
      { name: 'type',         kinds: ['string'], desc: 'straight（默认）/ spiral' },
      { name: 'radius',       kinds: ['number'], desc: 'spiral：踏步外半径' },
      { name: 'inner_radius', kinds: ['number'], desc: 'spiral：中柱半径' },
      { name: 'sweep_deg',    kinds: ['number'], desc: 'spiral：总旋转角（度），默认 270' },
      { name: 'tread_thickness', kinds: ['number'], desc: '薄踏板厚度（open_riser 时生效）' },
      { name: 'open_riser',      kinds: ['bool'],   desc: '空踢面：仅悬浮薄踏板，无实心踢面' },
      { name: 'landing_depth',   kinds: ['number'], desc: '直梯中段休息平台进深（X），0=无' },
      { name: 'landing_after',   kinds: ['number'], desc: '休息平台插在第几级之后' },
    ],
  },
  {
    name: 'roof',
    desc: 'footprint 之上的 flat/shed/gable/hip/gambrel/mansard/pyramid 屋顶',
    produces: 'shape',
    params: [
      { name: 'footprint', kinds: ['list'],   required: true, desc: '[w, d]' },
      { name: 'type',      kinds: ['string'], desc: 'flat/shed/gable/hip/gambrel/mansard/pyramid，默认 gable' },
      { name: 'height',    kinds: ['number'], desc: '屋脊高度（非 flat）' },
      { name: 'thickness', kinds: ['number'], desc: 'flat 屋顶厚度' },
      { name: 'overhang',  kinds: ['number'], desc: '出檐宽度，默认 0' },
      { name: 'eave_overhang',  kinds: ['number'], desc: '檐口出挑（短边/坡向），缺省回退 overhang' },
      { name: 'verge_overhang', kinds: ['number'], desc: '山墙出挑（屋脊/长边），缺省回退 overhang' },
      { name: 'parapet_height',    kinds: ['number'], desc: 'flat：女儿墙高度，0=无' },
      { name: 'parapet_thickness', kinds: ['number'], desc: 'flat：女儿墙壁厚' },
      { name: 'coping_width',      kinds: ['number'], desc: 'flat：女儿墙压顶外挑宽，0=无压顶' },
    ],
  },
  {
    name: 'facade_panel',
    desc: '外墙挂板 / siding：薄板 + 可选 reveal 凹槽阵列',
    produces: 'shape',
    params: [
      { name: 'panel_size',   kinds: ['list'],   required: true, desc: '[w, h]' },
      { name: 'thickness',    kinds: ['number'], required: true, desc: '板厚' },
      { name: 'orientation',  kinds: ['string'], desc: 'wall 竖直挂板（默认，h→Z）/ slab 平躺（h→Y）' },
      { name: 'groove_count', kinds: ['number'], desc: '板缝数量，默认 0' },
      { name: 'groove_depth', kinds: ['number'], desc: '板缝深度，默认 0.4×厚' },
      { name: 'groove_width', kinds: ['number'], desc: '板缝宽度' },
      { name: 'groove_direction', kinds: ['string'], desc: 'horizontal（默认）/ vertical / both' },
      { name: 'groove_spacing',   kinds: ['number'], desc: '按间距布缝（优先于 groove_count）' },
      { name: 'board_style',      kinds: ['string'], desc: 'flush（默认）/ lap / shiplap 搭接偏移' },
    ],
  },
  {
    name: 'window',
    desc: '窗：type=cross 十字 / grid 格栅 / louver 百叶；框 + 可选玻璃',
    produces: 'shape',
    params: [
      { name: 'size',    kinds: ['list'],   required: true, desc: '[w, h]' },
      { name: 'depth',   kinds: ['number'], required: true, desc: '进深（Y，对齐墙厚）' },
      { name: 'frame',   kinds: ['number'], desc: '边框宽度' },
      { name: 'mullion', kinds: ['number'], desc: '中梃/格栅宽度，0=无' },
      { name: 'glass',   kinds: ['number'], desc: '玻璃厚度，>0 时嵌入玻璃片' },
      { name: 'type',    kinds: ['string'], desc: 'cross（默认）/ grid / louver' },
      { name: 'rows',    kinds: ['number'], desc: 'grid 行数 / louver 百叶片数' },
      { name: 'cols',    kinds: ['number'], desc: 'grid 列数' },
      { name: 'pane_width', kinds: ['number'], desc: '按目标单块宽度自动划分竖挺，0=不用' },
      { name: 'sill',       kinds: ['number'], desc: '窗台外挑深度（+Y），0=无' },
      { name: 'arch_top',   kinds: ['bool'],   desc: '顶部拱券（上框做半圆拱）' },
    ],
  },
  {
    name: 'door_frame',
    desc: '门框：两侧门挺 + 上槛（底部开口）；可选亮子横挺 + 侧窗竖挺',
    produces: 'shape',
    params: [
      { name: 'size',  kinds: ['list'],   required: true, desc: '[w, h]（洞口尺寸）' },
      { name: 'depth', kinds: ['number'], required: true, desc: '进深（Y，对齐墙厚）' },
      { name: 'frame', kinds: ['number'], desc: '门框宽度' },
      { name: 'transom',   kinds: ['number'], desc: '门头亮子高度（在门扇上方加横挺），0=无' },
      { name: 'sidelight', kinds: ['number'], desc: '每侧侧窗宽度（在门洞两侧加竖挺），0=无' },
    ],
  },
  {
    name: 'door_leaf',
    desc: '门扇：单块板（独立 shape，可选 revolute 连接）；hinge 决定转轴边，style 决定样式',
    produces: 'shape',
    params: [
      { name: 'size',      kinds: ['list'],   required: true, desc: '[w, h]' },
      { name: 'thickness', kinds: ['number'], required: true, desc: '门扇厚（Y）' },
      { name: 'hinge',     kinds: ['string'], desc: 'left / right / center，铰接边落在 X=0' },
      { name: 'style',     kinds: ['string'], desc: 'flush 平板（默认）/ panel 嵌板 / glazed 上玻璃' },
      { name: 'panel_rows', kinds: ['number'], desc: 'panel 样式嵌板行数' },
      { name: 'panel_cols', kinds: ['number'], desc: 'panel 样式嵌板列数' },
    ],
  },
  {
    name: 'railing',
    desc: '栏杆/护栏：沿 X 一段，端立柱 + 顶扶手 + 均布竖向栏杆条 + 可选底/中横杆',
    produces: 'shape',
    params: [
      { name: 'length',         kinds: ['number'], required: true, desc: '总长（X）' },
      { name: 'height',         kinds: ['number'], required: true, desc: '总高（Z）' },
      { name: 'thickness',      kinds: ['number'], desc: '栏杆条截面（默认 0.04）' },
      { name: 'post_size',      kinds: ['number'], desc: '端立柱方截面边长' },
      { name: 'rail_height',    kinds: ['number'], desc: '顶扶手高度' },
      { name: 'baluster_count', kinds: ['number'], desc: '竖向栏杆条数量' },
      { name: 'post_shape',   kinds: ['string'], desc: '端立柱截面 round / square（默认 square）' },
      { name: 'post_radius',  kinds: ['number'], desc: 'round 立柱半径' },
      { name: 'post_spacing', kinds: ['number'], desc: '按间距推算栏杆条数量（优先于 baluster_count）' },
      { name: 'bottom_rail',  kinds: ['bool'],   desc: '加底横杆' },
      { name: 'mid_rail',     kinds: ['bool'],   desc: '加中横杆' },
      { name: 'top_rail_width',  kinds: ['number'], desc: '顶扶手宽度（截面 X 向不变，Y 向厚度）' },
      { name: 'top_rail_height', kinds: ['number'], desc: '顶扶手高度别名（同 rail_height）' },
    ],
  },
  {
    name: 'column',
    desc: '柱子：圆/方柱身 + 可选柱础(base)、柱头(capital)、收分、凹槽；底面 Z=0',
    produces: 'shape',
    params: [
      { name: 'height',         kinds: ['number'], required: true, desc: '总高（Z）' },
      { name: 'radius',         kinds: ['number'], desc: '柱身半径（方柱为半边长），默认 0.2' },
      { name: 'shape',          kinds: ['string'], desc: 'round（默认）/ square' },
      { name: 'base_height',    kinds: ['number'], desc: '柱础高度，0=无' },
      { name: 'capital_height', kinds: ['number'], desc: '柱头高度，0=无' },
      { name: 'taper',         kinds: ['number'], desc: '柱顶半径相对柱底比例（0~1），1=无收分' },
      { name: 'base_style',    kinds: ['string'], desc: 'plain（默认）/ stepped 分级柱础' },
      { name: 'capital_style', kinds: ['string'], desc: 'plain（默认）/ stepped 分级柱头' },
      { name: 'flutes',        kinds: ['number'], desc: '圆柱竖向凹槽数量，0=无' },
    ],
  },
  {
    name: 'storey_stack',
    desc: '标准层复制：把已建好的一层（parts 列出的全部构件 part）整体沿 Z 复制成 count 层。' +
      '默认 mode="merge"：把各构件位姿展平（静态路直接用各 part 自己的 origin/rpy，有 joint 时' +
      '先沿层内 joint 做正向运动学），整层烘成**单个多材质 GLB**（逐件颜色内嵌进网格），' +
      'parts 列出的 part 与层内 joint 被**摘掉**，换成每层一个 part(shape=mesh(<sha>.glb)) —— ' +
      '20 层塔楼只剩 20 个 part 而不是 600 个，全楼共享一份网格。合并后整层是一件：层内构件不再' +
      '单独可寻址，但这些 mesh 引用件**可以与手写的真形状件（屋顶、雨棚、首层大堂）混用**，' +
      '静态烘焙会分区处理、谁都不丢。要给某层的门挂 revolute / 逐件碰撞体时改 mode="instance"：' +
      '不烘焙，逐层复制 part（有 joint 时连 joint 一起），副本共享同一批 shape / material 语句' +
      '（不重烘、不丢每件材质，但 part 数是 merge 的 N 倍）。层间关系：静态路直接把每层 part 的' +
      ' origin 抬高；走 URDF 路（DSL 里有 joint）时自动补一条 fixed joint（origin=[0,0,层高]），' +
      '此时外部 joint 只能挂在 root 上。标高二选一：等层高用 count + storey_height，' +
      '不等距（夹设备层）用 levels。本语句自身不进 Geometry：展开后只剩标准 part / joint 行；' +
      '输出 id 指向**最高层**，可直接作为屋顶的 place_local parent。' +
      '高层 / 塔楼 / 标准层重复的建筑用它，别手写几十遍同样的楼层。',
    produces: 'part',
    params: [
      { name: 'parts', kinds: ['list'], required: true, desc: '本层全部构件的 part id 列表，如 [p_slab, p_w1, p_c1]' },
      // count/storey_height 与 levels 是二选一的两条路，schema 表达不了 either-or：
      // 都登记为可选，缺哪一组由电池按具体情况报错（错误会定位回这一行）。
      { name: 'count', kinds: ['number'], desc: '总层数（含被复制的原始层）；count=5 → 共 5 层。与 storey_height 成对使用，用 levels 时可省' },
      { name: 'storey_height', kinds: ['number'], desc: '层高：每层相对下层抬升的 Z（米）。与 count 成对使用，用 levels 时可省' },
      { name: 'root', kinds: ['ref'], desc: '本层的基准 part（merge 模式下是合并 GLB 的坐标系；走 URDF 路时层间 fixed joint 也挂它）；缺省=本层的根/最低件' },
      { name: 'mode', kinds: ['string'], desc: '"merge"（默认，整层烘成单个多材质 GLB、每层只剩 1 个 part）或 "instance"（逐层复制每个 part，保留逐件可寻址）' },
      { name: 'levels', kinds: ['list'], desc: '可选：显式给出各上层相对最底层的 Z 偏移列表（米，递增），给了就忽略 count/storey_height' },
      { name: 'prefix', kinds: ['string'], desc: '生成 id 前缀（merge → <prefix>_l1..lN；instance → <prefix>_l2_<原id>）；缺省=本语句 id' },
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

/** 列出指定 produces 类别的 op 名。 */
export function listOpsByProduces(produces: ProducesKind): readonly string[] {
  return SPECS.filter(s => s.produces === produces).map(s => s.name);
}

/** 列出所有可作为 part.shape / collision.shape 消费的 shape op。 */
export function listShapeOps(): readonly string[] {
  return listOpsByProduces('shape');
}

/** URDF 原生支持、无需 baker 的 shape op。 */
export function listUrdfNativeShapeOps(): readonly string[] {
  return [...URDF_NATIVE_SHAPE_OPS];
}

/** 需要以 geometry 子图形式整体 bake 的 profile / CSG / transform op。 */
export function listSubgraphBakeOps(): readonly string[] {
  return [...SUBGRAPH_BAKE_OPS];
}

/** 需要 baker 处理的 shape op；native primitive 由 URDF 直接表达。 */
export function listBakeableShapeOps(): readonly string[] {
  const native = new Set<string>(URDF_NATIVE_SHAPE_OPS);
  return listShapeOps().filter(op => !native.has(op));
}

export function opProduces(name: string, produces: ProducesKind): boolean {
  return getOpSpec(name)?.produces === produces;
}

/** Arg.kind 与 ExpectedKind 匹配 */
export function argMatchesKind(arg: Arg, expected: ExpectedKind): boolean {
  if (expected === 'any') return true;
  return arg.kind === expected;
}
