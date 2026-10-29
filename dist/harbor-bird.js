/** Autonomous gull. Its flight path is independent of the observer's camera. */
export function createHarborBird(THREE,scene){
  const TAU=Math.PI*2,period=48,angularSpeed=TAU/period;
  const group=new THREE.Group();group.name='Harbor · flying gull';scene.add(group);
  const body=new THREE.Group();body.name='Gull · banking body';group.add(body);
  const white=new THREE.MeshStandardMaterial({color:'#f3f1df',roughness:.86,side:THREE.DoubleSide});
  const gray=new THREE.MeshStandardMaterial({color:'#a3acb4',roughness:.88,side:THREE.DoubleSide});
  const charcoal=new THREE.MeshStandardMaterial({color:'#333c47',roughness:.9,side:THREE.DoubleSide});
  const ochre=new THREE.MeshStandardMaterial({color:'#d9a34c',roughness:.82});
  const geometries=new Set(),materials=[white,gray,charcoal,ochre];
  const sphere=new THREE.SphereGeometry(1,12,8);geometries.add(sphere);
  function ellipsoid(name,material,position,scale){
    const mesh=new THREE.Mesh(sphere,material);mesh.name=name;mesh.position.set(...position);mesh.scale.set(...scale);mesh.castShadow=true;body.add(mesh);return mesh;
  }
  ellipsoid('Gull · breast',white,[0,0,0],[.095,.085,.22]);
  ellipsoid('Gull · head',white,[0,.065,-.215],[.073,.073,.088]);
  ellipsoid('Gull · left eye',charcoal,[-.061,.086,-.246],[.009,.01,.009]);
  ellipsoid('Gull · right eye',charcoal,[.061,.086,-.246],[.009,.01,.009]);
  const beakGeometry=new THREE.ConeGeometry(.026,.115,6);beakGeometry.rotateX(-Math.PI/2);geometries.add(beakGeometry);
  const beak=new THREE.Mesh(beakGeometry,ochre);beak.name='Gull · ochre beak';beak.position.set(0,.05,-.335);body.add(beak);
  function surface(name,points,indices,material,parent){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));
    geometry.setIndex(indices);geometry.computeVertexNormals();geometries.add(geometry);
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.castShadow=true;parent.add(mesh);return mesh;
  }
  const wings=[];
  for(const side of [-1,1]){
    const wing=new THREE.Group();wing.name=side<0?'Gull · left wing':'Gull · right wing';wing.position.set(side*.06,.025,-.025);body.add(wing);
    const mirror=points=>points.map(([x,y,z])=>[x*side,y,z]);
    surface('Gull · swept gray wing',mirror([[0,0,-.09],[.19,.025,-.14],[.39,0,-.04],[.49,-.015,.12],[.29,-.015,.16],[.1,-.018,.12],[0,-.01,.10]]),[0,1,5,1,2,4,1,4,5,2,3,4,0,5,6],gray,wing);
    surface('Gull · dark primary feathers',mirror([[.36,.001,-.055],[.49,-.014,.12],[.45,-.016,.17],[.40,-.014,.14],[.35,-.01,.17],[.29,-.014,.16]]),[0,1,3,1,2,3,0,3,5,3,4,5],charcoal,wing);
    wings.push({object:wing,side});
  }
  surface('Gull · fan tail',[[-.055,0,.13],[.055,0,.13],[.10,-.015,.33],[0,-.01,.30],[-.10,-.015,.33]],[0,1,3,1,2,3,0,3,4],white,body);
  const forward=new THREE.Vector3(),lookTarget=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),basis=new THREE.Matrix4();
  const eyeLocal=new THREE.Vector3(0,.09,-.42);
  let elapsed=0,lastTime=0,travel=0,initialized=false,wingAngle=0;
  const previous=new THREE.Vector3();
  function update(time,dt){
    if(!Number.isFinite(time))time=lastTime+Math.max(0,Number.isFinite(dt)?dt:0);
    elapsed=time;lastTime=time;
    const phase=time*angularSpeed+.72;
    // The outer flight ring clears all authored buildings (<5.5 high) and
    // stays outside the central cloud. Lower clouds lie inside this ring.
    group.position.set(6.35*Math.cos(phase),6.35+.25*Math.sin(phase*2),5.95*Math.sin(phase));
    forward.set(-6.35*Math.sin(phase),.5*Math.cos(phase*2),5.95*Math.cos(phase)).normalize();
    lookTarget.copy(group.position).add(forward);basis.lookAt(group.position,lookTarget,up);group.quaternion.setFromRotationMatrix(basis);
    // Slow banking and brief flapping bouts alternate with extended glides.
    body.rotation.z=-.13+.025*Math.sin(phase*2);
    const cycle=((time%8)+8)%8,flapping=cycle<2.4?Math.sin(Math.PI*cycle/2.4)**2:0;
    wingAngle=.06+Math.sin(time*TAU*2.1)*.38*flapping;
    for(const wing of wings)wing.object.rotation.z=wing.side*wingAngle;
    if(initialized&&dt>0)travel+=group.position.distanceTo(previous);
    previous.copy(group.position);initialized=true;
    group.updateMatrixWorld(true);
  }
  function getViewPose(){
    group.updateWorldMatrix(true,false);
    return {position:eyeLocal.clone().applyMatrix4(group.matrixWorld),quaternion:group.getWorldQuaternion(new THREE.Quaternion()),hiddenObjects:[group]};
  }
  update(0,0);
  return {
    update,getViewPose,
    diagnostics:()=>({id:'gull',period,time:elapsed,position:group.position.toArray(),forward:forward.toArray(),distance:travel,wingAngle,altitudeRange:[6.1,6.6]}),
    dispose(){scene.remove(group);for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();},
  };
}
