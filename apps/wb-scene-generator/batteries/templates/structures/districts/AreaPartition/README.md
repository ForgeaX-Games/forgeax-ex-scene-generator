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
| `in_5` | number | tree | Seed | **必接** | **`aw_m0_seed.seed`（全局固定非 0）**；禁止悬空/`seed:0` |
| `in_6` | string | item | BoundaryStyle | **默认 organic** | `organic` / `smooth` / `voronoi` / `rectilinear` |
| `in_7` | number | item | RelaxIterations | 默认 **8** | Lloyd 松弛，推荐 6–10 |
| `in_8` | number | item | SmoothIterations | 默认 **12** | organic 边界 CA，推荐 10–14 |

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
| `out_2` | string | ZonesPath | 聚焦路径句柄；配合 `scene_focus_path` 索引单个子区 |

> **已删除（勿引用）**：旧版 `out_1`(Rest)、`out_4`(RestPath) — 纯划分无剩余区。

---

## 如何用命令调用（输入侧）

> 文档标准见 [`../_DOC_STANDARD.md`](../_DOC_STANDARD.md)。人类/Workbench 可从 Templates 面板拖入，再通过编辑器接线。

### 通道 A · 实例化

```json
{ "method": "POST", "path": "/api/v1/group-templates/<projectId>/instantiate", "caller": { "kind": "workbench" },
  "args": { "projectId": "<pid>", "templateId": "AreaPartition", "groupId": "verify_ap1",
            "position": { "x": -400, "y": 200 },
            "opts": { "actor": "ai:sino", "label": "实例化 AreaPartition" } } }
```

返回 `groupId` 替换下文 `<G_AP>`。

### 通道 B · 必接输入（白名单 opId → 本组端口）

| 本端口 | 白名单上游 opId | 怎么喂 | merge params（若经 tree_merge） |
|--------|-----------------|--------|----------------------------------|
| `in_0` | 上游模板 `out_*` | `AddBaseGrid.out_1`（BaseNode）或上一组子区 scene | — |
| `in_1` | `manual_points` → `tree_merge` | N 个 `{x,y}`；**输出端口名 `point`** | `{ "inferredAccess":"item", "inferredType":"point2d", "portCount": N }` |
| `in_2` | `number_const` → `tree_merge` | 面积权重，如 `[3,2,1.5,1]` | `{ "inferredAccess":"item", "inferredType":"number", "portCount": N }` |
| `in_3` | `text_panel` → `tree_merge` | 子区名列表 | `{ "inferredAccess":"item", "inferredType":"string", "portCount": N }` |
| `in_4` | `text_panel` → `tree_merge` | catalog tile 名列表 | `{ "inferredAccess":"item", "inferredType":"string", "portCount": N }` |
| `in_5` | `seed_control` | 全局 seed 扇出 | — |
| `in_6`–`in_8` | 不接则用组内默认 | organic / 8 / 12 | — |

**一条 applyBatch 最小可跑示例（四子区，省略 zn/za connect 见完整示例）：**

```json
{
  "projectId": "<pid>",
  "opts": { "actor": "ai:sino", "label": "AreaPartition wiring" },
  "ops": [
    { "type": "createNode", "nodeId": "m1_pt_1", "opId": "manual_points", "params": { "x": 22, "y": 20 } },
    { "type": "createNode", "nodeId": "m1_pt_merge", "opId": "tree_merge",
      "params": { "inferredAccess": "item", "inferredType": "point2d", "portCount": 4 } },
    { "type": "createNode", "nodeId": "m1_area_merge", "opId": "tree_merge",
      "params": { "inferredAccess": "item", "inferredType": "number", "portCount": 4 } },
    { "type": "connect", "edgeId": "e_scene2ap", "source": { "nodeId": "verify_abg", "port": "out_1" },
      "target": { "nodeId": "<G_AP>", "port": "in_0" } },
    { "type": "connect", "edgeId": "e_pt1", "source": { "nodeId": "m1_pt_1", "port": "point" },
      "target": { "nodeId": "m1_pt_merge", "port": "item_0" } },
    { "type": "connect", "edgeId": "e_pts2ap", "source": { "nodeId": "m1_pt_merge", "port": "tree" },
      "target": { "nodeId": "<G_AP>", "port": "in_1" } }
  ]
}
```

### 等价 CLI

```bash
forgeax node create-template --group-file batteries/templates/structures/districts/AreaPartition/AreaPartition.json \
  --group-id verify_ap1 --x -400 --y 200 $G
forgeax node create --node-id m1_pt_1 --op manual_points --params '{"x":22,"y":20}' $G --batteries $BATT
forgeax node connect --edge-id e_scene2ap --from verify_abg:out_1 --to verify_ap1:in_0 $G
```

### 输入侧读回验证

```bash
curl -s …/execute -d '{}' | jq '.outputs.<G_AP>.out_0[0].items[0].tree.children[0].children | map(.name)'
# 预期：["划分子区域1","划分子区域2",…]（数量 = Points 个数）
```

---

## 如何用命令消费输出（输出侧）

| 本端口 | 语义 | 典型下游 | 允许的白名单 opId |
|--------|------|----------|-------------------|
| `out_0` | 主 scene（父节点下挂**全部分子区**） | Preview 汇总；或对**单个子区**再划分 | `tree_merge`, `scene_merge_subtrees`, `scene_output`, **`scene_focus_path`**, **`scene_focus_children`** |
| `out_1` | Zones（**仅子区子树**，模板内已 `scene_focus_path`） | 需要「只有子区、没有父壳」时直传 | 同上 |
| `out_2` | ZonesPath（子区公共路径前缀） | 拼绝对 path 时参考；日常可手填 `/父名/子区名` | `text_panel`, `string_concat` → `scene_focus_path` |

### 模式 A · 整图汇总（最常见）

```json
{ "type": "connect", "edgeId": "e_ap2merge",
  "source": { "nodeId": "<G_AP>", "port": "out_0" },
  "target": { "nodeId": "m0_merge", "port": "item_1" } }
```

`tree_merge` params：`{ "inferredAccess": "tree", "inferredType": "scene", "portCount": N }`。

### 模式 B · 路径索引 — 取**单个子区域**再施工

父节点名 = AddBaseGrid 的 BaseName（如 `父区域`），子区名 = `in_3` 里写的名（如 `划分子区域1`）。**绝对路径** `/父区域/划分子区域1`。

```json
{ "type": "createNode", "nodeId": "zone1_path", "opId": "text_panel",
  "params": { "text": "/父区域/划分子区域1" } },
{ "type": "createNode", "nodeId": "zone1_focus", "opId": "scene_focus_path", "params": {} },
{ "type": "connect", "edgeId": "e_ap2focus", "source": { "nodeId": "<G_AP>", "port": "out_0" },
  "target": { "nodeId": "zone1_focus", "port": "scene" } },
{ "type": "connect", "edgeId": "e_path2focus", "source": { "nodeId": "zone1_path", "port": "output" },
  "target": { "nodeId": "zone1_focus", "port": "path" } },
{ "type": "connect", "edgeId": "e_focus2next", "source": { "nodeId": "zone1_focus", "port": "scene" },
  "target": { "nodeId": "<G_NEXT>", "port": "in_0" } }
```

> `scene_focus_path` 可供人类/Workbench 接线。路径必须存在于 tree 中，否则 execute 报错。

**动态拼路径**（父名/子名来自 panel）：

```json
{ "type": "createNode", "nodeId": "path_concat", "opId": "string_concat", "params": {} }
// concat: a="/父区域", b="/划分子区域1" → scene_focus_path.path
```

### 模式 C · 扇出 — 对**每个子区**分别接线

```json
{ "type": "createNode", "nodeId": "zones_fan", "opId": "scene_focus_children", "params": {} },
{ "type": "connect", "edgeId": "e_ap2fan", "source": { "nodeId": "<G_AP>", "port": "out_0" },
  "target": { "nodeId": "zones_fan", "port": "scene" } }
```

`zones_fan.scenes` 为 **list access** 的 scene 列表（每个 focus 在一个直接子节点上）。可再接：

- 逐 branch `connect` 到不同下游组；或
- `tree_merge`（`inferredAccess:"item"`, `inferredType:"scene"`, `portCount`=子区数）再统一处理。

> `scene_focus_children` 可用于 AreaPartition / PickMulti 等多子节点扇出。

### 模式 D · 嵌套再划分

对**某一个子区**再跑 AreaPartition：用 **模式 B** 得到单区 scene → 作为新 AreaPartition 的 `in_0`（不是 Rest，也不是 BaseNode 全图）。

### 输出侧读回验证

```bash
# 子区名列表
curl -s …/execute -d '{}' | jq '[.outputs.<G_AP>.out_0[0].items[0].tree.. | objects | select(.name!=null) | .name] | unique'

# 单区 focus 后 cells 数（应先 scene_focus_path 再 execute）
curl -s …/execute -d '{}' | jq '.outputs.zone1_focus.scene[0].items[0].tree | …'
```

### 输出侧禁止

- 引用不存在的 `out_1`(Rest) / `out_4`(RestPath)
- 两路 AreaPartition 并行接同一 `AddBaseGrid.out_1`
- 对 Areas 用 `tree_merge` 的 `inferredAccess:"tree"`（会导致静默空跑）

---

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

---

## 单步独立：最小可跑示例（agent 模仿用）

> 与上文「已验证调用示例」不同：本节**不依赖** M0/M1 具体的父区域/子区命名，用一个全新的独立 20×20 Demo Scene 起步，只验证本模板「点+面积权重→划分」的端口语义。完整 M0→M8 九步链见 [`battery-chain-template-demo/`](../../../../../../../../../aw-support/examples/battery-chain-template-demo/README.md)；agent 模仿总览见 [`agent-imitate.md`](../../../../../../../../../aw-support/examples/battery-chain-template-demo/agent-imitate.md)。

### 前置：造一个独立 Demo Scene（可跨模板复用的固定写法）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"AddBaseGrid", "groupId":"demo_abg", "position":{"x":-800,"y":0},
           "opts":{"actor":"ai:sino","label":"实例化 AddBaseGrid（独立 demo scene）"} } }
```

```jsonc
{ "type":"createNode","nodeId":"demo_empty","opId":"empty_scene","params":{} },
{ "type":"createNode","nodeId":"demo_name", "opId":"text_panel","params":{"text":"demo_ground"} },
{ "type":"createNode","nodeId":"demo_w",    "opId":"number_const","params":{"value":20} },
{ "type":"createNode","nodeId":"demo_h",    "opId":"number_const","params":{"value":20} },
{ "type":"createNode","nodeId":"demo_asset","opId":"text_panel","params":{"text":"草地"} },
{ "type":"connect","edgeId":"e_demo_scene","source":{"nodeId":"demo_empty","port":"scene"}, "target":{"nodeId":"demo_abg","port":"in_0"} },
{ "type":"connect","edgeId":"e_demo_name", "source":{"nodeId":"demo_name","port":"output"}, "target":{"nodeId":"demo_abg","port":"in_1"} },
{ "type":"connect","edgeId":"e_demo_w",    "source":{"nodeId":"demo_w","port":"value"},     "target":{"nodeId":"demo_abg","port":"in_2"} },
{ "type":"connect","edgeId":"e_demo_h",    "source":{"nodeId":"demo_h","port":"value"},     "target":{"nodeId":"demo_abg","port":"in_3"} },
{ "type":"connect","edgeId":"e_demo_asset","source":{"nodeId":"demo_asset","port":"output"},"target":{"nodeId":"demo_abg","port":"in_4"} }
```

`demo_abg.out_1`（BaseNode）即为下面 AreaPartition 的 `in_0`。

### 端口 → opId → 默认参数（2 子区最小示例，模式化生成依据）

| in_* 端口 | 白名单 opId | 必接 | 默认值/示例 | 备注 |
|---|---|---|---|---|
| `in_0` | 上游 `out_*` | 必接 | `demo_abg.out_1` | 待划分父区域 |
| `in_1` | `manual_points`×N → `tree_merge`(item,point2d,N) | 必接 | `{6,6}` `{14,14}` | 各子区中心，N 可扩展 |
| `in_2` | `number_const`×N → `tree_merge`(item,number,N) | 建议 | `2` `1` | 面积权重 |
| `in_3` | `text_panel`×N → `tree_merge`(item,string,N) | 建议 | `"子区A"` `"子区B"` | 子区节点名 |
| `in_4` | `text_panel`×N → `tree_merge`(item,string,N) | 建议 | `"草地"` `"草地"` | tile 资产 |
| `in_5` | `seed_control` / `aw_m0_seed` | **必接** | `42`（非 0） | 生产接全局 `aw_m0_seed` |

### applyBatch 片段（2 子区，可直接照抄）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"AreaPartition", "groupId":"demo_ap", "position":{"x":-400,"y":200},
           "opts":{"actor":"ai:sino","label":"实例化 AreaPartition"} } }
```

```jsonc
{ "type":"createNode","nodeId":"ap_pt_1","opId":"manual_points","params":{"x":6,"y":6} },
{ "type":"createNode","nodeId":"ap_pt_2","opId":"manual_points","params":{"x":14,"y":14} },
{ "type":"createNode","nodeId":"ap_pt_merge","opId":"tree_merge","params":{"inferredAccess":"item","inferredType":"point2d","portCount":2} },
{ "type":"createNode","nodeId":"ap_a_1","opId":"number_const","params":{"value":2} },
{ "type":"createNode","nodeId":"ap_a_2","opId":"number_const","params":{"value":1} },
{ "type":"createNode","nodeId":"ap_area_merge","opId":"tree_merge","params":{"inferredAccess":"item","inferredType":"number","portCount":2} },
{ "type":"createNode","nodeId":"ap_zn_1","opId":"text_panel","params":{"text":"子区A"} },
{ "type":"createNode","nodeId":"ap_zn_2","opId":"text_panel","params":{"text":"子区B"} },
{ "type":"createNode","nodeId":"ap_zn_merge","opId":"tree_merge","params":{"inferredAccess":"item","inferredType":"string","portCount":2} },
{ "type":"createNode","nodeId":"ap_za_1","opId":"text_panel","params":{"text":"草地"} },
{ "type":"createNode","nodeId":"ap_za_2","opId":"text_panel","params":{"text":"草地"} },
{ "type":"createNode","nodeId":"ap_za_merge","opId":"tree_merge","params":{"inferredAccess":"item","inferredType":"string","portCount":2} },
{ "type":"connect","edgeId":"e_ap_scene","source":{"nodeId":"demo_abg","port":"out_1"},"target":{"nodeId":"demo_ap","port":"in_0"} },
{ "type":"connect","edgeId":"e_ap_pt1","source":{"nodeId":"ap_pt_1","port":"point"},"target":{"nodeId":"ap_pt_merge","port":"item_0"} },
{ "type":"connect","edgeId":"e_ap_pt2","source":{"nodeId":"ap_pt_2","port":"point"},"target":{"nodeId":"ap_pt_merge","port":"item_1"} },
{ "type":"connect","edgeId":"e_ap_pts","source":{"nodeId":"ap_pt_merge","port":"tree"},"target":{"nodeId":"demo_ap","port":"in_1"} },
{ "type":"connect","edgeId":"e_ap_a1","source":{"nodeId":"ap_a_1","port":"value"},"target":{"nodeId":"ap_area_merge","port":"item_0"} },
{ "type":"connect","edgeId":"e_ap_a2","source":{"nodeId":"ap_a_2","port":"value"},"target":{"nodeId":"ap_area_merge","port":"item_1"} },
{ "type":"connect","edgeId":"e_ap_areas","source":{"nodeId":"ap_area_merge","port":"tree"},"target":{"nodeId":"demo_ap","port":"in_2"} },
{ "type":"connect","edgeId":"e_ap_zn1","source":{"nodeId":"ap_zn_1","port":"output"},"target":{"nodeId":"ap_zn_merge","port":"item_0"} },
{ "type":"connect","edgeId":"e_ap_zn2","source":{"nodeId":"ap_zn_2","port":"output"},"target":{"nodeId":"ap_zn_merge","port":"item_1"} },
{ "type":"connect","edgeId":"e_ap_zns","source":{"nodeId":"ap_zn_merge","port":"tree"},"target":{"nodeId":"demo_ap","port":"in_3"} },
{ "type":"connect","edgeId":"e_ap_za1","source":{"nodeId":"ap_za_1","port":"output"},"target":{"nodeId":"ap_za_merge","port":"item_0"} },
{ "type":"connect","edgeId":"e_ap_za2","source":{"nodeId":"ap_za_2","port":"output"},"target":{"nodeId":"ap_za_merge","port":"item_1"} },
{ "type":"connect","edgeId":"e_ap_zas","source":{"nodeId":"ap_za_merge","port":"tree"},"target":{"nodeId":"demo_ap","port":"in_4"} }
```

**验收**：execute 后 `demo_ap.out_0` 的子节点名应含 `子区A`、`子区B`，不含 `rest`。
