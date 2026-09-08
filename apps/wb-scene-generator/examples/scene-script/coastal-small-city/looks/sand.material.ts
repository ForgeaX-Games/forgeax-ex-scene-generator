// @scene-module-id module.coastal.look.sand
const surface = previewSurface({
  r: 0.78,
  g: 0.68,
  b: 0.46,
  roughness: 0.94,
  metallic: 0.01,
})
export const sand = materialLook({
  id: "sand",
  surface: surface.surface,
})
