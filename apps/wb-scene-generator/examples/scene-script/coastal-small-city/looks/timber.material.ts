// @scene-module-id module.coastal.look.timber
const surface = previewSurface({
  r: 0.52,
  g: 0.36,
  b: 0.22,
  roughness: 0.78,
  metallic: 0.04,
})
export const timber = materialLook({
  id: "timber",
  surface: surface.surface,
})
