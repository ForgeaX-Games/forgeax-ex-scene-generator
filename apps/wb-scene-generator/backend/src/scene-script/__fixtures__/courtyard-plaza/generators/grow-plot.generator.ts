import { defineGenerator } from '@forgeax/project-generator'

export const growPlot = defineGenerator({
  id: 'grow-plot',
  description: 'Identity step used by a bounded repeat over a WorkGrid.',
  inputs: { state: WorkGrid },
  outputs: { state: WorkGrid },
  run(_ctx, args: { state: unknown }) {
    return { state: args.state }
  },
})
