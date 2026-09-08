// @scene-module-id module.coastal.look.slate
const surface = previewSurface({
  r: 0.38,
  g: 0.40,
  b: 0.42,
  roughness: 0.58,
  metallic: 0.08,
})
export const slate = materialLook({
  id: "slate",
  surface: surface.surface,
})
