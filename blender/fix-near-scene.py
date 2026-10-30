"""V14.2 local modeling repair. Run once in the active POV Blender file.

Moves intact stones beside the stairs, grounds plant groups, mounts shop text,
and seats the boat cask without intersections. Writes a local backup and report.
"""
import bpy, json, math, re
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

scene=bpy.context.scene
root=Path(bpy.data.filepath).resolve().parent.parent
assert Path(bpy.data.filepath).name=='small-goods-harbor-pov.blend'
assert not scene.get('near_scene_v142'), 'Already repaired; inspect before rerunning'
out=root/'output'/'near-scene-v142';out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'before-near-scene.blend'),copy=True)
report={'movedRocks':[],'plants':[],'stairs':[],'text':[]}

def bounds(o):
    p=[o.matrix_world@Vector(v) for v in o.bound_box]
    return Vector(tuple(min(v[i] for v in p) for i in range(3))),Vector(tuple(max(v[i] for v in p) for i in range(3)))
def shift(o,d):
    m=o.matrix_world.copy();m.translation+=Vector(d);o.matrix_world=m
def geom(o):
    dg=bpy.context.evaluated_depsgraph_get();e=o.evaluated_get(dg);me=e.to_mesh()
    v=[o.matrix_world@p.co for p in me.vertices];p=[tuple(f.vertices) for f in me.polygons];e.to_mesh_clear();return v,p
def solids():
    rows=[]
    for o in scene.objects:
        if o.type!='MESH' or o.hide_render or o.name.startswith('POV_'):continue
        if not any(k in m.name.lower() for m in o.data.materials if m for k in ['granite','rock','stone','sand']):continue
        if o.name.startswith(('Path gravel','Worn sandy path','V14.2')):continue
        v,p=geom(o);rows.append((o.name,BVHTree.FromPolygons(v,p)))
    return rows
def ground(trees,x,y,ceiling=8):
    best=None
    for name,tree in trees:
        p,n,idx,d=tree.ray_cast(Vector((x,y,ceiling)),Vector((0,0,-1)),20)
        if p and (best is None or p.z>best[0]):best=(p.z,name)
    return best
before_trees=solids()
# Preserve every obstructing stone, relocating it to the outside of the path.
rock_moves={'Summit weathered outcrop 14':(1.10,0,0),'Summit weathered outcrop 03':(1.40,0,0),'Summit weathered outcrop 04':(1.90,0,0),'Summit weathered outcrop 12':(-.85,-.15,0),'Summit weathered outcrop 15':(.30,0,0),'Summit weathered outcrop 02':(-.40,0,0),'Summit weathered outcrop 05':(-.20,0,0)}
for name,delta in rock_moves.items():
    o=bpy.data.objects[name];shift(o,delta);report['movedRocks'].append({'name':name,'delta':delta})
bpy.context.view_layer.update()
# Place all soil-dependent plant groups onto actual surfaces. Group movement
# keeps branches, leaves and flowers together rather than stretching their mesh.
patterns=[r'^(Dense island shrub \d+)',r'^(REFINED dense tropical shrub \d+)',r'^(Tropical spear rosette \d+)',r'^(REFINED fleshy tropical rosette \d+)',r'^(Feather fern colony \d+)',r'^(Tiny warm wildflowers \d+)']
groups={}
for o in list(scene.objects):
    if o.hide_render or o.type not in ('MESH','CURVE'):continue
    for pattern in patterns:
        m=re.match(pattern,o.name)
        if m:groups.setdefault(m.group(1),[]).append(o);break
trees=solids()
for name,objects in groups.items():
    stems=[o for o in objects if 'stem' in o.name]
    source=stems or objects
    bb=[bounds(o) for o in source]
    base=min(a.z for a,b in bb)
    roots=[]
    for o in source:
        v,p=geom(o);low=min(q.z for q in v);points=[q for q in v if q.z<low+.025]
        roots.append(sum(points,Vector())/len(points))
    center=sum(roots,Vector())/len(roots)
    old=ground(before_trees,center.x,center.y,base+.18)
    delta=Vector((0,0,0))
    if old and old[1] in rock_moves and base-old[0]<.35:delta+=Vector(rock_moves[old[1]])
    center+=delta
    hit=ground(trees,center.x,center.y,base+delta.z+.35)
    if hit:
        delta.z+=hit[0]-(base+delta.z)-.018
        if delta.length>.035:
            for o in objects:shift(o,delta)
            report['plants'].append({'group':name,'delta':list(delta),'support':hit[1]})
bpy.context.view_layer.update()
# Rebuild a continuous stone staircase on the same side of the mountain.
# Narrow solid masonry risers supply the missing underside support.
for o in list(scene.objects):
    if o.name.startswith(('Worn sandy path step','Path gravel')) or o.name=='REFINED final summit sandy tread':bpy.data.objects.remove(o,do_unlink=True)
collection=bpy.data.collections.new('V14.2 | clear supported summit stairs');scene.collection.children.link(collection)
material=bpy.data.materials['Harbor | sand'].copy();material.name='V14.2 | pale weathered stair stone'
points=[(.78,1.55),(.80,1.73),(.82,1.91),(.83,2.09),(.83,2.27),(.82,2.45),(.80,2.63),(.77,2.81),(.72,2.99),(.68,3.17),(.65,3.35),(.63,3.53),(.58,3.71),(.48,3.89),(.30,4.05),(.08,4.19),(-.16,4.27),(-.40,4.28),(-.64,4.24)]
tops=[.69+i*.139 for i in range(len(points))]
tops[17]+=.055;tops[18]+=.11
trees=solids()
for i,(x,y) in enumerate(points):
    before=points[max(0,i-1)];after=points[min(len(points)-1,i+1)]
    tangent=Vector((after[0]-before[0],after[1]-before[1],0)).normalized()
    side=Vector((tangent.y,-tangent.x,0));width=.70
    length=(math.dist(points[i],points[i+1]) if i<len(points)-1 else math.dist(points[i-1],points[i]))+.035
    z=tops[i];low=.55
    # A narrow riser comes from the sand, with most of its back in the hillside.
    vertices=[]
    for h in [low,z]:
        for u,v in [(-1,-1),(1,-1),(1,1),(-1,1)]:
            q=Vector((x,y,h))+side*(u*width/2)+tangent*(v*length/2);vertices.append(q)
    mesh=bpy.data.meshes.new('V14.2 stair block');mesh.from_pydata(vertices,[],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]);mesh.materials.append(material);mesh.update()
    o=bpy.data.objects.new('V14.2 summit stair %02d'%i,mesh);collection.objects.link(o)
    bevel=o.modifiers.new('Soft worn stone edges','BEVEL');bevel.width=.018;bevel.segments=2
    report['stairs'].append({'name':o.name,'center':[x,y,z],'groundBefore':ground(trees,x,y)})
# Nameplate mounted on the actual moved gable, not its old pre-expansion origin.
text=bpy.data.objects['Shop small business name'];text.location=(-2.41,.230,2.52);text.data.align_x='CENTER';text.data.size=.092
caption=bpy.data.objects['Shop map caption'];caption.location=(-3.075,.270,1.31);caption.data.align_x='CENTER';caption.data.size=.035
for o in [text,caption]:report['text'].append({'name':o.name,'position':list(o.location)})
bpy.ops.mesh.primitive_cube_add(size=1,location=(-2.41,.268,2.565));plate=bpy.context.object;plate.name='V14.2 shop mounted timber nameplate';plate.dimensions=(.88,.045,.16);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);plate.data.materials.append(bpy.data.materials['Harbor | wood_dark']);bevel=plate.modifiers.new('Worn plaque edges','BEVEL');bevel.width=.012;bevel.segments=2
# Find a supported, non-intersecting bench position for the whole cask assembly.
bpy.context.view_layer.update()
cask=bpy.data.objects['Boat little water cask bowed stave body'];cask_parts=[o for o in scene.objects if o.name.startswith('Boat little water cask')]
v,p=geom(cask);lo,hi=bounds(cask);center=(lo+hi)*.5
others=[]
for o in scene.objects:
    if o in cask_parts or o.type not in ('MESH','CURVE') or not o.parent or o.parent.name!='Boat | gentle floating motion':continue
    ov,op=geom(o);others.append((o.name,BVHTree.FromPolygons(ov,op)))
best=None
for dx in [0,-.10,.10,-.20,.20,-.30,.30]:
 for dy in [0,-.10,.10,-.20,.20,-.30,.30]:
    supports=[]
    for n,t in others:
        if not n.startswith('Boat bench slat'):continue
        h,normal,idx,d=t.ray_cast(Vector((center.x+dx,center.y+dy,1.2)),Vector((0,0,-1)),2)
        if h:supports.append(h.z)
    if not supports:continue
    dz=max(supports)+.004-lo.z;delta=Vector((dx,dy,dz));tree=BVHTree.FromPolygons([q+delta for q in v],p)
    collisions=[n for n,t in others if tree.overlap(t)]
    if collisions:continue
    score=dx*dx+dy*dy+dz*dz
    if best is None or score<best[0]:best=(score,delta,max(supports))
assert best,'No collision-free bench location for cask'
for o in cask_parts:shift(o,best[1])
report['cask']={'delta':list(best[1]),'supportHeight':best[2],'bodyIntersections':0}
bpy.context.view_layer.update()
scene['near_scene_v142']=True
bpy.ops.wm.save_as_mainfile(filepath=str(root/'blender'/'small-goods-harbor-pov.blend'))
(out/'repair-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'rocks':len(report['movedRocks']),'plants':len(report['plants']),'stairs':len(report['stairs']),'cask':report['cask'],'saved':bpy.data.filepath}))
