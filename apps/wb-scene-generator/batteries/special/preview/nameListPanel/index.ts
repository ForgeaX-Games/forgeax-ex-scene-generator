/**
 * nameListPanel 电池执行函数
 *
 * 行为：
 * - 接收 [{id, name, ...}] 格式的名称清单数组
 * - 将每个条目格式化为一行，输出便于阅读的字符串
 * - 无上游连接时输出空字符串
 * - ScenePortValue / SceneSummary 替换为单行摘要，避免把整棵 scene 树（含每颗 voxel）序列化
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
import {
  formatSceneSummary,
  isSceneSummary,
  parseScenePort,
  summarizeScenePort,
} from '../../../../vendor/dist/shared/types/index.js'

function formatItem(item: unknown): string {
  if (isSceneSummary(item)) return formatSceneSummary(item)
  if (parseScenePort(item)) {
    const s = summarizeScenePort(item)
    if (s) return formatSceneSummary(s)
  }
  return JSON.stringify(item)
}

export function nameListPanel(input: Record<string, unknown>): Record<string, unknown> {
  const val = input.input

  if (val === undefined || val === null) {
    return { output: '' }
  }

  // 单个 scene 值（非数组）直接给出单行摘要
  if (isSceneSummary(val)) return { output: formatSceneSummary(val) }
  if (parseScenePort(val)) {
    const s = summarizeScenePort(val)
    if (s) return { output: formatSceneSummary(s) }
  }

  let list: unknown[]

  if (Array.isArray(val)) {
    list = val
  } else if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val)
      list = Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return { output: val }
    }
  } else {
    return { output: JSON.stringify(val) }
  }

  // 每个条目单独一行；scene 走压缩摘要，其他类型保持紧凑 JSON
  const lines = list.map(formatItem)
  const formatted = '[\n' + lines.map(l => '  ' + l).join(',\n') + '\n]'

  return { output: formatted }
}
