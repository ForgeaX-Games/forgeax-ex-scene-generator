// @scene-module-id module.coastal.look.cobble
const surface = previewSurface({
  r: 0.30,
  g: 0.29,
  b: 0.28,
  roughness: 0.88,
  metallic: 0.02,
})
export const cobble = materialLook({
  id: "cobble",
  surface: surface.surface,
})
