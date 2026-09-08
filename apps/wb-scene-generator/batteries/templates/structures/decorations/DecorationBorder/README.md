# DecorationBorder（规则装饰物 · 场景版）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1782200000001_dbrdr`，也可用 basename `DecorationBorder`。

把 `decoration_border` 电池封装为 scene 流水线：输入 Scene（上游空地/Rest），在其底面区域周围按规则摆放 1×1 装饰物，挂回场景树并产出标准五件套。

## 内部算法链（固定操作）

```
Scene → scene_passthrough → node_explode → rect_grid → voxel_slice(region)
  → decoration_border(inputGrid=region)           # 边框规则摆放（单张多值网格）
  → alg_field2points(threshold=0.5)               # 多值网格 → 逐点单点网格列表（DataTree）
  → grid2node ×N + MultiNames + ObjectAssetName   # 每个装饰点各自挂成子节点、写资产名
    └ zRange = [voxel_slice.z + 1]                # 装饰落在地面之上一层
  → alg_region_subtract(region, decoration) → grid2node(rest)   # 剩余空地
  → 标准五件套输出
```

装饰层有两条与 Asset 视图强绑定的约束，都不是风格问题（Color 模式逐格填色，两者都看不出来）：

- **逐点成节点。** `out_1`(Decoration) 下是 **N 个 1×1 子节点** `decoration0…decoration(N-1)`，而不是一个占 N 格的节点。2D Asset 视图对 `asset_type=object` 的层**整层只画一张贴图**（`buildVoxelMaster` 按 layer 去重），装饰点合在一个节点里只会显示一个物件。
- **落在地面之上一层。** `grid2node.zRange` 默认 `[0]` 会让装饰与地面同层，object 贴图以"底面前排"为锚点，下半截会被地面立面盖掉（只看到半个物件）。因此显式接 `[voxel_slice.z + 1]`。

两条都与 `NaturalDecorationDistribution` / `LocalPreciseDecoration` 的既有做法一致。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_0` | Scene 上游可放置区域（**必接**） |
| IN | `in_1` | AssetName 装饰资产名（写入场景节点 asset_name） |
| IN | `in_2` | DecorationName 装饰物名称（电池内格值命名） |
| IN | `in_3` | Count 填充数量 |
| IN | `in_4` | FillMode 填充方式 |
| IN | `in_5` | Offset 偏移距离 |
| IN | `in_6` | Seed 随机种子 |
| IN | `in_7..9` | Rotate / StartCount / ItemSpacing（hidden 高级项） |
| OUT | `out_0` | Scene 整树 |
| OUT | `out_1` | Decoration 装饰层（主产物） |
| OUT | `out_2` | Rest 剩余空地 |
| OUT | `out_3` | DecorationPath 装饰层路径句柄 |
| OUT | `out_4` | RestPath 剩余空地路径句柄 |

`in_0` 悬空会导致整组静默空跑。多实例串联：`out_2`(Rest) → 下一实例 `in_0`(Scene)。
