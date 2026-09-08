# 家具坐标放置器 (furniture_stamp)

将给定家具 mask 按指定坐标直接盖印到室内空间中，无需模板库，适合手动指定位置放置自定义家具。

## 功能特点

1. **坐标直接放置**：通过 (x, y) 偏移量精确控制家具位置，不依赖自动寻位算法
2. **遵循掩码规范**：按照与 `furniture_placer` / `furniture_filler` 完全相同的规则写入 maskA 和 maskB
3. **自动编号**：新家具 rank = 旧列表最大 rank + 1，isGroup 固定为 true

## 坐标说明

坐标参考系：**室内可用区左上角**（即 roomGrid 中第一个值不为 0 的格子）。

家具 mask 中值不为 0 的格子的左上角，对齐到该参考点偏移 (y 行, x 列) 处。

```
例：roomGrid 中第一个非零格在 (2, 3)
    furnitureMask 中第一个非零格在 mask 内 (1, 1)（即 mask 周边有一圈 0）
    x=2, y=0

    则家具主体左上角落在 roomGrid 的 (2+0-1, 3+2-1) = (1, 4) 处
```

## 适用情况

- 配合 `grid_furniture_gen` 生成的 mask，手动指定放置位置
- 需要在特定坐标放置自定义形状家具，不使用自动布局
- 作为 `furniture_placer` / `furniture_filler` 之后的补充放置步骤

## 基本使用方法

1. 用 `grid_furniture_gen` 生成家具 mask（或手动提供）
2. 连接 roomGrid、maskA、maskB（可来自 `room_mask_init` 或前一个放置节点的输出）
3. 连接 oldFurnitureIndex（无旧家具时传 `[]`）
4. 填写 x、y 坐标和家具名称
5. 执行，得到更新后的三张网格和家具清单

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| furnitureMask | grid | — | 家具 mask 网格；1=主体，>1=子组件，0=过道/边界 |
| furnitureName | string | 自定义家具 | 家具名称，写入家具清单 |
| x | number | 0 | 列偏移：家具有效区左上角相对室内可用区左上角向右的格数 |
| y | number | 0 | 行偏移：家具有效区左上角相对室内可用区左上角向下的格数 |
| roomGrid | grid | — | 室内空间网格（1=可用，0=墙） |
| maskA | grid | — | 家具实体占用网格 |
| maskB | grid | — | 过道预留网格 |
| oldFurnitureIndex | array | — | 旧家具编号列表，无旧家具时传 `[]` |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| newMaskA | grid | 写入家具主体后的实体占用网格 |
| newMaskB | grid | 写入过道后的过道预留网格 |
| furnitureIndex | array | 所有家具编号列表（旧+新），每项含 `rank`、`name`、`isGroup` |

## 掩码写入规则

与 `furniture_placer` / `furniture_filler` 完全一致：

| mask 值 | 写入目标 | 写入内容 |
|---------|---------|---------|
| 1 | maskA | effectiveRank（新家具编号） |
| > 1 | maskA | effectiveRank + 10（子组件编号） |
| 0 且在 roomGrid 有效格内 | maskB | 1 |
| 0 且出界或墙格 | 不写入 | — |

## 注意事项

1. **不做碰撞检测**：本电池不检查放置位置是否与已有家具重叠，请确认坐标合法后再使用
2. **isGroup 固定为 true**：所有通过本电池放置的家具均标记为组合家具类型
3. **坐标可为负数**：若 x/y 为负，家具会向室内可用区左上角的外侧偏移，出界的格子会被自动跳过
4. **与其他放置器串联**：本电池的输出 maskA/maskB 可作为下一个放置器的输入，支持链式放置
