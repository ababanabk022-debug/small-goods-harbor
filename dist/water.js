/**
 * Real-time counterpart of the harbor's Blender water.
 * Y is up; Blender's Y maps to -Z. Ambient waves have a six-second loop;
 * interaction adds a bounded, damped height-field simulation.
 * No image assets, network requests, or Blender scene changes are required.
 */
import { createWaterPhysics } from './water-physics.js?v=12.1';

const TAU = Math.PI * 2;
const DEFAULT_RADIUS = 9.0;
const DEPTH = 1.80;
const DURATION = 6;
const WAVES = [
  { amplitude: 0.024, wavelength: 3.10, direction: [0.894427191, -0.447213595], harmonic: 1, phase: 0.35 },
  { amplitude: 0.014, wavelength: 1.65, direction: [-0.287347886, -0.957826285], harmonic: 2, phase: 1.40 },
  { amplitude: 0.007, wavelength: 0.88, direction: [0.813733471, -0.581238194], harmonic: 3, phase: -0.85 },
];

const APPEARANCES = Object.freeze({
  lagoon: { color: '#168d98', side: '#09687c', opacity: 0.22, sideOpacity: 0.66,
    roughness: 0.10, env: 1.10, caustic: 0.19, causticScale: 1.36,
    absorption: [1.15, 0.46, 0.33], attenuation: '#66c8c1' },
  azure: { color: '#137fab', side: '#07547f', opacity: 0.27, sideOpacity: 0.72,
    roughness: 0.085, env: 1.18, caustic: 0.17, causticScale: 1.22,
    absorption: [1.48, 0.69, 0.39], attenuation: '#5daece' },
  glass: { color: '#7ec5ca', side: '#2a8294', opacity: 0.15, sideOpacity: 0.46,
    roughness: 0.070, env: 1.05, caustic: 0.14, causticScale: 1.16,
    absorption: [0.65, 0.28, 0.22], attenuation: '#9bded6' },
});

const PHYSICS_GLSL = `
uniform sampler2D harborField;
uniform float harborRadius;
uniform float harborFieldSize;
// Explicit interpolation also works without float-linear-filter extensions.
// Normalize wet weights so dry cells do not flatten waves at shore boundaries.
vec4 harborFieldAt(vec2 p) {
  vec2 grid = clamp((p / (2.0 * harborRadius) + 0.5) * (harborFieldSize - 1.0),
                    vec2(0.0), vec2(harborFieldSize - 1.001));
  vec2 cell = floor(grid), f = fract(grid);
  vec2 texel = vec2(1.0 / harborFieldSize);
  vec2 uv = (cell + 0.5) * texel;
  vec4 a = texture2D(harborField, uv);
  vec4 b = texture2D(harborField, uv + vec2(texel.x, 0.0));
  vec4 c = texture2D(harborField, uv + vec2(0.0, texel.y));
  vec4 d = texture2D(harborField, uv + texel);
  vec4 field = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  return vec4(field.xyz / max(field.w, 0.00001), field.w);
}
`;

const WAVE_GLSL = `
${PHYSICS_GLSL}
uniform float harborTime;
vec3 harborAmbientWave(vec2 p) {
  float t = harborTime * 1.0471975512;
  vec3 result = vec3(0.0);
  ${WAVES.map((w) => {
    const k = TAU / w.wavelength;
    return `{
      vec2 direction = vec2(${w.direction[0].toFixed(10)}, ${w.direction[1].toFixed(10)});
      float bendPhase = dot(p, vec2(0.63, 0.81)) + ${w.phase.toFixed(4)} + t;
      float phase = ${k.toFixed(10)} * dot(p, direction) + ${w.phase.toFixed(4)} - ${w.harmonic.toFixed(1)} * t + 0.42 * sin(bendPhase);
      result.x += ${w.amplitude.toFixed(4)} * sin(phase);
      result.yz += ${w.amplitude.toFixed(4)} * cos(phase) *
        (${k.toFixed(10)} * direction + 0.42 * cos(bendPhase) * vec2(0.63, 0.81));
    }`;
  }).join('\n')}
  return result;
}
vec3 harborWave(vec2 p) {
  vec4 field = harborFieldAt(p);
  return (harborAmbientWave(p) + field.xyz) * step(0.001, field.w);
}
`;

// Capture contains the opaque scene in linear light, without water. This is a
// depth-checked screen-space approximation: hidden/off-screen objects cannot be
// recovered. Keep only small wave-relative distortion and reject silhouette
// crossings; color, depth and attenuation always use the same accepted sample.
const OPTICAL_GLSL = `
uniform sampler2D harborSceneColor;
uniform sampler2D harborSceneDepth;
uniform sampler2D harborField;
uniform vec2 harborOpticalResolution;
uniform float harborOpticalEnabled;
uniform mat4 harborOpticalProjection;
uniform mat4 harborOpticalInverseProjection;
uniform mat4 harborOpticalViewToLocal;
uniform vec3 harborAbsorptionCoefficients;
uniform vec3 harborOpticalTint;
uniform float harborRadius;
vec3 harborViewPoint(vec2 uv, float depth) {
  vec4 p = harborOpticalInverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
void harborProtectDryScene() {
  if (harborOpticalEnabled < 0.5) return;
  vec2 uv = gl_FragCoord.xy / harborOpticalResolution;
  float depth = texture2D(harborSceneDepth,uv).r;
  vec3 localPoint = (harborOpticalViewToLocal * vec4(harborViewPoint(uv,depth),1.0)).xyz;
  // Explicit protection complements the restored GPU depth buffer, including
  // silhouettes where the composite anti-aliasing spans a dry and wet pixel.
  if (depth < 0.9999 && (depth < gl_FragCoord.z - 0.000001 || localPoint.y > 0.045)) discard;
}
vec3 harborRefractedScene(vec3 waterViewPosition, vec3 waterNormal, float fresnel) {
  vec2 uv = gl_FragCoord.xy / harborOpticalResolution;
  float baseDepth = texture2D(harborSceneDepth, uv).r;
  vec3 behind = harborViewPoint(uv, baseDepth);
  float gap = max(0.0, waterViewPosition.z - behind.z);
  vec3 incident = isOrthographic ? vec3(0.0, 0.0, -1.0) : normalize(waterViewPosition);
  vec3 localWater = (harborOpticalViewToLocal * vec4(waterViewPosition,1.0)).xyz;
  float cutBlend=1.0-smoothstep(0.0,0.70,harborRadius-length(localWater.xz));
  // Only wave-induced refraction is reliable in a single scene capture. The
  // bulk flat-water offset cannot reveal hidden surfaces and duplicates thin
  // objects when its displaced ray falls back at an occlusion boundary.
  vec3 calmNormal = normalize(vec3(harborOpticalViewToLocal[0][1],
    harborOpticalViewToLocal[1][1],harborOpticalViewToLocal[2][1]));
  vec3 calmRay = refract(incident,calmNormal,1.0/1.333);
  vec3 waveRay = refract(incident,waterNormal,1.0/1.333);
  vec3 localCalmRay = mat3(harborOpticalViewToLocal)*calmRay;
  float referenceDistance=clamp((-1.80-localWater.y)/min(-0.24,localCalmRay.y),0.0,4.0);
  vec4 calmHit=harborOpticalProjection*vec4(waterViewPosition+calmRay*referenceDistance,1.0);
  vec4 waveHit=harborOpticalProjection*vec4(waterViewPosition+waveRay*referenceDistance,1.0);
  vec2 offset=(waveHit.xy/waveHit.w-calmHit.xy/calmHit.w)*0.5*(1.0-cutBlend);
  // Cap physical framebuffer pixels, not a percentage of the viewport. The old
  // 0.032 UV limit displaced an outline by ~46 pixels at desktop resolution.
  float offsetPixels=length(offset*harborOpticalResolution);
  offset*=min(1.0,2.25/max(offsetPixels,0.00001));
  float depthSlope=length(vec2(dFdx(behind.z),dFdy(behind.z)));
  offset*=1.0-smoothstep(0.025,0.12,depthSlope);
  offset*=smoothstep(0.04,0.20,gap);
  vec2 hitUV=clamp(uv+offset,vec2(0.001),vec2(0.999));
  float hitDepth=texture2D(harborSceneDepth,hitUV).r;
  vec3 sampledHit=harborViewPoint(hitUV,hitDepth);
  vec3 localHit=(harborOpticalViewToLocal*vec4(sampledHit,1.0)).xyz;
  float wetCandidate=texture2D(harborField,localHit.xz/(2.0*harborRadius)+0.5).w;
  // Reject a ray that switches from bed to grass/boat/shore (or vice versa).
  // No blending of two object images, and no sampling an unvalidated midpoint.
  bool acceptHit=hitDepth<0.9999 && abs(sampledHit.z-behind.z)<0.12 &&
    waterViewPosition.z-sampledHit.z>0.035 && localHit.y<0.0 &&
    localHit.y>-1.80 && length(localHit.xz)<harborRadius-0.08 && wetCandidate>0.99;
  vec2 safeUV=acceptHit?hitUV:uv;
  vec3 finalHit=acceptHit?sampledHit:behind;
  // Attenuation follows that exact final color sample, including fallback.
  // A shifted depth with an unshifted color would leave a pale ghost silhouette.
  vec3 segment=finalHit-waterViewPosition;
  float pathLength=length(segment);
  vec3 localRay=(mat3(harborOpticalViewToLocal)*segment)/max(pathLength,0.00001);
  float cylinderA=max(0.00001,dot(localRay.xz,localRay.xz));
  float cylinderB=dot(localWater.xz,localRay.xz);
  float cylinderC=dot(localWater.xz,localWater.xz)-harborRadius*harborRadius;
  float sideExit=max(0.0,(-cylinderB+sqrt(max(0.0,cylinderB*cylinderB-cylinderA*cylinderC)))/cylinderA);
  float bottomExit=localRay.y< -0.0001?max(0.0,(-1.80-localWater.y)/localRay.y):20.0;
  float opticalDistance=min(min(sideExit,bottomExit),min(pathLength,6.0));
  opticalDistance=mix(opticalDistance,1.50,cutBlend);
  vec3 transmittance = exp(-(harborAbsorptionCoefficients + vec3(0.15)) * opticalDistance);
  vec3 transmitted = texture2D(harborSceneColor, safeUV).rgb * transmittance;
  vec3 weights=vec3(0.2126,0.7152,0.0722);
  vec3 cutHue=harborOpticalTint/max(0.01,dot(harborOpticalTint,weights));
  transmitted=mix(transmitted,cutHue*dot(transmitted,weights),0.60*cutBlend);
  vec3 inScatter = harborOpticalTint * (1.0 - transmittance) * 0.08;
  return (transmitted + inScatter) * (1.0 - fresnel);
}
// The cylindrical wall is an illustrative cut through the water volume, not
// another refracting glass interface. A uniform optical thickness keeps objects
// aligned and prevents the bottom-plane intersection from bleaching a bright rim.
vec3 harborCutawayScene(float fresnel) {
  vec2 uv = gl_FragCoord.xy / harborOpticalResolution;
  vec3 transmittance = exp(-(harborAbsorptionCoefficients + vec3(0.15)) * 1.50);
  vec3 transmitted = texture2D(harborSceneColor,uv).rgb * transmittance;
  // Keep the cut face in the same water hue as the surface, without a separate
  // green sand band. Preserve luminance so submerged geometry remains legible.
  vec3 luminanceWeights=vec3(0.2126,0.7152,0.0722);
  vec3 waterHue=harborOpticalTint/max(0.01,dot(harborOpticalTint,luminanceWeights));
  transmitted=mix(transmitted,waterHue*dot(transmitted,luminanceWeights),0.60);
  vec3 inScatter = harborOpticalTint * (1.0-transmittance) * 0.08;
  return (transmitted + inScatter) * (1.0-fresnel);
}
`;

const CAUSTIC_GLSL = `
${PHYSICS_GLSL}
uniform float harborTime;
uniform mat4 harborContainerMatrix;
uniform float harborCausticStrength;
uniform float harborCausticScale;
uniform float harborOpticalEnabled;
uniform vec3 harborAbsorptionCoefficients;
varying vec3 vHarborCausticPosition;
uniform sampler2D harborCausticPattern;
uniform vec4 harborCausticDrift;
float harborCaustic(vec2 p, vec2 surfaceGradient) {
  vec2 uv = (p + surfaceGradient * 1.2) * 0.125;
  float first = texture2D(harborCausticPattern, uv + harborCausticDrift.xy).r;
  vec2 crossed = mat2(0.8, -0.6, 0.6, 0.8) * uv + vec2(0.37, 0.13);
  float second = texture2D(harborCausticPattern, crossed + harborCausticDrift.zw).r;
  return first * 0.72 + second * 0.28;
}
`;

// Bake the expensive nine-cell warped Voronoi once. Periodic seeds and periodic
// domain warping make the small texture tile without seams; two slow drifts keep
// the existing moving-light character with no fragment-shader trigonometry.
function createCausticPattern(THREE) {
  const size = 256, tiles = 8, data = new Uint8Array(size * size);
  const seeds = new Float32Array(tiles * tiles * 2);
  const fract = x => x - Math.floor(x);
  const wrap = x => ((x % tiles) + tiles) % tiles;
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let z = 0; z < tiles; z++) for (let x = 0; x < tiles; x++) {
    const i = (z * tiles + x) * 2;
    seeds[i] = .5 + .36 * Math.sin(TAU * fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453));
    seeds[i + 1] = .5 + .36 * Math.sin(TAU * fract(Math.sin(x * 269.5 + z * 183.3) * 43758.5453));
  }
  const k = TAU / tiles;
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const px = (x + .5) / size * tiles, pz = (z + .5) / size * tiles;
    const qx = px + Math.sin(pz * k + Math.sin(px * k) * 1.15) * .52 + Math.sin(pz * k * 4) * .13;
    const qz = pz + Math.cos(px * k + Math.sin(pz * k) * 1.05) * .52 + Math.cos(px * k * 4) * .13;
    const cx = Math.floor(qx), cz = Math.floor(qz), fx = fract(qx), fz = fract(qz);
    let first = 8, second = 8;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const i = (wrap(cz + dz) * tiles + wrap(cx + dx)) * 2;
      const vx = dx + seeds[i] - fx, vz = dz + seeds[i + 1] - fz, distance = vx * vx + vz * vz;
      if (distance < first) { second = first; first = distance; }
      else if (distance < second) second = distance;
    }
    const strand = 1 - smooth(.010, .067, second - first);
    const glimmer = .48 + .52 * smooth(-.5, .8, Math.sin(qx * k + qz * k) * Math.cos(qz * k - qx * k));
    data[z * size + x] = Math.round(strand * glimmer * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.name = 'Harbor caustics · baked seamless light strands';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// A one-time HDR sky for the water only. The bright areas are finite angular
// cloud/sun sources: Three samples them with the real reflected normal, rather
// than placing white lines or highlights directly in surface coordinates.
function createWaterSky(THREE) {
  const width = 512, height = 256, data = new Uint16Array(width * height * 4);
  const normalize = a => { const n = Math.hypot(...a); return a.map(v => v / n); };
  const sources = [
    { d: normalize([-.26, .60, -.75]), sigma: .105, strength: 1.2 },
    { d: normalize([-.39, .65, -.65]), sigma: .060, strength: .4 },
    { d: normalize([-.14, .62, -.77]), sigma: .055, strength: .3 },
    { d: normalize([-.54, .76, -.35]), sigma: .12, strength: 1.2 },
    { d: normalize([.52, .67, .53]), sigma: .10, strength: 1.2 },
    { d: normalize([-.72, .55, .42]), sigma: .09, strength: 1.0 },
    // Same direction as the scene's warm key light, (8, 10, -1) toward (0, .7, 0).
    { d: normalize([8, 9.3, -1]), sigma: .012, strength: 4.0 },
  ];
  const half = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < height; j++) {
    const elevation = ((j + .5) / height - .5) * Math.PI;
    const y = Math.sin(elevation), horizontal = Math.cos(elevation);
    for (let i = 0; i < width; i++) {
      const azimuth = ((i + .5) / width - .5) * TAU;
      const x = Math.cos(azimuth) * horizontal, z = Math.sin(azimuth) * horizontal;
      const horizon = Math.exp(-Math.max(y, 0) * 4);
      let r, g, b;
      if (y >= 0) {
        r = .10 + horizon * .34; g = .23 + horizon * .34; b = .42 + horizon * .28;
      } else {
        r = .09; g = .15; b = .19;
      }
      let light = 0;
      for (const source of sources) {
        const alignment = x * source.d[0] + y * source.d[1] + z * source.d[2];
        light += source.strength * Math.exp((alignment - 1) / (source.sigma * source.sigma));
      }
      r += light; g += light * .98; b += light * .94;
      const offset = (j * width + i) * 4;
      data[offset] = half(r); data[offset + 1] = half(g); data[offset + 2] = half(b); data[offset + 3] = half(1);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.name = 'Harbor water only · soft sky reflections';
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function polarSurface(THREE, segments, rings, containerRadius) {
  const vertices = [0, 0, 0];
  const uvs = [0.5, 0.5];
  const indices = [];
  for (let ring = 1; ring <= rings; ring++) {
    const radius = containerRadius * ring / rings;
    for (let segment = 0; segment < segments; segment++) {
      const angle = TAU * segment / segments;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      vertices.push(x, 0, z);
      uvs.push(x / (containerRadius * 2) + 0.5, z / (containerRadius * 2) + 0.5);
    }
  }
  for (let segment = 0; segment < segments; segment++) {
    indices.push(0, 1 + (segment + 1) % segments, 1 + segment);
  }
  for (let ring = 1; ring < rings; ring++) {
    const inner = 1 + (ring - 1) * segments;
    const outer = inner + segments;
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      indices.push(inner + segment, inner + next, outer + next);
      indices.push(inner + segment, outer + next, outer + segment);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), containerRadius + 1.1);
  return geometry;
}

function volumeSide(THREE, segments, radius) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let segment = 0; segment <= segments; segment++) {
    const angle = TAU * segment / segments;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    positions.push(x * radius, -DEPTH, z * radius, x * radius, 0, z * radius);
    normals.push(x, 0, z, x, 0, z);
    if (segment < segments) {
      const i = segment * 2;
      indices.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += 1.1;
  return geometry;
}

/** Pass the same THREE namespace used by the viewer. */
export function createHarborWater(THREE, options = {}) {
  const radius = Number(options.radius) || DEFAULT_RADIUS;
  const physics = createWaterPhysics({ ...options, radius });
  const fieldTexture = new THREE.DataTexture(physics.textureData, physics.size, physics.size, THREE.RGBAFormat, THREE.FloatType);
  fieldTexture.minFilter = THREE.NearestFilter;
  fieldTexture.magFilter = THREE.NearestFilter;
  fieldTexture.generateMipmaps = false;
  fieldTexture.needsUpdate = true;
  const time = { value: 0 };
  const causticPattern = createCausticPattern(THREE);
  const shaderUniforms = {
    harborSceneColor: { value: null },
    harborSceneDepth: { value: null },
    harborOpticalResolution: { value: new THREE.Vector2(1, 1) },
    harborOpticalEnabled: { value: 0 },
    harborOpticalProjection: { value: new THREE.Matrix4() },
    harborOpticalInverseProjection: { value: new THREE.Matrix4() },
    harborOpticalInverseView: { value: new THREE.Matrix4() },
    harborOpticalViewToLocal: { value: new THREE.Matrix4() },
    harborOpticalTint: { value: new THREE.Color('#168d98') },
    harborTime: time,
    harborField: { value: fieldTexture },
    harborRadius: { value: radius },
    harborFieldSize: { value: physics.size },
    harborCausticPattern: { value: causticPattern },
    harborCausticDrift: { value: new THREE.Vector4(0, .040, .032, 0) },
    harborContainerMatrix: { value: new THREE.Matrix4() },
    harborContainerInverse: { value: new THREE.Matrix4() },
    harborCausticStrength: { value: 0.30 },
    harborCausticScale: { value: 1.70 },
    harborAbsorptionCoefficients: { value: new THREE.Vector3(0.43, 0.105, 0.065) },
  };
  let previousSeconds = null;
  let ownedSkyEnvironment = null;
  function ambientSample(x, z, seconds) {
    const sample = { height: 0, dx: 0, dz: 0 };
    for (const w of WAVES) {
      const k = TAU / w.wavelength;
      const t = TAU * seconds / DURATION;
      const bend = x * 0.63 + z * 0.81 + w.phase + t;
      const phase = k * (x * w.direction[0] + z * w.direction[1]) + w.phase - w.harmonic * t + 0.42 * Math.sin(bend);
      sample.height += w.amplitude * Math.sin(phase);
      const derivative = w.amplitude * Math.cos(phase), bendDerivative = 0.42 * Math.cos(bend);
      sample.dx += derivative * (k * w.direction[0] + bendDerivative * 0.63);
      sample.dz += derivative * (k * w.direction[1] + bendDerivative * 0.81);
    }
    return sample;
  }
  const group = new THREE.Group();
  group.name = 'Harbor · bounded interactive water';
  group.userData.harborWater = true;
  let quality = 'balanced';
  let appearance = APPEARANCES[options.appearance] ? options.appearance : 'lagoon';
  const shaderStatus = { surface: false, side: false, causticMaterials: 0 };

  const material = new THREE.MeshPhysicalMaterial({
    name: 'Harbor · transparent moving surface',
    color: new THREE.Color('#168f9e'),
    roughness: 0.085,
    metalness: 0.0,
    transparent: true,
    opacity: 0.40,
    depthWrite: false,
    side: THREE.FrontSide,
    ior: 1.333,
    transmission: 0,
    clearcoat: 0.22,
    clearcoatRoughness: 0.075,
    specularIntensity: 1.1,
    envMapIntensity: 1.40,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shaderUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WAVE_GLSL}\nvarying vec2 vHarborWaterXZ;`)
      .replace('#include <beginnormal_vertex>', `
        vec3 harborVertexWave = harborWave(position.xz);
        vec3 objectNormal = normalize(vec3(-harborVertexWave.y, 1.0, -harborVertexWave.z));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif
      `)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        transformed.y += harborVertexWave.x;
        vHarborWaterXZ = position.xz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OPTICAL_GLSL}\nuniform float harborTime;\nuniform mat4 harborContainerMatrix;\nvarying vec2 vHarborWaterXZ;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if(length(vHarborWaterXZ)<harborRadius-0.5 && texture2D(harborField,vHarborWaterXZ/(2.0*harborRadius)+0.5).w < 0.99) discard;
        harborProtectDryScene();`)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        // Small wind ripples affect reflections, rather than painting white lines on the water.
        float harborPhase = harborTime * 1.0471975512;
        vec2 harborP = vHarborWaterXZ;
        vec2 harborDetail = vec2(
          cos(dot(harborP, vec2(14.2, 9.4)) + sin(harborP.y * 1.7) * 0.7 - harborPhase * 4.0) * 0.008 +
          cos(dot(harborP, vec2(-21.0, 13.0)) + harborPhase * 3.0) * 0.003,
          sin(dot(harborP, vec2(11.3, -18.5)) + cos(harborP.x * 1.3) * 0.6 - harborPhase * 3.0) * 0.007 +
          cos(dot(harborP, vec2(26.0, 17.0)) + harborPhase * 5.0) * 0.003
        );
        normal = normalize(normal + mat3(viewMatrix * harborContainerMatrix) * vec3(-harborDetail.x, 0.0, -harborDetail.y));
      `)
      .replace('#include <transmission_fragment>', `
        // Clear water has negligible diffuse scattering. Keep a tiny colored term
        // in the alpha fallback; depth color is supplied by submerged absorption.
        #ifndef USE_TRANSMISSION
          totalDiffuse *= 0.055;
        #endif
        #include <transmission_fragment>
      `)
      .replace('#include <opaque_fragment>', `
        float harborViewDot = clamp(dot(normal, geometryViewDir), 0.0, 1.0);
        float harborFresnel = 0.02037 + 0.97963 * pow(1.0 - harborViewDot, 5.0);
        if (harborOpticalEnabled > 0.5) {
          // Physical specular already includes Fresnel; composite in linear light.
          outgoingLight += harborRefractedScene(-vViewPosition, normal, harborFresnel);
          diffuseColor.a = 1.0;
        } else {
          diffuseColor.a = min(0.72, diffuseColor.a + pow(1.0-harborViewDot,3.0) * 0.42);
          outgoingLight /= max(diffuseColor.a, 0.18);
        }
        #include <opaque_fragment>
      `);
    shaderStatus.surface = true;
  };
  material.customProgramCacheKey = () => 'harbor-silhouette-safe-microrefraction-v15';
  const surface = new THREE.Mesh(polarSurface(THREE, 256, 112, radius), material);
  surface.name = 'Sea · interactive reflecting wave surface';
  surface.receiveShadow = true;
  surface.castShadow = false;
  surface.renderOrder = 4;
  surface.userData.harborWater = true;
  group.add(surface);

  const sideMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Harbor · clear deep turquoise cut edge',
    color: new THREE.Color('#087d99'),
    transparent: true,
    opacity: 0.63,
    roughness: 0.11,
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.07,
    ior: 1.333,
    depthWrite: false,
    side: THREE.FrontSide,
    envMapIntensity: 0.85,
  });
  sideMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shaderUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WAVE_GLSL}\nvarying float vHarborSideDepth;\nvarying vec3 vHarborSidePosition;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float harborTop = step(-0.01, position.y);
        transformed.y += harborWave(position.xz).x * harborTop;
        vHarborSideDepth = clamp(-position.y / 1.80, 0.0, 1.0);
        vHarborSidePosition = transformed;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${OPTICAL_GLSL}\nuniform float harborTime;\nuniform mat4 harborContainerMatrix;\nvarying float vHarborSideDepth;\nvarying vec3 vHarborSidePosition;`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n harborProtectDryScene();')
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        // Uniform cut-section color; depth remains visible in the captured objects.

      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        float harborSidePhase = harborTime * 1.0471975512;
        float harborSideRipple = sin(
          dot(vHarborSidePosition.xz, vec2(7.1, 4.5)) +
          vHarborSidePosition.y * 2.5 - harborSidePhase * 2.0
        ) * 0.065;
        vec3 harborSideTangent = normalize(vec3(-vHarborSidePosition.z, 0.0, vHarborSidePosition.x));
        normal = normalize(normal + mat3(viewMatrix * harborContainerMatrix) * (harborSideTangent * harborSideRipple));
      `)
      .replace('#include <transmission_fragment>', `
        if (harborOpticalEnabled > 0.5) totalDiffuse *= 0.025;
        #include <transmission_fragment>
      `)
      .replace('#include <opaque_fragment>', `
        if (harborOpticalEnabled > 0.5) {
          float harborSideFresnel = 0.02037 + 0.97963 * pow(1.0-clamp(dot(normal,geometryViewDir),0.0,1.0),5.0);
          outgoingLight += harborCutawayScene(harborSideFresnel);
          diffuseColor.a = 1.0;
        }
        #include <opaque_fragment>
      `);
    shaderStatus.side = true;
  };
  sideMaterial.customProgramCacheKey = () => 'harbor-uniform-cutaway-side-v11';
  const side = new THREE.Mesh(volumeSide(THREE, 256, radius), sideMaterial);
  side.name = 'Sea · fixed-bottom transparent depth';
  side.renderOrder = 3;
  side.userData.harborWater = true;
  group.add(side);

  function applyAppearance() {
    const preset = APPEARANCES[appearance];
    material.color.set(preset.color);
    material.roughness = preset.roughness;
    material.envMapIntensity = preset.env;
    material.transmission = quality === 'high' ? 0.65 : 0;
    material.thickness = quality === 'high' ? 0.40 : 0;
    material.opacity = quality === 'high' ? 0.79 : preset.opacity;
    material.attenuationColor.set(preset.attenuation);
    material.attenuationDistance = appearance === 'glass' ? 7.0 : 4.0;
    sideMaterial.color.set(preset.side);
    sideMaterial.opacity = preset.sideOpacity;
    sideMaterial.roughness = preset.roughness + 0.025;
    shaderUniforms.harborOpticalTint.value.set(preset.attenuation);
    shaderUniforms.harborCausticStrength.value = preset.caustic;
    shaderUniforms.harborCausticScale.value = preset.causticScale;
    shaderUniforms.harborAbsorptionCoefficients.value.fromArray(preset.absorption);
    material.needsUpdate = true;
    sideMaterial.needsUpdate = true;
  }

  const api = {
    group,
    surface,
    timeUniform: time,
    radius,
    depth: DEPTH,
    shaderUniforms,
    appearanceNames: Object.freeze(Object.keys(APPEARANCES)),
    get appearance() { return appearance; },
    waveGLSL: WAVE_GLSL,
    update(seconds, deltaSeconds) {
      const next = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
      let delta = previousSeconds === null ? 0 : Math.max(0, next - previousSeconds);
      if (Number.isFinite(deltaSeconds)) delta = delta > 0 ? Math.max(0, deltaSeconds) : 0;
      if (previousSeconds !== null && next < previousSeconds - 0.001) physics.reset();
      previousSeconds = next;
      time.value = ((next % DURATION) + DURATION) % DURATION;
      const causticPhase = time.value * TAU / DURATION;
      shaderUniforms.harborCausticDrift.value.set(
        Math.sin(causticPhase) * .045, Math.cos(causticPhase) * .040,
        Math.cos(causticPhase) * .032, -Math.sin(causticPhase) * .037);
      if (physics.advance(delta)) fieldTexture.needsUpdate = true;
    },
    sample(x, z, seconds = time.value) {
      const interactive = physics.sample(x, z);
      if (!interactive.wet) return { height: 0, dx: 0, dz: 0, wet: false };
      const ambient = ambientSample(x, z, seconds);
      return { height: interactive.height + ambient.height, dx: interactive.dx + ambient.dx,
        dz: interactive.dz + ambient.dz, wet: true };
    },
    sampleHeight(x, z, seconds = time.value) {
      return api.sample(x, z, seconds).height;
    },
    addImpulse: physics.addImpulse,
    poke(x, z, strength = 2.2, footprint = .60) {
      const changed = physics.poke(x, z, strength, footprint);
      if (changed) fieldTexture.needsUpdate = true;
      return changed;
    },
    addSlosh: physics.addSlosh,
    setContainerTilt: physics.setContainerTilt,
    setContainerTransform(matrixWorld) {
      if (!matrixWorld?.isMatrix4) return false;
      shaderUniforms.harborContainerMatrix.value.copy(matrixWorld);
      shaderUniforms.harborContainerInverse.value.copy(matrixWorld).invert();
      return true;
    },
    setOpticalScene(capture) {
      if (!capture?.colorTexture?.isTexture || !capture?.depthTexture?.isTexture) {
        shaderUniforms.harborOpticalEnabled.value = 0;
        return false;
      }
      shaderUniforms.harborSceneColor.value = capture.colorTexture;
      shaderUniforms.harborSceneDepth.value = capture.depthTexture;
      shaderUniforms.harborOpticalResolution.value.set(Math.max(1,capture.width), Math.max(1,capture.height));
      if (capture.projectionMatrix) shaderUniforms.harborOpticalProjection.value.copy(capture.projectionMatrix);
      if (capture.inverseProjectionMatrix) shaderUniforms.harborOpticalInverseProjection.value.copy(capture.inverseProjectionMatrix);
      else if (capture.projectionMatrix) shaderUniforms.harborOpticalInverseProjection.value.copy(capture.projectionMatrix).invert();
      if (capture.inverseViewMatrix) shaderUniforms.harborOpticalInverseView.value.copy(capture.inverseViewMatrix);
      else if (capture.viewMatrix) shaderUniforms.harborOpticalInverseView.value.copy(capture.viewMatrix).invert();
      shaderUniforms.harborOpticalViewToLocal.value.multiplyMatrices(shaderUniforms.harborContainerInverse.value,shaderUniforms.harborOpticalInverseView.value);
      shaderUniforms.harborOpticalEnabled.value = 1;
      return true;
    },
    setSkyReflections() {
      if (!ownedSkyEnvironment) ownedSkyEnvironment = createWaterSky(THREE);
      api.setReflectionEnvironment(ownedSkyEnvironment);
      return true;
    },
    setReflectionEnvironment(texture) {
      // With only scene.environment, Three replaces envMapIntensity with the
      // scene-wide value. An explicit map gives the water its own IBL strength.
      if (!texture?.isTexture) return false;
      material.envMap = texture;
      sideMaterial.envMap = texture;
      material.needsUpdate = true;
      sideMaterial.needsUpdate = true;
      return true;
    },
    setAppearance(name) {
      if (!Object.hasOwn(APPEARANCES, name)) return false;
      appearance = name;
      applyAppearance();
      return true;
    },
    isWater: physics.isWater,
    setShoreline(points) {
      physics.setShoreline(points);
      fieldTexture.needsUpdate = true;
    },
    resetInteraction() {
      physics.reset();
      fieldTexture.needsUpdate = true;
    },
    setQuality(level) {
      quality = level === 'high' ? 'high' : 'balanced';
      applyAppearance();
    },
    diagnostics() {
      return {
        type: 'bounded shallow-water simulation with ambient wind waves',
        radius,
        depth: DEPTH,
        loopSeconds: DURATION,
        interactionLoops: false,
        physics: physics.diagnostics(),
        maxAmplitude: WAVES.reduce((sum, w) => sum + w.amplitude, 0) + physics.diagnostics().maxHeight,
        surfaceVertices: surface.geometry.attributes.position.count,
        quality,
        appearance,
        appearanceNames: Object.keys(APPEARANCES),
        opticalRefraction: shaderUniforms.harborOpticalEnabled.value > .5,
        opticalMethod: 'silhouette-safe wave-relative microrefraction with coherent color and depth',
        maxRefractionPixels:2.25,
        refractionDepthTolerance:0.12,
        cutawayOpticalDepth:1.50,
        dryLandProtection:true,
        opticalResolution: shaderUniforms.harborOpticalResolution.value.toArray(),
        ambientMaxAmplitude: WAVES.reduce((sum,w)=>sum+w.amplitude,0),
        explicitReflectionEnvironment: !!material.envMap,
        reflectionEnvironment: material.envMap?.name || null,
        reflectionIntensity: material.envMapIntensity,
        containerTransform: shaderUniforms.harborContainerMatrix.value.elements.slice(),
        time: time.value,
        shaders: { ...shaderStatus },
        causticTechnique: '256px precomputed periodic strands, two texture samples',
        causticPatternBytes: causticPattern.image.data.byteLength,
        sampleHeight: api.sampleHeight(2.31, -1.47),
        seamlessLoopError: Math.abs(ambientSample(2.31, -1.47, 0).height - ambientSample(2.31, -1.47, DURATION).height),
      };
    },
    dispose() {
      surface.geometry.dispose();
      side.geometry.dispose();
      material.dispose();
      sideMaterial.dispose();
      fieldTexture.dispose();
      causticPattern.dispose();
      if (ownedSkyEnvironment) ownedSkyEnvironment.dispose();
    },
  };
  applyAppearance();
  api.getDiagnostics = api.diagnostics;
  // Shared privately with the optional caustics helper.
  api._noteCausticMaterial = () => { shaderStatus.causticMaterials++; };
  return api;
}

/**
 * Add animated light patterns to submerged parts of existing GLB meshes.
 * Safe for shared materials: clones each eligible material once and leaves the
 * original material untouched. Heights and normal orientation gate the effect,
 * so dry rocks, trees, people, and vertical water walls never acquire white veins.
 */
export function installHarborCaustics(THREE, root, water) {
  const radius = water.radius || DEFAULT_RADIUS;
  const replacements = new Map();
  const modifiedMeshes = [];
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible || mesh.userData.harborWater) return;
    if (/foam|cloud|water|Sea [—·]|glint|wake/i.test(mesh.name)) return;
    box.setFromObject(mesh);
    if (box.min.y > 0.025 || box.max.y < -1.80) return;
    if (box.min.x > radius || box.max.x < -radius || box.min.z > radius || box.max.z < -radius) return;
    const apply = (original) => {
      if (!original || (!original.isMeshStandardMaterial && !original.isMeshPhysicalMaterial)) return original;
      if (original.userData.harborCaustics) return original;
      if (replacements.has(original)) return replacements.get(original);
      const material = original.clone();
      material.name = `${original.name || 'Submerged surface'} · moving caustics`;
      material.userData.harborCaustics = true;
      const originalCompile = original.onBeforeCompile;
      const originalKey = original.customProgramCacheKey ? original.customProgramCacheKey() : '';
      material.onBeforeCompile = (shader, renderer) => {
        if (originalCompile) originalCompile.call(material, shader, renderer);
        Object.assign(shader.uniforms, water.shaderUniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform mat4 harborContainerInverse;\nvarying vec3 vHarborCausticPosition;')
          .replace('#include <project_vertex>', `
            vec4 harborCausticLocal = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              harborCausticLocal = instanceMatrix * harborCausticLocal;
            #endif
            vHarborCausticPosition = (harborContainerInverse * modelMatrix * harborCausticLocal).xyz;
            #include <project_vertex>
          `);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${CAUSTIC_GLSL}`)
          .replace('#include <emissivemap_fragment>', `
            #include <emissivemap_fragment>
            vec4 harborCausticField = harborFieldAt(vHarborCausticPosition.xz);
            float harborLocalWaterLevel = harborCausticField.x;
            float harborWet = (1.0 - smoothstep(-0.08, -0.015, vHarborCausticPosition.y - harborLocalWaterLevel)) *
              smoothstep(-1.78, -1.55, vHarborCausticPosition.y) *
              (1.0 - smoothstep(harborRadius - 0.25, harborRadius - 0.04, length(vHarborCausticPosition.xz)));
            vec3 harborUp = normalize(mat3(viewMatrix * harborContainerMatrix) * vec3(0.0, 1.0, 0.0));
            float harborFacing = smoothstep(0.10, 0.75, dot(normal, harborUp));
            float harborLight = harborCaustic(vHarborCausticPosition.xz * harborCausticScale, harborCausticField.yz) * harborWet * harborFacing;
            // Beer-Lambert style absorption on surfaces viewed through the water.
            // The seabed remains pale sand, with progressively cooler / deeper color.
            float harborDepth = max(0.0, harborLocalWaterLevel - vHarborCausticPosition.y);
            float harborOpticalPath = harborDepth / max(0.55, abs(dot(harborUp, isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition))));
            vec3 harborAbsorption = exp(-harborOpticalPath * harborAbsorptionCoefficients);
            diffuseColor.rgb *= mix(vec3(1.0), harborAbsorption, harborWet * (1.0-harborOpticalEnabled));
            totalEmissiveRadiance += vec3(0.40, 0.75, 0.69) * harborLight * harborCausticStrength * 0.45;
            diffuseColor.rgb *= 1.0 + harborLight * harborCausticStrength;
          `);
      };
      material.customProgramCacheKey = () => `${originalKey}|harbor-baked-optical-depth-caustics-v8`;
      replacements.set(original, material);
      water._noteCausticMaterial();
      return material;
    };
    const previous = mesh.material;
    mesh.material = Array.isArray(previous) ? previous.map(apply) : apply(previous);
    if (mesh.material !== previous) modifiedMeshes.push({ mesh, previous });
  });
  return {
    meshes: modifiedMeshes.length,
    materials: replacements.size,
    dispose() {
      for (const { mesh, previous } of modifiedMeshes) mesh.material = previous;
      for (const material of replacements.values()) material.dispose();
    },
  };
}
