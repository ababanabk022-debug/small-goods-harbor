/** Small, deterministic seabed details. Six shared meshes keep the scene light. */
import {createFishCruiseRoutes} from './harbor-fish-navigation.js?v=10';
export function createUnderwaterLife(THREE,{scene,water,sampleBedHeight=()=>-1.46}){
  const group=new THREE.Group();group.name='Shallow sea habitat';scene.add(group);
  let seed=270127;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const clock={value:0},matrix=new THREE.Matrix4(),dummy=new THREE.Object3D();
  const wet=(x,z,pad=.22)=>{
    if(Math.hypot(x,z)>8.4-pad)return false;
    for(let i=0;i<8;i++){const a=i*Math.PI/4;if(!water.isWater(x+Math.cos(a)*pad,z+Math.sin(a)*pad))return false;}
    return water.isWater(x,z);
  };
  const clusters=[];
  for(let i=0;i<160&&clusters.length<9;i++){
    const a=i*2.399963229728653+.32,r=5.85+random()*2.15,x=Math.cos(a)*r,z=Math.sin(a)*r;
    if(wet(x,z,.5)&&clusters.every(p=>Math.hypot(x-p.x,z-p.z)>1.8))clusters.push({x,z});
  }
  const stones=[],blades=[];
  for(const center of clusters){
    const stoneCount=7+Math.floor(random()*10),spread=.34+random()*.30;
    for(let j=0;j<stoneCount;j++){
      const a=random()*Math.PI*2,r=Math.sqrt(random())*spread,x=center.x+Math.cos(a)*r,z=center.z+Math.sin(a)*r;
      if(wet(x,z,.15))stones.push({x,z,y:sampleBedHeight(x,z),s:.055+random()*.12,a:random()*6.28,c:random()});
    }
    // A small meadow on one side of each pebble patch, leaving open sand between.
    for(let j=0;j<7;j++){
      const x=center.x+.20+(random()-.5)*.35,z=center.z+(random()-.5)*.4;
      if(wet(x,z,.18))blades.push({x,z,y:sampleBedHeight(x,z)-.025,h:.25+random()*.4,a:random()*6.28,c:random()});
    }
  }
  const materials=[],geometries=[];
  function mat(options){const m=new THREE.MeshStandardMaterial(options);materials.push(m);return m;}
  function instances(name,geometry,material,count){
    geometries.push(geometry);const mesh=new THREE.InstancedMesh(geometry,material,count);mesh.name=name;
    mesh.receiveShadow=true;mesh.frustumCulled=false;group.add(mesh);return mesh;
  }
  const rock=instances('Pebble clusters',new THREE.IcosahedronGeometry(1,1),mat({color:0xffffff,roughness:.95}),stones.length);
  const stoneColors=['#777d72','#858779','#95937e','#626f6d'];
  stones.forEach((p,i)=>{dummy.position.set(p.x,p.y+p.s*.34,p.z);dummy.rotation.set(p.a*.3,p.a,p.a*.2);dummy.scale.set(p.s*1.25,p.s*.65,p.s);dummy.updateMatrix();rock.setMatrixAt(i,dummy.matrix);rock.setColorAt(i,new THREE.Color(stoneColors[Math.floor(p.c*stoneColors.length)]));});
  rock.instanceMatrix.needsUpdate=true;rock.castShadow=true;
  // Two crossed ribbons have a tapered tip and a slight natural bend.
  const vertices=[],indices=[];
  for(let plane=0;plane<2;plane++){
    const start=vertices.length/3;
    for(let j=0;j<=4;j++){
      const y=j/4,w=(1-y)*.064+.004,bend=Math.sin(y*1.5)*.065;
      for(const side of [-1,1])vertices.push(plane===0?side*w+bend:0,y,plane===1?side*w+bend:0);
      if(j<4){const k=start+j*2;indices.push(k,k+2,k+1,k+1,k+2,k+3);}
    }
  }
  const grassGeo=new THREE.BufferGeometry();grassGeo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));grassGeo.setIndex(indices);grassGeo.computeVertexNormals();
  const grassMat=mat({color:0xffffff,roughness:.82,side:THREE.DoubleSide});
  grassMat.onBeforeCompile=shader=>{
    shader.uniforms.marineTime=clock;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float marineTime;');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      float marinePhase=instanceMatrix[3].x*.8+instanceMatrix[3].z*.7;
      transformed.x+=sin(marineTime*.85+marinePhase)*position.y*position.y*.11;
      transformed.z+=cos(marineTime*.62+marinePhase)*position.y*position.y*.055;`);
  };
  grassMat.customProgramCacheKey=()=> 'harbor-seagrass-sway-v1';
  const grass=instances('Seagrass meadows',grassGeo,grassMat,blades.length);
  const grassColors=['#58715a','#6d8562','#4d7766'];
  blades.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.a,0);dummy.scale.set(1,p.h,1);dummy.updateMatrix();grass.setMatrixAt(i,dummy.matrix);grass.setColorAt(i,new THREE.Color(grassColors[Math.floor(p.c*3)]));});grass.instanceMatrix.needsUpdate=true;
  const schools=createFishCruiseRoutes(THREE,{water,sampleBedHeight});
  const fish=schools.flatMap((school,k)=>Array.from({length:8},(_,j)=>({school:k,lateral:(j%3-1)*.27+(random()-.5)*.06,ahead:(Math.floor(j/3)-1)*.39+(random()-.5)*.06,scale:.84+random()*.30,depth:-.70-random()*.34,phase:random()*6.28,position:new THREE.Vector3()})));
  const bodies=instances('Shoal bodies',new THREE.SphereGeometry(1,10,6),mat({color:0xffffff,roughness:.43,metalness:.06}),fish.length);
  const tailGeo=new THREE.BufferGeometry();tailGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,.025, 0,.075,-.10, 0,0,-.055, 0,-.075,-.10],3));tailGeo.setIndex([0,1,2,0,2,3]);tailGeo.computeVertexNormals();
  const tails=instances('Shoal tails',tailGeo,mat({color:0xffffff,roughness:.55,side:THREE.DoubleSide}),fish.length);
  const eyes=instances('Shoal eyes',new THREE.SphereGeometry(.011,5,4),mat({color:'#172b30',roughness:.7}),fish.length*2);
  const finGeo=new THREE.BufferGeometry();finGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,.04,.05, 0,.115,-.03, 0,.035,-.09],3));finGeo.setIndex([0,1,2]);finGeo.computeVertexNormals();
  const fins=instances('Shoal dorsal fins',finGeo,mat({color:'#839b9b',roughness:.65,side:THREE.DoubleSide}),fish.length);
  const colors=['#8faeb5','#99b9bd','#c0c9b6','#c9aa6e'];
  fish.forEach((f,i)=>{const c=new THREE.Color(colors[i%8===0?3:i%3]);bodies.setColorAt(i,c);tails.setColorAt(i,c.clone().multiplyScalar(.83));});
  for(const mesh of[bodies,tails,eyes,fins])mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const orientation=new THREE.Quaternion(),tailOrientation=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0),local=new THREE.Vector3(),scale=new THREE.Vector3();
  let elapsed=0,unsafe=0,bedUnsafe=0;
  function update(dt,time){
    if(Number.isFinite(time))elapsed=time;else elapsed+=Math.max(0,dt||0);clock.value=elapsed;
    for(const school of schools){
      const progress=school.offset+elapsed*school.speed*school.direction;
      school.sample(progress,school.position);school.sample(progress+.16*school.direction,school.ahead);
      school.yaw=Math.atan2(school.ahead.x-school.position.x,school.ahead.z-school.position.z);
      school.bounds.min[0]=Math.min(school.bounds.min[0],school.position.x);school.bounds.min[1]=Math.min(school.bounds.min[1],school.position.z);
      school.bounds.max[0]=Math.max(school.bounds.max[0],school.position.x);school.bounds.max[1]=Math.max(school.bounds.max[1],school.position.z);
    }
    fish.forEach((f,i)=>{
      const school=schools[f.school],yaw=school.yaw;
      orientation.setFromAxisAngle(axis,yaw);
      local.set(f.lateral+Math.sin(elapsed*.53+f.phase)*.035,0,f.ahead+Math.cos(elapsed*.43+f.phase)*.035).applyQuaternion(orientation);
      const x=school.position.x+local.x,z=school.position.z+local.z;
      const y=Math.max(school.position.bed+.24,f.depth+Math.sin(elapsed*.8+f.phase)*.055);
      f.position.set(x,y,z);if(!water.isWater(x,z))unsafe++;if(y<school.position.bed+.15)bedUnsafe++;

      scale.set(.056*f.scale,.072*f.scale,.18*f.scale);matrix.compose(f.position,orientation,scale);bodies.setMatrixAt(i,matrix);
      local.set(0,0,-.16*f.scale).applyQuaternion(orientation).add(f.position);
      tailOrientation.setFromAxisAngle(axis,yaw+Math.sin(elapsed*9.0+f.phase)*.28);scale.setScalar(f.scale);matrix.compose(local,tailOrientation,scale);tails.setMatrixAt(i,matrix);
      matrix.compose(f.position,orientation,scale);fins.setMatrixAt(i,matrix);
      for(let side=0;side<2;side++){local.set((side===0?-1:1)*.047*f.scale,.015*f.scale,.10*f.scale).applyQuaternion(orientation).add(f.position);matrix.compose(local,orientation,scale);eyes.setMatrixAt(i*2+side,matrix);}
    });
    for(const mesh of[bodies,tails,eyes,fins])mesh.instanceMatrix.needsUpdate=true;
  }
  update(0,0);
  return {group,update,diagnostics(){return{pebbles:stones.length,grassBlades:blades.length,patches:clusters.length,fish:fish.length,schools:schools.length,drawCalls:group.children.length,unsafeSamples:unsafe,bedUnsafeSamples:bedUnsafe,time:elapsed,fishPositions:fish.slice(0,3).map(f=>f.position.toArray()),cruiseRoutes:schools.map(s=>({length:s.length,speed:s.speed,direction:s.direction,position:[s.position.x,s.position.z],distance:Math.max(0,elapsed)*s.speed,bounds:s.bounds,validated:s.routeValidated})),allFishPositions:fish.map(f=>f.position.toArray())};},dispose(){for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.removeFromParent();}};
}
