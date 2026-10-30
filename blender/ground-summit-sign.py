"""Seat the complete hilltop sign in the rocks beside the V14.3 walking route.
Run against the working blend in a separate background Blender process.
"""
import bpy,json,shutil
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

assert bpy.app.background
root=Path(__file__).resolve().parent.parent
source=root/'blender'/'small-goods-harbor-pov.blend'
assert Path(bpy.data.filepath).resolve()==source.resolve()
scene=bpy.context.scene
out=root/'output'/'playwright'/'summit-sign-fix';out.mkdir(parents=True,exist_ok=True)
backup=out/'before-sign-fix.blend'
if not backup.exists():shutil.copy2(source,backup)
parts=[o for o in scene.objects if o.name.startswith(('Hilltop Small Goods','Gull '))]
assert len(parts)==55,[(o.name,o.type) for o in parts]
assert all(o.parent is None for o in parts)
delta=Vector((-.35,-.40,0))
before={o.name:list(o.location) for o in parts}
if not scene.get('summit_sign_grounded_v1431'):
 for o in parts:o.location+=delta
 scene['summit_sign_grounded_v1431']=True
bpy.context.view_layer.update()
dg=bpy.context.evaluated_depsgraph_get();surfaces=[]
for o in scene.objects:
 if o.type!='MESH' or o.hide_render or o in parts:continue
 if not any(k in m.name.lower() for m in o.data.materials if m for k in ['granite','rock','stone','soil']):continue
 e=o.evaluated_get(dg);me=e.to_mesh()
 vs=[o.matrix_world@v.co for v in me.vertices];polys=[tuple(p.vertices) for p in me.polygons]
 e.to_mesh_clear();surfaces.append((o.name,BVHTree.FromPolygons(vs,polys)))
posts=[]
for o in parts:
 if not o.name.startswith('Hilltop Small Goods square support'):continue
 verts=[o.matrix_world@Vector(p) for p in o.bound_box]
 bottom=min(p.z for p in verts);samples=[]
 for dx,dy in [(0,0),(-.045,-.05),(-.045,.05),(.045,-.05),(.045,.05)]:
  x=o.location.x+dx;y=o.location.y+dy;hits=[]
  for name,tree in surfaces:
   point,normal,index,distance=tree.ray_cast(Vector((x,y,6)),Vector((0,0,-1)),8)
   if point:hits.append((point.z,name))
  assert hits,'Missing ground below '+o.name
  height,name=max(hits);assert height>bottom+.04,(o.name,bottom,height)
  samples.append({'ground':height,'support':name,'embed':height-bottom})
 posts.append({'name':o.name,'bottom':bottom,'position':list(o.location),'samples':samples})
report={'worldBlenderDelta':list(delta),'objectsMoved':len(parts),'parts':[o.name for o in parts],'posts':posts}
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(source))
(out/'source-repair.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print('SIGN_GROUNDED',json.dumps({'objectsMoved':len(parts),'posts':posts}))
