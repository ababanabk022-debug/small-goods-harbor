import bpy,re,json,sys,getpass
from pathlib import Path
import argparse
assert bpy.app.background, 'Packaging must run in a separate background process'
parser=argparse.ArgumentParser()
parser.add_argument('--stage',type=Path,required=True)
parser.add_argument('--report',default='validation.json')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
ROOT=Path(__file__).resolve().parent.parent
STAGE=args.stage.resolve()
STAGE.mkdir(parents=True,exist_ok=True)
scene=bpy.data.scenes.get('Small Goods · Reference Harbor')
assert scene is not None
for window in bpy.context.window_manager.windows:window.scene=scene
for other in list(bpy.data.scenes):
    if other!=scene:
        assert len(other.objects)==0
        bpy.data.scenes.remove(other)
for brush in list(bpy.data.brushes):bpy.data.brushes.remove(brush,do_unlink=True)
private=re.compile(r'(?i)(?:[a-z]:[\\/]|/users/|/home/|codex_files|CodexData|AppData)')
private=re.compile(private.pattern+'|'+re.escape(getpass.getuser()),re.IGNORECASE)
seen=set();scrubbed=[]
def scrub_ui(value,depth=0):
    if value is None or depth>9 or not hasattr(value,'bl_rna'):return
    if value.bl_rna.identifier=='FileBrowserFSMenuEntry':return
    try:pointer=value.as_pointer()
    except:return
    if pointer in seen:return
    seen.add(pointer)
    for prop in value.bl_rna.properties:
        if prop.identifier in {'rna_type','id_data'}:continue
        try:field=getattr(value,prop.identifier)
        except:continue
        if prop.type=='STRING':
            text=field.decode('utf8','ignore') if isinstance(field,bytes) else str(field)
            if private.search(text) and not prop.is_readonly:
                replacement='//' if prop.subtype in {'FILE_PATH','DIR_PATH'} or 'directory' in prop.identifier else ''
                try:setattr(value,prop.identifier,replacement.encode() if isinstance(field,bytes) else replacement);scrubbed.append(value.bl_rna.identifier+'.'+prop.identifier)
                except:pass
        elif prop.type=='POINTER' and field is not None and not isinstance(field,bpy.types.ID):scrub_ui(field,depth+1)
        elif prop.type=='COLLECTION':
            try:
                for child in field:
                    if not isinstance(child,bpy.types.ID):scrub_ui(child,depth+1)
            except:pass
for screen in bpy.data.screens:
    scrub_ui(screen)
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.clip_start=.05;area.spaces.active.clip_end=200
            area.spaces.active.shading.type='SOLID'
for wm in bpy.data.window_managers:scrub_ui(wm)
out=STAGE/'final'/'small-goods-harbor-pov.blend'
out.parent.mkdir(exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out),check_existing=False,compress=False,relative_remap=False)
(STAGE/'finalize.json').write_text(json.dumps({'scrubbedUiFields':scrubbed,
    'freshFactoryUi':True,'currentScene':bpy.context.scene.name},indent=2),encoding='utf8')
print('FINAL_MODEL_READY',out.name,out.stat().st_size)
