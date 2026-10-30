"""Ground detached cover leaves and extend dock piles into the actual sand bed."""
import bpy,json
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from pathlib import Path
root=Path(bpy.data.filepath).parent.parent
assert not bpy.context.scene.get('near_supports_v142'),'Already applied'
dg=bpy.context.evaluated_depsgraph_get();trees=[]
for o in bpy.context.scene.objects:
 if o.type!='MESH' or o.hide_render or o.name.startswith(('POV_','V14.2 summit stair')):continue
 if not any(k in m.name.lower() for m in o.data.materials if m for k in ['rock','granite','sand','stone']):continue
 ev=o.evaluated_get(dg);me=ev.to_mesh();v=[o.matrix_world@p.co for p in me.vertices];p=[tuple(f.vertices) for f in me.polygons];ev.to_mesh_clear();trees.append((o.name,BVHTree.FromPolygons(v,p)))
def ground(x,y,ceiling):
 hits=[]
 for n,t in trees:
  p,norm,index,d=t.ray_cast(Vector((x,y,ceiling)),Vector((0,0,-1)),12)
  if p:hits.append(p.z)
 return max(hits) if hits else None
changed=[]
for o in list(bpy.context.scene.objects):
 if o.type!='MESH' or o.hide_render:continue
 if o.name.startswith('REFINED large fern bank'):
  v=[o.matrix_world@p.co for p in o.data.vertices];lo=min(p.z for p in v);c=sum(v,Vector())/len(v);h=ground(c.x,c.y,lo+.15)
  if h is not None and lo-h>.06:
   m=o.matrix_world.copy();m.translation.z+=h-lo-.008;o.matrix_world=m;changed.append({'name':o.name,'lowered':lo-h+.008})
 if o.name.startswith(('Creeping ground cover','REFINED carpet of creeping leaves','POLISH upper cliff creeping leaves','FOOTHILL | creeping pocket')):
  # Treat each disconnected leaf blade as a unit, retaining its folded shape.
  me=o.data;links=[[] for v in me.vertices]
  for e in me.edges:a,b=e.vertices;links[a].append(b);links[b].append(a)
  seen=set();count=0
  for start in range(len(me.vertices)):
   if start in seen:continue
   stack=[start];seen.add(start);component=[]
   while stack:
    idx=stack.pop();component.append(idx)
    for j in links[idx]:
     if j not in seen:seen.add(j);stack.append(j)
   vs=[o.matrix_world@me.vertices[j].co for j in component];c=sum(vs,Vector())/len(vs);lo=min(p.z for p in vs);h=ground(c.x,c.y,lo+.14)
   if h is None or lo-h<.07:continue
   inv=o.matrix_world.inverted();delta=Vector((0,0,h-lo+.008))
   for j,p in zip(component,vs):me.vertices[j].co=inv@(p+delta)
   count+=1
  if count:me.update();changed.append({'name':o.name,'groundedLeafBlades':count})
for o in bpy.context.scene.objects:
 if not o.name.startswith('Dock weathered driven pile') or o.type!='MESH':continue
 inv=o.matrix_world.inverted();before=[];after=[]
 for v in o.data.vertices:
  p=o.matrix_world@v.co;before.append(p.z)
  if p.z<.15:p.z-=.96*min(1,(.15-p.z)/.87)
  after.append(p.z);v.co=inv@p
 o.data.update();changed.append({'name':o.name,'oldBottom':min(before),'newBottom':min(after)})
bpy.context.scene['near_supports_v142']=True;bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
(root/'output/near-scene-v142/final-supports.json').write_text(json.dumps(changed,indent=2));print(json.dumps({'objects':len(changed),'dockPiles':sum('newBottom' in x for x in changed)}))
