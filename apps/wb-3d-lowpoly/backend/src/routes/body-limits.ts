/**
 * 各 mutation 路由的请求体上限与结构约束。
 *
 * 这些端点此前用 Fastify 默认 bodyLimit（1MB）且不校验载荷结构：`/batch` 在
 * `ops` 缺失 / 非数组时会把脏数据透传给 applyBatch 直接 500，而大体积载荷可以无界
 * 占用内存。统一在这里定义上限 + 在路由上挂 JSON schema，把畸形请求挡在 400。
 */

const MB = 1024 * 1024

/** `/api/v1/projects/:projectId/batch`：一批图操作。单个 op 的 param 值（如内联几何）可能较大。 */
export const BATCH_BODY_LIMIT = 8 * MB
/** 单批最多操作数——防止一次塞入海量 op 拖垮 applyBatch。 */
export const MAX_BATCH_OPS = 5000

/** `/api/v1/pipeline/import`：可能导入整张图（含所有节点 + 内联模板）。 */
export const IMPORT_BODY_LIMIT = 32 * MB

/** `/api/v1/execute`：只带一个可选 nodeId，载荷极小。 */
export const EXECUTE_BODY_LIMIT = 64 * 1024

/**
 * `/model/apply`、`/model/bake-batch`、`/model/patch`：请求体是 Geometry DSL 源码
 * （字符串），不是 `/execute` 那种"只带 nodeId"的窄载荷——这三个路由此前误用了
 * `EXECUTE_BODY_LIMIT`（64KB）。场景/建筑 DSL 一旦实例数多起来（城市级场景几百个
 * `mesh → part` 语句、建筑构件逐层展开）就能轻松超过 64KB，Fastify 直接 413，
 * agent 拿到的是一个没有 DSL 行号定位的裸错误，看起来就像"这一步突然失败/中断"。
 * 给够余量：8MB 顶得住上千条语句的 DSL 文本，同时仍远小于 8MB 的 `BATCH_BODY_LIMIT`
 * （后者要装内联几何，本来就该更大）。
 */
export const MODEL_DSL_BODY_LIMIT = 8 * MB
