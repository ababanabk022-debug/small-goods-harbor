/** Gently lay the summit shrub crowns away from the upper stair.
 * The source GLB batches disconnected leaflets by material. A shared bend field
 * keeps adjoining leaflets and twigs together, with their lower roots fixed.
 * This runs once on the loaded instance; the source geometry file is untouched.
 */
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const trail=[[.48,2.497,-3.89],[.30,2.636,-4.05],[.08,2.775,-4.19],[-.16,2.914,-4.27],[-.40,3.108,-4.28],[-.64,3.302,-4.24]];
const lowerBend=[[.83,1.246,-2.27],[.82,1.385,-2.45],[.80,1.524,-2.63],[.77,1.663,-2.81],[.72,1.802,-2.99]];
function nearest(x,z,route=trail){
  let best=null;
  for(let i=1;i<route.length;i++){
    const a=route[i-1],b=route[i],dx=b[0]-a[0],dz=b[2]-a[2];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz)));
    const qx=a[0]+dx*t,qz=a[2]+dz*t,d=Math.hypot(x-qx,z-qz);
    if(!best||d<best.d)best={x:qx,z:qz,y:a[1]+(b[1]-a[1])*t,d};
  }
  return best;
}
export function clearHarborTrail(THREE,model){
  if(model.userData.harborTrailClearance)return model.userData.harborTrailClearance;
  model.updateMatrixWorld(true);
  const report={meshes:0,vertices:0,maxDisplacement:0};
  const point=new THREE.Vector3(),original=new THREE.Vector3(),inverse=new THREE.Matrix4();
  const root=model.getObjectByName('STATIC');
  if(!root)return report;
  root.traverse(mesh=>{
    if(!mesh.isMesh||!/(?:palm[ _]+green|(?:^|[ _|])Twig$)/i.test(mesh.name)||!mesh.geometry?.attributes.position)return;
    const source=mesh.geometry.attributes.position;
    const changed=[];
    // Keep each disconnected blade on one side; a vertex-wise radial push can
    // otherwise stretch a triangle across the path when it straddles its axis.
    const index=mesh.geometry.index,parent=new Int32Array(source.count);
    for(let i=0;i<parent.length;i++)parent[i]=i;
    const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
    const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[a]=b;};
    if(index)for(let i=0;i<index.count;i+=3){join(index.getX(i),index.getX(i+1));join(index.getX(i),index.getX(i+2));}
    else for(let i=0;i<source.count;i+=3){join(i,i+1);join(i,i+2);}
    const groups=new Map();
    for(let i=0;i<source.count;i++){
      point.fromBufferAttribute(source,i).applyMatrix4(mesh.matrixWorld);
      const key=find(i);if(!groups.has(key))groups.set(key,[]);groups.get(key).push([i,point.clone()]);
    }
    for(const points of groups.values()){
      const center=new THREE.Vector3();for(const [,p]of points)center.add(p);center.multiplyScalar(1/points.length);
      const lower=center.x>.35&&center.x<1.45&&center.z> -3.10&&center.z< -2.15;
      if(!lower&&(center.x< -1.25||center.x>1.05||center.z< -5.1||center.z> -3.35))continue;
      let bend=0;
      for(const [,p]of points){
        const q=nearest(p.x,p.z,lower?lowerBend:trail);
        if(q.d<.43&&p.y>q.y+(lower?.30:-.03))bend=Math.max(bend,lower?q.x+.51-p.x:p.z-q.z+.51);
      }
      if(bend<=0)continue;
      for(const [i,p]of points){
        const q=nearest(p.x,p.z,lower?lowerBend:trail),weight=lower?smooth(q.y+.10,q.y+.32,p.y):smooth(q.y-.25,q.y-.04,p.y);
        if(weight<.00001)continue;
        original.copy(p);if(lower)p.x+=bend*weight;else p.z-=bend*weight;
        report.maxDisplacement=Math.max(report.maxDisplacement,p.distanceTo(original));
        changed.push([i,p]);
      }
    }
    if(!changed.length)return;
    mesh.geometry=mesh.geometry.clone();
    const positions=mesh.geometry.attributes.position;
    inverse.copy(mesh.matrixWorld).invert();
    for(const [i,p]of changed){p.applyMatrix4(inverse);positions.setXYZ(i,p.x,p.y,p.z);}
    positions.needsUpdate=true;
    mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
    report.meshes++;report.vertices+=changed.length;
  });
  model.userData.harborTrailClearance=report;
  return report;
}
