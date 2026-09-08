# 接线索引（WIRING INDEX）— wb-2d-scene-asset-generator

> **这是什么。** 一张「东西在哪、谁连谁、数据怎么流」的客观事实索引，专为快速定位而生。
> 它**只陈述代码现状**（前端区域 ↔ 后端控制点、数据契约、传输链路），**不预设"某现象=改某文件"**——
> 定位方向由你自己判断，本索引只提供准确的地形图。
>
> **怎么用。** 先在这里看清三条数据通道和关键链路，再按需翻 [`wb-2d-frontend-map.md`](./wb-2d-frontend-map.md)（前端区域→后端落点）或 [`wb-2d-backend-map.md`](./wb-2d-backend-map.md)（后端接口/契约归类）。
>
> **怎么维护。** 改了 route / WS 事件 / postMessage 类型 / 前端区域结构 / 数据契约，**就回来改对应条目**（连同 `ARCHITECTURE.md`）。引用一律带 `file:line`；行号漂移属正常，以"文件 + 符号名"为准。
>
> 所有路径相对本 app 根：`packages/marketplace/plugins/node-editor/apps/wb-2d-scene-asset-generator/`。

---

## 1. 全局形态：1 个 host + 3 个同源 iframe

前端是**单个 Vite app**，靠 URL 的 `?pane=` 把自己拆成一个 host 和三个同源 iframe（`main.tsx:8-9` 读 `?pane`，缺省 `center`）：

```15:22:packages/marketplace/plugins/node-editor/apps/wb-2d-scene-asset-generator/frontend/src/App.tsx
export function App({ pane }: { pane?: string }): JSX.Element {
  const client = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])
  if (pane === 'preview' || pane === 'renderer') return <ImagePreviewSurface />
  if (pane === 'assetstore') return <GeneratedAssetStoreSurface />
  if (pane === 'left') return <WorkbenchLeftPane client={client} />
  return <WorkbenchHost />
}
```

| pane | 角色 | 挂载组件 | 详见 |
|---|---|---|---|
| `center`（缺省） | 主 host：kernel 画布 + 上排嵌入 iframe | `WorkbenchHost` | wb-2d-frontend-map §3 |
| `left` | 左侧控制侧边栏 | `WorkbenchLeftPane` | wb-2d-frontend-map §2 |
| `assetstore` | 嵌入的素材/生成图浏览 iframe | `GeneratedAssetStoreSurface` | wb-2d-frontend-map §4 |
| `preview` / `renderer` | 嵌入的预览 iframe | `ImagePreviewSurface` | wb-2d-frontend-map §4 |

后端是**单个 Fastify 服务**（默认 `PORT 9567`），所有 route group 在一处注册：`backend/src/main.ts:24-37`（详见 wb-2d-backend-map §1）。

---

## 2. 三条数据通道（前后端之间一切流动都走这三条之一）

| # | 通道 | 用途 | 代码落点 |
|---|---|---|---|
| **A. REST `/api/v1/*`** | 读图/改图/执行/项目/素材库/生成图/截图等一切**有后端的请求** | 前端唯一通用客户端 `frontend/src/api/HttpApiClient.ts`；各 surface 另有独立 fetch 客户端（`libraryApi.ts` / `bakedApi.ts` / `generatedAssetsApi.ts` / `rulesApi.ts`）；后端入口 `backend/src/main.ts` |
| **B. WebSocket 单条 `/ws`** | 服务端→前端的**实时事件推送**（图变更/执行进度/素材变更/渲染命令/截图请求） | 后端 `backend/src/routes/ws.ts`；前端通用订阅 `HttpApiClient.ts:288-319`（channel: `graph` / `execution` / `asset`），renderer 另起独立 socket 收 `renderer:command` / `screenshot:request`（`renderer/bridge/useRendererCommands.ts`、`useScreenshotCapture.ts`） |
| **C. 跨 iframe 总线（无后端）** | host↔iframe、iframe↔iframe 的**纯客户端视图态**（选区高亮、preview 开关、全屏、选中层/规则、画笔素材） | 父子用 `postMessage`（`workbench/protocol.ts`，§4）；同源兄弟 iframe 用 `localStorage` 的 `storage` 事件总线（`selectedLayerBus` / `editToolbarBus` / `paintAssetBus` 等） |

> **定位提示**：判断一个数据"从哪来"，先确定它属于 A / B / C 哪条通道——
> 是请求来的（A）、推送来的（B）、还是另一个 iframe 同步过来的纯前端态（C）。三者的排查手段完全不同。

---

## 3. 关键链路（端到端，每一环带落点）

### 链路一：一次图变更（加节点/连边/改参数）

```
前端 Editor 操作
  → POST /api/v1/projects/:projectId/batch     backend/src/routes/queries.ts → registerProjectPipelineRoutes
  → ensureMutationAccess(req)（per-agent 锁）   routes/projects.ts
  → applyBatch(rt, ops, {actor,label,batchId}) @forgeax/node-runtime apply-batch.ts
  → kernel 内 bus.emit('graph:applied')        apply-batch.ts
  → 经各 WS client 的 bind 订阅扇出             routes/ws.ts  → {event:'runtime', payload:{kind:'graph:applied'}}
  → 前端 reconcile 画布                          HttpApiClient 'graph' channel 订阅
```
注意：路由层**故意不二次广播** `graph:applied`（由 kernel bus 统一发）；`mutations.ts` 是空 stub。layout-only 批次在 kernel 内被跳过广播。

### 链路二：一次执行（跑节点产出 outputs/preview）

```
POST /api/v1/execute                  backend/src/routes/execute.ts:9（先鉴权 :10）
  → executeNode(rt, {nodeId?})         execute.ts:13
  → bus.emit('exec:started')           @forgeax/node-runtime execute-node.ts:220
  → 逐节点 runtime.outputs.write(...)  execute-node.ts:186-192
    + bus.emit('exec:node:output')     execute-node.ts:193
  → bus.emit('exec:completed')         execute-node.ts:197（错误 exec:error :176/201；非致命 exec:warn :141）
  → WS 'execution' channel 扇出到前端  routes/ws.ts:48-50
读回输出：GET /api/v1/nodes/:id/outputs/:portId   routes/queries.ts:11（落点在 kernel runtime.outputs）
```

### 链路三：AI/CLI 工具 → 后端（caller 身份与项目锁）

```
asset2d:* 工具调用                      backend/src/tool-handlers.ts（tools 表 :95-145）
  → 解析 backend URL                     backendBaseUrl :52-56
        FORGEAX_ASSET2D_BACKEND_URL > FORGEAX_PLUGIN_DEV_PORTS_FILE > 9567
  → 注入 caller header                   request() :58-84（x-forgeax-caller-kind/-agent-id/-session-id）
  → 后端还原 CallerIdentity              routes/projects.ts:28-40 extractCaller → per-agent 锁
  → 唯一 mutation 工具                    asset2d:pipeline.applyBatch → POST /api/v1/projects/:projectId/batch
```

### 链路四：渲染器命令 & 截图（agent 驱动 renderer iframe）

```
PATCH /api/v1/agent/renderer/view-mode 等  backend/src/agent/rendererRoutes.ts:52/62/76
  → broadcastToClients('renderer:command')  rendererRoutes.ts:58/72/78
  → renderer iframe 消费                      frontend/src/renderer/bridge/useRendererCommands.ts:50-70
截图：POST /api/v1/agent/screenshot/capture  agent/routes.ts:42
  → broadcastToClients('screenshot:request') agent/routes.ts:45
  → renderer 捕获后 POST /store               useScreenshotCapture.ts → agent/routes.ts:53
```

---

## 4. 跨 iframe postMessage 协议（通道 C 的父子部分）

正式类型联合定义在 `frontend/src/workbench/protocol.ts:65-72`，共 7 种：

| # | type | 方向/用途 |
|---|---|---|
| 1 | `workbench:request-focus` | 子→host：请求进入/退出全屏 |
| 2 | `workbench:query-focus` | 子→host：挂载时查询当前 focus 态 |
| 3 | `workbench:focus-changed` | host→子：广播 focus 变化 |
| 4 | `workbench:status-report` | 子→host：上报状态快照（layers/viewMode 等） |
| 5 | `workbench:editor-selection` | host→renderer：转发 Editor 选区做高亮 |
| 6 | `workbench:preview-change` | host→renderer：转发被关 preview 的节点集 |
| 7 | `workbench:renderer-command` | host→renderer：转发渲染控制命令 |

> ⚠️ **代码与类型不一致（如实标注）**：`WorkbenchHost.tsx:204` 还额外发了一个 `workbench:project-changed`（切项目时通知 iframe），但它**未被加入 `protocol.ts` 的 `WorkbenchMessage` 联合**——是个未在协议中声明的"第 8 种"消息。改协议时留意。

---

## 5. 索引导航

| 你想看 | 去 |
|---|---|
| 前端某区域/组件由后端哪里驱动、走哪条通道 | [`wb-2d-frontend-map.md`](./wb-2d-frontend-map.md) |
| 后端有哪些 REST 端点 / WS 事件 / 数据契约在哪定义 | [`wb-2d-backend-map.md`](./wb-2d-backend-map.md) |
| 领域电池怎么分组/执行、AI 生成与像素处理落点（**领域逻辑**） | [`wb-2d-battery-map.md`](./wb-2d-battery-map.md) |
| 模块在文件树哪个位置、"改 X 看哪"功能反向索引 | [`../apps/wb-2d-scene-asset-generator/ARCHITECTURE.md`](../apps/wb-2d-scene-asset-generator/ARCHITECTURE.md) |
| 子系统细节（backend / frontend / 扩展契约） | [`../apps/wb-2d-scene-asset-generator/docs/architecture/`](../apps/wb-2d-scene-asset-generator/docs/architecture/) |
