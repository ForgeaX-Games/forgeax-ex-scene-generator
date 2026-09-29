import { defineGenerator } from '@forgeax/project-generator'

export const solveCourtyard = defineGenerator({
  id: 'solve-courtyard',
  description: 'Project-local courtyard solver. fail=1 is the execution-error fixture.',
  inputs: {
    grid: Grid,
    fail: { type: NumberValue, defaultValue: 0 },
  },
  outputs: { placements: Any },
  run(_ctx, args: { grid: unknown; fail: number }) {
    if (args.fail) throw new Error('courtyard solver rejected the work grid')
    return { placements: { placements: [] } }
  },
})
