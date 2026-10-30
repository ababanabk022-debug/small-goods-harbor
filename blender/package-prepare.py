import bpy, json, re, sys, getpass
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
exec(compile((ROOT/'blender'/'package-state.py').read_text(encoding='utf8'),'state-helper','exec'))
scene=bpy.data.scenes.get('Small Goods · Reference Harbor')
assert scene is not None
assert len(scene.objects)>0
before=state(scene)
(STAGE/'before.json').write_text(json.dumps(before,ensure_ascii=False,indent=2),encoding='utf8')
removed_texts=len(bpy.data.texts)
for text in list(bpy.data.texts):bpy.data.texts.remove(text)
removed_brushes=len(bpy.data.brushes)
for brush in list(bpy.data.brushes):bpy.data.brushes.remove(brush,do_unlink=True)
assert not bpy.data.libraries, 'Linked data must be made local deliberately'
for font in bpy.data.fonts:
    if font.filepath != '<builtin>' and font.users:
        if not font.packed_file:font.pack()
        assert font.packed_file
        font.filepath='//fonts/'+Path(font.filepath.replace('\\','/')).name
for image in bpy.data.images:
    if image.source in {'FILE','TILED','SEQUENCE','MOVIE'} and image.users:
        if not image.packed_file:image.pack()
        assert image.packed_file
        image.filepath='//textures/'+Path(image.filepath.replace('\\','/')).name
private=re.compile(r'(?i)(?:[a-z]:[\\/]|\\\\|/users/|/home/|codex_files|CodexData|AppData|https?://|(?:ghp|github_pat|sk)-[A-Za-z0-9_]+)')
private=re.compile(private.pattern+'|'+re.escape(getpass.getuser()),re.IGNORECASE)
sanitized=[]
def clean_properties(owner):
    for key in list(owner.keys()):
        value=owner[key]
        if isinstance(value,str) and private.search(value):
            owner[key]='';sanitized.append(key)
        elif hasattr(value,'keys'):clean_properties(value)
for item in ids():
    clean_properties(item)
    asset=getattr(item,'asset_data',None)
    if asset:asset.author='';asset.description=''
for s in bpy.data.scenes:
    s.render.filepath='//renders/harbor-'
    s.render.use_stamp=False;s.render.stamp_note_text=''
    if hasattr(s,'cycles'):s.cycles.device='CPU'
after=state(scene)
assert before==after, 'Scene content changed during sanitization'
(STAGE/'resources-before.json').write_text(json.dumps({'fonts':[{'name':f.name,'packed':bool(f.packed_file),'sha256':hashlib.sha256(f.packed_file.data).hexdigest() if f.packed_file else None} for f in bpy.data.fonts if f.users and f.filepath!='<builtin>']},indent=2),encoding='utf8')
target=STAGE/'small-goods-harbor-pov.blend'
bpy.data.libraries.write(str(target),{scene},path_remap='NONE',fake_user=True,compress=False)
(STAGE/'cleaning.json').write_text(json.dumps({'removedTextBlocks':removed_texts,
    'removedEditorBrushes':removed_brushes,'sanitizedCustomPropertyCount':len(sanitized),
    'sceneOnlyLibraryWrite':True,'noRenderPerformed':True},indent=2),encoding='utf8')
print(json.dumps({'saved':target.name,'objects':before['objects'],'bytes':target.stat().st_size,
    'statePreserved':before==after},indent=2))
