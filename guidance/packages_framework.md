# packages_framework — node-editor 内核七包速览

> node-editor monorepo 的内核位于 `packages/*`，共 **7 个 `workspace:*` 包**。
> Runtime 层（图执行/画布/脚手架）领域无关；`scene-authoring` 是 Authoring 层
> （Scene Script 语言栈，领域相邻但不是 baker/renderer）。
> 三个应用（`apps/wb-3d-lowpoly`、`apps/wb-scene-generator`、`apps/wb-2d-scene-asset-generator`）以引源码方式消费它们；
> 领域逻辑（3D baker、场景 renderer、各自几百个专属电池）全在 `apps/*`，不在内核里。
>
> 更详细的结构与数据流见根 [`ARCHITECTURE.md`](../ARCHITECTURE.md)。

---

## 依赖关系图

```
node-runtime（核心，无 workspace 依赖；仅 chokidar/pino/zod）
    ▲     ▲      ▲         ▲
    │     │      │         └── scene-authoring ──→ node-runtime
    │     │      └── node-runtime-cli ──→ node-runtime
    │     └──────── node-runtime-react ─→ node-runtime   (peer: react/reactflow/zustand)
    └── batteries-common ─→ node-runtime, scene-authoring
              ▲
              └── editor-host ─→ batteries-common, node-runtime

i18n（独立，无 workspace 依赖；仅 intl-messageformat）

apps/* backend  ──→ node-runtime, editor-host  (scene-generator 另加 scene-authoring)
apps/* frontend ──→ node-runtime-react, i18n
```

**构建**：`bun install && bun run build`。改内核源码 → 一次 `bun run build` → 三个 app 同时生效。

---

## 七包概览

| 包 | 角色 | 关键点 |
|---|---|---|
| `node-runtime` | 图引擎 + 执行 + 存储（后端核心） | 纯 Node，无 React/HTTP；唯一权威 |
| `node-runtime-react` | React 画布 + 状态 + 前后端传输（前端核心） | `<Editor>`、`ApiClient`、zustand、ReactFlow |
| `scene-authoring` | Authoring 层：受限 Scene Script | parse/print/compile/commands/lift；公开 barrel `export *` |
| `batteries-common` | 45 个通用 op（数字/列表/输入/预览/datatree）+ `scene.contract.ts` | 文件式电池，loader 自动注册 |
| `editor-host` | 三个 app 后端共用的电池扫描 + 截图 + project pipeline HTTP | `registerProjectPipelineRoutes` + `handleApplyBatch` |
| `i18n` | 中英 ICU 国际化 | 瞬时切换 locale，无 reload |
| `node-runtime-cli` | `forgeax` CLI 自动化入口 | 把 Layer 2 API 暴露成子命令 |

---

### 1. `@forgeax/node-runtime` — 核心运行时

整个系统的「大脑」，纯 Node.js、无 React、无 HTTP。

- **Layer 1（低层原语）**：图模型（节点/边/分组）、Op 注册表、拓扑排序执行器、DataTree 派发（lacing/fanout）、电池加载器（扫 `meta.json` + chokidar 热重载）、存储（`graph.json` / `history.jsonl` / 输出缓存）、资源/路径解析。
- **Layer 2（编辑 API）**：多项目管理（`ProjectRegistry`）、原子变更 `applyBatch`（唯一写入口，OCC 校验）、执行调度、事件总线、只读查询。

领域逻辑通过 `createExecutionContext({ services })` 钩子注入，内核永不知道 baker / scene 的存在。

入口：`@forgeax/node-runtime`（整包）、`/layer1`、`/layer2`。

---

### 2. `@forgeax/node-runtime-react` — React 画布 UI

浏览器端节点编辑器 UI 层，依赖 `node-runtime` 的 Layer 2 契约。

- `<Editor>` 组件：Toolbar + BatteryBar + ReactFlow 画布；props `apiClient / domainNodeTypes / domainPortTypes / domainValueFormatters`。
- `ApiClient` 接口（`src/api/ApiClient.ts`）：浏览器安全的 Layer 2 契约（applyBatch/execute/queries/subscribe/项目/导入），app 各自实现 `HttpApiClient`。
- Zustand stores：`pipelineStore`（目录+工作图+选择+输出缓存+live-sync）、`historyStore`（undo/redo）、`uiStore`、`projectStore`。
- 画布组件：`BatteryNode`、`GroupNode`、`RelayNode` + 面板节点（Json/Image/Grid/Number/Text/Toggle…）。
- 传输层：`wsAdapter`（bus→编辑器事件）、`apiAdapter`、`mappers`（OpSpec↔Battery、diff→ops）；`editorBridge` 支持同源 iframe 镜像。

---

### 3. `@forgeax/scene-authoring` — Scene Script 语言栈

Authoring 层，不是 baker/renderer。提供受限 Scene Script 的 parse/print、AST 类型、atomic/group contracts、module/project compile、authoring commands、lift/artifact、Agent 工作图类型。

消费方从包根 `export *` 进口；内部按 `language/` `model/` `contracts/` `compile/` `commands/` `diagnostics/` `migrate/` `workflow/` 分目录。

---

### 4. `@forgeax/batteries-common` — 共享通用电池

45 个领域无关的基础 op，三个 app 都能用；每个 op 另有并行 `scene.contract.ts`（依赖 `@forgeax/scene-authoring`）。扫描根是 `batteries/`，每个顶层目录是一个调色板分类。

当前 `common/` 分类：

- `number` — 常量、随机数、基础/高级数学运算
- `list` — 列表操作（取元素、索引、差集、字典查询等）
- `datatree` — DataTree 操作
- `input` — 文本面板、数字常量、Toggle 等输入控件
- `preview` — 注释面板等预览类节点
- `types` — string/number/image/grid/dict/bool 类型节点

每个电池 = `meta.json + index.ts(小写导出函数) + icon.svg`，由 `node-runtime` 的 loader 自动扫描注册。`meta.json` 的 id 保持稳定，保证图迁移后 op 仍能解析。

---

### 5. `@forgeax/editor-host` — 后端共享脚手架

三个 app 后端共用的电池扫描、截图，以及 project-scoped pipeline HTTP：

- `resolveBatteryScanRoots(repoRoot)` — 解析电池扫描根（先 resolve `@forgeax/batteries-common/batteries`，再加 app 自己的 `batteries/`）。
- `getScreenshotService()` — 截图服务。
- `registerProjectPipelineRoutes` — 注册 `GET /api/v1/projects/:projectId/{pipeline,nodes,…}` 与 `POST …/batch`；可选 `handleApplyBatch` 拦截 canonical Scene Script 写回。

依赖 `batteries-common` 与 `node-runtime`，被三个 app 后端共同引用。入口：`@forgeax/editor-host/backend`。

---

### 6. `@forgeax/i18n` — 国际化

ICU MessageFormat 的中英双语层，支持瞬时切换 locale（无需 reload）。

- 被 React 组件、CLI、SKILL.md 工具链共用。
- API：`t()` / `setLocale()` / `registerCatalog()`。

---

### 7. `@forgeax/node-runtime-cli` — `forgeax` CLI

把 Layer 2 编辑 API 暴露成 shell 子命令，供 AI agent 或脚本自动化驱动节点编辑器（「AI 和人类走同一套 API 面」）。

```bash
forgeax pipeline list | jq '.[] | .id'
forgeax node create --pipeline-id xxx --type yyy --params '{...}'
forgeax node update --node-id zzz --params '{...}'
```

输出默认 JSON / NDJSON，方便 pipe 到 `jq` / `xargs`。

---

## 一句话总结

`node-runtime`（图模型+执行+存储，零 React/HTTP）是唯一权威；`node-runtime-react` 是它的浏览器镜像与画布；
`scene-authoring` 是 Scene Script Authoring 层；`editor-host` 是三个 app 共享的后端脚手架（含 project pipeline + `handleApplyBatch`）；
`batteries-common` / `i18n` / `node-runtime-cli` 是卫星。
领域逻辑全在 `apps/*`，经 `createExecutionContext` 注入 services、经文件式 battery 扩展 op。
