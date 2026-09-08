// @scene-module-id module.coastal.look.plaster
const surface = previewSurface({
  r: 0.86,
  g: 0.80,
  b: 0.70,
  roughness: 0.62,
  metallic: 0.01,
})
export const plaster = materialLook({
  id: "plaster",
  surface: surface.surface,
})
