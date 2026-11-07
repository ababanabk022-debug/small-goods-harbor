// Moving coordinates on the water disc. The front travels along the tangent,
// and its tapered wings fill the local stretch from the actual coast to the rim.
const TAU = Math.PI * 2;
const LAP = 16, SETTLE = 1.25, DEFAULT_ANGLE = .70;
const CANCEL_SETTLE = 2.0;
// A tall continuous breaker. Its crest pitches forward in the same surface
// mesh, forming an overhang without a detached shell.
const HEIGHT_SCALE = .75;
const MIN_U = -4.55, MAX_U = 3.0, LEAN = 1.04, LEAN_HEIGHT = 1.5;
const SPILL_SWAY = .056, SPILL_FREQ = 8.2;
const RADIAL_SWAY = .022;
const NX = 224, NY = 192;
const COAST_SAMPLES = 512, INNER_CLEARANCE = .115, RIM_CLEARANCE = .012;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smooth = (lo, hi, x) => {
  const t = clamp((x-lo)/(hi-lo), 0, 1);
  return t*t*(3-2*t);
};

function crestPosition(v){
  return .85*v-.97*v*v+.10*v*v*v+.055*Math.sin(8*v)+.029*Math.sin(18*v)
    +.018*Math.sin(38*v+.8*Math.sin(11*v))+.008*Math.sin(67*v);
}

// The supporting water is one continuous crest, allowing a board to sample
// the same surface that is displayed. A recessed lower face suggests a curl.
function section(u, v) {
  const crest=crestPosition(v);
  const q = u-crest;
  const wing = 1-smooth(v>0 ? .62 : .45, 1, Math.abs(v));
  const width = q < 0 ? 1.29+.16*v : .61+.035*v;
  const ridge = Math.exp(-((q/width)**2));
  const bead = .080*Math.exp(-(((q-.04)/.22)**2))*(.48+.52*Math.cos(22*v+1.1*Math.sin(7*v)));
  // The lower face blends monotonically into the supporting shoulder. An
  // over-deep recess here creates a second bump and a visible crease where
  // the slope meets the curled wall; the overhang comes from horizontal lean.
  const hollow=.12*Math.exp(-(((q-.88)/.41)**2))+.29*Math.exp(-(((q-.57)/.30)**2))*smooth(.20,.36,q);
  const train = .16*Math.exp(-(((q+2.15)/.63)**2))*(.73+.27*Math.cos(v*4.6+q*1.2));
  const crestChop=.026*Math.sin(31*v+1.1*Math.sin(9*v))*Math.exp(-(((q-.01)/.19)**2));
  // A recessed lower front face and low shoulder give the single crest a
  // curling silhouette without creating a second wave or detached mesh.
  // Center the broad shoulder beneath the curved wall rather than ahead of
  // it: its gradient then eases out over the full lower arc, instead of
  // flattening abruptly into a separate low plateau.
  const shoulder=.35*Math.exp(-(((q-.70)/1.0)**2))*smooth(.02,.45,q);
  const shape=Math.max(0,1.91*ridge+bead+crestChop+shoulder-hollow+train);
  const height = HEIGHT_SCALE*wing*shape*smooth(MIN_U, MIN_U+.46, u)*(1-smooth(MAX_U-.27, MAX_U, u));
  return {height, q, wing};
}

function froth(q, v, wing) {
  // Preserve the established spilling rim and lace; no face speckles.
  const scallop=Math.sin(40*v+2*Math.sin(9*v));
  const s=q-.05-.046*scallop;
  const lip=Math.exp(-((s/(.115+.041*(.5+.5*Math.sin(19*v))))**2));
  const x=(s+.14*Math.sin(v*9))*8;
  const y=v*19+.64*Math.sin(q*6+v*7);
  const cells=Math.sin(x+.64*Math.sin(y))*Math.cos(y+.54*Math.sin(x*.8));
  const holes=smooth(.15,.55,cells);
  const lace=1-smooth(.035,.24,Math.abs(cells+.065*Math.sin(y*3+x)));
  const spill=Math.exp(-(((s+.27)/.32)**2))*(.30+.70*(.5+.5*Math.sin(13*v+s*2)));
  const wash=Math.exp(-(((s+.83)/.53)**2))*(.5+.5*Math.cos(11*v+2*s));
  return clamp((lip*(.89-.38*holes)+spill*(.15+.88*lace)+.34*wash*lace)*smooth(.08,.79,wing),0,1);
}

// One reusable half-float patch stores height, both profile derivatives and
// foam coverage. Hardware bilinear filtering works in WebGL2 on both quality
// tiers. Only vertices/fragments in the moving footprint sample the patch.
function bakeProfile(THREE) {
  const data = new Uint16Array(NX*NY*4);
  const half = THREE.DataUtils.toHalfFloat;
  const e = .003;
  for (let j=0; j<NY; j++) for (let i=0; i<NX; i++) {
    const u = MIN_U + (MAX_U-MIN_U)*i/(NX-1), v = -1+2*j/(NY-1);
    const {height,q,wing} = section(u,v);
    const k = 4*(j*NX+i);
    data[k] = half(height);
    data[k+1] = half((section(u+e,v).height-section(u-e,v).height)/(2*e));
    data[k+2] = half((section(u,v+e).height-section(u,v-e).height)/(2*e));
    data[k+3] = half(froth(q,v,wing));
  }
  const texture = new THREE.DataTexture(data, NX, NY, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.name = 'Coast breaker · plunging section and aerated rim';
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export const COAST_GLSL = `
uniform sampler2D harborCoastProfile;
uniform sampler2D harborCoastShore;
uniform vec4 harborCoastFrame;  // center xz, forward tangent xz
uniform vec3 harborCoastBand;   // constant orbit radius, outer span, gain
uniform vec4 harborCoastSpill;  // spill phase, sine, orbit turns, squared reach
vec4 harborBreaker(vec2 p) {
  if (harborCoastBand.z <= 0.0) return vec4(0.0);
  vec2 d = p-harborCoastFrame.xy;
  if (dot(d,d)>harborCoastSpill.w) return vec4(0.0);
  float r=length(p);
  if (r<.01 || r>=harborCoastBand.x+harborCoastBand.y) return vec4(0.0);
  vec2 radial=p/r, tangent=vec2(-radial.y,radial.x);
  float turns=atan(p.y,p.x)/6.28318530718;
  float u=(fract(turns-harborCoastSpill.z+.5)-.5)*6.28318530718*harborCoastBand.x;
  if (u<${MIN_U-.12} || u>${MAX_U+.12}) return vec4(0.0);
  float v=(r-harborCoastBand.x)/harborCoastBand.y;
  vec2 gradV=radial/harborCoastBand.y;
  if (v<0.0) {
    vec2 shore=texture2D(harborCoastShore,vec2(turns+${.5/COAST_SAMPLES},.5)).rg;
    if (r<=shore.x) return vec4(0.0);
    float span=harborCoastBand.x-shore.x;
    float t=(r-harborCoastBand.x)/span;
    // Match the outer wing's slope exactly at the spine even when the inner
    // wing is twice as wide in a bay. The full inner wing still ends at shore.
    float m=span/harborCoastBand.y-1.0, a=1.0+t;
    float dvdt=1.0+m*a*(1.0+3.0*t);
    v=t*(1.0+m*a*a);
    gradV=radial*(dvdt/span)+tangent*(shore.y*t*(dvdt/span-a*a/harborCoastBand.y)/r);
  }
  // Shift the crest gently in and out along its width. The falloff is zero at
  // both shore and rim, so neither edge opens a gap as the breaker travels.
  if(abs(v)<1.0){
    float radialSway=${RADIAL_SWAY}*harborCoastSpill.y;
    gradV*=1.0-2.0*radialSway*v;
    v+=radialSway*(1.0-v*v);
  }
  // The spill runs along the lip as the swell turns. The central crest stays
  // on its track while the white tongues immediately beside it form and fold.
  float spill=v*${SPILL_FREQ}+harborCoastSpill.x;
  u-=${SPILL_SWAY}*(sin(spill)-harborCoastSpill.y);
  if (u<=${MIN_U.toFixed(4)} || u>=${MAX_U.toFixed(4)}) return vec4(0.0);
  vec2 uv=vec2((u+${-MIN_U})/${(MAX_U-MIN_U).toFixed(4)},v*.5+.5);
  uv=(uv*vec2(${NX-1}.0,${NY-1}.0)+.5)/vec2(${NX}.0,${NY}.0);
  vec4 profile=texture2D(harborCoastProfile,uv)*harborCoastBand.z;
  profile.z-=${SPILL_SWAY*SPILL_FREQ}*cos(spill)*profile.y;
  return vec4(profile.x,profile.y*tangent*(harborCoastBand.x/r)+profile.z*gradV,profile.w);
}
vec2 harborBreakerLean(float height) {
  float h=max(0.0,height);
  return ${LEAN/LEAN_HEIGHT}*h*h*harborCoastFrame.zw;
}
// Tangents of the horizontally pitched surface, including background swell.
vec3 harborBreakerNormal(vec3 wave, vec4 breaker) {
  // d(displacement)/d(height), not the displacement at unit height.
  vec2 k=${2*LEAN/LEAN_HEIGHT}*max(0.0,breaker.x)*harborCoastFrame.zw;
  vec3 tx=vec3(1.0+k.x*breaker.y,wave.y,k.y*breaker.y);
  vec3 tz=vec3(k.x*breaker.z,wave.z,1.0+k.y*breaker.z);
  return normalize(cross(tz,tx));
}
`;

export function createCoastWave(THREE, radius, shoreline) {
  const texture = bakeProfile(THREE);
  const coast = new Float32Array(COAST_SAMPLES);
  const coastQuantized = new Float32Array(COAST_SAMPLES);
  // The CPU buoyancy solver reads the very same half-float height texture as
  // the GPU. Near a curled fold tiny precision differences can change which
  // of several roots exists, so an analytic approximation is not sufficient.
  const profileHeight=new Float32Array(NX*NY);
  for(let i=0;i<profileHeight.length;i++)profileHeight[i]=THREE.DataUtils.fromHalfFloat(texture.image.data[i*4]);
  function profileAt(u,v){
    const x=clamp((u-MIN_U)/(MAX_U-MIN_U)*(NX-1),0,NX-1);
    const y=clamp((v*.5+.5)*(NY-1),0,NY-1);
    const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(NX-1,x0+1),y1=Math.min(NY-1,y0+1);
    const fx=x-x0,fy=y-y0;
    const a=profileHeight[y0*NX+x0]*(1-fx)+profileHeight[y0*NX+x1]*fx;
    const b=profileHeight[y1*NX+x0]*(1-fx)+profileHeight[y1*NX+x1]*fx;
    return a*(1-fy)+b*fy;
  }
  const shoreMap = new THREE.DataTexture(new Uint16Array(COAST_SAMPLES*2), COAST_SAMPLES, 1, THREE.RGFormat, THREE.HalfFloatType);
  shoreMap.name='Coast breaker · local shoreline and slope';
  shoreMap.magFilter=shoreMap.minFilter=THREE.LinearFilter;
  shoreMap.wrapS=THREE.RepeatWrapping;
  const frame = new THREE.Vector4(), band = new THREE.Vector3(), spill = new THREE.Vector4();
  let startTime = null, startAngle = DEFAULT_ANGLE, progress = 0, age = 0, running = false;
  let riseSeconds=0;
  let stopping=false,stopAge=0,stopGain=0,stopClock=0,stopOrbitAge=0,stopPhaseAge=0,stopSpeed=1;

  function configure(points) {
    const polygon=(points || []).filter(p=>Number.isFinite(p?.[0])&&Number.isFinite(p?.[1]));
    const raw=new Float32Array(COAST_SAMPLES), step=TAU/COAST_SAMPLES;
    for (let i=0;i<COAST_SAMPLES;i++) {
      const dx=Math.cos(i*step), dz=Math.sin(i*step);
      let outermost=0;
      for (let j=0;j<polygon.length;j++) {
        const a=polygon[j], b=polygon[(j+1)%polygon.length], ex=b[0]-a[0], ez=b[1]-a[1];
        const cross=dx*ez-dz*ex;
        if (Math.abs(cross)<1e-8) continue;
        const s=(a[0]*dz-a[1]*dx)/cross;
        if (s>=0 && s<=1) outermost=Math.max(outermost,(a[0]*ez-a[1]*ex)/cross);
      }
      raw[i]=outermost || radius*.55;
    }
    // Protect sharp promontories between angular samples and the interpolated
    // wet-mask texels. The lower wings can now enter each bay independently.
    const wrap=i=>(i+COAST_SAMPLES)%COAST_SAMPLES;
    for (let i=0;i<COAST_SAMPLES;i++) {
      coast[i]=Math.max(raw[wrap(i-2)],raw[wrap(i-1)],raw[i],raw[wrap(i+1)],raw[wrap(i+2)])+INNER_CLEARANCE;
    }
    for (let i=0;i<COAST_SAMPLES;i++) {
      shoreMap.image.data[i*2]=THREE.DataUtils.toHalfFloat(coast[i]);
      shoreMap.image.data[i*2+1]=THREE.DataUtils.toHalfFloat((coast[wrap(i+1)]-coast[wrap(i-1)])/(2*step));
      coastQuantized[i]=THREE.DataUtils.fromHalfFloat(shoreMap.image.data[i*2]);
    }
    shoreMap.needsUpdate=true;
    const mean=coast.reduce((sum,r)=>sum+r,0)/COAST_SAMPLES;
    band.x=Math.max((radius+mean)*.5,Math.max(...coast)+.45);
    band.y=Math.max(0,radius-RIM_CLEARANCE-band.x);
    const maxSpan=Math.max(band.y,band.x-Math.min(...coast));
    spill.w=maxSpan**2+radius/band.x*(Math.abs(MIN_U)+.15)**2;
  }
  function innerEdge(angle) {
    const i=((angle/TAU%1+1)%1)*COAST_SAMPLES, j=Math.floor(i), f=i-j;
    return coastQuantized[j]*(1-f)+coastQuantized[(j+1)%COAST_SAMPLES]*f;
  }
  function setFrame(orbitAge,phaseAge) {
    const turns=orbitAge/LAP;
    const angle=startAngle+(turns-Math.floor(turns))*TAU;
    const c=Math.cos(angle),s=Math.sin(angle);
    frame.set(c*band.x,s*band.x,-s,c);
    const spillPhase=TAU*7*(phaseAge%LAP)/LAP;
    spill.set(spillPhase,Math.sin(spillPhase),angle/TAU,spill.w);
  }
  function update(elapsed, effectDelta) {
    if (startTime === null || !running) return;
    if(stopping){
      // Let the crest run on as it dissipates. The integrated speed starts at
      // the current cruising speed and eases to a quarter of it, without a
      // sudden brake. Continue the spill phase as the lip falls into the water.
      const delta=Number.isFinite(effectDelta)?effectDelta:elapsed-stopClock;
      stopClock=elapsed;stopAge+=Math.max(0,delta);
      const t=clamp(stopAge/CANCEL_SETTLE,0,1);
      const travel=stopSpeed*CANCEL_SETTLE*(t-.75*(t*t*t-.5*t*t*t*t));
      age=stopPhaseAge+travel;progress=Math.min(1,(stopOrbitAge+travel)/LAP);
      setFrame(stopOrbitAge+travel,age);
      const fade=t*t*t*(t*(6*t-15)+10);
      band.z=stopGain*(1-fade);
      if(stopAge>=CANCEL_SETTLE){running=false;stopping=false;}
      return;
    }
    age = clamp(elapsed-startTime,0,LAP+SETTLE);
    progress = Math.min(1,age/LAP);
    setFrame(Math.min(age,LAP),age);
    // A rider can request a short formation ramp for a continuous landing.
    // Ordinary waves keep their original immediate crest, height and lap.
    const formation=riseSeconds>0?smooth(0,riseSeconds,age):1;
    band.z = elapsed<startTime ? 0 : Math.min(1,band.y/.85)*formation*(1-smooth(LAP,LAP+SETTLE,age));
    if (age>=LAP+SETTLE) running=false;
  }
  function start(elapsed, x, z, options={}) {
    if (!Number.isFinite(elapsed) || band.y<=0) return false;
    startTime=elapsed;
    riseSeconds=clamp(Number(options.riseSeconds)||0,0,1.5);
    stopping=false;stopAge=0;stopGain=0;
    startAngle=Number.isFinite(x)&&Number.isFinite(z)&&(x*x+z*z)>.0001 ? Math.atan2(z,x) : DEFAULT_ANGLE;
    running=true;
    update(elapsed);
    return true;
  }
  function cancel(elapsed) {
    if(!running||stopping||!Number.isFinite(elapsed))return false;
    update(elapsed);
    if(!running)return false;
    stopping=true;stopAge=0;stopGain=band.z;stopClock=elapsed;
    stopOrbitAge=Math.min(age,LAP);stopPhaseAge=age;
    // If it already reached the stationary end-of-lap settle, do not kick it
    // back into motion. Otherwise preserve its existing forward momentum.
    stopSpeed=age<LAP?1:0;
    return true;
  }
  function stop() {
    startTime=null;running=false;stopping=false;stopAge=0;stopGain=0;age=0;progress=0;band.z=0;
  }
  function sample(x,z) {
    const dx=x-frame.x, dz=z-frame.y, f=frame.z, g=frame.w;
    if (band.z<=0 || dx*dx+dz*dz>spill.w+1) return null;
    // The shader pitches the crest forward. Invert that local displacement so
    // a floating object and an eye crossing the crest sample its rendered height.
    const surfaceHeight=(a,b) => {
      const r=Math.hypot(a,b), angle=Math.atan2(b,a), outer=r-band.x;
      let across=outer/band.y;
      if (across<0) {
        const span=band.x-innerEdge(angle), t=outer/span;
        if (span<=0 || t<=-1) return 0;
        across=t*(1+(span/band.y-1)*(1+t)**2);
      } else if (across>=1) return 0;
      if(Math.abs(across)<1)across+=RADIAL_SWAY*spill.y*(1-across*across);
      const phase=angle/TAU-spill.z;
      const along=(phase-Math.floor(phase+.5))*TAU*band.x-SPILL_SWAY*(Math.sin(across*SPILL_FREQ+spill.x)-spill.y);
      if (along<=MIN_U || along>=MAX_U) return 0;
      return profileAt(along,across)*band.z;
    };
    function heightAt(a,b) {
      // With the crest folded forward, one horizontal position can intersect
      // the water more than once. Search in increasing displacement (and thus
      // increasing height), choosing the first root so floating objects stay
      // on the lower surface under the lip, not on top of the overhang.
      const atZero=surfaceHeight(a,b);
      if(atZero<=1e-9)return 0;
      const displacement=h=>LEAN*h*h/LEAN_HEIGHT;
      const bound=1.85,steps=512;
      // Probe near the expected lower root before the uniform sweep. At a
      // fold this root can be extremely close to zero and occupy a narrower
      // interval than any reasonable uniform sampling step.
      const probe=Math.min(.035,Math.max(.000002,displacement(atZero)*1.05+.000001));
      let lo=0,hi=bound,found=false;
      if(probe>=displacement(surfaceHeight(a-f*probe,b-g*probe))){hi=probe;found=true;}
      else{
        lo=probe;const step=(bound-probe)/steps;
        for(let i=1;i<=steps;i++){
          const candidate=probe+i*step;
          if(candidate>=displacement(surfaceHeight(a-f*candidate,b-g*candidate))){
            hi=candidate;found=true;break;
          }
          lo=candidate;
        }
      }
      if(!found)return 0;
      for(let i=0;i<9;i++){
        const mid=(lo+hi)*.5;
        if(mid<displacement(surfaceHeight(a-f*mid,b-g*mid)))lo=mid;else hi=mid;
      }
      const shift=(lo+hi)*.5;
      return surfaceHeight(a-f*shift,b-g*shift);
    }
    const h=heightAt(x,z), e=.007;
    return {height:h,dx:(heightAt(x+e,z)-heightAt(x-e,z))/(2*e),dz:(heightAt(x,z+e)-heightAt(x,z-e))/(2*e)};
  }
  configure(shoreline);
  return {
    uniforms:{harborCoastProfile:{value:texture},harborCoastShore:{value:shoreMap},harborCoastFrame:{value:frame},harborCoastBand:{value:band},harborCoastSpill:{value:spill}},
    get running(){return running;},get stopping(){return stopping;},
    start,cancel,stop,update,sample,configure,dispose(){texture.dispose();shoreMap.dispose();},
    diagnostics:()=>({
      start:{x:Math.cos(startAngle)*band.x,z:Math.sin(startAngle)*band.x},
      center:{x:frame.x,z:frame.y},peak:section(0,0).height*band.z,radius:band.x,halfSpan:band.y,
      innerEdge:innerEdge(spill.z*TAU),outerEdge:band.x+band.y,span:band.x+band.y-innerEdge(spill.z*TAU),
      duration:LAP+SETTLE,lapSeconds:LAP,speed:TAU*band.x/LAP,elapsed:age,startTime,progress,running,stopping,stopSeconds:CANCEL_SETTLE,
    }),
  };
}
