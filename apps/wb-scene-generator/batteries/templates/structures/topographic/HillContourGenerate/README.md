# HillContourGenerate（小山包等高线）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_hill_contour_generate`，也可用 basename `HillContourGenerate`。

把上游场景的足迹切片为掩码网格，用 `hill_contour_generate` 电池生成圆润的小山包同心等高线（多层多值网格），按值拆分后逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 山包子树） |
| OUT | `out_1` | Hill 山包子树（主产物，多层等高带） |
| OUT | `out_2` | Rest 剩余空地（掩码减去山包覆盖） |
| OUT | `out_3` | HillPath 山包子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | ContourLevels 等高线层数 |
| `in_4` | HillCount 山头数量 |
| `in_5` | Roundness 圆度（0~1） |
| `in_6` | PeakRadius 山包半径（0~1） |
| `in_7` | NoiseAmount 边缘扰动量 |
| `in_8` | PeakPosition 山头位置（九宫格 1-9，悬空随机） |

> 形态学清理参数 `MinHoleSize` / `MinIslandSize` 默认隐藏，按需在组内恢复。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做掩码）→ `hill_contour_generate`（多层等高线多值网格）→ `grid_split_by_value`（`grids` + `values`）→ `grid2node`（`grid`/`name`/`z←values`）→ `add_child`；同时 `alg_region_subtract`（掩码 − 山包）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

**体素 z**：`grid_split_by_value.values`（等高带键 1..N）必须接到 `grid2node.z`，否则各层节点都落在 `zRange=[0]` 平面上。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
