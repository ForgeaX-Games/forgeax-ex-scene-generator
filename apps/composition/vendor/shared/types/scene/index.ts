/**
 * shared/types/scene barrel v3：ID-addressed 持久化 graph + Volume 内容代数 + 端口值 + 摘要。
 *
 * 拓扑：
 *   types.ts          — 跨边界数据接口（Transform；VoxelCell 仅供旧 bridge 电池迁移期兼容读取）
 *   persistent-map.ts — 底层容器：PersistentStringMap（HAMT，结构共享，O(log32 N) 摊销）
 *   graph.ts          — SceneGraph / SceneNode / NodeId + 操作原语（createNode / addChildren /
 *                        removeNode / setAttribute / setTransform / setContent / moveNode /
 *                        resolvePath / pathOf）；取代 tree.ts 的嵌套树 + path-copying。
 *   content.ts        — SceneContent 官方只有 voxel / mesh；grid/points/ref 只是 leftover wire。
 *                        类型合同与 `@forgeax/scene` 的 SceneTree 同一份。
 *   heightfield.ts    — 高度 grid → SceneMesh（电池与 3DMesh 共用 isotropic quad）。
 *   volume.ts         — Volume 判别联合（empty/uniform/dense/sparse）+ union/subtract/paint/
 *                        iterCells/cellCount；取代 upsertCells 的稠密 VoxelCell[] 枚举。
 *   port.ts           — 端口值（ScenePortValue{ graph, focus: NodeId } / parseScenePort / makeScenePort）
 *   projection.ts     — Scene → VoxelLayer 列表展平（projectSceneToVoxelLayers）；输出形状
 *                        字节级不变，是这次重构唯一保持稳定的下游边界（见重构规格「消费端」页）。
 *
 * 故意不在本 barrel 里的活文件（只能深路径 import，这样迁移点不会被 barrel 悄悄掩盖）：
 *   tree.ts            — 只给 backend/src/baked/store.ts；build-vendor.mjs 的独立编译入口
 *   heightfieldField.ts — build-vendor.mjs 的第三个入口，带构建期 smoke 断言
 *   mesh3d.ts / geometryMask.ts — 只被对应电池深路径 import
 */

export * from './types.js';
export * from './persistent-map.js';
export * from './graph.js';
export * from './content.js';
export * from './heightfield.js';
export * from './spline.js';
export * from './volume.js';
export * from './port.js';
export * from './projection.js';
export * from './spatial.js';
export * from './liftToSurface.js';
export * from './surfaceBand.js';
export * from './surfacePaint.js';
