# MountainContourGenerate（等高线山头生成）

> templateId：`group_mountain_contour_generate`，basename `MountainContourGenerate`。

在上游场景足迹内，用 **scenealg** 链 `alg_field_mountain_contour` → `alg_partition_field_quantize` 生成山地高度场并按整数层截断为互斥分区，逐层挂 `TileAssetName` 建子树；输出五件套固定端口。

> **⛰️ 使用时机**：当前**无坡道/台阶**。**先**完成建筑 + **`PathConnection` 道路连通**，**再**在剩余区域（Rest）上添加高差以体现层次。**`MaxElevationLayers` 建议不超过 `2`**（`0`=不加高差，`1~2`=轻度层次）。

## 五个固定输出端口

> 连线一律用 **`portName`**（与模板公开端口契约一致；customLabelEn 仅作语义标签）。

| portName | customLabelEn | 语义 |
|---|---|---|
| `out_0` | Scene | 完整场景 |
| `out_2` | Mountain | 山头/等高层子树（**主产物**） |
| `out_1` | Rest | 剩余（掩码 − 全部高度层覆盖） |
| `out_3` | MountainPath | 主产物路径 |
| `out_4` | RestPath | 剩余路径 |

## 主要可见输入

| portName | 语义 |
|---|---|
| `in_0` | Scene **必接** |
| `in_1` | AssetName 统一 tile 资产名 |
| `in_2` | Seed 随机种子 |
| `in_3` | MaxElevationLayers 最高抬升层数（**建议 ≤2**；0=不加高差） |
| `in_4` | PeakCount 山头数量 |
| `in_5` | PeakRadius 山头半径 |
| `in_6` | PeakStrength 山头强度 |
| `in_7` | NoiseScale 噪声频率 |
| `in_8` | WarpStrength 域扭曲强度 |
| `in_9` | NamePrefix 各层节点名前缀（默认 `Contour`，生成 Contour1…） |

## 内部管线（③ 段 scenealg）

```
scene → explode → rect_grid → voxel_slice（region）
  → alg_field_mountain_contour（[0,1] 高度场）
  → alg_partition_field_quantize（partition[] + levelGrid）
  → MultiNames(LayerIndices + Names) → grid2node(grid, name, z)
  → TileAssetName(AssetName) → add_child
  → alg_region_union_all(partition) → subtract → Rest
```

**体素 z（高差）**：`alg_partition_field_quantize` 给出的是互斥 2D 分区（每层 footprint 不重叠）。必须把 `MultiNames.out_0`（LayerIndices：`0..N-1`）接到轮廓 `grid2node.z`；`grid2node` 按 `[0..z]` 实心柱写体素。只接 `name`/`grid`、不接 `z`/`zRange` 时默认 `zRange=[0]`，各 Contour 节点会叠在同一平面——看起来像「有多层节点却没有高差」。

**区域形状**：高度场只在 `in_0` focus 的 footprint 内生成。若把本模板接在 `AreaPartition` 硬切半区上，分界处会像「矩形里算完再截断」。更合理的接法：整岛 / `DistanceZones.out_2`(Far 内陆) 等**有机边界**区域；`alg_field_mountain_contour` 默认带边缘衰减（`edgeFalloffCells`），从外缘向内平滑抬升。

`in_0` 悬空会静默空跑。算法核心源自 `scene30/mountain/mountain_contour_generate`，已拆为 scenealg 原子电池。

> 已实例化的旧项目组不会自动获得这条边；需重实例化模板，或手动把 MultiNames `out_0` → contour `grid2node.z`。
