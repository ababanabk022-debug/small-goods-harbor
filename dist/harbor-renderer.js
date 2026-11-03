/** Render the solid scene once, then reuse its linear color and depth for water. */
export function createHarborRenderer(THREE, renderer, scene, camera, water, {stageFloor} = {}) {
  const SOLID = 1, OVERLAY = 2, STATIC = 3, LIVE = 4;
  const size = new THREE.Vector2();
  const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  depth.minFilter = depth.magFilter = THREE.NearestFilter;
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: false, depthBuffer: true, stencilBuffer: false,
    samples: 0, depthTexture: depth,
  });
  target.texture.name = 'Harbor · linear scene for refraction';
  const copyScene = new THREE.Scene();
  const copyCamera = new THREE.Camera();
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0],3));
  const material = new THREE.ShaderMaterial({
    name: 'Harbor · color and depth resolve',
    uniforms: { sceneColor: {value: target.texture}, sceneDepth: {value: depth}, texel: {value:new THREE.Vector2(1,1)}, edgeAA:{value:1} },
    depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth,
    blending: THREE.NoBlending,
    vertexShader: 'varying vec2 vUv; void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position,1.0);}',
    fragmentShader: `
      uniform sampler2D sceneColor;
      uniform sampler2D sceneDepth;
      uniform vec2 texel;
      uniform float edgeAA;
      varying vec2 vUv;
      float harborLuminance(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
      void main(){
        vec4 center=texture2D(sceneColor,vUv);
        if(edgeAA>.5){
          // Only smooth high-contrast subpixel edges; leave flat regions and fine
          // sand texture unchanged. This avoids a costly multisample depth resolve.
          vec3 left=texture2D(sceneColor,vUv-vec2(texel.x*.5,0.)).rgb;
          vec3 right=texture2D(sceneColor,vUv+vec2(texel.x*.5,0.)).rgb;
          vec3 up=texture2D(sceneColor,vUv+vec2(0.,texel.y*.5)).rgb;
          vec3 down=texture2D(sceneColor,vUv-vec2(0.,texel.y*.5)).rgb;
          float lo=min(harborLuminance(center.rgb),min(min(harborLuminance(left),harborLuminance(right)),min(harborLuminance(up),harborLuminance(down))));
          float hi=max(harborLuminance(center.rgb),max(max(harborLuminance(left),harborLuminance(right)),max(harborLuminance(up),harborLuminance(down))));
          float blend=smoothstep(.10,.35,(hi-lo)/max(.12,hi))*.6;
          center.rgb=mix(center.rgb,(left+right+up+down)*.25,blend);
        }
        gl_FragColor=center;
        gl_FragDepth=texture2D(sceneDepth,vUv).r;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const quad = new THREE.Mesh(triangle, material); quad.frustumCulled = false; copyScene.add(quad);
  const staticTarget = target.clone();
  staticTarget.texture.name = 'Harbor · fixed overview color';
  staticTarget.depthTexture.name = 'Harbor · fixed overview depth';
  const seedMaterial = new THREE.ShaderMaterial({
    name: 'Harbor · exact linear color and depth copy',
    uniforms: { colorSource: {value:staticTarget.texture}, depthSource: {value:staticTarget.depthTexture} },
    toneMapped:false, depthTest:true, depthFunc:THREE.AlwaysDepth, depthWrite:true, blending:THREE.NoBlending,
    vertexShader:'void main(){gl_Position=vec4(position,1.0);}',
    fragmentShader:`uniform highp sampler2D colorSource, depthSource;
      void main(){ivec2 p=ivec2(gl_FragCoord.xy);
        gl_FragColor=texelFetch(colorSource,p,0);gl_FragDepth=texelFetch(depthSource,p,0).r;}`,
  });
  const seedScene = new THREE.Scene(), seedQuad = new THREE.Mesh(triangle,seedMaterial);
  seedQuad.frustumCulled=false;seedScene.add(seedQuad);
  const fixedRoots = new Set(['STATIC','CLOUDS','SEABED'].map(name=>scene.getObjectByName(name)).filter(Boolean));
  if(stageFloor)fixedRoots.add(stageFloor);
  const watchedNodes = new Map(), lightShadows = [], splitLayers = [];
  let cachedObjects=0, cachedTriangles=0, cacheEnabled=true, cacheValid=false;
  let cacheHits=0, cacheBuilds=0, fullCaptures=0, previousCamera=null;
  const previousView=new THREE.Matrix4(), previousProjection=new THREE.Matrix4();
  const viewport=new THREE.Vector4(), previousViewport=new THREE.Vector4();
  let previousShadowsEnabled, previousShadowType;
  function watchAncestors(node){
    for(let parent=node;parent&&!watchedNodes.has(parent);parent=parent.parent)
      watchedNodes.set(parent,{matrix:new THREE.Matrix4()});
  }
  function fixedGeometry(object,materials){
    if(!object.isMesh||object.isSkinnedMesh||object.isInstancedMesh||object.morphTargetInfluences||
      materials.some(m=>m.userData.harborCaustics))return false;
    for(let parent=object;parent;parent=parent.parent)if(fixedRoots.has(parent))return true;
    return false;
  }
  let enabled = true, frames = 0, solidObjects = 0, overlayObjects = 0;
  // Layers do not alter the model's original visibility, materials or hierarchy.
  scene.traverse(obj => {
    if(obj.isLight) {
      for(const layer of [SOLID,OVERLAY,STATIC,LIVE])obj.layers.enable(layer);
      splitLayers.push({node:obj,mask:(1<<STATIC)|(1<<LIVE)});
      watchAncestors(obj);
      if(obj.target)watchAncestors(obj.target);
      if(obj.shadow)lightShadows.push({light:obj});
    }
    if(!obj.isMesh && !obj.isPoints && !obj.isLine) return;
    const mats=Array.isArray(obj.material)?obj.material:[obj.material];
    const overlay=obj.userData.harborWater || mats.some(m=>m?.transparent);
    obj.layers.enable(overlay?OVERLAY:SOLID);
    if(overlay){overlayObjects++;return;}
    solidObjects++;
    if(fixedGeometry(obj,mats)){
      obj.layers.enable(STATIC);watchAncestors(obj);cachedObjects++;
      cachedTriangles+=(obj.geometry.index||obj.geometry.attributes.position).count/3;
      splitLayers.push({node:obj,mask:1<<STATIC});
    }else{
      obj.layers.enable(LIVE);splitLayers.push({node:obj,mask:1<<LIVE});
    }
  });
  renderer.info.autoReset = false;
  function fixedSceneChanged(){
    let changed=previousShadowsEnabled!==renderer.shadowMap.enabled||previousShadowType!==renderer.shadowMap.type;
    previousShadowsEnabled=renderer.shadowMap.enabled;previousShadowType=renderer.shadowMap.type;
    // SOLID stays authoritative even if a caller hides an object by layer.
    for(const {node,mask} of splitLayers){
      if(node.layers.isEnabled(SOLID))node.layers.mask|=mask;else node.layers.mask&=~mask;
    }
    for(const entry of lightShadows){
      const {light}=entry;
      if(entry.map!==light.shadow.map){entry.map=light.shadow.map;changed=true;}
    }
    for(const [node,entry] of watchedNodes){
      if(node.matrixAutoUpdate)node.updateMatrix();
      if(entry.visible!==node.visible||entry.layers!==node.layers.mask||
          entry.cast!==node.castShadow||entry.receive!==node.receiveShadow||!entry.matrix.equals(node.matrix)){
        entry.visible=node.visible;entry.layers=node.layers.mask;entry.cast=node.castShadow;
        entry.receive=node.receiveShadow;entry.matrix.copy(node.matrix);changed=true;
      }
    }
    return changed;
  }
  function canCache(activeCamera,previousTarget){
    renderer.getViewport(viewport);
    const steady=previousCamera===activeCamera&&previousView.equals(activeCamera.matrixWorld)&&
      previousProjection.equals(activeCamera.projectionMatrix)&&previousViewport.equals(viewport);
    previousCamera=activeCamera;previousView.copy(activeCamera.matrixWorld);
    previousProjection.copy(activeCamera.projectionMatrix);previousViewport.copy(viewport);
    return cacheEnabled&&cachedObjects>0&&steady&&activeCamera===camera&&activeCamera.isOrthographicCamera&&
      target.samples===0&&previousTarget===null&&!renderer.getScissorTest()&&
      !(renderer.shadowMap.enabled&&(renderer.shadowMap.needsUpdate||renderer.shadowMap.autoUpdate));
  }
  function sync(camera) {
    renderer.getDrawingBufferSize(size);
    if(target.width!==size.x || target.height!==size.y){
      target.setSize(size.x,size.y);cacheValid=false;
    }
    material.uniforms.texel.value.set(1/size.x,1/size.y);
    camera.updateMatrixWorld();
    water.setOpticalScene({
      colorTexture:target.texture,depthTexture:depth,width:size.x,height:size.y,
      near:camera.near,far:camera.far,projectionMatrix:camera.projectionMatrix,
      inverseProjectionMatrix:camera.projectionMatrixInverse,
      viewMatrix:camera.matrixWorldInverse,inverseViewMatrix:camera.matrixWorld,
    });
  }
  return {
    render(activeCamera=camera){
      const camera=activeCamera;
      renderer.info.reset();
      if(!enabled){water.setOpticalScene(null);renderer.render(scene,camera);return;}
      sync(camera);
      const mask=camera.layers.mask,background=scene.background,autoClear=renderer.autoClear;
      const previous=renderer.getRenderTarget();
      try {
        renderer.autoClear=true;
        if(canCache(camera,previous)){
          if(fixedSceneChanged())cacheValid=false;
          if(!cacheValid){
            staticTarget.setSize(size.x,size.y);
            camera.layers.set(STATIC);renderer.setRenderTarget(staticTarget);renderer.render(scene,camera);
            cacheValid=true;cacheBuilds++;
          }else cacheHits++;
          // The live target gets a fresh exact copy every frame. No actor, fish or
          // moving caustic can ever get written back into the static textures.
          renderer.setRenderTarget(target);renderer.autoClear=false;renderer.render(seedScene,copyCamera);
          scene.background=null;camera.layers.set(LIVE);renderer.render(scene,camera);
          scene.background=background;renderer.autoClear=true;
        }else{
          // Three filters shadow casters by the active view-camera layers.
          // Every requested shadow refresh must see the full original solid layer.
          cacheValid=false;fullCaptures++;camera.layers.set(SOLID);
          renderer.setRenderTarget(target);renderer.render(scene,camera);
        }
        renderer.setRenderTarget(previous);renderer.render(copyScene,copyCamera);
        // The copy pass wrote the scene's depth, so the island still occludes water.
        camera.layers.set(OVERLAY);scene.background=null;renderer.autoClear=false;
        renderer.render(scene,camera);frames++;
      } finally {
        camera.layers.mask=mask;scene.background=background;renderer.autoClear=autoClear;
        renderer.setRenderTarget(previous);
      }
    },
    setEnabled(value){enabled=!!value;cacheValid=false;previousCamera=null;if(!enabled)water.setOpticalScene(null);},
    setStaticCache(value){cacheEnabled=!!value;cacheValid=false;previousCamera=null;},
    setSamples(count){const next=Math.min(renderer.capabilities.maxSamples,Math.max(0,count));if(target.samples!==next){target.dispose();target.samples=next;cacheValid=false;}material.uniforms.edgeAA.value=next===0?1:0;},
    setQuality(name){this.setSamples(name==='ultra'?2:0);},
    diagnostics(){return {enabled,technique:'one scene capture with color and depth resolve',width:target.width,height:target.height,samples:target.samples,frames,solidObjects,overlayObjects,cacheEnabled,cachedObjects,cachedTriangles,cacheHits,cacheBuilds,fullCaptures};},
    dispose(){water.setOpticalScene(null);target.dispose();staticTarget.dispose();triangle.dispose();material.dispose();seedMaterial.dispose();},
  };
}
