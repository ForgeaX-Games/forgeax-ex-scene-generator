# LakeRegions（湖泊区域）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1781238394903_rz71v`，也可用 basename `LakeRegions`。
> 内部 27 个节点、2 个嵌套子组。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

在**剩余空地上挖出湖泊区域**（水体）。它消费一块上游空间，划出若干湖，并把没被湖占用的地作为 Rest 继续往下传。

**典型位置：自然地物层**（建筑/道路之后）。通常接在 `PathConnection*.out_2`（Rest/非道路区域；`out_1` 是 Path 本身，不是 Rest）或上一个自然组的 Rest 之后。

## 输入端口（IN）

可见（非 hidden）端口（"怎么喂"= 用哪个上游电池经 `node connect` / `connect` op 接上）：

| portName | portType | 语义 | 是否必接 | 怎么喂（来源电池 → 本端口） | 数据格式（DataTree.items） |
|---|---|---|---|---|---|
| `in_0` | scene | 上游场景 / 剩余空地 | **必接** | `PathConnection*.out_2`（Rest；不是 `out_1`）或上一组 Rest → `in_0` | scene 树 |
| `in_1` | number | ExpectedLakes 期望湖泊数 | 建议接 | `number_const.value` → `in_1` | 数值，如 `3` |
| `in_2` | string | LakeAsset 湖泊资产名 | 建议接 | `text_panel.output` → `in_2` | 字符串，如 `"湖"` |
| `in_3` | number | Seed 随机种子 | 建议接 | `seed_control.seed` → `in_3` | 数值，如 `42` |

> 隐藏高级端口：`in_4`..`in_17`（fillValue / z / mode / countMode / density / targetValue / sizeVariance 湖面大小方差 / spacingDilate 间距 / schema / token / zRange 等）。**默认即可，日常不接。**
>
> **数据格式总则**：端口值是 **DataTree** = `[{path,items}]`；`portType` 决定 `items` 形态：`scene`→`{tree:{name,children,...}}`、`number`→数值、`string`→字符串、`grid`→二维数组。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | Scene 整树汇总口（含湖泊） | `{ "label":"Scene", "portName":"out_0" }` → `appendMergeItem` |
| `out_1` | scene | **Rest** 剩余空地 | → 下一组 `in_0`（链式 Rest） |
| `out_2` | scene | **Lake** 湖泊 | 一般不接（out_0 已是主产物） |
| `out_3` | string | LakePath（路径句柄） | 一般不接 |
| `out_4` | string | RestPath（剩余路径句柄） | 一般不接 |

## 推荐参数与设置考虑要素

- **ExpectedLakes（`in_1`）**：期望湖泊数，目标值（实际受空地大小影响）。实证 Example1=`3`。
  - 点缀小水塘：`1~2`
  - 多湖湿地 / 水乡：`3~5`
- **LakeAsset（`in_2`）**：湖泊资产名，**就是渲染出来的水体图层名**。按语义命名，中文如 `"湖"` / `"水"`，英文如 `"lake"` / `"water"`。
- **Seed（`in_3`）**：接全局 `seed_control.seed` 保证可复现。改 seed 换一套湖泊位置/形状。
- 湖面大小方差 / 间距（隐藏端口）默认即可。

## 使用示例（applyBatch ops，可照抄）

前置：链路里已有上游剩余场景（如 `<G_PATH>.out_2`，Rest；不是 `out_1`）。先实例化拿回 `<G_LAKE>`：

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"LakeRegions", "position":{"x":-500,"y":1400},
           "opts":{"actor":"ai:sino","label":"实例化 LakeRegions"} } }
```

把返回 groupId 替换进 `<G_LAKE>`，提交 applyBatch（这里以接在道路 Rest 之后为例；`<UPSTREAM_REST>` 改成实际上游，如 `<G_PATH>.out_2`）：

```jsonc
{ "type":"createNode","nodeId":"lake_count","opId":"number_const","position":{"x":-900,"y":1400},"params":{"value":3} },     // ExpectedLakes
{ "type":"createNode","nodeId":"lake_name", "opId":"text_panel",  "position":{"x":-900,"y":1520},"params":{"text":"湖"} },   // LakeAsset = 水体图层名
// in_0=上游剩余 接 PathConnection*.out_2（Rest，不是 out_1=Path）；in_1=期望湖数；in_2=湖资产名；in_3=seed
{ "type":"connect","edgeId":"e_lk_scene","source":{"nodeId":"<G_PATH>","port":"out_2"},     "target":{"nodeId":"<G_LAKE>","port":"in_0"} },
{ "type":"connect","edgeId":"e_lk_cnt",  "source":{"nodeId":"lake_count","port":"value"},   "target":{"nodeId":"<G_LAKE>","port":"in_1"} },
{ "type":"connect","edgeId":"e_lk_name", "source":{"nodeId":"lake_name","port":"output"},   "target":{"nodeId":"<G_LAKE>","port":"in_2"} },
{ "type":"connect","edgeId":"e_lk_seed", "source":{"nodeId":"seed_main","port":"seed"},     "target":{"nodeId":"<G_LAKE>","port":"in_3"} },
{ "type":"connect","edgeId":"e_lk_out0", "source":{"nodeId":"<G_LAKE>","port":"out_0"},     "target":{"nodeId":"merge_all","port":"item_N"} }  // 换未占用 item 口
```

> 后续农田/植被的链式起点用 `<G_LAKE>.out_1`（Rest）接到下一组 `in_0`。

### 等价 CLI 写法（forgeax，headless）

三条通路底层同一套 op、落到同一张 `graph.json`。CLI 版（`<G>`/`$BATT`/`$TMPL` 含义见 `ArchitectureRegions/README.md`；上游 `path` 句柄来自实例化 PathConnection 时的 `--group-id`）：

```bash
forgeax node create-template --group-file $TMPL/LakeRegions/LakeRegions.json --group-id lake --x -500 --y 1400 $G
forgeax node create --node-id lake_count --op number_const --params '{"value":3}'  --x -900 --y 1400 $G --batteries $BATT
forgeax node create --node-id lake_name  --op text_panel   --params '{"text":"湖"}' --x -900 --y 1520 $G --batteries $BATT
forgeax node connect --edge-id e_lk_scene --from path:out_2       --to lake:in_0 $G
forgeax node connect --edge-id e_lk_cnt   --from lake_count:value --to lake:in_1 $G
forgeax node connect --edge-id e_lk_name  --from lake_name:output --to lake:in_2 $G
forgeax node connect --edge-id e_lk_seed  --from seed_main:seed   --to lake:in_3 $G
forgeax node connect --edge-id e_lk_out0  --from lake:out_0       --to merge_all:item_N $G
```

> 或 `forgeax pipeline apply --ops '<JSON array>'` 一次提交（同 applyBatch schema）。

## 使用场合

- 需要**水体 / 湖泊 / 池塘**的场景（水乡、湿地、有水景的乡村/公园）。
- 接在任意"产出 Rest 空地"的组之后（道路 Non-Path / 上一个自然组 Rest）。
- 链式：`out_1`（Rest）继续给农田/植被。
- **不该用的情况**：不需要水体的干燥场景跳过。

## 验证要点

`pipeline.get` 核对 `<G_LAKE>` 的 `in_0`（上游）、`in_1`/`in_2`/`in_3`（湖数/名/种子）真的接上，`out_0` 进了汇总。

`pipeline.execute` 应 `status:completed`，`out.layers` 应**多出名为你传入 LakeAsset 文本（如 `湖`）的水体图层**（scene/tile）。Preview 里应在剩余空地上出现若干水面，数量大致随 `ExpectedLakes` 变化。看到水体图层即说明本层正确。

### 读回端口内容验证（像 grep 一样查某端口）

`execute` 后用 jq 把 `result.outputs` 投影到 `节点.端口`（`outputs` 按 nodeId 键控，DataTree = `[{path,items}]`）：

```bash
# 查湖泊产物 out_0；以及剩余 out_1（确认能作下一组上游）
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_LAKE>"]["out_0"][].items[0].tree.children[].name'
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_LAKE>"]["out_1"][].items[0].tree.children[].name'
```

工具通路同理对 `scene:pipeline.execute` 返回投影。预期：`out_0` 树里出现名为 LakeAsset 文本（如 `湖`）的水体子节点。

> ⚠️ **绝不要整体打印 `outputs`**（整图可达约 28MB 含全 voxel 网格）；**必须 jq 投影到具体 `nodeId.portName`**，scene 端口只取 `.[].items[0].tree.children[].name` 摘要。
