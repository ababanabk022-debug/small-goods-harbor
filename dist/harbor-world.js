/** The miniature becomes a continuous seascape only while riding an inhabitant. */
export function createHarborWorld(THREE,{scene,model,stageFloor,horizon,sampleBedHeight}){
  const group=new THREE.Group();group.name='POV · sea beyond the display';group.visible=false;scene.add(group);
  const clock={value:0},skyGeometry=new THREE.SphereGeometry(110,48,24);
  const skyMaterial=new THREE.ShaderMaterial({
    name:'POV · soft maritime sky',side:THREE.BackSide,depthWrite:false,fog:false,
    uniforms:{horizonColor:{value:new THREE.Color('#c6dfe2')},zenithColor:{value:new THREE.Color('#78afd0')},sunColor:{value:new THREE.Color('#fff1d9')}},
    vertexShader:'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`varying vec3 vDirection;uniform vec3 horizonColor;uniform vec3 zenithColor;uniform vec3 sunColor;
      void main(){vec3 d=normalize(vDirection);float h=pow(max(0.0,d.y),.55);
      vec3 color=mix(horizonColor,zenithColor,h);
      float glow=pow(max(0.0,dot(d,normalize(vec3(8.0,10.0,-1.0)))),24.0);
      color=mix(color,sunColor,glow*.23);gl_FragColor=vec4(color,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const sky=new THREE.Mesh(skyGeometry,skyMaterial);sky.name='POV · sky dome';sky.renderOrder=-100;group.add(sky);
  horizon.name='POV · distant islands and clouds';group.add(horizon);
  const boats=[];horizon.traverse(object=>{if(/^HORIZON_BOAT_\d{2}$/.test(object.name))boats.push({object,center:object.position.clone()});});
  boats.sort((a,b)=>a.object.name.localeCompare(b.object.name));
  const wakeGeometry=new THREE.BufferGeometry();
  wakeGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-.65,0,-.10,-3.0,0,-.60,-2.8,0,-.39, -.65,0,.10,-2.8,0,.39,-3.0,0,.60],3));
  wakeGeometry.computeVertexNormals();
  const wakeMaterial=new THREE.MeshBasicMaterial({color:'#d2efdf',transparent:true,opacity:.18,depthWrite:false,side:THREE.DoubleSide});
  const wakes=new THREE.InstancedMesh(wakeGeometry,wakeMaterial,boats.length);wakes.name='POV · distant sailboat wakes';wakes.renderOrder=5;wakes.frustumCulled=false;group.add(wakes);
  const wakeTransform=new THREE.Object3D();
  // Overlap the authored bed by a narrow strip, then descend into the sea.
  // The cutaway layers are hidden, while the original inner bed stays intact.
  const radii=[8.60,8.86,9.1,9.8,11,14,20,30,50,95],segments=192,vertices=[],indices=[];
  const edgeHeights=Array.from({length:segments+1},(_,i)=>{
    const a=i/segments*Math.PI*2;return sampleBedHeight(Math.cos(a)*8.6,Math.sin(a)*8.6)-.035;
  });
  radii.forEach((radius,row)=>{
    for(let i=0;i<=segments;i++){
      const a=i/segments*Math.PI*2,progress=THREE.MathUtils.smoothstep(radius,8.86,30);
      vertices.push(Math.cos(a)*radius,THREE.MathUtils.lerp(edgeHeights[i],-5.5,progress),Math.sin(a)*radius);
      if(row&&i){const k=row*(segments+1)+i;indices.push(k,k-1,k-segments-2,k,k-segments-2,k-segments-1);}
    }
  });
  const bedGeometry=new THREE.BufferGeometry();bedGeometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));bedGeometry.setIndex(indices);bedGeometry.computeVertexNormals();
  const bedMaterial=new THREE.MeshStandardMaterial({color:'#bcb7a3',roughness:.98});
  bedMaterial.onBeforeCompile=shader=>{
    shader.uniforms.worldTime=clock;
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vSeaFloor;').replace('#include <begin_vertex>','#include <begin_vertex>\nvSeaFloor=position;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float worldTime; varying vec3 vSeaFloor;').replace('#include <color_fragment>',`#include <color_fragment>
      float grain=sin(vSeaFloor.x*47.0)*sin(vSeaFloor.z*39.0);
      float ribs=sin(vSeaFloor.x*4.0+sin(vSeaFloor.z*.74)*1.4);
      diffuseColor.rgb*=.97+grain*.018+ribs*.028;
      float lightWave=pow(max(0.0,sin(vSeaFloor.x*2.8+worldTime*.7)*sin(vSeaFloor.z*2.3-worldTime*.4)),8.0);
      diffuseColor.rgb+=vec3(.025,.055,.050)*lightWave*(1.0-smoothstep(11.0,24.0,length(vSeaFloor.xz)));`);
  };
  bedMaterial.customProgramCacheKey=()=> 'harbor-pov-bed-v1';
  const seabed=new THREE.Mesh(bedGeometry,bedMaterial);seabed.name='POV · continuous seabed';seabed.receiveShadow=true;group.add(seabed);
  const cutaway=[];model.traverse(mesh=>{
    const name=mesh.name.replaceAll('_',' ');
    if(mesh.isMesh&&(/STATIC.*Cutaway/.test(name)||/SEABED.*White sand cut edge/.test(name)))cutaway.push(mesh);
  });
  let subject=null,restore=[];
  return {
    group,
    setMode(id){
      if(id&&!subject){restore=[stageFloor,...cutaway].map(object=>[object,object.visible]);for(const [object] of restore)object.visible=false;}
      if(!id&&subject){for(const [object,visible] of restore)object.visible=visible;restore=[];}
      subject=id;group.visible=!!id;sky.visible=id!=='fish';horizon.visible=id!=='fish';wakes.visible=id!=='fish';
    },
    update(time){
      clock.value=time;
      boats.forEach(({object,center},index)=>{
        const phase=time*Math.PI*2/(90+index*20)+index*2.1;
        object.position.set(center.x+Math.cos(phase)*3.2,center.y+Math.sin(time*1.05+index)*.024,center.z+Math.sin(phase)*2);
        object.rotation.set(Math.sin(time*.74+index)*.012,-Math.atan2(2*Math.cos(phase),-3.2*Math.sin(phase)),Math.sin(time*.91+index)*.018);
        wakeTransform.position.copy(object.position);wakeTransform.position.y=.045;wakeTransform.rotation.set(0,object.rotation.y,0);wakeTransform.updateMatrix();wakes.setMatrixAt(index,wakeTransform.matrix);
      });
      if(boats.length)wakes.instanceMatrix.needsUpdate=true;
    },
    diagnostics(){return {active:!!subject,subject,horizonLoaded:!!horizon,cutawayHidden:restore.length,outerRadius:95,skyRadius:110,bedTriangles:indices.length/3,boats:boats.map(({object})=>({name:object.name,position:object.position.toArray()}))};},
    dispose(){this.setMode(null);scene.remove(group);skyGeometry.dispose();skyMaterial.dispose();bedGeometry.dispose();bedMaterial.dispose();wakeGeometry.dispose();wakeMaterial.dispose();horizon.traverse(o=>{if(o.isMesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});},
  };
}
