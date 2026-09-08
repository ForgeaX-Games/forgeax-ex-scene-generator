/**
 * SDF 隐式建模的数据类型 —— `sdf_blob` op（有机造型：多 primitive 平滑融合成一个连续体）
 * 的输入描述符。
 *
 * `SdfPrimitive` / `SdfOperation` / `SdfDescriptor` 采用 SDF 建模的通用形状：primitive 用
 * center/radius/height/size/radii/transform 描述，operation 是 smooth-union/subtract/intersect
 * 的 left/right 二元树。
 *
 * 限制（越界必须报 BakerError，不能静默截断——DSL 复算/缓存要求确定性且不隐藏用户的参数错误）：
 *   - primitives.length ∈ [1, 64]
 *   - operations.length ∈ [0, 128]
 *   - resolution ∈ [4, 64]（体素网格分辨率，三方向共用同一分辨率）
 */

export type SdfVector = readonly [number, number, number];

export type SdfPrimitiveType = 'sphere' | 'capsule' | 'box' | 'cone' | 'ellipsoid';

export const SDF_PRIMITIVE_TYPES: readonly SdfPrimitiveType[] = ['sphere', 'capsule', 'box', 'cone', 'ellipsoid'];

export type SdfOperationType = 'smooth-union' | 'subtract' | 'intersect';

export const SDF_OPERATION_TYPES: readonly SdfOperationType[] = ['smooth-union', 'subtract', 'intersect'];

export const SDF_LIMITS = {
  maxPrimitives: 64,
  maxOperations: 128,
  minResolution: 4,
  maxResolution: 64,
} as const;

/**
 * 单个 primitive 的局部坐标系形状 + 世界内的位置/朝向。
 *
 * `params` 按 `type` 定长解释（与 marching-cubes 采样调用一一对应）：
 *   - sphere:    [radius, _, _]
 *   - capsule:   [radius, height, _]     —— 局部沿 Y 轴，胶囊两端半球在 y=±height/2
 *   - box:       [sx, sy, sz]            —— 局部 AABB 全尺寸（不是半尺寸）
 *   - cone:      [radius, height, _]     —— 局部沿 Y 轴，底面在 y=-height/2、锥尖在 y=+height/2
 *   - ellipsoid: [rx, ry, rz]            —— 三轴半径
 * 未使用的分量必须仍是有限数（约定填 0），便于 primitives.ts 按类型定长解构而不做逐类型的可选字段判断。
 */
export interface SdfPrimitiveSpec {
  readonly id: string;
  readonly type: SdfPrimitiveType;
  readonly center: SdfVector;
  readonly params: SdfVector;
  /**
   * 局部坐标系相对世界的旋转（弧度），默认 [0,0,0]。约定为标准外旋 XYZ / roll-pitch-yaw
   * （R = Rz(rotation[2])·Ry(rotation[1])·Rx(rotation[0])），与本 DSL 的 part.rpy / joint
   * origin 一致——不是三.js Object3D.rotation 的 Euler('XYZ')（那是内旋，矩阵顺序相反）。
   * 具体的逆变换实现见 primitives.ts 的 sdfLocalPoint()。
   */
  readonly rotation: SdfVector;
}

/**
 * 二元操作：对 `left`/`right`（primitive id 或更早 operation 的 id）组合出一个新场。
 * `left`/`right` 按声明顺序解析——只能引用比自己先出现的 primitive/operation（禁止前向引用/环）。
 */
export interface SdfOperationSpec {
  readonly id: string;
  readonly type: SdfOperationType;
  readonly left: string;
  readonly right: string;
  /** smooth-union 的融合半径（米）；subtract/intersect 忽略此字段。 */
  readonly radius: number;
}

export interface SdfBounds {
  readonly min: SdfVector;
  readonly max: SdfVector;
}

export interface SdfDescriptor {
  readonly primitives: readonly SdfPrimitiveSpec[];
  readonly operations: readonly SdfOperationSpec[];
  /** 体素网格分辨率（每轴采样点数），[4, 64]。 */
  readonly resolution: number;
  /** 采样域 AABB；省略时由 primitives 的包围区域外扩推导（见 organic.ts）。 */
  readonly bounds?: SdfBounds;
}

/** 编译好的标量场：给定世界坐标点，返回该点到表面的（近似）有符号距离。 */
export type SdfSampleFn = (x: number, y: number, z: number) => number;
