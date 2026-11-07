/**
 * A shore-to-board trip driven by the same crest that displaces the water.
 * No second lap clock: board position comes from water.getCoastWaveState().
 */
import { createWaterNavigator } from './harbor-navigation.js?v=13.1';
const TAU=Math.PI*2;
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const finite=(v,f=0)=>Number.isFinite(v)?v:f;
const smooth=v=>{const t=clamp(v,0,1);return t*t*(3-2*t);};
const smoother=v=>{const t=clamp(v,0,1);return t*t*t*(t*(t*6-15)+10);};
const damp=(a,b,rate,dt)=>a+(b-a)*(1-Math.exp(-rate*dt));
const angleDifference=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const DECK_Y=.085, BOARD_LENGTH=1.75, BOARD_WIDTH=.62;
const WAVE_LEAD=1.80, RIDER_Z=-.08, BOARD_DROP=3, BOARD_DROP_SECONDS=.8;
const BOARD_SETTLE_SECONDS=.72;
const BOARDING_SECONDS=1.25, CROUCH_SECONDS=.25, DISMOUNT_SECONDS=1.15;

function createBoard(THREE){
  const board=new THREE.Group();board.name='SURF_BOARD';
  const deck=new THREE.MeshStandardMaterial({name:'Surfboard · warm ivory deck',color:'#eee6cd',roughness:.36,metalness:0});
  const rail=new THREE.MeshStandardMaterial({name:'Surfboard · sea blue rails',color:'#287b89',roughness:.3,metalness:0});
  const accent=new THREE.MeshStandardMaterial({name:'Surfboard · terracotta stringer',color:'#c96536',roughness:.45});
  const grip=new THREE.MeshStandardMaterial({name:'Surfboard · charcoal traction',color:'#254b50',roughness:.88});
  const rings=[[-.875,.035],[-.82,.15],[-.68,.245],[-.46,.29],[-.20,.308],[.10,.31],[.36,.29],[.58,.245],[.74,.16],[.84,.075],[.875,0]];
  const segments=16,positions=[],deckIndices=[],railIndices=[];
  for(const [z,width] of rings){
    const rocker=Math.max(0,z-.46)**2*.23+Math.max(0,-z-.68)**2*.13;
    for(let j=0;j<segments;j++){
      const a=j/segments*TAU;
      positions.push(Math.cos(a)*width,.0275+Math.sin(a)*.0575+rocker,z);
    }
  }
  for(let i=0;i<rings.length-1;i++)for(let j=0;j<segments;j++){
    const k=i*segments+j,n=i*segments+(j+1)%segments,l=k+segments,m=n+segments;
    (j<segments/2?deckIndices:railIndices).push(k,n,l,n,m,l);
  }
  // Close the squared tail; the nose rings already converge to a single point.
  for(let j=1;j<segments-1;j++)railIndices.push(0,j+1,j);
  const hull=new THREE.BufferGeometry();hull.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));hull.setIndex([...deckIndices,...railIndices]);
  hull.addGroup(0,deckIndices.length,0);hull.addGroup(deckIndices.length,railIndices.length,1);
  hull.computeVertexNormals();hull.computeBoundingSphere();
  const shell=new THREE.Mesh(hull,[deck,rail]);shell.name='Surfboard · rounded rails and rocker';shell.castShadow=true;shell.receiveShadow=true;board.add(shell);
  const stringer=new THREE.Mesh(new THREE.BoxGeometry(.035,.004,1.23),accent);stringer.position.set(0,.086,0);stringer.name='Surfboard · center stringer';board.add(stringer);
  const pad=new THREE.Mesh(new THREE.BoxGeometry(.22,.004,.27),grip);pad.position.set(0,.083,-.38);pad.name='Surfboard · rear foot grip';board.add(pad);
  const finGeo=new THREE.BufferGeometry();finGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,-.016,-.38,0,-.23,-.56,0,-.025,-.68],3));finGeo.computeVertexNormals();
  const finMat=rail.clone();finMat.side=THREE.DoubleSide;
  const fin=new THREE.Mesh(finGeo,finMat);fin.name='Surfboard · single fin';board.add(fin);
  return board;
}

export function createHarborSurfing(THREE,{scene,model,meta={},water,rig,mode:initialMode='harbor'}){
  if(!scene||!rig?.root||!water)throw new Error('Surfing needs a scene, surfer rig, and water.');
  const root=new THREE.Group();root.name='SURFING';scene.add(root);
  const character=rig.root;character.name='POLYFORK_SURFER';root.add(character);
  const bodyMesh=character.getObjectByName('body');
  const board=createBoard(THREE);root.add(board);
  const shore=new THREE.Vector3(2.15,.596012,2.30);
  // Raycast only the authored beach, never foliage, a roof, or hidden dock props.
  const beach=[];model?.updateWorldMatrix(true,true);
  model?.traverse(object=>{if(object.isMesh&&/fine[ _]+even[ _]+ivory[ _]+beach[ _]+sand/i.test(object.name))beach.push(object);});
  const coastGround=[];
  model?.traverse(object=>{if(object.isMesh&&/fine[ _]+even[ _]+ivory[ _]+beach[ _]+sand|wet[ _]+ivory[ _]+sand[ _]+on[ _]+submerged[ _]+beach[ _]+slope/i.test(object.name))coastGround.push(object);});
  if(beach.length){
    const ray=new THREE.Raycaster(new THREE.Vector3(shore.x,20,shore.z),new THREE.Vector3(0,-1,0));
    const hit=ray.intersectObjects(beach,false)[0];if(hit)shore.y=hit.point.y;
  }
  const shoreObstacle=Object.freeze({x:shore.x,z:shore.z,radius:rig.radius||.55});
  const corridor={x:2.8,z:2.6,radius:.60,active:initialMode==='surf'};
  const returnReservation={x:0,z:0,radius:.48,active:false};
  const landReservations=[shoreObstacle,corridor,returnReservation];
  const walkEnd=new THREE.Vector3(3.23878,.00604,2.76467), swimStart=new THREE.Vector3(Math.cos(.70)*4.95,0,Math.sin(.70)*4.95);
  const groundRay=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),groundSamples=[];
  for(let i=0;i<=80;i++){
    const q=i/80, x=THREE.MathUtils.lerp(shore.x,walkEnd.x,q), z=THREE.MathUtils.lerp(shore.z,walkEnd.z,q);
    let height=-Infinity;
    for(const [dx,dz] of [[0,0],[.12,0],[-.12,0],[0,.12],[0,-.12]]){
      groundRay.set(new THREE.Vector3(x+dx,20,z+dz),down);
      height=Math.max(height,groundRay.intersectObjects(beach,false)[0]?.point.y??-Infinity);
    }
    groundSamples.push((Number.isFinite(height)?height:THREE.MathUtils.lerp(shore.y,walkEnd.y,q))+.035*smooth((q-.72)/.28));
  }
  function walkGround(q){const n=clamp(q,0,1)*80,i=Math.min(79,Math.floor(n));return THREE.MathUtils.lerp(groundSamples[i],groundSamples[i+1],n-i);}
  walkEnd.y=walkGround(1);
  const durations={walking:1.1,wading:1.35,swimming:1.45,jumping:.65,'wave-hop':.50,leaving:.65,mounting:1.55,standing:.9,sitting:.9,dismounting:1.55,'swimming-back':1.45,'wading-back':1.35,'walking-back':1.1};
  const setPhase=(p,age=0)=>{phase=p;phaseAge=age;};
  const up=new THREE.Vector3(0,1,0),deckOffset=new THREE.Vector3(0,DECK_Y,0);
  const yawQ=new THREE.Quaternion(),tiltQ=new THREE.Quaternion(),targetQ=new THREE.Quaternion();
  const idleQ=new THREE.Quaternion(),jumpQ=new THREE.Quaternion();
  const tiltEuler=new THREE.Euler(0,0,0,'XYZ');
  const point=new THREE.Vector3(),deckPoint=new THREE.Vector3(),lastBoardPoint=new THREE.Vector3();
  const takeoff=new THREE.Vector3(),takeoffQ=new THREE.Quaternion(),recoveryFrom=new THREE.Vector3(),recoveryQ=new THREE.Quaternion();
  const sampleOffsets=[[0,0],[0,.68],[0,-.68],[.24,0],[-.24,0],
    [0,.17],[0,.34],[0,.51],[0,-.17],[0,-.34],[0,-.51],
    [.20,.35],[-.20,.35],[.20,-.35],[-.20,-.35]];
  const supportHeights=new Float64Array(sampleOffsets.length);
  let sceneMode=initialMode==='surf'?'surf':'harbor',phase='waiting',phaseAge=0;
  let simulationTime=0,poseTime=0,cancelled=false,waveOwned=false,disposed=false;
  let motion=null,motionId='surfer',boardDropAge=0,recoveryPoseProgress=0;
  let completedLaps=0,totalDistance=0,lastWaveProgress=0,lastWaveRunning=false;
  let boardAngle=.70,boardRadius=finite(water.radius,9)*.795,boardSpeed=0,pitch=0,roll=0,turnInward=0,boardWaterY=null;
  let returnStart=0,returnSweep=0,returnDuration=0,returnTangent=0,recoveryDuration=.75;
  let landingSites=null,swimNavigator=null,homeRoute=null,homeIndex=0,homeStart=null,homeSite=null,homeTravel=0;
  const homeDirection=new THREE.Vector3(),homeFacing=new THREE.Quaternion();
  let startAngle=.70,waveStartAngle=.70,anchorX=0,anchorZ=0,landingCount=0,cancelCount=0;
  const waveState=()=>water.getCoastWaveState?.()||water.getDiagnostics?.().coastWave||null;
  function readAnchor(){
    const coast=waveState();
    boardRadius=finite(coast?.radius,boardRadius);
    if(Number.isFinite(coast?.start?.x)&&Number.isFinite(coast?.start?.z))waveStartAngle=Math.atan2(coast.start.z,coast.start.x);
    startAngle=waveStartAngle+WAVE_LEAD/boardRadius;
    anchorX=Math.cos(startAngle)*boardRadius;anchorZ=Math.sin(startAngle)*boardRadius;
    idleQ.setFromAxisAngle(up,Math.atan2(anchorX-shore.x,anchorZ-shore.z));
  }
  readAnchor();boardAngle=startAngle;
  board.position.set(anchorX,0,anchorZ);board.quaternion.setFromAxisAngle(up,-boardAngle);

  // A fixed pool of eight tiny foam streaks; neither timers nor meshes accumulate.
  const wakeGeo=new THREE.SphereGeometry(1,6,4);
  const wakeMat=new THREE.MeshBasicMaterial({name:'Surfer · small aerated wake',color:'#e7f6ec',transparent:true,opacity:0,depthWrite:false});
  const wake=new THREE.InstancedMesh(wakeGeo,wakeMat,8);wake.name='SURF_BOARD_WAKE';wake.count=0;wake.frustumCulled=false;root.add(wake);
  const foamDummy=new THREE.Object3D();

  function waterAt(x,z){
    const sampled=water.sample?.(x,z,simulationTime);
    return sampled&&typeof sampled==='object'?finite(sampled.height):finite(water.sampleHeight?.(x,z,simulationTime));
  }
  function groundAt(x,z){
    groundRay.set(new THREE.Vector3(x,20,z),down);
    return groundRay.intersectObjects(coastGround,false)[0]?.point.y??-1.46;
  }
  // A swimming person's head and legs extend well beyond their root. Keep a
  // body-sized envelope over water deep enough for the actual skinned pose.
  const swimSafetyCache=new Map(),swimCacheStep=.12,swimRadius=.78;
  function safeSwimming(x,z){
    const ix=Math.round(x/swimCacheStep),iz=Math.round(z/swimCacheStep),key=`${ix},${iz}`;
    if(swimSafetyCache.has(key))return swimSafetyCache.get(key);
    x=ix*swimCacheStep;z=iz*swimCacheStep;
    if(!water.isWater?.(x,z)||Math.hypot(x,z)+swimRadius>(water.radius||9)-.02){swimSafetyCache.set(key,false);return false;}
    const coast=meta.shoreline||[];let near=Infinity;
    for(let i=0;i<coast.length;i++){
      const a=coast[i],b=coast[(i+1)%coast.length],dx=b[0]-a[0],dz=b[1]-a[1];
      const t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1);
      near=Math.min(near,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
    }
    if(near>1.9){swimSafetyCache.set(key,true);return true;}
    let safe=groundAt(x,z)<=-.37;
    for(let i=0;i<12&&safe;i++){
      const a=i*Math.PI/6,px=x+Math.cos(a)*swimRadius,pz=z+Math.sin(a)*swimRadius;
      safe=!!water.isWater?.(px,pz)&&groundAt(px,pz)<=-.37;
    }
    swimSafetyCache.set(key,safe);return safe;
  }
  function buildLandingSites(){
    const grid=motion?.exportLandGrid?.(motionId),coast=meta.shoreline||[];
    if(!grid||coast.length<3)return [];
    const result=[],cell=grid.cell,index=(x,z)=>{const ix=Math.round((x-grid.minX)/cell),iz=Math.round((z-grid.minZ)/cell);return ix<0||iz<0||ix>=grid.width||iz>=grid.depth?-1:iz*grid.width+ix;};
    for(let i=0;i<grid.safe.length;i++){
      if(!grid.safe[i]||grid.component[i]!==grid.mainComponent)continue;
      const x=grid.minX+(i%grid.width)*cell,z=grid.minZ+Math.floor(i/grid.width)*cell;
      let distance=Infinity,ex=0,ez=0;
      for(let j=0;j<coast.length;j++){
        const a=coast[j],b=coast[(j+1)%coast.length],dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz;
        const t=clamp(((x-a[0])*dx+(z-a[1])*dz)/(l||1),0,1),px=a[0]+dx*t,pz=a[1]+dz*t,d=Math.hypot(px-x,pz-z);
        if(d<distance){distance=d;ex=px;ez=pz;}
      }
      if(distance<.2||distance>2.5)continue;
      const dx=(ex-x)/distance,dz=(ez-z)/distance;
      let clear=true;
      const sideX=-dz,sideZ=dx;
      for(let t=0;t<distance&&clear;t+=cell*.45)for(const lateral of [0,.18,-.18,.36,-.36]){
        const k=index(x+dx*t+sideX*lateral,z+dz*t+sideZ*lateral);if(k>=0&&grid.blocked?.[k]){clear=false;break;}
      }
      if(!clear)continue;
      let deep=null;
      for(let d=.8;d<=2.6;d+=.15){const px=ex+dx*d,pz=ez+dz*d;if(safeSwimming(px,pz)){deep=new THREE.Vector3(px,0,pz);break;}}
      if(!deep)continue;
      const land=new THREE.Vector3(x,grid.heights[i],z),edge=new THREE.Vector3(ex,0,ez);
      // The final approach must remain in water until it reaches the selected shoreline.
      if(!water.isWater?.((deep.x+ex)*.5,(deep.z+ez)*.5))continue;
      result.push({land,edge,deep});
    }
    return result;
  }
  function waterLine(a,b){
    const length=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.max(1,Math.ceil(length/.12));
    for(let i=0;i<=steps;i++){const t=i/steps;if(!safeSwimming(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t))return false;}
    return true;
  }
  function prepareLandingPlanner(){
    if(!landingSites)landingSites=buildLandingSites();
    if(!swimNavigator)swimNavigator=createWaterNavigator({radius:water.radius||9,shoreline:meta.shoreline||[],isWater:safeSwimming,clearance:.78,edgeClearance:.82,obstacleClearance:.12,cell:.25});
  }
  function chooseLanding(from){
    prepareLandingPlanner();
    const candidates=landingSites.map(site=>({site,d:Math.hypot(site.deep.x-from.x,site.deep.z-from.z)+site.deep.distanceTo(site.land)})).sort((a,b)=>a.d-b.d);
    let best=null,startNode=null;const routes=new Map();
    for(const {site,d} of candidates){
      if(best&&d>=best.score)break;
      if(motion?.isExternalLandingFree&&!motion.isExternalLandingFree(motionId,site.land.x,site.land.z))continue;
      let route;
      if(waterLine(from,site.deep))route=[[from.x,from.z],[site.deep.x,site.deep.z]];
      else{
        if(!startNode)startNode=swimNavigator.nearestSafe(from.x,from.z,.6);
        const start=startNode,end=swimNavigator.nearestSafe(site.deep.x,site.deep.z,.6);
        if(!start||!end||!waterLine(from,new THREE.Vector3(start[0],0,start[1])))continue;
        const routeKey=`${end[0]},${end[1]}`;
        if(!routes.has(routeKey))routes.set(routeKey,swimNavigator.plan(start,end));
        route=routes.get(routeKey);if(!route||!waterLine(new THREE.Vector3(end[0],0,end[1]),site.deep))continue;
        route=[[from.x,from.z],...route,[site.deep.x,site.deep.z]];
      }
      let length=0;for(let j=1;j<route.length;j++)length+=Math.hypot(route[j][0]-route[j-1][0],route[j][1]-route[j-1][1]);
      const score=length+site.deep.distanceTo(site.land);
      if(!best||score<best.score)best={site,route,score};
    }
    return best;
  }
  function beginSwimHome(){
    const from=character.position.clone();let chosen=chooseLanding(from);
    board.visible=false;clearWake();homeIndex=1;homeTravel=0;
    if(!chosen&&water.isWater){
      // The original launch corridor is a safe fallback when no other beach
      // is exposed by the land grid. Reach it through water, never the hill.
      const destination=swimStart.clone(),start=swimNavigator?.safe(from.x,from.z)?[from.x,from.z]:swimNavigator?.nearestSafe(from.x,from.z,.8),end=swimNavigator?.safe(destination.x,destination.z)?[destination.x,destination.z]:swimNavigator?.nearestSafe(destination.x,destination.z,.8);
      let route=waterLine(from,destination)?[[from.x,from.z],[destination.x,destination.z]]:null;
      if(!route&&start&&end&&waterLine(from,new THREE.Vector3(start[0],0,start[1]))&&waterLine(new THREE.Vector3(end[0],0,end[1]),destination)){
        const planned=swimNavigator.plan(start,end);if(planned)route=[[from.x,from.z],...planned,[destination.x,destination.z]];
      }
      if(route)chosen={route,site:{land:launchShore.clone(),edge:walkEnd.clone(),deep:destination}};
    }
    if(chosen){
      homeSite=chosen.site;homeRoute=chosen.route;homeStart=from;
      returnReservation.x=homeSite.land.x;returnReservation.z=homeSite.land.z;returnReservation.active=true;
      const next=homeRoute.find((p,i)=>i>0&&Math.hypot(p[0]-from.x,p[1]-from.z)>1e-4);
      if(next)homeDirection.set(next[0]-from.x,0,next[1]-from.z).normalize();
      setPhase('swim-home');return;
    }
    // A constrained map may not expose a usable landing grid. Preserve a
    // continuous return along the existing, known-clear launch approach.
    homeSite=null;homeRoute=null;setPhase('swimming-back');
  }
  function boardDeck(target=deckPoint){return target.copy(deckOffset).applyQuaternion(board.quaternion).add(board.position);}
  function idlePose(){
    character.position.copy(shore);character.quaternion.copy(idleQ);
    rig.setPose({phase:'idle',time:poseTime});
  }
  function surfaceBoard(dt,immediate=false){
    const jumpCatching=(phase==='jumping'||phase==='wave-hop')&&waveOwned;
    const gain=phase==='riding'||jumpCatching?clamp((waveState()?.peak||0)/.99265,0,1):0;
    // The board aims a little into the curve, while its centre keeps the same
    // circular path. Ease the turn in and out as the crest rises and falls.
    const targetTurn=.08*gain;
    turnInward=immediate?targetTurn:damp(turnInward,targetTurn,4,dt);
    const s=Math.sin(boardAngle+turnInward),c=Math.cos(boardAngle+turnInward),fx=-s,fz=c,rx=c,rz=s;
    for(let i=0;i<sampleOffsets.length;i++){
      const [x,z]=sampleOffsets[i];supportHeights[i]=waterAt(board.position.x+rx*x+fx*z,board.position.z+rz*x+fz*z);
    }
    const basePitch=-Math.atan((supportHeights[1]-supportHeights[2])/1.36);
    // Trim slightly above the local slope: the nose stays clear while the
    // middle/rear planes on the rising shoulder instead of hovering over it.
    const surfTrim=clamp(basePitch-.055,-.16,.20);
    const targetPitch=basePitch*(1-gain)+surfTrim*gain;
    const targetRoll=clamp(Math.atan((supportHeights[3]-supportHeights[4])/.48),-.24,.24)*(1-gain);
    pitch=immediate?targetPitch:damp(pitch,targetPitch,14,dt);
    roll=immediate?targetRoll:damp(roll,targetRoll,12,dt);
    yawQ.setFromAxisAngle(up,-boardAngle-turnInward);tiltEuler.set(pitch,0,roll);tiltQ.setFromEuler(tiltEuler);
    board.quaternion.copy(yawQ).multiply(tiltQ);
    let targetY=supportHeights[0]+.005;
    for(const z of [RIDER_Z-.325,RIDER_Z+.325]) for(const x of [-.10,.10]){
      point.set(x,.089,z).applyQuaternion(board.quaternion);
      targetY=Math.max(targetY,waterAt(board.position.x+point.x,board.position.z+point.z)-point.y+.012);
    }
    if(gain>0){
      point.set(0,.018,.79).applyQuaternion(board.quaternion);
      const noseWater=waterAt(board.position.x+point.x,board.position.z+point.z);
      targetY=Math.max(targetY,noseWater-point.y+.018*gain);
    }
    // Keep the float height separate from the one-off drop animation: feeding
    // last frame's drop offset back into damping would make the board climb.
    const floated=immediate||boardWaterY===null?targetY:damp(boardWaterY,targetY,15,dt);
    // The wave forms while the rider is still airborne, so the board can
    // reach the surface over a few frames before the feet touch down.
    boardWaterY=jumpCatching?floated:Math.max(targetY-.012,floated);
    board.position.y=boardWaterY;
  }
  function boardPose(){
    character.position.set(0,DECK_Y,RIDER_Z).applyQuaternion(board.quaternion).add(board.position);character.quaternion.copy(board.quaternion);
    rig.setPose({phase:'surf',time:poseTime,balanceX:pitch,balanceZ:roll,uprightPitch:pitch});
  }
  function clearWake(){wake.count=0;wakeMat.opacity=0;}
  function renderWake(){
    if(sceneMode!=='surf'||!['riding','returning'].includes(phase)||boardSpeed<.12){clearWake();return;}
    const intensity=clamp(boardSpeed/3.0,0,1);wakeMat.opacity=.49*intensity;wake.count=8;
    const s=Math.sin(boardAngle),c=Math.cos(boardAngle),fx=-s,fz=c,rx=c,rz=s;
    for(let i=0;i<8;i++){
      const row=Math.floor(i/2),side=i%2?1:-1;
      const back=-.68-row*.22,spread=side*(.16+row*.075);
      const x=board.position.x+fx*back+rx*spread,z=board.position.z+fz*back+rz*spread;
      const flutter=.8+.2*Math.sin(poseTime*12+i*2.6);
      foamDummy.position.set(x,waterAt(x,z)+.023,z);
      foamDummy.rotation.set(0,-boardAngle,0);foamDummy.scale.set((.035+row*.007)*flutter,.009,(.095-row*.014)*intensity);
      foamDummy.updateMatrix();wake.setMatrixAt(i,foamDummy.matrix);
    }
    wake.instanceMatrix.needsUpdate=true;
  }
  function enterDismount(){
    phase='leaving';phaseAge=0;takeoff.copy(character.position);takeoffQ.copy(character.quaternion);boardSpeed=0;
  }
  function enterReturn(){
    waveOwned=false;
    // Stop circling on the board: step into the water at the current point.
    enterDismount();
  }
  function finishAtShore(){
    phase='waiting';phaseAge=0;cancelled=false;waveOwned=false;boardSpeed=0;lastWaveRunning=false;
    returnReservation.active=false;
    boardAngle=startAngle;board.position.x=anchorX;board.position.z=anchorZ;board.visible=false;
    if(motion)motion.setExternalControl(motionId,false);else idlePose();clearWake();
  }
  const launchShore=shore.clone();
  function bindMotion(controller,id='surfer'){
    motion=controller;motionId=id;
    if(sceneMode==='surf')queueMicrotask(()=>{if(!disposed&&sceneMode==='surf')prepareLandingPlanner();});
  }
  function requestStart(time=simulationTime){
    if(disposed||sceneMode!=='surf'||phase!=='waiting'||water.coastWaveRunning)return false;
    simulationTime=finite(time,simulationTime);readAnchor();
    boardAngle=startAngle;board.position.x=anchorX;board.position.z=anchorZ;
    takeoff.copy(character.position);takeoffQ.copy(character.quaternion);
    homeSite=null;homeRoute=null;homeIndex=0;homeTravel=0;homeDirection.set(0,0,0);
    board.visible=true;boardDropAge=0;phaseAge=0;
    board.position.y=(boardWaterY??board.position.y)+BOARD_DROP;
    if(motion){
      if(motion.walkExternalTo(motionId,launchShore.x,launchShore.z)===false){board.visible=false;return false;}
      phase='approaching';
    }else{shore.copy(character.position);phase='walking';}
    cancelled=false;waveOwned=false;lastWaveProgress=0;lastWaveRunning=false;boardSpeed=0;
    return true;
  }
  function cancel(time=simulationTime){
    if(!canCancel())return false;
    simulationTime=finite(time,simulationTime);cancelled=true;cancelCount++;
    if(phase==='approaching'){finishAtShore();return true;}
    if(phase==='jumping'||phase==='waiting-wave'||phase==='wave-hop'){
      recoveryFrom.copy(character.position);recoveryQ.copy(character.quaternion);
      recoveryPoseProgress=phase==='jumping'?clamp(phaseAge/durations.jumping,0,1):1;
      if(waveOwned)water.cancelCoastWave?.(simulationTime);
      waveOwned=false;
      setPhase('recovering');return true;
    }
    const reverse={walking:'walking-back',wading:'wading-back',swimming:'swimming-back',mounting:'dismounting',standing:'sitting'};
    if(reverse[phase]){const old=phase, p=clamp(phaseAge/durations[old],0,1);setPhase(reverse[old],(1-p)*durations[reverse[old]]);}
    else if(!waveOwned||!water.cancelCoastWave?.(simulationTime))enterReturn();
    return true;
  }
  function canCancel(){return sceneMode==='surf'&&!cancelled&&(['approaching','walking','wading','swimming','jumping','waiting-wave','wave-hop'].includes(phase)||(phase==='riding'&&!water.coastWaveStopping));}
  function setMode(nextMode,time=simulationTime){
    if(nextMode!=='harbor'&&nextMode!=='surf')return false;
    if(nextMode===sceneMode)return true;
    simulationTime=finite(time,simulationTime);
    if(waveOwned)water.stopCoastWave?.();
    sceneMode=nextMode;corridor.active=nextMode==='surf';readAnchor();finishAtShore();
    // Prepare the static beach/sea search grid after mode switch, rather than
    // doing the one-time raster search when the surfer first falls into water.
    if(sceneMode==='surf')queueMicrotask(()=>{if(!disposed&&sceneMode==='surf')prepareLandingPlanner();});
    board.visible=false;surfaceBoard(0,true);
    return true;
  }
  function update(dt,time,effectDelta=dt){
    if(disposed)return;
    dt=clamp(finite(dt),0,.25);effectDelta=clamp(finite(effectDelta),0,.25);
    simulationTime=finite(time,simulationTime+dt);
    // The wave has its own button. If it is stopped while the rider is still
    // airborne, switch to the same safe recovery path, even while paused.
    if((phase==='jumping'||phase==='wave-hop')&&waveOwned&&water.coastWaveStopping)cancel(simulationTime);
    if(phase==='riding'&&water.coastWaveStopping)cancelled=true;
    const step=cancelled?Math.max(dt,effectDelta):dt;
    if(step<=0)return;
    poseTime+=step;phaseAge+=step;lastBoardPoint.copy(board.position);
    if(sceneMode==='harbor'){if(!motion)idlePose();return;}
    const coast=waveState();
    if(phase==='riding'||((phase==='jumping'||phase==='wave-hop')&&waveOwned)){
      // The independent wave control can stop the crest during a ride. Keep
      // following its runout and return to shore rather than jumping to start.
      if(coast?.stopping)cancelled=true;
      if(coast?.running&&Number.isFinite(coast.center?.x)&&Number.isFinite(coast.center?.z)){
        const next=Math.atan2(coast.center.z,coast.center.x)+WAVE_LEAD/boardRadius;
        boardAngle+=angleDifference(next,boardAngle);
        board.position.x=Math.cos(boardAngle)*boardRadius;board.position.z=Math.sin(boardAngle)*boardRadius;
        lastWaveProgress=finite(coast.progress,lastWaveProgress);lastWaveRunning=true;
      }else if(phase==='riding'&&waveOwned&&lastWaveRunning){
        if(cancelled){enterReturn();}
        else{
          lastWaveProgress=1;completedLaps++;waveOwned=false;
          // The full lap ends here; leave the board where the wave settled.
          surfaceBoard(step);enterDismount();
        }
      }
    }
    if(phase==='returning'){
      const p=clamp(phaseAge/returnDuration,0,1);
      // Hermite travel matches the last runout speed and reaches shore at rest.
      const travel=(returnTangent-2)*p*p*p+(3-2*returnTangent)*p*p+returnTangent*p;
      boardAngle=returnStart+returnSweep*travel;
      board.position.x=Math.cos(boardAngle)*boardRadius;board.position.z=Math.sin(boardAngle)*boardRadius;
      if(p>=1){boardAngle=startAngle;board.position.x=anchorX;board.position.z=anchorZ;surfaceBoard(step);enterDismount();}
    }
    surfaceBoard(step);
    if(board.visible&&boardDropAge<BOARD_DROP_SECONDS+BOARD_SETTLE_SECONDS){
      boardDropAge=Math.min(BOARD_DROP_SECONDS+BOARD_SETTLE_SECONDS,boardDropAge+step);
      if(boardDropAge<BOARD_DROP_SECONDS){
        const fall=boardDropAge/BOARD_DROP_SECONDS;
        // Keep downward speed at contact so the drop reads as a water impact.
        board.position.y+=BOARD_DROP*(1-fall*fall);
      }else{
        // A shallow dunk and small buoyant rebound, separate from float height.
        // Fade the remaining oscillation away before the swimmer reaches it.
        const settled=boardDropAge-BOARD_DROP_SECONDS;
        const fade=1-smooth((settled-.42)/(BOARD_SETTLE_SECONDS-.42));
        board.position.y-=.18*Math.exp(-5*settled)*Math.sin(16*settled)*fade;
      }
    }
    const moved=Math.hypot(board.position.x-lastBoardPoint.x,board.position.z-lastBoardPoint.z);
    boardSpeed=moved/Math.max(step,.001);totalDistance+=moved;
    const back=phase.endsWith('-back');
    const progress=clamp(phaseAge/(durations[phase]||1),0,1), q=back?1-progress:progress;
    // When leaving, enter on the open-water side of the board; this keeps the
    // swimmer's extended body clear of the submerged beach and rocks.
    const swimEnd=new THREE.Vector3(phase==='leaving'?.55:-.45,0,0).applyQuaternion(board.quaternion).add(board.position);
    swimEnd.y=waterAt(swimEnd.x,swimEnd.z);swimStart.y=waterAt(swimStart.x,swimStart.z);
    const swimHeading=new THREE.Quaternion().setFromAxisAngle(up,Math.atan2(swimEnd.x-swimStart.x,swimEnd.z-swimStart.z)+(back?Math.PI:0));
    if(phase==='swim-home'){
      let remaining=step*1.55;
      while(remaining>0&&homeIndex<homeRoute.length){
        const target=homeRoute[homeIndex],dx=target[0]-character.position.x,dz=target[1]-character.position.z,d=Math.hypot(dx,dz);
        if(d<1e-5){homeIndex++;continue;}
        const move=Math.min(remaining,d);homeDirection.set(dx/d,0,dz/d);
        character.position.x+=homeDirection.x*move;character.position.z+=homeDirection.z*move;remaining-=move;homeTravel+=move;
        if(move>=d-1e-6)homeIndex++;
      }
      character.position.y=waterAt(character.position.x,character.position.z);
      if(homeDirection.lengthSq()>1e-8){homeFacing.setFromAxisAngle(up,Math.atan2(homeDirection.x,homeDirection.z));character.quaternion.slerp(homeFacing,1-Math.exp(-step*7));}
      rig.setPose({phase:'swim',time:poseTime});
      if(homeIndex>=homeRoute.length){homeStart=character.position.clone();setPhase('land-home');}
    }else if(phase==='land-home'){
      const length=homeStart.distanceTo(homeSite.land),p=clamp(phaseAge/Math.max(1,length/.9),0,1),k=smooth(p);
      character.position.lerpVectors(homeStart,homeSite.land,k);
      homeDirection.subVectors(homeSite.land,homeStart);homeDirection.y=0;homeDirection.normalize();
      homeFacing.setFromAxisAngle(up,Math.atan2(homeDirection.x,homeDirection.z));character.quaternion.slerp(homeFacing,1-Math.exp(-step*7));
      rig.setPose({phase:'wade',progress:1-p,time:poseTime});
      const ground=groundAt(character.position.x,character.position.z),contacts=rig.getFootContacts?.();
      let support=ground;
      if(contacts)for(const foot of [contacts.left,contacts.right]){
        point.fromArray(foot.center).applyQuaternion(character.quaternion);
        for(const [dx,dz] of [[0,0],[.07,0],[-.07,0],[0,.07],[0,-.07]]){
          const terrain=groundAt(character.position.x+point.x+dx,character.position.z+point.z+dz);
          support=Math.max(support,terrain-point.y+.012);
        }
      }
      character.position.y=Math.max(THREE.MathUtils.lerp(waterAt(character.position.x,character.position.z),ground,k),support)+.025*Math.sin(Math.PI*p);
      // During the swim-to-stand blend the torso and knees can reach farther
      // up an uneven beach than either foot. Sample the deformed body's low
      // vertices in small spatial bins, then lift only as much as necessary.
      if(bodyMesh?.isSkinnedMesh&&p<.98){
        character.updateWorldMatrix(true,true);bodyMesh.skeleton.update();
        const low=new Map(),v=new THREE.Vector3(),positions=bodyMesh.geometry.attributes.position;
        for(let i=0;i<positions.count;i++){
          bodyMesh.getVertexPosition(i,v).applyMatrix4(bodyMesh.matrixWorld);
          const key=`${Math.round(v.x/.10)},${Math.round(v.z/.10)}`,previous=low.get(key);
          if(!previous||v.y<previous.y)low.set(key,v.clone());
        }
        let lift=0;for(const v of low.values())lift=Math.max(lift,groundAt(v.x,v.z)-v.y+.012);
        character.position.y+=lift;
      }
      if(p>=1)finishAtShore();
    }else if(phase==='waiting'){if(!motion)idlePose();}
    else if(phase==='approaching'){
      const trip=motion?.getExternalTrip(motionId);
      if(trip?.status==='arrived'){
        motion.setExternalControl(motionId,true);shore.copy(character.position);
        idleQ.setFromAxisAngle(up,Math.atan2(anchorX-shore.x,anchorZ-shore.z));
        setPhase('walking');
      }else if(!trip||trip.status==='blocked')finishAtShore();
    }
    else if(phase==='walking'||phase==='walking-back'){
      character.position.lerpVectors(shore,walkEnd,q);
      character.position.y=walkGround(q);
      character.quaternion.setFromAxisAngle(up,Math.atan2(walkEnd.x-shore.x,walkEnd.z-shore.z)+(back?Math.PI:0));
      if(back)character.quaternion.slerp(idleQ,smooth((progress-.75)/.25));
      rig.setPose({phase:'walk',time:poseTime,gaitWeight:back?1-smooth((progress-.75)/.25):1});
      if(progress>=1)back?finishAtShore():setPhase('wading');
    } else if(phase==='wading'||phase==='wading-back'){
      character.position.lerpVectors(walkEnd,swimStart,q);
      const blend=smooth(clamp((q-.5)/.5,0,1));
      character.position.y=THREE.MathUtils.lerp(THREE.MathUtils.lerp(walkEnd.y,-.32,q),swimStart.y,blend);
      character.quaternion.copy(swimHeading);
      rig.setPose({phase:'wade',progress:q,time:poseTime});
      if(progress>=1)setPhase(back?'walking-back':'swimming');
    } else if(phase==='swimming'||phase==='swimming-back'){
      character.position.lerpVectors(swimStart,swimEnd,q);character.position.y=waterAt(character.position.x,character.position.z);
      character.quaternion.copy(swimHeading);
      jumpQ.copy(board.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(up,Math.PI*.5));
      if(!back&&q>.75)character.quaternion.slerp(jumpQ,smooth((q-.75)/.25));
      if(back&&progress<.25)character.quaternion.slerpQuaternions(jumpQ,swimHeading,smooth(progress/.25));
      rig.setPose({phase:'swim',time:poseTime});
      if(progress>=1)setPhase(back?'wading-back':'jumping');
    } else if(phase==='jumping'||phase==='leaving'){
      const reverse=phase==='leaving', t=reverse?1-progress:progress, k=smooth(t);
      point.set(0,DECK_Y,RIDER_Z).applyQuaternion(board.quaternion).add(board.position);
      character.position.lerpVectors(swimEnd,point,k);
      character.position.y+=Math.sin(Math.PI*t)*.48;
      jumpQ.copy(board.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(up,Math.PI*.5));
      character.quaternion.slerpQuaternions(jumpQ,board.quaternion,k);
      rig.setPose({phase:'water-jump',progress:t,time:poseTime});
      if(!reverse&&progress>=.65&&!waveOwned&&!water.coastWaveRunning){
        waveOwned=Boolean(water.startCoastWave?.(simulationTime,Math.cos(waveStartAngle)*boardRadius,Math.sin(waveStartAngle)*boardRadius));
        if(waveOwned)lastWaveRunning=true;
      }
      if(progress>=1){
        if(reverse)beginSwimHome();
        else if(waveOwned&&water.coastWaveRunning){setPhase('riding');landingCount++;boardPose();}
        else if(water.coastWaveRunning)setPhase('waiting-wave');
        else if(water.startCoastWave?.(simulationTime,Math.cos(waveStartAngle)*boardRadius,Math.sin(waveStartAngle)*boardRadius)){
          setPhase('riding');waveOwned=true;lastWaveRunning=true;landingCount++;boardPose();
        }else setPhase('waiting-wave');
      }
    } else if(phase==='waiting-wave'){
      boardPose();
      if(!water.coastWaveRunning&&water.startCoastWave?.(simulationTime,Math.cos(waveStartAngle)*boardRadius,Math.sin(waveStartAngle)*boardRadius)){
        setPhase('wave-hop');waveOwned=true;lastWaveRunning=true;
      }
    } else if(phase==='wave-hop'){
      boardPose();character.position.y+=Math.sin(Math.PI*progress)*.32;
      if(progress>=1){setPhase('riding');landingCount++;boardPose();}
    } else if(phase==='recovering'){
      const t=clamp(phaseAge/.65,0,1),k=smooth(t);
      character.position.lerpVectors(recoveryFrom,swimEnd,k);character.position.y+=Math.sin(Math.PI*t)*.20;
      jumpQ.copy(board.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(up,Math.PI*.5));
      character.quaternion.slerpQuaternions(recoveryQ,jumpQ,k);
      rig.setPose({phase:'water-jump',progress:recoveryPoseProgress*(1-k),time:poseTime});
      if(t>=1)setPhase('swimming-back');
    } else if(phase==='mounting'||phase==='dismounting'){
      const reverse=phase==='dismounting', t=reverse?1-progress:progress, k=smooth(t), offset=-.45*(1-k);
      point.set(offset,DECK_Y,0).applyQuaternion(board.quaternion).add(board.position);
      const waterY=waterAt(point.x,point.z);
      character.position.copy(point);character.position.y=THREE.MathUtils.lerp(waterY,point.y,k);
      character.quaternion.copy(board.quaternion);
      rig.setPose({phase:'mount',progress:reverse?1-t:t,returning:reverse,time:poseTime,boardOffsetX:offset,deckOffsetY:point.y-character.position.y});
      if(progress>=1)setPhase(reverse?'swimming-back':'standing');
    } else if(phase==='standing'||phase==='sitting'){
      const reverse=phase==='sitting',t=reverse?1-progress:progress;
      character.position.set(0,DECK_Y,.2*smooth(t)).applyQuaternion(board.quaternion).add(board.position);
      character.quaternion.copy(board.quaternion);
      rig.setPose({phase:'stand',progress:reverse?1-t:t,returning:reverse,time:poseTime});
      if(progress>=1){
        if(reverse)setPhase('dismounting');
        else if(water.startCoastWave?.(simulationTime,Math.cos(waveStartAngle)*boardRadius,Math.sin(waveStartAngle)*boardRadius)){
          setPhase('riding');waveOwned=true;lastWaveRunning=true;landingCount++;boardPose();
        }else{cancelled=true;setPhase('sitting');}
      }
    } else if(phase==='riding'||phase==='returning')boardPose();
    renderWake();
  }
  board.visible=false;surfaceBoard(0,true);idlePose();
  root.updateMatrixWorld(true);
  return {
    root,board,character,shoreObstacle,landReservations,bindMotion,requestStart,cancel,setMode,update,
    get phase(){return phase;},get busy(){return phase!=='waiting';},get canCancel(){return canCancel();},
    get settling(){return cancelled&&phase!=='waiting';},get effectsActive(){return cancelled&&phase!=='waiting';},
    getPosition:()=>character.position.clone(),
    getViewPose(){
      character.updateWorldMatrix(true,false);
      const eye=(rig.getEyeLocal?.()||new THREE.Vector3(0,(rig.height||1.02)*.87,.065)).applyMatrix4(character.matrixWorld);
      // Look along travel, not the animated torso: it turns sideways on the
      // board and pitches through the swimming and jumping transitions.
      const direction=new THREE.Vector3(),worldQ=new THREE.Quaternion();
      if(['riding','returning','jumping','waiting-wave','wave-hop','standing','sitting'].includes(phase)){
        board.getWorldQuaternion(worldQ);direction.set(0,0,1).applyQuaternion(worldQ);
      }else if(['wading','wading-back'].includes(phase)){
        direction.set(swimStart.x-walkEnd.x,0,swimStart.z-walkEnd.z);
        if(phase==='wading-back')direction.negate();
        root.getWorldQuaternion(worldQ);direction.applyQuaternion(worldQ);
      }else if(['swim-home','land-home'].includes(phase)){
        direction.copy(homeDirection);root.getWorldQuaternion(worldQ);direction.applyQuaternion(worldQ);
      }else if(['swimming','swimming-back','leaving','recovering'].includes(phase)){
        const target=new THREE.Vector3(-.45,0,0).applyQuaternion(board.quaternion).add(board.position);
        direction.set(target.x-swimStart.x,0,target.z-swimStart.z);
        if(phase.endsWith('-back')||phase==='leaving'||phase==='recovering')direction.negate();
        root.getWorldQuaternion(worldQ);direction.applyQuaternion(worldQ);
      }else{
        character.getWorldQuaternion(worldQ);direction.set(0,0,1).applyQuaternion(worldQ);
      }
      direction.y=0;
      if(direction.lengthSq()<1e-8)direction.set(0,0,1);else direction.normalize();
      // A small forward clearance reduces shoulder intersections when looking
      // around, while preserving the wearer's visible body below the camera.
      eye.addScaledVector(direction,.12);eye.y+=.04;
      if(['swimming','swimming-back','wading','wading-back','swim-home','land-home'].includes(phase))eye.y=Math.max(eye.y,waterAt(character.position.x,character.position.z)+.16);
      // Three.js cameras face -Z in local coordinates.
      const facing=new THREE.Quaternion().setFromAxisAngle(up,Math.atan2(-direction.x,-direction.z));
      const bodyPosition=character.getWorldPosition(new THREE.Vector3());
      const bodyYawWorld=Math.atan2(bodyPosition.x-eye.x,bodyPosition.z-eye.z);
      return {position:eye,quaternion:facing,bodyYawWorld,hiddenObjects:[character]};
    },
    diagnostics:()=>({
      mode:sceneMode,phase,phaseAge,busy:phase!=='waiting',canCancel:canCancel(),settling:cancelled&&phase!=='waiting',cancelled,
      riderOnBoard:phase==='riding'||phase==='returning',boardVisible:board.visible,
      shore:shore.toArray(),position:character.position.toArray(),boardPosition:board.position.toArray(),boardQuaternion:board.quaternion.toArray(),
      originalStart:[anchorX,anchorZ],startAngle,boardAngle,boardRadius,boardSpeed,deckY:DECK_Y,boardLength:BOARD_LENGTH,boardWidth:BOARD_WIDTH,
      pitch,roll,completedLaps,totalDistance,landingCount,cancelCount,lastWaveProgress,waveOwned,wakeParticles:wake.count,
      returnLanding:homeSite?{land:homeSite.land.toArray(),edge:homeSite.edge.toArray(),deep:homeSite.deep.toArray(),route:homeRoute,travel:homeTravel,sites:landingSites?.length||0}:null,
      boardingSeconds:BOARDING_SECONDS,returnDuration,returnSweep,rig:rig.diagnostics?.(),
    }),
    dispose(){
      if(disposed)return;disposed=true;if(waveOwned)water.stopCoastWave?.();
      const geometries=new Set(),materials=new Set();
      board.traverse(object=>{if(object.isMesh){geometries.add(object.geometry);for(const mat of [].concat(object.material))materials.add(mat);}});
      for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
      wake.dispose?.();wakeGeo.dispose();wakeMat.dispose();rig.dispose?.();scene.remove(root);
    },
  };
}
