# AreaPartition（区域划分）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_area_partition_district`，也可用 basename `AreaPartition`。
> 内部 1 个嵌套子组（TileAssetName）。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

在**父区域**上，用 **`alg_region_area_partition`** 按 **point2d 中心点 + 面积权重** 做**纯划分**：子区域两两不重叠，且**并集铺满整个父区域**。每个子区独立挂 scene 子节点，名称与 tile 资产按列表逐区指定。

**不存在「剩余区域 / Rest」** — 算法配额 Voronoi 会分完父区域全部可用格；模板**不输出** Rest / RestPath，下游勿接不存在的 rest 节点。

**典型位置：结构/分区层**。首组通常接 `AddBaseGrid.out_1`（BaseNode）；若需对**某一子区**再划分，须把该子区 scene 子树（非 Rest）接到下一组 `in_0`。

## 输入端口（IN）

| portName | portType | access | 语义 | 是否必接 | 怎么喂 |
|---|---|---|---|---|---|
| `in_0` | scene | tree | 待划分的父区域 scene | **必接** | 首组：`AddBaseGrid.out_1`；再划分：上一组某一**子区** scene |
| `in_1` | point2d | **list** | 各子区中心 | **必接** | N×`manual_points` → `tree_merge`(`inferredAccess:"item"`) → `in_1` |
| `in_2` | number | **list** | 面积权重 | 建议接 | 与 Points 等长，如 `[3,2,1.5,1]`（相对比例，勿全等） |
| `in_3` | string | tree | 子区节点名 | 建议接 | 与 Points 等长，如 `["划分子区域1","划分子区域2",…]` |
| `in_4` | string | tree | 子区 tile 资产 | 建议接 | 与 Points 等长；填 **catalog 真实 tile 名**（示例用占位 `tile_a`） |
| `in_5` | number | tree | Seed | 建议接 | `seed_control.seed` |
| `in_6` | string | item | BoundaryStyle | **默认 organic** | `organic` / `smooth` / `voronoi` / `rectilinear` |
| `in_7` | number | item | RelaxIterations | 默认 **8** | Lloyd 松弛，推荐 6–10 |
| `in_8` | number | item | SmoothIterations | 默认 **12** | organic 边界 CA，推荐 10–14 |
| `in_15` | point2d | **list** | Stretch（每子区拉伸系数，x→水平/y→竖直） | 可选 | 与 Points 等长；`{"x":2,"y":0.6}` 表示该子区横向拉长、纵向压缩；缺省 `{1,1}`（正圆），范围 0.25–4 |
| `in_16` | number | item | EdgeNoise（边界扰动幅度，像素） | 可选 | 默认 **2.5**；低频噪声让边界自然蜿蜒、减少多子区在同一点汇聚的生硬感；0 关闭 |

### BoundaryStyle（`in_6`）

| 值 | 视觉效果 | 适用 |
|---|---|---|
| **organic**（**默认**） | CA 平滑，边界自然起伏 | 自由地块 |
| smooth | 比 organic 更圆润 | 柔和自然区 |
| voronoi | 原始 Voronoi 曲线 | 不规则多边形 |
| rectilinear | 水平/垂直/45° 直线 | 棋盘格街区（刻意规整） |

### 推荐 Points（避免生硬直线）

模板默认 `organic` + 不对称面积权重。**勿用四角对称 + 贴边坐标**，否则即使 organic 也会接近田字格。

| 反例（易出硬边） | 推荐（73×73 父区域示例） |
|---|---|
| `(17,17)(55,17)(17,55)(55,55)` 四角对称 | `(22,20)(50,18)(20,50)(48,52)` **内缩、略不对称** |
| 等权 `[1,1,1,1]` | 明显差异：`[3,2,1.5,1]`（约 40% / 27% / 20% / 13%） |

### Points 坐标约定

**x → 列（col），y → 行（row）**，取整后映射到栅格：`{"x": 22, "y": 20}`。

**Areas / ZoneNames / ZoneAssets 三个 merge 必须 `inferredAccess:"item"`**（禁止对 Areas 用 tree）。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | **Scene**（父节点下挂全部分子区） | `{ "label":"Scene", "portName":"out_0" }` → `appendMergeItem` 汇总根 |
| `out_1` | scene | **Zones**（仅子区子树） | 对单个子区再施工时选用，禁止接 merge |
| `out_2` | string | ZonesPath | 聚焦路径，一般不接 |

> **已删除（勿引用）**：旧版 `out_1`(Rest)、`out_4`(RestPath) — 纯划分无剩余区。

## 与 RegionZoneGenerator 的选型

| | AreaPartition | RegionZoneGenerator |
|---|---|---|
| 中心定义 | point2d 列表（显式 x,y） | regions 内嵌九宫格方位 |
| 名称/资产 | 逐区 string 列表 | 单块 district + 单一资产 |
| 覆盖 | **铺满父区域，无 Rest** | 单块多分区 district |
| 算法 | `alg_region_area_partition` | `region_zone_generator` |

## 静默空跑

- **条件**：`in_0` Scene 或 `in_1` Points 未接有效上游 → 整组无输出，`execute` 仍 `completed`
- **验证**：接 Points + 名称/资产 → execute → 父节点下应出现 N 个 `划分子区域*` 子节点，**不应**也不需出现 `rest`

---

## 已验证调用示例（通用命名 · project `p_mr3flg6p_io9iu4` · 2026-07-02）

接在 **AddBaseGrid `out_1`（BaseNode）** 之后。示例仅用占位名；**应用层**再换成叙事地名与 catalog tile。

### 1) 实例化

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "projectId":"p_mr3flg6p_io9iu4", "templateId":"AreaPartition", "groupId":"verify_ap1",
           "position":{"x":-400,"y":200}, "opts":{"actor":"ai:sino","label":"实例化 AreaPartition"} } }
```

### 2) 连线（四子区 · 内缩中心点）

| 口 | 接法 |
|----|------|
| `in_0` | **`verify_abg.out_1`**（BaseNode，不是 `out_2`） |
| `in_1` | 4×`manual_points`（见下表）→ `tree_merge`(**item**, point2d) |
| `in_2`–`in_4` | 等长 merge(**item**) |
| `in_5` | 复用 M0 的 `seed` |
| `out_0` | → `m0_merge.item_1`（`portCount: 2`） |

中心点（73×73 父区域，内缩不对称）：

| 子区 | x | y |
|---|---|---|
| 划分子区域1 | 22 | 20 |
| 划分子区域2 | 50 | 18 |
| 划分子区域3 | 20 | 50 |
| 划分子区域4 | 48 | 52 |

```json
{
  "projectId": "p_mr3flg6p_io9iu4",
  "opts": { "actor": "ai:sino", "label": "M1 AreaPartition wiring" },
  "ops": [
    { "type": "createNode", "nodeId": "m1_pt_1", "opId": "manual_points", "params": { "x": 22, "y": 20 } },
    { "type": "createNode", "nodeId": "m1_pt_2", "opId": "manual_points", "params": { "x": 50, "y": 18 } },
    { "type": "createNode", "nodeId": "m1_pt_3", "opId": "manual_points", "params": { "x": 20, "y": 50 } },
    { "type": "createNode", "nodeId": "m1_pt_4", "opId": "manual_points", "params": { "x": 48, "y": 52 } },
    { "type": "createNode", "nodeId": "m1_pt_merge", "opId": "tree_merge", "params": { "inferredAccess": "item", "inferredType": "point2d", "portCount": 4 } },
    { "type": "createNode", "nodeId": "m1_area_merge", "opId": "tree_merge", "params": { "inferredAccess": "item", "inferredType": "number", "portCount": 4 } },
    { "type": "createNode", "nodeId": "m1_zn_merge", "opId": "tree_merge", "params": { "inferredAccess": "item", "inferredType": "string", "portCount": 4 } },
    { "type": "createNode", "nodeId": "m1_za_merge", "opId": "tree_merge", "params": { "inferredAccess": "item", "inferredType": "string", "portCount": 4 } },
    { "type": "createNode", "nodeId": "m1_a_1", "opId": "number_const", "params": { "value": 3 } },
    { "type": "createNode", "nodeId": "m1_a_2", "opId": "number_const", "params": { "value": 2 } },
    { "type": "createNode", "nodeId": "m1_a_3", "opId": "number_const", "params": { "value": 1.5 } },
    { "type": "createNode", "nodeId": "m1_a_4", "opId": "number_const", "params": { "value": 1 } },
    { "type": "createNode", "nodeId": "m1_zn_1", "opId": "text_panel", "params": { "text": "划分子区域1" } },
    { "type": "createNode", "nodeId": "m1_zn_2", "opId": "text_panel", "params": { "text": "划分子区域2" } },
    { "type": "createNode", "nodeId": "m1_zn_3", "opId": "text_panel", "params": { "text": "划分子区域3" } },
    { "type": "createNode", "nodeId": "m1_zn_4", "opId": "text_panel", "params": { "text": "划分子区域4" } },
    { "type": "createNode", "nodeId": "m1_za_1", "opId": "text_panel", "params": { "text": "草地" } },
    { "type": "createNode", "nodeId": "m1_za_2", "opId": "text_panel", "params": { "text": "草地" } },
    { "type": "createNode", "nodeId": "m1_za_3", "opId": "text_panel", "params": { "text": "草地" } },
    { "type": "createNode", "nodeId": "m1_za_4", "opId": "text_panel", "params": { "text": "草地" } },
    { "type": "connect", "edgeId": "e_m1_scene2ap", "source": { "nodeId": "verify_abg", "port": "out_1" }, "target": { "nodeId": "verify_ap1", "port": "in_0" } },
    { "type": "connect", "edgeId": "e_m1_ap2merge", "source": { "nodeId": "verify_ap1", "port": "out_0" }, "target": { "nodeId": "m0_merge", "port": "item_1" } }
  ]
}
```

（其余 pt/area/zn/za → merge → AP 的 connect 与旧版相同，略。）

### 3) 验收

```bash
curl -s -H 'content-type: application/json' -X POST \
  http://127.0.0.1:9557/api/v1/projects/p_mr3flg6p_io9iu4/execute -d '{}' \
  | jq '[.outputs.verify_ap1.out_0[0].items[0].tree.. | objects | select(.name!=null) | .name] | unique'
# 预期含：划分子区域1…4；不应含 rest
```

自动化：`node aw-support/scripts/verify-battery-templates.mjs`
