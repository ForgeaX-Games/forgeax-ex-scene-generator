/**
 * shared/types/scene barrel v3：ID-addressed 持久化 graph + Volume 内容代数 + 端口值 + 摘要。
 *
 * 拓扑：
 *   types.ts          — 跨边界数据接口（Transform；VoxelCell 仅供旧 bridge 电池迁移期兼容读取）
 *   persistent-map.ts — 底层容器：PersistentStringMap（HAMT，结构共享，O(log32 N) 摊销）
 *   graph.ts          — SceneGraph / SceneNode / NodeId + 操作原语（createNode / addChildren /
 *                        removeNode / setAttribute / setTransform / setContent / moveNode /
 *                        resolvePath / pathOf）；取代 tree.ts 的嵌套树 + path-copying。
 *   content.ts        — SceneContent 判别联合（voxel Volume / mesh / grid / unknown）；
 *                        线上缺省 Volume 视为 voxel。S4 填 mesh payload。
 *   heightfield.ts    — 高度 grid → SceneMesh（电池与 3DMesh 共用 isotropic quad）。
 *   stroke.ts         — 路面 mask → 贴地浅色条带 mesh（S5 Road）。
 *   volume.ts         — Volume 判别联合（empty/uniform/dense/sparse）+ union/subtract/paint/
 *                        iterCells/cellCount；取代 upsertCells 的稠密 VoxelCell[] 枚举。
 *   port.ts           — 端口值（ScenePortValue{ graph, focus: NodeId } / parseScenePort / makeScenePort）
 *   summary.ts        — SceneSummary 摘要；前端 tooltip / panel 本地现算（不经广播）
 *   projection.ts     — Scene → VoxelLayer 列表展平（projectSceneToVoxelLayers）；输出形状
 *                        字节级不变，是这次重构唯一保持稳定的下游边界（见重构规格「消费端」页）。
 *
 * 注意：tree.ts 已从本 barrel 移除（不再被 export *），物理文件保留到 Phase 4 清理阶段整体
 * 删除——迁移期内如果还有代码直接深路径 import '.../tree.js'，那是本轮重构故意暴露出的
 * 待迁移点，不应该被这个 barrel 悄悄掩盖。
 */

export * from './types.js';
export * from './persistent-map.js';
export * from './graph.js';
export * from './content.js';
export * from './heightfield.js';
export * from './stroke.js';
export * from './spline.js';
export * from './sweep.js';
export * from './points.js';
export * from './boxes.js';
export * from './structures.js';
export * from './volume.js';
export * from './port.js';
export * from './summary.js';
export * from './projection.js';
export * from './spatial.js';
