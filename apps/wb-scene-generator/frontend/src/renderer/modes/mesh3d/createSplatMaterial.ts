// 💡 4-way terrain splat ShaderMaterial.
// Textured layers: albedo + normal blend, with built-in dual-scale anti-tiling.
// physicalWater layers (Water2): Fresnel / absorption / soft specular ball — no maps.

import * as THREE from 'three'
import type { PhysicalWaterParams, TerrainBiomeParams } from './materialsApi'
import type { LoadedPbrMaps } from './loadPbrTextures'

const MAX = 4

const DEFAULT_WATER: PhysicalWaterParams = {
  shallowColor: [0.12, 0.38, 0.48],
  deepColor: [0.02, 0.10, 0.22],
  skyColor: [0.35, 0.48, 0.62],
  ior: 1.333,
  roughness: 0.08,
  specular: 0.95,
  waveScale: 0.4,
  waveSpeed: 0.55,
  opacity: 0.62,
}

function makeDummyTex(color: number): THREE.DataTexture {
  const data = new Uint8Array([
    (color >> 16) & 255,
    (color >> 8) & 255,
    color & 255,
    255,
  ])
  const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  t.needsUpdate = true
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function makeDummyNormal(): THREE.DataTexture {
  const data = new Uint8Array([128, 128, 255, 255])
  const t = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  t.needsUpdate = true
  t.colorSpace = THREE.NoColorSpace
  return t
}

export interface SplatMaterialHandles {
  material: THREE.ShaderMaterial
  /** True when any slot is procedural water (needs continuous time updates). */
  needsWaterAnim: boolean
  disposeExtra: () => void
}

const DEFAULT_BIOME: TerrainBiomeParams = {
  layers: ['Grass', 'Moss', 'Rock'],
  // Grass↔Rock by slope; moss fields = sparse coverage / blend strength (see shadeBiome).
  slopeGrassEnd: 0.28,
  slopeMossEnd: 0.55,
  slopeRockStart: 0.32,
  heightMossStart: 0.22,
  heightRockStart: 0.85,
  tiling: 0.25,
}

export interface SplatMaterialOpts {
  heightMin?: number
  heightMax?: number
}

/**
 * layers[i] ↔ splat RGBA channel i.
 * Mount1 (`terrainBiome`) slots sample Grass/Moss/Rock by slope + elevation.
 */
export function createSplatMaterial(
  splatMap: THREE.Texture,
  layers: Array<LoadedPbrMaps | null | undefined>,
  opts?: SplatMaterialOpts,
): SplatMaterialHandles {
  const dummies: THREE.Texture[] = []
  const albedo: THREE.Texture[] = []
  const normals: THREE.Texture[] = []
  const tiling = new Float32Array(MAX)
  const normalFlipY = new Float32Array(MAX)
  const isWater = new Float32Array(MAX)
  const isBiome = new Float32Array(MAX)
  let needsWaterAnim = false

  let water = DEFAULT_WATER
  let biome = DEFAULT_BIOME
  let grassMap: THREE.Texture = makeDummyTex(0x4a7a32)
  let mossMap: THREE.Texture = makeDummyTex(0x3a5a28)
  let rockMap: THREE.Texture = makeDummyTex(0x6a6a6a)
  let grassN: THREE.Texture = makeDummyNormal()
  let mossN: THREE.Texture = makeDummyNormal()
  let rockN: THREE.Texture = makeDummyNormal()
  dummies.push(grassMap, mossMap, rockMap, grassN, mossN, rockN)

  for (let i = 0; i < MAX; i++) {
    const L = layers[i]
    if (L?.procedural === 'physicalWater') {
      isWater[i] = 1
      isBiome[i] = 0
      needsWaterAnim = true
      if (L.water) water = L.water
      const a = makeDummyTex(0x1a6a7a)
      const n = makeDummyNormal()
      dummies.push(a, n)
      albedo.push(a)
      normals.push(n)
      tiling[i] = 1
      normalFlipY[i] = 1
    } else if (L?.procedural === 'terrainBiome' && L.biomeMaps) {
      isWater[i] = 0
      isBiome[i] = 1
      biome = L.biomeMaps.params
      const g = L.biomeMaps.grass
      const m = L.biomeMaps.moss
      const r = L.biomeMaps.rock
      if (g?.map) grassMap = g.map
      if (m?.map) mossMap = m.map
      if (r?.map) rockMap = r.map
      if (g?.normalMap) grassN = g.normalMap
      if (m?.normalMap) mossN = m.normalMap
      if (r?.normalMap) rockN = r.normalMap
      const a = makeDummyTex(0x5a7a40)
      const n = makeDummyNormal()
      dummies.push(a, n)
      albedo.push(a)
      normals.push(n)
      tiling[i] = biome.tiling
      normalFlipY[i] = 1
    } else if (L?.map) {
      isWater[i] = 0
      isBiome[i] = 0
      albedo.push(L.map)
      tiling[i] = L.tiling > 0 ? L.tiling : 1
      if (L.normalMap) {
        normals.push(L.normalMap)
        normalFlipY[i] = L.normalSpace === 'DX' ? -1 : 1
      } else {
        const n = makeDummyNormal()
        dummies.push(n)
        normals.push(n)
        normalFlipY[i] = 1
      }
    } else {
      isWater[i] = 0
      isBiome[i] = 0
      const a = makeDummyTex(0x808080)
      const n = makeDummyNormal()
      dummies.push(a, n)
      albedo.push(a)
      normals.push(n)
      tiling[i] = 1
      normalFlipY[i] = 1
    }
  }

  const hMin = opts?.heightMin ?? 0
  const hMax = opts?.heightMax ?? (hMin + 8)

  const material = new THREE.ShaderMaterial({
    lights: false,
    transparent: needsWaterAnim,
    depthWrite: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    uniforms: {
      splatMap: { value: splatMap },
      map0: { value: albedo[0] },
      map1: { value: albedo[1] },
      map2: { value: albedo[2] },
      map3: { value: albedo[3] },
      normal0: { value: normals[0] },
      normal1: { value: normals[1] },
      normal2: { value: normals[2] },
      normal3: { value: normals[3] },
      tiling0: { value: tiling[0] },
      tiling1: { value: tiling[1] },
      tiling2: { value: tiling[2] },
      tiling3: { value: tiling[3] },
      normalFlipY0: { value: normalFlipY[0] },
      normalFlipY1: { value: normalFlipY[1] },
      normalFlipY2: { value: normalFlipY[2] },
      normalFlipY3: { value: normalFlipY[3] },
      isWater0: { value: isWater[0] },
      isWater1: { value: isWater[1] },
      isWater2: { value: isWater[2] },
      isWater3: { value: isWater[3] },
      isBiome0: { value: isBiome[0] },
      isBiome1: { value: isBiome[1] },
      isBiome2: { value: isBiome[2] },
      isBiome3: { value: isBiome[3] },
      biomeGrassMap: { value: grassMap },
      biomeMossMap: { value: mossMap },
      biomeRockMap: { value: rockMap },
      biomeGrassN: { value: grassN },
      biomeMossN: { value: mossN },
      biomeRockN: { value: rockN },
      biomeTiling: { value: biome.tiling },
      slopeGrassEnd: { value: biome.slopeGrassEnd },
      slopeMossEnd: { value: biome.slopeMossEnd },
      slopeRockStart: { value: biome.slopeRockStart },
      heightMossStart: { value: biome.heightMossStart },
      heightRockStart: { value: biome.heightRockStart },
      heightMin: { value: hMin },
      heightMax: { value: hMax },
      waterShallow: { value: new THREE.Vector3(...water.shallowColor) },
      waterDeep: { value: new THREE.Vector3(...water.deepColor) },
      waterSky: { value: new THREE.Vector3(...water.skyColor) },
      waterIor: { value: water.ior },
      waterRough: { value: water.roughness },
      waterSpec: { value: water.specular },
      waterWaveScale: { value: water.waveScale },
      waterWaveSpeed: { value: water.waveSpeed },
      waterOpacity: { value: water.opacity },
      time: { value: 0 },
      ambient: { value: 0.7 },
      lightDir: { value: new THREE.Vector3(-0.4, -0.5, 0.85).normalize() },
      lightIntensity: { value: 1.2 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vMapUv;
      varying vec2 vSplatUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vViewDir;
      attribute vec2 splatUv;

      void main() {
        vMapUv = uv;
        vSplatUv = splatUv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D splatMap;
      uniform sampler2D map0, map1, map2, map3;
      uniform sampler2D normal0, normal1, normal2, normal3;
      uniform float tiling0, tiling1, tiling2, tiling3;
      uniform float normalFlipY0, normalFlipY1, normalFlipY2, normalFlipY3;
      uniform float isWater0, isWater1, isWater2, isWater3;
      uniform float isBiome0, isBiome1, isBiome2, isBiome3;
      uniform sampler2D biomeGrassMap, biomeMossMap, biomeRockMap;
      uniform sampler2D biomeGrassN, biomeMossN, biomeRockN;
      uniform float biomeTiling;
      uniform float slopeGrassEnd, slopeMossEnd, slopeRockStart;
      uniform float heightMossStart, heightRockStart;
      uniform float heightMin, heightMax;
      uniform vec3 waterShallow, waterDeep, waterSky;
      uniform float waterIor, waterRough, waterSpec, waterWaveScale, waterWaveSpeed, waterOpacity;
      uniform float time;
      uniform float ambient;
      uniform vec3 lightDir;
      uniform float lightIntensity;

      varying vec2 vMapUv;
      varying vec2 vSplatUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vViewDir;

      vec3 sampleNormal(sampler2D tex, vec2 uv, float flipY) {
        vec3 n = texture2D(tex, uv).xyz * 2.0 - 1.0;
        n.y *= flipY;
        return normalize(n);
      }

      // Stable spatial hash / value noise (anti-tile + Mount1 moss).
      float hash21(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      // Mild dual-scale anti-tile: same orientation, nearby second UV, low blend weight.
      // (No stochastic rotate — that reads as warping on sand/rock.)
      vec3 antiTileB(vec2 baseUv) {
        vec2 uvB = baseUv * 1.73 + vec2(0.37, 0.19);
        // Keep B contribution modest so the primary tile stays readable.
        float w = 0.18 + 0.22 * valueNoise(vWorldPos.xy * 0.12);
        return vec3(uvB, w);
      }

      vec3 varyAlbedo(vec3 c) {
        float v = valueNoise(vWorldPos.xy * 0.04);
        c *= 0.97 + 0.06 * v; // subtle value only
        return c;
      }

      vec3 sampleAlbedoAntiTile(sampler2D tex, vec2 baseUv) {
        vec3 b = antiTileB(baseUv);
        vec3 c = mix(texture2D(tex, baseUv).rgb, texture2D(tex, b.xy).rgb, b.z);
        return varyAlbedo(c);
      }

      vec3 sampleNormalAntiTile(sampler2D tex, vec2 baseUv, float flipY) {
        vec3 b = antiTileB(baseUv);
        // Normals: even softer mix so lighting doesn't swim.
        float w = b.z * 0.5;
        return normalize(mix(
          sampleNormal(tex, baseUv, flipY),
          sampleNormal(tex, b.xy, flipY),
          w
        ));
      }

      // Wave height field (0..1-ish) + normal in world XY (Z-up).
      float waterWaveHeight(vec3 wp, float t) {
        float s = waterWaveScale;
        float sp = waterWaveSpeed;
        float h =
          0.55 * sin(wp.x * 0.12 * s + t * sp) * cos(wp.y * 0.10 * s - t * sp * 0.75) +
          0.30 * sin(wp.x * 0.27 * s - t * sp * 1.35 + 1.7) * cos(wp.y * 0.21 * s + t * sp * 0.95) +
          0.20 * sin((wp.x + wp.y) * 0.19 * s + t * sp * 0.55);
        return h * 0.5 + 0.5;
      }

      vec3 waterWaveNormal(vec3 wp, float t) {
        float s = waterWaveScale;
        float sp = waterWaveSpeed;
        float n1 = sin(wp.x * 0.11 * s + t * sp) * cos(wp.y * 0.09 * s - t * sp * 0.7);
        float n2 = sin(wp.x * 0.23 * s - t * sp * 1.3 + 1.7) * cos(wp.y * 0.19 * s + t * sp * 0.9);
        float n3 = sin((wp.x + wp.y) * 0.17 * s + t * sp * 0.5);
        return normalize(vec3(n1 * 0.45 + n2 * 0.25, n2 * 0.45 + n3 * 0.25, 1.0));
      }

      float fresnelSchlick(float cosTheta, float ior) {
        float f0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
        float m = 1.0 - clamp(cosTheta, 0.0, 1.0);
        return f0 + (1.0 - f0) * m * m * m * m * m;
      }

      // Returns lit RGB; foam amount written via inout.
      vec3 shadeWater(vec3 geomN, vec3 V, vec3 L, inout float foamOut) {
        float h = waterWaveHeight(vWorldPos, time);
        vec3 waveN = waterWaveNormal(vWorldPos, time);
        vec3 N = normalize(mix(geomN, normalize(geomN + waveN * 0.55), 0.75));
        float NdV = max(dot(N, V), 0.0);
        float F = fresnelSchlick(NdV, waterIor);

        // Keep body color dominant; sky reflection only at strong fresnel.
        vec3 body = mix(waterDeep, waterShallow, pow(NdV, 0.7));
        float horizon = clamp(N.z * 0.5 + 0.5, 0.0, 1.0);
        vec3 reflection = mix(waterDeep * 1.05, waterSky, horizon);
        vec3 diffuse = mix(body, reflection, F * 0.45);

        vec3 H = normalize(L + V);
        float NdH = max(dot(N, H), 0.0);
        float rough = max(waterRough, 0.02);
        float specPower = mix(220.0, 20.0, rough);
        float spec = pow(NdH, specPower) * waterSpec * (0.25 + 0.55 * F);

        // Subtle crest foam — not blown-out white.
        float crest = smoothstep(0.72, 0.95, h);
        float steep = clamp(length(waveN.xy) * 1.4, 0.0, 1.0);
        float sparkle = pow(NdH, 64.0) * steep * 0.35;
        foamOut = clamp(crest * 0.45 + steep * 0.15 + sparkle, 0.0, 1.0);

        // Dimmer wrap so water reads cooler / deeper than land materials.
        float wrap = 0.22 + 0.55 * max(dot(N, L), 0.0);
        vec3 lit = diffuse * (ambient * 0.55 + lightIntensity * 0.75 * wrap) + vec3(spec);
        lit = mix(lit, mix(waterShallow, vec3(0.78, 0.86, 0.92), 0.55), foamOut * 0.35);
        return lit;
      }

      vec3 shadeTextured(vec3 albedo, vec3 nTex, vec3 geomN, vec3 L) {
        vec3 N = normalize(mix(geomN, normalize(geomN + nTex * 0.35), 0.65));
        float diff = 0.2 + 0.8 * max(dot(N, L), 0.0);
        return albedo * (ambient + lightIntensity * diff);
      }

      // Mount1: cliffs→Rock, gentle→Grass; Moss = sparse procedural speckles.
      // heightMossStart ≈ moss coverage (0–1); slopeMossEnd ≈ moss blend strength when hit.
      // abs(Nz) so DoubleSide backfaces don't read as vertical cliffs.
      vec3 shadeBiome(vec3 geomN, vec3 L) {
        float slope = 1.0 - clamp(abs(geomN.z), 0.0, 1.0);
        float hSpan = max(heightMax - heightMin, 0.001);
        float hNorm = clamp((vWorldPos.z - heightMin) / hSpan, 0.0, 1.0);

        // Primary: Grass ↔ Rock by slope (voxel cliff steps sit ~0.3–0.7).
        // slopeGrassEnd = grass fade start; slopeRockStart = rock becomes dominant.
        float rockAmt = smoothstep(slopeGrassEnd, min(max(slopeRockStart, slopeGrassEnd + 0.08) + 0.2, 0.95), slope);
        // Very steep faces lock to rock.
        rockAmt = max(rockAmt, smoothstep(0.52, 0.72, slope));
        // Mild peak accent only on already-sloped ground.
        float high = smoothstep(heightRockStart, min(heightRockStart + 0.12, 1.0), hNorm);
        rockAmt = clamp(rockAmt + high * smoothstep(0.25, 0.55, slope) * 0.2, 0.0, 1.0);

        float wRock = rockAmt;
        float wGrass = 1.0 - rockAmt;

        // Moss speckles: multi-scale noise "lottery", denser on mid-slopes / grass edges.
        float mossCoverage = clamp(heightMossStart, 0.05, 0.55);
        float mossStrength = clamp(slopeMossEnd, 0.2, 0.85);
        float cell = 1.35; // world-space patch scale
        float n1 = valueNoise(vWorldPos.xy * cell);
        float n2 = valueNoise(vWorldPos.xy * cell * 2.7 + 17.3);
        float n3 = hash21(floor(vWorldPos.xy * cell * 0.55));
        float speck = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;

        // Eligible where grass still present or soft transition — not pure cliffs.
        float mossHabit = (1.0 - smoothstep(0.45, 0.75, slope))
                        * (0.35 + 0.65 * smoothstep(0.04, 0.22, slope));
        // Slight preference for mid elevation / damper bands.
        mossHabit *= 0.55 + 0.45 * (1.0 - abs(hNorm - 0.45) * 1.4);
        mossHabit = clamp(mossHabit, 0.0, 1.0);

        float thresh = 1.0 - mossCoverage * mossHabit;
        float mossMask = smoothstep(thresh, min(thresh + 0.12, 0.999), speck);
        // Soft irregular edges inside a patch.
        mossMask *= smoothstep(0.35, 0.75, n2);
        float wMoss = mossMask * mossStrength * (0.55 + 0.45 * wGrass);

        // Carve moss out of grass mostly; leave cliffs rocky.
        wGrass = max(wGrass - wMoss * 0.9, 0.0);
        wRock *= 1.0 - wMoss * 0.25;

        float sum = wGrass + wMoss + wRock + 1e-4;
        wGrass /= sum; wMoss /= sum; wRock /= sum;

        vec2 uv = vMapUv * biomeTiling;
        vec3 cG = sampleAlbedoAntiTile(biomeGrassMap, uv);
        vec3 cM = sampleAlbedoAntiTile(biomeMossMap, uv);
        vec3 cR = sampleAlbedoAntiTile(biomeRockMap, uv);
        vec3 albedo = cG * wGrass + cM * wMoss + cR * wRock;

        vec3 nG = sampleNormalAntiTile(biomeGrassN, uv, 1.0);
        vec3 nM = sampleNormalAntiTile(biomeMossN, uv, 1.0);
        vec3 nR = sampleNormalAntiTile(biomeRockN, uv, 1.0);
        vec3 nTex = normalize(nG * wGrass + nM * wMoss + nR * wRock);
        return shadeTextured(albedo, nTex, geomN, L);
      }

      vec3 shadeSlot(float weight, float isW, float isB, vec3 albedo, vec3 nTex, vec3 geomN, vec3 V, vec3 L, inout float waterW, inout float foamAcc) {
        if (weight < 1e-5) return vec3(0.0);
        if (isW > 0.5) {
          float f = 0.0;
          vec3 c = shadeWater(geomN, V, L, f);
          waterW += weight;
          foamAcc += weight * f;
          return weight * c;
        }
        if (isB > 0.5) return weight * shadeBiome(geomN, L);
        return weight * shadeTextured(albedo, nTex, geomN, L);
      }

      void main() {
        vec4 w = texture2D(splatMap, vSplatUv);
        float sum = w.r + w.g + w.b + w.a;
        if (sum < 1e-4) discard;
        w /= sum;

        vec3 L = normalize(lightDir);
        vec3 V = normalize(vViewDir);
        vec3 geomN = normalize(vNormal);

        vec3 c0 = sampleAlbedoAntiTile(map0, vMapUv * tiling0);
        vec3 c1 = sampleAlbedoAntiTile(map1, vMapUv * tiling1);
        vec3 c2 = sampleAlbedoAntiTile(map2, vMapUv * tiling2);
        vec3 c3 = sampleAlbedoAntiTile(map3, vMapUv * tiling3);

        vec3 n0 = sampleNormalAntiTile(normal0, vMapUv * tiling0, normalFlipY0);
        vec3 n1 = sampleNormalAntiTile(normal1, vMapUv * tiling1, normalFlipY1);
        vec3 n2 = sampleNormalAntiTile(normal2, vMapUv * tiling2, normalFlipY2);
        vec3 n3 = sampleNormalAntiTile(normal3, vMapUv * tiling3, normalFlipY3);

        vec3 lit = vec3(0.0);
        float waterW = 0.0;
        float foam = 0.0;
        float foamAcc = 0.0;

        lit += shadeSlot(w.r, isWater0, isBiome0, c0, n0, geomN, V, L, waterW, foamAcc);
        lit += shadeSlot(w.g, isWater1, isBiome1, c1, n1, geomN, V, L, waterW, foamAcc);
        lit += shadeSlot(w.b, isWater2, isBiome2, c2, n2, geomN, V, L, waterW, foamAcc);
        lit += shadeSlot(w.a, isWater3, isBiome3, c3, n3, geomN, V, L, waterW, foamAcc);

        foam = waterW > 1e-4 ? foamAcc / waterW : 0.0;

        // Soft shore line foam (kept muted).
        float shore = smoothstep(0.1, 0.4, waterW) * smoothstep(0.92, 0.5, waterW);
        float shoreFoam = shore * (0.4 + 0.35 * sin(vWorldPos.x * 0.4 + vWorldPos.y * 0.35 + time * 2.0));
        foam = clamp(foam + shoreFoam * 0.55, 0.0, 1.0);
        lit = mix(lit, mix(waterShallow, vec3(0.7, 0.8, 0.88), 0.4), shoreFoam * 0.4);

        // Facing more transparent; grazing + foam a bit denser.
        float NdV = max(dot(geomN, V), 0.0);
        float Fedge = fresnelSchlick(NdV, waterIor);
        float baseA = mix(waterOpacity * 0.75, min(waterOpacity + 0.12, 0.85), Fedge);
        float alpha = mix(1.0, clamp(baseA + foam * 0.18, 0.28, 0.82), clamp(waterW, 0.0, 1.0));
        gl_FragColor = vec4(lit, alpha);
      }
    `,
  })

  material.userData.needsWaterAnim = needsWaterAnim

  return {
    material,
    needsWaterAnim,
    disposeExtra: () => {
      for (const t of dummies) t.dispose()
    },
  }
}
