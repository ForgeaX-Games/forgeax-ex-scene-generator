# 墙体提取 (Wall Grid Extractor)

从处理后的室内布局网格中提取所有内部墙体为独立的网格图层。

## 功能特点

1. **内墙识别**：利用建筑轮廓区分内墙（房间隔墙、走廊边墙）与外部空间
2. **透传输出**：outputGrid 原样传递 inputGrid，方便串联后续电池
3. **独立图层**：wallGrid 仅包含墙体，可作为独立渲染图层使用

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| inputGrid | grid | - | 处理后的室内网格 |
| footprintGrid | grid | - | 原始建筑轮廓（非零=内部） |
| wallValue | number | 3 | 墙体在 wallGrid 中的掩码值 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| outputGrid | grid | 透传 inputGrid |
| wallGrid | grid | 仅包含内部墙体的网格 |
