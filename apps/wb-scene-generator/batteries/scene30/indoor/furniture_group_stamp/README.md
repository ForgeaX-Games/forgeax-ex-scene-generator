# 家具组坐标放置器 (furniture_group_stamp)

将一个家具组 mask 按坐标盖印到室内空间中，mask 的非零值直接对应组内子组件的相对编号，输出时整体平移到旧编号列表之后，保证 maskA 与编号列表严格对应。

## 与 furniture_stamp 的区别

| 对比项 | furniture_stamp | furniture_group_stamp |
|--------|----------------|-----------------------|
| 家具描述输入 | 单个家具名称（string） | 家具组编号列表（array） |
| mask 非零值含义 | 固定：1=主体，>1=子组件+10 | 直接作为组内相对编号 |
| 输出编号规则 | effectiveRank = n+1，子组件 n+11 | n + mask值（v），严格一一对应 |

## 编号规则

```
n = 旧家具编号列表中的最大 rank

maskA 写入值：
  mask[r][c] = v（v >= 1）→ maskA[r][c] = n + v
  mask[r][c] = 0           → maskB[r][c] = 1（过道，仅限有效格）

输出编号列表新增条目：
  groupIndex 中每条 {rank: r, name: "xxx"} → 输出为 {rank: n + r, name: "xxx"}
```

## 适用情况

- 已有一套完整的家具组（包含 mask 和对应编号列表），需要整体挪到另一个房间
- 配合 `furniture_placer` 输出的 `furnitureIndex` 作为 `groupIndex` 输入，实现家具组的复用放置
- 需要手动指定位置放置一组编号严格对应的复合家具

## 基本使用方法

1. 准备家具组 mask（非零值对应各子组件编号，0 为过道）
2. 准备 groupIndex（各子组件的相对编号和名称，rank 与 mask 值对应）
3. 连接 roomGrid、maskA、maskB 和 oldFurnitureIndex
4. 设置 x、y 坐标（相对室内可用区左上角的偏移）
5. 执行，得到更新后的网格和编号列表

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| furnitureMask | grid | — | 家具组 mask；非零值=组内子组件编号，0=过道 |
| groupIndex | array | — | 家具组编号列表，每项含 rank（与 mask 值对应）、name、isGroup |
| x | number | 0 | 列偏移：家具有效区左上角相对室内可用区左上角向右的格数 |
| y | number | 0 | 行偏移：家具有效区左上角相对室内可用区左上角向下的格数 |
| roomGrid | grid | — | 室内空间网格（1=可用，0=墙） |
| maskA | grid | — | 家具实体占用网格 |
| maskB | grid | — | 过道预留网格 |
| oldFurnitureIndex | array | — | 旧家具编号列表，无时传 `[]` |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| newMaskA | grid | 写入家具组后的实体占用网格，值 = n + mask值 |
| newMaskB | grid | 写入过道后的过道预留网格 |
| furnitureIndex | array | 所有编号列表（旧+新），新条目 rank = n + 组内相对 rank |
| placementFailed | bool | 碰撞检测不通过时为 true，输出为原始值 |
| failReason | string | 失败原因描述，成功时为空字符串 |

## 注意事项

1. **groupIndex 的 rank 必须与 mask 非零值一一对应**：mask 中出现的每个非零值都应在 groupIndex 中有对应条目，否则该值在 maskA 中有编号但编号列表中无名称
2. **不做碰撞检测以外的合法性校验**：坐标由用户保证合法，放置位置超出有效格会被静默跳过
3. **与其他放置器串联**：输出的 maskA/maskB/furnitureIndex 可直接作为下一个放置器的输入
