# DockPier（码头栈桥）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_dock_pier`，也可用 basename `DockPier`。

把上游场景的足迹切片为区域掩码网格，用 `dock_pier_layout` 电池生成一条**从岸边伸进水里**的栈桥（末端可选一条垂直于桥向的丁字头泊船平台），整条桥作为**单个**场景子节点建出来，末端另挂一个物件类型的装饰点位；输出与其它结构模板一致的五个固定端口。

## Point 定位与方向约定

`Point` 是期望的接岸位置，坐标约定为 `x→列、y→行`。Point 不在区域边缘时，电池会把它吸附到欧氏距离最近的 **4 邻域边界格**；距离并列时按从上到下、从左到右稳定取值。

伸出方向无需另接 `Side`：电池读取吸附点附近的陆地分布，自动推导 north / south / east / west 四向局部外法线，再让栈桥沿该方向伸向水面。Point 因此既可直接落在岸上，也可粗略放在区域内部或外部。

**结构可以越出掩码**——码头本来就该伸到水面上，只有画布边界会裁它。栈桥从吸附岸线点固定向岸内压入 **4 格**，覆盖锯齿海滩边缘，避免桥面与陆地之间露水缝；`Length` 仍只计算从岸线向水面伸出的长度。

> 岸边水面不足 `Length` 格时，桥会顶到画布边缘被截短。要么缩短 `Length`，要么让上游区域离画布边界远一些。

## 五个固定输出端口（结构契约）

| 方向 | portName | 语义 |
|---|---|---|
| OUT | `out_0` | Scene 完整场景（输入 + 栈桥子树 + `decor` 装饰点位） |
| OUT | `out_1` | Pier 栈桥子树（主产物，单个 `pier` 子节点，桥身与端头泊船平台已合并在同一层） |
| OUT | `out_2` | Rest 剩余空地（掩码减去栈桥落在陆地上那部分） |
| OUT | `out_3` | PierPath 栈桥子节点路径 |
| OUT | `out_4` | RestPath 剩余子节点路径 |

## 主要可见输入端口

| portName | 语义 |
|---|---|
| `in_0` | Scene 上游场景（**必接**） |
| `in_1` | AssetName 桥面资产名（需要 autotile 缝合的 tile，如 `bridge_25`） |
| `in_2` | Point 期望接岸位置（**必接**）；不在边缘时自动吸附到最近边界格，并推导局部外法线 |
| `in_3` | Width 栈桥宽度（垂直于伸出方向，居中放置）；默认 `2` |
| `in_4` | Length 栈桥从岸接线算起的长度；默认 `6` |
| `in_5` | CapSize 端头泊船平台沿**垂直于桥向**的长度：把最外侧 `min(Width, Length)` 格加宽成一条横条，总长仍是 `Length`。需大于 `Width` 才有效果，`0` 或 ≤ `Width`=纯直栈桥；默认 `0` |
| `in_6` | DecorAsset 末端装饰点位（灯柱 / 系船桩）的物件资产名；留空则该节点不绑资产、不渲染 |
| `in_7` | Z 栈桥与装饰点位所在的单层体素高度；默认 `0`，设为 `1` 即整体抬高一层 |

> `fillValue / SliceZ / schema / token` 等管线参数默认隐藏（`in_8`..`in_11`）。

`Z` 内部会转成单值 `zRange=[Z]` 接到栈桥与装饰点的 `grid2node`，因此 `Z=1` 只生成 z=1，不会生成 z=0..1 的实心柱。Rest 仍保持在默认地面层。

## 内部管线

`scene_passthrough → node_explode → rect_grid → voxel_slice`（取顶层切片做掩码）→ `dock_pier_layout` → **一个** `grid2node`（固定命名 `pier`）→ `TileAssetName` → `add_child`；同时 `alg_region_subtract`（掩码 − 栈桥）得到 Rest 子树。装饰点位走 `decorGrid → grid2node("decor") → scene_set_attribute(asset_name) → scene_set_attribute(asset_type=asset) → add_child`。最后 `scene_merge_subtrees` 合并并 `scene_focus_path` 分别聚焦，导出五个固定端口。

### 为什么整条桥只建一个节点

preview 与导出的 autotile 邻接探测**只看体素自己那一层**（一个 scene 子节点 = 一层，见 `pickFaceSprite.ts` 的 `coordsByLayerIdx.get(cell.layerIdx)`）。所以桥身与端头泊船平台一旦被 `grid_split_by_value` 拆成两个子节点，交界处两侧会各自算作「外缘」，长出一圈本不该有的扶手。合并成单节点后邻域连通，缝边才正确。装饰点位反过来必须独立——它是 `asset_type=asset` 的物件，不参与 autotile，也就不会在桥面上盖出孤立碎片。

### 开口与栏杆

`bridge_25` 的开口块与栏杆块八邻域可能完全同形，因此 `dock_pier_layout` 直接按布局语义输出 `tagGrid` / `stateValues`，模板接入 `grid2node.stateGrid/stateValues`。

- 岸内端：整条长边开口，接陆地。
- 无丁字头：水面外端整条长边开口。
- 有丁字头：丁字头最外侧长边开口；两个短边不打标签，保留栏杆。

## 与 DockPlatform 组合

`DockPlatform.out_2`（Rest）→ `DockPier.in_0`，可在平台之外的剩余区域接一段伸向水面的栈桥，各自用不同的 `Point` 指定接岸位置。

`in_0` 悬空会导致整组静默空跑；`in_2` 未接有效 point2d 会明确报错。完整端口以 `scene:templates.get` 为准。
