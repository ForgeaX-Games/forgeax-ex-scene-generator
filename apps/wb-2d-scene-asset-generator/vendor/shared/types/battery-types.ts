/**
 * 跨层级（前端 / 后端）共享的电池基础类型枚举。
 *
 * 各 tier 的 Battery 接口形态本来不同（后端含 sourcePath/createdAt 等运行时字段，
 * 前端含 nameEn/iconSvg 等显示字段），不在 shared 中统一；
 * 此文件只锁定真正"跨边界共用"的枚举与字面量类型。
 */

/** 电池底层的技术类型分类（决定后端执行路径与前端节点组件路由） */
export type BatteryType = 'ts' | 'json' | 'special' | 'ai' | 'group';

/**
 * DataTree 端口粒度（参见 docs/refactor/datatree.md §4.3）：
 *   - 'item' — 默认；dispatcher 按 path 对齐 fanout，每个 item 调一次
 *   - 'list' — 函数收到整条 branch 的 T[]，按 path fanout 但不拆 items
 *   - 'tree' — 整棵 DataTree<T> 不 fanout 直接传入，供 graft/flatten 等算子电池
 *
 * 缺省（meta.json 未声明）= 'item'。
 */
export type BatteryAccess = 'item' | 'list' | 'tree';

/**
 * 多输入端口的 path 对齐策略（参见 docs/refactor/datatree.md §4.4）。
 *   - 'longest'  — 缺省；以 branch 最多的输入为准，短的最后一支重复填补
 *   - 'shortest' — 以最少为准截断
 *   - 'cross'    — 笛卡尔积所有 path 组合
 *   - 'pairwise' — 各输入 path 必须严格一致，否则报错（严格模式）
 */
export type ShapeLacingMode = 'longest' | 'shortest' | 'cross' | 'pairwise';
