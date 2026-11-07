/** Optional island ambience. Nothing is fetched or played before the listener opts in. */
const VOLUME=.9, CHEER_VOLUME=.38;

export function createHarborAudio({onChange}={}){
  let enabled=false;
  let playing=true,subject=null,loading=false,error=null,disposed=false,pageAway=false;
  let context=null,master=null,filter=null,subjectGain=null,compressor=null,analyser=null,samples=null;
  let loadPromise=null,loadAbort=null,suspendTimer=null,request=0,mixRequest=0;
  let buffer=null,source=null;
  let cheerBuffer=null,cheerLoadPromise=null,cheerAbort=null,cheerSource=null,cheerGain=null;
  let cheerRevision=0,cheerAttempts=0,cheerPlayed=0,cheerError=null;

  const loaded=()=>buffer!==null;
  const visible=()=>!document.hidden&&!pageAway;
  const canPlay=()=>!disposed&&enabled&&playing&&visible()&&loaded();
  function snapshot(){
    return {enabled,loading,error,playing,subject,
      audible:canPlay()&&context?.state==='running',contextState:context?.state||'uninitialized',loaded:loaded()};
  }
  function emit(){if(!disposed)onChange?.(snapshot());}
  function cancelSuspend(){if(suspendTimer!==null){clearTimeout(suspendTimer);suspendTimer=null;}}
  function fade(param,target,seconds=.12){
    const now=context.currentTime;
    if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(now);
    else{const current=param.value;param.cancelScheduledValues(now);param.setValueAtTime(current,now);}
    param.linearRampToValueAtTime(target,now+seconds);
  }
  function updateSubject(){
    if(!context)return;
    fade(filter.frequency,subject==='fish'?950:Math.min(19000,context.sampleRate*.45),.45);
    fade(subjectGain.gain,subject==='fish'?.45:1,.45);
  }
  function initialize(){
    if(context)return;
    const AudioContextClass=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!AudioContextClass)throw new Error('unsupported');
    context=new AudioContextClass({latencyHint:'playback'});
    filter=context.createBiquadFilter();filter.type='lowpass';filter.Q.value=.5;
    filter.frequency.value=subject==='fish'?950:Math.min(19000,context.sampleRate*.45);
    subjectGain=context.createGain();subjectGain.gain.value=subject==='fish'?.45:1;
    compressor=context.createDynamicsCompressor();
    compressor.threshold.value=-3;compressor.knee.value=3;compressor.ratio.value=12;
    compressor.attack.value=.003;compressor.release.value=.22;
    master=context.createGain();master.gain.value=0;
    analyser=context.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=0;
    samples=new Float32Array(analyser.fftSize);
    filter.connect(subjectGain);subjectGain.connect(compressor);compressor.connect(master);
    master.connect(analyser);analyser.connect(context.destination);
    context.addEventListener('statechange',emit);
  }
  function ensureBuffer(){
    if(loaded())return Promise.resolve();
    if(loadPromise)return loadPromise;
    loading=true;loadAbort=new AbortController();const controller=loadAbort;
    const timeout=setTimeout(()=>controller.abort(),30000);
    loadPromise=(async()=>{
      const url=new URL('./public/audio/island-ambience.mp3?v=14.4',import.meta.url);
      const response=await fetch(url,{signal:controller.signal});
      if(!response.ok)throw new Error(`Ambience: HTTP ${response.status}`);
      const bytes=await response.arrayBuffer();
      const decoded=await context.decodeAudioData(bytes);
      if(!disposed)buffer=decoded;
    })().finally(()=>{
      clearTimeout(timeout);loading=false;loadPromise=null;
      if(loadAbort===controller)loadAbort=null;
      emit();
    });
    emit();return loadPromise;
  }
  function ensureCheerBuffer(){
    if(cheerBuffer)return Promise.resolve(cheerBuffer);
    if(cheerLoadPromise)return cheerLoadPromise;
    cheerAbort=new AbortController();const controller=cheerAbort;
    const timeout=setTimeout(()=>controller.abort(),30000);
    cheerLoadPromise=(async()=>{
      const url=new URL('./public/audio/surf-cheer.mp3?v=1',import.meta.url);
      const response=await fetch(url,{signal:controller.signal});
      if(!response.ok)throw new Error(`Cheer: HTTP ${response.status}`);
      const decoded=await context.decodeAudioData(await response.arrayBuffer());
      if(!disposed)cheerBuffer=decoded;
      return decoded;
    })().finally(()=>{
      clearTimeout(timeout);cheerLoadPromise=null;
      if(cheerAbort===controller)cheerAbort=null;
    });
    return cheerLoadPromise;
  }
  function stopCheer(){
    cheerRevision++;cheerAbort?.abort();
    if(!cheerSource)return;
    const old=cheerSource,gain=cheerGain;cheerSource=null;cheerGain=null;
    try{old.stop();}catch{}old.disconnect();gain?.disconnect();
  }
  async function playSurfCheer(){
    // The event never activates audio or fetches a recording without consent.
    // Capture a revision so a late decode cannot play after mute/pause/hide.
    if(!enabled||!playing||!visible()||disposed||!context)return false;
    cheerAttempts++;const revision=++cheerRevision;cheerError=null;
    try{
      const decoded=await ensureCheerBuffer();
      if(revision!==cheerRevision||!canPlay())return false;
      if(context.state!=='running')await context.resume();
      if(revision!==cheerRevision||!canPlay()||context.state!=='running')return false;
      // A second event replaces a previous one rather than stacking applause.
      if(cheerSource){try{cheerSource.stop();}catch{}cheerSource.disconnect();cheerGain?.disconnect();}
      const next=context.createBufferSource(),gain=context.createGain();
      next.buffer=decoded;gain.gain.value=CHEER_VOLUME;next.connect(gain);gain.connect(filter);
      cheerSource=next;cheerGain=gain;cheerPlayed++;
      next.onended=()=>{next.disconnect();gain.disconnect();if(cheerSource===next){cheerSource=null;cheerGain=null;}emit();};
      next.start();emit();return true;
    }catch(cause){
      if(!disposed&&revision===cheerRevision&&cause?.name!=='AbortError')cheerError='欢呼声暂时无法加载';
      emit();return false;
    }
  }
  function startSource(){
    // Reuse the same loop through mute/pause/resume, so rapid clicks cannot
    // stack copies of the waves, birds and distant voices in the premixed track.
    if(source)return;
    source=context.createBufferSource();source.buffer=buffer;source.loop=true;
    source.connect(filter);source.start();
  }
  function reconcile(){
    cancelSuspend();const revision=++mixRequest;
    if(!context||disposed){emit();return;}
    if(!canPlay()){
      stopCheer();
      fade(master.gain,0);
      suspendTimer=setTimeout(()=>{
        suspendTimer=null;
        if(!disposed&&!canPlay()&&context.state==='running')context.suspend().then(emit).catch(()=>{});
      },220);
      emit();return;
    }
    startSource();
    const apply=()=>{if(!disposed&&revision===mixRequest&&canPlay()){fade(master.gain,VOLUME,.28);emit();}};
    if(context.state==='running')apply();
    else context.resume().then(apply).catch(()=>{
      if(disposed||revision!==mixRequest)return;
      enabled=false;error='声音暂时无法播放，请再点一次开启声音。';reconcile();
    });
    emit();
  }
  async function setEnabled(value){
    if(disposed)return false;
    enabled=Boolean(value);error=null;const revision=++request;
    if(!enabled){reconcile();return false;}
    cancelSuspend();
    try{
      initialize();
      // Call resume synchronously in the click handler, before waiting for fetch,
      // so browsers that require a user gesture can unlock the audio context.
      const resumed=context.resume();
      await Promise.all([resumed,ensureBuffer()]);
      if(disposed||revision!==request)return false;
      reconcile();return enabled;
    }catch(cause){
      if(disposed||revision!==request)return false;
      enabled=false;
      error=cause?.message==='unsupported'?'当前浏览器暂不支持环境声音。':'声音加载失败，请再点一次开启声音重试。';
      reconcile();return false;
    }
  }
  function setPlaying(value){if(!disposed){playing=Boolean(value);reconcile();}}
  function setSubject(id){if(!disposed){subject=id||null;updateSubject();emit();}}
  function diagnostics(){
    let peak=0,square=0;
    if(analyser&&context.state==='running'){
      analyser.getFloatTimeDomainData(samples);
      for(const value of samples){peak=Math.max(peak,Math.abs(value));square+=value*value;}
    }
    return {...snapshot(),sourceCount:source?1:0,bufferDuration:buffer?.duration||0,volume:VOLUME,
      cheer:{loaded:!!cheerBuffer,loading:!!cheerLoadPromise,playing:!!cheerSource,attempts:cheerAttempts,played:cheerPlayed,volume:CHEER_VOLUME,error:cheerError},
      peak,rms:samples?Math.sqrt(square/samples.length):0,
      outputGain:master?.gain.value||0,filterFrequency:filter?.frequency.value||0};
  }
  const visibilityChanged=()=>reconcile();
  const pageHidden=()=>{pageAway=true;reconcile();};
  const pageShown=()=>{pageAway=false;reconcile();};
  document.addEventListener('visibilitychange',visibilityChanged);
  window.addEventListener('pagehide',pageHidden);
  window.addEventListener('pageshow',pageShown);
  function dispose(){
    if(disposed)return;
    disposed=true;enabled=false;request++;mixRequest++;cancelSuspend();loadAbort?.abort();cheerAbort?.abort();stopCheer();
    document.removeEventListener('visibilitychange',visibilityChanged);
    window.removeEventListener('pagehide',pageHidden);window.removeEventListener('pageshow',pageShown);
    if(context)context.removeEventListener('statechange',emit);
    if(source){try{source.stop();}catch{}source.disconnect();source=null;}buffer=null;
    for(const node of [filter,subjectGain,compressor,master,analyser])node?.disconnect();
    if(context&&context.state!=='closed')context.close().catch(()=>{});
  }
  queueMicrotask(emit);
  return {setEnabled,setPlaying,setSubject,playSurfCheer,diagnostics,dispose};
}
