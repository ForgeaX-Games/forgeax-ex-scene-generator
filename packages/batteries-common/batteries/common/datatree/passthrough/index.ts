/**
 * passthrough: 恒等算子——把输入原封不动地输出
 * 输入：value (any) — 任意输入（access:tree，整棵 DataTree 透传）
 * 输出：value (any) — 与输入完全相同
 */

export function passthrough(input: Record<string, unknown>): Record<string, unknown> {
  return { value: input.value };
}
