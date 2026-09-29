import { defineGenerator } from '@forgeax/project-generator'

export const growPlot = defineGenerator({
  id: 'grow-plot',
  description: 'Identity step used by an ordinary for-loop over a Grid.',
  inputs: { state: Grid },
  outputs: { state: Grid },
  run(_ctx, args: { state: unknown }) {
    return { state: args.state }
  },
})
