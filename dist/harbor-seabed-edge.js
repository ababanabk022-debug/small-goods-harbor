/**
 * Recess only the underwater cutaway rim. Authored GLB data stays untouched;
 * geometry is cloned once, and lower strata keep their original silhouette.
 */
export function insetHarborSeabedEdge(THREE,{model,radius=9,waterBottom=-1.8}={}){
  if(!model)throw Error('A harbor model is required');
  const inset=.075,limit=radius-inset,restoreBelow=waterBottom-.20,fullInsetAbove=waterBottom-.08;
  const world=new THREE.Vector3(),local=new THREE.Vector3(),inverse=new THREE.Matrix4();
  const result={radius,waterBottom,inset,targetRadius:limit,restoreBelow,fullInsetAbove,targetMeshes:0,changedVertices:0,
    originalUpperMaxRadius:0,upperMaxRadius:0,overlapRemaining:0,lowerVerticesChanged:0,meshes:[]};
  model.updateMatrixWorld(true);
  model.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.geometry?.attributes.position)return;
    const name=mesh.name.replaceAll('_',' ');
    if(!(/STATIC.*Cutaway/.test(name)||/SEABED.*White sand cut edge/.test(name)))return;
    // Repeated initialization is safe: a previously recessed mesh is not cloned again.
    if(mesh.userData.harborInsetEdge){result.meshes.push(mesh.userData.harborInsetEdge);result.targetMeshes++;return;}
    const geometry=mesh.geometry.clone(),pos=geometry.attributes.position;
    inverse.copy(mesh.matrixWorld).invert();
    let changed=0,upperBefore=0,upperAfter=0,remaining=0,lowerChanged=0;
    for(let i=0;i<pos.count;i++){
      world.fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld);
      const r=Math.hypot(world.x,world.z),originalY=world.y;
      if(originalY>=waterBottom-.00001)upperBefore=Math.max(upperBefore,r);
      if(r>limit&&originalY>restoreBelow){
        const t=THREE.MathUtils.clamp((originalY-restoreBelow)/(fullInsetAbove-restoreBelow),0,1),weight=t*t*(3-2*t);
        const next=r-(r-limit)*weight;
        if(r-next>1e-7){world.x*=next/r;world.z*=next/r;local.copy(world).applyMatrix4(inverse);pos.setXYZ(i,local.x,local.y,local.z);changed++;if(originalY<=restoreBelow)lowerChanged++;}
      }
      if(originalY>=waterBottom-.00001){const rr=Math.hypot(world.x,world.z);upperAfter=Math.max(upperAfter,rr);if(rr>radius-.06+1e-5)remaining++;}
    }
    if(changed){pos.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();mesh.geometry=geometry;}
    else geometry.dispose();
    const info={name:mesh.name,vertices:pos.count,changedVertices:changed,originalUpperMaxRadius:upperBefore,upperMaxRadius:upperAfter,overlapRemaining:remaining,lowerVerticesChanged:lowerChanged};
    mesh.userData.harborInsetEdge=info;result.meshes.push(info);result.targetMeshes++;result.changedVertices+=changed;
    result.originalUpperMaxRadius=Math.max(result.originalUpperMaxRadius,upperBefore);result.upperMaxRadius=Math.max(result.upperMaxRadius,upperAfter);result.overlapRemaining+=remaining;result.lowerVerticesChanged+=lowerChanged;
  });
  return result;
}
