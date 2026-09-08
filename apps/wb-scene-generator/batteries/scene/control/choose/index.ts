/** Runtime half of compiler builtin choose; both branches are already evaluated. */
export function sceneChoose(input: Record<string, unknown>): Record<string, unknown> {
  return { value: input.when === true ? input.then : input.otherwise }
}
