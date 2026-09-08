# ZoneNesting（区域嵌套地块）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_zonenesting_district`，也可用 basename `ZoneNesting`。
> 内部 22 个节点、1 个嵌套子组（TileAssetName）。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

在**上游剩余空地上侵蚀出一块有机嵌套地块**（district）：消费一块上游空间，用 `zone_nesting`（多层侵蚀 + 闭合样条平滑）把可用区域退格成自然有机轮廓的地块，剩下没被占用的地作为 Rest 继续往下传。

**典型位置：结构/分区层**。通常接在 `PathConnection*.out_2`（Rest/非道路区域；`out_1` 是 Path 本身）或上一个结构组的 Rest 之后。

内部数据流：`scene → node_explode → rect_grid + voxel_slice`（取占用区 grid）`→ zone_nesting`（侵蚀+样条）`→ grid2node`（转场景节点）`→ add_child`（挂回上游 scene）；Rest = `区域求差(占用区 − 地块)`。

## 输入端口（IN）

| portName | portType | 语义 | 是否必接 | 怎么喂（来源电池 → 本端口） |
|---|---|---|---|---|
| `in_0` | scene | 上游场景 / 剩余空地 | **必接** | `PathConnection*.out_2`（Rest；不是 `out_1`）或上一组 Rest → `in_0` |
| `in_1` | string | DistrictAsset 地块名（=场景节点名 + 资产名） | 建议接 | `text_panel.output` → `in_1` |
| `in_2` | number | Seed 随机种子 | 建议接 | `seed_control.seed` → `in_2` |
| `in_3` | number | ErosionStrength 退格程度（>1 按 0~100，默认 20） | 建议接 | `number_const.value` → `in_3` |
| `in_4` | number | Layers 侵蚀层数（默认 12） | 可选 | `number_const.value` → `in_4` |
| `in_5` | number | SplineSmoothness 样条平滑强度（1~20，默认 5） | 可选 | `number_const.value` → `in_5` |

> 隐藏高级端口：`in_6`..`in_14`（targetValue / algorithm / splineAlgorithm / splineSeed / fillValue / z / schema / token / zRange）。**默认即可，日常不接。**
>
> **数据格式总则**：端口值是 **DataTree** = `[{path,items}]`；`portType` 决定 `items` 形态：`scene`→`{tree:{name,children,...}}`、`number`→数值、`string`→字符串、`grid`→二维数组。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | Scene 整树汇总口（含地块） | `{ "label":"Scene", "portName":"out_0" }` → `appendMergeItem` |
| `out_1` | scene | **Rest** 剩余空地 | → 下一组 `in_0`（链式 Rest） |
| `out_2` | scene | **District** 地块本体 | 一般不接（out_0 已是主产物） |
| `out_3` | string | DistrictPath（路径句柄） | 一般不接 |
| `out_4` | string | RestPath（剩余路径句柄） | 一般不接 |

## 推荐参数与设置考虑要素

- **DistrictAsset（`in_1`）**：地块名，同时作为渲染出来的图层名与资产名（`asset_type=tile`）。按语义命名，如 `"广场"` / `"plaza"` / `"district"`。
- **Seed（`in_2`）**：接全局 `seed_control.seed` 保证可复现；改 seed 换一套地块形状。
- **ErosionStrength（`in_3`）**：退格程度，越大地块越往内缩、轮廓越破碎。点缀小地块 `30~50`；保留大块 `10~20`。
- **Layers（`in_4`）/ SplineSmoothness（`in_5`）**：默认即可；样条强度越大边界越圆滑。

## 使用示例（applyBatch ops，可照抄）

前置：链路里已有上游剩余场景（如 `<G_PATH>.out_1`）。先实例化拿回 `<G_ZONE>`：

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"ZoneNesting", "position":{"x":-500,"y":1800},
           "opts":{"actor":"ai:sino","label":"实例化 ZoneNesting"} } }
```

把返回 groupId 替换进 `<G_ZONE>`，提交 applyBatch（`<UPSTREAM_REST>` 改成实际上游，如 `<G_PATH>.out_1`）：

```jsonc
{ "type":"createNode","nodeId":"zn_name", "opId":"text_panel",  "position":{"x":-900,"y":1800},"params":{"text":"广场"} },  // DistrictAsset
{ "type":"createNode","nodeId":"zn_erode","opId":"number_const","position":{"x":-900,"y":1920},"params":{"value":35} },  // ErosionStrength
{ "type":"connect","edgeId":"e_zn_scene","source":{"nodeId":"<G_PATH>","port":"out_1"},   "target":{"nodeId":"<G_ZONE>","port":"in_0"} },
{ "type":"connect","edgeId":"e_zn_name", "source":{"nodeId":"zn_name","port":"output"},   "target":{"nodeId":"<G_ZONE>","port":"in_1"} },
{ "type":"connect","edgeId":"e_zn_seed", "source":{"nodeId":"seed_main","port":"seed"},   "target":{"nodeId":"<G_ZONE>","port":"in_2"} },
{ "type":"connect","edgeId":"e_zn_ero",  "source":{"nodeId":"zn_erode","port":"value"},   "target":{"nodeId":"<G_ZONE>","port":"in_3"} },
{ "type":"connect","edgeId":"e_zn_out0", "source":{"nodeId":"<G_ZONE>","port":"out_0"},   "target":{"nodeId":"merge_all","port":"item_N"} }  // 换未占用 item 口
```

> 后续组的链式起点用 `<G_ZONE>.out_1`（Rest）接到下一组 `in_0`。

## 使用场合

- 需要**有机轮廓地块 / 自然分区**的场景（广场、营地、聚落区、不规则地坪）。
- 接在任意"产出 Rest 空地"的组之后（道路 Non-Path / 上一个结构组 Rest）。
- 链式：`out_1`（Rest）继续给下一层。
- **不该用的情况**：需要规则矩形分区时用 `bsp_rect_gen` / `region_zone_generator` 等。

## 验证要点

`pipeline.get` 核对 `<G_ZONE>` 的 `in_0`（上游）、`in_1`/`in_2`/`in_3` 真的接上，`out_0` 进了汇总。

`pipeline.execute` 应 `status:completed`，`out.layers` 应**多出名为你传入 DistrictAsset 文本（如 `广场`）的地块图层**。Preview 里应在剩余空地上出现一块有机轮廓的地块。

### 读回端口内容验证（像 grep 一样查某端口）

```bash
# 查地块产物 out_0；以及剩余 out_1（确认能作下一组上游）
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_ZONE>"]["out_0"][].items[0].tree.children[].name'
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_ZONE>"]["out_1"][].items[0].tree.children[].name'
```

> ⚠️ **绝不要整体打印 `outputs`**；**必须 jq 投影到具体 `nodeId.portName`**，scene 端口只取 `.[].items[0].tree.children[].name` 摘要。
