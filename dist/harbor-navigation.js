/**
 * Boat navigation in the finite lagoon. All coordinates are metres in the
 * browser X/Z plane. Shore and dock clearance are part of the route search.
 */
const TAU=Math.PI*2;
const sq=x=>x*x;
export function pointInPolygon(x,z,polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function segmentDistanceSq(x,z,a,b){
  const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz;
  const t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l)):0;
  return sq(x-a[0]-t*dx)+sq(z-a[1]-t*dz);
}
function polygonDistanceSq(x,z,polygon){
  let d=Infinity;
  for(let i=0;i<polygon.length;i++)d=Math.min(d,segmentDistanceSq(x,z,polygon[i],polygon[(i+1)%polygon.length]));
  return d;
}
class MinHeap{
  constructor(){this.items=[];}
  push(item){const a=this.items;let i=a.length;a.push(item);while(i){let p=(i-1)>>1;if(a[p].f<=item.f)break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.items,first=a[0],last=a.pop();if(a.length){let i=0;while(true){let c=i*2+1;if(c>=a.length)break;if(c+1<a.length&&a[c+1].f<a[c].f)c++;if(a[c].f>=last.f)break;a[i]=a[c];i=c;}a[i]=last;}return first;}
  get length(){return this.items.length;}
}
export function createWaterNavigator({radius=8.5,shoreline=[],obstacles=[],isWater=null,clearance=.77,edgeClearance=1.37,obstacleClearance=1.36,cell=.25}={}){
  const coast=shoreline.filter(p=>Array.isArray(p)&&p.length>=2).map(p=>[Number(p[0]),Number(p[1])]);
  const size=Math.ceil(radius*2/cell)+1,step=radius*2/(size-1),count=size*size;
  const wet=(x,z,margin=0)=>{
    if(x*x+z*z>sq(radius-margin-.025))return false;
    if(coast.length>2&&(pointInPolygon(x,z,coast)||polygonDistanceSq(x,z,coast)<margin*margin))return false;
    for(const obstacle of obstacles){
      if(obstacle.center){
        if(sq(x-obstacle.center[0])+sq(z-obstacle.center[1])<sq((obstacle.radius||0)+margin))return false;
      }else{
        const polygon=obstacle.polygon||obstacle.points;
        if(polygon?.length>2&&(pointInPolygon(x,z,polygon)||polygonDistanceSq(x,z,polygon)<margin*margin))return false;
      }
    }
    if(isWater&&!isWater(x,z))return false;
    if(isWater&&margin>0&&coast.length<3){
      for(let i=0;i<12;i++)if(!isWater(x+Math.cos(i*TAU/12)*margin,z+Math.sin(i*TAU/12)*margin))return false;
    }
    return true;
  };
  const safe=(x,z)=>{
    if(x*x+z*z>sq(radius-edgeClearance)||!wet(x,z,clearance))return false;
    // Fixed docks need enough room for the whole hull to turn at a corner.
    for(const obstacle of obstacles){
      if(obstacle.center){if(sq(x-obstacle.center[0])+sq(z-obstacle.center[1])<sq((obstacle.radius||0)+obstacleClearance))return false;}
      else{const polygon=obstacle.polygon||obstacle.points;if(polygon?.length>2&&polygonDistanceSq(x,z,polygon)<obstacleClearance*obstacleClearance)return false;}
    }
    return true;
  };
  const point=id=>[-radius+(id%size)*step,-radius+Math.floor(id/size)*step];
  const index=(x,z)=>Math.max(0,Math.min(size-1,Math.round((z+radius)/step)))*size+
    Math.max(0,Math.min(size-1,Math.round((x+radius)/step)));
  const free=new Uint8Array(count);
  for(let i=0;i<count;i++){const p=point(i);free[i]=safe(...p)?1:0;}
  function segmentSafe(a,b,spacing=.17){
    const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/spacing));
    for(let i=0;i<=n;i++)if(!safe(a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n))return false;
    return true;
  }
  function nearestSafe(x,z,maxDistance=Infinity){
    let result=null,d2=maxDistance*maxDistance;
    for(let i=0;i<count;i++)if(free[i]){
      const p=point(i),d=sq(p[0]-x)+sq(p[1]-z);
      if(d<d2){d2=d;result=p;}
    }
    return result;
  }
  function closestVisibleNode(p){
    const original=index(...p);
    if(free[original]&&segmentSafe(p,point(original)))return original;
    let best=-1,d2=Infinity;
    const x=original%size,z=Math.floor(original/size);
    for(let dz=-5;dz<=5;dz++)for(let dx=-5;dx<=5;dx++){
      const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=size||nz>=size)continue;
      const id=nz*size+nx;if(!free[id])continue;
      const q=point(id),d=sq(p[0]-q[0])+sq(p[1]-q[1]);
      if(d<d2&&segmentSafe(p,q)){best=id;d2=d;}
    }
    return best;
  }
  function plan(start,end){
    if(!safe(...start)||!safe(...end))return null;
    if(segmentSafe(start,end))return [start.slice(),end.slice()];
    const startId=closestVisibleNode(start),endId=closestVisibleNode(end);
    if(startId<0||endId<0)return null;
    const g=new Float64Array(count);g.fill(Infinity);
    const parent=new Int32Array(count);parent.fill(-1);
    const closed=new Uint8Array(count),open=new MinHeap();
    const ex=endId%size,ez=Math.floor(endId/size);
    g[startId]=0;open.push({id:startId,f:0});
    const dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
    let found=false;
    while(open.length){
      const {id}=open.pop();if(closed[id])continue;
      if(id===endId){found=true;break;}closed[id]=1;
      const x=id%size,z=Math.floor(id/size);
      for(const [dx,dz]of dirs){
        const nx=x+dx,nz=z+dz;if(nx<0||nz<0||nx>=size||nz>=size)continue;
        const ni=nz*size+nx;if(!free[ni]||closed[ni])continue;
        if(dx&&dz&&(!free[z*size+nx]||!free[nz*size+x]))continue;
        const ng=g[id]+(dx&&dz?Math.SQRT2:1);
        if(ng>=g[ni])continue;g[ni]=ng;parent[ni]=id;
        open.push({id:ni,f:ng+Math.hypot(nx-ex,nz-ez)});
      }
    }
    if(!found)return null;
    const raw=[end.slice()];for(let id=endId;id!==-1;id=parent[id])raw.push(point(id));raw.push(start.slice());raw.reverse();
    const simplified=[raw[0]];
    for(let i=0;i<raw.length-1;){
      let j=raw.length-1;while(j>i+1&&!segmentSafe(raw[i],raw[j]))j--;
      simplified.push(raw[j]);i=j;
    }
    return simplified;
  }
  function poseSafe(x,z,heading){
    const fx=Math.sin(heading),fz=Math.cos(heading),rx=fz,rz=-fx;
    // A narrower bow and wider transom match the authored hull.
    for(const [forward,width]of [[-1.12,.53],[-.65,.66],[0,.68],[.65,.55],[1.32,.12]]){
      for(const side of [-1,0,1]){
        if(!wet(x+fx*forward+rx*width*side,z+fz*forward+rz*width*side,.035))return false;
      }
    }
    return true;
  }
  // A whole circuit is validated once, including bow/stern and steering lag.
  // Center padding alone overestimated the beam at the dock and closed the
  // navigable ring even though the tangentially oriented hull fits safely.
  function createPatrolCircuit(direction=-1){
    for(const inset of [1.20,1.25,1.30,1.35]){
      const r=radius-inset;
      let valid=true;
      for(let i=0;i<720&&valid;i++){
        const a=i*TAU/720,x=Math.sin(a)*r,z=Math.cos(a)*r;
        const tangent=a+direction*Math.PI/2;
        valid=safe(x,z)&&[-.40,0,.40].every(lag=>poseSafe(x,z,tangent+lag));
      }
      if(valid){
        const points=Array.from({length:96},(_,i)=>{
          const a=direction*i*TAU/96;return[Math.sin(a)*r,Math.cos(a)*r];
        });
        return {points,radius:r,direction,length:TAU*r,validated:true,steeringMargin:.40};
      }
    }
    return null;
  }
  function patrolPoint(angle){
    for(const reduction of [0,.22,.44,.66,.9,1.2]){
      const r=radius-edgeClearance-.12-reduction,p=[Math.sin(angle)*r,Math.cos(angle)*r];
      if(safe(...p))return p;
    }
    return null;
  }
  return {radius,clearance,safe,wet,poseSafe,segmentSafe,nearestSafe,plan,patrolPoint,createPatrolCircuit,
    diagnostics:()=>({radius,clearance,edgeClearance,gridSize:size,navigableCells:free.reduce((a,b)=>a+b,0),shorelinePoints:coast.length,obstacles:obstacles.length})};
}
