# Gray-Scott 反应扩散 (reaction_diffusion)

经典 Gray-Scott 反应扩散模型。两种化学物质 A、B 在网格上扩散并相互反应，仅靠两个参数 F、K 就能产生斑点、条纹、迷宫、珊瑚等丰富的有机纹理，是图灵形态发生论的著名实例。

## 功能特点

1. **6 种预设**：spots / stripes / maze / coral / mitosis / worms 直接出图。
2. **custom 模式**：手动调 F/K 探索完整参数空间。
3. **周期边界**：网格无缝可平铺。
4. **三种输出**：B 浓度（最常用，纹理在这里）、A 浓度、二值掩码（B>0.3）。

## 适用情况

- 豹纹/珊瑚/苔藓/树皮等有机纹理生成
- 装饰图案 / UI 背景纹理
- 程序化贴图（输出 maskGrid 直接用作 alpha 通道）

## 基本使用方法

1. 设置 width/height/iterations。128×128 + 5000 步出图通常足够；想要更成熟纹理调到 10000+。
2. 选 `preset` 直接出经典纹理；要探索新图案选 custom 调 F、K。
3. 渲染 `gridB`（连续值）或 `maskGrid`（0/1）。

## 输入参数

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| width | number | 128 | 输出宽度 |
| height | number | 128 | 输出高度 |
| iterations | number | 5000 | 模拟步数 |
| preset | string | spots | spots / stripes / maze / coral / mitosis / worms / custom |
| feedRate | number | 0.055 | F（custom 时生效） |
| killRate | number | 0.062 | K（custom 时生效） |
| diffuseA | number | 1.0 | D_A |
| diffuseB | number | 0.5 | D_B |
| dt | number | 1.0 | 时间步长 |
| seedDensity | number | 0.05 | 初始扰动密度 |
| seed | number | 0 | 随机种子 |

## 输出参数

| 参数名 | 类型 | 说明 |
|--------|------|------|
| gridB | grid | B 浓度，0~1（主纹理） |
| gridA | grid | A 浓度，0~1 |
| maskGrid | grid | B>0.3 二值化 |

## 注意事项

1. **F/K 搜索空间小但敏感**：变化 0.001 就可能从条纹跳到斑点；预设是经过验证的代表性配置。
2. **dt 不宜过大**：默认 1.0 配合 dA=1, dB=0.5 已是稳定上限，调高会发散为 NaN。
3. **iterations 越大越细**：但收益递减，5000 是出图甜点。
4. **初始扰动**：除中心圆形 B 注入外，再按 seedDensity 添加随机扰动，`0` 时仅中心扰动。
