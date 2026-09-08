# RTS四重旋转对称 (rts_quad_symmetry)

将左上角的单个基地形状分别旋转 0°/90°/180°/270° 后放置于完整地图的四个角落，生成具有四重旋转对称性的 RTS 地图基底，同时输出各基地的质心坐标供后续走廊规划使用。

## 功能特点

1. **真旋转对称**：使用旋转而非镜像，确保四个基地形状完全一致，玩家起始条件绝对公平
2. **质心自动计算**：自动计算每个基地的质心坐标，供 rts_terrain_gen 的道路/走廊规划使用
3. **双模式支持**：4way=四角（1v1v1v1 或 2v2）；2way=对角双基地（1v1 经典）
4. **内边距控制**：padding 参数控制基地距地图边缘的空间，留出地图边界区域

## 适用情况

- RTS 对称地图生成流水线的第二步（接 rts_base_shape_gen，输出给 rts_terrain_gen）
- 任何需要四重旋转对称布局的场景

## 基本使用方法

1. 将 `rts_base_shape_gen` 的 `baseGrid` 连接到本节点的 `quadGrid`
2. 设置 `mapWidth`/`mapHeight` 为最终地图尺寸
3. `fullGrid` 输出连接到 `rts_terrain_gen` 的 `inputGrid`
4. `baseCenters` 输出连接到 `rts_resource_placer` 或其他需要基地位置的节点

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| quadGrid | grid | - | 左上角基地形状（来自 rts_base_shape_gen） |
| mapWidth | number | 200 | 完整地图宽度（格） |
| mapHeight | number | 200 | 完整地图高度（格） |
| mode | string | 4way | 对称模式：4way 或 2way |
| padding | number | 4 | 基地距地图边缘间距（格） |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| fullGrid | grid | 含四角基地平台的完整地图掩码 |
| baseCenters | array | 各基地质心坐标列表 `[{x,y}]` |

## 注意事项

1. **尺寸匹配**：quadGrid 的宽/高应不超过 mapWidth/2 - padding，否则相邻角落会重叠
2. **旋转顺序**：左上→右上→右下→左下，顺时针依次旋转90°
3. **非正方形 quadGrid**：旋转后宽高互换，四个角落放置时会自动适应各自旋转后的尺寸
