# AddBaseGrid（基础网格区域）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1781266146700_dm7xl`，也可用 basename `AddBaseGrid`。
> 内部 6 个节点（grid2node + rect_grid + add_child + scene_focus_path + scene_passthrough + type_string）、1 个嵌套子组（TileAssetName）。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

**场景构图的第一块积木 / 起点。** 在一个空场景（或已有上游场景）之上，添加一个**基础网格区域**：一片带尺寸、可挂底图资产的网格节点，作为整张场景的**尺寸约束与底图**。它把 `rect_grid` 生成的网格转成场景节点、挂到上游根场景下、可选地打上底图资产（tile），最后把 focus **聚焦到刚加的这个基础网格节点**，让后续所有操作都从这个节点出发。

它产出三类东西：

- **BaseNode**（`out_1`）——focus 已聚焦到刚加的基础网格节点；**★ 这是后续所有模板组的出发点**：后续组的 `in_0` 接它，而不再用空的根节点。
- **RootScene**（`out_2`）——整棵根场景透传；用于**多区域拼接**（多个 AddBaseGrid 各产一个 BaseNode）与**最终汇总**。
- **BaseNodePath**（`out_3`）——基础网格节点的路径句柄。

**典型位置：管线最起点**（紧接 `empty_scene` 之后）。它取代了过去"手搓 `rect_grid` + `grid2node` 铺初始草地"的旧起手式——基础网格的尺寸/底图/挂接/聚焦都封装在这一个模板组里。

## 输入端口（IN）

可见（非 hidden）端口（"怎么喂"= 用哪个上游电池经 `node connect` / `connect` op 接上；portType 决定喂进去的数据格式）：

| portName | portType | 语义 | 是否必接 | 怎么喂（来源电池 → 本端口） | 数据格式（DataTree.items） |
|---|---|---|---|---|---|
| `in_0` | scene | **RootScene** 挂接起点（接上游场景） | **必接** | 第一块基础网格：`empty_scene.scene` → `in_0`；多区域拼接：上一块 `AddBaseGrid.out_2`（RootScene） → `in_0` | scene 树 `{tree:{name,children,...}}` |
| `in_1` | string | **BaseName** 基础网格节点名 | 建议接 | `text_panel.output` → `in_1` | 字符串，如 `"ground"` |
| `in_2` | number | **Width** 网格宽度 | 建议接 | `number_const.value` → `in_2` | 数值，如 `50` |
| `in_3` | number | **Height** 网格高度 | 建议接 | `number_const.value` → `in_3` | 数值，如 `50` |
| `in_4` | string(tree) | **BaseAsset** 底图资产名 | 可选（推荐） | `text_panel.output` → `in_4` | 字符串，如 `"grassland"` |

> 隐藏高级端口：`in_5`（schema）、`in_6`（token）、`in_7`（zRange）、`in_8`（fillValue）——网格 schema / 鉴权 token / 高程范围 / 填充值等高级调参，**默认即可、日常不接**。
>
> **数据格式总则**：每个端口值是 **DataTree** = `[{ "path":[...], "items":[...] }]`。`portType` 决定 `items` 形态：`number`→数值、`string`→字符串、`grid`→二维数组、`scene`→`{tree:{name,path,children,...}}`。要确认"这个端口预期喂/吐什么格式"，看它的 portType 即可。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_1` | scene | **BaseNode**（focus 聚焦到刚加的基础网格节点） | **★ 后续模板组 / 植被装饰 `in_0`**（在 base 上继续操作） |
| `out_2` | scene | **RootScene**（整棵根场景透传） | → 下一块 `AddBaseGrid.in_0`（多区域）；→ `tree_merge`（整根汇总） |
| `out_3` | string | **BaseNodePath**（基础网格节点路径句柄） | 一般不接 |
| `out_0` | scene | 原始 grid scene（grid2node 直出，**未 focus**） | **❌ 装饰链不要接**；日常不用 |

## 推荐参数与设置考虑要素

- **Width / Height（`in_2`/`in_3`）**：基础网格尺寸，决定整张场景的物理范围。实证基线（Example1 / verified-town）网格尺寸 `50×50`；更大的场景可用 `73×73`（Example1）。日常起手推荐 **`50×50`**。多区域拼接时各块可用不同尺寸。
- **BaseName（`in_1`）**：基础网格节点名，**后续所有模板组都从这个节点出发**，建议起一个语义清晰的名字，如 `ground`（地面）、`grassland`（草地）、`base`（基底）。多区域时按区域命名（如 `north_field` / `lake_area`）。
- **BaseAsset（`in_4`）**：底图资产名（tile），**就是这片基础网格最终渲染出来的底图图层名**。可选但**强烈推荐**——给它一个语义底图能让基础网格直接可见、可作其它地物的衬底。推荐 `grassland`（草地）/ `ground`（地面）/ `dirt`（泥地）等。不接则只有空网格结构、无底图 tile。
- **多块基础网格**：每个 AddBaseGrid 实例独立配一套 Width/Height/BaseName/BaseAsset；用前一块的 `out_2`（RootScene）接下一块的 `in_0`，让多块挂在同一棵根上拼接成多区域。

## 使用示例（applyBatch ops，可照抄）

**标准起手式：空场景 → AddBaseGrid。** 先实例化本组拿回 `<G_BASE>`：

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"AddBaseGrid", "position":{"x":-900,"y":0},
           "opts":{"actor":"ai:sino","label":"实例化 AddBaseGrid"} } }
```

把返回的 groupId 替换进 `<G_BASE>`，提交一条 applyBatch（建空场景源 + Width/Height/BaseName/BaseAsset 的 panel/const 并连线）：

```jsonc
{ "type":"createNode","nodeId":"empty",      "opId":"empty_scene", "position":{"x":-1300,"y":0},  "params":{} },                       // 空场景起点（无输入）
{ "type":"createNode","nodeId":"base_name",  "opId":"text_panel",  "position":{"x":-1300,"y":120},"params":{"text":"ground"} },        // BaseName
{ "type":"createNode","nodeId":"base_w",     "opId":"number_const","position":{"x":-1300,"y":240},"params":{"value":50} },             // Width
{ "type":"createNode","nodeId":"base_h",     "opId":"number_const","position":{"x":-1300,"y":360},"params":{"value":50} },             // Height
{ "type":"createNode","nodeId":"base_asset", "opId":"text_panel",  "position":{"x":-1300,"y":480},"params":{"text":"grassland"} },     // BaseAsset = 底图图层名
// in_0=RootScene 接空场景；in_1=BaseName；in_2/in_3=Width/Height；in_4=BaseAsset
{ "type":"connect","edgeId":"e_bg_scene","source":{"nodeId":"empty","port":"scene"},       "target":{"nodeId":"<G_BASE>","port":"in_0"} },
{ "type":"connect","edgeId":"e_bg_name", "source":{"nodeId":"base_name","port":"output"},  "target":{"nodeId":"<G_BASE>","port":"in_1"} },
{ "type":"connect","edgeId":"e_bg_w",    "source":{"nodeId":"base_w","port":"value"},      "target":{"nodeId":"<G_BASE>","port":"in_2"} },
{ "type":"connect","edgeId":"e_bg_h",    "source":{"nodeId":"base_h","port":"value"},      "target":{"nodeId":"<G_BASE>","port":"in_3"} },
{ "type":"connect","edgeId":"e_bg_asset","source":{"nodeId":"base_asset","port":"output"},"target":{"nodeId":"<G_BASE>","port":"in_4"} }
```

> **后续模板组 / 在 base 上撒植被的 `in_0` 接本组 `out_1`（BaseNode），而不再用空根。** 例如建筑层、**RandomNaturalDecoration（仅草坪+植被）**：
> `{ "type":"connect","source":{"nodeId":"<G_BASE>","port":"out_1"},"target":{"nodeId":"<G_ARCH>","port":"in_0"} }`。
> **❌ 常见弯路**：接 `out_0`（裸 grid）或 `out_2`（RootScene）——语义不对，虽有时能 execute 通过。
> 整棵根场景的最终汇总用 `out_2`（RootScene）→ `tree_merge` / 多区域拼接。

### 等价 CLI 写法（forgeax，headless）

三条通路（UI 拖拽 / CLI / `scene:*` 工具）底层是**同一套 op**，落到同一张 `graph.json`，效果等价、可互相验证。CLI 版（`<G>` = 定位参数，如 `--project-id <pid> --project-root <ws>`；`$BATT` = batteries 目录；`$TMPL` = `apps/wb-scene-generator/batteries/templates/scene`）：

```bash
# 1) 一步实例化模板组（--group-id 给稳定句柄；省略则自动生成）
forgeax node create-template --group-file $TMPL/AddBaseGrid/AddBaseGrid.json --group-id base --x -900 --y 0 $G
# 2) 建空场景源 + panel/const 输入电池
forgeax node create --node-id empty      --op empty_scene  --params '{}'                  --x -1300 --y 0   $G --batteries $BATT
forgeax node create --node-id base_name  --op text_panel   --params '{"text":"ground"}'   --x -1300 --y 120 $G --batteries $BATT
forgeax node create --node-id base_w     --op number_const --params '{"value":50}'        --x -1300 --y 240 $G --batteries $BATT
forgeax node create --node-id base_h     --op number_const --params '{"value":50}'        --x -1300 --y 360 $G --batteries $BATT
forgeax node create --node-id base_asset --op text_panel   --params '{"text":"grassland"}' --x -1300 --y 480 $G --batteries $BATT
# 3) 连线（--from/--to 用 node:port）
forgeax node connect --edge-id e_bg_scene --from empty:scene       --to base:in_0 $G
forgeax node connect --edge-id e_bg_name  --from base_name:output  --to base:in_1 $G
forgeax node connect --edge-id e_bg_w     --from base_w:value      --to base:in_2 $G
forgeax node connect --edge-id e_bg_h     --from base_h:value      --to base:in_3 $G
forgeax node connect --edge-id e_bg_asset --from base_asset:output --to base:in_4 $G
```

> 也可用 `forgeax pipeline apply --ops '<JSON array>'` 一次提交多条 op（与上面 applyBatch 的 ops 完全同一套 schema）。

## 多区域拼接说明

一张场景可由**多个 AddBaseGrid** 拼出多个区域：

- 每个 AddBaseGrid 各产一个 **BaseNode**（`out_1`），分别作为不同区域（如村落区、农田区、湖区）的挂接点——后续布置该区域的模板组从对应 BaseNode 出发。
- 用前一块的 **RootScene**（`out_2`）接到下一块 AddBaseGrid 的 `in_0`，让多块基础网格挂在**同一棵根场景**下；最后一块的 `out_2` 承载整棵根，作为最终汇总根场景。
- 各块用不同的 BaseName / BaseAsset / Width / Height 区分区域语义与尺寸。

## 使用场合

- **几乎所有场景都从它起步，且通常是第一个实例化的模板组**（紧接 `empty_scene`）。它确立场景尺寸与底图，并把 focus 聚焦到基础节点供后续挂接。
- 多区域 / 拼接式场景：用多个 AddBaseGrid 划出多块基础区域。
- **不该用的情况**：上游已有完整基础场景（如从已有项目继续）且不需要新增基础区域时，可直接复用上游场景树。

## 验证要点

`pipeline.get` 核对 `<G_BASE>` 的 `in_0`/`in_1`/`in_2`/`in_3`/`in_4` 真的接上了边（防"ok 却空"）。

`pipeline.execute` 应 `status:completed` 零错误。

### 读回端口内容验证（像 grep 一样查某端口）

没有专门的"读端口"命令；标准做法是 **`execute` 后用 jq 把 `result.outputs` 投影到 `节点.端口`**。`outputs` 按 **nodeId** 键控，每个节点是 `{ <portName>: <DataTree> }`，DataTree = `[{path,items}]`。

```bash
# CLI 通路：查 BaseNode（out_1，focus 已聚焦的基础网格节点）——用实例化返回的真实 groupId 替换 <G_BASE>
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_BASE>"]["out_1"][0].items[0].tree.children[].name'
# 查 RootScene（out_2，整棵根）的子节点名，确认基础网格节点已挂上根
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_BASE>"]["out_2"][0].items[0].tree.children[].name'
```

工具通路同理对 `scene:pipeline.execute` 返回投影。预期：

- **BaseNode（`out_1`）** 的子树里出现以 **BaseName**（如 `ground`）命名、带 **BaseAsset**（如 `grassland`）tile 的基础网格节点；
- **RootScene（`out_2`）** 的树里挂着这个基础网格节点（多区域时挂着多块）。

看到以 BaseName 命名、带 BaseAsset tile 的基础网格节点出现，即说明起点正确，可接后续模板组（其 `in_0` 接本组 `out_1`）。

> ⚠️ **绝不要整体打印 `outputs`**：整图 execute 的 outputs 可能极大（含全 voxel 网格），会刷屏 / 爆上下文。**必须用 jq 投影到具体 `nodeId.portName`**，scene 端口只取 `.[0].items[0].tree.children[].name` 之类摘要。
