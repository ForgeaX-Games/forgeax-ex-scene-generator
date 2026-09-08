# PlaceMultipleDecorations（批量精准装饰 · 场景版）

> 原名 `PoiPlace`。templateId：`group_1782200000003_poipl`，也可用 basename `PlaceMultipleDecorations`。

把 `poi_place` 电池封装为 scene 流水线：输入 Scene（上游空地/Rest），在其底面区域内按坐标精准放置多处装饰/兴趣点（坐标不在目标格则 BFS 就近吸附），挂回场景树并产出标准五件套。

## 内部算法链（固定操作）

```
Scene → scene_passthrough → node_explode → rect_grid → voxel_slice(region)
  → poi_place(inputGrid=region)                   # 按坐标精准落位（单张多值网格）
  → alg_field2points(threshold=0.5)               # 多值网格 → 逐点单点网格列表（DataTree）
  → grid2node ×N + MultiNames + ObjectAssetName   # 每个点各自挂成子节点、写资产名
    └ zRange = [voxel_slice.z + 1]                # 落在地面之上一层
  → alg_region_subtract(region, poi) → grid2node(rest)   # 剩余空地
  → 标准五件套输出
```

装饰层有两条与 Asset 视图强绑定的约束：

- **逐点成节点。** `out_1`(Poi) 下是 **N 个 1×1 子节点** `poi0…poi(N-1)`，而不是一个占 N 格的节点。
- **落在地面之上一层。** `grid2node.zRange` 显式接 `[voxel_slice.z + 1]`，避免 object 贴图下半截被地面立面盖掉。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_0` | Scene 上游可放置区域（**必接**） |
| IN | `in_1` | AssetName 装饰资产名（写入场景节点 asset_name） |
| IN | `in_2` | PoiRules 规则（含坐标；`string`，可接 Panel） |
| IN | `in_3` | MinDistance 最小间距 |
| IN | `in_4` | ScatterR 散播半径 |
| IN | `in_5` | Seed 随机种子 |
| OUT | `out_0` | Scene 整树 |
| OUT | `out_1` | Poi 装饰层（主产物） |
| OUT | `out_2` | Rest 剩余空地 |
| OUT | `out_3` | PoiPath 装饰层路径句柄 |
| OUT | `out_4` | RestPath 剩余空地路径句柄 |

`in_0` 悬空会导致整组静默空跑。多实例串联：`out_2`(Rest) → 下一实例 `in_0`(Scene)。

## PoiRules 格式

标准格式（Panel 直接写 JSON 文本即可）：

```text
[["浮萍",1,[8,6],[24,10]],["水草",1,[12,14],[20,6]]]
```

每条规则：`[名称, targetValue, [x,y], …]`。也兼容旧格式 `[{decoration, targetValue, points: [[x,y],…]}]`。
