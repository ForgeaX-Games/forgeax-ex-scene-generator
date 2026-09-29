# CONTRIBUTING

改动前先读 [`CLAUDE.md`](./CLAUDE.md)（操作契约）和 [`ARCHITECTURE.md`](./ARCHITECTURE.md)
（落点索引）。这份文件只讲**怎么做具体那几类改动**。

## Setup

```bash
bun install --frozen-lockfile                   # 跑根 prepare → build:packages，装完就有 packages/*/dist
bun run build                                   # 内核 + app 两侧

bun run dev                                     # backend :9557 + frontend :9555（watch/HMR）
bun run serve                                   # 跑已 build 的产物

node scripts/hygiene-check.mjs                  # 禁词 + core dump gate
bun run --cwd apps/composition/backend test     # vitest
bun run --cwd apps/composition/frontend test    # vitest
```

单个测试文件 / 单个 case：

```bash
cd apps/composition/backend && bunx vitest run tests/sinoAgentContract.test.ts
cd apps/composition/backend && bunx vitest run tests/sinoAgentContract.test.ts -t 'skill entry'
```

`--filter` 吃 package name，app 两侧叫 `@scene-generator/backend` / `@scene-generator/frontend`；
按目录跑用 `--cwd apps/composition/backend`。动手前先取一次基线（`git stash` 后跑一遍），
改完比同一份清单，别把 HEAD 自带的红当成自己的回归。

## 代码约定

- TypeScript `strict: true`。
- **代码里只写英文**：注释、标识符、commit message。仓内 md 文档中文为主、术语保留英文。
- Conventional Commits。
- 禁词 gate 由 `scripts/hygiene-check.mjs` 定义（上游厂商 / 内网名词）；**没有 pre-commit hook**，
  提交前自己跑 `node scripts/hygiene-check.mjs`（根上没有 `hygiene` script；
  `bun run lint` 会连带跑到它）。
- **禁止过度安全性开发**：本地创作工具，不加输入消毒 / 鉴权 / 限流 / `try-catch` 兜底 /
  防御性 `if`，除非用户点名或不加就崩。类型保证过的不再运行时校验；错误让它抛，
  诊断走 `packages/scene/src/semantics.ts` 那套，不要吞。
- **非必要不写测试**：只在改内核契约 / 诊断码 / 写回路径（`applyBatch`、
  `applySceneSourceEdits`、loader），或修 bug 要留回归，或用户要求时写。
  改文案 / 调布局 / 动文档不写。别用新写的绿测试盖住已有的红。
- **高内聚、低耦合**：单个文件尽量不超过 800 行，一个文件不聚合太多功能；职责变多就拆文件。
- commit 身份：`source ./.git-identity.local.sh` 再提交。该文件 gitignored，每个开发者一份；
  **不要改仓库 `git config`**——本机 `user.email` 是内部公司域名，不能进 commit 元数据。
  新 clone 照着 `CLAUDE.md` §8 自己建一个。
- 不要提交 `.forgeax-runtime/`、`archify/`、`vendor/dist/`、core dump、密钥、或绝对本机路径。

## 加一个场景电池（domain op）

电池是**文件式**的——loader 自动发现，没有注册代码要改。

1. 建目录：
   `apps/composition/batteries/<bigTag>/<smallTag>/<id>/{scene.contract.ts, index.ts}`
   （可选 `icon.svg`）。`<bigTag>` / `<smallTag>` 决定电池栏分组，顺序在
   `packages/node-runtime-react/src/editor/components/sidebar/batteryGrouping.ts`。

2. `scene.contract.ts` 声明契约：

   ```ts
   import { defineAtomic } from '@forgeax/scene-authoring'

   export default defineAtomic({
     functionName: 'myOp',
     contractVersion: '1.0.0',
     opId: 'my_op_id',
     label: 'My Op',
     inputs: [{ name: 'grid', type: 'grid', access: 'item' }],
     outputs: [{ name: 'out', type: 'scene' }],
   })
   ```

3. `index.ts` 导出一个小写入口函数：

   ```ts
   import type { DataTree } from '@forgeax/node-runtime'

   export async function myOpId(input: { grid: DataTree }, ctx: unknown) {
     return { out: result }
   }
   ```

   内核 helper **一律按包名 import**（`@forgeax/node-runtime`），不要深相对路径进 `packages/`。

4. 把 op id 加进 `apps/composition/backend/src/scene-script/firstBatchBatteries.ts`
   （扫描根 + 第一批清单），并在 `hostImplementations.ts` 接上实现，否则 Scene Script run 找不到它。

5. **重启后端**（进程内注册表缓存），确认启动日志 `loaded N ops (0 skipped)`，
   并在 `GET /api/v1/ops` 里看到期望的 `category`。

6. 在 `apps/composition/SKILL.md` 记一条（输入口 / 输出口 / 参数 / 示例）。
   电池**不需要**单独的 JSON schema：AI 看到的 schema 只有 tool 那一层，由
   `scripts/build-standalone-releases.mjs` 从 manifest 投影成 `release/**/schemas/tools/*.json`。

7. 测试放 `apps/composition/backend/tests/` 或
   `apps/composition/batteries/<bigTag>/<id>/__tests__/`；
   跑 `bun run --cwd apps/composition smoke:batteries` 校验目录与第一批清单一致。

新类型的形状**不要长第二套类型**：几何统一在 `Geometry` 上加 `kind`（见 `CLAUDE.md` §4）。

## 加一个 API 路由

1. 在 `apps/composition/backend/src/routes/` 新增或扩展一个文件。
2. 在 `backend/src/main.ts` 注册。
3. 变更一律走内核 `applyBatch`——**不要直接改图状态**，否则丢掉 OCC、`history.jsonl` 和事件。
4. 前端调用必须走 `frontend/src/api/pluginHttp.ts`（`pluginUrl` / `pluginFetch` / `pluginWsUrl`）。

## 加一个 render mode

新建 `apps/composition/frontend/src/renderer/modes/<name>/`，用 `registerRenderPlugin` 自注册，
在 `modes/index.ts` import，并把 id 追加到 `renderer/types.ts` 的 `VIEW_MODE_ORDER`。

## 内核改动

要改编辑器画布、stores、transport、`applyBatch`、battery loader 或任何内核原语，就直接改
仓库根的 `packages/*`，`bun run build`，**内核 + app 落同一个 commit**。没有单独的内核仓，
没有 submodule 指针要 bump。

## 给实体加生命周期状态

给某个东西（组、图层、导出包…）加「保存/未保存」这类状态时：

1. 先写清三要素：**States**（有限、互斥）、**Events**（谁能触发迁移）、**Transitions**
   （哪些迁移合法，非法的怎么拒）。没写清就先别动代码。
2. **一个状态一处权威定义**。类型和判定放在拥有它的那一层（内核实体 → `packages/node-runtime`；
   场景语义 → `packages/scene-authoring`），别在前后端各写一份枚举。
3. **能算的别存**。能从已有字段推出来的状态就做 selector / derive，不要新增持久字段——
   多一个持久字段就多一个会和真值不一致的地方。
4. **需要持久的迁移一律走 `applyBatch`**，白拿 OCC、`history.jsonl`、事件广播和 undo/redo。
   瞬时的 UI 状态留在 zustand（或 `authoring:*` postMessage），不进图。
5. 落地顺序：内核类型与迁移 → `node-runtime-react` 的镜像/展示 → app 适配与 UI，
   **同一批**在 `CHANGELOG.md` 留痕。

## 写回文档

结构变了（新增子系统 / 挪职责 / 改契约或数据流）→ 同批更新 `ARCHITECTURE.md`。
每个动源码的提交在 `CHANGELOG.md` 的 `## Unreleased` 加一条（Added/Changed/Fixed/Removed/Deferred
+ `file:line` + 跑过的测试 + **为什么**）。CHANGELOG **append-only**，纠错靠追加。
只有一份 CHANGELOG（根），历史在 `docs/changelog-archive/`。
