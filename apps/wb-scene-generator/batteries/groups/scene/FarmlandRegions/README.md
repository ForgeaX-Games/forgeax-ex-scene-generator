# FarmlandRegions（农田区域）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1781239001217_9be7r`，也可用 basename `FarmlandRegions`。
> 内部 37 个节点、4 个嵌套子组。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

在**剩余空地上生成农田与作物**——划出田块并在田里铺作物/花。它有两个资产名输入（田地本身 + 作物），以及作物密度参数。

**典型位置：自然地物层**（建筑/道路/湖之后）。通常接在上一个组的 Rest 之后（如 `LakeRegions.out_0` 或 `PathConnection*.out_2`；注意各模板 Rest 的 portName 编号不统一，别直接套用同一个数字，先查该模板的端口表或直接用语义 `{"label":"Rest"}` 连线）。

## 输入端口（IN）

可见（非 hidden）端口（"怎么喂"= 用哪个上游电池经 `node connect` / `connect` op 接上）：

| portName | portType | 语义 | 是否必接 | 怎么喂（来源电池 → 本端口） | 数据格式（DataTree.items） |
|---|---|---|---|---|---|
| `in_0` | scene | 上游场景 / 剩余空地 | **必接** | 上一组 Rest（如 `LakeRegions.out_1`） → `in_0` | scene 树 |
| `in_1` | number | ExpectedFarmland 期望农田数 | 建议接 | `number_const.value` → `in_1` | 数值，如 `2` |
| `in_2` | string | FarmlandAsset 田地资产名 | 建议接 | `text_panel.output` → `in_2` | 字符串，如 `"农田"` |
| `in_3` | string | CropAsset 作物/花资产名 | 建议接 | `text_panel.output` → `in_3` | 字符串，如 `"小麦"` |
| `in_4` | number | Seed 随机种子 | 建议接 | `seed_control.seed` → `in_4` | 数值，如 `42` |
| `in_5` | number | CropDensity 作物密度 | 建议接 | `number_const.value` → `in_5` | 数值，如 `0.9` |

> 隐藏高级端口：`in_6`..`in_28`（fillValue / z / schema / token / zRange / cellWidth 田格宽 / cellHeight / gapWidth 田埂宽 / minSize / maxSize / minDistance / dispersion / count / step / prefix 等田块尺寸/分布/作物排布调参）。**默认即可，日常不接。**
>
> **数据格式总则**：端口值是 **DataTree** = `[{path,items}]`；`portType` 决定 `items` 形态：`scene`→`{tree:{name,children,...}}`、`number`→数值、`string`→字符串、`grid`→二维数组。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | Scene 整树汇总口（含田+作物） | `{ "label":"Scene", "portName":"out_0" }` → `appendMergeItem` |
| `out_1` | scene | **Rest** 剩余空地 | → 下一组 `in_0`（链式 Rest） |
| `out_2` | scene | **Farmland** 农田 | 一般不接（out_0 已是主产物） |
| `out_3` | string | FarmlandPath（路径句柄） | 一般不接 |
| `out_4` | string | RestPath（剩余路径句柄） | 一般不接 |

## 推荐参数与设置考虑要素

- **ExpectedFarmland（`in_1`）**：期望农田数，目标值。实证 Example1=`2`。
  - 几块田点缀：`1~2`
  - 大片农耕区：`3~6`
- **FarmlandAsset（`in_2`）**：田地资产名 = 田块图层名（如 `"农田"` / `"farmland"`）。
- **CropAsset（`in_3`）**：作物/花资产名 = 作物图层名（如 `"小麦"` / `"花"` / `"crop"`）。
- **CropDensity（`in_5`）**：作物密度，控制田里作物铺多密。实证 Example1=`0.9`（较密）。范围约 `0`~`1`，越大作物越密集。稀疏作物可用 `0.3~0.5`。
- **Seed（`in_4`）**：接全局 `seed_control.seed` 保证可复现。
- 田格宽/田埂宽（隐藏端口）默认即可。

## 使用示例（applyBatch ops，可照抄）

前置：链路里已有上游剩余场景（如 `<G_LAKE>.out_1`）。先实例化拿回 `<G_FARM>`：

```json
{ "method":"POST","path":"/api/v1/group-templates/<projectId>/instantiate","caller":{"kind":"workbench"},
  "args":{ "templateId":"FarmlandRegions", "position":{"x":-500,"y":1800},
           "opts":{"actor":"ai:sino","label":"实例化 FarmlandRegions"} } }
```

把返回 groupId 替换进 `<G_FARM>`，提交 applyBatch（`<UPSTREAM_REST>` 改成实际上游，如 `<G_LAKE>.out_1`）：

```jsonc
{ "type":"createNode","nodeId":"farm_count","opId":"number_const","position":{"x":-900,"y":1800},"params":{"value":2} },     // ExpectedFarmland
{ "type":"createNode","nodeId":"farm_name", "opId":"text_panel",  "position":{"x":-900,"y":1920},"params":{"text":"农田"} }, // FarmlandAsset
{ "type":"createNode","nodeId":"crop_name", "opId":"text_panel",  "position":{"x":-900,"y":2040},"params":{"text":"小麦"} }, // CropAsset
{ "type":"createNode","nodeId":"crop_dens", "opId":"number_const","position":{"x":-900,"y":2160},"params":{"value":0.9} },   // CropDensity
// in_0=上游剩余；in_1=农田数；in_2=田名；in_3=作物名；in_4=seed；in_5=作物密度
{ "type":"connect","edgeId":"e_fm_scene","source":{"nodeId":"<G_LAKE>","port":"out_1"},   "target":{"nodeId":"<G_FARM>","port":"in_0"} },
{ "type":"connect","edgeId":"e_fm_cnt",  "source":{"nodeId":"farm_count","port":"value"}, "target":{"nodeId":"<G_FARM>","port":"in_1"} },
{ "type":"connect","edgeId":"e_fm_fname","source":{"nodeId":"farm_name","port":"output"}, "target":{"nodeId":"<G_FARM>","port":"in_2"} },
{ "type":"connect","edgeId":"e_fm_cname","source":{"nodeId":"crop_name","port":"output"}, "target":{"nodeId":"<G_FARM>","port":"in_3"} },
{ "type":"connect","edgeId":"e_fm_seed", "source":{"nodeId":"seed_main","port":"seed"},   "target":{"nodeId":"<G_FARM>","port":"in_4"} },
{ "type":"connect","edgeId":"e_fm_dens", "source":{"nodeId":"crop_dens","port":"value"},  "target":{"nodeId":"<G_FARM>","port":"in_5"} },
{ "type":"connect","edgeId":"e_fm_out0", "source":{"nodeId":"<G_FARM>","port":"out_0"},   "target":{"nodeId":"merge_all","port":"item_N"} }  // 换未占用 item 口
```

> 后续植被的链式起点用 `<G_FARM>.out_1`（Rest）接到 `RandomNaturalDecoration.in_0`。

### 等价 CLI 写法（forgeax，headless）

三条通路底层同一套 op、落到同一张 `graph.json`。CLI 版（`<G>`/`$BATT`/`$TMPL` 含义见 `ArchitectureRegions/README.md`；上游 `lake` 句柄来自实例化 LakeRegions 时的 `--group-id`）：

```bash
forgeax node create-template --group-file $TMPL/FarmlandRegions/FarmlandRegions.json --group-id farm --x -500 --y 1800 $G
forgeax node create --node-id farm_count --op number_const --params '{"value":2}'    --x -900 --y 1800 $G --batteries $BATT
forgeax node create --node-id farm_name  --op text_panel   --params '{"text":"农田"}' --x -900 --y 1920 $G --batteries $BATT
forgeax node create --node-id crop_name  --op text_panel   --params '{"text":"小麦"}' --x -900 --y 2040 $G --batteries $BATT
forgeax node create --node-id crop_dens  --op number_const --params '{"value":0.9}'  --x -900 --y 2160 $G --batteries $BATT
forgeax node connect --edge-id e_fm_scene --from lake:out_1       --to farm:in_0 $G
forgeax node connect --edge-id e_fm_cnt   --from farm_count:value --to farm:in_1 $G
forgeax node connect --edge-id e_fm_fname --from farm_name:output --to farm:in_2 $G
forgeax node connect --edge-id e_fm_cname --from crop_name:output --to farm:in_3 $G
forgeax node connect --edge-id e_fm_seed  --from seed_main:seed   --to farm:in_4 $G
forgeax node connect --edge-id e_fm_dens  --from crop_dens:value  --to farm:in_5 $G
forgeax node connect --edge-id e_fm_out0  --from farm:out_0       --to merge_all:item_N $G
```

> 或 `forgeax pipeline apply --ops '<JSON array>'` 一次提交（同 applyBatch schema）。

## 使用场合

- 需要**农田 / 作物 / 田园**的场景（乡村、农场、田园风光）。
- 接在任意产出 Rest 空地的组之后。
- 链式：`out_1`（Rest）继续给植被装饰。
- **不该用的情况**：城市/纯自然森林等无农耕的场景跳过。

## 验证要点

`pipeline.get` 核对 `<G_FARM>` 的 6 个可见输入（in_0..in_5）真的接上，`out_0` 进了汇总。

`pipeline.execute` 应 `status:completed`，`out.layers` 应**多出田块图层（名为 FarmlandAsset，如 `农田`）+ 作物图层（名为 CropAsset，如 `小麦`）**。作物图层的密集程度随 `CropDensity` 变化（0.9 较密）。Preview 里应在剩余空地出现成块的田地与其上的作物，即说明本层正确。

### 读回端口内容验证（像 grep 一样查某端口）

`execute` 后用 jq 把 `result.outputs` 投影到 `节点.端口`（`outputs` 按 nodeId 键控，DataTree = `[{path,items}]`）：

```bash
# 查农田产物 out_0（含田+作物）；以及剩余 out_1
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_FARM>"]["out_0"][].items[0].tree.children[].name'
forgeax pipeline execute --batteries $BATT $G \
  | jq '.result.outputs["<G_FARM>"]["out_1"][].items[0].tree.children[].name'
```

工具通路同理对 `scene:pipeline.execute` 返回投影。预期：`out_0` 树里出现名为 FarmlandAsset（如 `农田`）与 CropAsset（如 `小麦`）的子节点。

> ⚠️ **绝不要整体打印 `outputs`**（整图可达约 28MB 含全 voxel 网格）；**必须 jq 投影到具体 `nodeId.portName`**，scene 端口只取 `.[].items[0].tree.children[].name` 摘要。
