# 路由地图（ROUTING MAP）— 我要做 X，该落在 core 还是哪个 app

> **这是什么。** 把"我要改/加 X"映射到**唯一落点**（core 的某包 / 某个 app）的判定地图。
> 它回答 [`GUIDANCE.md`](./GUIDANCE.md) §1 留下的问题："动手前的第一判断——去哪改"。
> **只陈述代码现状与落点归属**，不替你判断 bug。路径相对本仓根 `node-editor/`。

---

## 1. 一句话心法

> **域无关 → core（`packages/*`）；域相关 → app（`apps/*`）。**

凡是"换个 app 也成立"的能力属 core；凡是"只在这个领域成立"的属 app。

| | core（领域无关） | app（领域相关） |
|---|---|---|
| 例 | 画布怎么连线、图怎么执行、group 怎么折叠/保存、撤销重做、电池怎么被扫到 | 怎么 bake 几何、怎么渲染场景、素材库长什么样、有哪些领域电池 |
| 改哪 | `packages/*` 源码，一次 `bun run build` 全 app 生效 | 该 app 的 `backend/` `frontend/` `batteries/` |
| 风险 | 一处改动**影响全部 app**——逐个验证 | 隔离在单 app，不外溢 |

---

## 2. 决策树（从上往下，命中即停）

```
我要改的东西……
│
├─ 涉及 图模型 / 节点 / 边 / 分组(NodeGroup) 的数据结构？
│     → core: packages/node-runtime/src/layer1/types/graph.ts
│
├─ 涉及 执行 / 拓扑排序 / lacing / DataTree 派发？
│     → core: packages/node-runtime/src/layer1/{executor,dispatcher}.ts
│
├─ 涉及 原子变更 / 撤销重做 / 历史 / 落盘 graph.json？
│     → core: packages/node-runtime/src/layer2/apply-batch.ts + layer1/storage/
│
├─ 涉及 多项目 / 工作区 / per-agent 锁？
│     → core: packages/node-runtime/src/layer2/project-registry.ts
│
├─ 涉及 画布交互 / 节点渲染 / Group·Relay·面板节点 / stores / 传输 / <Editor> / ApiClient 契约？
│     → core: packages/node-runtime-react/src/{editor,api}/
│
├─ 涉及 电池扫描根 / 截图服务（三个 app 共用脚手架）？
│     → core: packages/editor-host/src/backend/
│
├─ 涉及 通用 op（数字/列表/datatree/输入/预览，跨 app 复用）？
│     → core: packages/batteries-common/batteries/
│
├─ 涉及 i18n 文案 / locale 切换？
│     → core: packages/i18n/
│
├─ 涉及 forgeax CLI 子命令 / headless 自动化入口？
│     → core: packages/node-runtime-cli/
│
└─ 都不是 → 它是某个领域的逻辑 → 进 §3 判定哪个 app
```

---

## 3. 进入 app：按领域分流

落点确定为 app 后，按**领域**选 app，再读该 app 自己的架构地图下钻：

| 领域信号 | app | 下钻入口 |
|---|---|---|
| 3D 几何、参数化 low-poly、OCCT/replicad **baker**、URDF/3D 查看器、几何电池 | `wb-3d-lowpoly` | [`apps/wb-3d-lowpoly/ARCHITECTURE.md`](../apps/wb-3d-lowpoly/ARCHITECTURE.md) → "改 X 看哪？"反向索引 |
| 场景 **renderer**（top/iso/free3d 等模式）、SQLite **素材库**、scene 电池、AssetStore surface | `wb-scene-generator` | [`apps/wb-scene-generator/ARCHITECTURE.md`](../apps/wb-scene-generator/ARCHITECTURE.md) → "改 X 看哪？"反向索引 |
| 2D 场景资产生成、预览/生成图 surface、asset2d 电池、scene 端口扩展 | `wb-2d-scene-asset-generator` | 本目录三件套 [`wb-2d-wiring-index.md`](./wb-2d-wiring-index.md) / [`wb-2d-frontend-map.md`](./wb-2d-frontend-map.md) / [`wb-2d-backend-map.md`](./wb-2d-backend-map.md) → [`apps/wb-2d-scene-asset-generator/ARCHITECTURE.md`](../apps/wb-2d-scene-asset-generator/ARCHITECTURE.md) |

> **app 内三层导航**（以 wb-2d 为例，最完整；三件套已集中在本 `guidance/` 目录）：
> [`wb-2d-wiring-index.md`](./wb-2d-wiring-index.md)（三条数据通道 + 关键链路）→
> [`wb-2d-frontend-map.md`](./wb-2d-frontend-map.md)（前端区域 → 后端落点）/ [`wb-2d-backend-map.md`](./wb-2d-backend-map.md)（REST/WS/契约归类）→
> 该 app `ARCHITECTURE.md`（文件树 + 反向索引）。
> 另两个 app 暂只有 `ARCHITECTURE.md` + `docs/architecture/`，下钻路径相同、粒度略粗。

---

## 4. 跨界改动：core 类型变更牵动 app

最易出错的一类：**改了 core 的契约，app 必须跟着适配**。处理顺序：

1. **先改 core 权威类型**（如 `node-runtime` 的 `graph.ts`、`node-runtime-react` 的 `ApiClient.ts`）。
2. **`bun run build`**，让所有 app 引到新源码。
3. **逐个评估受影响 app**：编译报错处即适配点；core 改动可能同时命中多个 app，别只改眼前那个。
4. **同一次提交**里落地 core + 受影响 app，并在**两处 CHANGELOG** 留痕。

典型跨界场景：

| 你在 core 改了… | 可能波及 |
|---|---|
| `graph.ts` 的 `NodeGroup` / `GraphNode` 字段 | 三个 app 的图导入导出、各自的 group 处理、落盘格式 |
| `ApiClient.ts` 接口（新增方法/字段） | 每个 app 的 `HttpApiClient` 实现 + 对应后端 route |
| `editor-host` 的电池扫描根逻辑 | 两个消费它的 app 的 battery 加载 |
| `RuntimeEvent` 事件联合（新事件/频道） | 各 app 后端 `ws.ts` 扇出 + 前端订阅 |

> 涉及"给 core 类型加状态/生命周期字段"（如 group 的 saved/unsaved），先读
> [`state-machine.md`](./state-machine.md)——它给出**单一契约**的字段定义与迁移方式。

---

## 5. 拿不准时

- **判断不了域无关还是域相关** → 倾向 core 的可能性高（画布/图/执行/group 几乎都是 core），
  但**不确定就停下向用户确认**，不要自行决定往 `packages/*` 写。
- **同一能力三个 app 都要** → 几乎可以确定该进 core（`batteries-common` 或 `node-runtime*`）。
- **只有一个 app 要、且强领域相关** → 留在该 app，别污染 core。
