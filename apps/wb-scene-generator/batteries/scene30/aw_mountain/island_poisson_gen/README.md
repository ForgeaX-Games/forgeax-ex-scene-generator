# 泡泡膨胀岛屿生成 (island_poisson_gen)

泊松盘均匀采样 + 多子种子竞争 BFS 膨胀，生成有机形状的群岛地图。

## 算法流程

```
Step 1: Bridson 泊松盘采样
        在地图内均匀放置 numIslands 个锚点，保证最小间距 minDist
    ↓
Step 2: 子种子散布
        每个锚点衍生 subSeeds 个子种子（以 subSpacing 间距散布）
        → 多个子种子融合形成多叶有机 blob
    ↓
Step 3: 竞争 BFS 膨胀
        所有子种子同时向外膨胀，各岛屿独立扩张
        gapWidth 斥力：与其他岛屿距离 < gapWidth 时停止膨胀
        → 自动形成水面间隙
    ↓
Step 4: 去除小碎片（< 6 格）
    ↓
输出: islandGrid（陆地）+ waterGrid（水面）+ regionGrid（各岛 ID）
```

## 与高度图方式的区别

| | 高度图方式（island_from_height） | 泡泡膨胀方式（本电池） |
|--|--|--|
| 岛屿形状 | 噪声等值线，边界随机 | 有机多叶 blob，更像手绘地图 |
| 岛屿间距 | 不保证 | 泊松盘保证最小间距 |
| 参数直觉 | 频率/阈值，较抽象 | 大小/数量，更直接 |
| 孤立碎片 | 多 | 少（有清理机制） |

## 参数调节建议

| 效果目标 | 推荐参数 |
|----------|---------|
| 少量大岛 | numIslands=4, islandSize=18, minDist=0 |
| 中等群岛（推荐） | numIslands=8, islandSize=12, subSeeds=4 |
| 密集小岛群 | numIslands=15, islandSize=7, minDist=15 |
| 更有机的海岸线 | noiseAmp=0.25, subSeeds=5 |
| 岛屿更圆润 | subSeeds=2, noiseAmp=0.05 |

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| width | number | 80 | 地图宽度（格） |
| height | number | 80 | 地图高度（格） |
| numIslands | number | 8 | 岛屿数量上限 |
| minDist | number | 0 | 岛屿锚点最小间距，0=自动 |
| islandSize | number | 12 | 岛屿最大膨胀半径 |
| subSeeds | number | 4 | 每岛子种子数（控制叶瓣数） |
| subSpacing | number | 5 | 子种子间距 |
| radiusVar | number | 0.3 | 子种子大小随机差异（0~0.8） |
| gapWidth | number | 3 | 岛屿间最小水面间隙 |
| growProb | number | 0.88 | BFS 生长概率 |
| noiseAmp | number | 0.15 | 边缘噪声强度（海岸线有机度） |
| seed | number | 0 | 随机种子，0=时间戳 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| islandGrid | grid | 陆地掩码：1=陆地，0=水面 |
| waterGrid | grid | 水面掩码：1=水面，0=陆地 |
| regionGrid | grid | 各岛 1-based ID，0=水面 |

## 注意事项

1. **islandSize vs minDist**：`minDist` 应大于 `islandSize`，否则相邻岛屿会因斥力留下大量空白。建议 `minDist ≈ islandSize * 2`，或设为 0 自动计算。
2. **gapWidth 控制水面宽度**：`gapWidth` 越大岛屿间水面越宽，但也会使岛屿更小（膨胀受限）。
3. **regionGrid 可继续处理**：可接 `region_boundary_smooth` 对岛屿边界做进一步平滑。
