"""Build the web island's single looping CC0 ambience mix.

Requires Python + numpy and ffmpeg/ffprobe on PATH. Run from any directory:
  python tools/build-ambient-audio.py
The three CC0 source recordings are included in assets/audio-sources; credits
and source links are listed there and in dist/public/audio/SOURCES.md. No network calls.
"""
from pathlib import Path
import json,math,subprocess,wave
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'assets'/'audio-sources'
OUT=ROOT/'dist'/'public'/'audio'
WORK=ROOT/'output'/'ambient-audio'
OUT.mkdir(parents=True,exist_ok=True);WORK.mkdir(parents=True,exist_ok=True)
SR=48000

def decode(path,start=0,duration=None,filters=None):
    cmd=['ffmpeg','-v','error','-ss',str(start),'-i',str(path)]
    if duration is not None:cmd+=['-t',str(duration)]
    if filters:cmd+=['-af',filters]
    cmd+=['-ar',str(SR),'-ac','2','-f','f32le','pipe:1']
    return np.frombuffer(subprocess.check_output(cmd),dtype='<f4').reshape(-1,2).copy()

def meter(x):
    cmd=['ffmpeg','-hide_banner','-f','f32le','-ar',str(SR),'-ac','2','-i','pipe:0',
         '-af','loudnorm=I=-16:TP=-2:LRA=9:print_format=json','-f','null','-']
    result=subprocess.run(cmd,input=np.asarray(x,dtype='<f4').tobytes(),capture_output=True,check=True)
    msg=result.stderr.decode('utf8',errors='replace');data=json.JSONDecoder().raw_decode(msg[msg.rfind('{'):])[0]
    return {k:float(data[k]) for k in ['input_i','input_tp','input_lra','input_thresh']}

def normalize(x,lufs):
    return x*10**((lufs-meter(x)['input_i'])/20)

def process(x,filters):
    cmd=['ffmpeg','-v','error','-f','f32le','-ar',str(SR),'-ac','2','-i','pipe:0',
         '-af',filters,'-f','f32le','pipe:1']
    result=subprocess.run(cmd,input=np.asarray(x,dtype='<f4').tobytes(),capture_output=True,check=True)
    return np.frombuffer(result.stdout,dtype='<f4').reshape(-1,2).copy()

def process_cycle(x,filters):
    # Prime envelope/lookahead state with one full period, so the processing
    # itself cannot introduce a jump where the buffer loops.
    n=len(x);return process(np.tile(x,(3,1)),filters)[n:2*n]

def cyclic(x,seconds,overlap=2):
    """Tail-to-head crossfade; both sides of the playback boundary stay adjacent.

    Output ends at raw[N-1], starts at raw[N], and then blends back into raw[L].
    There is no fade-to-silence notch in the ocean or murmuring loop.
    """
    n=round(seconds*SR);length=round(overlap*SR)
    assert len(x)>=n+length
    t=np.linspace(0,np.pi/2,length,endpoint=True)[:,None]
    head=x[n:n+length]*np.cos(t)**2+x[:length]*np.sin(t)**2
    return np.concatenate([head,x[length:n]])

def fade(x,fade_in=.15,fade_out=.45):
    x=x.copy();a=round(fade_in*SR);b=round(fade_out*SR)
    x[:a]*=np.sin(np.linspace(0,np.pi/2,a))[:,None]**2
    x[-b:]*=np.cos(np.linspace(0,np.pi/2,b))[:,None]**2
    return x

def write_wav(path,x):
    with wave.open(str(path),'wb') as f:
        f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR)
        f.writeframes((np.clip(x,-1,1)*32767).astype('<i2').tobytes())

ocean=cyclic(decode(SOURCE/'ocean.mp3',26,38,'highpass=f=65,lowpass=f=6500'),36)
ocean=normalize(ocean,-18.5)
ocean=normalize(process_cycle(ocean,'acompressor=threshold=0.075:ratio=5:attack=4:release=450:knee=4'),-18.5)
voice_filter='highpass=f=230,lowpass=f=1250,lowpass=f=1600'
first=cyclic(decode(SOURCE/'dialogue.mp3',47,34,voice_filter),32)
second=cyclic(decode(SOURCE/'dialogue.mp3',92,34,voice_filter),32)
# Two distant groups, with offset stereo perspectives; no intelligible narration.
voices=normalize(first,-24)*.72+normalize(second[:,::-1],-24)*.48
voices=normalize(voices,-23)
voices=normalize(process_cycle(voices,'acompressor=threshold=0.07:ratio=3:attack=8:release=250:knee=4'),-23)
birds=np.zeros((40*SR,2),dtype=np.float64)
for source_start,length,at,pan,gain in [(14,4.2,3.2,-.25,1),(23,4.0,17.0,.28,.86),(32,4.8,30.4,-.12,.9)]:
    call=fade(decode(SOURCE/'seagulls.mp3',source_start,length,'highpass=f=480,lowpass=f=5600'),.22,.65)
    mono=call.mean(axis=1);theta=(pan+1)*np.pi/4
    call=np.column_stack([mono*np.cos(theta),mono*np.sin(theta)])*gain
    start=round(at*SR);birds[start:start+len(call)]+=call
birds=normalize(birds,-24.5)
layers={'ocean':ocean,'birds':birds,'voices':voices}

# Different bed periods and spaced gull calls avoid a short repeating phrase.
# The delivered file is one composite loop, controlled by one website toggle.
def mix_layers(tracks,seconds=74):
    count=round(seconds*SR)
    return sum(np.tile(x,(math.ceil(count/len(x)),1))[:count] for x in tracks.values())
for name,x in layers.items():
    assert np.isfinite(x).all() and np.max(np.abs(x))<1
    master=WORK/(name+'.wav');write_wav(master,x)
mixed=normalize(cyclic(mix_layers(layers),72),-16.5)
mixed=process_cycle(mixed,'alimiter=limit=0.72:attack=5:release=120:level=0:latency=1')
write_wav(WORK/'island-ambience-master.wav',mixed)
target=OUT/'island-ambience.mp3'
subprocess.run(['ffmpeg','-y','-v','error','-i',str(WORK/'island-ambience-master.wav'),
                '-c:a','libmp3lame','-b:a','160k','-ar',str(SR),'-ac','2',
                '-map_metadata','-1',str(target)],check=True)
x=decode(target)
assert len(x)==len(mixed),(len(x),len(mixed))
assert np.isfinite(x).all() and np.max(np.abs(x))<1
steps=np.abs(np.diff(x,axis=0));seam=float(np.max(np.abs(x[0]-x[-1])))
report={'file':target.name,'sampleRate':SR,'channels':2,'seconds':len(x)/SR,'bytes':target.stat().st_size,
        'defaultMasterVolume':.9,'decodedMixAtUnity':meter(x),'decodedMixAtDefault':meter(x*.9),
        'samplePeak':float(np.max(np.abs(x))),'seamStep':seam,
        'sampleStep99_9Percentile':float(np.quantile(steps,.999)),
        'clippedSamples':int(np.sum(np.abs(x)>=1)),
        'layers':['ocean waves','occasional seagulls','indistinct distant murmuring']}
assert report['decodedMixAtUnity']['input_tp']<=-2
assert report['clippedSamples']==0
assert seam<=report['sampleStep99_9Percentile'],'Unexpected loop-boundary transient'
write_wav(WORK/'preview-default.wav',x*.9)
for old in ['ocean.mp3','birds.mp3','voices.mp3']:
    obsolete=OUT/old
    if obsolete.exists():obsolete.unlink()
(WORK/'verification.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps(report,indent=2))
