import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createHarborWater, installHarborCaustics } from './water.js?v=continuous-breaker-8';
import { createHarborMotion } from './harbor-motion.js?v=continuous-breaker-8';
import { createHarborCharacter } from './harbor-character.js?v=tapati-medium-1';
import { createSurferRig } from './harbor-surfer-rig.js?v=surfer-pov-cheer-1';
import { createHarborSurfing } from './harbor-surfing.js?v=continuous-breaker-8';
import { createHarborSurfEffects } from './harbor-surf-effects.js?v=continuous-breaker-8';
import { createHarborRenderer } from './harbor-renderer.js?v=surf-mode-1';
import { createUnderwaterLife } from './harbor-underwater.js?v=14.2';
import { insetHarborSeabedEdge } from './harbor-seabed-edge.js?v=14.1';
import { createHarborPOV } from './harbor-pov.js?v=surfer-pov-cheer-2';
import { createHarborBird } from './harbor-bird.js?v=14.1';
import { createHarborWorld } from './harbor-world.js?v=surf-mode-1';
import { createHarborAudio } from './harbor-audio.js?v=surfer-pov-cheer-1';

const $=id=>document.getElementById(id);
const viewport=$('viewport'), errors=[];
const POV_FISH_INDEX=7; // Lead row: a clear forward view, with the school beside and behind.
const state={ready:false,playing:true,elapsed:0,autoRotate:false,view:'hero',sceneMode:'harbor',frames:0};
let renderer,scene,camera,controls,water,model,foam,meta,transition,motion,diorama,sun,harborRenderer,underwaterLife;
let imageQuality='auto';
let autoScale=1, sampleSeconds=0, sampleFrames=0, lateFrames=0, smoothSeconds=0;
let measureAfter=0, allowIncreaseAfter=0;
let manualOrbitUntil=0,lastAzimuth=0,lastPolar=0;
const interactions={splashes:0,sloshes:0};
let lastTime=performance.now(), averageFrame=16, causticInfo;
let seabedEdgeInfo=null;
let pov,bird,world,stageFloor,overviewView='hero',overviewBackground,overviewFog;
let ambient,harborRoot,characterPreview,characterController,characterFollowing=false,overviewCharacterFollowing=false;
let surferRig,surfing,surfEffects,surferPreview,surferFollowing=false,overviewSurferFollowing=false;
let characterFocusHeight=.55;
const characterLastPosition=new THREE.Vector3();
const surferForward=new THREE.Vector3(),surferWorldQ=new THREE.Quaternion(),followOffset=new THREE.Vector3();
const followUp=new THREE.Vector3(0,1,0);
let surferLastHeading=0;
let renderDirty=true,lastShadowTime=-Infinity,shadowFrames=0;
const presets={
  hero:{position:[7.5,18.1,21.8],target:[0,.8,0],zoom:1},
  back:{position:[9,14,-22],target:[0,1.1,0],zoom:1},
  top:{position:[.02,32,4.5],target:[0,0,0],zoom:1},
  character:{position:[5,3.5,12.35],target:[2,1,3.35],zoom:8},
  surfer:{position:[5,3.5,12.35],target:[2,1,3.35],zoom:7},
};
const followingActor=()=>surferFollowing?surferRig:characterFollowing?characterController:null;
function getSurferHeading(){
  if(!surferRig)return 0;
  surferRig.root.getWorldQuaternion(surferWorldQ);
  surferForward.set(0,0,1).applyQuaternion(surferWorldQ);surferForward.y=0;
  return surferForward.lengthSq()>.0001?Math.atan2(surferForward.x,surferForward.z):surferLastHeading;
}
function followActorPosition(position,heading){
  const delta=position.clone().sub(characterLastPosition);
  const turn=surferFollowing?Math.atan2(Math.sin(heading-surferLastHeading),Math.cos(heading-surferLastHeading)):0;
  if(transition){
    transition.to.add(delta);transition.targetTo.add(delta);
    if(turn)transition.to.copy(followOffset.subVectors(transition.to,transition.targetTo).applyAxisAngle(followUp,turn).add(transition.targetTo));
  }else{
    camera.position.add(delta);controls.target.add(delta);
    if(turn)camera.position.copy(followOffset.subVectors(camera.position,controls.target).applyAxisAngle(followUp,turn).add(controls.target));
    camera.lookAt(controls.target);
  }
  characterLastPosition.copy(position);if(surferFollowing)surferLastHeading=heading;
}

function setView(name,instant=false){
  const preset=presets[name];if(!preset)return;
  if(pov?.active)pov.exit();
  characterFollowing=name==='character'&&!!characterController;
  surferFollowing=name==='surfer'&&!!surferRig;
  if(followingActor()){
    const p=followingActor().root.position;
    const narrow=viewport.clientWidth<700;characterFocusHeight=narrow?.90:.55;
    preset.target=[p.x,p.y+characterFocusHeight,p.z];
    if(surferFollowing){
      surferLastHeading=getSurferHeading();
      preset.position=[p.x+Math.sin(surferLastHeading)*9,p.y+2.9+characterFocusHeight-.55,p.z+Math.cos(surferLastHeading)*9];
    }else preset.position=[p.x+3,p.y+2.9+characterFocusHeight-.55,p.z+9];
    preset.zoom=Math.min(18,(camera.top-camera.bottom)/(surferFollowing?4.4:narrow?3.4:2.8));
    characterLastPosition.copy(p);
  }
  renderDirty=true;state.view=name;state.autoRotate=false;controls.autoRotate=false;
  $('auto-rotate').setAttribute('aria-pressed','false');
  $('auto-rotate').classList.remove('is-active');
  document.querySelectorAll('[data-view]').forEach(b=>{
    b.setAttribute('aria-pressed',String(b.dataset.view===name));
    b.classList.toggle('is-active',b.dataset.view===name);
  });
  if(instant){
    camera.position.fromArray(preset.position);controls.target.fromArray(preset.target);
    camera.zoom=preset.zoom;camera.updateProjectionMatrix();controls.update();
    transition=null;
  }else transition={
    start:performance.now(),from:camera.position.clone(),to:new THREE.Vector3(...preset.position),
    targetFrom:controls.target.clone(),targetTo:new THREE.Vector3(...preset.target),
    zoomFrom:camera.zoom,zoomTo:preset.zoom,
  };
}
function finishCameraTransition(){
  if(!transition)return;
  camera.position.copy(transition.to);controls.target.copy(transition.targetTo);
  camera.zoom=transition.zoomTo;camera.updateProjectionMatrix();
  transition=null;controls.update();renderDirty=true;
}
function setPlaying(value){
  state.playing=Boolean(value);renderDirty=true;
  ambient?.setPlaying(state.playing);
  $('motion-toggle').setAttribute('aria-pressed',String(state.playing));
  $('motion-toggle').classList.toggle('is-active',state.playing);
  $('motion-label').textContent=state.playing?'小岛生活':'小岛已暂停';
  $('motion-toggle').title=state.playing?'暂停水面和岛上生活':'继续小岛生活';
  updateStatus();
}
function syncWaveButton(){
  const button=$('wave-replay');
  button.hidden=state.sceneMode!=='surf';
  button.disabled=!state.ready||state.sceneMode!=='surf'||!!water?.coastWaveStopping||!!(surfing?.busy&&!water?.coastWaveRunning);
  $('wave-label').textContent=water?.coastWaveStopping?'浪花消退中':water?.coastWaveRunning?'停止浪花':'掀起一个浪';
  button.title=water?.coastWaveRunning?'让浪花继续向前并逐渐消散':'单独掀起一道环岛浪';
  const surfButton=$('surf-start');surfButton.hidden=state.sceneMode!=='surf';
  surfButton.disabled=!state.ready||state.sceneMode!=='surf'||!surfing||(surfing.busy&&!surfing.canCancel)||(!surfing.busy&&!!water?.coastWaveRunning);
  $('surf-label').textContent=surfing?.busy?(surfing.canCancel?'结束冲浪':'正在返回'):water?.coastWaveRunning?'等待浪结束':'开始冲浪';
  surfButton.title=surfing?.busy?'结束这次冲浪并返回岸边':water?.coastWaveRunning?'等待这道浪结束后再开始冲浪':'让冲浪板降落，伙伴从岛上出发冲浪';
}

function startCoastWave(){
  if(!state.ready||state.sceneMode!=='surf'||surfing?.busy||water.coastWaveRunning||!water.startCoastWave(state.elapsed))return false;
  if(!state.playing)setPlaying(true);
  syncWaveButton();
  renderDirty=true;
  return true;
}

function cancelCoastWave(){
  if(!state.ready||state.sceneMode!=='surf'||water.coastWaveStopping)return false;
  const cancelled=surfing?.phase==='riding'&&surfing.canCancel?surfing.cancel(state.elapsed):water.cancelCoastWave(state.elapsed);
  syncWaveButton();renderDirty=true;
  return cancelled;
}

function startSurf(){
  if(!state.ready||state.sceneMode!=='surf'||!surfing||surfing.busy||water.coastWaveRunning)return false;
  if(!surfing.requestStart(state.elapsed))return false;
  if(!state.playing)setPlaying(true);
  syncWaveButton();renderDirty=true;return true;
}
function cancelSurf(){
  if(!state.ready||state.sceneMode!=='surf'||!surfing?.canCancel)return false;
  const result=surfing.cancel(state.elapsed);syncWaveButton();renderDirty=true;return result;
}

function syncSubjects(){
  const select=$('subject-view'),subjects=[{id:'overview',label:'整座小岛 · 自由旋转'},
    ...motion.getViewSubjects(),...(surfing?[{id:'surfer',label:'冲浪伙伴 · 乘浪环岛'}]:[]),{id:'fish',label:'小鱼 · 水下漫游'},{id:'gull',label:'海鸟 · 乘风飞行'}];
  select.replaceChildren(...subjects.map(subject=>{
    const option=document.createElement('option');option.value=subject.id;option.textContent=subject.label;return option;
  }));
  select.value=pov?.subject||'overview';
}

function setSceneMode(next){
  if(!state.ready||!['harbor','surf'].includes(next))return false;
  if(next===state.sceneMode)return true;
  // Restore POV-hidden parts before hiding their entire harbor group.
  if(next==='surf'&&['boat','dockhand'].includes(pov?.subject))pov.exit();
  water.stopCoastWave();
  surfEffects?.reset();
  surfing?.setMode(next,state.elapsed);
  state.sceneMode=next;
  harborRoot.visible=next==='harbor';
  motion.setMode(next);world.setSceneMode(next);
  syncSubjects();syncWaveButton();
  document.querySelectorAll('[data-scene-mode]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.sceneMode===next));
  });
  $('mode-message').textContent=next==='surf'?'已进入冲浪模式，可单独起浪，或点击「开始冲浪」让伙伴出发。':'已回到港口生活，码头和小船已恢复。';
  renderer.shadowMap.needsUpdate=true;renderDirty=true;updateStatus();
  return true;
}

function updateStatus(){
  $('scene-status').textContent=pov?.active?(state.playing?'随它出发 · 拖动环顾四周':'脚步暂歇 · 仍可转头观看'):(state.playing?'轻点水面，涟漪即刻散开':'此刻静止 · 仍可自由旋转');
}
function enterPOV(id){
  if(!state.ready||!pov)return false;
  if(id==='overview'){pov.exit();return true;}
  // A quick second click can arrive before the close-up transition has had a
  // render frame. Save the completed composition, not an off-center halfway view.
  if(!pov.active&&followingActor())finishCameraTransition();
  if(!pov.active){overviewView=state.view;overviewCharacterFollowing=characterFollowing;overviewSurferFollowing=surferFollowing;}
  const wasFollowing=characterFollowing,wasSurferFollowing=surferFollowing;
  characterFollowing=false;surferFollowing=false;
  transition=null;const entered=pov.enter(id);if(entered)resetPOVLook();else {characterFollowing=wasFollowing;surferFollowing=wasSurferFollowing;}return entered;
}
function resetPOVLook(){if(pov?.subject==='gull')pov.setLook(-Math.PI/2,-.72);else pov?.setLook();}
function changePOV(id){
  const active=!!id,isFish=id==='fish';
  surferRig?.setBodyPOV(id==='surfer');
  const restoreActor=overviewSurferFollowing?surferRig:overviewCharacterFollowing?characterController:null;
  if(!active&&restoreActor){
    const position=restoreActor.root.position;
    characterFollowing=overviewCharacterFollowing;surferFollowing=overviewSurferFollowing;
    followActorPosition(position,surferFollowing?getSurferHeading():0);controls.update();
  }
  ambient?.setSubject(id);
  state.view=active?'pov':overviewView;state.autoRotate=active?false:controls.autoRotate;
  underwaterLife?.setViewFish(isFish?POV_FISH_INDEX:null);water?.setUnderwaterView(isFish);
  water?.setImmersiveView(active);world?.setMode(id);
  scene.background=isFish?new THREE.Color('#398c98'):active?new THREE.Color('#bfd9de'):overviewBackground;
  scene.fog=isFish?new THREE.Fog('#398c98',1.4,15):active?new THREE.Fog('#bfd9de',35,92):overviewFog;
  $('subject-view').value=id||'overview';$('pov-actions').hidden=!active;
  $('pov-forward').textContent=id==='gull'?'俯看小岛':'看向前方';
  document.querySelector('.view-controls').hidden=active;
  $('auto-rotate').disabled=active;$('auto-rotate').setAttribute('aria-pressed',String(state.autoRotate));
  $('auto-rotate').classList.toggle('is-active',state.autoRotate);
  document.querySelectorAll('[data-view]').forEach(b=>{b.setAttribute('aria-pressed',String(!active&&b.dataset.view===state.view));b.classList.toggle('is-active',!active&&b.dataset.view===state.view);});
  document.querySelector('.island-viewer').classList.toggle('is-pov',active);
  document.querySelector('.desktop-hint').textContent=active?'按住拖动环顾 · R 恢复视线 · Esc 返回俯瞰':'拖动旋转 · 轻点水面起涟漪 · 滚轮缩放';
  document.querySelector('.touch-hint').textContent=active?'单指滑动环顾 · 它会自己行走':'拖动旋转 · 轻点起涟漪 · 双指缩放';
  renderer.domElement.setAttribute('aria-label',active?'角色第一视角，拖动环顾，不改变角色路线':'可拖动旋转的小岛三维场景');
  viewport.classList.remove('view-changing');void viewport.offsetWidth;viewport.classList.add('view-changing');
  renderer.shadowMap.needsUpdate=true;updateStatus();renderDirty=true;
}
function resize(){
  const w=viewport.clientWidth,h=viewport.clientHeight,aspect=w/h;
  const requested=imageQuality==='ultra'?Math.min(2.5,Math.max(2,devicePixelRatio)):imageQuality==='smooth'?Math.max(1,Math.min(1.25,devicePixelRatio)):Math.min(2,Math.max(1,devicePixelRatio));
  const budget=imageQuality==='ultra'?4200000:imageQuality==='smooth'?1600000:2400000;
  const baseRatio=Math.max(1,Math.min(requested,Math.sqrt(budget/(w*h))));
  const ratio=imageQuality==='auto'?baseRatio*autoScale:baseRatio;
  renderer.setPixelRatio(ratio);renderer.setSize(w,h,false);harborRenderer?.setQuality(imageQuality);renderDirty=true;
  if(sun){
    const shadowSize=imageQuality==='ultra'?2048:imageQuality==='smooth'?1024:1536;
    if(sun.shadow.mapSize.x!==shadowSize){sun.shadow.mapSize.set(shadowSize,shadowSize);sun.shadow.map?.dispose();sun.shadow.map=null;renderer.shadowMap.needsUpdate=true;}
  }
  const width=Math.max(20.5,19.5*aspect),height=width/aspect;
  camera.left=-width/2;camera.right=width/2;camera.top=height/2;camera.bottom=-height/2;
  if(followingActor()){
    const narrow=w<700,focusHeight=narrow?.90:.55,delta=focusHeight-characterFocusHeight;
    characterFocusHeight=focusHeight;
    camera.position.y+=delta;controls.target.y+=delta;
    const zoom=Math.min(18,height/(surferFollowing?4.4:narrow?3.4:2.8));
    if(transition){transition.to.y+=delta;transition.targetTo.y+=delta;transition.zoomTo=zoom;}
    else camera.zoom=zoom;
  }
  camera.updateProjectionMatrix();
  pov?.resize(aspect);
}
function resetFrameWindow(now){
  sampleSeconds=0;sampleFrames=0;lateFrames=0;measureAfter=now+900;
}
function setQuality(name){
  if(!['auto','clear','smooth','ultra'].includes(name))return;
  imageQuality=name;autoScale=1;smoothSeconds=0;allowIncreaseAfter=0;
  $('image-quality').value=name;resetFrameWindow(performance.now());resize();
}
function adaptResolution(now,dt){
  if(imageQuality!=='auto'||!state.playing||now<measureAfter||dt<=0)return;
  sampleSeconds+=dt;sampleFrames++;
  if(dt>.024)lateFrames++;
  if(sampleSeconds<1.8)return;
  const lateShare=lateFrames/sampleFrames;
  const overloaded=lateShare>.18&&sampleSeconds/sampleFrames>.0195;
  smoothSeconds=lateShare<.025?smoothSeconds+sampleSeconds:0;
  sampleSeconds=0;sampleFrames=0;lateFrames=0;
  let next=autoScale;
  if(overloaded&&autoScale>.76){
    next=Math.max(.76,autoScale-.08);allowIncreaseAfter=now+30000;
  }else if(autoScale<1&&smoothSeconds>12&&now>allowIncreaseAfter){
    next=Math.min(1,autoScale+.08);allowIncreaseAfter=now+15000;
  }
  if(next!==autoScale){
    autoScale=Math.round(next*100)/100;smoothSeconds=0;resetFrameWindow(now);resize();
  }
}
function fail(error){
  console.error(error);errors.push(String(error?.stack||error));
  $('loading').hidden=true;$('fatal-error').hidden=false;
  const text=$('fatal-error').querySelector('p:last-child');
  if(text)text.textContent='请刷新重试，并确认浏览器允许 WebGL。详细原因：'+(error?.message||String(error));
  $('scene-status').textContent='场景暂时无法加载';
}

function animateFoam(root){
  const mats=new Map();
  root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    mesh.castShadow=false;mesh.receiveShadow=false;mesh.renderOrder=6;
    const apply=old=>{
      if(mats.has(old))return mats.get(old);
      const mat=new THREE.MeshBasicMaterial({color:0xd9f4eb,vertexColors:true,
        transparent:true,opacity:.76,depthWrite:false,side:THREE.DoubleSide});
      mat.onBeforeCompile=shader=>{
        Object.assign(shader.uniforms,water.shaderUniforms);
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+water.waveGLSL)
          .replace('#include <begin_vertex>','#include <begin_vertex>\n transformed.y=harborWave(position.xz).x+.027;');
      };
      mat.customProgramCacheKey=()=> 'harbor-foam-physics-v2';
      mats.set(old,mat);return mat;
    };
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(apply):apply(mesh.material);
  });
}

function wireControls(){
  ambient=createHarborAudio({onChange(sound){
    const button=$('sound-toggle');
    button.setAttribute('aria-pressed',String(sound.enabled));
    button.setAttribute('aria-label',sound.enabled?'关闭环境声音':'开启环境声音');
    $('sound-label').textContent=sound.loading&&sound.enabled?'准备声音':sound.error?'重试声音':sound.enabled?'关闭声音':'开启声音';
    button.title=sound.error?'声音暂时未加载，点击重试':sound.enabled?'关闭海浪、鸟鸣和远处人声':'开启海浪、鸟鸣和远处人声';
    $('sound-message').textContent=sound.error?'声音暂时未加载，点击重试。':sound.loading&&sound.enabled?'正在准备小岛的声音。':!sound.enabled?'环境声音已关闭。':!sound.playing?'环境声音已随小岛暂停。':'环境声音已开启。';
  }});
  $('sound-toggle').addEventListener('click',()=>ambient.setEnabled(!ambient.diagnostics().enabled));
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('reset-view').addEventListener('click',()=>{setView('hero');});
  $('subject-view').addEventListener('change',e=>enterPOV(e.target.value));
  $('pov-forward').addEventListener('click',resetPOVLook);
  $('pov-exit').addEventListener('click',()=>pov?.exit());
  $('wave-replay').addEventListener('click',()=>water?.coastWaveRunning?cancelCoastWave():startCoastWave());
  $('surf-start').addEventListener('click',()=>surfing?.busy?cancelSurf():startSurf());
  document.querySelectorAll('[data-scene-mode]').forEach(button=>button.addEventListener('click',()=>setSceneMode(button.dataset.sceneMode)));
  $('water-style').addEventListener('change',e=>{water?.setAppearance(e.target.value);renderDirty=true;});
  $('image-quality').addEventListener('change',e=>setQuality(e.target.value));
  $('motion-toggle').addEventListener('click',()=>setPlaying(!state.playing));
  $('auto-rotate').addEventListener('click',()=>{
    transition=null;state.autoRotate=!state.autoRotate;controls.autoRotate=state.autoRotate;
    $('auto-rotate').setAttribute('aria-pressed',String(state.autoRotate));
    $('auto-rotate').classList.toggle('is-active',state.autoRotate);
  });
  $('help-toggle').addEventListener('click',()=>{
    const open=$('help-panel').hidden;$('help-panel').hidden=!open;
    $('help-toggle').setAttribute('aria-expanded',String(open));
  });
  $('fullscreen').addEventListener('click',async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();}
    catch{ $('scene-status').textContent='当前窗口不支持全屏，可直接调整窗口大小'; }
  });
  document.addEventListener('fullscreenchange',()=>{
    $('fullscreen').setAttribute('aria-label',document.fullscreenElement?'退出全屏':'进入全屏');
    resize();
  });
  window.addEventListener('keydown',event=>{
    if(event.defaultPrevented)return;
    if(event.key==='Escape'){
      if(!$('help-panel').hidden){$('help-panel').hidden=true;$('help-toggle').setAttribute('aria-expanded','false');}
      else pov?.exit();return;
    }
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.target instanceof Element&&(event.target.closest('button,input,select,textarea,a[href]')||event.target.isContentEditable))return;
    if(event.code==='Space'){event.preventDefault();if(!event.repeat)setPlaying(!state.playing);}
    if(event.key.toLowerCase()==='r'){if(pov?.active)resetPOVLook();else setView('hero');}
  });
  controls.addEventListener('change',()=>{renderDirty=true;});
  controls.addEventListener('start',()=>{
    if(followingActor())finishCameraTransition();
    manualOrbitUntil=performance.now()+650;
    transition=null;state.view='custom';
    document.querySelectorAll('[data-view]').forEach(b=>{b.setAttribute('aria-pressed','false');b.classList.remove('is-active');});
  });
}

function wireWaterInteraction(){
  const canvas=renderer.domElement,ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  let down=null,lastRipple=0,activePointers=new Set();
  function waterPoint(event,occlusion=false){
    const rect=canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2);
    ray.setFromCamera(pointer,camera);
    plane.normal.set(0,1,0).applyQuaternion(diorama.quaternion);
    plane.constant=-plane.normal.dot(diorama.position);
    const worldPoint=ray.ray.intersectPlane(plane,new THREE.Vector3());
    const point=worldPoint?diorama.worldToLocal(worldPoint.clone()):null;
    if(!point||!water?.isWater(point.x,point.z))return null;
    if(occlusion&&model){
      const hit=ray.intersectObject(model,true).find(({object})=>{
        for(let ancestor=object;ancestor;ancestor=ancestor.parent)if(!ancestor.visible)return false;
        return true;
      });
      if(hit&&hit.distance<ray.ray.origin.distanceTo(worldPoint)-.12)return null;
    }
    return point;
  }
  canvas.addEventListener('pointerdown',event=>{
    if(pov?.active){down=null;activePointers.clear();return;}
    activePointers.add(event.pointerId);
    if(event.button===0&&activePointers.size===1)
      down={x:event.clientX,y:event.clientY,id:event.pointerId,moved:false,multi:false};
    else if(down)down.multi=true;
    if(down&&!down.multi&&state.playing){
      const p=waterPoint(event,true);
      if(p){water.poke(p.x,p.z,2.2,.60);interactions.splashes++;renderDirty=true;}
    }
    manualOrbitUntil=performance.now()+650;
  });
  canvas.addEventListener('pointermove',event=>{
    if(pov?.active){down=null;return;}
    if(!down||down.id!==event.pointerId)return;
    manualOrbitUntil=performance.now()+650;
    if(Math.hypot(event.clientX-down.x,event.clientY-down.y)>6)down.moved=true;
    if(state.playing&&down.moved&&!down.multi&&performance.now()-lastRipple>45){
      const p=waterPoint(event);if(p){water.poke(p.x,p.z,.24,.34);lastRipple=performance.now();interactions.splashes++;}
    }
  });
  canvas.addEventListener('pointerup',event=>{
    if(pov?.active){down=null;activePointers.clear();return;}
    activePointers.delete(event.pointerId);
    if(down?.id===event.pointerId)down=null;
  });
  canvas.addEventListener('pointercancel',event=>{activePointers.delete(event.pointerId);down=null;});
}

async function init(){
  renderer=new THREE.WebGLRenderer({antialias:false,alpha:false,powerPreference:'high-performance'});
  renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{throw new Error('水面渲染程序编译失败：'+[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n'));};
  renderer.setPixelRatio(1);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.0;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  // Fixed lighting: reuse the shadow map between 10 Hz updates. Small walking
  // movements remain smooth while static buildings are not redrawn every frame.
  renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
  renderer.domElement.setAttribute('aria-label','可拖动旋转的小岛三维场景');
  renderer.domElement.tabIndex=0;viewport.appendChild(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color('#92b1cc');
  scene.fog=new THREE.Fog('#92b1cc',50,110);
  overviewBackground=scene.background;overviewFog=scene.fog;
  diorama=new THREE.Group();diorama.name='Harbor island';scene.add(diorama);
  camera=new THREE.OrthographicCamera(-10,10,7,-7,.1,150);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.dampingFactor=.07;controls.rotateSpeed=.65;
  controls.zoomSpeed=.8;controls.minZoom=.55;controls.maxZoom=18;
  controls.minPolarAngle=.08;controls.maxPolarAngle=Math.PI*.49;controls.autoRotateSpeed=.55;
  controls.enablePan=true;controls.panSpeed=.5;
  setView('hero',true);resize();
  const env=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(env,.04).texture;scene.environmentIntensity=.22;
  env.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe3edff,0xa48b62,.42));
  sun=new THREE.DirectionalLight(0xffe2b5,3.4);
  sun.position.set(8,10,-1);sun.target.position.set(0,.7,0);
  sun.castShadow=true;sun.shadow.mapSize.set(1536,1536);
  Object.assign(sun.shadow.camera,{left:-12,right:12,top:13,bottom:-12,near:.5,far:42});
  sun.shadow.bias=-.0003;sun.shadow.normalBias=.026;sun.shadow.radius=3;
  scene.add(sun,sun.target);
  const fill=new THREE.DirectionalLight(0xbfdcff,.18);fill.position.set(-6,7,1);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffedcd,.4);rim.position.set(1,9,-6);scene.add(rim);
  stageFloor=new THREE.Mesh(new THREE.PlaneGeometry(180,180),
    new THREE.MeshStandardMaterial({color:'#80a4c2',roughness:1}));
  stageFloor.rotation.x=-Math.PI/2;stageFloor.position.y=-2.69;stageFloor.receiveShadow=true;scene.add(stageFloor);
  wireControls();window.addEventListener('resize',()=>setQuality(imageQuality));
  document.addEventListener('visibilitychange',()=>{lastTime=performance.now();resetFrameWindow(lastTime);});

  const [metaResponse,harborMetaResponse]=await Promise.all([
    fetch('./public/assets/scene-meta-lite.json?v=coast-1'),
    fetch('./public/assets/harbor-mode-meta.json?v=surf-mode-1'),
  ]);
  if(!harborMetaResponse.ok)throw new Error('港口模型信息加载失败，请刷新重试。');
  const useLite=metaResponse.ok;
  meta=useLite?await metaResponse.json():await(await fetch('./public/assets/scene-meta.json?v=coast-1')).json();
  const harborMeta=await harborMetaResponse.json();
  meta={...meta,boat:harborMeta.boat,boatPivot:harborMeta.boatPivot,boatForward:harborMeta.boatForward,boatObstacles:harborMeta.boatObstacles,
    actors:[...(meta.actors||[]),...(harborMeta.actors||[])]};
  water=createHarborWater(THREE,{radius:meta.water?.radius||9,shoreline:meta.shoreline||[],maxHeight:.35,damping:.88});diorama.add(water.group);water.setSkyReflections();
  const draco=new DRACOLoader();draco.setDecoderPath('./vendor/draco/');draco.setWorkerLimit(2);
  const loader=new GLTFLoader();loader.setDRACOLoader(draco);
  const [gltf,harborGltf]=await Promise.all([loader.loadAsync(`./public/assets/${useLite?'harbor-lite':'harbor'}.glb?v=coast-1`,event=>{
    const ratio=event.total?event.loaded/event.total:Math.min(.9,event.loaded/(meta.bytes||9000000));
    $('loading-progress').value=Math.round(ratio*88);
    $('loading-label').textContent=ratio>.98?'正在铺好沙滩、唤醒海浪…':`正在搬来这座小岛 · ${Math.round(ratio*100)}%`;
  }),loader.loadAsync('./public/assets/harbor-mode.glb?v=surf-mode-1')]);
  model=gltf.scene;
  harborRoot=harborGltf.scene;harborRoot.name='HARBOR_MODE';model.add(harborRoot);
  const touched=new Set();
  model.traverse(obj=>{
    if(!obj.isMesh)return;
    const category=obj.userData.category||obj.parent?.name||'';
    obj.castShadow=category!=='CLOUDS'&&category!=='FOAM'&&category!=='SEABED';
    obj.receiveShadow=category!=='CLOUDS'&&category!=='FOAM';
    for(const mat of(Array.isArray(obj.material)?obj.material:[obj.material])){
      if(touched.has(mat))continue;touched.add(mat);
      mat.envMapIntensity=.35;
      // Fine normals and roughness are embedded in the exported GLB.
      if(mat.map)mat.map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      if(mat.normalMap)mat.normalMap.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      if(category==='CLOUDS'){mat.roughness=1;mat.envMapIntensity=.1;}
      if(mat.userData.surfaceKind==='leaf'){mat.side=THREE.DoubleSide;mat.roughness=.76;}
    }
  });
  seabedEdgeInfo=insetHarborSeabedEdge(THREE,{model,radius:water.radius,waterBottom:-water.depth});
  // Keep the dry beach ivory; tint only the underwater bed and its cut edge.
  const bedRoot=model.getObjectByName('SEABED');let bedMesh;
  bedRoot?.traverse(obj=>{
    if(!obj.isMesh)return;
    const bedName=obj.name.replaceAll('_',' ');
    if(/warm white fine coral sand|White sand cut edge/.test(bedName)){
      const edge=/cut edge/.test(bedName);
      obj.material=obj.material.clone();obj.material.color.set('#bcb7a3');
      obj.material.roughness=.96;
      if(!edge)bedMesh=obj;
    }
  });
  diorama.add(model);
  // The visitor is a dynamic island actor, independent of harbor-mode visibility.
  try{
    const character=await loader.loadAsync('./public/assets/tapati-dancer-young-medium.glb?v=bean-smile-2');
    characterController=createHarborCharacter(THREE,character);
    diorama.add(characterController.root);
    characterPreview=characterController.diagnostics();
  }catch(error){
    characterPreview={loaded:false,error:String(error)};
    console.warn('角色预览加载失败',error);
  }
  try{
    const ghoul=await loader.loadAsync('./public/assets/shambling-ghoul-256f2f.glb?v=bean-smile-2');
    surferRig=createSurferRig(THREE,ghoul);
    surfing=createHarborSurfing(THREE,{scene:diorama,model,meta,water,rig:surferRig,mode:state.sceneMode});
    surferPreview={loaded:true,...surferRig.diagnostics()};
  }catch(error){
    surferPreview={loaded:false,error:String(error)};
    console.warn('冲浪伙伴加载失败',error);
  }
  causticInfo=installHarborCaustics(THREE,model,water);
  foam=model.getObjectByName('FOAM');if(foam)animateFoam(foam);
  const surferActor=surferRig?{root:surferRig.root,
    spec:{id:'surfer',label:'冲浪伙伴',forward:[0,0,1],speed:.42,phase:0,contactRadius:.36,skeletal:true,navigationPadding:.53,hideView:true,ignoreLandReservations:true},
    update:({time,moved})=>surferRig.setPose({phase:moved>1e-5?'walk':'idle',time})}:null;
  motion=createHarborMotion(THREE,{model,meta,water,scene:diorama,mode:state.sceneMode,externalActors:[...(characterController?[characterController]:[]),...(surferActor?[surferActor]:[])],reservedLandAreas:surfing?.landReservations||(surfing?[surfing.shoreObstacle]:[])});
  surfing?.bindMotion(motion,'surfer');
  surfEffects=createHarborSurfEffects(THREE,{scene:diorama,water,surfing});
  model.updateMatrixWorld(true);
  const bedRay=new THREE.Raycaster(),bedPoint=new THREE.Vector3(),downward=new THREE.Vector3(0,-1,0);
  const sampleBedHeight=(x,z)=>{if(!bedMesh)return -1.46;bedPoint.set(x,.1,z);bedRay.set(bedPoint,downward);return bedRay.intersectObject(bedMesh,false)[0]?.point.y??-1.46;};
  underwaterLife=createUnderwaterLife(THREE,{scene:diorama,water,shoreline:meta.shoreline||[],sampleBedHeight});
  installHarborCaustics(THREE,underwaterLife.group,water);
  bird=createHarborBird(THREE,diorama);bird.update(0,0);
  const [horizon,horizonBoats]=await Promise.all([
    loader.loadAsync('./public/assets/harbor-horizon.glb?v=coast-1'),
    loader.loadAsync('./public/assets/harbor-horizon-boats.glb?v=surf-mode-1'),
  ]);
  horizon.scene.add(horizonBoats.scene);
  draco.dispose();
  world=createHarborWorld(THREE,{scene,model,stageFloor,horizon:horizon.scene,sampleBedHeight});
  pov=createHarborPOV(THREE,{canvas:renderer.domElement,overview:camera,controls,
    getPose(id){
      if(id==='fish')return underwaterLife.getViewPose(POV_FISH_INDEX);
      if(id==='gull')return bird.getViewPose();
      if(id==='surfer'){
        const pose=surfing?.getViewPose();if(!pose)return null;
        return {...pose,hiddenObjects:[]};
      }
      return motion.getViewPose(id);
    },
    onChange:changePOV,onDirty(){renderDirty=true;}});
  syncSubjects();
  pov.resize(viewport.clientWidth/viewport.clientHeight);
  harborRenderer=createHarborRenderer(THREE,renderer,scene,camera,water,{stageFloor});
  wireWaterInteraction();
  lastAzimuth=controls.getAzimuthalAngle();lastPolar=controls.getPolarAngle();
  $('loading-progress').value=96;
  await renderer.compileAsync(scene,camera);
  harborRenderer.render();
  state.ready=true;$('loading-progress').value=100;$('loading').hidden=true;
  $('subject-view').disabled=false;
  document.querySelectorAll('[data-scene-mode]').forEach(button=>button.disabled=false);
  setPlaying(true);
  syncWaveButton();
  window.dispatchEvent(new Event('harbor-ready'));
  lastTime=performance.now();resetFrameWindow(lastTime);renderer.setAnimationLoop(tick);
}

function tick(now){
  const dt=Math.min(.25,Math.max(0,(now-lastTime)/1000));lastTime=now;
  if(document.hidden)return;
  adaptResolution(now,dt);
  averageFrame=averageFrame*.96+dt*1000*.04;
  if(state.playing)state.elapsed+=dt;
  if(transition){
    const t=Math.min(1,(now-transition.start)/750),s=t*t*(3-2*t);
    camera.position.lerpVectors(transition.from,transition.to,s);
    controls.target.lerpVectors(transition.targetFrom,transition.targetTo,s);
    camera.zoom=THREE.MathUtils.lerp(transition.zoomFrom,transition.zoomTo,s);
    camera.updateProjectionMatrix();
    if(t===1)transition=null;
  }
  if(!pov.active)controls.update(dt);
  const azimuth=controls.getAzimuthalAngle(),polar=controls.getPolarAngle();
  const da=Math.atan2(Math.sin(azimuth-lastAzimuth),Math.cos(azimuth-lastAzimuth)),dp=polar-lastPolar;
  if(!pov.active&&state.playing&&!transition&&now<manualOrbitUntil&&(Math.abs(da)+Math.abs(dp))>.00015){
    water.addSlosh(da*2.8*Math.cos(azimuth)+dp*1.6*Math.sin(azimuth),-da*2.8*Math.sin(azimuth)+dp*1.6*Math.cos(azimuth));interactions.sloshes++;
  }
  lastAzimuth=azimuth;lastPolar=polar;
  const waveWasRunning=water.coastWaveRunning;
  const surfPhase=surfing?.phase;
  if(water.coastWaveStopping||surfing?.settling)renderDirty=true;
  water.update(state.elapsed,state.playing?dt:0,dt);
  surfing?.update(state.playing?dt:0,state.elapsed,dt);
  surfEffects?.update(state.playing?dt:0,state.elapsed,dt);
  if(surfPhase!=='riding'&&surfing?.phase==='riding')ambient?.playSurfCheer?.();
  if(waveWasRunning!==water.coastWaveRunning||surfPhase!==surfing?.phase)syncWaveButton();
  motion?.update(state.playing?dt:0,state.elapsed);
  if(followingActor()&&!pov.active){
    const position=followingActor().root.position;
    followActorPosition(position,surferFollowing?getSurferHeading():0);
  }
  underwaterLife?.update(state.playing?dt:0,state.elapsed);
  bird?.update(state.elapsed,state.playing?dt:0);
  world?.update(state.elapsed);
  pov.update(state.playing||surfing?.settling?dt:0);
  if(state.playing||transition||state.autoRotate||renderDirty){
    if((state.playing||surfing?.settling)&&now-lastShadowTime>=100){renderer.shadowMap.needsUpdate=true;lastShadowTime=now;shadowFrames++;}
    harborRenderer.render(pov.active?pov.camera:camera);state.frames++;renderDirty=false;
  }

}

window.harborViewer={
  get ready(){return state.ready;},
  getState:()=>({...state,camera:camera?.position.toArray(),target:controls?.target.toArray(),
    pov:pov?.diagnostics(),bird:bird?.diagnostics(),world:world?.diagnostics(),
    zoom:camera?.zoom,water:water?.diagnostics(),
    motion:motion?.getDiagnostics(),harborVisible:harborRoot?.visible,
    characterPreview:characterController?.diagnostics()||characterPreview,characterFollowing,
    surfing:surfing?.diagnostics(),surfEffects:surfEffects?.diagnostics(),surferPreview:surferRig?.diagnostics()||surferPreview,surferFollowing,
    appearance:$('water-style')?.value,quality:imageQuality,interactions:{...interactions},
    audio:ambient?.diagnostics(),
    render:renderer?{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      pixelRatio:renderer.getPixelRatio(),autoScale,width:renderer.domElement.width,height:renderer.domElement.height,shadowFrames,shadowUpdateHz:10,shadowMapSize:sun?.shadow.mapSize.x,averageFrameMs:averageFrame}:null,
    optics:harborRenderer?.diagnostics(),
    underwater:underwaterLife?.diagnostics(),seabedTone:'warm gray beige',seabedEdge:seabedEdgeInfo,
    asset:meta?{triangles:meta.triangles,bytes:meta.bytes,clouds:meta.clouds?.length}:null,
    errors:[...errors]}),
  setView, setPlaying,setSceneMode,enterPOV,exitPOV(){pov?.exit();},setLook(yaw,pitch){pov?.setLook(yaw,pitch);},
  setAppearance(name){$('water-style').value=name;water?.setAppearance(name);renderDirty=true;},
  setQuality,
  setOpticalSamples(value){harborRenderer?.setSamples(value);renderDirty=true;},
  setOptics(value){harborRenderer?.setEnabled(value);renderDirty=true;},
  splash(x,z,strength=2.2){renderDirty=true;return water?.poke(x,z,strength,.60);},
  startCoastWave,cancelCoastWave,startSurf,cancelSurf,
  slosh(x,z){return water?.addSlosh(x,z);},
  projectPoint(x,y,z){const p=new THREE.Vector3(x,y,z).applyMatrix4(diorama.matrixWorld).project(pov?.active?pov.camera:camera);const r=renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};},
  setTime(seconds){state.elapsed=seconds;water?.update(seconds);syncWaveButton();renderDirty=true;},
};
window.addEventListener('error',event=>errors.push(event.message));
init().catch(fail);
