import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'controlPoints',
  contractVersion: '1.0.0',
  opId: 'control_points',
  description: 'Accepts a list of 2D control points as a first-class scene Control Surface parameter.',
  inputs: [
    {
      name: 'points',
      type: 'point2d',
      access: 'list',
      defaultValue: [[6, 24], [18, 20], [30, 26], [42, 22]],
      description: 'List of point2d control coordinates.',
      label: '控制点',
      mode: 'parameter',
      control: true,
    },
  ],
  outputs: [
    {
      name: 'points',
      type: 'point2d',
      access: 'list',
      description: 'The normalized point2d list.',
      label: '控制点',
    },
    {
      name: 'count',
      type: 'number',
      access: 'item',
      description: 'Number of control points.',
      label: '点数',
    },
  ],
  deterministic: true,
})
