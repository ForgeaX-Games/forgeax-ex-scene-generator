# RiverSpline（河流样条化）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_river_spline`，也可用 basename `RiverSpline`。

把上游场景的足迹切片为基准网格，用 `river_spline` 电池把折线控制点平滑光栅化成自然河流（叠加进基准网格），按值拆分后逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 河流子树） |
| OUT | `out_1` | River 河流子树（主产物） |
| OUT | `out_2` | Rest 剩余空地 |
| OUT | `out_3` | RiverPath 河流子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | Points 控制点 `[[col,row],...]`（**必填否则无河流**） |
| `in_4` | Algorithm 平滑算法（noise / bezier / cubic_spline / moving_avg / gaussian） |
| `in_5` | RiverWidth 河流宽度 |
| `in_6` | NumMidPoints 内部扰动点数 |
| `in_7` | OffsetMin 法线偏移最小值 |
| `in_8` | OffsetMax 法线偏移最大值 |
| `in_9` | SegmentUniformity 扰动均匀度（0~1） |

> 算法专用参数 `WindowSize`(moving_avg) / `Sigma`(gaussian) / `BezierDegree`(bezier) 默认隐藏，按需在组内恢复。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做基准）→ `river_spline`（河流叠加网格）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract` 求 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）；`Points` 为空则不生成河流。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
