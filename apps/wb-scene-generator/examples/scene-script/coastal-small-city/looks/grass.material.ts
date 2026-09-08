// @scene-module-id module.coastal.look.grass
const surface = previewSurface({
  r: 0.34,
  g: 0.52,
  b: 0.28,
  roughness: 0.9,
  metallic: 0.01,
})
export const grass = materialLook({
  id: "grass",
  surface: surface.surface,
})
