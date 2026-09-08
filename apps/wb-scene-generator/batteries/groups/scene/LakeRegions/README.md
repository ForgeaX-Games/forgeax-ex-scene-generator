# LakeRegions（湖泊区域）

> 当前生产入口是同目录 `lake-regions.scene.ts` 中的原生 Definition。Agent 和用户应在
> canonical Scene Script 中调用该函数；JSON 实例化、raw graph batch/import API 已删除。
> 下文端口表仅用于解释运行时 lowering，旧 CLI/raw-op 示例属于历史诊断资料，不是 authoring 指南。

## 功能说明

在**剩余空地上挖出湖泊区域**（水体）。它消费一块上游空间，划出若干湖，并把没被湖占用的地作为 Rest 继续往下传。

**典型位置：自然地物层**（建筑/道路之后）。通常接在 `PathConnection*.out_2`（Rest/非道路区域——注意 `out_1` 是 Path 本身，不是 Rest）或上一个自然组的 Rest 之后。

## 输入端口（IN）

可见（非 hidden）端口（"怎么喂"= 用哪个上游电池经 `node connect` / `connect` op 接上）：

| portName | portType | label | 是否必接 | 怎么喂（来源电池 → 本端口） | 数据格式（DataTree.items） |
|---|---|---|---|---|---|
| `in_1` | scene | `Scene` | **必接** | `PathConnection*.out_2`（Rest；**不是 `out_1`**——`out_1` 是 Path 本身）或上一组 Rest → `in_1` | scene 树 |
| `in_2` | point2d list | `Points` | 建议接 | N×`manual_points` → `tree_merge`(`inferredAccess:"item"`) → `in_2`；**推断每点对应一片湖区**（未在真实案例中验证，落地前先小范围试一次核对面积/数量） | 列表，每项 `{x,y}` |
| `in_0` | string | `NamePrefix` | 建议接 | `text_panel.output` → `in_0` | 字符串，如 `"湖"` |
| `in_14` | string | `AssetName` | 建议接 | `text_panel.output` → `in_14` | 字符串，如 `"水面"` |
| `in_17` | number | （无 label，`sourcePortName`=`seed`） | 建议接 | `seed_control.seed` → `in_17` | 数值，如 `42` |

> 隐藏高级端口：`in_3/in_4`（fillValue / 切片 z）、`in_5..in_9`（内部散点算法 mode / countMode / density / count / targetValue —— **当前版本没有独立可见的"期望湖泊数"输入**，旧文档的 `ExpectedLakes` 单值口在这版模板里已不存在，数量改由 `in_2`(Points) 锚点数决定）、`in_10/in_11`（sizeVariance / spacingDilate）、`in_12/in_13`、`in_15/in_16`（两组内部 schema/token）。**默认即可，日常不接。**
>
> **数据格式总则**：端口值是 **DataTree** = `[{path,items}]`；`portType` 决定 `items` 形态：`scene`→`{tree:{name,children,...}}`、`number`→数值、`string`→字符串、`point2d`→`{x,y}`、`grid`→二维数组。

## 输出端口（OUT）

| portName | 类型 | label | 说明 | 典型去向 |
|---|---|---|---|---|
| `out_4` | scene | `Lake` | 湖泊领域产物 | 后续湖区细化，禁止接 merge |
| `out_0` | scene | `Rest` | 剩余空地（**不是 `out_1`**） | → 下一组 `in_1`(Scene)（链式 Rest） |
| `out_3` | scene | `Scene` | 整棵合并后场景树 | `{ "label":"Scene", "portName":"out_3" }` → `appendMergeItem` 汇总根 |
| `out_5` | string | `LakePath` | 湖泊路径句柄 | 一般不接 |
| `out_6` | string | `RestPath` | Rest 路径句柄 | 一般不接 |
| `out_1`/`out_2` | grid/number | 无 label（`hidden:true`） | 内部散点/计数中间值 | 不接 |

## 推荐参数与设置考虑要素

- **Points（`in_2`）**：湖泊锚点列表，推断每个点对应一片待挖湖区（与 `IslandRegions.in_1`"每点一岛"用法一致）——**这一推断尚未在真实案例中留痕验证**，正式产出前建议先用 1~2 个点跑一次 `execute` 核对面积/形状再决定要不要加点。旧文档的 `ExpectedLakes`（单值"期望湖泊数"）在当前模板里已不存在，不要按旧文档去接一个不存在的口。
- **NamePrefix（`in_0`）**：湖泊命名前缀（不是 `AssetName`，两者容易搞混——`in_0` 管名字前缀，`in_14` 管水面贴图资产名）。
- **AssetName（`in_14`）**：湖泊水面资产名，**就是渲染出来的水体图层名**。按语义命名，中文如 `"水面"` / `"湖"`，英文如 `"lake"` / `"water"`。
- **Seed（`in_17`）**：接全局 `seed_control.seed` 保证可复现。改 seed 换一套湖泊位置/形状。
- 湖面大小方差 / 间距等隐藏端口默认即可。

## 使用示例（applyBatch ops，可照抄）

前置：链路里已有上游剩余场景（如 `<G_PATH>.out_2`，Rest；**不是 `out_1`**）。先实例化拿回 `<G_LAKE>`：

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"LakeRegions", "position":{"x":-500,"y":1400},
           "opts":{"actor":"ai:sino","label":"实例化 LakeRegions"} } }
```

把返回 groupId 替换进 `<G_LAKE>`，提交 applyBatch（这里以接在道路 Rest 之后为例；`<UPSTREAM_REST>` 改成实际上游，如 `<G_PATH>.out_2`）：

```jsonc
{ "type":"createNode","nodeId":"lake_pt",       "opId":"manual_points","position":{"x":-1000,"y":1380},"params":{"x":30,"y":40} },
{ "type":"createNode","nodeId":"lake_pt_merge", "opId":"tree_merge",   "position":{"x":-950,"y":1380}, "params":{"inferredAccess":"item","inferredType":"point2d","portCount":1} },
{ "type":"createNode","nodeId":"lake_prefix",   "opId":"text_panel",  "position":{"x":-900,"y":1440},"params":{"text":"湖"} },     // NamePrefix
{ "type":"createNode","nodeId":"lake_asset",    "opId":"text_panel",  "position":{"x":-900,"y":1520},"params":{"text":"水面"} },   // AssetName
// in_1=上游剩余场景 接 PathConnection*.out_2（Rest，不是 out_1=Path）；in_2=湖锚点；in_0=命名前缀；in_14=水面资产名
{ "type":"connect","edgeId":"e_lk_scene",  "source":{"nodeId":"<G_PATH>","port":"out_2"},         "target":{"nodeId":"<G_LAKE>","port":"in_1"} },
{ "type":"connect","edgeId":"e_lk_pt2merge","source":{"nodeId":"lake_pt","port":"point"},         "target":{"nodeId":"lake_pt_merge","port":"item_0"} },
{ "type":"connect","edgeId":"e_lk_pts",    "source":{"nodeId":"lake_pt_merge","port":"tree"},     "target":{"nodeId":"<G_LAKE>","port":"in_2"} },
{ "type":"connect","edgeId":"e_lk_prefix", "source":{"nodeId":"lake_prefix","port":"output"},     "target":{"nodeId":"<G_LAKE>","port":"in_0"} },
{ "type":"connect","edgeId":"e_lk_asset",  "source":{"nodeId":"lake_asset","port":"output"},      "target":{"nodeId":"<G_LAKE>","port":"in_14"} },
{ "type":"connect","edgeId":"e_lk_seed",   "source":{"nodeId":"seed_main","port":"seed"},         "target":{"nodeId":"<G_LAKE>","port":"in_17"} },
{ "type":"appendMergeItem","mergeNodeId":"merge_all","source":{"nodeId":"<G_LAKE>","port":{"label":"Scene","portName":"out_3"}} }  // 只接 Scene 汇总口
```

> 后续农田/植被的链式起点用 `<G_LAKE>.out_0`（Rest，**不是 `out_1`**）接到下一组 `in_1`(Scene)。

### 等价 CLI 写法（forgeax，headless）

三条通路底层同一套 op、落到同一张 `graph.json`。CLI 版（`<G>`/`$BATT`/`$TMPL` 含义见 `ArchitectureRegions/README.md`；上游 `path` 句柄来自实例化 PathConnection 时的 `--group-id`）：

```bash
forgeax node create-template --group-file $TMPL/LakeRegions/LakeRegions.json --group-id lake --x -500 --y 1400 $G
forgeax node create --node-id lake_pt     --op manual_points --params '{"x":30,"y":40}'  --x -1000 --y 1380 $G --batteries $BATT
forgeax node create --node-id lake_pt_merge --op tree_merge  --params '{"inferredAccess":"item","inferredType":"point2d","portCount":1}' --x -950 --y 1380 $G --batteries $BATT
forgeax node create --node-id lake_prefix --op text_panel   --params '{"text":"湖"}'  --x -900 --y 1440 $G --batteries $BATT
forgeax node create --node-id lake_asset  --op text_panel   --params '{"text":"水面"}' --x -900 --y 1520 $G --batteries $BATT
forgeax node connect --edge-id e_lk_scene   --from path:out_2          --to lake:in_1  $G
forgeax node connect --edge-id e_lk_pt2merge --from lake_pt:point      --to lake_pt_merge:item_0 $G
forgeax node connect --edge-id e_lk_pts     --from lake_pt_merge:tree  --to lake:in_2  $G
forgeax node connect --edge-id e_lk_prefix  --from lake_prefix:output  --to lake:in_0  $G
forgeax node connect --edge-id e_lk_asset   --from lake_asset:output   --to lake:in_14 $G
forgeax node connect --edge-id e_lk_seed    --from seed_main:seed      --to lake:in_17 $G
forgeax node connect --edge-id e_lk_out2merge --from lake:out_4        --to merge_all:item_N $G
```

> 不要手工维护 `portCount` / `item_N`。在 Scene Script 中使用列表引用，Compiler 会确定性 lowering 对应连线。

## 使用场合

- 需要**水体 / 湖泊 / 池塘**的场景（水乡、湿地、有水景的乡村/公园）。
- 接在任意"产出 Rest 空地"的组之后（`PathConnection*.out_2` / 上一个自然组 Rest）。
- 链式：`out_0`（Rest）继续给农田/植被。
- **不该用的情况**：不需要水体的干燥场景跳过。

## 验证要点

`pipeline.get` 核对 `<G_LAKE>` 的 `in_1`（上游场景）、`in_2`/`in_0`/`in_14`（锚点/命名前缀/资产名）真的接上，`out_4`（Lake）进了汇总。

`pipeline.execute` 应 `status:completed`，`out.layers` 应**多出名为你传入 AssetName 文本（如 `水面`）的水体图层**（scene/tile）。Preview 里应在剩余空地上出现若干水面，数量大致随 `Points` 锚点数变化（推断，未验证）。看到水体图层即说明本层正确。

### 读回端口内容验证（像 grep 一样查某端口）

`execute` 后用 jq 把 `result.outputs` 投影到 `节点.端口`（`outputs` 按 nodeId 键控，DataTree = `[{path,items}]`）：

```bash
# 查湖泊产物 out_4（主产物）；以及剩余 out_0（确认能作下一组上游）
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_LAKE>"]["out_4"][].items[0].tree.children[].name'
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_LAKE>"]["out_0"][].items[0].tree.children[].name'
```

工具通路同理对 `scene:pipeline.execute` 返回投影。预期：`out_4` 树里出现名为 AssetName 文本（如 `水面`）的水体子节点。

> ⚠️ **绝不要整体打印 `outputs`**（整图可达约 28MB 含全 voxel 网格）；**必须 jq 投影到具体 `nodeId.portName`**，scene 端口只取 `.[].items[0].tree.children[].name` 摘要。
