/**
 * 跨层级共享类型的统一入口。
 * 各 tier 通过 `import { ... } from '@shared/types'` 使用。
 *
 * 只剩 scene 一个子树：battery / websocket / image-ref / point2d / point3d /
 * authoring-status 与内核（`@forgeax/node-runtime-react`）重复且零消费；
 * datatree 是 `packages/node-runtime/src/layer1/datatree` 的逐字拷贝；
 * geometry 是 3d-model 时代的 SSA DSL，和内核 `Geometry`（kind 判别联合）撞名。
 * 全部已删除，别再加回来——几何类型只有一份，见 CLAUDE.md §4。
 */

export * from './scene/index.js';
