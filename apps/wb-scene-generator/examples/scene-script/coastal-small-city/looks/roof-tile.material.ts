// @scene-module-id module.coastal.look.roofTile
const surface = previewSurface({
  r: 0.48,
  g: 0.22,
  b: 0.18,
  roughness: 0.72,
  metallic: 0.03,
})
export const roofTile = materialLook({
  id: "roof-tile",
  surface: surface.surface,
})
