/**
 * shared/types/scene barrel：scene 跨边界类型 + 不可变树纯函数 + 端口值 + 摘要。
 *
 * 拓扑：
 *   types.ts    — 数据接口（SceneNodeSnapshot / Transform / VoxelCell）
 *   tree.ts     — 不可变树纯函数（emptyTree / readNode / listChildren / splitPath / upsertCells / setTransform / graftAt）
 *   port.ts     — 端口值（ScenePortValue / parseScenePort / makeScenePort）
 *   summary.ts  — SceneSummary 摘要（summarizeScenePort / isSceneSummary / formatSceneSummary）；前端 tooltip / panel 本地现算（不经广播）
 *   projection.ts — Scene → VoxelLayer 列表展平（projectSceneToVoxelLayers）；SceneOutput 电池用
 */

export * from './types.js';
export * from './tree.js';
export * from './port.js';
export * from './summary.js';
export * from './projection.js';
