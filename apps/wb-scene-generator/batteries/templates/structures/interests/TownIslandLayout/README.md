# TownIslandLayout（城镇岛状布局）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_town_island_layout`，也可用 basename `TownIslandLayout`。

把上游场景的足迹切片为掩码网格，用 `town_island_layout` 电池以 BSP 棋盘格道路 + 岛状轮廓裁剪生成城镇布局（道路 + 各地块多值网格），按值拆分后逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 城镇子树） |
| OUT | `out_1` | Town 城镇子树（主产物，道路 + 地块） |
| OUT | `out_2` | Rest 剩余空地（掩码减去城镇覆盖） |
| OUT | `out_3` | TownPath 城镇子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | RoadWidth 道路宽度 |
| `in_4` | BlockMinSize 块最小尺寸 |
| `in_5` | ShapeType 岛型形状（circle / ellipse / organic） |
| `in_6` | ShapeScale 岛型比例（0.2~0.9） |
| `in_7` | CoverageThreshold 覆盖率阈值（0~1） |

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做掩码）→ `town_island_layout`（道路+地块多值网格）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（掩码 − 城镇）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
