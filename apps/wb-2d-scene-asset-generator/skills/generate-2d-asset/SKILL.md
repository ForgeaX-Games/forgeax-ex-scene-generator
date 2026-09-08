---
name: generate-2d-asset
description: >-
  Generate 2D scene assets in the ForgeaX 2D Scene Asset Generator
  (wb-2d-scene-asset-generator) by OPERATING PREBUILT TEMPLATE BATTERIES
  (composite/group batteries) over the Studio ToolRegistry (asset2d:*). Each
  flow is ONE template group with stable exposed in_N/out_N ports and an
  external Run button per inner image_gen. The agent does NOT hand-wire
  individual batteries anymore: it discovers a template in the library via
  asset2d:templates.list, places it on the canvas itself via
  asset2d:groups.instantiateTemplate (returns the runtime groupId + ports — no
  human drag needed), reads the inner image_gen Run targets via
  asset2d:groups.get, feeds the exposed inputs, triggers each inner image_gen
  via asset2d:generation.generateImage, then asset2d:pipeline.execute and reads
  the exposed outputs. Five templates: asset_generation (物体贴图+碰撞),
  conceptual_scene_design (场景实景图), dechouse_gen (装饰房屋), tile_gen (地形瓦片),
  ui_item_gen (背包/UI 图标). First clarify the request, then operate the template.
trigger: /generate-2d-asset
---

# 生成 2D 资产（模板电池）· 入口与路由

在「2D 场景资产生成器」（wb-2d-scene-asset-generator）里，**每套流程 = 一个模板电池
（组合/成组电池 group）**，它对外暴露稳定的 `in_N`/`out_N` 端口，并为内部每个 `image_gen`
映射出一个外侧 **Run 按钮**。你（AI）**不再手搭单个电池**——而是：**从库里实例化模板组 → 喂暴露入参 →
逐个触发内部 image_gen → 执行 → 读暴露产出**。这与人在画布上「拖入模板 + 连端口 + 点 Run」**走完全相同的
后端路径**，只是人走前端、你走 `asset2d:*` API——**画布是空的你自己用 `groups.instantiateTemplate`
把模板放上去，不必等人拖入**。

> **本文件 = 路由 + 通用操作流程 + 铁律。** 拿到需求先**判断走哪个模板**，再打开对应子文档看该模板的
> 端口与要点；通用操作步骤与防呆看本文件。**无论哪个模板，都先问清需求，再操作。**

---

## 一、选哪个模板（路由表）

| 你要做的 | 模板 | 子文档 |
|---|---|---|
| 单个物件 / 贴图（文生图或图生图，默认同出**物体贴图 + 底部碰撞 mask + 放置几何**） | **asset_generation** | [templates/asset_generation.md](templates/asset_generation.md) |
| 一张**完整游戏场景实景图**（给后续美术对齐像素颗粒度/配色/光照的基准图） | **conceptual_scene_design** | [templates/conceptual_scene_design.md](templates/conceptual_scene_design.md) |
| **指定形状/掩码的整栋装饰房屋贴图**（房顶掩码 → 灰度底图 → 图生图，同出底面碰撞） | **dechouse_gen** | [templates/dechouse_gen.md](templates/dechouse_gen.md) — `in_0` **必须**来自 Scene `building_footprint_mask` → `grid_to_json` |
| **可无缝平铺的地形瓦片 / Autotile atlas**（大块纹理 → 提取 → 合成 atlas） | **tile_gen** | [templates/tile_gen.md](templates/tile_gen.md) |
| **背包物品 / UI 图标**（按 name/label/level/… + 参考图生成纯底像素图标） | **ui_item_gen** | [templates/ui_item_gen.md](templates/ui_item_gen.md) |

> 🎨 **风格地基：成套出资产时，先用 `conceptual_scene_design` 出一张基准参考图，再让其余资产都引用它。**
> 当一次要出**一整套**风格需统一的场景资产（地形 tile + 建筑/装饰 object 等，常由调度/Sino 协作发起）时：**第一步**用 `conceptual_scene_design` 吃透整场景的叙事+背景出一张实景基准图，拿到它的 alias；**随后每个资产都把这张基准图 alias 作参考图喂进对应模板的参考口**（`image_source` 指向该 alias → 连到参考端口），做图生图——这样全套资产的像素颗粒度/配色/光照/透视才统一。各模板参考口：`asset_generation` `in_10`(reference1)、`dechouse_gen` `in_3`(referenced_scene)、`ui_item_gen` `in_7`(reference1)、`tile_gen` `in_1`（**hidden 高级口，需显式连**）；以子文档 / `groups.get` 为准。基准图本身通常不 `publishToGame`，只作风格地基。单出一张资产、无需成套统一时可跳过。

> **端口名（`in_N`/`out_N`）是稳定的**（随模板固化、实例化不变），各端口含义已在对应子文档列明——
> **照子文档掌握「端口含义 + 喂什么」即可，无需逐实例去读对外端口列表**。
> 只有 **`groupId`（连线目标，从 `groups.instantiateTemplate` 的返回值取）与 `runButtons` 里内部
> image_gen 的 `nodeId`（触发用，从 `asset2d:groups.get` 取）是运行时值**，**不要硬编、也不要抄模板
> JSON 里的旧 id**。

---

## 二、模板在哪儿

五个模板电池随插件发布，存放在本仓：
`apps/wb-2d-scene-asset-generator/batteries/templates/pipelines/`

| 目录 | 模板 |
|---|---|
| `(pixel)asset_gen/` | asset_generation |
| `(pixel)conceptual_scene_design/` | conceptual_scene_design |
| `(pixel)dechouse_gen/` | dechouse_gen |
| `(pixel)tile_gen/` | tile_gen |
| `(pixel)UI_item_gen/` | ui_item_gen |

它们在编辑器左侧「**Templates**」栏可见。**你（AI）用 `asset2d:templates.list` 列出库里这些模板、用
`asset2d:groups.instantiateTemplate` 自己把目标模板放上画布**（一步落地一个组合电池节点，返回运行时
`groupId` 与稳定 `in_N`/`out_N` 端口），无需等人拖入。`templateId` 用 `templates.list` 返回的
`id` 或文件 basename。**AI 不凭空造模板**——只实例化库里已有的这五套。

---

## 三、通用操作流程（所有模板共用）

### 0. 开/选项目
`asset2d:projects.list` / `asset2d:projects.open`（没有就 `projects.create`）。

### 1. 把模板放上画布，拿 groupId 与 run 目标

先看画布上是否已有目标模板（用户可能已拖入）：
```json
{ "toolId": "asset2d:groups.list", "args": {}, "caller": { "kind": "ai" } }
```
**没有就自己实例化**（这一步替代「等人拖入」）：先 `asset2d:templates.list` 找到目标模板的 `templateId`，再
```json
{ "toolId": "asset2d:groups.instantiateTemplate",
  "args": { "templateId": "<id 或 basename>", "position": { "x": 0, "y": 0 } },
  "caller": { "kind": "ai" } }
```
返回里拿 **`groupId`（连线目标）** 与稳定的 `exposedInputs`/`exposedOutputs`（应与子文档一致）。
然后用 `asset2d:groups.get({ id: <groupId> })` 取 **`runButtons`**（组内每个 image_gen 一个
`{ nodeId, opId, kind:"image"|"text" }`，即触发目标的真实 nodeId）。
> 端口名照子文档（稳定）；只有 `groupId`（从 instantiate 返回取）、`runButtons.nodeId`（从 `groups.get` 取）是实例运行时值。
> 🧬 **每件资产 = 一套独立实例（不复用、可追溯）**：要出 N 件资产就 `instantiateTemplate` **N 次**，每次返回**全新 `groupId`**，每套配自己的输入常量节点、自己的 run、自己的 `out_N`。**绝不**复用同一个组、只改输入重跑下一件——那会覆盖上一件的提示词/参考图/产出，整批不可追溯、无法定向返工。多套可同时留在画布上（各 `groupId` 独立、互不干扰），只是**逐套串行操作**（一套生完→发布→再做下一套），每次连线用**对应那套**返回的 `groupId`（不是"最新那个"）。

### 2. 喂入参（照子文档的 `in_N` 连线）
打开该模板的子文档，照表把常量电池连到 **`<groupId>.in_N`**（走 `asset2d:pipeline.applyBatch`）：

| 端口类型 | 用什么电池 | 手填字段 | connect 的 source.port |
|---|---|---|---|
| `string` | `text_panel` | `params.text` | **`output`** |
| `number` | `number_const` | `params.value` | **`value`** |
| `boolean` | `toggle` | `params.value` | **`value`** |
| `image`（参考图） | `image_source` | `params.image`/`alias` | **`image`** |

```jsonc
// 例：把场景名喂给 conceptual_scene_design 的 scene_name（子文档标明 = in_5）
{"type":"createNode","nodeId":"p_name","opId":"text_panel","position":{"x":-2800,"y":0},"params":{"text":"林间空地"}}
{"type":"connect","edgeId":"e_name","source":{"nodeId":"p_name","port":"output"},"target":{"nodeId":"<groupId>","port":"in_5"}}
```

- **`position` / `edgeId` 可省略**：`createNode.position` 与 `connect.edgeId` 不填时由内核兜底（position 自动排到不重叠网格、edgeId 自动铸唯一 id）。position 仅画布显示、不影响运行，别为它纠结；只有要稳定引用某条边时才显式给 `edgeId`。
- **下拉端口**（子文档标「下拉」，如 tile_gen 的 `tile`、dechouse_gen 的 `roofType`）：是 `string` 端口，连一个 `text_panel`（`params.text` 填某个合法选项值）即可。
- **参考图端口是可选的**：不接 = **文生图**（合法，image_gen 不会因此被跳过；之前"整组 execute 几毫秒空转"是用错了 execute、不是缺参考图）。要图生图时参考图 `image_source` 通常由用户从 generated asset 面板拖入画布生成；没有就用 `asset2d:assets.list` 找已有 alias 再建。
- **每次 `applyBatch` 后立刻 `asset2d:pipeline.get` 复核** `nodes`/`edges` 真变了（防"ok 却空"）。
- 仅当 `connect` 报某 `in_N` 不存在时，才用 `asset2d:groups.get` 核对当前端口名。

### 3. 先跑一遍管线（**生图前必做**：预热上游缓存）
**喂完参数、触发生图之前，必须先 `execute({})` 跑一遍整图**：
```json
{ "toolId": "asset2d:pipeline.execute", "args": {}, "caller": { "kind": "ai" } }
```
- 这一遍把第 2 步喂进的常量（item_name/width/height…）真正算出来、写进上游输出缓存。`generation.generateImage` 是按**缓存里的已算上游**解析 image_gen 的 `prompt`/`image`/`imageSize` 的；**不先跑这遍，缓存是空的 → 生图会拿到空参数/空参考图**。
- 这遍里 `image_gen` 作为 manualTrigger 被跳过、**不出图**（正常，出图是下一步的事）。

### 4. 触发生图 —— 唯一入口是 `generation.generateImage({ nodeId })`

> **这一步就是"点 Run 按钮"那个动作。** 组内 `image_gen` 是 `manualTrigger` 节点，它**只能**被
> `asset2d:generation.generateImage` 按 `nodeId` 发动——这条工具 = 等价于人在前端点该节点的外侧 Run。
> **`pipeline.execute` 永远不会、也无法触发生图（见下方死路表）。** 别去找什么 `runNode`/`triggerRunButton`，
> 没有别的触发 op，就是这一条。

对第 1 步 `groups.get` 拿到的 `runButtons` 里**每个** image_gen 各调**一次**：
```json
{ "toolId": "asset2d:generation.generateImage", "args": { "nodeId": "<runButton.nodeId>" }, "caller": { "kind": "ai" } }
```
- 传**组内 image_gen 的真实 nodeId**（来自 `runButtons[].nodeId`）。后端会按组内连线**跨组边界**解析该节点的
  `prompt`/`image`/`imageSize`（即第 2 步喂进 `in_N` 的常量），生成后回写到该组的暴露输出缓存——与人点外侧 Run **完全等价**。返回 `{ data: { image, asset } }` 即成功。
- **多个 image_gen 必须串行、严格一个一个来**：**等上一张真正返回成功再触发下一个**。绝不并发/连点——下游 gen 常以上游 gen 的产出作参考图，上一张没生完就点下一张会拿到空输入而失败。
- 顺序：先跑不依赖其它 gen 的那颗，再跑以它为参考的那颗（如 `asset_generation` **先贴图、后碰撞**，详见子文档）。
- 不接参考图就是**文生图**（合法，不会报错）；要图生图再显式带 `images`。

> #### ⛔ 三条死路（别走 —— 这些都**不能**触发生图）
> | 你可能想这么干 | 实际结果 | 为什么 |
> |---|---|---|
> | `pipeline.execute({})` 整图 / `execute({ nodeId: 组 groupId })` | 几毫秒 completed、`out` 的 alias 为空、`ok=false` | `image_gen` 是 manualTrigger 数据边界，**execute 按设计跳过它、不生图**（这不是 bug） |
> | `pipeline.execute({ nodeId: 组内 image_gen })` | `target node not found` | 组把内部节点收编了，顶层 execute **寻址不到组内节点**（按设计） |
> | 自己在顶层另建一个裸 `image_gen` 去 execute | 同样 `{}` 空转 | 还是 manualTrigger 短路；且这是**手搭电池、违反铁律 6** |
>
> 以上"空转/找不到"**都不是缺工具，而是用错了工具**——生图永远走 `generation.generateImage({ nodeId })`。
> （注意区分：`execute({})` **该跑**——第 3 步预热、第 5 步后处理都要它；只是它**永不出图**，别指望用它代替 `generateImage`。）

### 5. 再跑一遍管线（生图**全部完成之后**跑后处理，且**不带组内 nodeId**）
**确认第 4 步每个 image_gen 都已 `generateImage` 成功之后**，**再 `execute({})` 跑第二遍**：
```json
{ "toolId": "asset2d:pipeline.execute", "args": {}, "caller": { "kind": "ai" } }
```
- **`args` 留空 `{}`（整图）**，把折叠组当黑盒驱动：内部后处理（抠图/像素修复/缩放/合成/入库等）跑完，结果汇到暴露 `out_N`。
- **绝不要给 `execute` 传组内节点的 nodeId**（会 `target node not found`）。execute 的职责只有"跑后处理"，不负责生图。
- `image_gen` 是数据边界，execute **不会替你重新生图**；没先做第 4 步就跑这遍 = `out` 全空。

> **整体节奏（务必照此顺序）：** 喂参数 → **`execute({})` 预热** → 逐个 `generateImage({nodeId})` 生图 → **`execute({})` 跑后处理** → 读 `out_N`。**生图前后各跑一遍管线**，缺了前一遍生图拿空参数、缺了后一遍后处理不汇出。

### 6. 读产出 / 入库 / 发布
- 从 execute 摘要或该组 `out_N`（`image`/`collision`/`geometry_json`/`error`）读结果。
- 内部 `image_output` 已按 `item_name`/`name` 入库；`asset2d:assets.list` / `asset2d:assets.get` 查看与核对（尺寸 / 字节 / error / 入库名）。
- **验收门（发布前必过）**：`publishToGame` 前，**先过该模板子文档的「自检 / 验收」小节**（建筑看建筑、物件看物件、瓦片看瓦片、UI 看 UI、概念图看概念图）；不合格**只重出该项**（重跑 `generateImage` → `execute({})`）再发布，**不波及同批其它资产**。
- 需要进游戏沙箱：`asset2d:publishToGame`（object 传 `geometryJson`+`anchorX/Y`；tile 传 `autotileKind`）。

---

## 四、铁律（防呆，随时查）

1. **端口名 `in_N`/`out_N` 稳定、照子文档用**；**`groupId` 从 `groups.instantiateTemplate` 返回（或已在画布上则从 `groups.list`）取、`runButtons.nodeId` 从 `groups.get` 取**——都是运行时值，**绝不硬编、不抄模板 JSON 旧 id**。同模板重复实例化每次返回新 `groupId`，**操作哪套就用哪套自己的 `groupId`**（见铁律 8：逐件独立实例）。
2. **生图唯一入口 = `generation.generateImage({ nodeId })`**（= 点 Run）；**`pipeline.execute` 既不能、也不会触发生图**（manualTrigger 边界被跳过；组内节点顶层寻址不到 → `target node not found`）。**生图前后各跑一遍管线**，顺序固定：**`execute({})` 预热 → 对每个 image_gen 各 `generateImage` 一次（成功）→ `execute({})` 跑后处理**。不先预热则生图拿空参数；用 execute 硬触发或找 `runNode` 都没用。
3. **每个 image_gen 只点一次，且多个 gen 必须串行**：`generateImage` 写入输出缓存且是数据边界，`execute` 不会重触发；重复点 = 重复生成、重复耗额度。**有多个 gen 时一定要等上一张生成成功后再点下一张**——不可并发/连点，否则下游 gen 拿不到上游参考图会失败。
4. **每次 `applyBatch` 后立刻 `pipeline.get`** 确认图真变了（"ok 却空"陷阱）。并发防覆盖：`pipeline.get` 的 `hash` 写入 `opts.expectedPrevHash` 再提交。
5. **只喂未 `hidden` 的暴露端口**；参考图来自用户拖入的 `image_source`，AI 不凭空造图。
6. **优先用 `groups.instantiateTemplate` 落模板**（自动重映射内部 id、稳定端口），**不要**用 `pipeline.applyBatch` 手拼 createNode+connect+createGroup 去展开模板、也不要抄模板 JSON 里的旧 id。**库里查不到目标模板（`templates.list` 没有）才如实上报能力缺口**，不要自己编 op id 或手搭电池绕过模板。
7. **发布前过对应模板的「自检 / 验收」，且定向重生成不波及兄弟**：每项产出按其模板子文档的自检小节逐条核对；不合格**只重出该一项并幂等覆盖同名**（`publishToGame` 同名覆盖），**绝不重跑 / 覆盖同批其它已合格的资产**。发布时 `assetName` **必须等于资产契约里的 `name`**（与 Sino / 渲染器三方一致），别改名、别加前缀。
8. **逐件独立实例、可追溯**：批量出 N 件资产时，**每件各 `instantiateTemplate` 一套独立子图**（独立 `groupId` + 独立输入常量节点 + 独立 `out_N`），**不要复用一个组反复改输入重跑**。每件的输入（name/description/参考图）、run、产出 alias 都留在画布上，事后可逐件查询、定向返工、核对来源；复用同一组改输入 = 上一件状态被覆盖、丢失可追溯性，返工时也分不清是哪件。多套并存于画布无妨（`groupId` 各自独立），仍**逐套串行**生成发布。
9. **不做视觉核验**：**绝不调用 `preview.capture` / `preview.latest` / `screenshot.capture` / `screenshot.latest`**（即便工具列表里还能看到它们）——本环境渲染器截图视觉默认关闭，AI"看不到"返回的图，调它只是白白烧一轮、还容易接着空转。核验**一律靠元数据**：`assets.get`（尺寸 / 字节 / error / 入库名）+ 该组 `out_N`（`image` / `collision` / `geometry_json` / `error`）+ 各模板子文档的「自检 / 验收」条目。像素级肉眼确认是**用户在 Preview 面板**的事，不是 AI 的活。
