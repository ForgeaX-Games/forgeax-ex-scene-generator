# EdgeTreeClusters（边缘树簇）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_edge_tree_clusters`，也可用 basename `EdgeTreeClusters`。
> 内部 21 个节点、1 个嵌套子组（TileAssetName）。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

在上游区域（scene）的**边缘**点缀一圈形状不规则的树簇，粘附在区域内缘。绿簇作为一个 tile 图层挂回上游 scene；同时与 `RiverbankZone` 一致，把**区域中未被绿簇占用的部分作为 Rest** 求差输出，可继续链式往下传。

内部数据流：`scene → node_explode → rect_grid + voxel_slice`（取占用区 grid）`→ edge_green_cluster`（沿边缘生簇）`→ grid2node → add_child`（绿簇挂回上游 scene）；Rest = `区域求差(占用区 − 绿簇)` → `grid2node → add_child`；两条子树经 `scene_merge_subtrees` 合并、`scene_focus_path` 各自聚焦后输出。

**典型位置：装饰层**，接在任何已成形的地块/水体之后给其边缘加绿。

## 输入端口（IN）

| portName | portType | 语义 | 是否必接 | 怎么喂 |
|---|---|---|---|---|
| `in_0` | scene | 上游区域场景（在其边缘生簇） | **必接** | 上游地块/水体 scene → `in_0` |
| `in_1` | string | DistrictAsset 绿簇图层名（=节点名 + 资产名） | 建议接 | `text_panel.output` → `in_1` |
| `in_2` | number | Seed 随机种子 | 建议接 | `seed_control.seed` → `in_2` |
| `in_3` | number | Count 簇数量（默认 12） | 建议接 | `number_const.value` → `in_3` |
| `in_4` | number | ClusterSize 簇平均大小（默认 18） | 可选 | `number_const.value` → `in_4` |
| `in_5` | number | Irregularity 形状破碎度 0~1（默认 0.6） | 可选 | `number_const.value` → `in_5` |

> 隐藏高级端口：`in_6`..`in_13`（sizeVariance / targetValue / outputValue / fillValue / z / schema / token / zRange）。**默认即可。**
>
> **数据格式总则**：端口值是 **DataTree** = `[{path,items}]`；`portType` 决定 `items` 形态。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | Scene 整树汇总口（原区域 + 边缘绿簇 + Rest） | `{ "label":"Scene", "portName":"out_0" }` → `appendMergeItem` |
| `out_1` | scene | **Rest** 区域内未被绿簇占用的剩余部分 | → 下一组 `in_0`（链式 Rest） |
| `out_2` | scene | **Clusters** 绿簇本体图层 | 一般不接 |
| `out_3` | string | ClustersPath（路径句柄） | 一般不接 |
| `out_4` | string | RestPath（剩余路径句柄） | 一般不接 |

## 推荐参数

- **Count（`in_3`）**：沿边缘的簇数量；周长大的区域可调大（20~40），小区域 6~12。
- **ClusterSize（`in_4`）/ Irregularity（`in_5`）**：簇越大越连片；破碎度越高越有触须感、越自然。
- **Seed（`in_2`）**：接全局 `seed_control.seed` 可复现；改 seed 换一套绿簇分布。

## 使用示例（applyBatch ops，可照抄）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"EdgeTreeClusters", "position":{"x":-500,"y":2600},
           "opts":{"actor":"ai:sino","label":"实例化 EdgeTreeClusters"} } }
```

```jsonc
{ "type":"createNode","nodeId":"eg_name","opId":"text_panel",  "position":{"x":-900,"y":2600},"params":{"text":"灌木"} },  // DistrictAsset
{ "type":"createNode","nodeId":"eg_cnt", "opId":"number_const","position":{"x":-900,"y":2720},"params":{"value":20} }, // Count
{ "type":"connect","edgeId":"e_eg_scene","source":{"nodeId":"<G_ZONE>","port":"out_0"},  "target":{"nodeId":"<G_EG>","port":"in_0"} },
{ "type":"connect","edgeId":"e_eg_name", "source":{"nodeId":"eg_name","port":"output"},  "target":{"nodeId":"<G_EG>","port":"in_1"} },
{ "type":"connect","edgeId":"e_eg_seed", "source":{"nodeId":"seed_main","port":"seed"},  "target":{"nodeId":"<G_EG>","port":"in_2"} },
{ "type":"connect","edgeId":"e_eg_cnt",  "source":{"nodeId":"eg_cnt","port":"value"},    "target":{"nodeId":"<G_EG>","port":"in_3"} },
{ "type":"connect","edgeId":"e_eg_out0", "source":{"nodeId":"<G_EG>","port":"out_0"},    "target":{"nodeId":"merge_all","port":"item_N"} }
```

## 使用场合

- 给已成形的**地块 / 水体 / 广场**边缘加自然树簇。
- 需要把"绿簇之外的剩余区域"继续往下处理时，用 `out_1`（Rest）链式接下一组 `in_0`。

## 验证要点

`pipeline.execute` 应 `status:completed`，`out.layers` 多出名为 DistrictAsset（如 `灌木`）的图层，Preview 中其像素应成团粘附在原区域内缘、形状不规则、数量约等于 Count。
