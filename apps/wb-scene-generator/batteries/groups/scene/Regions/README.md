# RegionZoneGenerator（区域分区地块）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_regionzone_district`，也可用 basename `RegionZoneGenerator`。
> 内部 1 个嵌套子组（TileAssetName）。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

在上游剩余空地上，用 `region_zone_generator` 电池把可用区域按区域列表（面积权重 + 九宫格方位）切成若干不重叠的不规则分区，合成为**一块多分区地块**（district）；没被占用的地作为 Rest 继续往下传。

与 `ZoneNesting`（单块有机侵蚀）/`RiverbankZone`（河岸式侵蚀）不同，本模板按**方位 + 面积配额**主动划分内部分区，适合需要规则比例、按方位布局的功能区块。

**典型位置：结构/分区层**。通常接在 `PathConnection*.out_2`（Rest；`out_1` 是 Path 本身）或上一个结构组的 Rest 之后。

内部数据流：`scene → node_explode → rect_grid + voxel_slice`（取占用区 grid）`→ region_zone_generator`（配额 Voronoi 分区）`→ grid2node → add_child`；Rest = `区域求差(占用区 − 分区)`。

## 输入端口（IN）

| portName | portType | 语义 | 是否必接 | 怎么喂 |
|---|---|---|---|---|
| `in_0` | scene | 上游场景 / 剩余空地 | **必接** | `PathConnection*.out_2`（Rest；不是 `out_1`）或上一组 Rest → `in_0` |
| `in_1` | string | DistrictAsset 地块名（=节点名 + 资产名） | 建议接 | `text_panel.output` → `in_1` |
| `in_2` | number | Seed 随机种子 | 建议接 | `seed_control.seed` → `in_2` |
| `in_3` | string | Regions 区域列表（JSON，如 `[[3,1],[2,5],[2,9]]`） | 建议接 | `text_panel.output` → `in_3` |
| `in_4` | string | BoundaryStyle 边界风格（organic/smooth/rectilinear/voronoi） | 可选 | `text_panel.output` → `in_4` |
| `in_5` | number | RelaxIterations 松弛迭代次数（默认 5） | 可选 | `number_const.value` → `in_5` |
| `in_6` | number | SmoothIterations 平滑迭代次数（默认 5） | 可选 | `number_const.value` → `in_6` |

> 隐藏高级端口：`in_7`..`in_11`（fillValue / z / schema / token / zRange）。**默认即可。**
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

- **Regions（`in_3`）**：`[[面积权重, 方位], ...]`，面积权重按比例归一化；方位 1-9（1=左上 … 5=中央 … 9=右下）。
- **BoundaryStyle（`in_4`）**：默认 `rectilinear`（类矩形）；要自然有机边界用 `organic`/`smooth`。
- **Seed（`in_2`）**：接全局 `seed_control.seed` 保证可复现；改 seed 换一套分区形态。

## 使用场合

- 需要**按比例 + 按方位划分功能区块**的地块（如森林/湖泊/城镇/荒野的规则分区）。
- 接在任意"产出 Rest 空地"的组之后；链式：`out_1`（Rest）继续给下一层。
- 需要**单块有机轮廓**用 `ZoneNesting`；要**河岸式不均匀边界**用 `RiverbankZone`。

## 验证要点

`pipeline.execute` 应 `status:completed`，`out.layers` 多出名为 DistrictAsset 的地块图层，Preview 中其内部应被切成若干按方位分布的不规则分区。
