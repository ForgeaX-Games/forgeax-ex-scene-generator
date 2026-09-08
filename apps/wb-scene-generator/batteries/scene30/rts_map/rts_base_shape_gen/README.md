# rts_base_shape_gen — RTS 基地形状生成

## 功能

使用 **竞争膨胀 + 斥力间隙** 算法，生成 SC2 风格的多个独立但紧靠的有机平台 blob。

## 核心理解

观察 SC2 地图的角落区域：

```
  ┌─────────────────────┐
  │                     │
  │   ╭───╮   ╭────╮   │   ← 3 个独立的有机 blob
  │   │ 1 │   │  2 │   │     彼此紧靠但有间隙
  │   ╰─┬─╯   ╰──┬─╯   │     每个 blob 有圆润凹凸的边缘
  │     │  gap    │     │
  │   ╭─┴────────┴─╮   │
  │   │     3      │   │
  │   ╰────────────╯   │
  └─────────────────────┘
```

**不是**一个融合的大 blob，而是**多个独立区域**，通过碰撞/斥力保持间隙。

## 算法原理

### 1. 种子放置（排斥采样）

在网格中心 60% 椭圆区域内放置 `numSeeds` 个种子，极坐标均匀采样 + `minSpacing` 排斥。每个种子独立赋予随机半径。

### 2. 竞争 BFS 膨胀

所有种子同时放入共享队列，按 FIFO 顺序轮流膨胀（公平竞争）。

每个种子扩展自己的独立区域 ID，**先到先得**——一个格子只能被一个种子占领。

### 3. 斥力间隙（核心创新）

膨胀时，对每个候选邻居格子检查 `gapWidth` 范围内是否有**其他区域**的格子：

```
对候选格子 (nx, ny)：
  扫描 gapWidth 范围内的所有格子
  若发现属于其他区域的格子 → 跳过，不生长
  → 自然形成两个区域之间的间隙/碰撞边界
```

### 4. 概率生长（有机边缘）

```
distFactor = 1 - dist/maxRadius   (距离衰减)
noise = hash2d(nx,ny) * 2 - 1     (空间噪声)
prob = growProb × distFactor + noise × noiseAmp
```

### 5. 后处理

- 每个区域独立保留最大连通分量
- 清除面积 < 8 格的碎片

## 输入参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `width` | number | 45 | 网格宽度 |
| `height` | number | 45 | 网格高度 |
| `numSeeds` | number | 3 | 独立 blob 数量（SC2 角落=3） |
| `maxRadius` | number | 14 | 单个 blob 最大膨胀半径 |
| `radiusVariance` | number | 0.25 | 各 blob 半径随机差异 |
| `gapWidth` | number | 2 | 区域间斥力间隙宽度（格） |
| `growProb` | number | 0.88 | 基础生长概率 |
| `noiseAmp` | number | 0.12 | 噪声调制幅度 |
| `minSpacing` | number | 8 | 种子最小间距 |
| `seed` | number | 0 | 随机种子 |

## 输出

| 端口 | 类型 | 说明 |
|------|------|------|
| `baseGrid` | grid | 所有区域合并：1=平台，0=空地 |
| `regionGrid` | grid | 各区域独立 ID（1,2,3...），0=空地 |

## 调参建议

- **更多独立 blob**：增大 `numSeeds`（4~5），减小 `minSpacing`（6）
- **blob 更紧靠**：减小 `gapWidth`（1），减小 `minSpacing`
- **blob 更分散**：增大 `gapWidth`（3~4），增大 `minSpacing`（10~12）
- **边缘更粗糙**：增大 `noiseAmp`（0.2），减小 `growProb`（0.8）
- **blob 更饱满**：增大 `growProb`（0.92），减小 `noiseAmp`（0.08）
- **SC2 推荐**：`numSeeds=3, maxRadius=14, gapWidth=2, growProb=0.88`
