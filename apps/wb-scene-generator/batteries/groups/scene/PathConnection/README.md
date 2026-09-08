# PathConnection（道路连接）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1781857907971_zblc6`，也可用 basename `PathConnection`。
> 内部 27 个节点、1 个嵌套子组。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

在 **POI（兴趣点，通常是建筑）之间生成连通道路**，把场景拆成"路"与"非路"两块。它需要两个场景输入：一个是要连接的焦点（POI），一个是可铺路的上游空间。

**典型位置：建筑层之后、自然地物（湖/田/植被）之前。** 先把建筑连起来形成街道骨架，剩下的非道路区域再交给后续组布置。

## ⚠️⚠️ 头号防呆铁律：`in_0`（POI 焦点）必接，悬空后果极隐蔽 ⚠️⚠️

> **本组有两个 scene 输入端口，最容易漏接的是 `in_0`（POI 焦点）。** `in_0` 是"要被道路连接的兴趣点（=建筑）"，它在组内驱动 `alg_topology_connect_points` 的 `poiGrid`——**没有 POI 就没有要连的点，就没有道路拓扑，整组产出空。**
>
> **`in_0` 悬空（不接任何边）的后果（极隐蔽，务必牢记）：**
> 1. PathConnection **整组静默空跑**：`out_0`（Path 道路）、`out_1`（Non-Path 剩余）全为空，**`outputs/` 下根本不会出现本组目录**（没有 `paths/`）。
> 2. **道路不生成**：最终 `names`/`layers` 里**不会出现你传入的 PathAsset 名（如"石路"）**。
> 3. **连带下游空跑**：若把本组 `out_1`（Non-Path）接给后续装饰/湖/田组的 `in_0`，因 `out_1` 为空，那些组也跟着静默空跑（如 RandomNaturalDecoration 的"行道树"也不出现）。
> 4. **整图 `execute` 仍报 `completed`、不报任何错**：`tree_merge`/`scene_output` 不校验各 item 是否非空，所以"completed"≠"道路真的生成了"。**只看 status 会被骗。**
>
> **正确接法（务必三条全接；`in_0` 与 `in_1` 必须是不同来源）**：
> - `in_0`（POI 焦点）← **默认进阶档**：`ArchitectureStructures.out_0` → `scene_focus_path`(聚焦 `/outer_door`) → `in_0`（连"门"，路从门口出）；**简化档兜底**（无结构层时）才接 `ArchitectureRegions.out_0`(Buildings)。—— **绝不能空！**
> - `in_1`（上游空间）← `ArchitectureRegions.out_2`（**Rest 剩余**）—— **与 `in_0` 不同源，别图省事把两口都接到同一个 `out_0`。**
> - `in_2`（PathAsset）← `text_panel.output`（道路资产名，如"石路"）
>
> **接完务必验证本组真的产出了**（见文末「验证要点」）：`pipeline.get` 确认 `in_0` 有入边 + `execute` 后确认 `outputs/<G_PATH>/` 目录出现且 `out_0` 非空 + 最终 `names` 里出现"石路"。三者齐了才算成功。
>
> 真相源：本目录 `PathConnection.json` 的 `exposedInputs` 中 `in_0` 的 `customLabelEn:"POI"`（`sourceNodeId` 链路最终汇入 `alg_topology_connect_points.poiGrid`）；对照 Example1（`p_mq6me0yg_0ewgrl`）的 PathConnection `in_0` **确有接一个 scene 源**（建筑结构 → `scene_focus_path` → `in_0`），即 in_0 必接。

## 输入端口（IN）

可见（非 hidden）端口（"怎么喂"= 用哪个上游电池经 `node connect` / `connect` op 接上）：

| portName | portType | 语义 | 是否必接 | 怎么喂（来源电池 → 本端口） | 数据格式（DataTree.items） |
|---|---|---|---|---|---|
| `in_0` | scene | **POI** 焦点/兴趣点场景（要被连接的点，如门/建筑） | **必接** | **默认进阶**：`ArchStructures.out_0`→`scene_focus_path`(门)→`in_0`；简化兜底：`ArchitectureRegions.out_0` → `in_0` | scene 树 |
| `in_1` | scene | 上游场景（可铺路的剩余空间） | **必接** | `ArchitectureRegions.out_2`（Rest） → `in_1`（**与 in_0 不同源**） | scene 树 |
| `in_2` | string | PathAsset 道路资产名 | 建议接 | `text_panel.output` → `in_2` | 字符串，如 `"石路"` |

> **无显式 Seed 可见端口**（道路由 POI 拓扑决定，不需要独立种子）。
> 隐藏高级端口：`in_3`..`in_15`（roadWidth 路宽 / roadValue / coverPoi 是否覆盖POI / fillValue / z / schema / token / zRange 等）。**默认即可，日常不接。**
>
> **数据格式总则**：端口值是 **DataTree** = `[{path,items}]`；`portType` 决定 `items` 形态：`scene`→`{tree:{name,children,...}}`、`string`→字符串、`number`→数值、`grid`→二维数组。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | **Scene** 整树汇总口 | `{ "label":"Scene", "portName":"out_0" }` → `appendMergeItem` 汇总根 |
| `out_1` | scene | **Path** 道路领域产物 | 后续道路细化，禁止接 merge |
| `out_2` | scene | **Rest** 非道路/剩余区域 | → 下一组 Scene 输入（链式 Rest，给湖/田/植被） |
| `out_3` | string | PathPath（道路路径句柄） | 一般不接 |
| `out_4` | string | RestPath（剩余区域路径句柄） | 一般不接 |

## 推荐参数与设置考虑要素

- **PathAsset（`in_2`）**：道路资产名，**就是渲染出来的道路图层名**。实测传中文 `"石路"` 时图层名即 `石路`（而非英文 `road`）。按想要的语义命名。
- **`in_0`（POI 焦点）有两档接法（必接这条边不变，`in_0`/`in_1` 必须不同源）**：
  - **进阶档（默认推荐，Example1 实证，"道路从门口自然连出"）**：先用 `scene_focus_path` 把 POI 精确聚焦到每栋建筑的 `outer_door`（门）子节点，再喂给 `in_0`。道路连的是**门**而非整栋楼的轮廓，于是路自然从门口出发。**这是默认应走的接法**，详见下文「POI 的进阶用法（Example1 实证）」。
  - **简化档（最低限度兜底，仅在没有 ArchitectureStructures、没门可提取时退而求其次）**：直接把 `ArchitectureRegions.out_0`（Buildings 建筑）接 `in_0`，`out_2`（Rest 剩余）接 `in_1`。道路连的是**整栋建筑的轮廓**，糙——路贴楼边走、不一定从门口出发。**不要因为它省事就默认用它。**
- 路宽等（隐藏 `in_3`）默认即可。
- **没有 Seed**：道路布局由建筑位置和拓扑决定，想换道路走向就改上游建筑的 seed。

## 使用示例（简化档兜底，applyBatch ops 可照抄）

> ⚠️ 下面是**简化档（兜底）**——`in_0` 直接接建筑轮廓，仅用于没有 ArchitectureStructures、没门可提取的场景。**默认应走进阶档**（连门），见后文「POI 的进阶用法」的可照抄写法。

前置：已实例化 `ArchitectureRegions` 并拿到 `<G_ARCH>`。先实例化本组拿回 `<G_PATH>`：

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"PathConnection", "position":{"x":-500,"y":600},
           "opts":{"actor":"ai:sino","label":"实例化 PathConnection"} } }
```

把返回 groupId 替换进 `<G_PATH>`，提交 applyBatch：

```jsonc
{ "type":"createNode","nodeId":"road_name","opId":"text_panel","position":{"x":-900,"y":600},"params":{"text":"石路"} },  // PathAsset = 道路图层名
// in_0=POI焦点 接建筑 out_0；in_1=上游空间 接建筑 out_2（剩余）；in_2=道路资产名
{ "type":"connect","edgeId":"e_pc_name", "source":{"nodeId":"road_name","port":"output"}, "target":{"nodeId":"<G_PATH>","port":"in_2"} },
{ "type":"connect","edgeId":"e_pc_focus","source":{"nodeId":"<G_ARCH>","port":"out_0"},   "target":{"nodeId":"<G_PATH>","port":"in_0"} },
{ "type":"connect","edgeId":"e_pc_rest", "source":{"nodeId":"<G_ARCH>","port":"out_2"},   "target":{"nodeId":"<G_PATH>","port":"in_1"} },
{ "type":"connect","edgeId":"e_pc_out0", "source":{"nodeId":"<G_PATH>","port":"out_0"},   "target":{"nodeId":"merge_all","port":"item_1"} }
```

> 后续湖/田/植被的链式起点用 `<G_PATH>.out_1`（Non-Path 非道路区域）接到下一组 `in_0`。

### 等价 CLI 写法（forgeax，headless）

三条通路底层同一套 op、落到同一张 `graph.json`。CLI 版（`<G>`/`$BATT`/`$TMPL` 含义见 `ArchitectureRegions/README.md`）：

```bash
forgeax node create-template --group-file $TMPL/PathConnection/PathConnection.json --group-id path --x -500 --y 600 $G
forgeax node create --node-id road_name --op text_panel --params '{"text":"石路"}' --x -900 --y 600 $G --batteries $BATT
forgeax node connect --edge-id e_pc_name  --from road_name:output --to path:in_2 $G
forgeax node connect --edge-id e_pc_focus --from arch:out_0       --to path:in_0 $G   # POI 焦点 = 建筑
forgeax node connect --edge-id e_pc_rest  --from arch:out_2       --to path:in_1 $G   # 上游空间 = 建筑剩余
forgeax node connect --edge-id e_pc_out0  --from path:out_0       --to merge_all:item_1 $G
```

> 或 `forgeax pipeline apply --ops '<JSON array>'` 一次提交（同 applyBatch schema）。

## POI 的进阶用法（Example1 实证）：连"门"而非连整栋楼

> 上面的「使用示例」是**简化档**（道路连建筑轮廓，够用但糙）。Example1（`p_mq6me0yg_0ewgrl`）的真实接法**进阶得多**：POI 不是整栋建筑场景，而是**经路径查询精确提取出的"门"节点**——道路因此从门口自然连出。下面是已从 Example1 `graph.json` 复核过的完整链路与可照抄写法。

### 为什么连"门"

`ArchitectureStructures`（建筑结构）会在每栋建筑内部生成一个名为 **`outer_door`** 的子节点（外墙门洞，由内部 `alg_topology_pick_doors` 算门洞位置、再 `add_child` 命名为 `outer_door` 挂进建筑结构树）。若把 POI 精确聚焦到这个 `outer_door` 子节点再喂给 `in_0`，`alg_topology_connect_points` 的 POI 就落在门口，**道路从门口自然出发**，而不是贴着整栋楼的轮廓乱走。这就是 Example1 道路质感的来源。

### 完整链路（Example1 实证，端口名以 `graph.json` 为准）

```
ArchitectureRegions.out_1 (BuildingPath, string 建筑路径句柄, 如 "/architecture_0") ──→ string_concat.a ─┐
text_panel(text="/outer_door").output ──────────────────────────────────────────────→ string_concat.b ─┤
                                                                                                         ▼
                                              string_concat.result = "/architecture_0/outer_door"（门的完整路径）
                                                                                                         │ (作为 path)
ArchitectureStructures.out_0 (带门结构的建筑场景, 内部已生成 outer_door 子区域) ──→ scene_focus_path.scene
                                                                                                         ▼
                          scene_focus_path(scene=建筑结构场景, path=门路径) → 输出 scene，focus 精确聚焦到 outer_door 子节点（tree 不变，只改 focus）
                                                                                                         │
                                                                                          PathConnection.in_0 (POI = 提取出的门节点)
```

要点（语义）：
1. **`ArchitectureRegions.out_1` = BuildingPath（string）**：建筑节点的路径句柄（实证 `exposedOutputs` 里 `out_1` customLabelEn=`BuildingPath`；另有 `out_4`=`RestPath`）。
2. 用 **`string_concat`**（输入端口 `a`/`b`，输出端口 `result`）把 `BuildingPath` + `"/outer_door"` 拼成门的完整路径。`text_panel` 输出端口名是 `output`。
3. 用 **`scene_focus_path`**（输入 `scene`+`path`；输出 `scene`，focus 改到该路径，tree 不变）在 **ArchitectureStructures 的场景**里按路径精确聚焦到门节点。
4. 这个 focus 到"门"的 scene 才是 POI → 喂给 `PathConnection.in_0`。**道路连的是"门"，不是整栋楼的轮廓。**

### 进阶档使用示例（applyBatch ops，可照抄）

前置：已实例化 `ArchitectureRegions`（拿到 `<G_ARCH>`）、`ArchitectureStructures`（拿到 `<G_STRUCT>`，其 `in_0` 接 `<G_ARCH>.out_0`）、`PathConnection`（拿到 `<G_PATH>`）。

```jsonc
{ "type":"createNode","nodeId":"road_name","opId":"text_panel","position":{"x":-900,"y":600},"params":{"text":"石路"} },        // PathAsset
{ "type":"createNode","nodeId":"door_seg", "opId":"text_panel","position":{"x":-900,"y":720},"params":{"text":"/outer_door"} }, // 门子节点名(带前导斜杠)
{ "type":"createNode","nodeId":"door_path","opId":"string_concat","position":{"x":-650,"y":660},"params":{} },                  // 拼接 BuildingPath + /outer_door
{ "type":"createNode","nodeId":"focus_door","opId":"scene_focus_path","position":{"x":-400,"y":660},"params":{} },              // 在建筑结构场景里聚焦到门
// 拼门路径：a=BuildingPath(建筑路径句柄)、b="/outer_door"，result=门完整路径
{ "type":"connect","edgeId":"e_dp_a",   "source":{"nodeId":"<G_ARCH>","port":"out_1"},      "target":{"nodeId":"door_path","port":"a"} },
{ "type":"connect","edgeId":"e_dp_b",   "source":{"nodeId":"door_seg","port":"output"},     "target":{"nodeId":"door_path","port":"b"} },
// 在建筑结构场景里按门路径聚焦：scene=ArchitectureStructures.out_0、path=门完整路径
{ "type":"connect","edgeId":"e_fd_scene","source":{"nodeId":"<G_STRUCT>","port":"out_0"},   "target":{"nodeId":"focus_door","port":"scene"} },
{ "type":"connect","edgeId":"e_fd_path", "source":{"nodeId":"door_path","port":"result"},   "target":{"nodeId":"focus_door","port":"path"} },
// POI = 聚焦到门的 scene → in_0（这才是进阶档的关键：连门不连楼）
{ "type":"connect","edgeId":"e_pc_focus","source":{"nodeId":"focus_door","port":"scene"},   "target":{"nodeId":"<G_PATH>","port":"in_0"} },
// in_1=上游空间 仍接建筑剩余 out_2；in_2=道路资产名
{ "type":"connect","edgeId":"e_pc_rest", "source":{"nodeId":"<G_ARCH>","port":"out_2"},     "target":{"nodeId":"<G_PATH>","port":"in_1"} },
{ "type":"connect","edgeId":"e_pc_name", "source":{"nodeId":"road_name","port":"output"},   "target":{"nodeId":"<G_PATH>","port":"in_2"} },
{ "type":"connect","edgeId":"e_pc_out0", "source":{"nodeId":"<G_PATH>","port":"out_0"},     "target":{"nodeId":"merge_all","port":"item_1"} }
```

> ⚠️ `in_0` 仍然**必接**（防呆铁律不变）——只是这里接的是 `scene_focus_path.scene`（门）而非建筑 `out_0`。三个查询/拼接电池（`text_panel`/`string_concat`/`scene_focus_path`）都在 sino 白名单内，可直接在顶层 `createNode`。

### 等价 CLI 进阶写法（forgeax，headless）

```bash
forgeax node create --node-id road_name --op text_panel    --params '{"text":"石路"}'        --x -900 --y 600 $G --batteries $BATT
forgeax node create --node-id door_seg  --op text_panel    --params '{"text":"/outer_door"}' --x -900 --y 720 $G --batteries $BATT
forgeax node create --node-id door_path --op string_concat --params '{}'                     --x -650 --y 660 $G --batteries $BATT
forgeax node create --node-id focus_door --op scene_focus_path --params '{}'                 --x -400 --y 660 $G --batteries $BATT
# 拼门路径：BuildingPath(arch:out_1) + "/outer_door"
forgeax node connect --edge-id e_dp_a    --from arch:out_1       --to door_path:a        $G
forgeax node connect --edge-id e_dp_b    --from door_seg:output  --to door_path:b        $G
# 在建筑结构场景(struct:out_0)里按门路径聚焦
forgeax node connect --edge-id e_fd_scene --from struct:out_0    --to focus_door:scene   $G
forgeax node connect --edge-id e_fd_path  --from door_path:result --to focus_door:path   $G
# POI = 门 → in_0；in_1=建筑剩余；in_2=道路名
forgeax node connect --edge-id e_pc_focus --from focus_door:scene --to path:in_0         $G   # POI=门，不是整栋楼
forgeax node connect --edge-id e_pc_rest  --from arch:out_2        --to path:in_1        $G
forgeax node connect --edge-id e_pc_name  --from road_name:output  --to path:in_2        $G
forgeax node connect --edge-id e_pc_out0  --from path:out_0        --to merge_all:item_1 $G
```

### 两档怎么选

| 档位 | `in_0` 接什么 | 道路质感 | 适用 |
|---|---|---|---|
| **进阶档（默认）** | `scene_focus_path`→门（`outer_door`） | 路从门口自然连出，还原 Example1 | **默认首选**；要门口质感、已有/可加 ArchitectureStructures 建筑结构层 |
| **简化档（兜底）** | `ArchitectureRegions.out_0`（建筑轮廓） | 路贴楼边，糙 | **仅兜底**：没有 ArchitectureStructures、没门可提取时 |

> 进阶档**依赖 ArchitectureStructures 已经生成了 `outer_door` 子区域**——所以默认就应在管线里先接上 ArchitectureStructures（它的 `out_0` 才有门子节点）。只有在确实没有结构层、没门可提取时，才退回简化档。

## 使用场合

- 任何有多个建筑、需要**街道/道路把建筑连起来**的场景（城镇、村落、街区）。
- 必须接在 `ArchitectureRegions` 之后（需要建筑作 POI 焦点 + 剩余空间作铺路区）。
- 链式：`out_1`（Non-Path）作为后续湖/田/植被的起点空地。
- **不该用的情况**：纯自然场景（无建筑、无需道路）跳过；只有单个建筑、无需连路时也可跳过。

## 验证要点

> **务必逐组验证本组真的产出了道路**——`execute` 报 `completed` 不代表本组成功（见文首「头号防呆铁律」第 4 条）。按下面三步全过才算对：

**① `pipeline.get` 确认 `in_0`（POI）真的有入边**（最常见漏接点）：

```bash
# 工具通路：get 返回里查本组三个 scene/string 输入端口是否都有 source
#   尤其确认 in_0 不是空的（in_0 悬空 = 整组空跑）
forgeax pipeline get $G | jq '.edges[]? | select(.target.nodeId=="<G_PATH>") | "\(.target.port) <- \(.source.nodeId):\(.source.port)"'
#   预期至少看到：in_0 <- <G_ARCH>:out_0 、 in_1 <- <G_ARCH>:out_2 、 in_2 <- road_name:output
#   若没有 in_0 这行 → POI 悬空，立刻补边再 execute
```

**② `execute` 后确认本组 `outputs/` 目录出现且 `out_0` 非空**：

```bash
# 落盘核对：本组目录必须存在（in_0 悬空时这个目录根本不会生成）
ls outputs/<G_PATH>/ 2>/dev/null || echo "❌ 本组无任何输出 = 空跑(检查 in_0)"
# 端口内容核对：out_0 道路子节点名应出现 PathAsset 文本（如 石路）
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_PATH>"]["out_0"][].items[0].tree.children[].name'
```

**③ 最终 `names` 里出现你传入的 PathAsset 名**（如"石路"）——这是"道路真的生成了"的最干净判据：

```bash
jq -r '.data[0].items[0][] | "\(.type)\t\(.name)"' outputs/out/names.json | sort | uniq -c | grep 石路 \
  || echo "❌ names 里没有道路名 = 道路没生成(回头查 in_0 是否悬空)"
```

`pipeline.execute` 应 `status:completed`，`out.layers` 应**多出 1 个 `type:tile` 图层，名字 = 你传入的 PathAsset 文本**（如 `石路`）。

- 实证基线（verified-town +道路）：节点 15 / 边 17，`out.layers` 多出 `石路` tile×1。
- 反例（crowded-block `p_mqax7pj3_eaa3by` 修复前）：`in_0`（POI）悬空 → `outputs/paths/` 不存在、`names` 无"石路"、下游 natdec 连带无"行道树"，但整图仍 `completed`。

看到道路 tile 图层出现，且建筑之间在 Preview 里被路连起来，即说明本层正确。

### 读回端口内容验证（像 grep 一样查某端口）

`execute` 后用 jq 把 `result.outputs` 投影到 `节点.端口`（`outputs` 按 nodeId 键控，DataTree = `[{path,items}]`）：

```bash
# 查道路产物 out_0；string 端口（如 out_3 PathPath）直接看 items
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_PATH>"]["out_0"][].items[0].tree.children[].name'
# 查 Non-Path（剩余空间）out_1 的子节点名，确认它能作下一组上游
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_PATH>"]["out_1"][].items[0].tree.children[].name'
```

工具通路同理对 `scene:pipeline.execute` 返回投影。预期：`out_0` 树里出现名为 PathAsset 文本（如 `石路`）的道路子节点。

> ⚠️ **绝不要整体打印 `outputs`**（整图可达约 28MB 含全 voxel 网格）；**必须 jq 投影到具体 `nodeId.portName`**，scene 端口只取 `.[].items[0].tree.children[].name` 摘要。
