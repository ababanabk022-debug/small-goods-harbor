import bpy,json,sys
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
before=json.loads((STAGE/'before.json').read_text(encoding='utf8'))
after=state(scene)
comparison={key:after[key]==before[key] for key in before}
fonts=[{'name':f.name,'packed':bool(f.packed_file),'reference':f.filepath,
        'bytes':f.packed_file.size if f.packed_file else 0,
        'sha256':hashlib.sha256(f.packed_file.data).hexdigest() if f.packed_file else None}
       for f in bpy.data.fonts if f.users and f.filepath!='<builtin>']
images=[{'name':i.name,'packed':bool(i.packed_file),'reference':i.filepath} for i in bpy.data.images if i.users]
paths=list(bpy.utils.blend_paths(absolute=False,packed=True,local=False))
report={'independentBackgroundReopen':True,'blenderVersion':bpy.app.version_string,
    'currentContextScene':bpy.context.scene.name if bpy.context.scene else None,
    'scenes':[s.name for s in bpy.data.scenes],'state':after,'comparison':comparison,
    'fonts':fonts,'images':images,'externalResourcePaths':paths,'linkedLibraries':len(bpy.data.libraries),
    'embeddedTextScripts':len(bpy.data.texts),'noRenderPerformed':True}
assert all(comparison.values()),comparison
assert len(bpy.data.scenes)==1
assert report['currentContextScene']==scene.name
assert report['linkedLibraries']==0
assert report['embeddedTextScripts']==0
assert all(f['packed'] and f['reference'].startswith('//') for f in fonts)
assert all(i['packed'] for i in images if i['reference'])
assert all(path.startswith('//') or path=='<builtin>' for path in paths)
(STAGE/args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False,indent=2))
