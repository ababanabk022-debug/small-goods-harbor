/** Mara's out-and-back walk, following the V14.2 stone stair centerline.
 * The sand navigator is still used for the approach and the return home.
 * Heights are Y-up tread tops from the authored model, not a camera animation.
 */
const STAIR_XZ=[[.78,-1.55],[.80,-1.73],[.82,-1.91],[.83,-2.09],[.83,-2.27],
  [.82,-2.45],[.68114,-2.61349],[.65286,-2.78397],[.72,-2.99],[.68,-3.17],[.65,-3.35],
  [.63,-3.53],[.58,-3.71],[.48,-3.89],[.30,-4.05],[.08,-4.19],
  [-.16,-4.27],[-.40,-4.28],[-.67,-4.37]];
const angleDiff=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

export function createHarborHike(THREE,{actor,navigator,model,canMove,obstacles}){
  if(actor.spec.id!=='mara'||!navigator)return null;
  let stairsPresent=false;
  model.traverse(o=>{if(/pale[ _]+weathered[ _]+stair[ _]+stone/i.test(o.name))stairsPresent=true;});
  if(!stairsPresent)return null;
  const portal=navigator.nearest(.14,-.63);if(!portal)return null;
  const home=actor.walkPoint.clone(),entry=new THREE.Vector3(portal[0],navigator.height(...portal),portal[1]);
  const trail=[entry,new THREE.Vector3(.4,.60,-.95),new THREE.Vector3(.62,.60,-1.22),
    ...STAIR_XZ.map(([x,z],i)=>new THREE.Vector3(x,.69+i*.139+(i===17?.055:i===18?.11:0),z))];
  let stage='approaching',path=[],index=0,segmentProgress=0,wait=0,retry=0,cycles=0,traveled=0;
  const summitSeconds=12,restSeconds=8;
  const trailLength=trail.slice(1).reduce((n,p,i)=>n+p.distanceTo(trail[i]),0);
  function begin(next){
    stage=next;path=[];index=0;segmentProgress=0;retry=0;
    if(stage==='ascending'){path=trail;traveled=0;}
    if(stage==='descending'){path=trail.slice().reverse();traveled=0;}
    if(stage==='summit')wait=summitSeconds;
    if(stage==='resting'){wait=restSeconds;cycles++;actor.destinations++;}
  }
  function turn(heading,dt){
    const error=angleDiff(heading,actor.heading);
    actor.heading+=clamp(error*(1-Math.exp(-5*dt)),-Math.PI/3*dt,Math.PI/3*dt);
    return error;
  }
  function advance(dt){
    if(!(dt>0))return 0;
    if(stage==='summit'||stage==='resting'){
      // Stop the feet before turning to the open sea; the POV retains manual look.
      turn(stage==='summit'?1.6:actor.restAngle,dt);
      wait=Math.max(0,wait-dt);
      if(wait===0)begin(stage==='summit'?'descending':'approaching');
      return 0;
    }
    if(retry>0){retry=Math.max(0,retry-dt);return 0;}
    const onSand=stage==='approaching'||stage==='returning';
    if(!path.length){
      const target=stage==='approaching'?entry:home;
      const planned=navigator.planTo(actor.walkPoint.x,actor.walkPoint.z,[target.x,target.z],obstacles());
      if(!planned){retry=.35;return 0;}
      path=planned.path.map(([x,z])=>new THREE.Vector3(x,navigator.height(x,z),z));
      path[0].copy(actor.walkPoint);index=0;segmentProgress=0;
    }
    while(index<path.length&&actor.walkPoint.distanceTo(path[index])<1e-7){index++;segmentProgress=0;}
    if(index>=path.length){
      begin(stage==='approaching'?'ascending':stage==='ascending'?'summit':stage==='descending'?'returning':'resting');
      return 0;
    }
    const target=path[index],dx=target.x-actor.walkPoint.x,dz=target.z-actor.walkPoint.z;
    const error=turn(Math.atan2(dx,dz),dt);
    // Turn in place at a reversal, then ease into the next walking direction.
    const alignment=Math.pow(Math.max(0,Math.cos(error)),2);
    const from=path[Math.max(0,index-1)],length=from.distanceTo(target);
    const remaining=length*(1-segmentProgress),pace=onSand?.28:stage==='descending'?.24:.27;
    const step=Math.min(remaining,pace*dt*alignment);
    if(step<1e-8)return 0;
    const progress=Math.min(1,segmentProgress+step/length),next=from.clone().lerp(target,progress);
    if(!onSand&&Math.abs(target.y-from.y)>.04){
      // Rise before crossing the next riser; stay on the upper tread until
      // passing its edge on the descent. Both ends have zero vertical velocity.
      const lift=target.y>from.y?smooth(0,.46,progress):smooth(.54,1,progress);
      next.y=from.y+(target.y-from.y)*lift;
    }
    if((onSand&&!navigator.valid(next.x,next.z))||!canMove(next.x,next.z,next.y)){
      actor.actorYields++;
      if(onSand){path=[];index=0;segmentProgress=0;retry=.25;}
      return 0;
    }
    const moved=actor.walkPoint.distanceTo(next);
    actor.walkPoint.copy(next);traveled+=step;segmentProgress=progress;
    actor.visitedMin[0]=Math.min(actor.visitedMin[0],next.x);actor.visitedMin[1]=Math.min(actor.visitedMin[1],next.z);
    actor.visitedMax[0]=Math.max(actor.visitedMax[0],next.x);actor.visitedMax[1]=Math.max(actor.visitedMax[1],next.z);
    if(step>=remaining-1e-8){index++;segmentProgress=0;}
    return moved;
  }
  return {advance,get stage(){return stage;},entryClearance:{x:entry.x,z:entry.z,radius:actor.contactRadius+.12},
    diagnostics:()=>({stage,cycles,waitSeconds:wait,summitSeconds,restSeconds,
      progress:stage==='ascending'||stage==='descending'?Math.min(1,traveled/trailLength):null,
      home:home.toArray(),entry:entry.toArray(),summit:trail.at(-1).toArray()})};
}
