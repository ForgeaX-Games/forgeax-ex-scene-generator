# L-System 分形 (l_system)

基于 Lindenmayer 系统（L-System）的分形/分支结构生成器。通过文法规则的迭代重写和海龟绘图（Turtle Graphics）解释，在网格掩码内生成多种拓扑结构。

## 功能特点

1. **完整的 L-System 引擎**：支持确定性和随机性（stochastic）产生规则，多备选项可按权重随机选取
2. **海龟绘图解释器**：F/G（前进画线）、f（前进不画）、+/-（转向）、\[/\]（分支入栈/出栈）、|（反向）
3. **6 种内置预设**：有机分支、河流三角洲、道路网络、分形树、龙曲线、希尔伯特曲线，覆盖常见地图生成场景
4. **自动缩放适配**：无论 L-System 输出的绝对尺寸如何，均自动缩放并居中到网格掩码区域内
5. **分支衰减**：线条宽度和步长在每层分支中独立衰减，产生自然的粗→细层次感
6. **角度抖动**：可配置的随机转向扰动，打破对称性，使确定性 L-System 也能产生有机感
7. **掩码约束**：可选将绘制限制在掩码非零区域内，防止越界

## 适用场景

- **道路/街道网络**：使用 road_network 预设或 90° 角度的自定义规则，生成正交道路骨架
- **河流/水系分支**：使用 river_delta 预设，生成从源头向下游逐渐分叉的三角洲形态
- **洞穴/根系/脉络**：使用 organic_branch 预设，生成不对称的有机分支网络
- **装饰性分形图案**：使用 fractal_tree 或 dragon_curve 预设，生成视觉上复杂的分形结构
- **空间填充路径**：使用 hilbert_curve 预设，生成遍历整个区域的连续路径（迷宫、巡逻路线）
- **自定义拓扑**：通过自由编写公理和规则，实现任意 L-System 设计

## 预设模式

| 预设名 | 公理 | 规则 | 角度 | 迭代 | 适用场景 |
|--------|------|------|------|------|----------|
| organic_branch | X | X=F-\[\[X\]+X\]+F\[+FX\]-X; F=FF | 22.5° | 5 | 洞穴、根系、有机网络 |
| river_delta | F | F=F\[+F\]F\[-F\]F | 25.7° | 4 | 河流三角洲、水系分支 |
| road_network | F | F=FF\[+F\]\[-F\] | 90° | 4 | 正交道路、走廊骨架 |
| fractal_tree | F | F=FF+\[+F-F-F\]-\[-F+F+F\] | 22.5° | 4 | 对称树形、装饰纹理 |
| dragon_curve | F | F=F+G; G=F-G | 90° | 12 | 龙曲线、空间填充路径 |
| hilbert_curve | A | A=-BF+AFA+FB-; B=+AF-BFB-FA+ | 90° | 4 | 空间填充、迷宫路径 |

## 算法原理

### 1. 文法字符串生成

从公理（axiom）出发，每次迭代将字符串中的每个字符按规则替换：

```
迭代 0: X
迭代 1: F-[[X]+X]+F[+FX]-X     （X 被替换, F→FF）
迭代 2: FF-[[F-[[X]+X]+F[+FX]-X]+...]  （继续展开）
...
```

当规则含有多个备选项（用 `|` 分隔）时，每次替换随机选取一个备选项（按权重概率），实现随机 L-System。

字符串长度上限为 500,000 字符，超出时截断。

### 2. 海龟绘图解释

将最终字符串逐字符解释为海龟指令：

| 字符 | 动作 |
|------|------|
| F, G | 沿当前方向前进 stepLength 并画线 |
| f | 沿当前方向前进 stepLength，不画线 |
| + | 顺时针旋转 angle 度 |
| - | 逆时针旋转 angle 度 |
| \[ | 将当前状态（位置、朝向、宽度、步长）入栈；宽度 ×= widthDecay，步长 ×= lengthDecay |
| \] | 从栈中恢复状态（回到分支起点） |
| \| | 反向（旋转 180°） |
| 其他 | 忽略（仅参与规则重写） |

朝向约定：0° = 向上（−y），90° = 向右（+x），180° = 向下（+y），270° = 向左（−x）。

### 3. 自动缩放

计算所有线段的包围盒（bounding box），等比例缩放并居中到掩码区域的有效范围内（减去 padding），确保输出始终适配网格。

### 4. 光栅化

沿每条线段以亚像素步进，在每个采样点绘制指定半径的圆盘。像素宽度 = `width × lineWidth`（width 受分支深度衰减影响，最小为 1 像素）。

当 `constrainToMask=true` 时，仅在掩码非零区域内绘制。

## 基本使用方法

1. 连接一个网格（如矩形全 1 掩码或已有地图区域）到 `grid` 输入端口
2. 选择 `preset` 预设（推荐从 organic_branch 或 road_network 开始）
3. 调整 `lineWidth` 和 `iterations` 控制结构密度
4. 用 `angleJitter` 增加有机感，用 `widthDecay`/`lengthDecay` 控制层次衰减
5. 设置 `seed=0` 获得随机结果，或指定固定值重复相同布局

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| grid | grid | — | 输入掩码，非零区域为绘制域 |
| preset | string | none | 预设模式（none/organic_branch/river_delta/road_network/fractal_tree/dragon_curve/hilbert_curve） |
| axiom | string | X | L-System 公理字符串 |
| rules | string | X=F-\[\[X\]+X\]+F\[+FX\]-X;F=FF | 产生规则（分号分隔多条；竖线分隔随机备选项） |
| iterations | number | 5 | 规则迭代次数（1~15） |
| angle | number | 22.5 | 转向角度（度，0.1~180） |
| startAngle | number | 0 | 初始朝向（度，0~360） |
| lineWidth | number | 2 | 基础线条宽度（像素，1~20） |
| widthDecay | number | 0.75 | 分支宽度衰减因子（0.1~1） |
| lengthDecay | number | 0.8 | 分支步长衰减因子（0.1~1） |
| angleJitter | number | 3 | 转向角度随机抖动范围（度，0~45），使 seed 产生可见差异 |
| padding | number | 2 | 与掩码边界的内边距（像素，0~20） |
| constrainToMask | boolean | true | 是否约束绘制到掩码区域内 |
| seed | number | 0 | 随机种子，0=自动随机 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| grid | grid | 输出网格，L-System 结构区域=1，其余=0 |

## 参数调节指南

### 结构密度
- 更密集：增加 `iterations`（如 6~7）或降低 `lengthDecay`（如 0.6）
- 更稀疏：减少 `iterations`（如 3~4）或提高 `lengthDecay`（如 0.95）

### 线条粗细
- 更粗：增大 `lineWidth`（如 4~6）
- 更细：减小 `lineWidth`（如 1），并设置 `widthDecay=1` 保持均匀

### 分支层次感
- 强层次（粗主干 + 细分支）：降低 `widthDecay`（如 0.5~0.6）和 `lengthDecay`（如 0.6~0.7）
- 均匀结构：设置 `widthDecay=1.0` 和 `lengthDecay=1.0`

### 自然/有机感
- 更自然：增加 `angleJitter`（如 5~15）打破对称性
- 更规则：设置 `angleJitter=0`（完全确定性）

### 转向风格
- 正交/网格状：`angle=90`
- 自然植物感：`angle=20~30`
- 雪花/六角形：`angle=60`
- 三角形分形：`angle=120`

### 随机 L-System
- 在规则中使用 `|` 分隔备选项：`F=F[+F]F[-F]F|F[+F][-F]F|FF[-F]F`
- 可加 `:权重` 控制概率：`F=F[+F]F:3|FF:1`（前者 75% 概率）

## 使用示例

### 使用预设

```json
{
  "grid": [[1,1,1,...],[1,1,1,...],...]，
  "preset": "organic_branch",
  "lineWidth": 2,
  "angleJitter": 5,
  "seed": 42
}
```

### 自定义规则

```json
{
  "grid": [[1,1,1,...],[1,1,1,...],...]，
  "preset": "none",
  "axiom": "F",
  "rules": "F=F[+F]F[-F]F",
  "iterations": 4,
  "angle": 25.7,
  "startAngle": 180,
  "lineWidth": 3,
  "widthDecay": 0.7,
  "lengthDecay": 0.75,
  "seed": 123
}
```

### 输出

```json
{
  "grid": [[0,0,1,0,...],[0,1,1,1,...],...]
}
```

## 注意事项

1. **迭代次数与性能**：L-System 字符串长度随迭代次数指数增长。对于含多个 F 的规则（如 `F=FF`），每次迭代字符串翻倍。建议 iterations ≤ 8 以保证性能；字符串超过 50 万字符时自动截断
2. **预设优先级**：选择预设后，核心参数（axiom、rules、iterations、angle、startAngle、widthDecay、lengthDecay）自动锁定为预设值，不受 UI 默认值干扰。绘制参数（lineWidth、angleJitter、padding 等）仍可自由调节。如需自定义规则，请设置 preset=none
3. **掩码要求**：L-System 图形自动缩放到掩码的包围盒内。建议使用较大的连通区域（至少 30×30）以获得清晰的输出
4. **随机性来源**：有两处使用 RNG：(a) 角度抖动（angleJitter > 0，默认 3°），(b) 随机规则选择（`|` 分隔的备选项）。默认 angleJitter=3，因此不同 seed 会产生微妙不同的输出。若设置 angleJitter=0 且规则为确定性，则 seed 不产生任何效果
5. **分支栈**：\[ 和 \] 必须配对。未配对的 \] 会被安全忽略；多余的 \[ 不影响结果但会增加字符串长度
6. **与其他电池组合**：输出可通过 blend 电池与其他地形叠加，或作为 mask 传递给下游电池
