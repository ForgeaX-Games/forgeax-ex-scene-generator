# alg_points_center_scatter · 中心点采样

以**兴趣点**为中心，在**父 region** 有效格内的圆形半径内采样装饰点位，输出 **points 列表**（与 `alg_field2points` / `NaturalDecorationDistribution` 下游契约一致）。

## 算法来源

`components/decoration/precise_decoration_scatter` 的采样核心：

1. BFS 吸附兴趣点到最近有效格  
2. `scatterRadius` 圆形候选区  
3. `algorithm` 选点：random / cluster / ring / poisson / noise  

## 输入 / 输出

见 `meta.json`。坐标约定：**x→列，y→行**（与 point2d / manual_points 一致）。

## 典型链

```
region → alg_points_center_scatter(point, count, scatterRadius) → points[]
  → grid2node + MultiNames + ObjectAssetName → scene 子树
```
