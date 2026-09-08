# RiverbankZone（河岸侵蚀地块）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_riverbank_district`，也可用 basename `RiverbankZone`。
> 内部 22 个节点、1 个嵌套子组（TileAssetName）。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

与 `ZoneNesting`（均匀偏移内缩）不同，本模板用 `zone_nesting_riverbank` 电池在上游剩余空地上侵蚀出**内边界深浅不一、忽宽忽窄的河岸式地块**：噪声高处深切（宽湾），低处浅切（窄岸），形成极不均匀的自然腐蚀边界。剩余空地作为 Rest 继续往下传。

**典型位置：结构/分区层**。通常接在 `PathConnection*.out_2`（Rest；`out_1` 是 Path 本身）或上一个结构组的 Rest 之后。

内部数据流：`scene → node_explode → rect_grid + voxel_slice`（取占用区 grid）`→ zone_nesting_riverbank`（变深度侵蚀+样条）`→ grid2node → add_child`；Rest = `区域求差(占用区 − 地块)`。

## 输入端口（IN）

| portName | portType | 语义 | 是否必接 | 怎么喂 |
|---|---|---|---|---|
| `in_0` | scene | 上游场景 / 剩余空地 | **必接** | `PathConnection*.out_2`（Rest；不是 `out_1`）或上一组 Rest → `in_0` |
| `in_1` | string | DistrictAsset 地块名（=节点名 + 资产名） | 建议接 | `text_panel.output` → `in_1` |
| `in_2` | number | Seed 随机种子 | 建议接 | `seed_control.seed` → `in_2` |
| `in_3` | number | ErosionStrength 平均侵蚀强度（默认 54，>1 按 0~100） | 建议接 | `number_const.value` → `in_3` |
| `in_4` | number | Waviness 边界波动幅度（0≈均匀，越大越忽宽忽窄，推荐 0.5~1.2） | 建议接 | `number_const.value` → `in_4` |
| `in_5` | number | MaxDepth 最大侵蚀深度（格数，默认 16） | 可选 | `number_const.value` → `in_5` |

> 隐藏高级端口：`in_6`..`in_15`（featureScale / targetValue / splineAlgorithm / splineSmoothness / splineSeed / fillValue / z / schema / token / zRange）。**默认即可。**
>
> **数据格式总则**：端口值是 **DataTree** = `[{path,items}]`；`portType` 决定 `items` 形态：`scene`→`{tree:{...}}`、`number`→数值、`string`→字符串、`grid`→二维数组。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | Scene 整树汇总口（含地块） | `{ "label":"Scene", "portName":"out_0" }` → `appendMergeItem` |
| `out_1` | scene | **Rest** 剩余空地 | → 下一组 `in_0`（链式） |
| `out_2` | scene | **District** 地块本体 | 一般不接 |
| `out_3` | string | DistrictPath（路径句柄） | 一般不接 |
| `out_4` | string | RestPath（剩余路径句柄） | 一般不接 |

## 推荐参数

- **ErosionStrength（`in_3`）**：平均退入深度比例，默认 `54`。越大整体咬入越深。
- **Waviness（`in_4`）**：起伏幅度，`0` 接近均匀偏移；`0.8~1.2` 得到夸张的海湾/半岛。
- **MaxDepth（`in_5`）**：最深咬入格数；与 Waviness 一起放大可获得撕裂感更强的河岸。
- **Seed（`in_2`）**：接全局 `seed_control.seed` 保证可复现；改 seed 换一套河岸形态。

## 使用示例（applyBatch ops，可照抄）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"RiverbankZone", "position":{"x":-500,"y":2200},
           "opts":{"actor":"ai:sino","label":"实例化 RiverbankZone"} } }
```

```jsonc
{ "type":"createNode","nodeId":"rb_name", "opId":"text_panel",  "position":{"x":-900,"y":2200},"params":{"text":"湿地"} },  // DistrictAsset
{ "type":"createNode","nodeId":"rb_wavy", "opId":"number_const","position":{"x":-900,"y":2320},"params":{"value":1.0} }, // Waviness
{ "type":"connect","edgeId":"e_rb_scene","source":{"nodeId":"<G_PATH>","port":"out_1"}, "target":{"nodeId":"<G_RB>","port":"in_0"} },
{ "type":"connect","edgeId":"e_rb_name", "source":{"nodeId":"rb_name","port":"output"},"target":{"nodeId":"<G_RB>","port":"in_1"} },
{ "type":"connect","edgeId":"e_rb_seed", "source":{"nodeId":"seed_main","port":"seed"},"target":{"nodeId":"<G_RB>","port":"in_2"} },
{ "type":"connect","edgeId":"e_rb_wavy", "source":{"nodeId":"rb_wavy","port":"value"}, "target":{"nodeId":"<G_RB>","port":"in_4"} },
{ "type":"connect","edgeId":"e_rb_out0", "source":{"nodeId":"<G_RB>","port":"out_0"}, "target":{"nodeId":"merge_all","port":"item_N"} }
```

> 后续组的链式起点用 `<G_RB>.out_1`（Rest）接到下一组 `in_0`。

## 使用场合

- 需要**河岸 / 湖岸 / 不规则海湾边界**的自然地块（湿地、滩涂、水陆交界、破碎海岸）。
- 想要比 `ZoneNesting` 更夸张、更不均匀的有机边界时优先选本模板。
- 需要规则边界时用 `bsp_rect_gen` / `region_zone_generator`；要均匀内缩用 `ZoneNesting`。

## 验证要点

`pipeline.execute` 应 `status:completed`，`out.layers` 多出名为 DistrictAsset（如 `湿地`）的地块图层，Preview 中其内边界应明显忽宽忽窄、深浅起伏（河岸感），而非平行内缩。
