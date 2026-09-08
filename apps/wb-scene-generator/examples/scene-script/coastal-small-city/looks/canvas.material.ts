// @scene-module-id module.coastal.look.canvas
const surface = previewSurface({
  r: 0.78,
  g: 0.62,
  b: 0.34,
  roughness: 0.74,
  metallic: 0.01,
})
export const canvas = materialLook({
  id: "canvas",
  surface: surface.surface,
})
