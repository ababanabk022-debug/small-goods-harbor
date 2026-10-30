"""Back the cleared stair with progressively taller, intact granite rocks."""
import bpy,bmesh,json,math,random
from pathlib import Path
from mathutils import Vector
root=Path(bpy.data.filepath).resolve().parent.parent
assert Path(bpy.data.filepath).name=='small-goods-harbor-pov.blend'
report_path=root/'output/near-scene-v142/repair-report.json';r=json.loads(report_path.read_text())
for o in list(bpy.context.scene.objects):
    if o.name.startswith(('V14.2 stair backing rock','V14.2 stair outer rock','V14.2 stair rock foundation')):bpy.data.objects.remove(o,do_unlink=True)
collection=bpy.data.collections.get('V14.2 | clear supported summit stairs')
material=bpy.data.materials['REFINED | warm weathered granite']
r['stairBacking']=[]
for j,i in enumerate(list(range(0,len(r['stairs']),2))*2):
    outer=j>=10
    c=Vector(r['stairs'][i]['center']);a=Vector(r['stairs'][max(0,i-1)]['center']);b=Vector(r['stairs'][min(len(r['stairs'])-1,i+1)]['center']);t=b-a;t.z=0;t.normalize();side=Vector((t.y,-t.x,0))
    center=c+side*(.76 if outer else -.72)
    top=c.z+(.29 if outer else .22)+.04*math.sin(i*.7);base=.49
    bm=bmesh.new();bmesh.ops.create_icosphere(bm,subdivisions=2,radius=1)
    rng=random.Random(14200+i)
    for v in bm.verts:
        # Squarer faceted stones overlap at the back, while a fixed inner
        # clearance prevents the jagged faces from covering the usable tread.
        q=v.co.copy();u=math.copysign(abs(q.x)**.52,q.x)*.285
        w=math.copysign(abs(q.y)**.55,q.y)*(.37 if i<14 else .40)
        z=base+(q.z+1)*.5*(top-base)
        if q.z>.80:z=top-rng.uniform(0,.045)
        p=Vector((center.x,center.y,z))+side*u+t*w
        v.co=p
    mesh=bpy.data.meshes.new('Stair backing granite');bm.to_mesh(mesh);bm.free();mesh.materials.append(material);mesh.update()
    o=bpy.data.objects.new(('V14.2 stair outer rock ' if outer else 'V14.2 stair backing rock ')+'%02d'%(j%10),mesh);collection.objects.link(o)
    bevel=o.modifiers.new('Soft granite corners','BEVEL');bevel.width=.018;bevel.segments=1
    r['stairBacking'].append({'name':o.name,'step':i,'top':top,'center':list(center),'riseAboveTread':top-c.z})
# The continuous structural underside is granite too; only the shallow tread
# remains pale. Side views can no longer expose tall beige column extrusions.
for i,record in enumerate(r['stairs']):
    step=bpy.data.objects['V14.2 summit stair %02d'%i]
    top=record['center'][2];mesh=step.data
    top_vertices=[v.co.copy() for v in mesh.vertices[4:8]]
    bottom=[Vector((v.x,v.y,.52)) for v in top_vertices]
    ceiling=[Vector((v.x,v.y,top-.115)) for v in top_vertices]
    fm=bpy.data.meshes.new('Granite stair foundation');fm.from_pydata(bottom+ceiling,[],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]);fm.materials.append(material);fm.update()
    fo=bpy.data.objects.new('V14.2 stair rock foundation %02d'%i,fm);collection.objects.link(fo)
    for v in mesh.vertices[:4]:v.co.z=top-.125
    mesh.update()
bpy.context.view_layer.update();report_path.write_text(json.dumps(r,indent=2));bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print(json.dumps({'backingRocks':len(r['stairBacking']),'topHeights':[x['top'] for x in r['stairBacking']]}))
