export interface AttributeTemplate {
  id: string
  label: string
  description: string
  attributes: Record<string, unknown>
}

/** Seed templates for terrain/gameplay decoration — persistence deferred. */
export const ATTRIBUTE_TEMPLATES: AttributeTemplate[] = [
  {
    id: 'terrain-region',
    label: 'Terrain Region',
    description: 'Walkability and biome tags for terrain tiles.',
    attributes: {
      terrain_kind: 'ground',
      walkable: true,
      movement_cost: 1,
      biome: 'grassland',
    },
  },
  {
    id: 'gameplay-area',
    label: 'Gameplay Area',
    description: 'Spawn and encounter metadata for playable zones.',
    attributes: {
      area_id: 'area_01',
      spawn_allowed: true,
      encounter_table: 'default',
    },
  },
  {
    id: 'decoration',
    label: 'Decoration',
    description: 'Blocking and interaction flags for props.',
    attributes: {
      category: 'prop',
      blocking: false,
      interactable: false,
    },
  },
  {
    id: 'scene-export-terrain',
    label: 'Scene Export Terrain',
    description: 'Reference scene.zip terrain template metadata.',
    attributes: {
      export_role: 'terrain',
      template_id: 'ground',
      terrain_type: 'base',
      region: 'default',
      walkable: true,
      explore_speed_mod: 1,
      battle_move_cost: 1,
      area_L0: '',
      area_L1: '',
    },
  },
  {
    id: 'scene-export-object',
    label: 'Scene Export Object',
    description: 'Reference scene.zip object type metadata.',
    attributes: {
      export_role: 'object',
      object_type_id: '',
      category: 'decoration',
      interaction: 'none',
      object_height: 0,
      blocks_movement: false,
      blocks_line_of_sight: false,
      area_L0: '',
      area_L1: '',
    },
  },
]
