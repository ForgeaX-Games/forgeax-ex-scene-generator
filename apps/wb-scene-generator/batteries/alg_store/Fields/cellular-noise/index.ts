/**
 * Cellular Noise Generator (cellular_noise)
 * Based on FastNoiseLite (MIT License, Jordan Peck 2023).
 * Supports distance functions (Euclidean / EuclideanSq / Manhattan / Hybrid),
 * return types (CellValue / Distance / Distance2 / Distance2Add/Sub/Mul/Div),
 * and fractal modes (FBm / Ridged / PingPong).
 * Self-contained — no external imports.
 */

const PRIME_X = 501125321;
const PRIME_Y = 1136930381;

// prettier-ignore
const RAND_VECS_2D = [
  -0.2700222198, -0.9628540911, 0.3863092627, -0.9223693152, 0.04444859006, -0.999011673, -0.5992523158, -0.8005602176,
  -0.7819280288, 0.6233687174, 0.9464672271, 0.3227999196, -0.6514146797, -0.7587218957, 0.9378472289, 0.347048376,
  -0.8497875957, -0.5271252623, -0.879042592, 0.4767432447, -0.892300288, -0.4514423508, -0.379844434, -0.9250503802,
  -0.9951650832, 0.0982163789, 0.7724397808, -0.6350880136, 0.7573283322, -0.6530343002, -0.9928004525, -0.119780055,
  -0.0532665713, 0.9985803285, 0.9754253726, -0.2203300762, -0.7665018163, 0.6422421394, 0.991636218, 0.1290606184,
  -0.994696838, 0.1028503788, -0.5379205513, -0.84299554, 0.5022815471, -0.8647041387, 0.4559821461, -0.8899889226,
  -0.8659131224, -0.5001944266, 0.0879458407, -0.9961252577, -0.5051684983, 0.8630207346, 0.7753185226, -0.6315704146,
  -0.6921944612, 0.7217110418, -0.5191659449, -0.8546734591, 0.8978622882, -0.4402764035, -0.1706774107, 0.9853269617,
  -0.9353430106, -0.3537420705, -0.9992404798, 0.03896746794, -0.2882064021, -0.9575683108, -0.9663811329, 0.2571137995,
  -0.8759714238, -0.4823630009, -0.8303123018, -0.5572983775, 0.05110133755, -0.9986934731, -0.8558373281, -0.5172450752,
  0.09887025282, 0.9951003332, 0.9189016087, 0.3944867976, -0.2439375892, -0.9697909324, -0.8121409387, -0.5834613061,
  -0.9910431363, 0.1335421355, 0.8492423985, -0.5280031709, -0.9717838994, -0.2358729591, 0.9949457207, 0.1004142068,
  0.6241065508, -0.7813392434, 0.662910307, 0.7486988212, -0.7197418176, 0.6942418282, -0.8143370775, -0.5803922158,
  0.104521054, -0.9945226741, -0.1065926113, -0.9943027784, 0.445799684, -0.8951327509, 0.105547406, 0.9944142724,
  -0.992790267, 0.1198644477, -0.8334366408, 0.552615025, 0.9115561563, -0.4111755999, 0.8285544909, -0.5599084351,
  0.7217097654, -0.6921957921, 0.4940492677, -0.8694339084, -0.3652321272, -0.9309164803, -0.9696606758, 0.2444548501,
  0.08925509731, -0.996008799, 0.5354071276, -0.8445941083, -0.1053576186, 0.9944343981, -0.9890284586, 0.1477251101,
  0.004856104961, 0.9999882091, 0.9885598478, 0.1508291331, 0.9286129562, -0.3710498316, -0.5832393863, -0.8123003252,
  0.3015207509, 0.9534596146, -0.9575110528, 0.2883965738, 0.9715802154, -0.2367105511, 0.229981792, 0.9731949318,
  0.955763816, -0.2941352207, 0.740956116, 0.6715534485, -0.9971513787, -0.07542630764, 0.6905710663, -0.7232645452,
  -0.290713703, -0.9568100872, 0.5912777791, -0.8064679708, -0.9454592212, -0.325740481, 0.6664455681, 0.74555369,
  0.6236134912, 0.7817328275, 0.9126993851, -0.4086316587, -0.8191762011, 0.5735419353, -0.8812745759, -0.4726046147,
  0.9953313627, 0.09651672651, 0.9855650846, -0.1692969699, -0.8495980887, 0.5274306472, 0.6174853946, -0.7865823463,
  0.8508156371, 0.52546432, 0.9985032451, -0.05469249926, 0.1971371563, -0.9803759185, 0.6607855748, -0.7505747292,
  -0.03097494063, 0.9995201614, -0.6731660801, 0.739491331, -0.7195018362, -0.6944905383, 0.9727511689, 0.2318515979,
  0.9997059088, -0.0242506907, 0.4421787429, -0.8969269532, 0.9981350961, -0.06105507938, -0.9173660799, -0.3980445648,
  -0.8150056635, -0.5794529907, -0.8789331304, 0.4769450202, 0.0158605829, 0.999874213, -0.8095464474, 0.5870558317,
  -0.9165898907, -0.3998286786, -0.8023542565, 0.5968480938, -0.5176737917, 0.8555780767, -0.8154407307, -0.5788405779,
  0.4022010347, -0.9155513791, -0.9052556868, -0.4248672045, 0.7317445619, 0.6815789728, -0.5647632201, -0.8252529947,
  -0.8403276335, -0.5420788535, -0.9314281527, 0.363925262, 0.5238198472, 0.8518290719, 0.7432803869, -0.6689800195,
  -0.985371561, -0.1704197369, 0.4601468731, 0.887888809, -0.1280145052, -0.9917731528, 0.5737681826, 0.8190554587,
  0.7474112518, -0.6642764442, -0.1966188723, -0.9804740402, 0.6145007286, -0.7890327625, 0.06258973166, 0.9980393407,
];

function hashR2(seed: number, xPrimed: number, yPrimed: number): number {
  let h = seed ^ xPrimed ^ yPrimed;
  h = Math.imul(h, 0x27d4eb2d);
  return h;
}

function valCoordR2(seed: number, xPrimed: number, yPrimed: number): number {
  let hash = hashR2(seed, xPrimed, yPrimed);
  hash = Math.imul(hash, hash);
  hash ^= hash << 19;
  return hash * (1 / 2147483648.0);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function pingPong(t: number): number {
  t -= Math.trunc(t * 0.5) * 2;
  return t < 1 ? t : 2 - t;
}

const enum DistFn {
  Euclidean,
  EuclideanSq,
  Manhattan,
  Hybrid,
}

const enum RetType {
  CellValue,
  Distance,
  Distance2,
  Distance2Add,
  Distance2Sub,
  Distance2Mul,
  Distance2Div,
}

function parseDistFn(s: string): DistFn {
  switch (s) {
    case "Euclidean": return DistFn.Euclidean;
    case "Manhattan": return DistFn.Manhattan;
    case "Hybrid":    return DistFn.Hybrid;
    default:          return DistFn.EuclideanSq;
  }
}

function parseRetType(s: string): RetType {
  switch (s) {
    case "CellValue":     return RetType.CellValue;
    case "Distance2":     return RetType.Distance2;
    case "Distance2Add":  return RetType.Distance2Add;
    case "Distance2Sub":  return RetType.Distance2Sub;
    case "Distance2Mul":  return RetType.Distance2Mul;
    case "Distance2Div":  return RetType.Distance2Div;
    default:              return RetType.Distance;
  }
}

function singleCellularR2(
  seed: number,
  x: number,
  y: number,
  jitterMod: number,
  distFn: DistFn,
  retType: RetType,
): number {
  const xr = Math.round(x);
  const yr = Math.round(y);

  let distance0 = 1e10;
  let distance1 = 1e10;
  let closestHash = 0;

  const jitter = 0.43701595 * jitterMod;

  for (let xi = xr - 1; xi <= xr + 1; xi++) {
    for (let yi = yr - 1; yi <= yr + 1; yi++) {
      const hash = hashR2(seed, Math.imul(xi, PRIME_X), Math.imul(yi, PRIME_Y));
      const idx = (hash & 0xfe) >>> 0;
      const vecX = (xi - x) + RAND_VECS_2D[idx]! * jitter;
      const vecY = (yi - y) + RAND_VECS_2D[idx | 1]! * jitter;

      let dist: number;
      switch (distFn) {
        case DistFn.Euclidean:
          dist = Math.sqrt(vecX * vecX + vecY * vecY);
          break;
        case DistFn.Manhattan:
          dist = Math.abs(vecX) + Math.abs(vecY);
          break;
        case DistFn.Hybrid:
          dist = (Math.abs(vecX) + Math.abs(vecY)) + (vecX * vecX + vecY * vecY);
          break;
        default:
          dist = vecX * vecX + vecY * vecY;
          break;
      }

      if (dist < distance0) {
        distance1 = distance0;
        distance0 = dist;
        closestHash = hash;
      } else if (dist < distance1) {
        distance1 = dist;
      }
    }
  }

  switch (retType) {
    case RetType.CellValue: {
      let h = closestHash;
      h = Math.imul(h, h);
      h ^= h << 19;
      return h * (1 / 2147483648.0);
    }
    case RetType.Distance:
      return distance0 - 1;
    case RetType.Distance2:
      return distance1 - 1;
    case RetType.Distance2Add:
      return (distance1 + distance0) * 0.5 - 1;
    case RetType.Distance2Sub:
      return distance1 - distance0 - 1;
    case RetType.Distance2Mul:
      return distance1 * distance0 * 0.5 - 1;
    case RetType.Distance2Div:
      return distance1 > 1e-9 ? distance0 / distance1 - 1 : 0;
    default:
      return distance0 - 1;
  }
}

function calcFractalBounding(octaves: number, gain: number): number {
  let g = Math.abs(gain);
  let amp = g;
  let ampFractal = 1.0;
  for (let i = 1; i < octaves; i++) {
    ampFractal += amp;
    amp *= g;
  }
  return 1 / ampFractal;
}

function fractalFBm(
  seed: number, x: number, y: number,
  octaves: number, lacunarity: number, gain: number, bounding: number,
  jitterMod: number, distFn: DistFn, retType: RetType,
): number {
  let s = seed;
  let sum = 0;
  let amp = bounding;
  let cx = x;
  let cy = y;

  for (let i = 0; i < octaves; i++) {
    const noise = singleCellularR2(s++, cx, cy, jitterMod, distFn, retType);
    sum += noise * amp;
    amp *= lerp(1.0, Math.min(noise + 1, 2) * 0.5, 0.0);
    cx *= lacunarity;
    cy *= lacunarity;
    amp *= gain;
  }
  return sum;
}

function fractalRidged(
  seed: number, x: number, y: number,
  octaves: number, lacunarity: number, gain: number, bounding: number,
  jitterMod: number, distFn: DistFn, retType: RetType,
): number {
  let s = seed;
  let sum = 0;
  let amp = bounding;
  let cx = x;
  let cy = y;

  for (let i = 0; i < octaves; i++) {
    const noise = Math.abs(singleCellularR2(s++, cx, cy, jitterMod, distFn, retType));
    sum += (noise * -2 + 1) * amp;
    amp *= lerp(1.0, 1 - noise, 0.0);
    cx *= lacunarity;
    cy *= lacunarity;
    amp *= gain;
  }
  return sum;
}

function fractalPingPong(
  seed: number, x: number, y: number,
  octaves: number, lacunarity: number, gain: number, bounding: number,
  pingPongStrength: number,
  jitterMod: number, distFn: DistFn, retType: RetType,
): number {
  let s = seed;
  let sum = 0;
  let amp = bounding;
  let cx = x;
  let cy = y;

  for (let i = 0; i < octaves; i++) {
    const noise = pingPong(
      (singleCellularR2(s++, cx, cy, jitterMod, distFn, retType) + 1) * pingPongStrength,
    );
    sum += (noise - 0.5) * 2 * amp;
    amp *= lerp(1.0, noise, 0.0);
    cx *= lacunarity;
    cy *= lacunarity;
    amp *= gain;
  }
  return sum;
}

export function generateCellularNoise(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const w = Math.max(1, Math.min(1024, Math.floor(Number(input.width) || 128)));
  const h = Math.max(1, Math.min(1024, Math.floor(Number(input.height) || 128)));
  const frequency = Number(input.frequency) || 0.02;
  const fractalType = String(input.fractalType ?? "None");
  const octaves = Math.max(1, Math.min(8, Math.floor(Number(input.octaves) || 4)));
  const lacunarity = Number(input.lacunarity) || 2.0;
  const gain = Number(input.gain) || 0.5;
  const ox = Number(input.offsetX) || 0;
  const oy = Number(input.offsetY) || 0;
  const seed = Math.floor(Number(input.seed) || 1337);
  const jitterMod = Math.max(0, Math.min(1, Number(input.jitter) ?? 1.0));
  const distFn = parseDistFn(String(input.distanceFunction ?? "EuclideanSq"));
  const retType = parseRetType(String(input.returnType ?? "Distance"));

  const bounding = calcFractalBounding(octaves, gain);
  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = (x + ox) * frequency;
      const sy = (y + oy) * frequency;

      let raw: number;
      switch (fractalType) {
        case "FBm":
          raw = fractalFBm(seed, sx, sy, octaves, lacunarity, gain, bounding, jitterMod, distFn, retType);
          break;
        case "Ridged":
          raw = fractalRidged(seed, sx, sy, octaves, lacunarity, gain, bounding, jitterMod, distFn, retType);
          break;
        case "PingPong":
          raw = fractalPingPong(seed, sx, sy, octaves, lacunarity, gain, bounding, 2.0, jitterMod, distFn, retType);
          break;
        default:
          raw = singleCellularR2(seed, sx, sy, jitterMod, distFn, retType);
          break;
      }

      grid[y]![x] = raw * 0.5 + 0.5;
    }
  }

  return { grid };
}
