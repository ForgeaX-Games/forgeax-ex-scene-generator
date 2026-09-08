import { getBuiltinAutotileTemplate } from './templates/index.ts'

/**
 * autotileTemplate: 输出 autotile 切片与邻域拼接规则模板
 *
 * 模板定义已拆分到 templates/*.json：
 *   - single.json
 *   - 4bit-cardinal-16.json
 *
 * 这个入口文件只负责根据 preset 读取内置模板并输出 dict，
 * 便于后续按模板文件独立维护、扩展和审查。
 */
export function autotileTemplate(input: Record<string, unknown>): Record<string, unknown> {
  const preset = typeof input.preset === 'string' ? input.preset : 'single'
  return {
    template: getBuiltinAutotileTemplate(preset),
  }
}
