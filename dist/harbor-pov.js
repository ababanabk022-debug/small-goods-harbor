/** A view-only camera: reads actor poses without writing into navigation. */
export function createHarborPOV(THREE, {canvas, overview, controls, getPose, onChange, onDirty}) {
  const camera=new THREE.PerspectiveCamera(68,1,.025,120);
  const body=new THREE.Quaternion(),look=new THREE.Quaternion(),angles=new THREE.Euler(0,0,0,'YXZ');
  const maxFollowAngularSpeed=Math.PI/2; // 90 degrees/second; mouse look is unrestricted.
  let subject=null,saved=null,yaw=0,pitch=0,drag=null,hidden=[];
  function endDrag(){
    const active=drag;if(!active||active.releasing)return;
    // releasePointerCapture can synchronously dispatch lostpointercapture.
    // Keep the pointer id until release, while making that callback reentrant.
    active.releasing=true;
    try{if(canvas.hasPointerCapture(active.id))canvas.releasePointerCapture(active.id);}
    finally{if(drag===active)drag=null;}
  }
  function restoreVisibility(){for(const [object,visible] of hidden)object.visible=visible;hidden=[];}
  function setHidden(objects=[]){for(const object of objects){hidden.push([object,object.visible]);object.visible=false;}}
  function orient(){angles.set(pitch,yaw,0);look.setFromEuler(angles);camera.quaternion.copy(body).multiply(look);camera.updateMatrixWorld();}
  function enter(id){
    const pose=getPose(id);if(!pose)return false;
    if(!subject){
      saved={position:overview.position.clone(),target:controls.target.clone(),zoom:overview.zoom,autoRotate:controls.autoRotate};
      controls.autoRotate=false;
      // Flush OrbitControls inertia, then restore the exact saved overview.
      const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;
      overview.position.copy(saved.position);controls.target.copy(saved.target);overview.zoom=saved.zoom;overview.updateProjectionMatrix();controls.update();
    }
    endDrag();controls.enabled=false;restoreVisibility();subject=id;yaw=0;pitch=0;
    setHidden(pose.hiddenObjects);camera.position.copy(pose.position);body.copy(pose.quaternion);orient();
    onChange(subject);onDirty();return true;
  }
  function exit(){
    endDrag();
    if(!subject)return;
    restoreVisibility();subject=null;
    if(saved){overview.position.copy(saved.position);controls.target.copy(saved.target);overview.zoom=saved.zoom;overview.updateProjectionMatrix();controls.update();controls.autoRotate=saved.autoRotate;}
    controls.enabled=true;onChange(null);onDirty();
  }
  function setLook(nextYaw=0,nextPitch=0){
    yaw=Math.atan2(Math.sin(nextYaw),Math.cos(nextYaw));pitch=THREE.MathUtils.clamp(nextPitch,-Math.PI*.43,Math.PI*.43);
    orient();onDirty();
  }
  const down=e=>{if(!subject||e.button!==0||drag)return;e.preventDefault();canvas.focus({preventScroll:true});drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
  const move=e=>{if(!subject||!drag||e.pointerId!==drag.id)return;setLook(yaw-(e.clientX-drag.x)*.004,pitch-(e.clientY-drag.y)*.004);drag.x=e.clientX;drag.y=e.clientY;};
  const up=e=>{if(drag?.id===e.pointerId)endDrag();};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);canvas.addEventListener('lostpointercapture',up);
  return {
    camera,get subject(){return subject;},get active(){return subject!==null;},enter,exit,setLook,
    resize(aspect){camera.aspect=aspect;camera.updateProjectionMatrix();},
    update(dt){
      const step=Number.isFinite(dt)?Math.max(0,Math.min(.1,dt)):0;
      if(!subject||step===0)return;
      const pose=getPose(subject);if(!pose){exit();return;}
      camera.position.lerp(pose.position,1-Math.exp(-step*20));
      // Quaternion angleTo/slerp use the shortest arc, including the +/-180
      // degree boundary. Limit automatic following before adding mouse look.
      const angle=body.angleTo(pose.quaternion);
      if(angle>0)body.slerp(pose.quaternion,Math.min(1-Math.exp(-step*10),maxFollowAngularSpeed*step/angle));
      orient();
    },
    diagnostics(){return {active:subject!==null,subject,lookYaw:yaw,lookPitch:pitch,position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,near:camera.near,maxFollowDegreesPerSecond:90,hiddenObjects:hidden.length};},
    dispose(){exit();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('lostpointercapture',up);},
  };
}
