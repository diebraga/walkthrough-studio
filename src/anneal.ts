import { SplatLoader, SplatModifier, Vector3 } from "@manycore/aholo-viewer";
import { ANNEAL_DURATION_MS, easeInOutCubic, openingAnnealProgress } from "./anneal-timing";

export { ANNEAL_DURATION_MS, easeInOutCubic, openingAnnealProgress };

export type SplatCloudMeasure = {
  pivot: Vector3;
  extent: number;
  width: number;
  height: number;
};

function pick(sorted: Float32Array, p: number) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
}

export function measureSplatCloud(data: SplatLoader.SplatData): SplatCloudMeasure {
  const centers = new Float32Array(data.counts * 3);
  data.fillCenters(centers);
  const count = Math.floor(centers.length / 3);
  if (count === 0) {
    return { pivot: new Vector3(0, 0, 0), extent: 1, width: 1, height: 1 };
  }

  const trim = 0.015;
  const extentTrim = 0.001;
  const mid = [0, 0, 0];
  const half = [0, 0, 0];
  const lane = new Float32Array(count);

  for (let axis = 0; axis < 3; axis++) {
    for (let i = 0; i < count; i++) lane[i] = centers[i * 3 + axis];
    lane.sort();
    mid[axis] = (pick(lane, trim) + pick(lane, 1 - trim)) * 0.5;
    half[axis] = (pick(lane, 1 - extentTrim) - pick(lane, extentTrim)) * 0.5;
  }

  const distances = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const offset = i * 3;
    const dx = centers[offset + 0] - mid[0];
    const dy = centers[offset + 1] - mid[1];
    const dz = centers[offset + 2] - mid[2];
    distances[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  distances.sort();

  return {
    pivot: new Vector3(mid[0], mid[1], mid[2]),
    extent: Math.max(pick(distances, 0.98), 1e-3),
    width: Math.max(half[0] * 2, half[2] * 2, 1e-3),
    height: Math.max(half[1] * 2, 1e-3),
  };
}

export function createMcmcAnnealModifier(cloud: SplatCloudMeasure) {
  return new SplatModifier(
    "McmcAnnealIn",
    {
      progress: 1,
      time: 0,
      pivot: cloud.pivot,
      extent: cloud.extent,
      width: cloud.width,
      height: cloud.height,
      amp: 1.15,
      turbulence: 0.74,
      pointSize: 0.0024,
      pointGain: 4.4,
      tint: new Vector3(0.58, 0.78, 1.0),
      glow: 0.42,
    },
    (input, uniform) => ({
      header: `
float waHash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
vec3 waHash31(float p) {
  return fract(vec3(p, p + 17.17, p + 43.31) * vec3(0.1031, 0.11369, 0.13787));
}
float waSmooth(float t) {
  t = clamp(t, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
vec4 waQuatFromTo(vec3 fromDir, vec3 toDir) {
  vec3 f = normalize(fromDir);
  vec3 t = normalize(toDir);
  vec3 axis = cross(f, t);
  float w = 1.0 + dot(f, t);
  if (w < 1e-4) return vec4(0.0, 0.0, 1.0, 0.0);
  return normalize(vec4(axis, w));
}
`,
      content: `
float waProg = clamp(${uniform.progress}, 0.0, 1.0);
if (waProg > 0.0001) {
  float idxf = float(${input.idx});
  vec3 rnd = waHash31(idxf + ${uniform.time} * 0.013);
  vec3 dir = normalize(rnd * 2.0 - 1.0 + vec3(0.0, 0.18, 0.0));
  float shell = mix(0.35, 1.0, waHash11(idxf + 91.7));
  float stagger = waSmooth(clamp((waProg - waHash11(idxf + 19.3) * 0.38) / 0.62, 0.0, 1.0));
  float radius = ${uniform.width} * 2.95 * max(${uniform.amp}, 0.05) * shell;
  vec3 dispersed = ${uniform.pivot} + dir * radius;
  dispersed.y += (rnd.y - 0.5) * ${uniform.height} * ${uniform.turbulence};

  ${input.splat}.center = mix(${input.splat}.center, dispersed, stagger);

  vec3 gaussianScale = ${input.splat}.scales;
  float dotSize = max(${uniform.pointSize} * ${uniform.extent}, 0.0008);
  vec3 pointScale = vec3(dotSize);
  float pointMix = waSmooth(clamp(waProg / 0.72, 0.0, 1.0));
  ${input.splat}.scales = mix(gaussianScale, pointScale, pointMix);
  ${input.splat}.quaternion = mix(${input.splat}.quaternion, waQuatFromTo(vec3(1.0, 0.0, 0.0), dir), pointMix);

  float edge = stagger * (1.0 - stagger) * 3.0;
  ${input.splat}.color.a *= mix(1.0, ${uniform.pointGain}, pointMix) * (1.0 - 0.18 * waProg);
  ${input.splat}.color.rgb = mix(${input.splat}.color.rgb, ${uniform.tint}, clamp(edge * ${uniform.glow}, 0.0, 0.55));
}
`,
    }),
  );
}
