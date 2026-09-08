// @scene-module-id module.coastal.look.brick
const surface = previewSurface({
  r: 0.62,
  g: 0.34,
  b: 0.28,
  roughness: 0.84,
  metallic: 0.02,
})
export const brick = materialLook({
  id: "brick",
  surface: surface.surface,
})
