# BspDistrictCluster（BSP 建筑区域簇）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_bsp_district`，也可用 basename `BspDistrictCluster`。
> 内部 1 个嵌套子组（TileAssetName）。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

在上游剩余空地上，**围绕一个采样点（Point）**用 `bsp_rect_gen` 电池向外播撒一簇紧凑的 BSP 矩形建筑地块（数量由 RectCount 控制），每个矩形拆成独立子节点（district）；没被占用的地作为 Rest 继续往下传。

与 `Regions`（按方位+面积配额切不规则分区）/`ZoneNesting`（单块有机侵蚀）不同，本模板按**点位锚定 + BSP 矩形分割**生成规则的矩形建筑簇，适合城镇建筑基座、街区地块等需要矩形地块的功能区。

**典型位置：结构/分区层**。通常接在 `PathConnection*.out_2`（Rest；`out_1` 是 Path 本身）或上一个结构组的 Rest 之后。

内部数据流：`scene → node_explode → rect_grid + voxel_slice`（取占用区 grid）`→ bsp_rect_gen`（点锚 BSP 矩形簇）`→ grid_split_by_value → grid2node → add_child`；Rest = `区域求差(占用区 − 地块簇)`。

## 输入端口（IN）

| portName | portType | 语义 | 是否必接 | 怎么喂 |
|---|---|---|---|---|
| `in_0` | scene | 上游场景 / 剩余空地 | **必接** | `PathConnection*.out_2`（Rest；不是 `out_1`）或上一组 Rest → `in_0` |
| `in_1` | string | DistrictAsset 地块名（=节点名 + 资产名） | 建议接 | `text_panel.output` → `in_1` |
| `in_2` | number | Seed 随机种子 | 建议接 | `seed_control.seed` → `in_2` |
| `in_3` | point2d | Point 播撒中心点（簇围绕此点聚集） | **必接** | 上游散点/参考点 → `in_3` |
| `in_4` | number | RectCount 目标矩形数量 | 建议接 | `number_const.value` → `in_4` |
| `in_5` | number | MinSize 矩形最小宽高（默认 4） | 可选 | `number_const.value` → `in_5` |
| `in_6` | number | MaxSize 矩形最大宽高（默认 12，0=不限） | 可选 | `number_const.value` → `in_6` |

> 隐藏高级端口：`in_7`（SplitRatio 分割随机度）、`in_8`..`in_12`（fillValue / z / schema / token / zRange）。**默认即可。**
>
> **数据格式总则**：端口值是 **DataTree** = `[{path,items}]`；`portType` 决定 `items` 形态：`scene`→`{tree:{...}}`、`number`→数值、`string`→字符串、`point2d`→`{x,y}`、`grid`→二维数组。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | Scene 整树汇总口（含地块簇） | `{ "label":"Scene", "portName":"out_0" }` → `appendMergeItem` |
| `out_1` | scene | **Rest** 剩余空地 | → 下一组 `in_0`（链式） |
| `out_2` | scene | **District** 地块簇本体 | 一般不接 |
| `out_3` | string | DistrictPath（路径句柄） | 一般不接 |
| `out_4` | string | RestPath（剩余路径句柄） | 一般不接 |

## 推荐参数

- **Point（`in_3`）**：簇的中心锚点，`{x,y}`（x→列, y→行）；矩形从该点由近到远依次分配，超出区域会裁剪到边界内。
- **RectCount（`in_4`）**：期望矩形数量；区域过小时实际数量可能更少。
- **MinSize / MaxSize（`in_5`/`in_6`）**：控制单个地块尺寸范围。
- **Seed（`in_2`）**：接全局 `seed_control.seed` 保证可复现；改 seed 换一套分割形态。

## 使用场合

- 需要**点位锚定的矩形建筑簇**（城镇建筑基座、街区地块、营地等）。
- 接在任意"产出 Rest 空地"的组之后；链式：`out_1`（Rest）继续给下一层。
- 需要**按方位+面积比例划分**用 `Regions`；要**单块有机轮廓**用 `ZoneNesting`。

## 验证要点

`pipeline.execute` 应 `status:completed`，`out.layers` 多出名为 DistrictAsset 的地块图层，截图中其内部应为围绕 Point 聚集的一簇矩形地块。
