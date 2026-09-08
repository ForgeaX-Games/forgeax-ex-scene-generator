# 对称边替换变形 (tess_sym_deform)

对镶嵌格施加严格对称的边替换变形，保证相邻格子边界精确咬合，每块形状仍然全等。

## 与 tess_edge_deform 的本质区别

| | tess_edge_deform（域变形） | tess_sym_deform（对称边替换） |
|--|--|--|
| 方法 | FBM 噪声位移场扭曲 | 对每条共享边定义同一曲线 |
| 变形后是否全等 | **否**，每块形状变得各不相同 | **是**，严格数学全等 |
| 相邻边是否咬合 | 近似 | **精确**（数学保证） |
| 视觉风格 | 随机有机感 | 艾舍尔风、拼图齿口感 |

## 数学原理

对于格子 A 和格子 B 的共享边：

```
1. 定义法向量 n = normalize(cB - cA)（从 A 指向 B）
2. 定义边方向 e = rotate90(n)
3. 对边上参数 t ∈ [0,1]，变形边位置：
     bump(t) = amplitude × sin(2πt)
   - sin(2πt) 在 t=0 和 t=1 处为 0（端点连续）
   - 前半段正、后半段负（面积守恒，不改变格子总面积）
4. 像素 P 的分类：
     d = dot(P - M, n)（有符号距离，正=在 B 侧）
     t = dot(P - M, e) / edgeLen + 0.5
     P ∈ A 当 d < bump(t)，P ∈ B 当 d ≥ bump(t)

对称性验证：
从 B 侧看同一条边：n' = -n, e' = -e, t' = 1-t
  bump'(t') = sin(2π(1-t)) = -sin(2πt) = -bump(t)
  B 侧条件：d' ≥ bump'(t') → -d ≥ -bump → d ≤ bump
  与 A 侧条件（d < bump）互补，两侧共享同一曲线。✓
```

## 适用情况

- 艾舍尔风有机镶嵌（严格保持格子全等）
- 地图中需要"拼图齿口"感的分区边界
- 需要可重复、无缝贴图的地形分块

## 基本使用方法

```
tess_hex_grid → regionGrid → tess_sym_deform → warpedGrid
```

或接任意镶嵌格（tri/rhombus/herringbone/cairo）均可。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| regionGrid | grid | — | 来自任意镶嵌格电池的 ID 网格（必填） |
| amplitude | number | 3 | 边界曲线最大偏移（格），建议 < edgeLen × 0.3 |
| edgeLen | number | 0 | 格子边长估计值，0=自动检测 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| warpedGrid | grid | 对称边替换变形后的 ID 网格 |

## 参数调节建议

| 效果 | 推荐参数 |
|------|---------|
| 轻微锯齿感（几乎看不出变形） | amplitude=1 |
| 明显拼图齿口感（推荐） | amplitude=3~4 |
| 强烈艾舍尔风变形 | amplitude=6（需 edgeLen≥20） |
| amplitude 超过 edgeLen×0.4 | 格子可能出现孤立像素，不推荐 |
