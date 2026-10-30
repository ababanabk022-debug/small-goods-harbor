/**
 * Boat cruising, damped buoyancy, wake trails, and the island's walking actors.
 * Geometry stays at its authored scale. Navigation and wake forces are local.
 */
import { createWaterNavigator } from './harbor-navigation.js?v=13.1';
import { createLandNavigator } from './harbor-land-navigation.js?v=14.3';
import { createHarborHike } from './harbor-hike.js?v=14.3';
import { clearHarborTrail } from './harbor-trail-clearance.js?v=14.3';
const TAU=Math.PI*2;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const angleDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const damp=(a,b,k,dt)=>a+(b-a)*(1-Math.exp(-k*dt));
const finite=(v,f=0)=>Number.isFinite(v)?v:f;

export function createHarborMotion(THREE,{model,meta={},water,scene}){
  const trailClearance=clearHarborTrail(THREE,model);
  const boat=model.getObjectByName(meta.boat?.node||'BOAT');
  const radius=meta.water?.radius||water.radius||8.5;
  const shoreline=meta.shoreline||meta.water?.shoreline||[];
  const obstacles=meta.boatObstacles||[];
  const navigator=createWaterNavigator({radius,shoreline,obstacles,edgeClearance:.95,obstacleClearance:.90,isWater:(x,z)=>water.isWater?.(x,z)??true});
  const root=new THREE.Group();root.name='Harbor · physical wakes';scene.add(root);
  const forwardMeta=meta.boat?.forward||meta.boatForward||[-.819152044,0,.573576436];
  const forwardXZ=forwardMeta.length===2?forwardMeta:[forwardMeta[0],forwardMeta[2]];
  const restHeading=Math.atan2(forwardXZ[0],forwardXZ[1]);
  const restQuaternion=boat?.quaternion.clone()||new THREE.Quaternion();
  const baseY=finite(meta.boat?.waterlineOffset,boat?.position.y||.2);
  let heading=restHeading,speed=0,vertical=boat?.position.y||baseY,verticalV=0;
  let gradientX=0,gradientZ=0,gradientVX=0,gradientVZ=0;
  let route=[],routeIndex=0,destination=null,mode='departing',pauseTime=.8;
  const patrolCircuit=navigator.createPatrolCircuit(-1);
  let patrolLoopStart=-1,patrolSweep=0,previousPatrolAngle=0,patrolCircuits=0;
  let wakeTime=0,blockedTime=0,totalDistance=0,destinationsAccepted=0,destinationsRejected=0;
  let blockedMoves=0,simulationTime=0,previousHeading=heading,turnVelocity=0;
  let containerX=0,containerZ=0,lastContainerX=0,lastContainerZ=0,containerVX=0,containerVZ=0;
  let balanceX=0,balanceZ=0,driftX=0,driftZ=0,driftDistance=0,wakeForces=0;
  function setContainerTilt(x,z){
    if(!Number.isFinite(x)||!Number.isFinite(z))return;
    containerX=clamp(x,-.35,.35);containerZ=clamp(z,-.35,.35);
  }
  function updateContainer(dt){
    containerVX=damp(containerVX,clamp((containerX-lastContainerX)/Math.max(dt,.001),-2,2),8,dt);
    containerVZ=damp(containerVZ,clamp((containerZ-lastContainerZ)/Math.max(dt,.001),-2,2),8,dt);
    lastContainerX=containerX;lastContainerZ=containerZ;
    balanceX=damp(balanceX,clamp(-containerX*.72-containerVX*.045,-.24,.24),5.4,dt);
    balanceZ=damp(balanceZ,clamp(-containerZ*.72-containerVZ*.045,-.24,.24),5.4,dt);
  }
  const up=new THREE.Vector3(0,1,0),normal=new THREE.Vector3(),headingQ=new THREE.Quaternion(),tiltQ=new THREE.Quaternion();
  const boatStart=boat?.position.clone();
  if(boat)previousPatrolAngle=Math.atan2(boat.position.x,boat.position.z);

  const wakeCapacity=112,wakeLife=8.0,wakeSamples=[];
  const wakeGeometries=[];
  const wakeMaterial=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,
    uniforms:{foamColor:{value:new THREE.Color('#edfdf1')}},
    vertexShader:`attribute float wakeOpacity;
      attribute float wakeAcross; attribute float wakeAlong;
      varying float vWakeOpacity; varying float vWakeAcross; varying float vWakeAlong;
      void main(){vWakeOpacity=wakeOpacity;vWakeAcross=wakeAcross;vWakeAlong=wakeAlong;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform vec3 foamColor;
      varying float vWakeOpacity; varying float vWakeAcross; varying float vWakeAlong;
      void main(){
        float edge=1.-smoothstep(.42,1.,abs(vWakeAcross));
        float broken=.67+.33*sin(vWakeAlong*16.+vWakeAcross*4.);
        gl_FragColor=vec4(foamColor,vWakeOpacity*edge*broken);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  for(let side=0;side<2;side++){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(wakeCapacity*2*3),3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('wakeOpacity',new THREE.BufferAttribute(new Float32Array(wakeCapacity*2),1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('wakeAcross',new THREE.BufferAttribute(new Float32Array(wakeCapacity*2),1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('wakeAlong',new THREE.BufferAttribute(new Float32Array(wakeCapacity*2),1).setUsage(THREE.DynamicDrawUsage));
    const indices=[];for(let i=0;i<wakeCapacity-1;i++){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
    geometry.setIndex(indices);geometry.setDrawRange(0,0);
    const mesh=new THREE.Mesh(geometry,wakeMaterial);mesh.frustumCulled=false;mesh.renderOrder=7;
    mesh.name=side?'Little Tide · spreading starboard wake':'Little Tide · spreading port wake';root.add(mesh);wakeGeometries.push(geometry);
  }
  // One instanced draw call adds irregular bubbles to the newly churned stern.
  const foamCapacity=144,foamGeometry=new THREE.IcosahedronGeometry(1,0);
  const foamMaterial=new THREE.MeshBasicMaterial({color:'#eefcf0',transparent:true,opacity:.74,depthWrite:false});
  const foamPearls=new THREE.InstancedMesh(foamGeometry,foamMaterial,foamCapacity);
  foamPearls.name='Little Tide · scattered stern foam';foamPearls.count=0;
  foamPearls.frustumCulled=false;foamPearls.renderOrder=8;foamPearls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(foamPearls);
  const foamDummy=new THREE.Object3D();

  function sample(x,z){const s=water.sample?.(x,z);return s&&typeof s==='object'?s:{height:finite(water.sampleHeight?.(x,z,simulationTime)),dx:0,dz:0};}
  // A centerline can be clear while the bow cannot make its turn. Preview
  // the same steering controller before accepting a user-directed detour.
  function routeSteerable(path){
    if(!path||path.length<2)return false;
    let x=boat.position.x,z=boat.position.z,h=heading,v=speed,index=1;
    const dt=.05,cruise=(meta.boat?.speed||.48)*1.6;
    const length=path.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-path[i][0],p[1]-path[i][1]),0);
    const limit=Math.ceil((length/cruise+30)/dt);
    for(let i=0;i<limit;i++){
      const p=path[index],dx=p[0]-x,dz=p[1]-z,distance=Math.hypot(dx,dz);
      if(distance<.34){if(++index>=path.length)return true;continue;}
      const error=angleDiff(Math.atan2(dx,dz),h);
      h+=clamp(error*2.2,-.85,.85)*dt;
      v=damp(v,cruise*Math.pow(Math.max(0,Math.cos(error)),3),Math.abs(error)>.65?5:1.8,dt);
      x+=dx/Math.max(distance,.001)*v*dt;z+=dz/Math.max(distance,.001)*v*dt;
      if(!navigator.safe(x,z)||!navigator.poseSafe(x,z,h))return false;
    }
    return false;
  }
  function choosePatrol(){
    if(!boat||!patrolCircuit)return false;
    const points=patrolCircuit.points,n=points.length,direction=patrolCircuit.direction;
    const angle=Math.atan2(boat.position.x,boat.position.z);
    const entry=Math.round((angle+direction*.16)/direction/TAU*n);
    for(let offset=0;offset<12;offset++){
      const first=((entry+offset)%n+n)%n;
      const point=points[first];
      const approach=navigator.plan([boat.position.x,boat.position.z],point);
      if(!approach||approach.length<2||!routeSteerable([...approach,points[(first+1)%n],points[(first+2)%n]]))continue;
      // Traverse all ordered waypoints, then wrap to the first circuit point.
      // The one-time approach from a click destination is never repeated.
      route=approach.map(p=>p.slice());patrolLoopStart=route.length-1;
      for(let i=1;i<n;i++)route.push(points[(first+i)%n].slice());
      routeIndex=1;destination=point.slice();mode='cruising';pauseTime=0;blockedTime=0;
      return true;
    }
    mode='waiting-for-clear-water';route=[];destination=null;return false;
  }
  function setDestination(x,z){
    if(!Number.isFinite(x)||!Number.isFinite(z)||!boat||!navigator.safe(x,z)){destinationsRejected++;return false;}
    const target=[x,z],start=[boat.position.x,boat.position.z],candidates=[];
    if(Math.hypot(x-start[0],z-start[1])<2)candidates.push(navigator.plan(start,target));
    if(patrolCircuit){
      const points=patrolCircuit.points,n=points.length,direction=patrolCircuit.direction;
      const currentAngle=Math.atan2(start[0],start[1]),targetAngle=Math.atan2(x,z);
      const first=((Math.round((currentAngle+direction*.16)/direction/TAU*n)%n)+n)%n;
      const approach=navigator.plan(start,points[first]);
      if(approach){
        // Follow the established direction around land. Leave the circuit a
        // little before the goal, so the final approach has room to turn inward.
        for(const lead of [.24,.40,.60,0]){
          const end=((Math.round((targetAngle-direction*lead)/direction/TAU*n)%n)+n)%n;
          if(!navigator.segmentSafe(points[end],target))continue;
          const path=approach.map(p=>p.slice()),steps=(end-first+n)%n;
          for(let i=1;i<=steps;i++)path.push(points[(first+i)%n].slice());
          path.push(target);candidates.push(path);
        }
      }
    }
    const path=candidates.find(candidate=>routeSteerable(candidate));
    if(!path){destinationsRejected++;return false;}
    route=path;routeIndex=1;patrolLoopStart=-1;destination=target;
    mode='sailing-to-point';pauseTime=0;blockedTime=0;destinationsAccepted++;return true;
  }

  function updateNavigation(dt){
    if(!boat)return;
    if(pauseTime>0){pauseTime=Math.max(0,pauseTime-dt);speed=damp(speed,0,4,dt);if(!pauseTime)choosePatrol();return;}
    if(!destination||routeIndex>=route.length){choosePatrol();return;}
    let point=route[routeIndex],dx=point[0]-boat.position.x,dz=point[1]-boat.position.z;
    let distance=Math.hypot(dx,dz);
    if(distance<.34){
      routeIndex++;
      if(routeIndex>=route.length){
        if(mode==='cruising'&&patrolLoopStart>=0){
          routeIndex=patrolLoopStart;patrolCircuits++;
        }else{
          pauseTime=1.8;mode='arrived';destination=null;return;
        }
      }
      point=route[routeIndex];dx=point[0]-boat.position.x;dz=point[1]-boat.position.z;distance=Math.hypot(dx,dz);
    }
    const desiredHeading=Math.atan2(dx,dz),error=angleDiff(desiredHeading,heading);
    let nextHeading=heading+clamp(error*2.2,-.85,.85)*dt;
    const cruise=(meta.boat?.speed||.48)*1.6;
    const wantedSpeed=cruise*Math.pow(Math.max(0,Math.cos(error)),3);
    speed=damp(speed,wantedSpeed,Math.abs(error)>.65?5:1.8,dt);
    let nx=boat.position.x+dx/Math.max(distance,.001)*speed*dt,nz=boat.position.z+dz/Math.max(distance,.001)*speed*dt;
    if(!navigator.safe(nx,nz)||!navigator.poseSafe(nx,nz,nextHeading)){
      // No collision step is committed. Slow down, and try a gradual seaward turn.
      blockedMoves++;blockedTime+=dt;speed=damp(speed,0,6,dt);
      let recovered=false;
      for(const sign of [Math.sign(error)||1,-(Math.sign(error)||1)]){
        const turn=heading+sign*.75*dt;
        const px=boat.position.x+Math.sin(turn)*Math.min(speed,.14)*dt;
        const pz=boat.position.z+Math.cos(turn)*Math.min(speed,.14)*dt;
        if(navigator.safe(px,pz)&&navigator.poseSafe(px,pz,turn)){nextHeading=turn;nx=px;nz=pz;recovered=true;break;}
      }
      if(!recovered){nx=boat.position.x;nz=boat.position.z;nextHeading=heading;}
      if(blockedTime>1.8){blockedTime=0;choosePatrol();}
    }else blockedTime=0;
    totalDistance+=Math.hypot(nx-boat.position.x,nz-boat.position.z);
    boat.position.x=nx;boat.position.z=nz;heading=nextHeading;
    const currentAngle=Math.atan2(nx,nz);
    if(mode==='cruising')patrolSweep+=angleDiff(currentAngle,previousPatrolAngle);
    previousPatrolAngle=currentAngle;
  }
  function updateDrift(dt){
    if(!boat)return;
    // Gravity projected into the tilting container plus a short inertial lag.
    driftX+=(Math.sin(-containerZ)*.95-containerVZ*.28-1.65*driftX)*dt;
    driftZ+=(Math.sin(containerX)*.95+containerVX*.28-1.65*driftZ)*dt;
    driftX=clamp(driftX,-.27,.27);driftZ=clamp(driftZ,-.27,.27);
    const nx=boat.position.x+driftX*dt,nz=boat.position.z+driftZ*dt;
    if(navigator.safe(nx,nz)&&navigator.poseSafe(nx,nz,heading)){
      driftDistance+=Math.hypot(nx-boat.position.x,nz-boat.position.z);
      boat.position.x=nx;boat.position.z=nz;
    }else{driftX*=.72;driftZ*=.72;}
  }
  function updateBuoyancy(dt){
    if(!boat)return;
    const fx=Math.sin(heading),fz=Math.cos(heading),rx=fz,rz=-fx;
    const x=boat.position.x,z=boat.position.z;
    const c=sample(x,z),bow=sample(x+fx*.78,z+fz*.78),stern=sample(x-fx*.78,z-fz*.78);
    const left=sample(x-rx*.40,z-rz*.40),right=sample(x+rx*.40,z+rz*.40);
    const target=baseY+(2*c.height+bow.height+stern.height+left.height+right.height)/6;
    const along=clamp((bow.height-stern.height)/1.56,-.22,.22);
    const across=clamp((right.height-left.height)/.8,-.22,.22);
    turnVelocity=damp(turnVelocity,angleDiff(heading,previousHeading)/Math.max(dt,.001),3,dt);previousHeading=heading;
    const gx=clamp(along*fx+across*rx+turnVelocity*speed*rx*.055-containerVZ*.035,-.28,.28);
    const gz=clamp(along*fz+across*rz+turnVelocity*speed*rz*.055+containerVX*.035,-.28,.28);
    const omega=5.1,damping=1.05;
    verticalV+=(omega*omega*(target-vertical)-2*damping*omega*verticalV)*dt;
    vertical+=verticalV*dt;
    gradientVX+=(20*(gx-gradientX)-8.8*gradientVX)*dt;gradientX+=gradientVX*dt;
    gradientVZ+=(20*(gz-gradientZ)-8.8*gradientVZ)*dt;gradientZ+=gradientVZ*dt;
    boat.position.y=vertical;
    normal.set(-gradientX,1,-gradientZ).normalize();tiltQ.setFromUnitVectors(up,normal);
    headingQ.setFromAxisAngle(up,heading-restHeading);
    boat.quaternion.copy(tiltQ).multiply(headingQ).multiply(restQuaternion);
  }
  function emitWake(dt){
    if(!boat)return;
    wakeTime+=dt;
    const throughWaterSpeed=Math.hypot(speed,driftX,driftZ);
    if(wakeTime<.080||throughWaterSpeed<.035)return;
    wakeTime=0;
    const fx=Math.sin(heading),fz=Math.cos(heading),rx=fz,rz=-fx;
    const x=boat.position.x-fx*1.02,z=boat.position.z-fz*1.02;
    wakeSamples.push({x,z,fx,fz,rx,rz,time:simulationTime,speed:throughWaterSpeed,seed:wakeForces});
    if(wakeSamples.length>wakeCapacity)wakeSamples.shift();
    const strength=Math.min(.32,.06+throughWaterSpeed*.44);
    water.addImpulse?.(x+rx*.36,z+rz*.36,strength,.25);
    water.addImpulse?.(x-rx*.36,z-rz*.36,strength,.25);
    water.addImpulse?.(x,z,-strength*.68,.29);
    // Water displaced by the bow supplies a smaller forward pressure wave.
    if(wakeForces%2===0)water.addImpulse?.(boat.position.x+fx*1.13,boat.position.z+fz*1.13,strength*.35,.34);
    wakeForces++;
  }
  function renderWake(){
    while(wakeSamples.length&&simulationTime-wakeSamples[0].time>wakeLife)wakeSamples.shift();
    for(let sideIndex=0;sideIndex<2;sideIndex++){
      const side=sideIndex?1:-1,geometry=wakeGeometries[sideIndex];
      const p=geometry.attributes.position,a=geometry.attributes.wakeOpacity;
      const across=geometry.attributes.wakeAcross,along=geometry.attributes.wakeAlong;
      for(let i=0;i<wakeSamples.length;i++){
        const w=wakeSamples[i],age=simulationTime-w.time,fade=clamp(1-age/wakeLife,0,1);
        const separation=.28+age*(.085+w.speed*.21),width=(.085+age*.026)*Math.sqrt(fade);
        for(let edge=0;edge<2;edge++){
          const offset=(separation+(edge?width:-width))*side;
          const x=w.x+w.rx*offset-w.fx*age*.028,z=w.z+w.rz*offset-w.fz*age*.028,j=i*2+edge;
          p.setXYZ(j,x,sample(x,z).height+.033,z);
          a.setX(j,navigator.wet(x,z)?Math.pow(fade,1.18)*clamp(w.speed/.42,0,1)*.86:0);
          across.setX(j,edge?1:-1);along.setX(j,w.time);
        }
      }
      p.needsUpdate=true;a.needsUpdate=true;across.needsUpdate=true;along.needsUpdate=true;
      geometry.setDrawRange(0,Math.max(0,wakeSamples.length-1)*6);
    }
    let foamCount=0;
    for(let i=wakeSamples.length-1;i>=0&&foamCount<foamCapacity;i--){
      const w=wakeSamples[i],age=simulationTime-w.time;if(age>3.2)continue;
      const fade=1-age/3.2;
      for(let j=0;j<3&&foamCount<foamCapacity;j++){
        const jitter=Math.sin(w.seed*12.9898+j*7.13);
        const side=(j-1)*(.13+age*.10)+jitter*.048;
        const x=w.x+w.rx*side-w.fx*(age*.045+j*.035),z=w.z+w.rz*side-w.fz*(age*.045+j*.035);
        if(!navigator.wet(x,z))continue;
        const size=(.022+.013*(.5+jitter*.5))*Math.sqrt(fade)*clamp(w.speed/.36,0,1);
        foamDummy.position.set(x,sample(x,z).height+.031,z);
        foamDummy.scale.set(size*1.25,size*.35,size);foamDummy.rotation.set(0,w.seed*.71,0);
        foamDummy.updateMatrix();foamPearls.setMatrixAt(foamCount++,foamDummy.matrix);
      }
    }
    foamPearls.count=foamCount;foamPearls.instanceMatrix.needsUpdate=true;
  }

  const landNavigator=createLandNavigator(THREE,{model,boundary:meta.landBoundary||[]});
  const actors=[];
  const footprintPoint=new THREE.Vector3();
  for(const spec of (meta.actors||meta.actorRoutes||[])){
    const object=model.getObjectByName(spec.node||spec.name);if(!object)continue;
    const routePoints=spec.route||spec.points||[],points=routePoints.map(p=>new THREE.Vector3(...p));
    const curve=points.length>=3?new THREE.CatmullRomCurve3(points,spec.closed!==false,'centripetal'):null;
    const f=spec.forward||[0,0,1],restAngle=Math.atan2(f[0],f.length>2?f[2]:f[1]);
    const isDog=spec.pose==='dog'||spec.id==='dog';
    const forwardAxis=new THREE.Vector3(f[0],0,f.length>2?f[2]:f[1]).normalize();
    const limbs=[];
    for(const [part,raw]of Object.entries(spec.limbs||{})){
      const limb=model.getObjectByName(raw.node||raw.name);if(!limb)continue;
      const axis=Array.isArray(raw.axis)?new THREE.Vector3(...raw.axis).normalize():
        new THREE.Vector3(raw.axis==='x'||!raw.axis?1:0,raw.axis==='y'?1:0,raw.axis==='z'?1:0).normalize();
      const key=part.toUpperCase(),isArm=key.includes('ARM'),isLeft=key.includes('LEFT');
      const isTail=key.includes('TAIL'),isHead=key.includes('HEAD'),front=key.includes('FRONT');
      const amplitude=raw.amplitude??(isTail?.48:isHead?.16:isDog?.38:isArm?(spec.pose==='carry'?.06:.25):.34);
      const phase=raw.phase??(isDog?((front===isLeft)?0:Math.PI):((isLeft!==isArm)?0:Math.PI));
      limbs.push({part:key,object:limb,axis,base:limb.quaternion.clone(),phase,amplitude,isArm,isLeft,isTail,isHead});
    }
    const length=curve?.getLength()||0;
    // Measure authored geometry, including the carried crate, hands and dog
    // muzzle; the small extra clearance covers limb swings and rounding.
    let contactRadius=0;
    object.updateWorldMatrix(true,true);
    const actorOrigin=object.getWorldPosition(new THREE.Vector3());
    object.traverse(mesh=>{if(!mesh.isMesh)return;const positions=mesh.geometry.attributes.position;
      for(let i=0;i<positions.count;i++){
        footprintPoint.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).sub(actorOrigin);
        contactRadius=Math.max(contactRadius,Math.hypot(footprintPoint.x,footprintPoint.z));
      }
    });
    contactRadius+=.08;
    const routeEnvelope=points.reduce((r,p)=>Math.max(r,Math.hypot(p.x-object.position.x,p.z-object.position.z)),0);
    actors.push({spec,object,curve,length,restAngle,isDog,forwardAxis,base:object.position.clone(),
      baseQuaternion:object.quaternion.clone(),limbs,phase:finite(spec.phase),lastPosition:object.position.clone(),
      distance:0,travel:(spec.routeOffset||0)*length,walkFactor:1,activity:'walking',tailAngle:0,
      roaming:!!landNavigator&&spec.id!=='dockhand',walkPoint:object.position.clone(),heading:restAngle,
      path:[],pathIndex:0,pause:finite(spec.phase)*.07,recent:[],destinations:0,blocked:0,
      contactRadius,routeEnvelope,actorYields:0,
      visitedMin:[object.position.x,object.position.z],visitedMax:[object.position.x,object.position.z]});
    const actor=actors.at(-1);
    if(actor.roaming){
      const start=landNavigator.nearest(object.position.x,object.position.z);
      if(!start)actor.roaming=false;else{actor.walkPoint.x=start[0];actor.walkPoint.z=start[1];actor.walkPoint.y=landNavigator.height(...start);actor.object.position.copy(actor.walkPoint);actor.lastPosition.copy(actor.walkPoint);}
    }
  }
  for(const actor of actors)actor.hike=createHarborHike(THREE,{actor,navigator:landNavigator,model,
    canMove:(x,z,y)=>clearOfActors(actor,x,z,y),obstacles:()=>actorObstacles(actor,.035)});
  // Capture the authored eyes once in body-local space. In particular, the dog's
  // HEAD pivot contributes to eye height, but its sniff animation never drives
  // the camera. The GLB is already Y-up; there is no Blender axis conversion here.
  const viewSubjects=new Map(),viewLabels={mara:'玛拉 · 山顶散步',sol:'岛民 · 索尔',porter:'搬运工',dockhand:'码头工人',dog:'小狗'};
  function registerView(id,label,object,forward,baseQuaternion,hiddenObjects,isDog=false){
    object.updateWorldMatrix(true,true);
    const inverse=new THREE.Matrix4().copy(object.matrixWorld).invert();
    const localMatrix=new THREE.Matrix4(),eyeBox=new THREE.Box3(),partBox=new THREE.Box3();
    const eyes=[];
    object.traverse(child=>{if(child.isMesh&&/Eyes[ _]+ink/i.test(child.name)&&child.geometry?.attributes.position)eyes.push(child);});
    for(const eye of eyes){
      eye.geometry.computeBoundingBox();
      localMatrix.multiplyMatrices(inverse,eye.matrixWorld);
      partBox.copy(eye.geometry.boundingBox).applyMatrix4(localMatrix);eyeBox.union(partBox);
    }
    const inverseRest=baseQuaternion.clone().invert();
    const localForward=forward.clone().applyQuaternion(inverseRest).normalize();
    const localUp=up.clone().applyQuaternion(inverseRest).normalize();
    const eyeLocal=new THREE.Vector3();
    if(!eyeBox.isEmpty()){
      eyeBox.getCenter(eyeLocal);
      // Dog ink also contains the lower, projecting nose. Use the upper eye
      // vertices to keep the anchor between the eyes instead of in the muzzle.
      if(isDog){
        const cutoff=eyeBox.max.y-(eyeBox.max.y-eyeBox.min.y)*.35,upperEyes=new THREE.Box3(),point=new THREE.Vector3();
        for(const eye of eyes){
          localMatrix.multiplyMatrices(inverse,eye.matrixWorld);
          const positions=eye.geometry.attributes.position;
          for(let i=0;i<positions.count;i++){
            point.fromBufferAttribute(positions,i).applyMatrix4(localMatrix);
            if(point.y>=cutoff)upperEyes.expandByPoint(point);
          }
        }
        if(!upperEyes.isEmpty())upperEyes.getCenter(eyeLocal);
      }
    }else eyeLocal.copy(localUp).multiplyScalar(isDog?.39:.75).addScaledVector(localForward,isDog?.30:.08);
    eyeLocal.addScaledVector(localForward,.025);
    const localQuaternion=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(),localForward,localUp));
    viewSubjects.set(id,{id,label,object,eyeLocal,localQuaternion,hiddenObjects,anchorSource:eyes.length?'authored-eyes':'body-fallback'});
  }
  for(const actor of actors)registerView(actor.spec.id||actor.object.name,viewLabels[actor.spec.id]||actor.spec.label||'岛民',
    actor.object,actor.forwardAxis,actor.baseQuaternion,[actor.object],actor.isDog);
  if(boat){
    // These BOAT material batches contain only the sole crew member. Hull,
    // rigging, wood and sails remain visible when looking around from the deck.
    const crewObjects=[];
    boat.traverse(child=>{
      if(child.isMesh&&/Burnished[ _]+leather[ _]+boots|Chestnut[ _]+hair|Cinnamon[ _]+canvas[ _]+trousers|Eyes[ _]+ink|Faded[ _]+indigo[ _]+work[ _]+shirts|Golden[ _]+woven[ _]+hat|Natural[ _]+cotton[ _]+shirts|Peach[ _]+hand[ _]+painted[ _]+skin|Straw[ _]+hat[ _]+braided[ _]+edge|Dockworkers[ _]+navy[ _]+cap/i.test(child.name))crewObjects.push(child);
    });
    registerView('boat','船员',boat,new THREE.Vector3(forwardXZ[0],0,forwardXZ[1]),restQuaternion,crewObjects);
  }
  function getViewSubjects(){return Array.from(viewSubjects.values(),({id,label})=>({id,label}));}
  function getViewPose(id){
    const subject=viewSubjects.get(id);if(!subject)return null;
    subject.object.updateWorldMatrix(true,false);
    return {
      position:subject.eyeLocal.clone().applyMatrix4(subject.object.matrixWorld),
      quaternion:subject.object.getWorldQuaternion(new THREE.Quaternion()).multiply(subject.localQuaternion),
      hiddenObjects:subject.hiddenObjects.slice(),
    };
  }
  const actorQ=new THREE.Quaternion(),limbQ=new THREE.Quaternion(),balanceQ=new THREE.Quaternion(),armQ=new THREE.Quaternion();
  const balanceEuler=new THREE.Euler(0,0,0,'XYZ'),actorPoint=new THREE.Vector3(),actorTangent=new THREE.Vector3();
  function trailReservations(actor){
    // The stair entrance has no passing bay. Keep it clear even while Mara is
    // on the mountain, so a roaming resident cannot block her way back down.
    return actors.filter(other=>other!==actor&&other.hike).map(other=>{
      const entry=other.hike.entryClearance;
      return {x:entry.x,z:entry.z,radius:entry.radius+actor.contactRadius};
    });
  }
  function actorObstacles(actor,extra=0){
    return actors.filter(other=>other!==actor&&Math.abs(other.walkPoint.y-actor.walkPoint.y)<1.05).map(other=>{
      // Reserve the dock worker's complete small route. Roamers use live poses.
      const p=other.roaming?other.walkPoint:other.base;
      return {x:p.x,z:p.z,radius:actor.contactRadius+other.contactRadius+extra+(other.roaming?0:other.routeEnvelope)};
    }).concat(trailReservations(actor));
  }
  function clearOfActors(actor,x,z,y=actor.walkPoint.y){
    for(const entry of trailReservations(actor))if((x-entry.x)**2+(z-entry.z)**2<entry.radius*entry.radius)return false;
    for(const other of actors){
      if(other===actor)continue;
      const p=other.roaming?other.walkPoint:other.base;
      if(Math.abs(p.y-y)>=1.05)continue;
      const separation=actor.contactRadius+other.contactRadius+.035+(other.roaming?0:other.routeEnvelope);
      if((x-p.x)**2+(z-p.z)**2<separation*separation)return false;
    }
    return true;
  }
  function advanceRoaming(actor,dt){
    const nav=landNavigator;
    if(actor.pause>0){actor.pause=Math.max(0,actor.pause-dt);return 0;}
    if(actor.pathIndex>=actor.path.length){
      const result=nav.plan(actor.walkPoint.x,actor.walkPoint.z,actor.recent,actorObstacles(actor,.035));
      if(!result||result.path.length<2){actor.pause=1;return 0;}
      actor.path=result.path;actor.pathIndex=0;actor.target=result.target;
      actor.recent.push(result.target);if(actor.recent.length>4)actor.recent.shift();
    }
    const pace=actor.isDog?.43:Math.max(.26,(actor.spec.speed||.24)*1.30);
    let budget=pace*dt,moved=0;
    while(budget>1e-6&&actor.pathIndex<actor.path.length){
      const p=actor.path[actor.pathIndex],dx=p[0]-actor.walkPoint.x,dz=p[1]-actor.walkPoint.z,distance=Math.hypot(dx,dz);
      if(distance<.001){actor.pathIndex++;continue;}
      const step=Math.min(budget,distance),x=actor.walkPoint.x+dx/distance*step,z=actor.walkPoint.z+dz/distance*step;
      if(!nav.valid(x,z)){actor.blocked++;actor.path=[];actor.pathIndex=0;actor.pause=.08;return moved;}
      if(!clearOfActors(actor,x,z)){
        // Do not commit an overlapping step. Briefly yield, then plan around
        // the other actor instead of pushing either body through the other.
        actor.actorYields++;actor.path=[];actor.pathIndex=0;
        actor.pause=.12+actors.indexOf(actor)*.045;return moved;
      }
      actor.walkPoint.x=x;actor.walkPoint.z=z;
      actor.walkPoint.y=damp(actor.walkPoint.y,nav.height(x,z),12,dt);
      actor.heading+=angleDiff(Math.atan2(dx,dz),actor.heading)*(1-Math.exp(-7*dt));
      moved+=step;budget-=step;
      if(step>=distance-.0001)actor.pathIndex++;
    }
    if(actor.pathIndex>=actor.path.length){actor.destinations++;actor.pause=actor.isDog?1.0+nav.random()*1.8:.5+nav.random()*1.4;}
    actor.visitedMin[0]=Math.min(actor.visitedMin[0],actor.walkPoint.x);actor.visitedMin[1]=Math.min(actor.visitedMin[1],actor.walkPoint.z);
    actor.visitedMax[0]=Math.max(actor.visitedMax[0],actor.walkPoint.x);actor.visitedMax[1]=Math.max(actor.visitedMax[1],actor.walkPoint.z);
    return moved;
  }
  function updateActors(dt,time){
    const balanceLevel=Math.hypot(balanceX,balanceZ);
    for(const actor of actors){
      const speed=actor.spec.speed??(actor.isDog?.30:.24),hasRoute=actor.roaming||(actor.curve&&actor.length>.05);
      const moved=actor.hike?actor.hike.advance(dt):actor.roaming?advanceRoaming(actor,dt):0;
      const sniffing=actor.isDog&&actor.roaming&&actor.pause>0;
      const desiredWalk=actor.roaming?(moved>.00001?1:0):hasRoute?clamp(1-balanceLevel*1.8,.52,1):0;
      actor.walkFactor=damp(actor.walkFactor,desiredWalk,7.0,dt);
      if(actor.walkFactor<.008)actor.walkFactor=0;
      actor.travel+=actor.roaming?moved:speed*actor.walkFactor*dt;
      const stride=actor.isDog?.25:.34,phase=actor.travel/stride*TAU+actor.phase;
      actor.activity=sniffing?'sniffing':actor.roaming&&actor.pause>0?'looking-around':hasRoute?'walking':'standing';
      if(actor.hike)actor.activity=actor.hike.stage==='summit'?'watching-sea':actor.hike.stage==='resting'?'resting':moved>1e-8?'walking':'turning-or-waiting';
      const bob=Math.abs(Math.sin(phase))*(actor.isDog?.006:.012)*actor.walkFactor;
      if(actor.roaming){
        actor.object.position.copy(actor.walkPoint);actor.object.position.y+=bob;
        actorQ.setFromAxisAngle(up,actor.heading-actor.restAngle);
      }else if(hasRoute){
        const progress=((actor.travel/actor.length)%1+1)%1;
        actor.curve.getPointAt(progress,actorPoint);actor.curve.getTangentAt(progress,actorTangent);
        actor.object.position.copy(actorPoint);
        actor.object.position.y+=bob+balanceLevel*(actor.isDog?.10:.055);
        const facing=Math.atan2(actorTangent.x,actorTangent.z);
        actorQ.setFromAxisAngle(up,facing-actor.restAngle);
      }else{
        actor.object.position.copy(actor.base);actor.object.position.y+=Math.sin(time*1.6+actor.phase)*.003+balanceLevel*.055;
        actorQ.identity();
      }
      // Walking uses the dry-land navigation mesh; authored scale and limb pivots stay intact.
      const compensation=actor.isDog?.46:1;
      balanceEuler.set(balanceX*compensation,0,balanceZ*compensation);
      balanceQ.setFromEuler(balanceEuler);
      actor.object.quaternion.copy(balanceQ).multiply(actorQ).multiply(actor.baseQuaternion);
      for(const limb of actor.limbs){
        let angle;
        if(limb.isTail){
          angle=Math.sin(time*(sniffing?5.0:8.0)+actor.phase)*limb.amplitude*(sniffing?.55:1);
          actor.tailAngle=angle;
        }else if(limb.isHead){
          angle=sniffing?.18+Math.sin(time*5.2)*.075:Math.sin(phase)*.025*actor.walkFactor;
        }else{
          angle=Math.sin(phase+limb.phase)*limb.amplitude*actor.walkFactor;
          if(!hasRoute)angle=Math.sin(time*1.7+limb.phase)*limb.amplitude*.08;
        }
        limbQ.setFromAxisAngle(limb.axis,angle);
        if(limb.isArm){
          const amount=balanceLevel*(actor.spec.pose==='carry'?.45:1.8)*(limb.isLeft?1:-1);
          armQ.setFromAxisAngle(actor.forwardAxis,amount);
          limb.object.quaternion.copy(armQ).multiply(limbQ).multiply(limb.base);
        }else limb.object.quaternion.copy(limbQ).multiply(limb.base);
      }
      actor.distance+=actor.object.position.distanceTo(actor.lastPosition);actor.lastPosition.copy(actor.object.position);
    }
  }

  return {
    update(dt,time){
      dt=clamp(finite(dt),0,.25);simulationTime=finite(time,simulationTime+dt);
      if(dt>0){
        updateContainer(dt);
        let remaining=dt;
        while(remaining>1e-6){const step=Math.min(1/60,remaining);updateNavigation(step);updateDrift(step);updateBuoyancy(step);emitWake(step);remaining-=step;}
        updateActors(dt,simulationTime);
      }
      renderWake();

    },
    setDestination,setContainerTilt,getViewSubjects,getViewPose,
    exportLandGrid:()=>landNavigator?.exportGrid()||null,
    getDiagnostics:()=>({
      mode,destinationMarker:false,boatPresent:!!boat,boatPosition:boat?.position.toArray(),boatStart:boatStart?.toArray(),
      heading,speed,totalDistance,verticalVelocity:verticalV,tilt:[gradientX,gradientZ],destination:destination?.slice()||null,
      route:route.map(p=>p.slice()),routeIndex,blockedMoves,destinationsAccepted,destinationsRejected,
      patrol:patrolCircuit?{radius:patrolCircuit.radius,length:patrolCircuit.length,
        direction:patrolCircuit.direction,validated:patrolCircuit.validated,waypoints:patrolCircuit.points.length,
        steeringMargin:patrolCircuit.steeringMargin,completedLaps:Math.floor(Math.abs(patrolSweep)/TAU),
        angularTravel:patrolSweep,circuitPasses:patrolCircuits}:null,
      hullSafe:boat?navigator.poseSafe(boat.position.x,boat.position.z,heading):null,
      navigation:navigator.diagnostics(),wakeSegments:wakeSamples.length,foamParticles:foamPearls.count,wakeForces,
      containerTilt:[containerX,containerZ],containerAngularVelocity:[containerVX,containerVZ],
      bodyBalance:[balanceX,balanceZ],boatDriftVelocity:[driftX,driftZ],driftDistance,
      viewSubjects:Array.from(viewSubjects.values(),s=>({id:s.id,eyeLocal:s.eyeLocal.toArray(),anchorSource:s.anchorSource,hiddenObjects:s.hiddenObjects.map(o=>o.name)})),
      landNavigation:landNavigator?.diagnostics()||null,
      trailClearance,
      actors:actors.map(a=>({name:a.object.name,position:a.object.position.toArray(),distance:a.distance,walking:(a.roaming||!!a.curve)&&a.walkFactor>.02,limbs:a.limbs.length,kind:a.isDog?'dog':'person',activity:a.activity,walkFactor:a.walkFactor,tailAngle:a.tailAngle,roaming:a.roaming,target:a.target||null,destinations:a.destinations,blockedMoves:a.blocked,actorYields:a.actorYields,contactRadius:a.contactRadius,landSafe:a.hike?null:a.roaming?landNavigator.valid(a.object.position.x,a.object.position.z):null,hike:a.hike?.diagnostics()||null,visitedBounds:{min:a.visitedMin.slice(),max:a.visitedMax.slice()},roamingExtent:[a.visitedMax[0]-a.visitedMin[0],a.visitedMax[1]-a.visitedMin[1]]})),
    }),
    dispose(){scene.remove(root);for(const g of wakeGeometries)g.dispose();wakeMaterial.dispose();foamGeometry.dispose();foamMaterial.dispose();},
  };
}
