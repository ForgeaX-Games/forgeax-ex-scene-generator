// @scene-module-id module.coastal.look.foliage
const surface = previewSurface({
  r: 0.28,
  g: 0.48,
  b: 0.26,
  roughness: 0.86,
  metallic: 0.01,
})
export const foliage = materialLook({
  id: "foliage",
  surface: surface.surface,
})
