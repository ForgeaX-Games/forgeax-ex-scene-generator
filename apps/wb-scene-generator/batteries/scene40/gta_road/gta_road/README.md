# scene40 / gta_road

城市纹理路网小标签：方向场主路生长 + 街区递归切辅路。

## 电池

| id | 说明 |
|---|---|
| `gta_road` | 输入陆地掩码，输出主路 / 辅路 / 合并路网（主=300，辅=301） |

## 流程

```
landGrid (+ optional heightMap)
  → 方向场 θ(x,y) = baseAngle + organic·noise
  → 主路 agent 生长（分叉 / T 接 / 高度代价）
  → 主路围合块递归二分 → 辅路
  → 按 mainWidth / auxWidth 膨胀
  → mainRoadGrid + auxRoadGrid + roadGrid
```

电池自包含，不依赖 `scene30/gta` 兄弟目录。
