# 室内纹理 (indoor_texture)

根据单张楼层掩码网格，用四种算法生成室内地板纹理分布（普通/青苔/裂纹/木/石板），输出单张多值网格（每格为纹理 id 1～5 或 0）与名称清单。

## 数据格式（DataTree）

输入 `inputGrid` 与输出 `outputGrid` 均为 `grid` / `access:item`：每次只处理单张网格，网格列表由引擎自动逐张 fanout / 重组。多种纹理合并在同一张多值网格中输出，下游可 `grid_split_by_value` 按值拆分后分别命名。

## 算法

- `nature`：位置哈希噪声 + 边/角距离衰减（青苔/裂纹近边角加成）
- `water`：模拟湿度（近边）与光照（近中）双场打分
- `smooth`：粗聚类分块后边界过渡混合
- `mixed`：聚类底 + 30% 环境混合 + 边角偏好

## 输入参数

| 参数名 | 类型 | access | 默认值 | 说明 |
|--------|------|--------|--------|------|
| inputGrid | grid | item | — | 单张楼层掩码网格，非零为有效地板 |
| algorithm | string | item | "nature" | nature / water / smooth / mixed |
| seed | number | item | 0 | 随机种子，0 使用当前时间戳 |

## 输出参数

| 参数名 | 类型 | access | 说明 |
|--------|------|--------|------|
| outputGrid | grid | item | 多值纹理网格，每格为纹理 id（1=普通,2=青苔,3=裂纹,4=木,5=石板）或 0 |
| nameList | array | item | 实际出现的纹理条目 `[{id, name, type:'tile'}]`，按 id 1→5 有序 |
