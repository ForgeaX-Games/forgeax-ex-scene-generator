# DockPlatform（码头平台）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_dock_platform`，也可用 basename `DockPlatform`。

把上游场景的足迹切片为区域掩码网格，用 `dock_platform_layout` 电池生成码头平台：**引桥从岸边伸进水里，尽头接一块大甲板泊船**——就是「加了大平台的栈桥」。整片结构作为**单个**场景子节点建出来；输出与其它结构模板一致的五个固定端口。

## Point 定位与方向约定

`Point` 是期望的接岸位置，坐标约定为 `x→列、y→行`。Point 不在区域边缘时，电池会把它吸附到欧氏距离最近的 **4 邻域边界格**；距离并列时按从上到下、从左到右稳定取值。

伸出方向无需另接 `Side`：电池读取吸附点附近的陆地分布，自动推导 north / south / east / west 四向局部外法线，再让引桥沿该方向伸向水面。Point 因此既可直接落在岸上，也可粗略放在区域内部或外部。

**结构可以越出掩码**——码头本来就该伸到水面上，只有画布边界会裁它。引桥从吸附岸线点固定向岸内压入 **4 格**，覆盖锯齿海滩边缘，避免桥面与陆地之间露水缝；`Length` 仍只计算从岸线向水面伸出的长度。

沿伸出方向的总长 = `Length`（引桥）+ `DeckDepth`（甲板）。岸边水面不足时会顶到画布边缘被截短。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 平台子树） |
| OUT | `out_1` | Platform 平台子树（主产物，单个 `platform` 子节点，甲板与引桥已合并在同一层） |
| OUT | `out_2` | Rest 剩余空地（掩码减去结构落在陆地上那部分） |
| OUT | `out_3` | PlatformPath 平台子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 桥面资产名（需要 autotile 缝合的 tile，如 `bridge_25`） |
| `in_2` | Point 期望接岸位置（**必接**）；不在边缘时自动吸附到最近边界格，并推导局部外法线 |
| `in_3` | DeckWidth 尽头甲板宽度（垂直于伸出方向，与引桥共用中轴）；默认 `9` |
| `in_4` | DeckDepth 尽头甲板进深（从引桥末端继续往外铺）；默认 `5` |
| `in_5` | Width 引桥宽度（居中放置）；默认 `3` |
| `in_6` | Length 引桥从岸接线算起的长度，`0`=甲板直接贴岸；默认 `6` |
| `in_7` | Z 平台产物所在的单层体素高度；默认 `0`，设为 `1` 即把平台整体抬高一层 |

> `fillValue / SliceZ / schema / token` 等管线参数默认隐藏（`in_8`..`in_11`）。

`Z` 内部会转成单值 `zRange=[Z]` 接到平台的 `grid2node`，因此 `Z=1` 只生成 z=1，不会生成 z=0..1 的实心柱。Rest 仍保持在默认地面层。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做掩码）→ `dock_platform_layout`（多值网格：1=甲板，2=引桥，已合并成一张）→ **一个** `grid2node`（固定命名 `platform`）→ `TileAssetName` → `add_child`；同时 `alg_region_subtract`（掩码 − 结构）得到 Rest 子树。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

### 为什么整片结构只建一个节点

preview 与导出的 autotile 邻接探测**只看体素自己那一层**（一个 scene 子节点 = 一层，见 `pickFaceSprite.ts` 的 `coordsByLayerIdx.get(cell.layerIdx)`）。所以甲板与引桥一旦被 `grid_split_by_value` 拆成两个子节点，交界处两侧会各自算作「外缘」，长出一圈本不该有的扶手。合并成单节点后邻域连通，缝边才正确。

`asset_name` / `asset_type=tile` 取 `AssetName`（`in_1`）；需要甲板与引桥用不同贴图的话，只能放弃这一层的 autotile 连通性，在下游按 `out_3` 的路径重新拆分绑定。

### 开口与栏杆

`bridge_25` 的开口块与栏杆块八邻域可能完全同形，因此 `dock_platform_layout` 直接按布局语义输出 `tagGrid` / `stateValues`，模板接入 `grid2node.stateGrid/stateValues`。

- 岸内端：引桥整条长边开口，接陆地。
- 甲板最外侧长边：整条开口，供泊船通行。
- 甲板两个短边：不打标签，保留栏杆。

> 旧版的 `Entrances` / `EntranceWidth` 已删除。入口条原本是甲板边缘换个网格值，合并成单张掩码后与甲板格无法区分；且 `bridge_25` 规则里没有「侧边开口」这一类块，开口在这套规则里就等于端头，而端头由几何自动推出来，不需要手填。

## 与 DockPier 组合

`DockPlatform.out_2`（Rest）→ `DockPier.in_0`，可在平台之外的剩余区域接一段伸向水面的栈桥。

`in_0` 悬空会导致整组静默空跑；`in_2` 未接有效 point2d 会明确报错。完整端口以 `scene:templates.get` 为准。
