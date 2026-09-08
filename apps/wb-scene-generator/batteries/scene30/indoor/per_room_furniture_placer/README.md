# 逐房间家具放置器 (per_room_furniture_placer)

将室内布局网格中的每个独立连通房间提取为独立网格，分别运行主家具放置和填充家具放置，确保每个房间都有家具覆盖，最后合并成一张完整的家具网格输出。

## 功能特点

1. **连通区域检测**：自动识别布局中所有值为 1 的独立连通房间，走廊（值为 2）不放置家具
2. **逐房间独立放置**：每个房间有独立的放置上下文，小房间不再被大房间抢占家具
3. **主 + 填充两阶段**：先放主家具（每种放一次），再用填充家具反复填满剩余空间
4. **唯一编号段**：每个房间使用间隔 1000 的 rank 偏移，保证全局编号不冲突

## 适用情况

- 需要保证所有房间都有家具的室内游戏场景
- 房间数量较多、大小不均时（传统全局放置器只会填满少数大房间）
- 配合 `complex_indoor_gen` 使用的标准室内管线

## 基本使用方法

1. 将 `complex_indoor_gen` 的 `outputGrid` 连接到 `layoutGrid`
2. 将 `furniture_rank_split` 的 `main_list` 连接到 `mainList`
3. 将 `furniture_rank_split` 的 `fill_list` 连接到 `fillList`
4. 将 `newMaskA` 输出连接到可视化节点

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| layoutGrid | grid | — | complex_indoor_gen 输出的布局网格（0=墙, 1=房间, 2=走廊, 3=门） |
| mainList | array | [] | 主家具清单（furniture_rank_split.main_list），每房间各放一次 |
| fillList | array | [] | 填充家具清单（furniture_rank_split.fill_list），反复填充 |
| seed | number | 42 | 随机种子；0 使用当前时间戳，不同房间自动使用不同子种子 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| newMaskA | grid | 所有房间家具合并后的掩码网格，非零值为家具编号 |
| furnitureIndex | array | 已放置家具编号列表 [{rank, name, isGroup}] |

## 注意事项

1. **输入格式**：`layoutGrid` 中只有值为 `1` 的格子被视为可放置区域，走廊（2）和门（3）不放家具
2. **最小房间面积**：面积小于 6 格的连通块会被跳过，不放置家具
3. **rank 编号**：每个房间的编号起点相差 1000，最多支持 1000 种家具的布局（通常远够用）
4. **替换关系**：该电池替代了管线中的 `room_mask_init + furniture_placer + furniture_filler` 三节点组合
