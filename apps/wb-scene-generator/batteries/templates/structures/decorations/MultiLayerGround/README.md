# MultiLayerGround（多层地面）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_multi_layer_ground`，也可用 basename `MultiLayerGround`。

把上游场景的足迹切片为基准掩码网格，用 `multi_layer_ground` 电池在目标区域生成多层 Perlin 噪声地面（多值网格），按值拆分后逐张建为命名场景子节点；输出与其它装饰结构一致的五个固定端口。

## 五个固定输出端口（装饰结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 地面子树） |
| OUT | `out_1` | Ground 地面子树（主产物） |
| OUT | `out_2` | Rest 剩余空地（掩码减去地面覆盖） |
| OUT | `out_3` | GroundPath 地面子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 地面资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | LayerCount 地面层数 |
| `in_4` | Threshold 二值化过滤值 |
| `in_5` | Frequency 噪声频率 |
| `in_6` | Octaves 噪声倍频 |

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做掩码）→ `multi_layer_ground`（多层多值地面网格）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（掩码 − 地面）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
