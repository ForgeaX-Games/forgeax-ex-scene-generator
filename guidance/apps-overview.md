# 三个 app 统一总览（APPS OVERVIEW）

> **这是什么。** 一张把 `apps/*` 三个 workbench 应用**统一管理**的地图：它们**共享同一套骨架**
> （目录结构、后端/前端形状、与 core 的消费缝完全同构），各自只在**领域层**不同。
> 进任何一个 app 前先读这里建立"这仨长一个样"的坐标系，再翻该 app 自己的 `ARCHITECTURE.md` 看领域细节。
>
> **怎么用。** 先看 §1 同构骨架（哪些必然存在、放在哪），再看 §2 app↔core 消费缝（每个 app 都这么连内核），
> 最后看 §3 三个 app 的领域差异表（只有这里不一样）。**只陈述代码现状**，定位方向自行判断。
> 路径相对本仓根 `packages/marketplace/plugins/node-editor/`。

---

## 1. 同构骨架：三个 app 都长这一个样

三个 app（`wb-3d-lowpoly` / `wb-scene-generator` / `wb-2d-scene-asset-generator`）是**同一个模板**的三份实例。
下表的每一项在三个 app 里**都存在、位置一致、职责一致**——换个 app 也成立，所以属"app 的共性骨架"：

| 顶层项 | 角色 | 说明（三个 app 一致） |
|---|---|---|
| `forgeax-plugin.json` | 插件清单 | `id @forgeax-plugin/<name>`、`kind workbench` |
| `package.json` / `tsconfig.json` | 包定义 | 以 `workspace:*` 引内核包 |
| `backend/` | Fastify 后端进程 | 独立端口、独立 `FORGEAX_PROJECT_ROOT`（见根 [`AGENTS.md`](../AGENTS.md) §4 运行时隔离） |
| `frontend/` | Vite + React 前端 | 挂内核 `<Editor>` + 本 app 的 surfaces |
| `batteries/` | 领域电池 | 文件式 `<bigTag>/<smallTag>/<id>/{meta.json,index.ts}`，由内核 loader 扫描注册 |
| `docs/architecture/` | 子系统文档三件套 | `backend.md` / `frontend.md` / `extension-and-contracts.md` |
| `schemas/` | 电池/op 的 JSON schema | 供 AI 消费 |
| `scripts/` | 工程脚本 | `hygiene-check`、`smoke:*`、`build-vendor` 等 |
| `skills/` + `SKILL.md` | AI 操作指南 | 教 AI **运行期怎么用**这个插件（与开发文档不同，见 §4） |
| `vendor/` | `build:vendor` 产物 | gitignored |
| `AGENTS.md` | app 级协作规则 | 只补充本 app 专属规则，总契约在根 [`AGENTS.md`](../AGENTS.md) |
| `ARCHITECTURE.md` | **app 级架构地图** | 统一七段式（见下），是该 app 的"结构 SSOT" |
| `CHANGELOG.md` | app 级变更日志 | append-only |

### 1.1 `backend/src/` 同构内核

每个 app 后端都有这几件（领域子目录各异，见 §3）：

| 文件/目录 | 职责（三个 app 一致） |
|---|---|
| `main.ts` | 组装 Fastify、注册 route group、监听端口 |
| `runtime.ts` | 装配内核 `Runtime` + `ProjectRegistry`，设 `defaultType` / 项目根 |
| `routes/` | `/api/v1/*` REST 面 + `/ws`（queries / mutations / execute / ws / projects / pipelineImport / groupTemplates …） |
| `tool-handlers.ts` | Studio 工具代理入口 |
| `ops/index.ts` | 通常是空 stub——op 全走文件式 battery，不在这里 |
| `agent/` | 截图服务 + 渲染/视图命令（经 WS 广播） |

### 1.2 `frontend/src/` 同构骨架

| 文件/目录 | 职责（三个 app 一致） |
|---|---|
| `main.tsx` / `App.tsx` | 入口 + pane 路由（center / left / 各 surface） |
| `workbench/` | `WorkbenchHost`：挂 `<Editor>` + 嵌入 iframe；`protocol.ts` 跨 iframe postMessage 协议 |
| `api/` | `HttpApiClient.ts`：实现内核 `ApiClient` 契约 |
| `surfaces/` | 本 app 的嵌入式视图（renderer / assetstore / preview 等，领域相关） |
| `__tests__/` | 前端单测 |

### 1.3 app 级 `ARCHITECTURE.md` 的统一七段式

三个 app 的架构地图**结构一致**，照这七段读/写：

1. **App shape** — 该 app 的目录树 + 端口 + 电池量级。
2. **Subsystem docs** — 指向 `docs/architecture/{backend,frontend,extension-and-contracts}.md`。
3. **Data flow** — Boot / Battery / Change / Execute / 领域链路。
4. **App ↔ kernel seam** — 经 `<Editor>` props（`domainPortTypes` / `domainValueFormatters` / `domainNodeTypes` / 自定义 panel）注入领域扩展。
5. **Extension points** — 加电池 / 加 route / 加领域类型 / 加 surface。
6. **"改 X 看哪？" 反向索引** — 该 app 的功能 → 文件落点。
7. **SSOT in one paragraph** — 重申 editor/runtime 不在 app 内 fork，是 `packages/*` 内核。

> **写新功能要更新哪段**：改了 route/surface/battery/契约 → 同一次提交更新对应 app 的
> `ARCHITECTURE.md`（§1/§3/§6）+ `docs/architecture/*` + `CHANGELOG.md`（见根 [`GUIDANCE.md`](./GUIDANCE.md) §4）。

---

## 2. app ↔ core 的消费缝（三个 app 都这么连内核）

三个 app **都不 fork 内核**——editor / runtime / 画布 / 存储全部来自 `packages/*`，经 `workspace:*` 引**源码**消费。
每个 app 与 core 的连接点完全一致：

| 连接维度 | app 侧 | core 侧（被消费） |
|---|---|---|
| **后端运行时** | `backend/src/runtime.ts` 调 `createRuntime(...)` | `node-runtime`（`layer2/runtime.ts`） |
| **电池扫描根** | 后端启动取 `resolveBatteryScanRoots(repoRoot)` | `editor-host`（返回 `batteries-common/batteries` + 本 app `batteries/`） |
| **通用电池** | 自动注册，无需 app 代码 | `batteries-common`（datatree/input/list/number/preview） |
| **唯一写入口** | 后端 `POST /api/v1/projects/:projectId/batch` → `applyBatch`（`queries.ts` 调 `registerProjectPipelineRoutes`；`mutations.ts` 为空 stub） | `node-runtime`（`layer2/apply-batch.ts`） |
| **前端画布** | `frontend` 挂 `<Editor>` | `node-runtime-react`（`Editor.tsx` + stores + transport） |
| **ApiClient 契约** | `api/HttpApiClient.ts` 实现它 | `node-runtime-react`（`api/ApiClient.ts`，浏览器侧 layer2 契约） |
| **领域扩展注入** | `WorkbenchHost` 传 `<Editor>` 的 domain props | `node-runtime-react`（`<Editor>` 接受 `domainPortTypes` 等） |
| **领域 services** | `createRuntime({ createExecutionContext })` 注入 | `node-runtime`（op 经 `ctx.services` 取用，内核不知其形） |
| **i18n** | 前端引 `@forgeax/i18n` | `i18n` |

**这条缝的铁律**（呼应 [`GUIDANCE.md`](./GUIDANCE.md) §1）：

- 需要改"画布怎么连线 / 图怎么执行 / group 怎么折叠保存 / applyBatch 行为"——这些**域无关**，改 `packages/*` 源码 + `bun run build`，三个 app 同时生效。
- **禁止**在 app 内 fork/patch 一份内核逻辑绕过它。
- 改内核可能同时影响多个 app——逐个评估、逐个跑冒烟（见 [`GUIDANCE.md`](./GUIDANCE.md) §6）。
- core 的完整内部结构见根 [`ARCHITECTURE.md`](../ARCHITECTURE.md) 与 [`packages_framework.md`](./packages_framework.md)。

---

## 3. 领域差异：只有这里三个 app 不一样

骨架（§1）和消费缝（§2）三个 app 全一致；**差异只在领域层**。要做领域改动，先在此定位是哪个 app，再读它的 `ARCHITECTURE.md`：

| 维度 | `wb-3d-lowpoly` | `wb-scene-generator` | `wb-2d-scene-asset-generator` |
|---|---|---|---|
| 领域 | 3D 几何 / 参数化 low-poly | 场景生成 / 素材库 | 2D 场景资产生成 |
| 后端独有目录 | `services/`（baker） | `baked/` + `library/`（SQLite 素材库） | `ai/` + `assets/` + `baked/` + `library/` |
| 前端独有 | `surfaces/viewer3d`（3D 查看器：静态/URDF/角色三管线） | `renderer/`（四模式）+ `panels/` + AssetStore | `renderer/` + `panels/` + 预览/生成图 surface |
| 顶层独有 | — | `assets/` + `materials/` | `assets/` + `materials/` + `pipelines/` |
| 电池量级 | 数十级 | 数百级 | 数十级 |
| 领域 port 类型 | 几何相关 | `scene`（`#fb923c`） | asset2d 相关 |
| app 地图 | [`apps/wb-3d-lowpoly/ARCHITECTURE.md`](../apps/wb-3d-lowpoly/ARCHITECTURE.md) | [`apps/wb-scene-generator/ARCHITECTURE.md`](../apps/wb-scene-generator/ARCHITECTURE.md) | [`apps/wb-2d-scene-asset-generator/ARCHITECTURE.md`](../apps/wb-2d-scene-asset-generator/ARCHITECTURE.md) |
| 接线三件套 | （随 app 演进补充） | （随 app 演进补充） | 已抽到本目录：[`wb-2d-wiring-index.md`](./wb-2d-wiring-index.md) / [`wb-2d-frontend-map.md`](./wb-2d-frontend-map.md) / [`wb-2d-backend-map.md`](./wb-2d-backend-map.md)；领域电池/管线见 [`wb-2d-battery-map.md`](./wb-2d-battery-map.md) |

> 端口、route 数量、电池精确数会随代码漂移——以各 app `backend/src/main.ts` 与其 `ARCHITECTURE.md` 的 App shape 段为准，不在本文件写死。

---

## 4. SKILL.md 不是开发文档

每个 app 根有 `SKILL.md` + `skills/`，它是**给 AI 运行期操作该插件**的指南（有哪些工具、怎么编排 pipeline），
**不是**给开发者改代码用的架构地图。改代码看 `ARCHITECTURE.md` 与本 `guidance/`；操作插件看 `SKILL.md`。两者别混。

---

> 一句话：**三个 app 是同一模板的三份实例——骨架同构、消费 core 的缝同构，差异只在领域层。**
> 改领域 → 进对应 app；改"换个 app 也成立"的能力 → 进 core。
