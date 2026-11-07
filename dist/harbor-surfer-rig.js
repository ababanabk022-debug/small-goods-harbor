// Shambling Ghoul uses its original named skeleton. These deterministic poses
// are authored for the island; the GLB does not contain an animation clip.
export function createSurferRig(THREE, gltf, {height = 1.02} = {}) {
  const root = new THREE.Group();
  root.name = 'Shambling Ghoul surfer';
  const figure = gltf.scene;
  root.add(figure);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(figure, true);
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!(sourceHeight > 0)) throw new Error('Surfer model has no measurable height');
  const scale = height / sourceHeight;
  figure.scale.multiplyScalar(scale);
  const bones = new Map(), rest = [];
  figure.traverse(object => {
    if (object.isBone) {
      bones.set(object.name, object);
      rest.push({bone: object, position: object.position.clone(), quaternion: object.quaternion.clone()});
    }
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      // Animated extremities can leave the imported T-pose bounding sphere.
      object.frustumCulled = false;
    }
  });
  const bone = name => {
    const found = bones.get(name);
    if (!found) throw new Error(`Surfer skeleton is missing ${name}`);
    return found;
  };
  // The head shares its skinned mesh with the torso. Build one alternate index
  // buffer so first-person view can hide only head triangles, preserving the
  // real animated arms, torso, legs and their original skin weights.
  const povMeshes = [];
  figure.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !mesh.geometry?.attributes?.skinIndex) return;
    if (/hair/i.test(mesh.name)) {
      povMeshes.push({mesh, visible: mesh.visible, hair: true});
      return;
    }
    const geometry = mesh.geometry;
    // Face parts have their own child bones; hiding only the Head weights
    // leaves floating eyes, mouth and brows when the user looks backwards.
    const headIndices = new Set(mesh.skeleton.bones.flatMap((b,i)=>
      b.name==='Head'||b.name.startsWith('Face_')?[i]:[]));
    if (!headIndices.size || !geometry.index) return;
    const skinIndex = geometry.attributes.skinIndex, skinWeight = geometry.attributes.skinWeight;
    const headWeights = new Float32Array(geometry.attributes.position.count);
    for (let i = 0; i < headWeights.length; i++) for (let j = 0; j < 4; j++) {
      if (headIndices.has(skinIndex.getComponent(i, j))) headWeights[i] += skinWeight.getComponent(i, j);
    }
    const kept = [], indices = geometry.index;
    for (let i = 0; i < indices.count; i += 3) {
      const a = indices.getX(i), b = indices.getX(i+1), c = indices.getX(i+2);
      if (headWeights[a] > .5 || headWeights[b] > .5 || headWeights[c] > .5) continue;
      kept.push(a, b, c);
    }
    if (kept.length === indices.count) return;
    const withoutHead = geometry.clone();withoutHead.setIndex(kept);
    povMeshes.push({mesh, geometry, withoutHead, hair: false});
  });
  let bodyPOV = false;
  function setBodyPOV(active) {
    active = Boolean(active);if (active === bodyPOV) return;bodyPOV = active;
    for (const part of povMeshes) {
      if (part.hair) {if (active) part.visible=part.mesh.visible;part.mesh.visible=active?false:part.visible;}
      else part.mesh.geometry=active?part.withoutHead:part.geometry;
    }
  }
  const hips = bone('Hips');
  const hipsRest = hips.position.clone();
  const legs = ['Left', 'Right'].map((side, index) => {
    const upper = bone(`${side}UpLeg`), lower = bone(`${side}Leg`), foot = bone(`${side}Foot`);
    root.updateMatrixWorld(true);
    return {side: side.toLowerCase(), sign: index === 0 ? 1 : -1, upper, lower, foot,
      upperLength: lower.position.length(), lowerLength: foot.position.length(),
      upperAxis: lower.position.clone().normalize(), lowerAxis: foot.position.clone().normalize(),
      ankleY: figure.worldToLocal(foot.getWorldPosition(new THREE.Vector3())).y, samples: []};
  });
  // Sample the true skinned soles, not the ankle pivot or an unskinned bounding
  // box. Weld duplicate export corners so this costs only tens of vertices.
  figure.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const {skinIndex, skinWeight, position} = mesh.geometry.attributes;
    if (!skinIndex || !skinWeight) return;
    for (const leg of legs) {
      const footIndices = new Set(mesh.skeleton.bones.flatMap((b, i) =>
        b.name === `${leg.side === 'left' ? 'Left' : 'Right'}Foot` ||
        b.name === `${leg.side === 'left' ? 'Left' : 'Right'}ToeBase` ? [i] : []));
      const unique = new Set();
      for (let i = 0; i < position.count; i++) {
        let weight = 0;
        for (let j = 0; j < 4; j++) if (footIndices.has(skinIndex.getComponent(i, j))) weight += skinWeight.getComponent(i, j);
        if (weight < 0.55) continue;
        const key = `${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)},${position.getZ(i).toFixed(5)}`;
        if (unique.has(key)) continue;
        unique.add(key);
        leg.samples.push({mesh, index: i});
      }
    }
  });
  if (legs.some(leg => !leg.samples.length)) throw new Error('Surfer has no weighted foot vertices');
  const arms = ['Left', 'Right'].map((side, index) => {
    const upper = bone(`${side}Arm`), lower = bone(`${side}ForeArm`), hand = bone(`${side}Hand`);
    return {side: side.toLowerCase(), sign: index === 0 ? 1 : -1, upper, lower, hand,
      upperLength: lower.position.length(), lowerLength: hand.position.length(),
      upperAxis: lower.position.clone().normalize(), lowerAxis: hand.position.clone().normalize(), samples: []};
  });
  const meshes = [];
  figure.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    meshes.push(mesh);
    const {skinIndex, skinWeight, position} = mesh.geometry.attributes;
    for (const arm of arms) {
      const prefix = arm.side === 'left' ? 'LeftHand' : 'RightHand';
      const indices = new Set(mesh.skeleton.bones.flatMap((b, i) => b.name.startsWith(prefix) ? [i] : []));
      const unique = new Set();
      for (let i = 0; i < position.count; i++) {
        let weight = 0;
        for (let j = 0; j < 4; j++) if (indices.has(skinIndex.getComponent(i, j))) weight += skinWeight.getComponent(i, j);
        if (weight < .55) continue;
        const key = `${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)},${position.getZ(i).toFixed(5)}`;
        if (!unique.has(key)) {unique.add(key); arm.samples.push({mesh, index: i});}
      }
    }
  });

  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = t => {t = clamp(t, 0, 1); return t * t * (3 - 2 * t);};
  const inverseRoot = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const figureWorldQuaternion = new THREE.Quaternion();
  const parentQuaternion = new THREE.Quaternion();
  const desiredQuaternion = new THREE.Quaternion();
  const footYawQuaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const hipWorld = new THREE.Vector3(), ankleWorld = new THREE.Vector3();
  const direction = new THREE.Vector3(), pole = new THREE.Vector3(), kneeWorld = new THREE.Vector3();
  const limbDirection = new THREE.Vector3(), worldScale = new THREE.Vector3();
  const contactBoxes = {left: new THREE.Box3(), right: new THREE.Box3()};
  const state = {phase: 'idle', progress: 0, time: 0, stance: 0, balanceX: 0, balanceZ: 0};
  const soleClearance = 0.004;

  function aimLimb(limb, axis, from, to) {
    limbDirection.subVectors(to, from).normalize();
    desiredQuaternion.setFromUnitVectors(axis, limbDirection);
    limb.parent.getWorldQuaternion(parentQuaternion);
    limb.quaternion.copy(parentQuaternion.invert()).multiply(desiredQuaternion);
    limb.updateWorldMatrix(false, true);
  }

  function plantLeg(leg, halfStance, footYaw, strideZ = 0, lift = 0) {
    leg.upper.getWorldPosition(hipWorld);
    ankleWorld.set(leg.sign * halfStance / scale, leg.ankleY + lift / scale, strideZ / scale).applyMatrix4(figure.matrixWorld);
    direction.subVectors(ankleWorld, hipWorld);
    const desiredDistance = direction.length();
    direction.normalize();
    figure.getWorldScale(worldScale);
    const l1 = leg.upperLength * worldScale.x, l2 = leg.lowerLength * worldScale.x;
    const distance = clamp(desiredDistance, Math.abs(l1 - l2) + 0.00001, l1 + l2 - 0.00001);
    const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    // Both knees bend toward the character's front, regardless of the board's
    // yaw/pitch/roll in the scene. The whole planted stance follows the deck.
    pole.set(0, 0, 1).applyQuaternion(figureWorldQuaternion);
    pole.addScaledVector(direction, -pole.dot(direction)).normalize();
    kneeWorld.copy(hipWorld).addScaledVector(direction, along).addScaledVector(pole, bend);
    aimLimb(leg.upper, leg.upperAxis, hipWorld, kneeWorld);
    aimLimb(leg.lower, leg.lowerAxis, kneeWorld, ankleWorld);
    footYawQuaternion.setFromAxisAngle(up, leg.sign * footYaw);
    desiredQuaternion.copy(figureWorldQuaternion).multiply(footYawQuaternion);
    leg.foot.parent.getWorldQuaternion(parentQuaternion);
    leg.foot.quaternion.copy(parentQuaternion.invert()).multiply(desiredQuaternion);
    leg.foot.updateWorldMatrix(false, true);
  }

  function measureContacts() {
    inverseRoot.copy(root.matrixWorld).invert();
    for (const leg of legs) {
      const box = contactBoxes[leg.side];
      box.makeEmpty();
      for (const sample of leg.samples) {
        sample.mesh.getVertexPosition(sample.index, point);
        point.applyMatrix4(sample.mesh.matrixWorld).applyMatrix4(inverseRoot);
        box.expandByPoint(point);
      }
    }
  }

  function applyStandingPose({phase = 'idle', progress = 0, time = 0, balanceX = 0, balanceZ = 0, uprightPitch = 0, returning = false, extraCrouch = 0, gaitWeight = 1} = {}) {
    progress = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
    time = Number.isFinite(time) ? time : 0;
    balanceX = clamp(balanceX || 0, -0.28, 0.28);
    balanceZ = clamp(balanceZ || 0, -0.28, 0.28);
    for (const saved of rest) {
      saved.bone.position.copy(saved.position);
      saved.bone.quaternion.copy(saved.quaternion);
    }
    const airborne = phase === 'jump';
    const stance = phase === 'surf' ? 1 : airborne ? (returning ? 1 - smooth(progress) : smooth(progress)) : 0;
    const tuck = airborne ? Math.sin(progress * Math.PI) : 0;
    const crouch = phase === 'crouch' ? smooth(progress) : 0;
    const breath = Math.sin(time * 1.7) * 0.002;
    const halfStance = mix(0.082, 0.28, stance);
    figure.rotation.set(0, -stance * Math.PI * 0.5, 0);
    figure.position.set(0, 0, 0);
    // The youngest preset has genuinely shorter legs. All reaches use its
    // measured bone lengths, with enough hip drop to widen the feet safely.
    hips.position.y -= (0.018 + 0.115 * stance + 0.055 * tuck + 0.075 * crouch + extraCrouch + (phase === 'walk' ? 0.02 : 0) - breath) / scale;
    hips.position.x += (Math.sin(time * 1.23) * 0.008 * stance - balanceZ * 0.035) / scale;
    hips.position.z += (-0.018 * stance + balanceX * 0.035) / scale;
    bone('Spine').rotation.set(-0.03 - 0.06 * stance + balanceX * 0.4, 0.05 * stance, balanceZ * 0.4);
    bone('Spine1').rotation.set(0.01, 0.04 * stance, -0.025 * stance);
    bone('Spine2').rotation.set(-0.035 * stance, 0.03 * stance, 0);
    bone('Neck').rotation.set(-0.08 * stance, 0.28 * stance, 0);
    bone('Head').rotation.set(-0.05 * stance + 0.025 * Math.sin(time * 0.7), 0.49 * stance, 0.02 * Math.sin(time * 0.9));
    // Feet and legs follow the tilted deck. Counter its fore/aft pitch through
    // the spine instead of leaning the whole rider into the wave; the rider's
    // local Z axis corresponds to the board's X after the sideways stance.
    const upright=clamp(uprightPitch,-.85,.85)*stance;
    bone('Spine').rotation.z+=upright*.40;
    bone('Spine1').rotation.z+=upright*.35;
    bone('Spine2').rotation.z+=upright*.25;
    const armLower = mix(1.12, 0.38, stance) - 0.22 * tuck;
    bone('LeftArm').rotation.set(0.08 * stance, -0.20 - 0.24 * stance, -armLower + balanceZ * 0.7);
    bone('RightArm').rotation.set(-0.06 * stance, 0.20 + 0.05 * stance, armLower + balanceZ * 0.7);
    bone('LeftForeArm').rotation.set(0, -0.28 - 0.25 * stance, -0.08 - 0.20 * tuck);
    bone('RightForeArm').rotation.set(0, 0.26 + 0.16 * stance, 0.07 + 0.20 * tuck);
    bone('LeftHand').rotation.set(0.03, 0, -0.07 * stance);
    bone('RightHand').rotation.set(-0.03, 0, 0.07 * stance);
    if (phase === 'walk') {
      const swing = Math.sin(time * 7.5) * 0.32 * gaitWeight;
      bone('LeftArm').rotation.y -= swing;
      bone('RightArm').rotation.y -= swing;
      bone('Spine').rotation.z += Math.sin(time * 7.5) * 0.025 * gaitWeight;
    }
    root.parent?.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
    figure.getWorldQuaternion(figureWorldQuaternion);
    for (const leg of legs) {
      const step = time * 7.5 + (leg.sign > 0 ? 0 : Math.PI);
      const stride = phase === 'walk' ? Math.sin(step) * 0.075 * gaitWeight : 0;
      const lift = phase === 'walk' ? Math.max(0, Math.cos(step)) * 0.042 * gaitWeight : 0;
      plantLeg(leg, halfStance, mix(0.04, 0.14, stance), stride, lift);
    }
    root.parent?.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
    measureContacts();
    const bottom = Math.min(contactBoxes.left.min.y, contactBoxes.right.min.y);
    figure.position.y = soleClearance - bottom;
    root.parent?.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
    // Translation is in root coordinates, so contact remains correct even
    // when a pitched board is parented under a rotated island scene.
    contactBoxes.left.translate(new THREE.Vector3(0, figure.position.y, 0));
    contactBoxes.right.translate(new THREE.Vector3(0, figure.position.y, 0));
    Object.assign(state, {phase, progress, time, stance, balanceX, balanceZ});
  }

  function updatePoseWorld() {
    root.parent?.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
  }

  function resetPose() {
    for (const saved of rest) {
      saved.bone.position.copy(saved.position);
      saved.bone.quaternion.copy(saved.quaternion);
    }
    figure.position.set(0, 0, 0);
    figure.rotation.set(0, 0, 0);
  }

  function moveHipsTo(x, y, z) {
    updatePoseWorld();
    root.worldToLocal(hips.getWorldPosition(point));
    figure.position.add(new THREE.Vector3(x - point.x, y - point.y, z - point.z));
    updatePoseWorld();
  }

  function applySwimmingPose(time, yaw = 0, prone = false) {
    resetPose();
    figure.rotation.set(prone ? Math.PI * .5 : 1.43, yaw, 0, 'YXZ');
    bone('Spine').rotation.x = -.30;
    bone('Spine1').rotation.x = -.14;
    bone('Spine2').rotation.x = -.08;
    bone('Neck').rotation.x = -.26;
    bone('Head').rotation.x = -.18;
    const stroke = time * 4.5;
    for (const side of ['Left', 'Right']) {
      const sign = side === 'Left' ? 1 : -1;
      const cycle = stroke + (sign < 0 ? Math.PI : 0);
      bone(`${side}Arm`).rotation.set(prone ? .14 : Math.cos(cycle) * .5, prone ? sign * -.22 : Math.sin(cycle) * .82, sign * (prone ? -.82 : -.40));
      bone(`${side}ForeArm`).rotation.set(0, sign * (prone ? -.7 : -.55 - .32 * Math.cos(cycle)), 0);
      bone(`${side}UpLeg`).rotation.x = prone ? .08 : Math.sin(cycle + .5) * .15;
      bone(`${side}Leg`).rotation.x = prone ? -.22 : -.12 - Math.max(0, Math.sin(cycle)) * .25;
      bone(`${side}Foot`).rotation.x = -.12;
    }
    moveHipsTo(0, prone ? .17 : -.055, prone ? -.10 : 0);
  }

  function applyKneelingPose() {
    applySwimmingPose(0, 0, true);
    for (const side of ['Left', 'Right']) {
      bone(`${side}UpLeg`).rotation.x = -1.10;
      bone(`${side}Leg`).rotation.x = 1.10;
      bone(`${side}Foot`).rotation.x = -Math.PI * .5;
    }
    moveHipsTo(0, .28, -.10);
  }

  const makePoseCache = () => ({position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    bones: rest.map(() => ({position: new THREE.Vector3(), quaternion: new THREE.Quaternion()}))});
  const poseFrom = makePoseCache(), poseTo = makePoseCache();
  function capturePose(cache) {
    cache.position.copy(figure.position); cache.quaternion.copy(figure.quaternion);
    rest.forEach((saved, i) => {cache.bones[i].position.copy(saved.bone.position); cache.bones[i].quaternion.copy(saved.bone.quaternion);});
  }
  function blendPoses(amount) {
    figure.position.lerpVectors(poseFrom.position, poseTo.position, amount);
    figure.quaternion.slerpQuaternions(poseFrom.quaternion, poseTo.quaternion, amount);
    rest.forEach((saved, i) => {
      saved.bone.position.lerpVectors(poseFrom.bones[i].position, poseTo.bones[i].position, amount);
      saved.bone.quaternion.slerpQuaternions(poseFrom.bones[i].quaternion, poseTo.bones[i].quaternion, amount);
    });
    updatePoseWorld();
  }

  function supportHands(weight, deckOffsetY = 0, boardOffsetX = 0, acrossDeck = 1) {
    if (weight <= 0) return;
    updatePoseWorld();
    for (const arm of arms) {
      const before = [arm.upper.quaternion.clone(), arm.lower.quaternion.clone(), arm.hand.quaternion.clone()];
      const wristTarget = new THREE.Vector3(
        mix(-.27 - boardOffsetX, arm.sign * .15, acrossDeck), deckOffsetY + .022,
        mix(arm.sign * .17, .19, acrossDeck));
      root.localToWorld(wristTarget);
      arm.upper.getWorldPosition(hipWorld);
      direction.subVectors(wristTarget, hipWorld).normalize();
      figure.getWorldScale(worldScale);
      const l1 = arm.upperLength * worldScale.x, l2 = arm.lowerLength * worldScale.x;
      const distance = clamp(wristTarget.distanceTo(hipWorld), Math.abs(l1-l2)+.00001, l1+l2-.00001);
      const along = (l1*l1-l2*l2+distance*distance)/(2*distance);
      root.getWorldQuaternion(parentQuaternion);
      pole.set(arm.sign * .4, .8, -.3).applyQuaternion(parentQuaternion);
      pole.addScaledVector(direction, -pole.dot(direction)).normalize();
      kneeWorld.copy(hipWorld).addScaledVector(direction, along).addScaledVector(pole, Math.sqrt(Math.max(0,l1*l1-along*along)));
      aimLimb(arm.upper, arm.upperAxis, hipWorld, kneeWorld);
      aimLimb(arm.lower, arm.lowerAxis, kneeWorld, wristTarget);
      root.getWorldQuaternion(desiredQuaternion);
      footYawQuaternion.setFromAxisAngle(up, arm.sign > 0 ? -.35 : Math.PI + .35);
      desiredQuaternion.multiply(footYawQuaternion);
      arm.hand.parent.getWorldQuaternion(parentQuaternion);
      arm.hand.quaternion.copy(parentQuaternion.invert()).multiply(desiredQuaternion);
      arm.upper.quaternion.slerpQuaternions(before[0], arm.upper.quaternion.clone(), weight);
      arm.lower.quaternion.slerpQuaternions(before[1], arm.lower.quaternion.clone(), weight);
      arm.hand.quaternion.slerpQuaternions(before[2], arm.hand.quaternion.clone(), weight);
      updatePoseWorld();
    }
  }

  function keepBodyAboveDeck() {
    updatePoseWorld();
    inverseRoot.copy(root.matrixWorld).invert();
    let lowest = Infinity;
    for (const mesh of meshes) for (let i=0; i<mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot);
      if (Math.abs(point.x)<.30 && Math.abs(point.z)<.65) lowest=Math.min(lowest,point.y);
    }
    if (lowest < soleClearance) {
      figure.position.y += soleClearance-lowest;
      updatePoseWorld();
    }
  }

  function setPose(options = {}) {
    const {phase = 'idle', time = 0, returning = false} = options;
    const progress = clamp(options.progress || 0, 0, 1);
    const p = returning ? 1 - progress : progress;
    if (phase === 'water-jump') {
      // A continuous change from swimming into the planted surfing stance;
      // the trajectory itself is supplied by the surfing controller.
      applySwimmingPose(time);capturePose(poseFrom);
      applyStandingPose({...options,phase:'surf'});capturePose(poseTo);
      blendPoses(smooth(p));
    } else if (phase === 'swim') {
      applySwimmingPose(time);
    } else if (phase === 'wade') {
      applyStandingPose({...options, phase: 'walk', gaitWeight: 1 - smooth(p)}); capturePose(poseFrom);
      applySwimmingPose(time); capturePose(poseTo);
      blendPoses(smooth((p - .30) / .70));
    } else if (phase === 'mount') {
      applySwimmingPose(time, Math.PI * .5); capturePose(poseFrom);
      applySwimmingPose(0, 0, true); capturePose(poseTo);
      blendPoses(smooth(p));
      // Finish the reach before the shoulder crosses its 180-degree IK
      // ambiguity.  Interpolating halfway through that crossing would switch
      // quaternion hemispheres and visibly throw the hand across the body.
      supportHands(smooth(p/.10), options.deckOffsetY || 0, options.boardOffsetX ?? -.45*(1-smooth(p)), smooth((p-.35)/.65));
    } else if (phase === 'stand') {
      if (p < .32) {
        applySwimmingPose(0, 0, true); capturePose(poseFrom);
        applyKneelingPose(); capturePose(poseTo);
        blendPoses(smooth(p / .32));
      } else if (p < .82) {
        applyKneelingPose(); capturePose(poseFrom);
        applyStandingPose({...options, phase: 'surf', extraCrouch: .07}); capturePose(poseTo);
        blendPoses(smooth((p - .32) / .50));
      } else {
        applyStandingPose({...options, phase: 'surf', extraCrouch: .07 * (1 - smooth((p - .82) / .18))});
      }
      supportHands(1-smooth((p-.32)/.28), 0, 0, 1);
      keepBodyAboveDeck();
      supportHands(1-smooth((p-.32)/.28), 0, 0, 1);
    } else {
      applyStandingPose(options);
    }
    Object.assign(state, {phase, progress, time, returning, stance: phase === 'surf' ? 1 : phase === 'stand' ? p : 0});
  }

  function getEyeLocal() {
    updatePoseWorld();
    const eye = new THREE.Vector3(0, .065, .09);
    bone('Head').localToWorld(eye);
    return root.worldToLocal(eye);
  }

  function getHandContacts() {
    updatePoseWorld(); inverseRoot.copy(root.matrixWorld).invert();
    const result = {};
    for (const arm of arms) {
      const box = new THREE.Box3();
      for (const sample of arm.samples) {
        sample.mesh.getVertexPosition(sample.index, point).applyMatrix4(sample.mesh.matrixWorld).applyMatrix4(inverseRoot);
        box.expandByPoint(point);
      }
      result[arm.side] = {minY:box.min.y,maxY:box.max.y,min:box.min.toArray(),max:box.max.toArray(),samples:arm.samples.length};
    }
    return result;
  }

  function getFootContacts() {
    root.parent?.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
    measureContacts();
    const result = {};
    for (const side of ['left', 'right']) {
      const box = contactBoxes[side];
      result[side] = {minY: box.min.y, maxY: box.max.y,
        center: [(box.min.x + box.max.x) * 0.5, box.min.y, (box.min.z + box.max.z) * 0.5],
        min: box.min.toArray(), max: box.max.toArray(), samples: legs.find(leg => leg.side === side).samples.length};
    }
    return result;
  }

  function diagnostics() {
    return {...state, height, scale, sourceHeight, age: 'kid', boneCount: bones.size,
      feet: getFootContacts(), hands: getHandContacts(), eye: getEyeLocal().toArray(), soleClearance, hipsRest: hipsRest.toArray(),
      stanceConvention: '+Z board nose; surfing torso faces -X toward island; swim root is water surface at hips; soles measured in placement-root coordinates'};
  }

  function dispose() {
    setBodyPOV(false);
    for (const part of povMeshes) part.withoutHead?.dispose();
    root.removeFromParent();
    const geometries = new Set(), materials = new Set();
    figure.traverse(object => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
  setPose();
  return {root, height, radius: 0.55, footprint: {width: 0.3, length: 0.72}, setPose, setBodyPOV, getFootContacts, getHandContacts, getEyeLocal, diagnostics, dispose};
}
