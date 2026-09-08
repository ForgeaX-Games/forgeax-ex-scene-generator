# DistanceZones · 距离分带模板

按到边界的**距离场**，把一个已存在的区域节点（如海洋、岛屿）二分为**近处**和**远处**两块子区域，并作为两个子节点挂回场景树。

## 基本介绍

- 输入一棵 focus 指向某个**区域节点**的 scene，模板取该节点自身的占位掩码作为待划分区域。
- 内部用 `alg_field_inner_distance` 计算该区域到「内部 0 边界」（默认）或「外缘边界」（`IncludeOuterBoundary=true`）的距离场，再用 `alg_field_threshold` 以 `Threshold` 为界切成 `near`(近) / `far`(远) 两块。
- 两块分别落成体素节点、写好 `asset_name`，作为 focus 节点的两个子节点挂入；近、远并集恰好等于原区域。
- 与其它场景模板一致，输出「五件套」：完整 scene + 两个产物子树 + 两个产物路径字符串。

## 两种典型用法（对称）

| 场景 | 输入区域 | `IncludeOuterBoundary` | `Near`（近） | `Far`（远） |
| --- | --- | --- | --- | --- |
| 海洋分深浅 | 海洋节点（内部含岛屿洞） | `false`（默认） | 浅海（靠岛岸） | 深海（远离任何岛） |
| 岛屿分海岸 | 岛屿 / 实心陆地节点 | `true` | 海岸线（靠外缘） | 内陆（区域深处） |

> 实心区域（无内部洞）若用默认 `false`，将没有任何距离源，整片归入 `Far`。这类区域请把 `IncludeOuterBoundary` 接一个值为 `true` 的「布尔」(`toggle`) 常量。

## 输入端口

| 端口 | 标签 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `in_0` | Scene | `scene` | 是 | focus 指向待划分区域节点的场景 |
| `in_1` | Threshold | `number` | 是 | 近/远分界距离（含界归入近）。raw 距离用整数（格数）；若开归一化用 `[0,1]` 小数 |
| `in_2` | IncludeOuterBoundary | `bool` | 否 | 是否把区域外缘也作为距离源。默认 `false`（海洋模式）；岛屿模式接 `true` |
| `in_3` | NearName | `string` | 否 | 近处子节点名（默认见 `grid2node`） |
| `in_4` | NearAsset | `string` | 否 | 近处区域的 `asset_name` 资产标识 |
| `in_5` | FarName | `string` | 否 | 远处子节点名 |
| `in_6` | FarAsset | `string` | 否 | 远处区域的 `asset_name` 资产标识 |

隐藏高级输入：`connectivity`(4/8)、`normalize`、`voxel z`、`rect fillValue`、近/远节点的 `schema`/`token`/`zRange`。

## 输出端口

| 端口 | 标签 | 类型 | 说明 |
| --- | --- | --- | --- |
| `out_0` | Scene | `scene` | 挂入近、远两个子节点后的完整场景（focus 不变） |
| `out_1` | Near | `scene` | focus 指向「近处」子节点的场景，可继续接下游模板细化 |
| `out_2` | Far | `scene` | focus 指向「远处」子节点的场景 |
| `out_3` | NearPath | `string` | 近处子节点的绝对路径 |
| `out_4` | FarPath | `string` | 远处子节点的绝对路径 |

## 内部流程（6 段范式）

1. **输入归一**：`scene_passthrough` 接入，`node_explode` 取 focus 节点的 bbox 与体素。
2. **取区域掩码**：`rect_grid`(填 1) + `voxel_slice` → 得到该节点自身的占位掩码 `slice`。
3. **算法**：`alg_field_inner_distance`(region=slice) → 距离场 → `alg_field_threshold`(field, region=slice, threshold) → `near` / `far`。
4. **网格转节点 + 赋属性**：`near`/`far` 各经 `grid2node` 落成节点，再经内嵌组 `NearAssetName`/`FarAssetName`（`scene_set_attribute` 写 `asset_name` / `asset_type=tile`）。
5. **产物拆分**：两个 `add_child` 依次把近、远节点挂到 focus 节点下，`scene_merge_subtrees` 汇总。
6. **标准输出**：两路 `scene_focus_path` 分别 focus 近/远节点 → `scene_passthrough` 出 `Scene/Near/Far`，两个 `type_string` 出 `NearPath/FarPath`。

## 校验要点

- 输入 scene 的 focus 必须落在一个**已存在且占位非空**的区域节点上。
- 海洋分深浅保持 `IncludeOuterBoundary=false`；岛屿/陆地分海岸线务必置 `true`，否则 `Near` 为空。
- `Threshold` 单位与距离场一致：未归一化时为「格数」，归一化后为 `[0,1]`。
