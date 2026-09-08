# 区域嵌套（河岸侵蚀）(Zone Nesting · Riverbank)

`zone_nesting` 的河岸式变体。原版侵蚀近似「等距偏移」——内边界与外轮廓平行内缩；本电池让内边界**深浅不一、忽宽忽窄**，像自然河岸。

## 原理

1. **内向距离场**：padded 多源 BFS 求每个目标格到区域外缘（含网格外）的内向距离 `d`。
2. **变深度侵蚀**：用一张低频 FBM 噪声场决定每处的侵蚀深度
   `depth(x,y) = clamp(erosionStrength + (fbm-0.5)·2·waviness, 0,1) · maxDepth`，
   `d ≤ depth` 的格被侵蚀。噪声高处深切（宽），低处浅切（窄）。
3. **样条平滑**：追踪外轮廓做闭合样条（默认高斯）并重绘为填充区域。

## 数据格式（DataTree）

输入 `inputGrid` 与输出 `outputGrid` 均为 `grid` / `access:item`：每次只处理单张网格，网格列表由引擎自动逐张 fanout / 重组。

## 输入参数

| 参数名 | 类型 | access | 默认值 | 说明 |
|--------|------|--------|--------|------|
| inputGrid | grid | item | — | 输入网格（单张） |
| targetValue | number | item | 1 | 目标区域掩码值 |
| erosionStrength | number | item | 54 | 平均侵蚀深度比例（>1 按 0~100，≤1 按 0~1） |
| maxDepth | number | item | 16 | 最大侵蚀深度（格数），河岸最深能咬入多少 |
| waviness | number | item | 0.8 | 深浅起伏幅度：0≈均匀偏移，越大越忽宽忽窄（推荐 0.5~1.2） |
| featureScale | number | item | 0.06 | 噪声频率：越小波浪越长（大海湾），越大越细碎 |
| seed | number | item | 0 | 侵蚀随机种子，0=时间戳 |
| splineAlgorithm | string | item | gaussian | bezier / cubic_spline / moving_avg / gaussian / polyline_perturb |
| splineSmoothness | number | item | 5 | 样条强度 1~20 |
| splineSeed | number | item | 0 | polyline_perturb 用，0=每次随机 |

## 输出参数

| 参数名 | 类型 | access | 说明 |
|--------|------|--------|------|
| outputGrid | grid | item | 河岸式变深度侵蚀并样条平滑后的结果网格（单张） |

## 注意事项

1. `waviness=0` 退化为近似均匀偏移；增大 `waviness` 与 `maxDepth` 可获得更夸张的海湾/半岛。
2. 强度/深度过大可能把区域咬断成多块，样条阶段只追踪最外层连通域，必要时回落到侵蚀后网格。
