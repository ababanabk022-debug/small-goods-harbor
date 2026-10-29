const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function inside(x,z,polygon){let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function segmentDistance(x,z,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);return Math.hypot(x-a.x-dx*t,z-a.z-dz*t);}

/** One-time triangle rasterization; walking never raycasts the detailed scene. */
export function createLandNavigator(THREE,{model,boundary=[]}){
  const cell=.18,padding=.20,meshes=[];let ground=null;
  model.updateMatrixWorld(true);
  const root=model.getObjectByName('STATIC');
  (root||model).traverse(o=>{if(!o.isMesh||!o.geometry?.attributes.position)return;if(/fine[ _]+even[ _]+ivory[ _]+beach[ _]+sand/i.test(o.name))ground=o;else meshes.push(o);});
  if(!ground)return null;
  const box=new THREE.Box3().setFromObject(ground),minX=box.min.x,minZ=box.min.z;
  const width=Math.ceil((box.max.x-minX)/cell)+1,depth=Math.ceil((box.max.z-minZ)/cell)+1,size=width*depth;
  const heights=new Float32Array(size).fill(-Infinity),blocked=new Uint8Array(size),safe=new Uint8Array(size);
  const va=new THREE.Vector3(),vb=new THREE.Vector3(),vc=new THREE.Vector3();
  const point=i=>[minX+(i%width)*cell,minZ+Math.floor(i/width)*cell];
  function raster(mesh,terrain){
    const pos=mesh.geometry.attributes.position,index=mesh.geometry.index,count=index?index.count:pos.count;
    for(let k=0;k<count;k+=3){
      va.fromBufferAttribute(pos,index?index.getX(k):k).applyMatrix4(mesh.matrixWorld);
      vb.fromBufferAttribute(pos,index?index.getX(k+1):k+1).applyMatrix4(mesh.matrixWorld);
      vc.fromBufferAttribute(pos,index?index.getX(k+2):k+2).applyMatrix4(mesh.matrixWorld);
      const lo=Math.min(va.y,vb.y,vc.y),hi=Math.max(va.y,vb.y,vc.y);
      if(!terrain&&(hi<.66||lo>1.65))continue;
      const margin=terrain?0:cell*.72;
      const x0=clamp(Math.floor((Math.min(va.x,vb.x,vc.x)-margin-minX)/cell),0,width-1),x1=clamp(Math.ceil((Math.max(va.x,vb.x,vc.x)+margin-minX)/cell),0,width-1);
      const z0=clamp(Math.floor((Math.min(va.z,vb.z,vc.z)-margin-minZ)/cell),0,depth-1),z1=clamp(Math.ceil((Math.max(va.z,vb.z,vc.z)+margin-minZ)/cell),0,depth-1);
      const denom=(vb.z-vc.z)*(va.x-vc.x)+(vc.x-vb.x)*(va.z-vc.z);
      for(let iz=z0;iz<=z1;iz++)for(let ix=x0;ix<=x1;ix++){
        const x=minX+ix*cell,z=minZ+iz*cell,i=iz*width+ix;
        const a=denom?((vb.z-vc.z)*(x-vc.x)+(vc.x-vb.x)*(z-vc.z))/denom:-1;
        const b=denom?((vc.z-va.z)*(x-vc.x)+(va.x-vc.x)*(z-vc.z))/denom:-1,c=1-a-b;
        const contained=a>=-.0001&&b>=-.0001&&c>=-.0001;
        if(terrain){if(contained)heights[i]=Math.max(heights[i],a*va.y+b*vb.y+c*vc.y);}
        else if(contained||Math.min(segmentDistance(x,z,va,vb),segmentDistance(x,z,vb,vc),segmentDistance(x,z,vc,va))<margin)blocked[i]=1;
      }
    }
  }
  raster(ground,true);for(const mesh of meshes)raster(mesh,false);
  for(let i=0;i<size;i++){
    if(heights[i]<.50||heights[i]>.69||blocked[i])continue;
    const [x,z]=point(i);if(boundary.length&&!inside(x,z,boundary))continue;
    const ix=i%width,iz=Math.floor(i/width);let clear=true;
    for(let dz=-2;dz<=2&&clear;dz++)for(let dx=-2;dx<=2;dx++){
      if(Math.hypot(dx,dz)*cell>padding+.01)continue;
      const xx=ix+dx,zz=iz+dz,j=zz*width+xx;
      if(xx<0||xx>=width||zz<0||zz>=depth||blocked[j]||heights[j]<.47||Math.abs(heights[j]-heights[i])>.09){clear=false;break;}
    }
    safe[i]=clear?1:0;
  }
  const offsets=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  function adjacent(i){const out=[],x=i%width,z=Math.floor(i/width);for(const[dx,dz]of offsets){const xx=x+dx,zz=z+dz,j=zz*width+xx;if(xx<0||xx>=width||zz<0||zz>=depth||!safe[j])continue;if(dx&&dz&&(!safe[z*width+xx]||!safe[zz*width+x]))continue;out.push(j);}return out;}
  const component=new Int32Array(size).fill(-1),components=[];
  for(let i=0;i<size;i++)if(safe[i]&&component[i]<0){const list=[i],id=components.length;component[i]=id;for(let k=0;k<list.length;k++)for(const j of adjacent(list[k]))if(component[j]<0){component[j]=id;list.push(j);}components.push(list);}
  const largest=components.reduce((best,a)=>a.length>best.length?a:best,[]),mainComponent=largest.length?component[largest[0]]:-1;
  function nearest(x,z){let best=-1,d=Infinity;for(const i of largest){const p=point(i),dd=(p[0]-x)**2+(p[1]-z)**2;if(dd<d){d=dd;best=i;}}return best;}
  function indexAt(x,z){const ix=Math.round((x-minX)/cell),iz=Math.round((z-minZ)/cell);return ix>=0&&ix<width&&iz>=0&&iz<depth?iz*width+ix:-1;}
  function valid(x,z){const i=indexAt(x,z);return i>=0&&!!safe[i]&&component[i]===mainComponent;}
  function line(a,b){const d=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.max(1,Math.ceil(d/(cell*.10)));for(let i=0;i<=steps;i++){const t=i/steps;if(!valid(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t))return false;}return true;}
  let seed=271828;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  function plan(x,z,recent=[]){
    const start=nearest(x,z);if(start<0)return null;
    const parents=new Int32Array(size).fill(-1),queue=[start];parents[start]=start;
    for(let k=0;k<queue.length;k++)for(const j of adjacent(queue[k]))if(parents[j]<0){parents[j]=queue[k];queue.push(j);}
    let target=start,best=-Infinity;
    for(let k=0;k<36;k++){const candidate=queue[Math.floor(random()*queue.length)],p=point(candidate),distance=Math.hypot(p[0]-x,p[1]-z);if(distance<1.6)continue;const novelty=recent.length?Math.min(...recent.map(q=>Math.hypot(q[0]-p[0],q[1]-p[1]))):2;const score=Math.min(distance,4.8)*.6+Math.min(novelty,3)*.8+random();if(score>best){target=candidate;best=score;}}
    const reverse=[target];while(reverse.at(-1)!==start&&reverse.length<size)reverse.push(parents[reverse.at(-1)]);
    const raw=reverse.reverse().map(point),path=[raw[0]];
    for(let i=0;i<raw.length-1;){let next=raw.length-1;while(next>i+1&&!line(raw[i],raw[next]))next--;path.push(raw[next]);i=next;}
    return {path,target:point(target)};
  }
  function height(x,z){const i=indexAt(x,z);return i>=0&&Number.isFinite(heights[i])?heights[i]:.60;}
  const all=largest.map(point);
  return {plan,valid,height,nearest:(x,z)=>{const i=nearest(x,z);return i<0?null:point(i);},random,
    diagnostics:()=>({cell,padding,walkableCells:largest.length,components:components.map(c=>c.length).sort((a,b)=>b-a).slice(0,8),bounds:all.length?{min:[Math.min(...all.map(p=>p[0])),Math.min(...all.map(p=>p[1]))],max:[Math.max(...all.map(p=>p[0])),Math.max(...all.map(p=>p[1]))]}:null}),
    exportGrid:()=>({cell,minX,minZ,width,depth,heights:Array.from(heights),safe:Array.from(safe),component:Array.from(component),mainComponent})};
}
