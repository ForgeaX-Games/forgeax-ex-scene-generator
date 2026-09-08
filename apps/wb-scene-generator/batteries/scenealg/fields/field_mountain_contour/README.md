# alg_field_mountain_contour · 山地高度场

在**父区域**掩码的有效格上生成 `[0,1]` 山地高度**标量场**（Field），核心算法来自 `scene30/mountain/mountain_contour_generate` 的高度场段：

1. Domain-warped FBM 有机底形  
2. 多峰高斯增益  
3. 等面积分位数重映射（使各高度段占有相近格数）

## 输入

| 端口 | 类型 | 默认 | 说明 |
|------|------|------|------|
| region | grid | 必填 | 父区域掩码，仅非零格参与 |
| peakCount | number | 3 | 山头数量 |
| peakRadius | number | 0.14 | 山头影响半径（归一化 0~1） |
| peakStrength | number | 1.2 | 山头增益强度 |
| noiseScale | number | 2.5 | 底层噪声频率 |
| warpStrength | number | 1.2 | 域扭曲强度 |
| seed | number | 0 | 随机种子 |

## 输出

| 端口 | 类型 | 说明 |
|------|------|------|
| field | grid | `[0,1]` 高度标量场 |

## 下游

接 `alg_partition_field_quantize` 做整数高度截断分区。
