# 宇宙地形生成 (cosmos_terrain_gen)

使用Warped Simplex FBM生成地形高度图、温度图和湿度图，移植自Cosmos Explorer的TerrainGenerator算法。

## 功能特点

1. **Warped Simplex FBM**：先用FBM对坐标做域变形再采样，生成更自然的海岸线和山脉
2. **三通道输出**：同步输出高度/温度/湿度三张独立噪声图
3. **完全确定性**：相同种子始终产生相同地形
4. **高精度编码**：0-1浮点值映射为0-1000整数存储在grid中

## 适用情况

- 需要宇宙/科幻风格星球地形的场景
- 作为cosmos_biome_mapper的上游输入
- 任何需要warped FBM地形噪声图的场景

## 基本使用方法

1. 设置width/height为目标地图尺寸
2. 调整noiseScale控制地形频率（0.01-0.05较合适）
3. 调整warpStrength控制地形扭曲度（5-30）
4. 将三张输出图接入cosmos_biome_mapper

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| width | number | 64 | 网格宽度（列数） |
| height | number | 64 | 网格高度（行数） |
| seed | number | 0 | 随机种子，0使用时间戳 |
| noiseScale | number | 0.02 | FBM采样缩放比例 |
| warpStrength | number | 15 | 域变形强度 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| elevationGrid | grid | 高度图，值0-1000 |
| temperatureGrid | grid | 温度图，值0-1000 |
| moistureGrid | grid | 湿度图，值0-1000 |

## 注意事项

1. **值范围**：grid值为0-1000的整数，对应0.0-1.0，使用时除以1000还原
2. **noiseScale**：过大会使地形破碎，建议0.01-0.05
3. **大尺寸**：超过256x256时计算量较大，建议分块生成
