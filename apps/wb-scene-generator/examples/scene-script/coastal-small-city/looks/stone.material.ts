// @scene-module-id module.coastal.look.stone
const surface = previewSurface({
  r: 0.62,
  g: 0.60,
  b: 0.54,
  roughness: 0.82,
  metallic: 0.03,
})
export const stone = materialLook({
  id: "stone",
  surface: surface.surface,
})
