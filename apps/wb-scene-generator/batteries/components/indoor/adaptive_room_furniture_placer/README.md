# 自适应逐房间家具放置器 (adaptive_room_furniture_placer)

按房间面积自动选择合适尺寸的家具，在单张房间网格内逐房间独立放置，保证每个房间都有与之匹配的家具。

> **DataTree 数据格式**：`roomGrid` / `doorGrid` / `outputGrid` 均为 `grid`（`access: item`）。本电池每次只处理单张房间网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组；`furnitureList` 作为家具目录广播到每张网格。

## 功能特点

1. **面积分档**：自动将房间分为 small / medium / large 三类
2. **尺寸匹配**：small 房间只放 `small_*` 家具，medium 房间放 `small_*` + `medium_*`，large 房间放全部
3. **逐房间独立**：每个房间有自己的放置上下文，不同房间互不干扰
4. **主 + 填充两阶段**：先放主家具（每种一次），再填充小件直到占用率上限
5. **放置报告**：输出每个房间的面积、档位、放置数量，便于调试

## 适用情况

- 需要根据房间大小差异化摆放家具的室内游戏场景
- 包含大厅（大房间）+ 普通房间 + 储藏室（小房间）的复杂布局

## 尺寸档位划分

| 面积 | 档位 | 可用家具尺寸 |
|------|------|------------|
| ≤ 10 | small | small_* 只 |
| 11 ~ 39 | medium | small_* + medium_* |
| ≥ 40 | large | 所有尺寸 |

## furniture_id 命名规范

电池通过 `furniture_id` 前缀判断尺寸：
- `small_rect`, `small_square` → small
- `medium_rect`, `medium_square` → medium
- `large_rect`, `large_square` → large
- 组合家具如 `书桌_small`, `书桌_medium`, `书桌_large` → 取 `_small/medium/large` 后缀

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| roomGrid | grid | — | 单张房间网格（1=可用房间格，0=墙/其他），DataTree 逐张处理 |
| doorGrid | grid | — | 门位置网格（非0=门），用于门口设置禁区，与 roomGrid 逐张配对 |
| furnitureList | array | [] | 统一家具清单，rank 1-7 自动归为主家具，rank 8-9 自动归为填充家具（广播到每张网格） |
| seed | number | 42 | 随机种子，0=当前时间 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 折叠后的家具网格，像素值对应 nameList 中的 id |
| nameList | array | 每个家具实例独立一条记录 [{id, name, type, direction}] |
| furnitureIndex | array | 原始家具编号列表（未折叠），含 rank/name/isGroup/direction |
| roomReport | array | 每个房间摘要 [{area, category, placedCount}]，可接调试输出 |

## 注意事项

1. 家具清单里建议同时包含 small/medium/large 三种尺寸，电池会自动选择
2. 只有值为 `1` 的格子才会放家具
3. 面积小于 6 格的连通块会被跳过
