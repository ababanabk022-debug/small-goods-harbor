/** Walking routes, body balance, and eye-level views for the island's residents. */
import { createLandNavigator } from './harbor-land-navigation.js?v=14.3';
import { createHarborHike } from './harbor-hike.js?v=14.3';
import { clearHarborTrail } from './harbor-trail-clearance.js?v=14.3';
const TAU=Math.PI*2;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const angleDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const damp=(a,b,k,dt)=>a+(b-a)*(1-Math.exp(-k*dt));
const finite=(v,f=0)=>Number.isFinite(v)?v:f;

export function createHarborMotion(THREE,{model,meta={}}){
  const trailClearance=clearHarborTrail(THREE,model);
  let simulationTime=0;
  let containerX=0,containerZ=0,lastContainerX=0,lastContainerZ=0,containerVX=0,containerVZ=0;
  let balanceX=0,balanceZ=0;
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
  const up=new THREE.Vector3(0,1,0);
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
      roaming:!!landNavigator,walkPoint:object.position.clone(),heading:restAngle,
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
  for(const actor of actors){
    // The last 1.2 m of beach narrows to one walking lane before the stairs.
    // Keep the approach clear as well as the entry so two actors can never wedge there.
    actor.trailReservations=actors.filter(other=>other!==actor&&other.hike).flatMap(other=>{
      const entry=other.hike.entryClearance,radius=entry.radius+actor.contactRadius;
      return [{x:entry.x,z:entry.z,radius},{x:entry.x,z:entry.z+1.2,radius}];
    });
  }
  // Capture the authored eyes once in body-local space. In particular, the dog's
  // HEAD pivot contributes to eye height, but its sniff animation never drives
  // the camera. The GLB is already Y-up; there is no Blender axis conversion here.
  const viewSubjects=new Map(),viewLabels={mara:'玛拉 · 山顶散步',sol:'岛民 · 索尔',porter:'搬运工',dog:'小狗'};
  function registerView(id,label,object,forward,baseQuaternion,isDog){
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
    viewSubjects.set(id,{id,label,object,eyeLocal,localQuaternion,anchorSource:eyes.length?'authored-eyes':'body-fallback'});
  }
  for(const actor of actors)registerView(actor.spec.id||actor.object.name,viewLabels[actor.spec.id]||actor.spec.label||'岛民',
    actor.object,actor.forwardAxis,actor.baseQuaternion,actor.isDog);
  function getViewSubjects(){return Array.from(viewSubjects.values(),({id,label})=>({id,label}));}
  function getViewPose(id){
    const subject=viewSubjects.get(id);if(!subject)return null;
    subject.object.updateWorldMatrix(true,false);
    return {
      position:subject.eyeLocal.clone().applyMatrix4(subject.object.matrixWorld),
      quaternion:subject.object.getWorldQuaternion(new THREE.Quaternion()).multiply(subject.localQuaternion),
      hiddenObjects:[subject.object],
    };
  }
  const actorQ=new THREE.Quaternion(),limbQ=new THREE.Quaternion(),balanceQ=new THREE.Quaternion(),armQ=new THREE.Quaternion();
  const balanceEuler=new THREE.Euler(0,0,0,'XYZ'),actorPoint=new THREE.Vector3(),actorTangent=new THREE.Vector3();
  function actorObstacles(actor,extra=0){
    return actors.filter(other=>other!==actor&&Math.abs(other.walkPoint.y-actor.walkPoint.y)<1.05).map(other=>{
      // Reserve fixed routes in full. Roamers use their current footprint.
      const p=other.roaming?other.walkPoint:other.base;
      return {x:p.x,z:p.z,radius:actor.contactRadius+other.contactRadius+extra+(other.roaming?0:other.routeEnvelope)};
    }).concat(actor.trailReservations);
  }
  function clearOfActors(actor,x,z,y=actor.walkPoint.y){
    for(const entry of actor.trailReservations)if((x-entry.x)**2+(z-entry.z)**2<entry.radius*entry.radius)return false;
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
        updateActors(dt,simulationTime);
      }
    },
    setContainerTilt,getViewSubjects,getViewPose,
    exportLandGrid:()=>landNavigator?.exportGrid()||null,
    getDiagnostics:()=>({
      containerTilt:[containerX,containerZ],containerAngularVelocity:[containerVX,containerVZ],
      bodyBalance:[balanceX,balanceZ],
      viewSubjects:Array.from(viewSubjects.values(),s=>({id:s.id,eyeLocal:s.eyeLocal.toArray(),anchorSource:s.anchorSource,hiddenObjects:[s.object.name]})),
      landNavigation:landNavigator?.diagnostics()||null,
      trailClearance,
      actors:actors.map(a=>({name:a.object.name,position:a.object.position.toArray(),distance:a.distance,walking:(a.roaming||!!a.curve)&&a.walkFactor>.02,limbs:a.limbs.length,kind:a.isDog?'dog':'person',activity:a.activity,walkFactor:a.walkFactor,tailAngle:a.tailAngle,roaming:a.roaming,target:a.target||null,destinations:a.destinations,blockedMoves:a.blocked,actorYields:a.actorYields,contactRadius:a.contactRadius,landSafe:a.hike?null:a.roaming?landNavigator.valid(a.object.position.x,a.object.position.z):null,hike:a.hike?.diagnostics()||null,visitedBounds:{min:a.visitedMin.slice(),max:a.visitedMax.slice()},roamingExtent:[a.visitedMax[0]-a.visitedMin[0],a.visitedMax[1]-a.visitedMin[1]]})),
    }),
    dispose(){viewSubjects.clear();actors.length=0;},
  };
}
