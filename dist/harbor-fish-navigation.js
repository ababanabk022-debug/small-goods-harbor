/** Arc-length tables for wide, shore-aware school routes; built once at load. */
export function createFishCruiseRoutes(THREE,{water,sampleBedHeight,schoolCount=3}){
  const TAU=Math.PI*2,radius=water.radius||9.25,margin=.82;
  function safe(x,z,pad=margin){
    if(Math.hypot(x,z)>radius-pad-.10||!water.isWater(x,z))return false;
    for(let i=0;i<16;i++){const a=i*TAU/16;if(!water.isWater(x+Math.cos(a)*pad,z+Math.sin(a)*pad))return false;}
    return true;
  }
  function radiusAt(angle,desired){
    let chosen=null,best=Infinity;
    for(let r=5.5;r<=radius-margin-.14;r+=.045){
      const delta=Math.abs(r-desired);if(delta>=best)continue;
      if(safe(Math.cos(angle)*r,Math.sin(angle)*r)){chosen=r;best=delta;}
    }
    if(chosen===null)throw Error('Cannot place a safe fish cruise route around the island');
    return chosen;
  }
  const routes=[];
  for(let k=0;k<schoolCount;k++){
    const points=[];
    for(let j=0;j<64;j++){
      const angle=j*TAU/64,desired=7.15+k*.27+.25*Math.sin(angle*2+k*1.7)+.14*Math.sin(angle*3-k*.9);
      const r=radiusAt(angle,desired);points.push(new THREE.Vector3(Math.cos(angle)*r,0,Math.sin(angle)*r));
    }
    let curve=new THREE.CatmullRomCurve3(points,true,'centripetal');
    // Check the interpolated path too. A conservative outer route is a fallback
    // for future shoreline edits, never a per-frame raycast or path search.
    let valid=true;
    for(let j=0;j<768;j++){const p=curve.getPoint(j/768);if(!safe(p.x,p.z,.77)){valid=false;break;}}
    if(!valid){
      const outer=radius-margin-.16;
      curve=new THREE.CatmullRomCurve3(Array.from({length:64},(_,j)=>new THREE.Vector3(Math.cos(j*TAU/64)*outer,0,Math.sin(j*TAU/64)*outer)),true,'centripetal');
    }
    const count=768,x=new Float32Array(count+1),z=new Float32Array(count+1),bed=new Float32Array(count+1),distance=new Float32Array(count+1);
    for(let j=0;j<=count;j++){
      const p=curve.getPoint(j/count);if(!safe(p.x,p.z,.76))throw Error('Unsafe fish route interpolation');
      x[j]=p.x;z[j]=p.z;
      if(j%16===0)bed[j]=sampleBedHeight(p.x,p.z);
      if(j)distance[j]=distance[j-1]+Math.hypot(x[j]-x[j-1],z[j]-z[j-1]);
    }
    // The gently undulating sand floor needs only 49 cached height samples per
    // school; interpolate once instead of raycasting hundreds of points/frames.
    for(let j=0;j<count;j++)if(j%16){const a=j-j%16,b=a+16,t=(j-a)/16;bed[j]=bed[a]+(bed[b]-bed[a])*t;}
    const length=distance[count];
    function sample(at,out){
      const d=((at%length)+length)%length;let lo=0,hi=count;
      while(lo+1<hi){const mid=(lo+hi)>>1;if(distance[mid]<=d)lo=mid;else hi=mid;}
      const t=(d-distance[lo])/(distance[hi]-distance[lo]||1);
      out.x=x[lo]+(x[hi]-x[lo])*t;out.z=z[lo]+(z[hi]-z[lo])*t;out.bed=bed[lo]+(bed[hi]-bed[lo])*t;return out;
    }
    routes.push({sample,length,speed:.50+k*.055,direction:k===1?-1:1,offset:length*(.16+k*.32),
      position:{x:0,z:0,bed:-1.46},ahead:{x:0,z:0,bed:-1.46},yaw:0,
      bounds:{min:[Infinity,Infinity],max:[-Infinity,-Infinity]},routeValidated:true});
  }
  return routes;
}
