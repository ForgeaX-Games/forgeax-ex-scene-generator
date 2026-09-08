# PlaceOneDecoration（单点装饰物）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1783000010000_p1dec`，也可用 basename `PlaceOneDecoration`。

在指定**可放置区域**（上游 Scene 的底面形状）内，围绕参考 **Point** 尽可能贴近地放置**单个**装饰物：底面占地由 FootprintWidth × FootprintHeight 定义，竖向由 DecorationHeight 定义包围盒高度；放不下时 `alg_point2rect` 会自动缩小 footprint 直至完整落在区域内。

与 `PickOneBuilding`（建筑 + 随机 blocky 轮廓）互补；本模板**不做** blocky 雕刻，footprint 为精确矩形贴合。

**选型**：少量、有明确位置和/或底面尺寸的物件 → **优先本模板**（三类装饰里唯一可控单颗 footprint）。`LocalPreciseDecoration` / `NaturalDecorationDistribution` 无 footprint 口，只应挂底面简单、结构简单的小物件做簇/背景填充——复杂体量或需精准落点的物件不要塞进后两者。按需求选用，不必硬凑三种。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_1` | Scene 上游可放置区域（通常接 Rest） |
| IN | `in_3` | Point 参考位置（`manual_points` → point） |
| IN | `in_5` / `in_6` | FootprintWidth / FootprintHeight 底面占地（格） |
| IN | `in_2` | DecorationHeight 竖向高度（格，写入 grid2node zRange） |
| IN | `in_0` / `in_4` | DecorationName / DecorationAsset |
| OUT | `out_1` | Decoration 装饰物 scene（主产物） |
| OUT | `out_3` | DecorationPath 路径句柄 |
| OUT | `out_2` | Rest 扣除装饰物后的剩余区域 |
| OUT | `out_0` | Scene 整树中间态 |
| OUT | `out_4` | RestPath |

其余 `in_*` 为 hidden 高级参数，默认即可。完整端口以 `GET /api/v1/group-templates/:id?scope=templates` 为准。

## 内部算法链（固定操作）

```
Scene → explode → rect_grid → voxel_slice → region
  → alg_point2rect(region, point, width, height)   # 贴近参考点、尽量保持 footprint
  → alg_region_subtract(全区域, 装饰 footprint)
  → grid2node(装饰, zRange=DecorationHeight) + ObjectAssetName
  → grid2node(rest) + 标准 Path 句柄
```

## 典型串联

```
… → Rest → PlaceOneDecoration.in_1(Scene)
manual_points → in_3(Point)
number_const → in_5/in_6/in_2(尺寸)
type_string → in_0/in_4(名称/资产)

PlaceOneDecoration.out_0(Scene)      → appendMergeItem(root merge)
PlaceOneDecoration.out_1(Decoration) → 领域细化（禁止接 merge）
PlaceOneDecoration.out_2(Rest)       → 下一层 in_1 或 LakeRegions
```

多个精准装饰物：用 **`out_2`(Rest) → 下一实例 `in_1`(Scene)** 串联，每实例一个 Point。

## 验证要点

- `in_1` Scene 悬空 → 静默空跑，无 Decoration 输出。
- Point 落在区域外 0 格 → 算法取最近有效格再贴合矩形。
- 区域放不下目标 footprint → 自动缩小，仍尽量靠近 Point。
- 验收：execute 后 Decoration 子节点非空，Rest 为扣除 footprint 后的区域。

---

## 如何用命令调用（输入侧）

> 文档标准见 [`../_DOC_STANDARD.md`](../_DOC_STANDARD.md)。

### 通道 A · 实例化

```json
{ "templateId": "PlaceOneDecoration", "groupId": "verify_p1dec", "position": { "x": -400, "y": 1500 } }
```

### 通道 B · 必接输入

| 本端口 | 语义 | 怎么喂 |
|--------|------|--------|
| `in_1` | Scene（可放置 Rest） | **默认**：上一组暴露口 `{ label:"Rest" }`（如 `PickOneBuilding.out_2` / `PathConnectionLink.out_2` / 上一 `PlaceOne.out_2`）**直接**接到本口 `{ label:"Scene" }`——组壳对组壳，**不要**挖组内、也不要无故中间插 `scene_focus_path`。仅当必须按**命名路径**取某个子树（非 Rest 口本身）时，才在组外用 `scene_focus_path`。旧版多分支 `PathConnection.out_2` 勿裸连；施工管线用 `PathConnectionLink`/`RandomWalk` 的 Rest。 |
| `in_3` | Point | `manual_points` → point；须在有效 Rest 格内（可用 `node_explode.2dPoints` 选点） |
| `in_5` / `in_6` | **FootprintWidth × FootprintHeight** | `number_const` — **底面矩形占地格数**（`alg_point2rect` 贴合用） |
| `in_2` | **DecorationHeight** | `number_const` — **竖向包围盒高度**（写入 grid2node zRange），**与底面 footprint 分离** |
| `in_0` / `in_4` | DecorationName / DecorationAsset | `text_panel` |

验证链参数：**Footprint 7×5**，**DecorationHeight 4**，点 `{20,20}`，名 `路口石灯`，资产 `草地`。

### 底面占地 vs 竖向高度

| 参数 | 端口 | 含义 |
|------|------|------|
| FootprintWidth × FootprintHeight | `in_5` / `in_6` | 装饰物**底面**占多少格（平面矩形） |
| DecorationHeight | `in_2` | 体素柱**有多高**（z 方向层数） |

---

## 如何用命令消费输出（输出侧）

| 本端口 | 典型下游 | 说明 |
|--------|---------|------|
| `out_1` | `tree_merge` | Decoration scene（主产物） |
| `out_2` | 下一装饰 `in_1` | Rest（扣除 footprint 后；节点名固定 **`rest`**，路径随层级嵌套如 `…/rest/rest`） |
| `out_3` | 路径句柄 | DecorationPath；headless 可 jq 验收 |

---

## 已验证调用示例

| 项 | 值 |
|---|---|
| **projectId** | `p_mr4b9s3j_dycp8k` |
| **报告** | [`step-m5-placeonedecoration.json`](../../../../../../aw-support/battery-verify/p_mr4b9s3j_dycp8k/step-m5-placeonedecoration.json) |
| **groupId** | `verify_p1dec` |
| **restFocusPath** | `/父区域/划分子区域1/rest` |
| **Scene 源** | `verify_pk1.out_2`（PickOne Rest，非 Path.out_2） |

**headless 验收：**

```bash
PID=p_mr4b9s3j_dycp8k
curl -s -X POST "http://127.0.0.1:9557/api/v1/projects/$PID/execute/summary" \
  -H 'content-type: application/json' -H 'x-forgeax-caller-kind: workbench' \
  -d '{"narrativeLocationNames":["父区域","路口石灯"]}' \
  | jq '.outputs.verify_p1dec | {out_1:.out_1.totalCellCount, out_2:.out_2.totalCellCount, out_3:.out_3.itemCount}'
# 预期：out_1/out_2 totalCellCount > 0；out_3 itemCount ≥ 1
```

完整 ops 见报告（`p1_rest_path` + `p1_rest_focus` + `verify_pk1.out_2`）。

### Preview 汇总（必做）

装饰链完成后，须把每个模板的 **`out_0`(Scene) 汇总口**分别用 `appendMergeItem` 接入 `m0_merge`；`out_1`(Decoration) 只作领域细化，禁止接 merge。否则 Preview 仍只有 M1 的四区草地。

---

## 单步独立：最小可跑示例（agent 模仿用）

> 与上文「已验证调用示例」不同：本节**不依赖** M2 具体的 PickOne Rest，用一个全新的独立 20×20 Demo Scene 直接当"可放置区域"，只验证本模板「Point + Footprint + Height → 单点装饰」的端口语义。完整 M0→M8 九步链见 [`battery-chain-template-demo/`](../../../../../../../../aw-support/examples/battery-chain-template-demo/README.md)；agent 模仿总览见 [`agent-imitate.md`](../../../../../../../../aw-support/examples/battery-chain-template-demo/agent-imitate.md)。

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

`demo_abg.out_1`（BaseNode）即为下面 PlaceOneDecoration 的 `in_1`。

### 端口 → opId → 默认参数（模式化生成依据）

| in_* 端口 | 白名单 opId | 必接 | 默认值/示例 | 备注 |
|---|---|---|---|---|
| `in_1` | 上游 `out_*` | 必接 | `demo_abg.out_1` | 可放置区域 |
| `in_3` | `manual_points` | 必接 | `{"x":10,"y":10}` | Point 参考位置 |
| `in_5` / `in_6` | `number_const` | 建议 | `5` / `5` | FootprintWidth / FootprintHeight |
| `in_2` | `number_const` | 建议 | `3` | DecorationHeight |
| `in_0` / `in_4` | `text_panel` | 建议 | `"demo_deco"` / `"草地"` | DecorationName / DecorationAsset |

### applyBatch 片段（可直接照抄）

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"PlaceOneDecoration", "groupId":"demo_p1dec", "position":{"x":-400,"y":1500},
           "opts":{"actor":"ai:sino","label":"实例化 PlaceOneDecoration"} } }
```

```jsonc
{ "type":"createNode","nodeId":"p1_name", "opId":"text_panel","params":{"text":"demo_deco"} },
{ "type":"createNode","nodeId":"p1_asset","opId":"text_panel","params":{"text":"草地"} },
{ "type":"createNode","nodeId":"p1_pt",   "opId":"manual_points","params":{"x":10,"y":10} },
{ "type":"createNode","nodeId":"p1_fw",   "opId":"number_const","params":{"value":5} },
{ "type":"createNode","nodeId":"p1_fh",   "opId":"number_const","params":{"value":5} },
{ "type":"createNode","nodeId":"p1_height","opId":"number_const","params":{"value":3} },
{ "type":"connect","edgeId":"e_p1_rest",  "source":{"nodeId":"demo_abg","port":"out_1"},"target":{"nodeId":"demo_p1dec","port":"in_1"} },
{ "type":"connect","edgeId":"e_p1_name",  "source":{"nodeId":"p1_name","port":"output"},"target":{"nodeId":"demo_p1dec","port":"in_0"} },
{ "type":"connect","edgeId":"e_p1_asset", "source":{"nodeId":"p1_asset","port":"output"},"target":{"nodeId":"demo_p1dec","port":"in_4"} },
{ "type":"connect","edgeId":"e_p1_pt",    "source":{"nodeId":"p1_pt","port":"point"},"target":{"nodeId":"demo_p1dec","port":"in_3"} },
{ "type":"connect","edgeId":"e_p1_fw",    "source":{"nodeId":"p1_fw","port":"value"},"target":{"nodeId":"demo_p1dec","port":"in_5"} },
{ "type":"connect","edgeId":"e_p1_fh",    "source":{"nodeId":"p1_fh","port":"value"},"target":{"nodeId":"demo_p1dec","port":"in_6"} },
{ "type":"connect","edgeId":"e_p1_height","source":{"nodeId":"p1_height","port":"value"},"target":{"nodeId":"demo_p1dec","port":"in_2"} }
```

**验收**：execute 后 `demo_p1dec.out_1` 子节点名应含 `demo_deco`；`out_2`（Rest）应为扣除 5×5 footprint 后的剩余区域。
