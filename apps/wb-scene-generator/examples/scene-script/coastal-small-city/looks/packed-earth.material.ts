// @scene-module-id module.coastal.look.packedEarth
const surface = previewSurface({
  r: 0.76,
  g: 0.60,
  b: 0.38,
  roughness: 0.92,
  metallic: 0.01,
})
export const packedEarth = materialLook({
  id: "packed-earth",
  surface: surface.surface,
})
