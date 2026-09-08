# 前端区域地图（FRONTEND MAP）— wb-2d-scene-asset-generator

> **这是什么。** 按 UI 区域**归类**前端的每一块：它是哪个组件、由 kernel 提供还是本 app 自写、靠哪条数据通道（A=REST / B=WS / C=跨 iframe 总线，见 [`wb-2d-wiring-index.md`](./wb-2d-wiring-index.md) §2）连到后端的哪个落点。
> **不替你判断 bug 在哪**——只告诉你"这块东西的数据从哪来、归谁管"。
> 路径相对本 app 根 `packages/marketplace/plugins/node-editor/apps/wb-2d-scene-asset-generator/`。引用带 `file:line`，以"文件+符号名"为准（行号会漂）。

---

## 区域总览（与 `?pane=` 对应）

```
┌─────────────── center: WorkbenchHost ───────────────┐
│  上排：嵌入 iframe（assetstore / preview 两块）        │  ← §3.2，src=?pane=…
│  下方：kernel <Editor>（电池栏 + 画布 + 历史）          │  ← §3.1，本 app 仅 props 扩展
└──────────────────────────────────────────────────────┘
   left: WorkbenchLeftPane（独立 iframe，左侧控制栏）      ← §2
   assetstore iframe → GeneratedAssetStoreSurface         ← §4
   preview iframe    → ImagePreviewSurface                ← §4
```

> ⚠️ **如实标注**：功能更全的 `RendererSurface`（kernel 体素渲染器）与 `AssetStoreSurface`（完整素材库）**目前没有接进 `App.tsx` 的 router**——全仓除 `frontend/src/surfaces/__tests__/surfaces.smoke.test.tsx:4-5` 外无挂载点。当前 router 实际生效的是轻量的 `ImagePreviewSurface` / `GeneratedAssetStoreSurface`。本文 §4 标明"当前生效"，§5 单独记录"已实现未接入"的两块，避免误判。

---

## 2. 左侧控制栏 `WorkbenchLeftPane`（`?pane=left`）

单文件多区段，不是子路由；由两套切换器驱动：顶部嵌入开关 tabs（`EmbedToggle`，定义 `:568-591`，挂 `:288-292`）+ 下半 group 切换（`GroupTab`，定义 `:540-563`，挂 `:357-361`）。

| 子区域（用户叫法） | 组件 | 来源 | 数据通道 → 后端落点 | file:line |
|---|---|---|---|---|
| **project**（项目，Open/Save） | kernel `<ProjectPanel>` | kernel | A：`/api/v1/projects*`、`/api/v1/pipeline/import` | `WorkbenchLeftPane.tsx:312-345` |
| **2d**（=scene group，2D 场景控制） | `SceneGeneratorControlsPanel` | 本 app | 与中央 Editor 经 `syncKey` 对齐（同 Editor 的 A/B 通道） | `WorkbenchLeftPane.tsx:363-367` |
| **assetstore**（选中规则详情） | `RuleDetail` / `RuleFaceRow`（本文件内） | 本 app | C：`rulesApi` localStorage 总线读选中规则 | `WorkbenchLeftPane.tsx:369-391`（定义 `:451-490`） |
| **preview**（渲染器编辑工具栏） | `PreviewControlsPanel` | 本 app | C：`editToolbarBus` / `selectedLayerBus` localStorage 总线 | `WorkbenchLeftPane.tsx:393-407` |
| 嵌入面板开/关（2d/assetstore/preview） | `EmbedToggle` | 本 app | C：写 localStorage 键，中央 host 镜像 | `WorkbenchLeftPane.tsx:577` → host 监听 `WorkbenchHost.tsx:85-93` |

---

## 3. 中央 host `WorkbenchHost`（`?pane=center`，缺省）

布局拆"上排嵌入 iframe + 下方 kernel Editor"（`WorkbenchHost.tsx:270-362`）。

### 3.1 电池栏 + 画布 = kernel `<Editor>`（**本 app 不自写**）

挂载于 `WorkbenchHost.tsx:336-351`；本 app 只通过 props 做**域扩展**：

```336:351:packages/marketplace/plugins/node-editor/apps/wb-2d-scene-asset-generator/frontend/src/workbench/WorkbenchHost.tsx
      {editorInline && (
        <div className="scene-workbench__editor">
          <Editor
            apiClient={client}
            ...
            domainNodeTypes={scenePanelTypes}
            domainPortTypes={scenePortTypes}
            domainValueFormatters={sceneValueFormatters}
```

| 扩展通道（prop） | 本 app 提供什么 | file:line |
|---|---|---|
| `domainPortTypes` | `scenePortTypes`——`scene`/asset2d 端口类型，色 `#fb923c` | `WorkbenchHost.tsx:11-13` |
| `domainNodeTypes` | `scenePanelTypes`——域节点画布渲染器 | `panels/scenePanels.ts:17-24` |
| `domainValueFormatters` | `sceneValueFormatter`——解析 `ScenePortValue={tree,focus}` 渲染 tooltip | `WorkbenchHost.tsx:14` / `workbench/sceneValueFormatter.ts` |
| `scenePanels` | kernel PropertiesPanel 内的自定义 inspector 面板 | `panels/scenePanels.ts` |

> 电池栏/画布/历史的数据：A 通道（`POST /api/v1/projects/:projectId/batch`、`/api/v1/projects/:projectId/{pipeline,nodes,edges,ops,groups,history}`、`/api/v1/execute`，经 `HttpApiClient`）+ B 通道（`/ws` 的 `graph` channel 收 `graph:applied`）。**改画布/电池栏行为本身属 kernel 改动**（见 wb-2d-wiring-index §5 与 `../apps/wb-2d-scene-asset-generator/ARCHITECTURE.md`）。

### 3.2 上排嵌入 iframe（assetstore / renderer 两块）

同一个 Vite app 的 `?pane=` 子表面，挂于 `WorkbenchHost.tsx:289-314`，`src` 来自 `paneUrl('assetstore')` / `paneUrl('preview')`（`paneUrls.ts:8-11`）。host 与这两块之间走 **C 通道**：

| 同步内容 | 消息/总线 | host 落点 | 子表面落点 |
|---|---|---|---|
| Editor 选区 → renderer 高亮 | `workbench:editor-selection`（postMessage） | 发 `WorkbenchHost.tsx:135` | 收 `RendererSurface.tsx:260` |
| preview 开关节点集 → renderer | `workbench:preview-change`（postMessage） | 发 `WorkbenchHost.tsx:159` | 收 `RendererSurface.tsx:262` |
| 切项目通知 iframe | `workbench:project-changed`（postMessage，**未入协议类型**） | 发 `WorkbenchHost.tsx:204` | — |

---

## 4. 当前生效的嵌入 surface（轻量浏览）

| Surface（pane） | 渲染什么 | 数据通道 → 后端落点 | file:line |
|---|---|---|---|
| `ImagePreviewSurface`（`preview`/`renderer`） | 最新生成图缩略图+大图+prompt，2s 轮询 | A：`GET /api/v1/generated-assets`、`GET /api/v1/preview/latest`、`GET /api/v1/generated-assets/blob/:alias` | `generatedAssetsApi.ts:15-38`，调用 `ImagePreviewSurface.tsx:19/34` |
| `GeneratedAssetStoreSurface`（`assetstore`） | 生成图按文件夹分组浏览 | A：`GET /api/v1/generated-assets/folders`、`GET /api/v1/generated-assets?folder=` | `generatedAssetsApi.ts:23-28`，调用 `GeneratedAssetStoreSurface.tsx:20` |

> 这两块**没有 WS**，纯轮询 + REST。生成图体系的后端在 `backend/src/assets/routes.ts`（注意不是只读的 `library/`），详见 wb-2d-backend-map §5。

---

## 5. 已实现但当前未接入 router 的两块（如实记录）

定位时若看到这两个组件，注意它们**当前不在 `App.tsx` router 链路里**（只在 smoke 测试挂载，`surfaces/__tests__/surfaces.smoke.test.tsx:4-5`）：

### 5.1 `RendererSurface`（kernel 体素渲染器，3D/视图）

工具栏 + `RenderCanvas` + Layers 面板（Output / Editable 两段）。视图模式 `VIEW_MODES=['top','topBillboard','iso','free3d']`（`RendererSurface.tsx:37`）。

| 子部分 | 数据通道 → 后端落点 | file:line |
|---|---|---|
| Output 层（scene_output 体素） | A+B：`useNodePreviews` 拉 `listNodes/listOps/getNodeOutput`，订阅 `exec:completed`/`graph:applied` 刷新 | `renderer/bridge/useNodePreviews.ts:84/108/130/192-197` |
| Editable(baked) 层 | A：`bakedApi` 独立 fetch `/api/v1/baked/*`（list/layers/cells/move/rename/bake…），挂载拉一次 | `renderer/bridge/bakedApi.ts:51-130`、`useBakedLayers.ts:25-29` |
| 画笔写回 | A：`PATCH /api/v1/baked/layers/cells` | `renderer/host/RenderCanvas.tsx:168/252` |
| asset 匹配元数据 | A：`GET /api/v1/library/aliases-meta?zone=raw` | `renderer/bridge/useAliasMetas.ts:15` |
| 渲染命令（set-view-mode 等） | B：独立 `/ws` 收 `renderer:command`，或 host 转发 `workbench:renderer-command` | `renderer/bridge/useRendererCommands.ts:50-70` |
| 截图 | B：独立 `/ws` 收 `screenshot:request` → `POST /api/v1/agent/screenshot/store` | `renderer/bridge/useScreenshotCapture.ts:9/27` |

renderer 子系统结构（`frontend/src/renderer/`）：`bridge/`（后端数据→render store 注入层）、`framework/`（渲染插件契约 `framework/plugin.ts:52-118`）、`modes/`（4 个视图插件，`modes/index.ts:3-6` 自注册）、`host/`（挂载插件+交互层 `host/RenderCanvas.tsx`、`host/ModeSwitcher.tsx`）。

### 5.2 `AssetStoreSurface`（完整素材库）

素材网格 + zone/taxonomy/view 下拉 + 规则卡 + 分页。

| 子部分 | 数据通道 → 后端落点 | file:line |
|---|---|---|
| 素材列表（按 zone 批量拉） | A：循环 `GET /api/v1/library/list`（500 行/批） | `surfaces/library/assetStoreStore.ts:262-302` |
| 文件夹/分面 | A：`GET /api/v1/library/facets` | `assetStoreStore.ts:210-224` |
| 规则伪 zone | A：`GET /api/v1/library/rules`（`rulesApi`） | `assetStoreStore.ts:267` |
| 实时刷新 | B：`HttpApiClient.subscribe('asset')` 收 `asset:*` | `AssetStoreSurface.tsx:205` |
| 选中层/规则/画笔素材跨 iframe 同步 | C：`selectedLayerBus`/`editToolbarBus`/`paintAssetBus` localStorage 总线 | `AssetStoreSurface.tsx:4-5` |

---

## 速查：前端某块"数据从哪来"

1. 它在哪个 pane？（§区域总览）→ 找到组件文件。
2. 组件走哪条通道？A（有 `*Api`/`HttpApiClient` 调用）/ B（有 `subscribe(...)` 或独立 `/ws`）/ C（有 `*Bus` 或 `postMessage`）。
3. A/B → 去 [`wb-2d-backend-map.md`](./wb-2d-backend-map.md) 查那个端点/事件的后端落点；C → 纯前端态，后端无关。
