# PointZoneGen（点生区域）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_point_zone_gen`，也可用 basename `PointZoneGen`。

把上游场景的足迹切片为基准掩码网格，用 `point_zone_gen` 电池从给定点位按目标面积生长出多块有机区域（多值网格），按值拆分后逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 区域子树） |
| OUT | `out_1` | Zone 区域子树（主产物） |
| OUT | `out_2` | Rest 剩余空地（掩码减去区域覆盖） |
| OUT | `out_3` | ZonePath 区域子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | Regions 区域定义（JSON，每项 `[x, y, area, height]`，**必填否则无产物**） |

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做基准）→ `point_zone_gen`（多值区域网格）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（基准 − 区域）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）；`Regions` 为空（`[]`）则不生成任何区域。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
