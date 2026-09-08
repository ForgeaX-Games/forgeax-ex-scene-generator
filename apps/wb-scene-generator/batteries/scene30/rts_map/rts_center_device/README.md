# RTS中心装置 (rts_center_device)

在 RTS 中心枢纽区域内，按同心环模式放置多层战略装置（护栏、炮台、结构柱、中心核等），模拟星际争霸式中心平台布局。

## 功能特点

1. **同心环布局**：基于到边界的 BFS 深度将中心区域划分为多个同心环，每层装置对应一个指定环
2. **4 种放置形状**：`full_ring`（完整环形）/ `ring`（等角离散）/ `corners`（对角分布）/ `cross`（十字分布）
3. **独立图层输出**：每层装置输出独立网格，配套名称清单，可直接接入 `fill_sort` 标准化输出
4. **高度可配置**：通过 JSON 数组灵活定义任意数量的装置层，每层独立命名和控制

## 适用情况

- RTS 地图中心枢纽区域的装置/建筑摆放
- 需要同心环形对称布局的场景装饰
- 配合 `rts_road_gen` 的 `centerGrid` 输出使用

## 基本使用方法

1. 将 `rts_road_gen` 的 `centerGrid` 输出连接到本电池的 `centerGrid` 输入
2. 在 `layers` 参数中配置所需装置层（JSON 格式）
3. 调整 `ringStep` 控制各环间距
4. 将 `outputGridList` 和 `nameList` 输出接入 `fill_sort` 或 `any_to_list` 打包

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| centerGrid | grid | — | 中心区域掩码网格，非零格为可用区域 |
| layers | string | 见下方 | JSON 数组，定义每层装置的配置 |
| ringStep | number | 3 | 环间距，相邻环之间的格子数量 |
| seed | number | 0 | 随机种子，0 表示使用时间戳（随机） |

### layers 参数格式

```json
[
  {"name": "护栏",   "ring": 1, "count": 16, "shape": "full_ring"},
  {"name": "炮台",   "ring": 2, "count": 8,  "shape": "corners"},
  {"name": "结构柱", "ring": 3, "count": 4,  "shape": "cross"},
  {"name": "中心核", "ring": 5, "count": 1,  "shape": "ring"}
]
```

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 装置名称，显示在名称清单中 |
| ring | number | 第几环（1=最外圈，数字越大越靠内） |
| count | number | 放置数量（`full_ring` 模式下取所有候选格，忽略此值） |
| shape | string | 放置形状，见下方说明 |

### shape 放置形状说明

| shape | 效果 |
|-------|------|
| `full_ring` | 该环上所有候选格全部放置，形成完整的圆环 |
| `ring` | 从候选格中按极角等间隔采样 count 个，形成离散圆环 |
| `corners` | 优先选取 4 个对角线方向（NW/NE/SE/SW）最近的候选格 |
| `cross` | 优先选取 4 个正方向（N/E/S/W）最近的候选格 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGridList | array | 每层装置独立网格，与 layers 配置一一对应 |
| nameList | array | `[{id, name, type}]` 名称清单，type 固定为 "asset" |

## 注意事项

1. **环编号从 1 开始**：`ring=1` 是最外圈，数字越大越靠近中心，超出区域大小时自动取最近深度的格子
2. **ringStep 影响层密度**：`ringStep=3` 时每隔 3 格一环，设置过小可能导致多层重叠在同一批格子上
3. **与 fill_sort 配合**：建议用 `any_to_list` 将 `outputGridList` 和 `nameList` 打包后接入 `fill_sort`
4. **输出为 asset 类型**：nameList 中 type 固定为 "asset"，适合作为场景资产点位使用
