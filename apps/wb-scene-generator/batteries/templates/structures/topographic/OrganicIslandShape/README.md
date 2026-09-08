# OrganicIslandShape（有机海岸轮廓）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_organic_island_shape`，也可用 basename `OrganicIslandShape`。

把上游场景的足迹切片为掩码网格，用 `organic_island_shape` 电池以柏林噪声+距离场重塑为有机岛屿轮廓（地面/浅水/中水/深水四层多值网格），按值拆分后逐张建为命名场景子节点；输出与其它结构模板一致的五个固定端口。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 岛屿子树） |
| OUT | `out_1` | Island 岛屿子树（主产物，含四层） |
| OUT | `out_2` | Rest 剩余空地（掩码减去岛屿覆盖） |
| OUT | `out_3` | IslandPath 岛屿子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | NoiseScale 噪声频率（建议 1~6） |
| `in_4` | NoiseStrength 噪声强度（建议 0.1~0.5） |
| `in_5` | IslandRatio 岛屿覆盖率（0.2~0.75） |
| `in_6` | Octaves 噪声层数（2~5） |

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做掩码）→ `organic_island_shape`（多值岛屿网格）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（掩码 − 岛屿）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
