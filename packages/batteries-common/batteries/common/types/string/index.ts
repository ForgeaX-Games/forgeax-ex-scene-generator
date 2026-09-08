/**
 * type_string — 零变换透传。
 *
 * 端口 access 为 "tree"，dispatcher 把整棵 DataTree 不 fanout、不 normalize
 * 直接传入。这里把输入原样作为输出返回，dispatcher 识别到返回值是 DataTree 后
 * 会整棵 pass-through，因此 branches/paths/version 全部保持不变。
 *
 * 注意：不要使用任何 parse/make/normalize helper —— 那会改变数据形态；
 * 透传必须原样回传以保证结构零变换。
 */
export function typeString(input: Record<string, unknown>): Record<string, unknown> {
  return { value: input.value };
}
