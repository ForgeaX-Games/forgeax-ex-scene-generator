# 场阈值二分 / FieldThreshold（`alg_field_threshold`）

把一个标量场（`field`，如距离场）按 `threshold` 切成**近/远**两个互不重叠的 `0/1` 子区域掩码，二者并集恰好等于 `region` 的有效格。

## 划分规则

对 `region` 内的每个有效格（`region != 0`）：

- `near = 1`，当 `0 <= field <= threshold`（靠近源、距离小）
- `far  = 1`，否则（`field > threshold`，或 BFS 不可达的 `-1`）

`region` 外的无效格在 `near`、`far` 中都为 `0`。

## 为什么需要 `region`

本电池与 `alg_field_distance` / `alg_field_inner_distance` 的输出约定对齐：`field` 中**无效格 = 0、源格 = 0、不可达 = -1**。仅凭 `field` 无法区分「无效格 0」和「源格 0」，因此必须传入 `region` 掩码来界定有效范围（通常就是你送进距离场电池的那张区域网格）。

## 输入

| 端口 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `field` | `grid` | （必填） | 标量场 `number[][]` |
| `region` | `grid` | （必填） | 有效范围掩码，非零格为有效格 |
| `threshold` | `number` | `1` | 近/远分界值，含界归入 `near` |

> raw 距离场用整数阈值（如 `3` = 3 格内为近）；若距离场开了 `normalize`，阈值用 `[0,1]` 小数（如 `0.3`）。

## 输出

| 端口 | 类型 | 说明 |
| --- | --- | --- |
| `near` | `grid` | `0/1` 掩码，靠近源/边界的子区域（浅海 / 海岸线） |
| `far` | `grid` | `0/1` 掩码，远离源/边界的子区域（深海 / 内陆） |

## 配合使用

`alg_field_inner_distance` → `alg_field_threshold` 即可对一个区域做「内/外」「浅/深」「海岸/内陆」的二分。模板 `DistanceZones` 已把这套流程封装成可直接落到场景树上的标准模板。
