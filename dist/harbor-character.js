/** The imported visitor uses the same dry-land navigator as the islanders.
 * Keep authored skinning inside a separate placement root: clip translations
 * never fight the navigation controller, and pauses blend into a standing pose.
 */
export function createHarborCharacter(THREE,gltf,{height=1.02,position=[2,.6,3.35],
  id='tapati-dancer',label='塔帕蒂 · 自由漫步'}={}){
  const figure=gltf.scene,root=new THREE.Group();root.name=`ACTOR_${id.replaceAll('-','_')}`;root.add(figure);
  const assetMetadata=figure.children.find(o=>o.userData?.variant)?.userData||figure.userData;
  const rest=new Map();figure.traverse(o=>{if(o.isBone)rest.set(o.name,{position:o.position.clone(),quaternion:o.quaternion.clone()});
    if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  const original=THREE.AnimationClip.findByName(gltf.animations,'Walk');
  if(!original)throw new Error('角色模型缺少 Walk 动画');
  const walk=original.clone();
  // The donor's lower-body Walk is retargeted to this rig at export time.
  // Its arms held a sword, so author relaxed counter-swings for this visitor.
  const q=new THREE.Quaternion(),limbEuler=new THREE.Euler();
  const legInterpolants=Object.fromEntries(['Left','Right'].map(side=>[side,
    walk.tracks.find(t=>t.name===`${side}UpLeg.quaternion`)?.createInterpolant()]));
  for(const track of walk.tracks){
    const match=/^(Left|Right)(Shoulder|Arm|ForeArm|Hand)\.quaternion$/.exec(track.name);
    if(!match)continue;
    const [,side,part]=match,sign=side==='Left'?-1:1;
    for(let i=0;i<track.times.length;i++){
      let swing=0;
      if(part==='Arm'&&legInterpolants[side]){
        q.fromArray(legInterpolants[side].evaluate(track.times[i]));
        swing=-limbEuler.setFromQuaternion(q).x*.55;
      }
      q.setFromEuler(limbEuler.set(part==='Arm'?swing:0,
        part==='ForeArm'?sign*.14:0,part==='Arm'?sign*1.32:0));
      q.toArray(track.values,i*4);
    }
  }
  // The source clip walks in place, but its authored hip offset is not centered
  // on the rig. Remove that constant offset while retaining side-to-side sway.
  const hipsTrack=walk.tracks.find(t=>t.name==='Hips.position');
  if(hipsTrack){
    let x=0,z=0;const n=hipsTrack.values.length/3;
    for(let i=0;i<n;i++){x+=hipsTrack.values[i*3];z+=hipsTrack.values[i*3+2];}
    for(let i=0;i<n;i++){hipsTrack.values[i*3]-=x/n;hipsTrack.values[i*3+2]-=z/n;}
  }
  const mixer=new THREE.AnimationMixer(figure),walkAction=mixer.clipAction(walk).play();
  mixer.setTime(.2);root.updateMatrixWorld(true);
  // Plumes are an accessory, not the person's height. Match the islanders by
  // head/hair and feet while preserving the headdress's original proportions.
  const bounds=new THREE.Box3();
  figure.traverse(mesh=>{if(mesh.isMesh&&!/attach-hat/.test(mesh.name))bounds.union(new THREE.Box3().setFromObject(mesh,true));});
  const size=bounds.getSize(new THREE.Vector3());
  if(!Number.isFinite(size.y)||size.y<=0)throw new Error('角色模型尺寸无效');
  const scale=height/size.y;figure.scale.setScalar(scale);

  // Locally authored idle: straight, planted legs, relaxed empty hands,
  // a small breathing motion, and an occasional glance to either side.
  // Every Walk binding has an idle counterpart, so fades never return an arm
  // to the T-pose or leave a leg frozen halfway through a step.
  const duration=5.4,times=[0,.675,1.35,2.025,2.7,3.375,4.05,4.725,5.4],tracks=[];
  const offset=new THREE.Quaternion(),euler=new THREE.Euler();
  for(const track of walk.tracks){
    const name=track.name.slice(0,track.name.lastIndexOf('.')),bone=figure.getObjectByName(name),bind=rest.get(name);
    if(!bone||!bind)continue;
    if(track.name.endsWith('.quaternion')){
      const neutral=bind.quaternion.clone();
      if(/^(Left|Right)Arm$/.test(name))neutral.setFromEuler(euler.set(0,0,name.startsWith('Left')?-1.32:1.32));
      if(/^(Left|Right)ForeArm$/.test(name))neutral.setFromEuler(euler.set(0,name.startsWith('Left')?-.14:.14,0));
      const values=[];
      for(const t of times){
        const phase=t/duration*Math.PI*2;
        const look=name==='Head'?Math.sin(phase)*.17:name==='Neck'?Math.sin(phase)*.045:0;
        const breath=/^Spine/.test(name)?Math.sin(phase*2)*.006:0;
        offset.setFromEuler(euler.set(breath,look,0));
        values.push(...neutral.clone().multiply(offset).normalize().toArray());
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(track.name,times,values));
    }else if(track.name.endsWith('.position')){
      const values=[];
      for(const t of times){const p=bind.position.clone();if(name==='Hips')p.y+=Math.sin(t/duration*Math.PI*4)*.002;values.push(...p.toArray());}
      tracks.push(new THREE.VectorKeyframeTrack(track.name,times,values));
    }
  }
  const idle=new THREE.AnimationClip('Island idle · breathe and look',duration,tracks);
  const idleAction=mixer.clipAction(idle).play();idleAction.setEffectiveWeight(1);walkAction.setEffectiveWeight(0);
  root.position.fromArray(position);
  // Cache foot/toe skin vertices across all meshes. Bare feet may belong to
  // the body mesh, while footwear can be separate; neither needs a mesh name.
  const soles=[];
  figure.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const a=mesh.geometry.attributes,seen=new Set(),indices=[];
    const footBones=new Set(mesh.skeleton.bones.flatMap((b,i)=>/^(Left|Right)(Foot|ToeBase)$/.test(b.name)?[i]:[]));
    for(let i=0;i<a.position.count;i++){
      let footWeight=0;
      for(let c=0;c<4;c++)if(footBones.has(a.skinIndex.getComponent(i,c)))footWeight+=a.skinWeight.getComponent(i,c);
      if(footWeight<.45)continue;
      const key=[a.position.getX(i),a.position.getY(i),a.position.getZ(i),
        ...['skinIndex','skinWeight'].flatMap(k=>[a[k].getX(i),a[k].getY(i),a[k].getZ(i),a[k].getW(i)])].join(',');
      if(!seen.has(key)){seen.add(key);indices.push(i);}
    }
    if(indices.length)soles.push({mesh,indices});
  });
  const soleSamples=soles.reduce((n,s)=>n+s.indices.length,0);
  if(!soleSamples)throw new Error('角色模型缺少可用于贴地的脚部蒙皮');
  const point=new THREE.Vector3(),origin=new THREE.Vector3();
  let blend=0,playbackRate=0,activity='looking-around',groundOffset=0,animationTime=0;
  const referenceSpeed=.80; // Retargeted stance-foot speed, verified at island scale.
  function groundFeet(){
    figure.position.y=0;root.updateMatrixWorld(true);root.getWorldPosition(origin);
    let minY=Infinity;
    for(const {mesh,indices}of soles)for(const index of indices){mesh.getVertexPosition(index,point).applyMatrix4(mesh.matrixWorld);minY=Math.min(minY,point.y);}
    groundOffset=Number.isFinite(minY)?origin.y-minY+.002:-bounds.min.y*scale;
    figure.position.y=groundOffset;
  }
  function update({dt,time,moved=0,activity:nextActivity='looking-around'}){
    const moving=moved>1e-6;
    blend+=(Number(moving)-blend)*(1-Math.exp(-8*dt));
    if(blend<.001)blend=0;if(blend>.999)blend=1;
    const rate=moving?Math.max(.2,Math.min(1.8,moved/Math.max(dt,.001)/referenceSpeed)):.25;
    playbackRate+=(rate-playbackRate)*(1-Math.exp(-10*dt));
    walkAction.setEffectiveTimeScale(playbackRate);walkAction.setEffectiveWeight(blend);
    idleAction.setEffectiveWeight(1-blend);mixer.update(dt);animationTime=mixer.time;
    activity=nextActivity;groundFeet();
  }
  mixer.update(0);groundFeet();
  root.userData.viewEye=[0,height*.88,.06];
  return {root,
    spec:{id,node:root.name,label,forward:[0,0,1],speed:.34,phase:0,contactRadius:.50,
      skeletal:true,navigationPadding:.53,viewEye:root.userData.viewEye},
    update,
    diagnostics:()=>({loaded:true,asset:'tapati-dancer',variant:{...assetMetadata.variant},surface:assetMetadata.smoothing,position:root.position.toArray(),height,scale,activity,
      sourceAnimations:gltf.animations.map(a=>({name:a.name,duration:a.duration})),
      customAnimations:[idle.name],walkWeight:blend,playbackRate,animationTime,groundOffset,
      soleSamples,referenceSpeed,contactRadius:.50}),
    dispose(){mixer.stopAllAction();mixer.uncacheRoot(figure);},
  };
}
