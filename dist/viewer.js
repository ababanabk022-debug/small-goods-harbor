import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createHarborWater, installHarborCaustics } from './water.js';

const $=id=>document.getElementById(id);
const viewport=$('viewport'), errors=[];
const state={ready:false,playing:true,elapsed:0,autoRotate:false,view:'hero',frames:0};
let renderer,scene,camera,controls,water,model,boat,boatBase,foam,meta,transition;
let lastTime=performance.now(), lastDiagnostics=0, averageFrame=16, causticInfo;
const presets={
  hero:{position:[5.5,13.3,16],target:[0,1.25,0],zoom:1},
  back:{position:[6,10,-15],target:[0,1.7,0],zoom:1},
  top:{position:[.02,23,4.5],target:[0,0,0],zoom:1},
};

function setView(name,instant=false){
  const preset=presets[name];if(!preset)return;
  state.view=name;state.autoRotate=false;controls.autoRotate=false;
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
function setPlaying(value){
  state.playing=Boolean(value);
  $('motion-toggle').setAttribute('aria-pressed',String(state.playing));
  $('motion-toggle').classList.toggle('is-active',state.playing);
  $('motion-label').textContent=state.playing?'海水流动':'海水已暂停';
  $('motion-toggle').title=state.playing?'暂停水面动画':'继续水面动画';
  $('scene-status').textContent=state.playing?'海风轻拂 · 水面流动中':'此刻静止 · 仍可自由旋转';
}
function resize(){
  const w=viewport.clientWidth,h=viewport.clientHeight,aspect=w/h;
  renderer.setSize(w,h,false);
  const width=Math.max(14.4,14.6*aspect),height=width/aspect;
  camera.left=-width/2;camera.right=width/2;camera.top=height/2;camera.bottom=-height/2;
  camera.updateProjectionMatrix();
}
function fail(error){
  console.error(error);errors.push(String(error?.stack||error));
  $('loading').hidden=true;$('fatal-error').hidden=false;
  const text=$('fatal-error').querySelector('p:last-child');
  if(text)text.textContent='请刷新重试，并确认浏览器允许 WebGL。详细原因：'+(error?.message||String(error));
  $('scene-status').textContent='场景暂时无法加载';
}

// Small procedural details supplement the exported color palette. All patterns
// live in world coordinates and need no remote images or texture downloads.
function addSurfaceDetail(material,kind){
  if(!['wood','sand','rock'].includes(kind))return;
  const previous=material.onBeforeCompile;
  material.onBeforeCompile=(shader,r)=>{
    previous?.(shader,r);
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vHarborDetailP;')
      .replace('#include <project_vertex>','vHarborDetailP=(modelMatrix*vec4(transformed,1.0)).xyz;\n#include <project_vertex>');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vHarborDetailP;
      float harborGrain(vec3 p) { return fract(sin(dot(floor(p),vec3(12.9898,78.233,37.719)))*43758.5453); }
    `).replace('#include <color_fragment>',`#include <color_fragment>
      vec3 hdp=vHarborDetailP;
      ${kind==='wood'?`
        float bands=sin(hdp.x*35.0+sin(hdp.z*9.0)*1.6+hdp.y*6.0);
        float grain=harborGrain(hdp*vec3(95.,8.,95.));
        diffuseColor.rgb*=.92+.07*bands+.12*grain;
      `:kind==='sand'?`
        float grain=harborGrain(hdp*170.0);
        diffuseColor.rgb*=.90+.15*grain;
      `:`
        float mottling=sin(hdp.x*8.3+sin(hdp.z*7.1))*sin(hdp.y*10.2+hdp.z*4.0);
        diffuseColor.rgb*=.96+.08*mottling+.06*harborGrain(hdp*92.);
      `}
    `);
  };
  material.customProgramCacheKey=()=>`harbor-grain-${kind}-v1`;
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
        shader.uniforms.harborTime=water.timeUniform;
        shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
          uniform float harborTime;
          float foamWave(vec2 p,float t){
            return .045*sin(3.396316*dot(p,vec2(.894427191,-.447213595))+.35-t)
              +.027*sin(5.983986*dot(p,vec2(-.287347886,-.957826285))+1.4-2.*t)
              +.014*sin(11.023132*dot(p,vec2(.813733471,-.581238194))-.85-3.*t);
          }
        `).replace('#include <begin_vertex>',`#include <begin_vertex>
          transformed.y+=foamWave(position.xz,harborTime*1.0471975512)-foamWave(position.xz,0.);
        `);
      };
      mat.customProgramCacheKey=()=> 'harbor-foam-wave-v1';
      mats.set(old,mat);return mat;
    };
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(apply):apply(mesh.material);
  });
}

function wireControls(){
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('reset-view').addEventListener('click',()=>setView('hero'));
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
    if(event.target instanceof HTMLInputElement)return;
    if(event.code==='Space'){event.preventDefault();setPlaying(!state.playing);}
    if(event.key.toLowerCase()==='r')setView('hero');
    if(event.key==='Escape'){$('help-panel').hidden=true;$('help-toggle').setAttribute('aria-expanded','false');}
  });
  controls.addEventListener('start',()=>{
    transition=null;state.view='custom';
    document.querySelectorAll('[data-view]').forEach(b=>{b.setAttribute('aria-pressed','false');b.classList.remove('is-active');});
  });
}

async function init(){
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.4));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.0;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-label','可拖动旋转的小岛三维场景');
  renderer.domElement.tabIndex=0;viewport.appendChild(renderer.domElement);
  scene=new THREE.Scene();scene.background=new THREE.Color('#92b1cc');
  scene.fog=new THREE.Fog('#92b1cc',33,85);
  camera=new THREE.OrthographicCamera(-10,10,7,-7,.1,150);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.dampingFactor=.07;controls.rotateSpeed=.65;
  controls.zoomSpeed=.8;controls.minZoom=.55;controls.maxZoom=3;
  controls.minPolarAngle=.08;controls.maxPolarAngle=Math.PI*.49;controls.autoRotateSpeed=.55;
  controls.enablePan=true;controls.panSpeed=.5;
  setView('hero',true);resize();
  const env=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(env,.04).texture;scene.environmentIntensity=.22;
  env.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe3edff,0xa48b62,.42));
  const sun=new THREE.DirectionalLight(0xffe2b5,3.4);
  sun.position.set(8,10,-1);sun.target.position.set(0,.7,0);
  sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-9,right:9,top:10,bottom:-9,near:.5,far:32});
  sun.shadow.bias=-.0003;sun.shadow.normalBias=.026;sun.shadow.radius=3;
  scene.add(sun,sun.target);
  const fill=new THREE.DirectionalLight(0xbfdcff,.18);fill.position.set(-6,7,1);scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffedcd,.4);rim.position.set(1,9,-6);scene.add(rim);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(180,180),
    new THREE.MeshStandardMaterial({color:'#80a4c2',roughness:1}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-1.73;floor.receiveShadow=true;scene.add(floor);
  water=createHarborWater(THREE);scene.add(water.group);
  wireControls();window.addEventListener('resize',resize);
  document.addEventListener('visibilitychange',()=>{lastTime=performance.now();});

  const metaResponse=await fetch('./public/assets/scene-meta-lite.json');
  const useLite=metaResponse.ok;
  meta=useLite?await metaResponse.json():await(await fetch('./public/assets/scene-meta.json')).json();
  const draco=new DRACOLoader();draco.setDecoderPath('./vendor/draco/');draco.setWorkerLimit(2);
  const loader=new GLTFLoader();loader.setDRACOLoader(draco);
  const gltf=await loader.loadAsync(`./public/assets/${useLite?'harbor-lite':'harbor'}.glb`,event=>{
    const ratio=event.total?event.loaded/event.total:Math.min(.9,event.loaded/(meta.bytes||9000000));
    $('loading-progress').value=Math.round(ratio*88);
    $('loading-label').textContent=ratio>.98?'正在铺好沙滩、唤醒海浪…':`正在搬来这座小岛 · ${Math.round(ratio*100)}%`;
  });
  draco.dispose();
  model=gltf.scene;
  const touched=new Set();
  model.traverse(obj=>{
    if(!obj.isMesh)return;
    const category=obj.userData.category||obj.parent?.name||'';
    obj.castShadow=category!=='CLOUDS'&&category!=='FOAM'&&category!=='SEABED';
    obj.receiveShadow=category!=='CLOUDS'&&category!=='FOAM';
    for(const mat of(Array.isArray(obj.material)?obj.material:[obj.material])){
      if(touched.has(mat))continue;touched.add(mat);
      mat.envMapIntensity=.35;
      addSurfaceDetail(mat,mat.userData.surfaceKind);
      if(category==='CLOUDS'){mat.roughness=1;mat.envMapIntensity=.1;}
      if(mat.userData.surfaceKind==='leaf'){mat.side=THREE.DoubleSide;mat.roughness=.76;}
    }
  });
  scene.add(model);
  causticInfo=installHarborCaustics(THREE,model,water);
  boat=model.getObjectByName('BOAT');boatBase=boat?.position.clone();
  foam=model.getObjectByName('FOAM');if(foam)animateFoam(foam);
  $('loading-progress').value=96;
  await renderer.compileAsync(scene,camera);
  renderer.render(scene,camera);
  state.ready=true;$('loading-progress').value=100;$('loading').hidden=true;
  setPlaying(true);
  window.dispatchEvent(new Event('harbor-ready'));
  lastTime=performance.now();renderer.setAnimationLoop(tick);
}

function tick(now){
  const dt=Math.min(.25,Math.max(0,(now-lastTime)/1000));lastTime=now;
  if(document.hidden)return;
  averageFrame=averageFrame*.96+dt*1000*.04;
  if(state.playing)state.elapsed+=dt;
  water.update(state.elapsed);
  if(boat){
    const p=state.elapsed*Math.PI/3;
    boat.position.copy(boatBase);boat.position.y+=.025*Math.sin(p);
    // Blender's local X/Y roll axes are converted to the browser's X/Z axes.
    boat.rotation.set(THREE.MathUtils.degToRad(.7)*Math.sin(p),0,
      -THREE.MathUtils.degToRad(.5)*Math.sin(2*p));
  }
  if(transition){
    const t=Math.min(1,(now-transition.start)/750),s=t*t*(3-2*t);
    camera.position.lerpVectors(transition.from,transition.to,s);
    controls.target.lerpVectors(transition.targetFrom,transition.targetTo,s);
    camera.zoom=THREE.MathUtils.lerp(transition.zoomFrom,transition.zoomTo,s);
    camera.updateProjectionMatrix();
    if(t===1)transition=null;
  }
  controls.update(dt);renderer.render(scene,camera);state.frames++;
  if(now-lastDiagnostics>2000){
    lastDiagnostics=now;
    // Lower only the framebuffer cost on slow devices; the authored scene stays intact.
    if(state.frames>90&&averageFrame>48&&renderer.getPixelRatio()>1){
      renderer.setPixelRatio(1);resize();
    }
  }
}

window.harborViewer={
  get ready(){return state.ready;},
  getState:()=>({...state,camera:camera?.position.toArray(),target:controls?.target.toArray(),
    zoom:camera?.zoom,water:water?.diagnostics(),boatPosition:boat?.position.toArray(),
    render:renderer?{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      pixelRatio:renderer.getPixelRatio(),averageFrameMs:averageFrame}:null,
    asset:meta?{triangles:meta.triangles,bytes:meta.bytes,clouds:meta.clouds?.length}:null,
    errors:[...errors]}),
  setView, setPlaying,
  setTime(seconds){state.elapsed=seconds;water?.update(seconds);},
};
window.addEventListener('error',event=>errors.push(event.message));
init().catch(fail);
