# 协作铁律（GUIDANCE）— node-editor 仓库级

> 本文件是 **node-editor monorepo 的协作总入口**，是**强约束**而非建议。下列每一条都是 MUST。
> 违反任意一条 = 本次任务不合格，必须停下、说明、纠正后重来。
> 与本文件冲突时，以**用户当前对话中的显式指令**为最高优先级；其次本文件；最后默认行为。
>
> 本仓由 **1 个 core（`packages/*` 七包：Runtime 层领域无关，`scene-authoring` 为 Authoring 层）+ 3 个 app（`apps/*`，领域逻辑）** 组成。
> 这份 guidance 同时指导 core 与三个 app 的开发——动手前**第一件事是判定落点**（见 §1 路由）。

---

## 0. 仓库形状（先建立坐标系）

```
node-editor/
├── packages/                 ← core（内核）：领域无关，workspace:* 引源码，一次 bun run build 全生效
│   ├── node-runtime          ← THE core：图模型/执行/存储/事件总线（零 React 零 HTTP，唯一权威）
│   ├── node-runtime-react    ← React 画布/状态/传输：<Editor>、ApiClient 契约、zustand、ReactFlow
│   ├── scene-authoring       ← Authoring 层：受限 Scene Script parse/print/compile/commands/lift
│   ├── editor-host           ← 后端脚手架：电池扫描 + 截图 + project pipeline HTTP + handleApplyBatch
│   ├── batteries-common      ← 共享通用电池 op（45 个）+ 并行 scene.contract.ts
│   ├── i18n                  ← ICU zh/en 瞬时切换
│   └── node-runtime-cli      ← forgeax CLI：把 layer2 编辑 API 暴露成子命令（AI/headless）
└── apps/                     ← 领域应用：各自独立后端进程，仅通过文件通信
    ├── wb-3d-lowpoly             ← 3D 几何 / OCCT/replicad baker / URDF 查看器 / 3d 电池
    ├── wb-scene-generator        ← 场景 renderer 四模式 / SQLite 素材库 / scene 电池
    └── wb-2d-scene-asset-generator ← 2D 场景资产生成 / 预览 surface / asset2d 电池
```

> core 与 app 的完整结构、依赖图、数据流见根 [`ARCHITECTURE.md`](../ARCHITECTURE.md) 与
> [`packages_framework.md`](./packages_framework.md)。三个 app **同构**（共享骨架 + 消费 core 的缝完全一致）——
> 见 [`apps-overview.md`](./apps-overview.md)。本 guidance **不重复**它们，只负责
> **路由（去哪改）+ 铁律（怎么改）+ 设计指引（状态怎么建模）**。

---

## 1. 先定落点：core 还是哪个 app（动手前的第一判断）

任何改动，**先回答"这落在 core 还是某个 app"**，再读对应的架构地图。完整判定见
[`routing-map.md`](./routing-map.md)；速记规则：

| 改动触及… | 落点 | 先读 |
|---|---|---|
| 图模型 / 执行 / lacing / DataTree / `applyBatch` / 存储 / 事件总线 | **core** `node-runtime` | 根 [`ARCHITECTURE.md`](../ARCHITECTURE.md) |
| 画布交互 / 节点渲染（含 Group/Relay 节点）/ stores / 传输 / `<Editor>` / `ApiClient` 契约 | **core** `node-runtime-react` | 根 [`ARCHITECTURE.md`](../ARCHITECTURE.md) |
| 电池扫描根 / 截图服务 / project pipeline HTTP（三个 app 共用脚手架） | **core** `editor-host` | [`packages_framework.md`](./packages_framework.md) |
| Scene Script parse/print/compile/commands | **core** `scene-authoring` | 根 [`ARCHITECTURE.md`](../ARCHITECTURE.md) |
| 通用 op（数字/列表/datatree/输入/预览，跨 app 复用） | **core** `batteries-common` | [`packages_framework.md`](./packages_framework.md) |
| 3D 几何 / baker / URDF 查看器 / 3d 电池 | **app** `wb-3d-lowpoly` | [`apps/wb-3d-lowpoly/ARCHITECTURE.md`](../apps/wb-3d-lowpoly/ARCHITECTURE.md) |
| 场景 renderer / 素材库 / scene 电池 | **app** `wb-scene-generator` | [`apps/wb-scene-generator/ARCHITECTURE.md`](../apps/wb-scene-generator/ARCHITECTURE.md) |
| 2D 场景资产 / 预览 surface / asset2d 电池 | **app** `wb-2d-scene-asset-generator` | [`apps/wb-2d-scene-asset-generator/ARCHITECTURE.md`](../apps/wb-2d-scene-asset-generator/ARCHITECTURE.md)；接线三件套见本目录 [`wb-2d-wiring-index.md`](./wb-2d-wiring-index.md) / [`wb-2d-frontend-map.md`](./wb-2d-frontend-map.md) / [`wb-2d-backend-map.md`](./wb-2d-backend-map.md)；领域电池/AI 生成见 [`wb-2d-battery-map.md`](./wb-2d-battery-map.md) |

**判定要点：**

- **域无关 → core，域相关 → app。** 凡是"换个 app 也成立"的能力（画布怎么连线、图怎么执行、
  group 怎么折叠保存）都属 core；凡是"只在这个领域成立"的（怎么 bake 几何、怎么渲染场景、
  素材库长什么样）才属 app。
- **app 不许打本地补丁绕过 core。** 需要改画布/runtime 行为时，改 `packages/*` 源码 +
  `bun run build`，**禁止**在 app 内 fork/patch 一份内核逻辑。
- **跨界改动一次原子落地。** 改 core 类型/契约导致 app 需适配时，**同一次提交**里改 core +
  受影响 app（允许且推荐）。core 改动可能同时影响多个 app——逐个评估，别只改你眼前那个。
- **不确定该不该进 core，先问。** "是否该共享"判断不清时，**停下向用户确认**再动 `packages/*`。

---

## 2. 先分析、后动手（禁止"上来就写代码"）

写任何代码前，**必须**先产出一段简短计划，且明确：

- **落点**：依 §1 判定改 core 还是哪个 app，定位到具体文件（用对应 ARCHITECTURE 的"改 X 看哪？"反向索引）。
- **范围**：要改哪些文件 / 模块，以及**明确不改**哪些。
- **契约**：涉及哪些可校验 schema（`OpSpec` / `GraphFileV1` / `ApiClient` / `RuntimeEvent`）。
  新增"状态/生命周期"类字段时，先读 [`state-machine.md`](./state-machine.md)。
- **副作用**：对其它 core 包、对每个受影响 app、对运行时/数据/测试的影响。

**禁止**在没有上述计划的情况下直接编辑源码。范围越模糊，越要先向用户确认，**不要靠猜**。

---

## 3. 严守改动范围（禁止自行扩大）

- **只做**用户明确要求的改动。用户没提到的，**一律不动**。
- 判断"有必要顺手改"——**停下，先确认，同意后再改**。禁止自行扩大范围、顺手重构、改无关格式。
- 跨 core/app 边界、或牵动多个 app 的改动，**必须**先确认影响面再动手。

---

## 4. 进场先读、收场必写（CHANGELOG 留痕）

- **进场**：先读根 [`AGENTS.md`](../AGENTS.md) 与落点对应的 `CHANGELOG.md`，建立上下文。
- **收场**：每次改源码后，**必须**在对应 `CHANGELOG.md` 的 `## Unreleased` 追加条目：
  - core 改动（`packages/*`）→ 根 [`CHANGELOG.md`](../CHANGELOG.md)。
  - app 改动（`apps/<name>/*`）→ 该 app 的 `CHANGELOG.md`。
  - 一条提交同时动 core + app → **两处都加**。
- 条目按 **Added / Changed / Fixed / Removed / Deferred** 分组，引用 `file:line` + 相关测试，写清 *why*。
- CHANGELOG 是 **append-only**：只增不改史，纠错追加一条说明原因，**禁止回改旧条目**；保持干净简洁。
- 若改动**改变了结构**（新增/挪动/删除 route、renderer mode、panel、battery、契约、数据流），
  **同一次提交**里同步更新对应的 `ARCHITECTURE.md` / `docs/architecture/*` / guidance（地图与代码不同步 = 违规）。

---

## 5. 改完即提交，但禁止 push

- 每次改动完成、**自检无误后**，commit 到 `node-editor` 仓；commit 信息说清 *改了什么 / 为什么*。
- 自检"无误"**不靠感觉**：按落点对应的 *Quick verify* 跑过相关项、**有证据**才算无误（见 §6）。
- **绝对禁止 `git push`**（含 `--force` 等任何远端推送）。

---

## 6. Quick verify（按落点选命令）

```bash
# 改了 core（packages/*）→ 先全仓构建 + 内核单测：
bun install && bun run build
bun run --filter @forgeax/node-runtime test

# 改了某个 app → 进该 app 目录跑卫生 + 测试 + 冒烟（命令以各 app package.json scripts 为准）：
cd apps/<app>
bun run hygiene                  # 品牌词/结构卫生
bun run --filter backend test    # 后端单测
bun run --filter frontend test   # 前端单测
bun run smoke:*                  # 该 app 的端到端冒烟（见其 AGENTS.md / package.json）
```

> 改 core 必先 `bun run build`，否则 app 引的是旧源码产物。core 改动要对**每个受影响 app**
> 至少跑一遍其冒烟，确认没有单边破坏。

---

## 7. 三条架构原则（呼应根 AGENTS.md §6）

- **SSOT**：每个事实一处权威。**架构地图**是"结构"的权威、**代码**是"行为"的权威——改一处必同步另一处。
  同一概念**只定义一份契约**（如 `NodeGroup` 的状态字段定义在 core 权威类型里，app/前端共享同一份，
  详见 [`state-machine.md`](./state-machine.md)）。
- **Schema as Contract**：跨层交换用可校验 schema（`OpSpec` / `GraphFileV1` / `ApiClient` / `RuntimeEvent`），不用散文。
- **Append-Only Auditability**：CHANGELOG / `history.jsonl` 只增不改，纠错追加不回改。

---

> 总则：**先定落点（core 还是哪个 app）；不确定就停下问，不要靠猜；范围之外不要动；每次留痕、可验证、可回溯。**
