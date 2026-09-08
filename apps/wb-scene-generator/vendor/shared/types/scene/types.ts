/**
 * SceneTree v2 跨边界类型定义（data-as-port 模型）。
 *
 * 与 v1 的根本差异：scene 不再是项目级全局可变单例，而是沿 wire 流动的不可变值。
 * 端口承载 ScenePortValue（{ tree, focus }），见 ./port.ts；
 * 树由 ./tree.ts 的纯函数构造和派生，所有节点深 freeze。
 *
 * 命名约定（与 splitPath 对齐）：
 *   - 根节点 path = "/"，name = ""
 *   - 任意非根节点 path 以 "/" 开头，例如 "/Houses/House01/Walls"
 *   - 不允许尾随 "/"、空段、含 "/" 的段名
 *
 * 扁平化模型：节点统一形态，任何节点都可同时携带 cells（自身体素）与 children（子节点）。
 * "叶子" 重新定义为 `children.length === 0` 的节点，不再是数据形态上的二分。
 */

/** 节点局部 transform（相对父节点）。v1 仅用 translation；scale/rotation 预留。 */
export interface Transform {
  /** 平移（局部 → 父空间） */
  translation?: readonly [number, number, number];
  /** 各轴缩放；v1 通常不用 */
  scale?: readonly [number, number, number];
  /** 欧拉角（弧度，XYZ 顺序）；v1 通常不用 */
  rotation?: readonly [number, number, number];
}

/** 体素单元：节点上的一个 (x,y,z) 占据。token 是体素语义标签（"wall" / "roof" / "ground" 等开放命名）。 */
export interface VoxelCell {
  x: number;
  y: number;
  z: number;
  token: string;
  /** 可选状态字段（如朝向、亮度、装饰参数等），由具体 schema 解释 */
  state?: Readonly<Record<string, unknown>>;
}

/**
 * 场景节点不可变快照（USD prim 心智模型）。
 *
 * 任何节点都可以同时拥有自身体素（cells）与子节点（children）。
 * - cells 缺省视为空集
 * - children 必有，默认为空数组
 * - schema 单独标注节点几何语义类型（开放命名）
 *
 * 所有节点（含 cells、children 数组）由 ./tree.ts 深 freeze；
 * 端口间传递的就是这个对象的引用，外部不得就地修改。
 */
export interface SceneNodeSnapshot {
  /** 节点路径段（不含 / 前缀，根节点为 ""） */
  name: string;
  /** 完整路径（"/Houses/House01"） */
  path: string;
  /** 节点语义类型（开放命名） */
  schema?: string;
  /** 局部 transform；缺省视为单位变换 */
  transform?: Transform;
  /** 该节点（含子树）的版本号；任意子孙变化时单调递增 */
  version: number;
  /** 节点自身携带的稀疏体素；缺省视为空集 */
  cells?: readonly VoxelCell[];
  /** 子节点；按 name 字典序排列；默认 [] */
  children: readonly SceneNodeSnapshot[];
  /**
   * 自定义键值对（USD customData / glTF extras 心智模型）：业务侧向节点挂的开放数据。
   * scene 内透明持有，不参与摘要/广播；mutation 自动保留（setTransform / upsertCells / graftAt 移植均不丢）。
   */
  attributes?: Readonly<Record<string, unknown>>;
  /**
   * 节点本地坐标系的逻辑画布尺寸（grid 列数 / 行数）。原点隐含 (0,0)。
   * 由 bridge 层（grid2node 等）在节点诞生时写入；mutation 自动保留。缺省视为不限。
   */
  bounds?: Readonly<{ width: number; height: number }>;
}
