# 状态机设计指引（STATE MACHINE）— 给实体建模生命周期状态

> **这是什么。** 一份在 node-editor 仓里**给实体添加"生命周期状态"**（如 saved / unsaved /
> dirty、draft / published、locked / unlocked）的通用设计指引。它教**怎么把状态建得干净、单一、
> 可演进**——一份契约、一处权威、跨 core 与三个 app 共享。
>
> **何时读它。** 当你的改动要给某个实体引入"它现在处于什么状态、什么操作让它迁移到下一个状态"
> 这类语义时（[`GUIDANCE.md`](./GUIDANCE.md) §2 计划阶段已提示）。
> 落点判定见 [`routing-map.md`](./routing-map.md)；本文件聚焦**状态本身怎么设计**。
>
> 全文以**组合电池（group battery）的 saved / unsaved / unsaved\* 状态**为贯穿范例
> （这是一个尚未实现、用于演示方法的设计样例）。

---

## 1. 单一契约（One Contract）

**一个状态，只有一处权威定义。**

状态字段定义在**它所描述实体的权威类型**上。对图内实体（节点、边、分组），权威类型在
core 的 `node-runtime`：

- `NodeGroup` / `GraphNode` / `GraphEdge` → `packages/node-runtime/src/layer1/types/graph.ts`
- 落盘契约 `GraphFileV1` → `packages/node-runtime/src/layer1/storage/types.ts`

前端（`node-runtime-react`）与各 app 的后端**消费这一份定义**，不另立同名字段。需要前端专属的
派生视图（如 UI 高亮 class）时，从权威状态**计算**出来，而非**复制存储**一份。

> 心法：**状态是数据，数据有唯一 owner。** owner 是"这个状态最本质属于谁"——group 的"是否已存为
> 电池"本质属于 group 这个图实体，所以归 core 的 `NodeGroup`，而不是某个 app 的某个 store。

---

## 2. 状态机三要素：States · Events · Transitions

设计任何生命周期状态，先把三件事列清楚，再写代码：

1. **States（有哪些状态）** —— 有限、互斥、可枚举。
2. **Events（什么触发迁移）** —— 用户/系统动作。
3. **Transitions（谁 → 谁，由哪个 Event 驱动）** —— 一张迁移表，覆盖所有合法跳转；表外即非法。

### 范例：group battery 的 saved / unsaved / unsaved\*

**States：**

| 状态 | 含义 |
|---|---|
| `unsaved` | 画布上新建的 group，从未存为电池 |
| `saved` | 已存入电池库、且内容与库中一致 |
| `dirty`（UI 标 `unsaved*`） | 源自某个已存电池，但 group 的签名（端口集合/顺序/命名）被改过，与库不一致 |

**Events：**

| 事件 | 现有触发点（真实落点） |
|---|---|
| `create` | 画布上把多节点折叠成 group |
| `save` | `GroupNode` 头部保存按钮 → `GroupSaveDialog` → `ApiClient.saveGroupTemplate` |
| `instantiate` | 从电池栏拖出已存 group 电池到画布 |
| `editSignature` | 端口增删/重排序/重命名 → `pipelineStore` 的 `updateGroupPort`(`:597`) / `moveGroupPort`(`:632`) / `renameGroup`(`:565`) |
| `saveDirty` | 对 `dirty` 直接保存回原电池 |

**Transitions（迁移表）：**

| 当前 | 事件 | 下一个 | 备注 |
|---|---|---|---|
| —      | `create`        | `unsaved` | 新建即 unsaved |
| `unsaved` | `save`       | `saved`   | 写入电池库，记录来源电池 id |
| —      | `instantiate`   | `saved`   | 拖出即与库一致 |
| `saved` | `editSignature`| `dirty`   | 签名偏离库 |
| `dirty` | `saveDirty`    | `saved`   | 覆盖回原电池 |
| `dirty` | `save`（另存）  | `saved`   | 存为新电池，来源 id 改为新 |

> **画迁移表的价值**：它逼你回答"`unsaved` 被 `editSignature` 会怎样？"这类边角问题
> （答案：仍是 `unsaved`，因为还没有"原电池"可偏离——表里没这行即表示"无迁移/保持原状"）。

---

## 3. 状态住在哪一层（持久 vs 瞬时）

状态字段加在权威类型前，先判断它**要不要落盘**：

| 性质 | 放哪 | 范例 |
|---|---|---|
| **需跨会话保留 / 影响导出导入 / 多端一致** | core 权威类型 + `GraphFileV1`，经 `applyBatch` 落盘 | group 的"来源电池 id"、"已保存签名快照"——刷新后仍要知道它 saved 与否 |
| **纯 UI 派生、可随时重算** | 前端 store 计算，不落盘 | `dirty` 红点高亮：由"当前签名 vs 已存签名快照"实时 diff 得出，**不必存**一个 `dirty` 布尔 |

范例落点：

- **持久部分**（`sourceBatteryId` + `savedSignature`）→ 加到 core `NodeGroup`(`graph.ts`) +
  `GraphFileV1`，变更经唯一写入口 `applyBatch`(`packages/node-runtime/src/layer2/apply-batch.ts`) 落盘。
- **瞬时部分**（`saved` / `dirty` 的呈现）→ 前端从 `NodeGroup.savedSignature` 与当前
  `exposedInputs/exposedOutputs` 计算，渲染在 `GroupNode`(`packages/node-runtime-react/src/editor/components/canvas/GroupNode.tsx`)。

> 多存一个布尔状态 = 多一个会和真相不同步的副本。**能算就别存**，只存"算不出来的事实"
> （来源 id、那一刻的签名快照）。

---

## 4. 迁移由唯一入口驱动（不旁路）

状态迁移必须走既有的**唯一写入口**，不在组件里直接改图：

- 图实体的任何持久状态变更 → `applyBatch`（前端经 `POST /api/v1/projects/:projectId/batch` → kernel `applyBatch`）。
- 这保证：OCC 校验、深拷校验、`history.jsonl` 留痕、`graph:applied` 事件扇出**一次性全做到**，
  撤销重做天然生效。
- **禁止**为新状态另开一条绕过 `applyBatch` 的旁路写盘——那会让状态脱离历史与事件体系。

范例：`saveDirty` 覆盖原电池，要拆成两步且各归其位——
①写电池库文件（app 后端的 group 保存端点，如 `backend/src/routes/groupTemplates.ts`）；
②把 group 的 `savedSignature` 更新为当前签名（经 `applyBatch`，使状态回到 `saved`）。两步都成功才算迁移完成。

---

## 5. 跨界落地顺序（core → 前端 → 各 app）

给图实体加状态属 **core 改动**，按此顺序原子落地（呼应 [`routing-map.md`](./routing-map.md) §4）：

1. **core 权威类型**：`NodeGroup`(`graph.ts`) + `GraphFileV1`(`storage/types.ts`) 加字段（可选字段保证旧图向后兼容）。
2. **core 前端镜像**：`node-runtime-react` 的对应类型、`pipelineStore` 的 group actions
   （`renameGroup`/`updateGroupPort`/`moveGroupPort`）在迁移点更新签名、`GroupNode` 渲染状态。
3. **core 契约**（若需新端点）：`ApiClient.ts` 加方法签名。
4. **各 app 适配**：实现/调整 app 后端对应 route（如各 app 的 `groupTemplates.ts`）；
   `bun run build` 后逐个 app 验证（group 是 core 能力，**三个 app 都受影响**）。
5. **同一次提交**留痕：core 改动记根 CHANGELOG，受影响 app 记各自 CHANGELOG，并同步对应 ARCHITECTURE/guidance。

---

## 6. 设计自检清单

落地状态前，逐条确认：

- [ ] States 有限、互斥、可枚举？
- [ ] Events 与现有真实触发点对得上（有 `file:line`）？
- [ ] Transitions 表覆盖所有合法跳转，表外即非法？
- [ ] 每个状态字段只有**一处权威定义**，其余层消费同一份？
- [ ] 能从已有数据**算出来**的状态没有被**额外存储**？
- [ ] 持久状态的迁移全部经 `applyBatch`（含历史/事件/撤销）？
- [ ] core 改动评估了**对每个 app 的影响**，并在同一提交内适配 + 留痕？
