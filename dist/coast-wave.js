// Moving coordinates on the water disc. The front travels along the tangent,
// and its tapered wings fill the local stretch from the actual coast to the rim.
const TAU = Math.PI * 2;
const LAP = 16, SETTLE = 1.25, DEFAULT_ANGLE = .70;
const MIN_U = -4.55, MAX_U = 1.90, LEAN = .155;
const SPILL_SWAY = .056, SPILL_FREQ = 8.2;
const NX = 224, NY = 144;
const COAST_SAMPLES = 512, INNER_CLEARANCE = .115, RIM_CLEARANCE = .012;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smooth = (lo, hi, x) => {
  const t = clamp((x-lo)/(hi-lo), 0, 1);
  return t*t*(3-2*t);
};

// The two wings spill at slightly different distances. Positive u is the steep
// plunging face. The long low back and the hollow beneath the lip give the
// breaker a direction even when the animation clock is paused.
function section(u, v) {
  const crest = .85*v - .97*v*v + .10*v*v*v + .055*Math.sin(8*v) + .029*Math.sin(18*v);
  const q = u-crest;
  const wing = 1-smooth(v>0 ? .62 : .45, 1, Math.abs(v));
  const width = q < 0 ? 1.29+.16*v : .61+.035*v;
  const ridge = Math.exp(-((q/width)**2));
  const bead = .080*Math.exp(-(((q-.04)/.22)**2))*(.48+.52*Math.cos(22*v+1.1*Math.sin(7*v)));
  const hollow = .21*Math.exp(-(((q-.88)/.41)**2));
  const train = .16*Math.exp(-(((q+2.15)/.63)**2))*(.73+.27*Math.cos(v*4.6+q*1.2));
  const height = wing*(1.91*ridge + bead - hollow + train)*smooth(MIN_U, MIN_U+.46, u)*(1-smooth(MAX_U-.27, MAX_U, u));
  return {height, q, wing};
}

function froth(q, v, wing) {
  // Scalloped spilling rim and torn air pockets stretched down the back face.
  const scallop = Math.sin(40*v+2*Math.sin(9*v));
  const s = q-.05-.046*scallop;
  const lip = Math.exp(-((s/(.115+.041*(.5+.5*Math.sin(19*v))))**2));
  const x = (s+.14*Math.sin(v*9)) * 8;
  const y = v*19+.64*Math.sin(q*6+v*7);
  const cells = Math.sin(x+.64*Math.sin(y))*Math.cos(y+.54*Math.sin(x*.8));
  const holes = smooth(.15,.55,cells);
  const lace = 1-smooth(.035,.24,Math.abs(cells+.065*Math.sin(y*3+x)));
  const spill = Math.exp(-(((s+.27)/.32)**2))*(.30+.70*(.5+.5*Math.sin(13*v+s*2)));
  const wash = Math.exp(-(((s+.83)/.53)**2))*(.5+.5*Math.cos(11*v+2*s));
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
  // The spill runs along the lip as the swell turns. The central crest stays
  // on its track while the white tongues immediately beside it form and fold.
  float spill=v*${SPILL_FREQ}+harborCoastSpill.x;
  u-=${SPILL_SWAY}*(sin(spill)-harborCoastSpill.y);
  if (u<=${MIN_U} || u>=${MAX_U}) return vec4(0.0);
  vec2 uv=vec2((u+${-MIN_U})/${(MAX_U-MIN_U).toFixed(4)},v*.5+.5);
  uv=(uv*vec2(${NX-1}.0,${NY-1}.0)+.5)/vec2(${NX}.0,${NY}.0);
  vec4 profile=texture2D(harborCoastProfile,uv)*harborCoastBand.z;
  profile.z-=${SPILL_SWAY*SPILL_FREQ}*cos(spill)*profile.y;
  return vec4(profile.x,profile.y*tangent*(harborCoastBand.x/r)+profile.z*gradV,profile.w);
}
vec2 harborBreakerLean(float height) { return ${LEAN}*harborCoastFrame.zw*height; }
// Tangents of the horizontally pitched surface, including background swell.
vec3 harborBreakerNormal(vec3 wave, vec4 breaker) {
  vec2 k=harborBreakerLean(1.0);
  vec3 tx=vec3(1.0+k.x*breaker.y,wave.y,k.y*breaker.y);
  vec3 tz=vec3(k.x*breaker.z,wave.z,1.0+k.y*breaker.z);
  return normalize(cross(tz,tx));
}
`;

export function createCoastWave(THREE, radius, shoreline) {
  const texture = bakeProfile(THREE);
  const coast = new Float32Array(COAST_SAMPLES);
  const shoreMap = new THREE.DataTexture(new Uint16Array(COAST_SAMPLES*2), COAST_SAMPLES, 1, THREE.RGFormat, THREE.HalfFloatType);
  shoreMap.name='Coast breaker · local shoreline and slope';
  shoreMap.magFilter=shoreMap.minFilter=THREE.LinearFilter;
  shoreMap.wrapS=THREE.RepeatWrapping;
  const frame = new THREE.Vector4(), band = new THREE.Vector3(), spill = new THREE.Vector4();
  let startTime = null, startAngle = DEFAULT_ANGLE, progress = 0, age = 0, running = false;

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
    return coast[j]*(1-f)+coast[(j+1)%COAST_SAMPLES]*f;
  }
  function update(elapsed) {
    if (startTime === null || !running) return;
    age = clamp(elapsed-startTime,0,LAP+SETTLE);
    progress = Math.min(1,age/LAP);
    const angle = progress===1 ? startAngle : startAngle+progress*TAU;
    const c=Math.cos(angle), s=Math.sin(angle);
    frame.set(c*band.x,s*band.x,-s,c);
    const spillPhase = TAU*7*(age%LAP)/LAP;
    spill.set(spillPhase,Math.sin(spillPhase),angle/TAU,spill.w);
    // Start with a formed crest. At the end of the orbit both its outline and
    // its forward pitch land exactly where they started, then they collapse.
    band.z = elapsed<startTime ? 0 : Math.min(1,band.y/.85)*(1-smooth(LAP,LAP+SETTLE,age));
    if (age>=LAP+SETTLE) running=false;
  }
  function start(elapsed, x, z) {
    if (!Number.isFinite(elapsed) || band.y<=0) return false;
    startTime=elapsed;
    startAngle=Number.isFinite(x)&&Number.isFinite(z)&&(x*x+z*z)>.0001 ? Math.atan2(z,x) : DEFAULT_ANGLE;
    running=true;
    update(elapsed);
    return true;
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
      const phase=angle/TAU-spill.z;
      const along=(phase-Math.floor(phase+.5))*TAU*band.x-SPILL_SWAY*(Math.sin(across*SPILL_FREQ+spill.x)-spill.y);
      if (along<=MIN_U || along>=MAX_U) return 0;
      return section(along,across).height*band.z;
    };
    function heightAt(a,b) {
      let lo=-.055, hi=.43;
      for (let i=0;i<12;i++) {
        const shift=(lo+hi)*.5;
        if (shift<LEAN*surfaceHeight(a-f*shift,b-g*shift)) lo=shift;
        else hi=shift;
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
    get running(){return running;},
    start,update,sample,configure,dispose(){texture.dispose();shoreMap.dispose();},
    diagnostics:()=>({
      start:{x:Math.cos(startAngle)*band.x,z:Math.sin(startAngle)*band.x},
      center:{x:frame.x,z:frame.y},peak:section(0,0).height*band.z,radius:band.x,halfSpan:band.y,
      innerEdge:innerEdge(spill.z*TAU),outerEdge:band.x+band.y,span:band.x+band.y-innerEdge(spill.z*TAU),
      duration:LAP+SETTLE,lapSeconds:LAP,speed:TAU*band.x/LAP,elapsed:age,startTime,progress,running,
    }),
  };
}
