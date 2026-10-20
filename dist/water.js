/**
 * Real-time counterpart of the harbor's Blender water.
 * Y is up; Blender's Y maps to -Z. Wave phase closes exactly every six seconds.
 * No image assets, network requests, or Blender scene changes are required.
 */
const TAU = Math.PI * 2;
const RADIUS = 6.2;
const DEPTH = 1.64;
const DURATION = 6;
const WAVES = [
  { amplitude: 0.045, wavelength: 1.85, direction: [0.894427191, -0.447213595], harmonic: 1, phase: 0.35 },
  { amplitude: 0.027, wavelength: 1.05, direction: [-0.287347886, -0.957826285], harmonic: 2, phase: 1.40 },
  { amplitude: 0.014, wavelength: 0.57, direction: [0.813733471, -0.581238194], harmonic: 3, phase: -0.85 },
];

const WAVE_GLSL = `
uniform float harborTime;
vec3 harborWave(vec2 p) {
  float t = harborTime * 1.0471975512;
  vec3 result = vec3(0.0);
  ${WAVES.map((w) => {
    const k = TAU / w.wavelength;
    return `{
      vec2 direction = vec2(${w.direction[0].toFixed(10)}, ${w.direction[1].toFixed(10)});
      float phase = ${k.toFixed(10)} * dot(p, direction) + ${w.phase.toFixed(4)} - ${w.harmonic.toFixed(1)} * t;
      result.x += ${w.amplitude.toFixed(4)} * sin(phase);
      result.yz += ${w.amplitude.toFixed(4)} * ${k.toFixed(10)} * cos(phase) * direction;
    }`;
  }).join('\n')}
  return result;
}
`;

const CAUSTIC_GLSL = `
uniform float harborTime;
varying vec3 vHarborCausticPosition;
vec2 harborHash(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
float harborCaustic(vec2 p) {
  float t = harborTime * 1.0471975512;
  // Nested domain warping bends the light strands and breaks the straight-sided
  // Voronoi / swimming-pool tile look, while retaining the exact temporal loop.
  p += vec2(
    sin(p.y * 1.17 + sin(p.x * 0.71 - t) * 1.15 + t),
    cos(p.x * 1.09 + sin(p.y * 0.83 + t) * 1.05 - t)
  ) * 0.52;
  p += vec2(sin(p.y * 3.11 - t * 2.0), cos(p.x * 2.89 + t * 2.0)) * 0.13;
  vec2 cell = floor(p);
  vec2 local = fract(p);
  float nearest = 8.0;
  float second = 8.0;
  for (int y = -1; y <= 1; ++y) {
    for (int x = -1; x <= 1; ++x) {
      vec2 offset = vec2(float(x), float(y));
      vec2 seed = harborHash(cell + offset);
      vec2 center = 0.5 + 0.36 * sin(6.28318530718 * seed + vec2(t, -t));
      vec2 delta = offset + center - local;
      float d = dot(delta, delta);
      if (d < nearest) { second = nearest; nearest = d; }
      else { second = min(second, d); }
    }
  }
  float edge = second - nearest;
  float strand = 1.0 - smoothstep(0.010, 0.067, edge);
  return strand * (0.74 + 0.26 * sin(p.x * 2.1 + p.y * 1.3 + t));
}
`;

function polarSurface(THREE, segments, rings) {
  const vertices = [0, 0, 0];
  const uvs = [0.5, 0.5];
  const indices = [];
  for (let ring = 1; ring <= rings; ring++) {
    const radius = RADIUS * ring / rings;
    for (let segment = 0; segment < segments; segment++) {
      const angle = TAU * segment / segments;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      vertices.push(x, 0, z);
      uvs.push(x / (RADIUS * 2) + 0.5, z / (RADIUS * 2) + 0.5);
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
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), RADIUS + 0.10);
  return geometry;
}

function volumeSide(THREE, segments) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let segment = 0; segment <= segments; segment++) {
    const angle = TAU * segment / segments;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    positions.push(x * RADIUS, -DEPTH, z * RADIUS, x * RADIUS, 0, z * RADIUS);
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
  geometry.boundingSphere.radius += 0.1;
  return geometry;
}

/** Pass the same THREE namespace used by the viewer. */
export function createHarborWater(THREE) {
  const time = { value: 0 };
  const group = new THREE.Group();
  group.name = 'Harbor · living six-second water';
  group.userData.harborWater = true;
  let quality = 'balanced';
  const shaderStatus = { surface: false, side: false, causticMaterials: 0 };

  const material = new THREE.MeshPhysicalMaterial({
    name: 'Harbor · transparent moving surface',
    color: new THREE.Color('#168f9e'),
    roughness: 0.085,
    metalness: 0.12,
    transparent: true,
    opacity: 0.40,
    depthWrite: false,
    side: THREE.FrontSide,
    ior: 1.333,
    transmission: 0,
    clearcoat: 0.75,
    clearcoatRoughness: 0.055,
    specularIntensity: 1.35,
    envMapIntensity: 1.40,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.harborTime = time;
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
      .replace('#include <common>', `#include <common>\nuniform float harborTime;\nvarying vec2 vHarborWaterXZ;`)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        // Small wind ripples affect reflections, rather than painting white lines on the water.
        float harborPhase = harborTime * 1.0471975512;
        vec2 harborP = vHarborWaterXZ;
        vec2 harborDetail = vec2(
          cos(dot(harborP, vec2(14.2, 9.4)) - harborPhase * 4.0) * 0.052 +
          cos(dot(harborP, vec2(-21.0, 13.0)) + harborPhase * 3.0) * 0.025,
          sin(dot(harborP, vec2(11.3, -18.5)) - harborPhase * 3.0) * 0.048 +
          cos(dot(harborP, vec2(26.0, 17.0)) + harborPhase * 5.0) * 0.021
        );
        normal = normalize(normal + mat3(viewMatrix) * vec3(-harborDetail.x, 0.0, -harborDetail.y));
      `)
      .replace('#include <opaque_fragment>', `
        // Grazing angles retain a clear glass-like rim; the center stays transparent.
        float harborFresnel = pow(1.0 - clamp(dot(normal, geometryViewDir), 0.0, 1.0), 3.0);
        diffuseColor.a = min(0.78, diffuseColor.a + harborFresnel * 0.28);
        // A restrained, broken crest glint helps read travel even under diffuse sky
        // illumination. It follows the first wave, not a static texture overlay.
        float harborCrestPhase = dot(vHarborWaterXZ, vec2(3.037758, -1.518879)) + 0.35 - harborPhase;
        float harborCrest = pow(max(0.0, sin(harborCrestPhase)), 20.0);
        float harborCrestBreak = pow(0.5 + 0.5 * sin(
          dot(vHarborWaterXZ, vec2(3.1, 5.3)) +
          1.2 * sin(vHarborWaterXZ.x * 1.6 - harborPhase)
        ), 5.0);
        outgoingLight += vec3(0.32, 0.62, 0.66) * harborCrest * harborCrestBreak * 0.42;
        #include <opaque_fragment>
      `);
    shaderStatus.surface = true;
  };
  material.customProgramCacheKey = () => 'harbor-traveling-surface-v4';
  const surface = new THREE.Mesh(polarSurface(THREE, 192, 56), material);
  surface.name = 'Sea · analytic traveling wave surface';
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
    metalness: 0.14,
    clearcoat: 0.85,
    clearcoatRoughness: 0.07,
    ior: 1.333,
    depthWrite: false,
    side: THREE.FrontSide,
    envMapIntensity: 1.1,
  });
  sideMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.harborTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WAVE_GLSL}\nvarying float vHarborSideDepth;\nvarying vec3 vHarborSidePosition;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        float harborTop = step(-0.01, position.y);
        transformed.y += harborWave(position.xz).x * harborTop;
        vHarborSideDepth = clamp(-position.y / 1.64, 0.0, 1.0);
        vHarborSidePosition = transformed;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float harborTime;\nvarying float vHarborSideDepth;\nvarying vec3 vHarborSidePosition;')
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        diffuseColor.rgb *= mix(vec3(1.14, 1.17, 1.17), vec3(0.26, 0.61, 0.80), vHarborSideDepth);
        diffuseColor.a *= mix(0.72, 1.18, vHarborSideDepth);
      `)
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        float harborSidePhase = harborTime * 1.0471975512;
        float harborSideRipple = sin(
          dot(vHarborSidePosition.xz, vec2(7.1, 4.5)) +
          vHarborSidePosition.y * 2.5 - harborSidePhase * 2.0
        ) * 0.065;
        vec3 harborSideTangent = normalize(vec3(-vHarborSidePosition.z, 0.0, vHarborSidePosition.x));
        normal = normalize(normal + mat3(viewMatrix) * (harborSideTangent * harborSideRipple));
      `);
    shaderStatus.side = true;
  };
  sideMaterial.customProgramCacheKey = () => 'harbor-wavy-volume-side-v3';
  const side = new THREE.Mesh(volumeSide(THREE, 256), sideMaterial);
  side.name = 'Sea · fixed-bottom transparent depth';
  side.renderOrder = 3;
  side.userData.harborWater = true;
  group.add(side);

  const api = {
    group,
    surface,
    timeUniform: time,
    update(seconds) {
      time.value = ((Number(seconds) || 0) % DURATION + DURATION) % DURATION;
    },
    sampleHeight(x, z, seconds = time.value) {
      return WAVES.reduce((sum, w) => sum + w.amplitude * Math.sin(
        TAU / w.wavelength * (x * w.direction[0] + z * w.direction[1]) +
        w.phase - w.harmonic * TAU * seconds / DURATION
      ), 0);
    },
    setQuality(level) {
      quality = level;
      // Default balanced mode uses one transparent pass. High adds actual screen-space
      // transmission and absorption, when the renderer / device has the GPU headroom.
      material.transmission = level === 'high' ? 0.67 : 0;
      material.thickness = level === 'high' ? 0.45 : 0;
      material.opacity = level === 'high' ? 0.82 : 0.40;
      material.attenuationColor.set('#65d3ce');
      material.attenuationDistance = 3.5;
      material.needsUpdate = true;
    },
    diagnostics() {
      return {
        type: 'three analytic traveling waves',
        radius: RADIUS,
        depth: DEPTH,
        loopSeconds: DURATION,
        maxAmplitude: WAVES.reduce((sum, w) => sum + w.amplitude, 0),
        surfaceVertices: surface.geometry.attributes.position.count,
        quality,
        time: time.value,
        shaders: { ...shaderStatus },
        sampleHeight: api.sampleHeight(2.31, -1.47),
        seamlessLoopError: Math.abs(api.sampleHeight(2.31, -1.47, 0) - api.sampleHeight(2.31, -1.47, DURATION)),
      };
    },
    dispose() {
      surface.geometry.dispose();
      side.geometry.dispose();
      material.dispose();
      sideMaterial.dispose();
    },
  };
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
  const replacements = new Map();
  const modifiedMeshes = [];
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible || mesh.userData.harborWater) return;
    if (/foam|cloud|water|Sea [—·]|glint|wake/i.test(mesh.name)) return;
    box.setFromObject(mesh);
    if (box.min.y > 0.025 || box.max.y < -1.80) return;
    if (box.min.x > RADIUS || box.max.x < -RADIUS || box.min.z > RADIUS || box.max.z < -RADIUS) return;
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
        shader.uniforms.harborTime = water.timeUniform;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vHarborCausticPosition;')
          .replace('#include <project_vertex>', `
            vHarborCausticPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
            #include <project_vertex>
          `);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${CAUSTIC_GLSL}`)
          .replace('#include <emissivemap_fragment>', `
            #include <emissivemap_fragment>
            float harborWet = (1.0 - smoothstep(-0.10, -0.025, vHarborCausticPosition.y)) *
              smoothstep(-1.78, -1.55, vHarborCausticPosition.y) *
              (1.0 - smoothstep(5.95, 6.16, length(vHarborCausticPosition.xz)));
            vec3 harborUp = mat3(viewMatrix) * vec3(0.0, 1.0, 0.0);
            float harborFacing = smoothstep(0.10, 0.75, dot(normal, harborUp));
            float harborLight = harborCaustic(vHarborCausticPosition.xz * 3.12) * harborWet * harborFacing;
            // Beer-Lambert style absorption on surfaces viewed through the water.
            // The seabed remains pale sand, with progressively cooler / deeper color.
            float harborDepth = max(0.0, -vHarborCausticPosition.y);
            vec3 harborAbsorption = exp(-harborDepth * vec3(0.73, 0.20, 0.115));
            diffuseColor.rgb *= mix(vec3(1.0), harborAbsorption, harborWet);
            totalEmissiveRadiance += vec3(0.40, 0.75, 0.69) * harborLight * 0.28;
            diffuseColor.rgb *= 0.96 + harborLight * 0.43;
          `);
      };
      material.customProgramCacheKey = () => `${originalKey}|harbor-submerged-caustics-v3`;
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
