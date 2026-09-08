/**
 * shared/types/geometry barrel：Geometry 跨边界类型 + DSL 解析/序列化/校验 + 端口值 + 摘要。
 *
 * 拓扑：
 *   types.ts        — 数据接口（Geometry / Statement / Arg / GeometryError）
 *   parser.ts       — DSL 文本 → Statement[]（Python-like SSA）
 *   serialize.ts    — Statement → DSL 单行 / 多行文本
 *   op-registry.ts  — op 名 → 签名（用于 validate + 未来 LSP）
 *   validate.ts     — 语义校验：SSA + ref + op + 参数 kind
 *   make.ts         — 构造 / append / emit / freshId / Arg 捷径
 *   port.ts         — 端口值 type guard
 *   summary.ts      — GeometrySummary（WS 广播 / tooltip 用）
 */

export * from './types.js';
export * from './parser.js';
export * from './serialize.js';
export * from './op-registry.js';
export * from './validate.js';
export * from './make.js';
export * from './port.js';
export * from './summary.js';
export * from './aabb.js';
export * from './mutate.js';
export * from './resolve.js';
export * from './surface.js';
