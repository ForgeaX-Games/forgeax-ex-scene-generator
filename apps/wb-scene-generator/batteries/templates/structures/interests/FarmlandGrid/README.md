# FarmlandGrid（农田生成）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_farmland_grid`，也可用 basename `FarmlandGrid`。

把上游场景的足迹切片为可用区域掩码网格，用 `farmland_grid` 电池生成农田分区布局（规则网格 / 条带 / BSP 自由划分，含田垄/田地/作物点位多值网格），按值拆分后逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 农田子树） |
| OUT | `out_1` | Farmland 农田子树（主产物，1=田垄/2=田地/3-6=作物点位） |
| OUT | `out_2` | Rest 剩余空地（掩码减去农田覆盖） |
| OUT | `out_3` | FarmlandPath 农田子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子（bsp 模式） |
| `in_3` | Layout 布局形式（grid / strip / bsp） |
| `in_4` | PlotWidth 地块宽度（grid / bsp 模式） |
| `in_5` | PlotHeight 地块高度 |
| `in_6` | PathWidth 小径宽度 |
| `in_7` | PlantDensity 植物密度（0~1） |

> `fillValue / z / schema / token / zRange` 等管线参数默认隐藏。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做掩码）→ `farmland_grid`（多值农田网格）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（掩码 − 农田）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
