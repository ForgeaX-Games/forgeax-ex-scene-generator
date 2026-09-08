# 后端接口地图（BACKEND MAP）— wb-2d-scene-asset-generator

> **这是什么。** 把后端的**数据定义接口 / 数据传输接口 / 传输逻辑**做忠实于代码的归类：
> 注册总控在哪、有哪些 REST 端点（按 group）、WS 推送哪些事件、数据契约定义在何处、library/asset/agent 各管什么。
> **不替你判断 bug**——只回答"接口在哪、数据怎么定义、怎么传"。
> 路径相对本 app 根 `packages/marketplace/plugins/node-editor/apps/wb-2d-scene-asset-generator/`（`backend/src` 即下文的 `src`）。引用带 `file:line`，以"文件+符号名"为准。

---

## 1. 注册总控：集中编排，分散实现

**「注册集中、实现分散」**——这是你问的"后端接口总控是否在一个文件"的准确答案：

- **注册编排集中在一个文件**：`src/main.ts:18-40` 的 `buildApp()` 里，先 `app.get('/health')`（`:23`），再依次 `await register*(app)` 注册全部 **14 个 route group**（`:24-37`）。
- **端点实现分散**：每个 group 的端点定义在各自模块（导出一个 `register*Routes(app)`）。**没有任何单一文件列尽所有端点**——`main.ts` 只是注册入口。

| # | 注册函数（`main.ts` 行） | 实现文件 | 本文档章节 |
|---|---|---|---|
| 1 | `registerQueryRoutes` `:24` | `routes/queries.ts` | §2.1 |
| 2 | `registerMutationRoutes` `:25` | `routes/mutations.ts` | §2.2 |
| 3 | `registerPipelineImportRoutes` `:26` | `routes/pipelineImport.ts` | §2.3 |
| 4 | `registerExecuteRoutes` `:27` | `routes/execute.ts` | §2.4 |
| 5 | `registerWsRoutes` `:28` | `routes/ws.ts` | §3 |
| 6 | `registerScreenshotRoutes` `:29` | `agent/routes.ts` | §6 |
| 7 | `registerRendererAgentRoutes` `:30` | `agent/rendererRoutes.ts` | §6 |
| 8 | `registerLibraryRoutes` `:31` | `library/routes.ts` | §5 |
| 9 | `registerBakedRoutes` `:32` | `baked/routes.ts` | §5 |
| 10 | `registerProjectRoutes` `:33` | `routes/projects.ts` | §2.5 |
| 11 | `registerGroupTemplateRoutes` `:34` | `routes/groupTemplates.ts` | §2.6 |
| 12 | `registerAssetRoutes` `:35` | `routes/assets.ts` | §2.7 |
| 13 | `registerGeneratedAssetRoutes` `:36` | `assets/routes.ts` | §5 |
| 14 | `registerAiRoutes` `:37` | `ai/routes.ts` | — |

> `routes/batteryCategories.ts` **不是 route group**（无 `register*`），只导出 `getBatteryCategories()`，被 `queries.ts:4,18-22` 的 `/api/v1/ops` 调用来回贴 UI 分类（`batteryCategories.ts:118-123`）。

启动/运行时装配见 `runtime.ts`（kernel `OpRegistry` + `createBatteryLoader` 扫描 `resolveBatteryScanRoots(repoRoot)`，`ProjectRegistry` 初始化 `defaultType:'scene'`/`defaultProjectId:'main'`）。

---

## 2. REST 端点逐组列举

### 2.1 queries.ts — 只读查询 + project pipeline 注册 `routes/queries.ts`
| 端点 | 用途 | 行 |
|---|---|---|
| `GET /api/v1/projects/:projectId/{pipeline,nodes,…}` | 由 `registerProjectPipelineRoutes`（`@forgeax/editor-host`）注册 | `queries.ts` |
| `POST /api/v1/projects/:projectId/batch` | 唯一 mutation 入口 → kernel `applyBatch`；`graph:applied` 由 kernel bus 发 | 同上 |

### 2.2 mutations.ts — 空 stub `routes/mutations.ts`
| 端点 | 用途 | 行 |
|---|---|---|
| （无 HTTP） | `registerMutationRoutes` 为空；batch 已走 `queries.ts` → `registerProjectPipelineRoutes` | stub |

### 2.3 pipelineImport.ts `routes/pipelineImport.ts:67-196`
| 端点 | 用途 | 行 |
|---|---|---|
| `GET /api/v1/pipeline/templates` | 列 `<projectRoot>/templates/*.json` | `:69` |
| `POST /api/v1/pipeline/import` | `importPipelineGraph`(:128)，可选 `executeAfter`(:149-159) | `:99` |
| `POST /api/v1/pipeline/export` | 当前图写入 templates 文件 | `:167` |

### 2.4 execute.ts `routes/execute.ts:6-16`
| 端点 | 用途 | 行 |
|---|---|---|
| `POST /api/v1/execute` | 鉴权(:10) → `executeNode`(:13)，返回 `handle.done` | `:9` |

### 2.5 projects.ts — 项目/工作区 + per-agent 锁 `routes/projects.ts:78-203`
| 端点 | 用途 | 行 |
|---|---|---|
| `GET /api/v1/projects`、`/projects/:id` | 列表/单个 | `:80`/`:86` |
| `POST /api/v1/projects` | 新建（可从模板 seed） | `:94` |
| `PUT/DELETE /api/v1/projects/:id` | 改名/删除 | `:125`/`:136` |
| `POST /api/v1/projects/:id/activate` | 激活，**唯一直接 `broadcastToClients` 的 mutation 路由**（发 `project:activated`，:166-174） | `:153` |
| `POST /api/v1/projects/:id/close` | 释放 AI 锁 | `:183` |
| `GET/PUT /api/v1/workspace` | 工作区设置 | `:191`/`:196` |

> 锁机制：`extractCaller`(:28-40) 从 `x-forgeax-caller-*` header 还原 `CallerIdentity`；`ensureMutationAccess`(:47-52) → `reg.checkMutationAccess`，被 `mutations.ts`/`execute.ts`/`pipelineImport.ts` 复用。

### 2.6 groupTemplates.ts `routes/groupTemplates.ts:90-159`
`GET /group-templates/categories`(:91)、`GET /group-templates`(:105)、`GET /group-templates/:id`(:139)、`POST /group-templates/save`(:148，写 `batteries/groups/<cat>/<name>/`)。

### 2.7 assets.ts（运行时 assets，非 generated）`routes/assets.ts:4-16`
`GET /api/v1/assets`(:5) — `rt.assets.list()`（剥 `absPath`）。

---

## 3. WebSocket 传输（单条 `/ws`）`routes/ws.ts`

- **注册/路由**：`registerWsRoutes`(:64-87)，`GET /ws`(:66)。
- **订阅**：client 连接后发 `{action:'subscribe', channels:[...]}`，服务端在 `socket.on('message')`(:70-81) 解析，默认 channel `['graph','execution','asset']`(:78)，`bind(entry)`(:79)。
- **bind**：(:43-55) 把订阅绑到**当前活动 runtime** 的 `rt.subscriptions.subscribe(...)`(:48)，每个事件以 `{event:'runtime', payload}` 下发(:50)。
- **`broadcastToClients`**：定义 `:21-33`（遍历 `clients` 直接 `socket.send`）。调用方：`runtime.ts:56`（`ops:changed`）、`projects.ts:166-174`（`project:activated`）、`agent/routes.ts:45`（`screenshot:request`）、`agent/rendererRoutes.ts:58/72/78`（`renderer:command`）、`baked/routes.ts:26`（`baked:changed`）。
- **重绑**：`rebindWsSubscriptions`(:58-60)，切项目时调用。

### 事件谱（哪些事件会推到前端）
| 事件 | 来源 | channel |
|---|---|---|
| `graph:applied` / `graph:rejected` | kernel bus（`apply-batch.ts:644-648`），**非路由手动广播** | graph |
| `exec:started` / `exec:node:output` / `exec:completed` / `exec:error` / `exec:warn` | kernel `execute-node.ts` | execution |
| `asset:added` / `asset:changed` / `asset:removed` | kernel | asset |
| `project:activated` | `projects.ts` 直接广播 | — |
| `ops:changed`（电池热重载） | `runtime.ts:56` 直接广播 | — |
| `screenshot:request` / `renderer:command` / `baked:changed` | agent/baked 路由直接广播 | — |

> kernel 事件契约：`RuntimeEvent` / `RuntimeChannel` 定义于 `@forgeax/node-runtime` `layer2/subscriptions.ts`（backend `ws.ts:2` 引 `RuntimeChannel`）。

---

## 4. 数据定义 / 契约：在哪定义

### 来自 kernel 包 `@forgeax/node-runtime`（本 app `workspace:*` 引源码）
| 契约 | 定义位置 |
|---|---|
| `OpSpec` | `packages/.../node-runtime/src/layer1/types/op-spec.ts:136` |
| `GraphFileV1` | `node-runtime/src/layer1/storage/types.ts:12` |
| `GraphNode/GraphEdge/NodeGroup/Pipeline` | `node-runtime/src/layer1/types/graph.ts:36/20/56/97` |
| `RuntimeEvent/RuntimeChannel` | `node-runtime/src/layer2/subscriptions.ts:31/33` |
| `ImportGraphFormat/ImportGraphInput/ImportPipelineResponse` | backend 在 `pipelineImport.ts:10-17` 导入 |
| `CallerIdentity` | backend `projects.ts:13` 导入 |
| **`ApiClient`** | **在前端 React 包**：`packages/.../node-runtime-react/src/api/ApiClient.ts:103`。backend 不实现它，前端 `HttpApiClient.ts` 才是其实现 |

### 本 app backend 自定义 type（非 kernel）
| type | 文件 |
|---|---|
| `AssetRecord/AliasMeta/CollisionMask/LibraryService/RuleListItem` | `library/service.ts:14/128/142/388/377` |
| `BatteryUiMeta` | `routes/batteryCategories.ts:25-38` |
| `ScreenshotRecord/AgentScreenshotView` | `agent/routes.ts:18-19` |
| `Socketish/ClientEntry`（WS 内部） | `ws.ts:5-13` |
| `BakedCell` 等 | `baked/store.ts`（`baked/routes.ts:19` 引） |

> ⚠️ **如实标注**：`schemas/` 目录**基本为空**——仅 `schemas/ops/.gitkeep`、`schemas/batteries/.gitkeep` 两个占位。契约实际落在 kernel 的 **TS 类型**上，不在此目录。别去 `schemas/` 找契约。

---

## 5. 数据资产体系：两套不要混淆

| 体系 | 性质 | 实现 | 端点 |
|---|---|---|---|
| **只读 library**（内置素材库） | content-addressed，**只读 SQLite** | `library/db.ts`（`getSharedDb` `readonly:true` :51，打开 `materials/asset-store/library.db`）、`library/service.ts`（`createService` :446-578）、`library/routes.ts:16-89` | `GET /api/v1/library/{serve/*,aliases,aliases-meta,zones,rules,facets,list}`（`:19/43/48/55/59/63/69`） |
| **generated-assets**（项目产出图） | 可写，落在 runtime 项目目录 | `assets/routes.ts:24-90` | `GET/POST /api/v1/generated-assets*`、`GET /api/v1/preview/latest`(:80)、`POST /api/v1/preview/select-asset`(:90)、`GET /api/v1/library/blob/:blobId`(:55，注意它在此文件) |
| **baked layers**（可编辑层） | 可写 | `baked/routes.ts`、`baked/store.ts` | `/api/v1/baked/*`（list/layers/cells/move/rename/bake/attributes…），改动广播 `baked:changed`(:26) |

> library 数据来源：blob 字节 `resolveBlobPath`(`service.ts:588-591`，`<asset-store>/blobs/xx/yy/<sha>`)；规则 JSON 在 `rulesDir`(`service.ts:594-596`，`<repoRoot>/assets/rules/`，**不在 DB**）。**绝不写 `library.db`**（见 `AGENTS.md`）。

---

## 6. agent/：renderer 控制 + 截图

| 端点 | 行为 | 行 |
|---|---|---|
| `POST /api/v1/agent/screenshot/capture` | 广播 `screenshot:request`(:45)，await renderer 回填，落盘 PNG 返回路径（不返 base64） | `agent/routes.ts:42` |
| `POST /api/v1/agent/screenshot/store` | renderer 回填截图，`svc.resolveCapture`(:55) | `agent/routes.ts:53` |
| `GET /api/v1/agent/screenshot/latest` | 取最近截图 | `agent/routes.ts:59` |
| `GET /api/v1/agent/renderer/info` | renderer pane 信息（不广播） | `agent/rendererRoutes.ts:45` |
| `PATCH /api/v1/agent/renderer/view-mode` | 下发 `renderer:command` `set-view-mode`(:58) | `agent/rendererRoutes.ts:52` |
| `POST /api/v1/agent/renderer/select-layer` | 下发 `select-layer`(:72) | `agent/rendererRoutes.ts:62` |
| `POST /api/v1/agent/renderer/open-all-sublayers` | 下发 `open-all-sublayers`(:78) | `agent/rendererRoutes.ts:76` |

前端消费：`renderer:command` → `renderer/bridge/useRendererCommands.ts`；`screenshot:request` → `useScreenshotCapture.ts`（见 wb-2d-frontend-map §5.1）。

---

## 速查：后端"某接口/某数据在哪"

1. 是 REST 还是 WS？REST → §2（按 group）/ §5（资产）/ §6（agent）；WS → §3 事件谱。
2. 想找数据**怎么定义**的 → §4（kernel 契约在 `@forgeax/node-runtime`，本 app type 在各模块，`schemas/` 是空的）。
3. 想找数据**怎么传/链路** → [`wb-2d-wiring-index.md`](./wb-2d-wiring-index.md) §3。
