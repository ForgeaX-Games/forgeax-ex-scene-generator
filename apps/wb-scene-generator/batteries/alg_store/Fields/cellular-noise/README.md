# Cellular 噪声 (cellular_noise)

基于 FastNoiseLite 的 Cellular（Voronoi / Worley）噪声生成器。通过在空间中随机放置特征点，根据到最近特征点的距离计算噪声值，可生成细胞、马赛克、裂纹等丰富纹理。

## 算法原理

1. 将空间划分为网格单元，每个单元内有一个被抖动（jitter）偏移的特征点
2. 对每个采样点，搜索周围 3×3 邻域的特征点，计算距离
3. 根据距离函数和返回类型决定最终噪声值
4. 可选分形叠加增加细节层次

## 距离函数

| 名称 | 说明 |
|------|------|
| `Euclidean` | 标准欧氏距离，圆形细胞 |
| `EuclideanSq` | 欧氏距离的平方（默认），运算更快 |
| `Manhattan` | 曼哈顿距离，菱形细胞 |
| `Hybrid` | 欧氏 + 曼哈顿混合，八角形细胞 |

## 返回类型

| 名称 | 说明 |
|------|------|
| `CellValue` | 返回最近特征点的随机值（色块效果） |
| `Distance` | 返回到最近特征点的距离（默认） |
| `Distance2` | 返回到次近特征点的距离 |
| `Distance2Add` | (最近 + 次近) / 2 |
| `Distance2Sub` | 次近 - 最近（凸显边界） |
| `Distance2Mul` | 最近 × 次近 / 2 |
| `Distance2Div` | 最近 / 次近 |

## 参数

### 输入

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `width` | number | 128 | 输出网格宽度 |
| `height` | number | 128 | 输出网格高度 |
| `frequency` | number | 0.02 | 采样频率 |
| `fractalType` | string | None | 分形类型：None / FBm / Ridged / PingPong |
| `octaves` | number | 4 | 分形叠加层数 |
| `lacunarity` | number | 2.0 | 频率倍增系数 |
| `gain` | number | 0.5 | 振幅衰减系数 |
| `distanceFunction` | string | EuclideanSq | 距离函数 |
| `returnType` | string | Distance | 返回类型 |
| `jitter` | number | 1.0 | 特征点抖动系数（0~1） |
| `offsetX` | number | 0 | X 偏移 |
| `offsetY` | number | 0 | Y 偏移 |
| `seed` | number | 1337 | 随机种子 |

### 输出

| 名称 | 类型 | 说明 |
|------|------|------|
| `grid` | grid | 噪声网格，值域 0~1 |

## 使用示例

```ts
import { generateCellularNoise } from "./index";

const result = generateCellularNoise({
  width: 128,
  height: 128,
  frequency: 0.05,
  distanceFunction: "Euclidean",
  returnType: "Distance2Sub",
  jitter: 0.8,
  seed: 42,
});

console.log(result.grid); // number[][] 128×128, values 0~1
```
