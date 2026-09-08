// @scene-module-id module.layeredPlaza
// Local metres: (0, 0)–(24, 24). The well is [12, 12], never continent [1032, 1026].
// Until place/extractPlane land, the parent passes valley-space `center` so the
// deck sits on the village. The well literal stays local for the next AF step.

export const Plaza = defineGroup(
  {
    id: "layered-plaza",
    version: "1.0.0",
    inputs: {
      heightGrid: { type: Grid, label: "高度场" },
      center: { type: Point2d, access: "item", required: true, label: "父级中心" },
    },
    outputs: { scene: { type: Scene, label: "广场" } },
  },
  ({ heightGrid, center }) => {
    const well = controlPoints({
      points: [[12, 12]],
    })

    const deck = villagePlaza({
      center,
      heightGrid,
      radius: 7.4,
    })

    const plazaNode = meshSceneNode({
      name: "Plaza",
      mesh: deck.mesh,
    })

    return { scene: plazaNode.scene }
  },
)
