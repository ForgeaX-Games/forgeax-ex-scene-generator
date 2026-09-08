# IndoorTextureGround（室内纹理地面）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_indoor_texture_ground`，也可用 basename `IndoorTextureGround`。

把上游场景的楼层足迹切片为掩码网格，用 `indoor_texture` 电池生成室内地板纹理分布（多值网格），按值拆分后逐张建为命名场景子节点；输出与其它装饰结构一致的五个固定端口。

## 五个固定输出端口（装饰结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 纹理子树） |
| OUT | `out_1` | Texture 纹理子树（主产物） |
| OUT | `out_2` | Rest 剩余空地（掩码减去纹理覆盖） |
| OUT | `out_3` | TexturePath 纹理子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 纹理资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | Algorithm 纹理算法（nature / water / smooth / mixed） |

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做掩码）→ `indoor_texture`（多值纹理网格）→ `grid_split_by_value` → `grid2node`（按 `AssetName` 命名，挂 `asset_type=tile`）→ `add_child`；同时 `alg_region_subtract`（掩码 − 纹理）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

`in_0` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。
