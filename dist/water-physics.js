/**
 * Fixed-step, bounded shallow-water free-surface approximation (not a 3D fluid).
 * h'' = c² Laplacian(h - equilibriumTilt) - damping h'.
 * Reflecting boundaries are applied to the hydraulic potential, so tilting the
 * container produces a world-horizontal equilibrium and reflected travelling waves.
 */
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));

export function pointInShoreline(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function createWaterPhysics({
  radius = 9, resolution = 145, shoreline = [],
  waveSpeed = 4.0, damping = 0.72, maxHeight = 0.95,
} = {}) {
  const size = Math.max(49, Math.min(193, Math.round(resolution) | 1));
  const count = size * size, spacing = radius * 2 / (size - 1);
  const step = Math.min(1 / 120, spacing / (waveSpeed * Math.sqrt(2)) * 0.8);
  const speedSquared = waveSpeed * waveSpeed;
  const limit = clamp(maxHeight, 0.3, 1.3);
  const height = new Float32Array(count), velocity = new Float32Array(count);
  const potential = new Float32Array(count), equilibrium = new Float32Array(count);
  const wet = new Uint8Array(count), textureData = new Float32Array(count * 4);
  const left = new Int32Array(count), right = new Int32Array(count);
  const down = new Int32Array(count), up = new Int32Array(count);
  const coordinateX = new Float32Array(count), coordinateZ = new Float32Array(count);
  let active = [], polygon = [], accumulator = 0, simulationTime = 0;
  let sloshX = 0, sloshZ = 0, wetCenterX = 0, wetCenterZ = 0;
  let tiltX = 0, tiltZ = 0, slopeX = 0, slopeZ = 0, tiltUpdates = 0;
  let stepCount = 0, impulseCount = 0, pokeCount = 0, sloshCount = 0, rejectedImpulses = 0;
  let maximumHeight = 0, energy = 0, meanHeight = 0, nonFiniteCount = 0, limitedSteps = 0;
  let equilibriumError = 0, revision = 0, discardedLongFrameSeconds = 0;

  function isWater(x, z) {
    return Number.isFinite(x) && Number.isFinite(z) && x * x + z * z <= radius * radius + 1e-7 &&
      !(polygon.length > 2 && pointInShoreline(x, z, polygon));
  }

  function rebuildEquilibrium() {
    // THREE Euler XYZ with rotation.y = 0. Inverse gravity gives this local
    // horizontal plane. The centroid term conserves volume around an asymmetric island.
    slopeX = -Math.tan(tiltZ);
    slopeZ = Math.tan(tiltX) / Math.cos(tiltZ);
    let highest = 0;
    for (const i of active) {
      equilibrium[i] = slopeX * (coordinateX[i] - wetCenterX) + slopeZ * (coordinateZ[i] - wetCenterZ);
      highest = Math.max(highest, Math.abs(equilibrium[i]));
    }
    // The visual vessel has no spilling mode; prevent extreme programmatic tilt
    // from requesting a surface outside the finite wall. Ordinary ±0.07 rad is unaffected.
    if (highest > limit * 0.91) {
      const scale = limit * 0.91 / highest;
      slopeX *= scale; slopeZ *= scale;
      for (const i of active) equilibrium[i] *= scale;
    }
  }

  function setContainerTilt(x = 0, z = 0) {
    const nextX = clamp(Number(x) || 0, -0.16, 0.16);
    const nextZ = clamp(Number(z) || 0, -0.16, 0.16);
    if (Math.abs(nextX - tiltX) + Math.abs(nextZ - tiltZ) < 1e-9) return;
    tiltX = nextX; tiltZ = nextZ; tiltUpdates++;
    rebuildEquilibrium();
  }

  function rebuildMask(points) {
    polygon = Array.isArray(points) ? points.filter(p => p?.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(p => [p[0], p[1]]) : [];
    active = []; wetCenterX = wetCenterZ = 0;
    for (let z = 0; z < size; z++) {
      const wz = z * spacing - radius;
      for (let x = 0; x < size; x++) {
        const index = z * size + x, wx = x * spacing - radius;
        coordinateX[index] = wx; coordinateZ[index] = wz;
        wet[index] = isWater(wx, wz) ? 1 : 0;
        if (wet[index]) { active.push(index); wetCenterX += wx; wetCenterZ += wz; }
        else { height[index] = 0; velocity[index] = 0; equilibrium[index] = 0; }
      }
    }
    wetCenterX /= Math.max(1, active.length); wetCenterZ /= Math.max(1, active.length);
    for (const i of active) {
      const x = i % size, z = Math.floor(i / size);
      left[i] = x > 0 && wet[i - 1] ? i - 1 : i;
      right[i] = x < size - 1 && wet[i + 1] ? i + 1 : i;
      down[i] = z > 0 && wet[i - size] ? i - size : i;
      up[i] = z < size - 1 && wet[i + size] ? i + size : i;
    }
    rebuildEquilibrium(); writeTexture();
  }

  function writeTexture() {
    textureData.fill(0); maximumHeight = energy = meanHeight = equilibriumError = 0;
    for (const i of active) {
      const h = height[i], v = velocity[i], o = i * 4;
      const widthX = (right[i] === i || left[i] === i) ? spacing : spacing * 2;
      const widthZ = (up[i] === i || down[i] === i) ? spacing : spacing * 2;
      const dx = (height[right[i]] - height[left[i]]) / widthX;
      const dz = (height[up[i]] - height[down[i]]) / widthZ;
      textureData[o] = h; textureData[o + 1] = dx; textureData[o + 2] = dz; textureData[o + 3] = 1;
      maximumHeight = Math.max(maximumHeight, Math.abs(h));
      energy += (v * v + speedSquared * ((dx - slopeX) ** 2 + (dz - slopeZ) ** 2)) * 0.5;
      equilibriumError += (h - equilibrium[i]) ** 2;
      meanHeight += h;
    }
    energy *= spacing * spacing; meanHeight /= Math.max(1, active.length);
    equilibriumError = Math.sqrt(equilibriumError / Math.max(1, active.length)); revision++;
  }

  function applySlosh() {
    if (Math.abs(sloshX) + Math.abs(sloshZ) < 1e-8) return;
    const forceX = clamp(sloshX, -1.2, 1.2), forceZ = clamp(sloshZ, -1.2, 1.2);
    for (const i of active) {
      const x = (coordinateX[i] - wetCenterX) / radius;
      const z = (coordinateZ[i] - wetCenterZ) / radius;
      velocity[i] = clamp(velocity[i] + (forceX * x + forceZ * z) * 0.95, -3.6, 3.6);
    }
    sloshX = sloshZ = 0;
  }

  function advance(delta) {
    if (!Number.isFinite(delta) || delta <= 0) return false;
    // Catch up normal slow frames without changing the stable CFL-limited substep.
    // Only long suspension gaps are dropped; the caller also pauses hidden tabs.
    const accepted = Math.min(delta, 0.25);
    discardedLongFrameSeconds += Math.max(0, delta - accepted); accumulator += accepted;
    applySlosh();
    const coefficient = speedSquared / (spacing * spacing), decay = Math.exp(-damping * step);
    let changed = false;
    while (accumulator + 1e-10 >= step) {
      for (const i of active) potential[i] = height[i] - equilibrium[i];
      let velocitySum = 0;
      for (const i of active) {
        const laplacian = potential[left[i]] + potential[right[i]] + potential[down[i]] + potential[up[i]] - 4 * potential[i];
        velocity[i] = (velocity[i] + laplacian * coefficient * step) * decay;
        velocitySum += velocity[i];
      }
      const meanVelocity = velocitySum / Math.max(1, active.length);
      let sum = 0, clipped = false;
      for (const i of active) {
        velocity[i] -= meanVelocity;
        let h = height[i] + velocity[i] * step;
        if (!Number.isFinite(h) || !Number.isFinite(velocity[i])) { h = 0; velocity[i] = 0; nonFiniteCount++; }
        if (Math.abs(h) > limit) { h = clamp(h, -limit, limit); velocity[i] *= 0.35; clipped = true; }
        height[i] = h; sum += h;
      }
      // The constant mode is volume, not a wave. The rare overload path projects
      // onto both the height bounds and zero mean instead of silently adding water.
      let correction = sum / Math.max(1, active.length);
      for (let pass = 0; pass < (clipped ? 6 : 1); pass++) {
        sum = 0;
        for (const i of active) {
          height[i] = clipped ? clamp(height[i] - correction, -limit, limit) : height[i] - correction;
          sum += height[i];
        }
        correction = sum / Math.max(1, active.length);
      }
      if (clipped) limitedSteps++;
      accumulator -= step; simulationTime += step; stepCount++; changed = true;
    }
    if (changed) writeTexture();
    return changed;
  }

  function addImpulse(x, z, strength = 0.65, footprint = 0.48) {
    if (!isWater(x, z)) { rejectedImpulses++; return false; }
    const r = clamp(Math.abs(footprint), spacing * 1.5, 2.5);
    const amount = clamp(Number(strength) || 0, -3.6, 3.6), reach = r * 2.5, denom = r * r;
    const ix0 = clamp(Math.floor((x - reach + radius) / spacing), 0, size - 1);
    const ix1 = clamp(Math.ceil((x + reach + radius) / spacing), 0, size - 1);
    const iz0 = clamp(Math.floor((z - reach + radius) / spacing), 0, size - 1);
    const iz1 = clamp(Math.ceil((z + reach + radius) / spacing), 0, size - 1);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * size + ix; if (!wet[i]) continue;
      const dx = coordinateX[i] - x, dz = coordinateZ[i] - z;
      const q = (dx * dx + dz * dz) / denom;
      velocity[i] = clamp(velocity[i] + amount * (1 - q) * Math.exp(-q), -3.6, 3.6);
    }
    impulseCount++; return true;
  }

  const pokeIds = [], pokeShapes = [], pokeWeights = [];
  function poke(x, z, strength = 2.2, footprint = 0.60) {
    if (!isWater(x, z)) { rejectedImpulses++; return false; }
    const r = clamp(Math.abs(footprint), spacing * 1.5, 2.5);
    const amount = clamp(Number(strength) || 0, -3.6, 3.6), reach = r * 2.8;
    // A hand-like contact presses an oblique oval, rather than stamping a circle.
    // This changes only the initial condition; the solver propagates and reflects it.
    const angle = x * 0.31 + z * 0.27 + 0.60, ca = Math.cos(angle), sa = Math.sin(angle);
    const ix0 = clamp(Math.floor((x - reach + radius) / spacing), 0, size - 1);
    const ix1 = clamp(Math.ceil((x + reach + radius) / spacing), 0, size - 1);
    const iz0 = clamp(Math.floor((z - reach + radius) / spacing), 0, size - 1);
    const iz1 = clamp(Math.ceil((z + reach + radius) / spacing), 0, size - 1);
    pokeIds.length = pokeShapes.length = pokeWeights.length = 0;
    let shapeSum = 0, weightSum = 0;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * size + ix; if (!wet[i]) continue;
      const dx = coordinateX[i] - x, dz = coordinateZ[i] - z;
      const u = (dx * ca + dz * sa) / (r * 1.18);
      const v = (-dx * sa + dz * ca) / (r * 0.86);
      const q = u * u + v * v, weight = Math.exp(-q);
      const shape = (1 - q) * weight * (1 + 0.14 * Math.tanh(u * 1.7));
      pokeIds.push(i); pokeShapes.push(shape); pokeWeights.push(weight);
      shapeSum += shape; weightSum += weight;
    }
    // Both displacement and momentum have zero integral over the wet footprint,
    // including clicks truncated by a shoreline or the container boundary.
    const correction = shapeSum / Math.max(weightSum, 1e-12);
    let clipped = false;
    for (let k = 0; k < pokeIds.length; k++) {
      const i = pokeIds[k], shape = pokeShapes[k] - correction * pokeWeights[k];
      const h = height[i] - amount * 0.085 * shape;
      if (Math.abs(h) > limit) clipped = true;
      height[i] = clamp(h, -limit, limit);
      velocity[i] = clamp(velocity[i] - amount * 0.55 * shape, -3.6, 3.6);
    }
    // Rare repeated-click overload: preserve bounds and mean volume together.
    if (clipped) for (let pass = 0; pass < 6; pass++) {
      let sum = 0; for (const i of active) sum += height[i];
      const mean = sum / Math.max(1, active.length);
      for (const i of active) height[i] = clamp(height[i] - mean, -limit, limit);
    }
    pokeCount++;
    // Publish immediately: no simulation tick is needed for the first visible response.
    writeTexture();
    return true;
  }

  function addSlosh(forceX, forceZ) {
    if (!Number.isFinite(forceX) || !Number.isFinite(forceZ)) return;
    sloshX += clamp(forceX, -2, 2); sloshZ += clamp(forceZ, -2, 2); sloshCount++;
  }

  function sample(x, z) {
    if (!isWater(x, z)) return { height: 0, dx: 0, dz: 0, wet: false };
    const gx = clamp((x + radius) / spacing, 0, size - 1.001);
    const gz = clamp((z + radius) / spacing, 0, size - 1.001);
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const ids = [iz * size + ix, iz * size + ix + 1, (iz + 1) * size + ix, (iz + 1) * size + ix + 1];
    const weights = [(1 - fx) * (1 - fz), fx * (1 - fz), (1 - fx) * fz, fx * fz];
    let h = 0, dx = 0, dz = 0, weight = 0;
    for (let k = 0; k < 4; k++) {
      const i = ids[k], w = weights[k] * wet[i], offset = i * 4;
      h += textureData[offset] * w; dx += textureData[offset + 1] * w; dz += textureData[offset + 2] * w; weight += w;
    }
    return weight > 1e-8 ? { height: h / weight, dx: dx / weight, dz: dz / weight, wet: true } : { height: 0, dx: 0, dz: 0, wet: false };
  }

  function reset() {
    height.fill(0); velocity.fill(0); accumulator = 0; sloshX = sloshZ = 0; writeTexture();
  }

  rebuildMask(shoreline);
  return {
    radius, size, spacing, step, height, velocity, wet, textureData,
    advance, sample, isWater, addImpulse, poke, addSlosh, reset, setContainerTilt, setShoreline: rebuildMask,
    get revision() { return revision; },
    diagnostics() {
      return {
        model: 'fixed-step shallow-water free-surface approximation; not volumetric fluid',
        boundary: 'reflecting circular wall and island coast',
        resolution: size, wetCells: active.length, totalCells: count, waveSpeed, damping,
        fixedStepSeconds: step, maxCatchUpSeconds: 0.25, simulationTime, stepCount, impulseCount, pokeCount, rejectedImpulses, sloshCount,
        pokeShape: 'volume-balanced asymmetric oval depression',
        containerTilt: { x: tiltX, z: tiltZ }, equilibriumSlope: { x: slopeX, z: slopeZ },
        wetCentroid: { x: wetCenterX, z: wetCenterZ }, tiltUpdates, equilibriumRmsError: equilibriumError,
        maxHeight: maximumHeight, maxAllowedHeight: limit, energy, meanHeight, nonFiniteCount,
        limitedSteps, discardedLongFrameSeconds,
      };
    },
  };
}
