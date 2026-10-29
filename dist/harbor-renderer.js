/** Render the solid scene once, then reuse its linear color and depth for water. */
export function createHarborRenderer(THREE, renderer, scene, camera, water) {
  const SOLID = 1, OVERLAY = 2;
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
  let enabled = true, frames = 0, solidObjects = 0, overlayObjects = 0;
  // Layers do not alter the model's original visibility, materials or hierarchy.
  scene.traverse(obj => {
    if(obj.isLight) {obj.layers.enable(SOLID);obj.layers.enable(OVERLAY);}
    if(!obj.isMesh && !obj.isPoints && !obj.isLine) return;
    const mats=Array.isArray(obj.material)?obj.material:[obj.material];
    const overlay=obj.userData.harborWater || mats.some(m=>m?.transparent);
    obj.layers.enable(overlay?OVERLAY:SOLID);
    if(overlay)overlayObjects++;else solidObjects++;
  });
  renderer.info.autoReset = false;
  function sync() {
    renderer.getDrawingBufferSize(size);
    if(target.width!==size.x || target.height!==size.y) target.setSize(size.x,size.y);
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
    render(){
      renderer.info.reset();
      if(!enabled){water.setOpticalScene(null);renderer.render(scene,camera);return;}
      sync();
      const mask=camera.layers.mask,background=scene.background,autoClear=renderer.autoClear;
      const previous=renderer.getRenderTarget();
      try {
        camera.layers.set(SOLID);renderer.autoClear=true;
        renderer.setRenderTarget(target);renderer.render(scene,camera);
        renderer.setRenderTarget(previous);renderer.render(copyScene,copyCamera);
        // The copy pass wrote the scene's depth, so the island still occludes water.
        camera.layers.set(OVERLAY);scene.background=null;renderer.autoClear=false;
        renderer.render(scene,camera);frames++;
      } finally {
        camera.layers.mask=mask;scene.background=background;renderer.autoClear=autoClear;
        renderer.setRenderTarget(previous);
      }
    },
    setEnabled(value){enabled=!!value;if(!enabled)water.setOpticalScene(null);},
    setSamples(count){const next=Math.min(renderer.capabilities.maxSamples,Math.max(0,count));if(target.samples!==next){target.dispose();target.samples=next;}material.uniforms.edgeAA.value=next===0?1:0;},
    setQuality(name){this.setSamples(name==='ultra'?2:0);},
    diagnostics(){return {enabled,technique:'one scene capture with color and depth resolve',width:target.width,height:target.height,samples:target.samples,frames,solidObjects,overlayObjects};},
    dispose(){water.setOpticalScene(null);target.dispose();triangle.dispose();material.dispose();},
  };
}
