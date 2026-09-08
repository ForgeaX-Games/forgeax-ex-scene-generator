# RegionOffset（区域偏移）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1784000010000_roff1`，也可用 basename `RegionOffset`。
> 内部核心 `alg_region_offset` + 标准 scene 挂接链。实例化后返回全新运行时 `groupId`，后续连线一律用返回值。

## 功能说明

对输入 Scene 当前 focus 区域做**有符号形态学偏移**，**支持不规则轮廓**（不要求矩形）：

| Offset | 效果 | Rest（边带） |
|--------|------|--------------|
| `>0` | 外扩（膨胀）N 格 | 增益环 |
| `<0` | 内缩（腐蚀）N 格 | 退去环 |
| `0` | 仅归一化为 0/1 | 空 |

典型用途：地块内缩留边、禁区/缓冲带、不规则湖岸或岛屿的平行偏移。

## 内部算法链

```
Scene → scene_passthrough → node_explode → rect_grid → voxel_slice
  → alg_region_offset(region=slice, offset, connectivity)
       ├─ region → grid2node + TileAssetName → add_child   # Offset 主产物
       └─ ring   → grid2node("rest") → add_child           # Rest 边带
  → 标准五件套输出
```

## 输入端口（IN）

| portName | portType | 语义 | 是否必接 |
|---|---|---|---|
| `in_0` | scene | **Scene** 上游区域（focus 指向待偏移节点） | **必接** |
| `in_1` | number | **Offset** 偏移格数（正外扩 / 负内缩） | **必接** |
| `in_2` | string | **OffsetName** 偏移区域节点名 + `asset_name` | 建议接 |

> 隐藏：`in_3` Connectivity（4/8，默认 4）、`in_4`..`in_8`（z / fillValue / schema / token / zRange）。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | **Scene** 整树 | 汇总 merge |
| `out_1` | scene | **Offset** 偏移后区域 | 后续模板 `in_0` |
| `out_2` | scene | **Rest** 边带（外扩增益环 / 内缩退去环） | 缓冲带装饰 / 下一组 |
| `out_3` | string | **OffsetPath** | 一般不接 |
| `out_4` | string | **RestPath** | 一般不接 |

## 使用示例

```json
{ "toolId":"scene:pipeline.instantiateTemplate","caller":{"kind":"ai"},
  "args":{ "templateId":"RegionOffset", "position":{"x":-400,"y":600},
           "opts":{"actor":"ai:sino","label":"实例化 RegionOffset"} } }
```

```jsonc
{ "type":"createNode","nodeId":"ro_off",  "opId":"number_const","params":{"value":-2} },  // 内缩 2 格
{ "type":"createNode","nodeId":"ro_name","opId":"text_panel",  "params":{"text":"inset"} },
{ "type":"connect","edgeId":"e_ro_scene","source":{"nodeId":"<UPSTREAM>","port":"out_1"},"target":{"nodeId":"<G_RO>","port":"in_0"} },
{ "type":"connect","edgeId":"e_ro_off",  "source":{"nodeId":"ro_off","port":"value"},   "target":{"nodeId":"<G_RO>","port":"in_1"} },
{ "type":"connect","edgeId":"e_ro_name", "source":{"nodeId":"ro_name","port":"output"}, "target":{"nodeId":"<G_RO>","port":"in_2"} }
```

## 使用场合

- 需要在不规则区域上留边 / 做缓冲带 / 平行外扩或内缩。
- 接在 `AddBaseGrid.out_1`、分区 Rest、或任意已有区域节点之后。
- **不该用**：要有机破碎侵蚀轮廓时用 `ZoneNesting`；只要距离分带用 `DistanceZones`。

## 验证要点

`pipeline.execute` 应 `status:completed`。内缩时 `out_1` 细胞数应小于输入；`out_2` 为环状边带。外扩时 `out_1` 变大（受 bbox 限制），`out_2` 为增益环。
