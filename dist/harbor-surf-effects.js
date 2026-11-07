/** Short-lived spray and foamy wakes for the breaker and the surfboard.
 * A bounded pool avoids creating new meshes or accumulating particles on laps. */
const TAU=Math.PI*2;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};

// Four narrow water ribbons record the rails' path. Unlike flat foam cards,
// each station follows the moving surface, with a soft, thinning wake behind.
function createRailWake(THREE,root,water){
  const CAPACITY=26,STRANDS=4,LIFE=.70,INTERVAL=1/36,BOW_POINTS=17;
  const history=Array.from({length:CAPACITY},()=>({active:false,age:0}));
  const geometry=new THREE.BufferGeometry(),railVertices=CAPACITY*STRANDS*2,vertices=railVertices+BOW_POINTS*4;
  const positions=new Float32Array(vertices*3),colors=new Float32Array(vertices*4),uv=new Float32Array(vertices*2),valid=new Uint8Array(CAPACITY*STRANDS),indices=[];
  for(let s=0;s<STRANDS;s++)for(let i=0;i<CAPACITY-1;i++){
    const a=2*(s*CAPACITY+i);indices.push(a,a+1,a+2,a+1,a+3,a+2);
  }
  for(let s=0;s<2;s++)for(let i=0;i<BOW_POINTS-1;i++){
    const a=railVertices+2*(s*BOW_POINTS+i);indices.push(a,a+1,a+2,a+1,a+3,a+2);
  }
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2).setUsage(THREE.DynamicDrawUsage));geometry.setIndex(indices);geometry.index.setUsage(THREE.DynamicDrawUsage);geometry.setDrawRange(0,0);
  const width=32,height=128,pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const across=(x+.5)/width*2-1,v=y/height*TAU;
    const fringe=1-smooth((Math.abs(across)-.20)/.80);
    const threads=.82+.12*Math.sin(v*3+Math.sin(v))+.06*Math.sin(v*7-.4);
    const k=(y*width+x)*4;pixels[k]=pixels[k+1]=pixels[k+2]=255;pixels[k+3]=Math.round(255*fringe*threads);
  }
  const texture=new THREE.DataTexture(pixels,width,height,THREE.RGBAFormat);texture.needsUpdate=true;
  texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.wrapT=THREE.RepeatWrapping;
  const material=new THREE.MeshBasicMaterial({name:'Surf · fine rail ripples',color:'#e9fff8',map:texture,vertexColors:true,transparent:true,opacity:.93,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2});
  material.forceSinglePass=true;
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Surf · slender rail wakes';mesh.frustumCulled=false;mesh.renderOrder=11;mesh.visible=false;root.add(mesh);
  const contact=new THREE.Vector3(),bowPosition=new THREE.Vector3(),bowForward=new THREE.Vector3(),bowValid=new Uint8Array(BOW_POINTS*2);
  let clock=0,cursor=0,activeCount=0,distance=0,visibleStrips=0,bowGain=0;
  function update(step,time,board,forward,speed,emitting,intensity){
    if(step<=0)return;
    for(const p of history){if(p.active){p.age+=step;if(p.age>=LIFE)p.active=false;}}
    if(emitting&&intensity>0){
      bowPosition.copy(board.position);bowForward.copy(forward);bowGain=Math.min(1,bowGain+step*10);
      clock+=step;distance+=speed*step;
      if(clock>=INTERVAL){
        clock%=INTERVAL;contact.set(0,0,.52).applyQuaternion(board.quaternion).add(board.position);
        const p=history[cursor];Object.assign(p,{active:true,age:0,x:contact.x,z:contact.z,rx:forward.z,rz:-forward.x,strength:clamp(speed/2.5,.25,1)*intensity,distance});
        cursor=(cursor+1)%CAPACITY;
      }
    }else {clock=0;bowGain=Math.max(0,bowGain-step*5);}
    activeCount=0;for(const p of history)if(p.active)activeCount++;
    mesh.visible=activeCount>=2||bowGain>0;visibleStrips=activeCount>=2?STRANDS:0;
    if(!mesh.visible)return;
    colors.fill(0);valid.fill(0);
    for(let s=0;s<STRANDS;s++){
      const side=s<2?-1:1,secondary=s%2;
      for(let i=0;i<CAPACITY;i++){
        const p=history[(cursor-1-i+CAPACITY)%CAPACITY],base=2*(s*CAPACITY+i);
        if(!p.active)continue;
        // Outward dispersion opens a slight V; two unequal fine traces per rail.
        const spread=.27+secondary*.10+.11*smooth(p.age/.12)+p.age*(.38+secondary*.12)+.008*Math.sin(p.distance*10+s);
        const x=p.x+p.rx*side*spread,z=p.z+p.rz*side*spread;
        const surface=water.sample?.(x,z,time);
        const h=surface?.height??water.sampleHeight?.(x,z,time)??0;
        if(surface?.wet===false||!Number.isFinite(h))continue;
        valid[s*CAPACITY+i]=1;
        const life=LIFE-secondary*.12,fade=smooth(p.age/.025)*Math.pow(clamp(1-p.age/life,0,1),.80);
        const halfWidth=(secondary?.030:.052)*(1+.45*p.age/LIFE)*(.90+.10*Math.sin(p.distance*7+s));
        for(let j=0;j<2;j++){
          const k=base+j,offset=(j?1:-1)*halfWidth,dx=p.rx*offset,dz=p.rz*offset;
          positions[k*3]=x+dx;positions[k*3+1]=h+.012+(surface?.dx||0)*dx+(surface?.dz||0)*dz;positions[k*3+2]=z+dz;
          colors[k*4]=colors[k*4+1]=colors[k*4+2]=1;colors[k*4+3]=fade*p.strength*(secondary?.72:1);
          uv[k*2]=j;uv[k*2+1]=p.distance/.72+s*.17;
        }
      }
    }
    // Join only adjacent live, wet stations: no stretched triangles across
    // missing history or dry land at the beginning/end of a trail.
    let indexCount=0;const index=geometry.index.array;
    for(let s=0;s<STRANDS;s++)for(let i=0;i<CAPACITY-1;i++){
      if(!valid[s*CAPACITY+i]||!valid[s*CAPACITY+i+1])continue;
      const a=2*(s*CAPACITY+i);index[indexCount++]=a;index[indexCount++]=a+1;index[indexCount++]=a+2;index[indexCount++]=a+1;index[indexCount++]=a+3;index[indexCount++]=a+2;
    }
    // A visible open bow wave wraps around the nose, then opens into the rail
    // traces. This is a short pressure ridge, never a circle around the board.
    bowValid.fill(0);
    if(bowGain>0)for(let arc=0;arc<2;arc++)for(let i=0;i<BOW_POINTS;i++){
      const u=i/(BOW_POINTS-1)*2-1,rx=bowForward.z,rz=-bowForward.x;
      const lateral=u*(.39+arc*.075),along=.91+arc*.10-.46*u*u+.009*Math.sin(u*16-time*4+arc);
      const x=bowPosition.x+bowForward.x*along+rx*lateral,z=bowPosition.z+bowForward.z*along+rz*lateral;
      const surface=water.sample?.(x,z,time),h=surface?.height??water.sampleHeight?.(x,z,time)??0;
      if(surface?.wet===false||!Number.isFinite(h))continue;
      bowValid[arc*BOW_POINTS+i]=1;
      const fade=(1-smooth((Math.abs(u)-.70)/.30))*bowGain*clamp(intensity,0,1.5)*(arc?.46:.96);
      const width=(arc?.022:.045)*(.88+.12*Math.sin(u*14-time*5));
      for(let j=0;j<2;j++){
        const k=railVertices+2*(arc*BOW_POINTS+i)+j,offset=(j?1:-1)*width;
        const dx=bowForward.x*offset,dz=bowForward.z*offset;
        positions[k*3]=x+dx;positions[k*3+1]=h+.016+(surface?.dx||0)*dx+(surface?.dz||0)*dz;positions[k*3+2]=z+dz;
        colors[k*4]=colors[k*4+1]=colors[k*4+2]=1;colors[k*4+3]=fade;
        uv[k*2]=j;uv[k*2+1]=u*.7+time*.36+arc*.3;
      }
    }
    for(let arc=0;arc<2;arc++)for(let i=0;i<BOW_POINTS-1;i++){
      if(!bowValid[arc*BOW_POINTS+i]||!bowValid[arc*BOW_POINTS+i+1])continue;
      const a=railVertices+2*(arc*BOW_POINTS+i);index[indexCount++]=a;index[indexCount++]=a+1;index[indexCount++]=a+2;index[indexCount++]=a+1;index[indexCount++]=a+3;index[indexCount++]=a+2;
    }
    geometry.setDrawRange(0,indexCount);geometry.index.needsUpdate=true;
    for(const name of ['position','color','uv'])geometry.attributes[name].needsUpdate=true;
  }
  function reset(){for(const p of history)p.active=false;clock=cursor=activeCount=distance=visibleStrips=bowGain=0;mesh.visible=false;geometry.setDrawRange(0,0);colors.fill(0);}
  return {update,reset,diagnostics:()=>({wakeStrips:visibleStrips,bowRipple:bowGain,wakeStations:activeCount,wakeCapacity:CAPACITY,wakeVertices:vertices}),dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();texture.dispose();}};
}

export function createHarborSurfEffects(THREE,{scene,water,surfing}={}){
  if(!scene||!water)throw new Error('Surf effects require a scene and water');
  const root=new THREE.Group();root.name='Surf · spray and foam';scene.add(root);
  const railWake=createRailWake(THREE,root,water);
  let seed=0x8a43ce2d;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const size=64,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=(x+.5-size/2)/(size/2),v=(y+.5-size/2)/(size/2),angle=Math.atan2(v,u);
    const r=Math.hypot(u,v),edge=.75+.085*Math.sin(angle*5+.7)+.048*Math.sin(angle*9-1.8);
    const softness=1-smooth((r-edge+.10)/.22);
    const lace=.73+.17*Math.sin(u*20+Math.sin(v*13)*2)*Math.sin(v*19-u*5);
    const i=(y*size+x)*4;data[i]=235;data[i+1]=255;data[i+2]=250;data[i+3]=Math.round(255*clamp(softness*lace,0,1));
  }
  const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);texture.needsUpdate=true;
  texture.magFilter=texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;
  texture.name='Surf · irregular aerated foam';
  const foamGeometry=new THREE.PlaneGeometry(1,1),dropGeometry=new THREE.SphereGeometry(1,6,4);
  const foamMaterial=new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.58,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2});
  const dropMaterial=new THREE.MeshBasicMaterial({color:'#d5f4ef',transparent:true,opacity:.64,depthWrite:false});
  const FOAM_LIMIT=144,DROP_LIMIT=88;
  const foamMesh=new THREE.InstancedMesh(foamGeometry,foamMaterial,FOAM_LIMIT),dropsMesh=new THREE.InstancedMesh(dropGeometry,dropMaterial,DROP_LIMIT);
  foamMesh.name='Surf · foam trails';dropsMesh.name='Surf · airborne droplets';
  foamMesh.frustumCulled=dropsMesh.frustumCulled=false;foamMesh.renderOrder=11;dropsMesh.renderOrder=12;
  foamMesh.count=dropsMesh.count=0;foamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);dropsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(foamMesh,dropsMesh);
  const foam=Array.from({length:FOAM_LIMIT},()=>({active:false})),drops=Array.from({length:DROP_LIMIT},()=>({active:false}));
  const dummy=new THREE.Object3D(),forward=new THREE.Vector3(),tail=new THREE.Vector3(),lastBoard=new THREE.Vector3(),nosePoint=new THREE.Vector3(),dropDirection=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  const surfaceNormal=new THREE.Vector3(),surfaceAlong=new THREE.Vector3(),surfaceAcross=new THREE.Vector3(),surfaceBasis=new THREE.Matrix4();
  let foamCursor=0,dropCursor=0,boardClock=0,crestClock=0,crestPulse=0,impulseClock=0,seconds=0,frame=0;
  let previousWaveX=null,previousWaveZ=null,previousGap=null,lastBoardValid=false,peakBoardSpeed=0;
  let foamEmitted=0,dropsEmitted=0,impulses=0,impacts=0,disposed=false;
  let crestIntensity=.65,boardIntensity=1,rippleIntensity=1;
  function sample(x,z){
    const value=water.sample?.(x,z,seconds);
    if(value&&value.wet===false)return null;
    const h=Number(value?.height??water.sampleHeight?.(x,z,seconds));
    return Number.isFinite(h)?h:0;
  }
  function spawnFoam(x,z,vx,vz,orientation,width,length,life){
    const h=sample(x,z);if(h===null)return false;
    const p=foam[foamCursor++%FOAM_LIMIT];Object.assign(p,{active:true,x,z,y:h+.009,vx,vz,orientation,width,length,life,age:0});foamEmitted++;return true;
  }
  function spawnDrop(x,y,z,vx,vy,vz,life,radius,splash=false){
    const p=drops[dropCursor++%DROP_LIMIT];Object.assign(p,{active:true,x,y,z,vx,vy,vz,life,radius,splash,age:0});dropsEmitted++;
  }
  function impulse(x,z,strength,footprint){
    if(rippleIntensity>0&&typeof water.addImpulse==='function'&&water.addImpulse(x,z,strength*rippleIntensity,footprint)!==false)impulses++;
  }
  function boardBurst(board,fx,fz,speed,impact=false){
    if(boardIntensity<=0)return;
    if(impact){landingSplash(board,fx,fz);return;}
    const rx=fz,rz=-fx,scale=(impact?.85:clamp(.55+speed*.16,.55,1.1))*Math.sqrt(boardIntensity);
    // Contact is concentrated at the nose and the forward rails. There is no
    // carpet of white foam behind the board or confetti above the crest.
    tail.set(board.position.x+fx*.65,0,board.position.z+fz*.65);
    const h=sample(tail.x,tail.z);if(h===null)return;
    const pieces=Math.max(1,Math.round((impact?8:2)*boardIntensity));
    for(let i=0;i<pieces;i++){
      const side=i%2?1:-1,spread=side*(.12+random()*.14),back=random()*.33;
      const x=tail.x+rx*spread-fx*back,z=tail.z+rz*spread-fz*back;
      spawnFoam(x,z,rx*side*.20-fx*.14,rz*side*.20-fz*.14,
        Math.atan2(fx,fz)+side*.45,(.035+random()*.04)*scale,(.10+random()*.12)*scale,.40+random()*.24);
    }
    // A tiny submerged-tail fleck, much smaller than the bow disturbance.
    if(!impact&&random()<.28){
      const tx=board.position.x-fx*.72,tz=board.position.z-fz*.72;
      spawnFoam(tx,tz,-fx*.08,-fz*.08,Math.atan2(fx,fz),.035,.07,.25);
    }
    nosePoint.set(0,-.01,.73).applyQuaternion(board.quaternion).add(board.position);
    const noseWater=sample(nosePoint.x,nosePoint.z);
    const noseWet=noseWater===null?0:clamp((.07-(nosePoint.y-noseWater))/.07,0,1);
    const count=Math.max(0,Math.round((impact?10:3*noseWet)*boardIntensity));
    for(let i=0;i<count;i++){
      const side=random()<.5?-1:1,spread=.10+random()*.14,along=(random()-.5)*.17;
      const x=tail.x+rx*side*spread+fx*along,z=tail.z+rz*side*spread+fz*along;
      const dh=sample(x,z);if(dh===null)continue;
      const lateral=side*(.22+random()*.30)*scale,back=.10+random()*.25;
      spawnDrop(x,dh+.025,z,rx*lateral-fx*back,.26+random()*.43,rz*lateral-fz*back,.15+random()*.18,.007+random()*.009);
    }
    if(impact){impulse(tail.x,tail.z,.42,.30);impacts++;}
  }
  function landingSplash(board,fx,fz){
    const rx=fz,rz=-fx;
    // A single short impact: displace water at the hull, lift an uneven crown,
    // then let droplets fall and the small foam fragments spread outward.
    impulse(board.position.x,board.position.z,-.72,.58);impacts++;
    for(let i=0;i<28;i++){
      const a=i/28*TAU+(random()-.5)*.15,sx=Math.cos(a),sz=Math.sin(a);
      const x=board.position.x+rx*sx*.31+fx*sz*.72,z=board.position.z+rz*sx*.31+fz*sz*.72;
      const h=sample(x,z);if(h===null)continue;
      const dx=rx*sx+fx*sz*.65,dz=rz*sx+fz*sz*.65,out=.45+random()*.45;
      spawnDrop(x,h+.035,z,dx*out,1.15+random()*.80,dz*out,.65+random()*.28,.014+random()*.014,true);
      if(i%2===0)spawnFoam(x,z,dx*.48,dz*.48,Math.atan2(dx,dz),.075+random()*.055,.18+random()*.12,.75+random()*.35);
      if(i%7===0)impulse(x,z,.32,.25);
    }
  }
  function crestBurst(wave){
    const x=wave.center?.x,z=wave.center?.z,r=wave.radius;
    if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(r)||r<.01)return;
    const gain=clamp((wave.peak||0)/.99,0,1);if(gain<.025)return;
    const angle=Math.atan2(z,x),inner=Math.max(.2,wave.innerEdge+.16),outer=Math.min(water.radius-.18,wave.outerEdge-.16);
    if(!(outer>inner))return;
    // Let the procedural wave itself supply white crest detail. In front of
    // it, emit only a very small real water disturbance, never white decals.
    if(crestIntensity<=0||crestPulse%3!==0)return;
    const radius=inner+(outer-inner)*(.28+random()*.44),a=angle+1.12/r;
    const px=Math.cos(a)*radius,pz=Math.sin(a)*radius;
    if(sample(px,pz)!==null)impulse(px,pz,.075*crestIntensity,.25);
  }
  function update(dt,time,effectDelta=dt){
    if(disposed)return;
    seconds=Number.isFinite(time)?time:seconds;
    const wave=water.getCoastWaveState?.();
    // Explicit wave cancellation continues to dissipate even if the world is paused.
    const step=clamp((wave?.stopping||surfing?.settling)?Math.max(dt||0,effectDelta||0):(dt||0),0,.1);
    if(step<=0)return;
    frame++;
    const board=surfing?.board,visible=!!board?.visible,phase=surfing?.phase;
    let wakeSpeed=0,wakeEmitting=false;
    if(visible){
      forward.set(0,0,1).applyQuaternion(board.quaternion);forward.y=0;
      if(forward.lengthSq()<1e-6)forward.set(0,0,1);else forward.normalize();
      const speed=lastBoardValid?Math.hypot(board.position.x-lastBoard.x,board.position.z-lastBoard.z)/step:0;
      peakBoardSpeed=Math.max(peakBoardSpeed,Math.min(speed,20));
      const surface=sample(board.position.x,board.position.z),gap=surface===null?null:board.position.y-surface;
      if(gap!==null&&previousGap!==null&&previousGap>.15&&gap<=.15&&['approaching','walking','wading','swimming'].includes(phase))boardBurst(board,forward.x,forward.z,0,true);
      previousGap=gap;lastBoard.copy(board.position);lastBoardValid=true;
      if(phase==='riding'&&!wave?.stopping&&!surfing?.settling&&speed>.18){
        wakeSpeed=speed;wakeEmitting=true;
        boardClock+=step;impulseClock+=step;
        if(boardClock>=.10){boardClock%=.10;boardBurst(board,forward.x,forward.z,speed);}
        if(impulseClock>=.12){
          impulseClock%=.12;const rx=forward.z,rz=-forward.x;
          const nx=board.position.x+forward.x*.67,nz=board.position.z+forward.z*.67;
          const force=clamp(speed/2.8,.15,1.25);
          // Advect the bow pressure source with the board. The solver carries
          // the two rail wakes outward into a V, without stamped ring decals.
          impulse(nx+rx*.19,nz+rz*.19,.19*force,.19);
          impulse(nx-rx*.19,nz-rz*.19,.19*force,.19);
          impulse(nx-forward.x*.37,nz-forward.z*.37,-.10*force,.22);
        }
      }else{boardClock=0;impulseClock=0;}
    }else{previousGap=null;lastBoardValid=false;boardClock=impulseClock=0;}
    railWake.update(step,seconds,board,forward,wakeSpeed,wakeEmitting,boardIntensity);
    const wx=wave?.center?.x,wz=wave?.center?.z;
    const waveSpeed=Number.isFinite(wx)&&previousWaveX!==null?Math.hypot(wx-previousWaveX,wz-previousWaveZ)/step:0;
    previousWaveX=Number.isFinite(wx)?wx:null;previousWaveZ=Number.isFinite(wz)?wz:null;
    if(wave?.running&&!wave.stopping&&wave.peak>.025&&waveSpeed>.08){crestClock+=step;if(crestClock>=.16){crestClock%=.16;crestPulse++;crestBurst(wave);}}
    else crestClock=0;
    let foamCount=0,dropCount=0;
    for(const p of foam){
      if(!p.active)continue;p.age+=step;if(p.age>=p.life){p.active=false;continue;}
      p.x+=p.vx*step;p.z+=p.vz*step;
      // The small active pool follows the actual surface and its slope. Flat
      // horizontal decals would cut through a sloping wave like white cards.
      const contact=water.sample?.(p.x,p.z,seconds);
      if(contact?.wet===false){p.active=false;continue;}
      p.y=(contact?.height??sample(p.x,p.z)??0)+.009;
      const dx=contact?.dx||0,dz=contact?.dz||0;
      const sx=Math.sin(p.orientation),sz=Math.cos(p.orientation);
      surfaceNormal.set(-dx,1,-dz).normalize();surfaceAlong.set(sx,dx*sx+dz*sz,sz).normalize();
      surfaceAcross.crossVectors(surfaceAlong,surfaceNormal).normalize();surfaceBasis.makeBasis(surfaceAcross,surfaceAlong,surfaceNormal);
      const fade=smooth(Math.min(p.age/.06,(p.life-p.age)/.22));
      dummy.position.set(p.x,p.y,p.z);dummy.quaternion.setFromRotationMatrix(surfaceBasis);dummy.scale.set(p.width*fade,p.length*fade,1);dummy.updateMatrix();foamMesh.setMatrixAt(foamCount++,dummy.matrix);
    }
    for(const p of drops){
      if(!p.active)continue;p.age+=step;if(p.age>=p.life){p.active=false;continue;}
      p.x+=p.vx*step;p.z+=p.vz*step;p.y+=p.vy*step;p.vy-=4.6*step;
      if(p.splash&&p.vy<0){
        const h=sample(p.x,p.z);
        if(h===null){p.active=false;continue;}
        if(p.y<h+.015){spawnFoam(p.x,p.z,p.vx*.20,p.vz*.20,Math.atan2(p.vx,p.vz),.045,.10,.38);p.active=false;continue;}
      }
      const fade=smooth(Math.min(p.age/.06,(p.life-p.age)/.18));
      dummy.position.set(p.x,p.y,p.z);
      if(p.splash){dropDirection.set(p.vx,p.vy,p.vz).normalize();dummy.quaternion.setFromUnitVectors(up,dropDirection);dummy.scale.set(p.radius*.72*fade,p.radius*(1.55+.25*Math.abs(p.vy))*fade,p.radius*.72*fade);}
      else {dummy.rotation.set(0,0,0);dummy.scale.setScalar(p.radius*fade);}
      dummy.updateMatrix();dropsMesh.setMatrixAt(dropCount++,dummy.matrix);
    }
    foamMesh.count=foamCount;dropsMesh.count=dropCount;
    if(foamCount)foamMesh.instanceMatrix.needsUpdate=true;
    if(dropCount)dropsMesh.instanceMatrix.needsUpdate=true;
  }
  function setIntensity(options={}){
    if(Number.isFinite(options.crest))crestIntensity=clamp(options.crest,0,1);
    if(Number.isFinite(options.board))boardIntensity=clamp(options.board,0,2);
    if(Number.isFinite(options.ripple))rippleIntensity=clamp(options.ripple,0,2);
  }
  function reset(){
    railWake.reset();
    for(const p of foam)p.active=false;for(const p of drops)p.active=false;
    foamMesh.count=dropsMesh.count=0;boardClock=crestClock=crestPulse=impulseClock=0;
    previousWaveX=previousWaveZ=previousGap=null;lastBoardValid=false;
  }
  return {root,update,reset,setIntensity,diagnostics:()=>({foam:foamMesh.count,droplets:dropsMesh.count,foamCapacity:FOAM_LIMIT,dropletCapacity:DROP_LIMIT,foamEmitted,dropsEmitted,impulses,impacts,peakBoardSpeed,crestIntensity,boardIntensity,rippleIntensity,...railWake.diagnostics()}),dispose(){
    if(disposed)return;disposed=true;railWake.dispose();root.removeFromParent();foamMesh.dispose();dropsMesh.dispose();foamGeometry.dispose();dropGeometry.dispose();foamMaterial.dispose();dropMaterial.dispose();texture.dispose();
  }};
}
