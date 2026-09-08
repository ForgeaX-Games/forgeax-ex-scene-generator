// @scene-module-id module.coastal.look.iron
const surface = previewSurface({
  r: 0.18,
  g: 0.19,
  b: 0.21,
  roughness: 0.42,
  metallic: 0.62,
})
export const iron = materialLook({
  id: "iron",
  surface: surface.surface,
})
