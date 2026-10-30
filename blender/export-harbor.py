"""Export the saved editable harbor to portable staged web assets.

Use a separate Blender background process (the open editing session is untouched):
    blender -b blender/small-goods-harbor-pov.blend --python blender/export-harbor.py -- --lite
Omit --lite for the full asset. Optional --output <directory> selects the staging
directory; by default it is output/export-staging inside this project.
Run export-compress.py afterward. Reductions affect this background process only;
the script never saves the input .blend. The independent POV_ENVIRONMENT is
excluded because the viewer loads harbor-horizon.glb separately.
"""
import bpy, json, math, struct, time, hashlib, sys, argparse, importlib.util
from pathlib import Path
from collections import defaultdict
import numpy as np
from mathutils import Vector, noise

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT = SCRIPT_DIR.parent
assert bpy.app.background, 'Export in a separate background Blender process, never the live editing session'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--lite', action='store_true')
parser.add_argument('--output', type=Path, default=PROJECT / 'output' / 'export-staging')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT = args.output.resolve()
OUT.mkdir(parents=True, exist_ok=True)
LOD = args.lite
SUFFIX = '-lite' if LOD else ''
START = time.time()
texture_spec = importlib.util.spec_from_file_location('harbor_export_surfaces', SCRIPT_DIR / 'export-surface-textures.py')
texture_module = importlib.util.module_from_spec(texture_spec)
texture_spec.loader.exec_module(texture_module)
SPECS, kind_for_material, build_texture_pair = (texture_module.SPECS, texture_module.kind_for_material, texture_module.build_texture_pair)
scene = next(s for s in bpy.data.scenes if s.name.startswith('Small Goods'))
bpy.context.window.scene = scene
scene.frame_set(1)
environment = bpy.data.collections.get('POV_ENVIRONMENT')
excluded_environment = set(environment.all_objects) if environment else set()
# This excludes descendants too, even if individual objects are render-visible.
export_source_objects = [o for o in scene.objects if o not in excluded_environment]

def vec(v):
    return tuple(float(x) for x in v)
def scalar(x):
    return sum(x[:3])/3 if isinstance(x, (tuple,list,Vector)) else float(x)
def v3(x):
    return tuple(x[:3]) if isinstance(x,(tuple,list,Vector)) else (x,x,x)
def rgba(x):
    return tuple(x[:4]) if isinstance(x,(tuple,list,Vector)) and len(x)>3 else (*v3(x),1.)
def clamp(x): return max(0.,min(1.,x))
def value(s):
    d=s.default_value
    return tuple(d) if hasattr(d,'__len__') and not isinstance(d,str) else d

def compile_color(material):
    """Compile the source base-color graph, retaining its palette and variation.
    Noise uses Blender's CPU Perlin basis as a portable approximation. Existing
    projected water-caustic branches are omitted because the viewer animates them.
    """
    if not material or not material.use_nodes:
        c=tuple(material.diffuse_color) if material else (.5,.5,.5,1)
        return lambda p,g,w:c
    p=next((n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if not p:
        c=tuple(material.diffuse_color)
        return lambda p,g,w:c
    cache={}
    def inp(socket):
        if socket.is_linked: return node(socket.links[0].from_socket)
        a=value(socket)
        return lambda p,g,w:a
    def node(socket):
        key=socket.as_pointer()
        if key in cache:return cache[key]
        n=socket.node;t=n.type;sid=socket.name
        if t=='TEX_COORD':
            f=(lambda p,g,w:g) if sid=='Generated' else (lambda p,g,w:p)
        elif t=='NEW_GEOMETRY':f=lambda p,g,w:w
        elif t=='TEX_NOISE':
            v=inp(n.inputs['Vector']) if n.inputs['Vector'].is_linked else (lambda p,g,w:g)
            sc=float(n.inputs['Scale'].default_value)
            rough=float(n.inputs['Roughness'].default_value)
            octaves=min(4,max(1,int(n.inputs['Detail'].default_value)+1))
            def f(p,g,w,v=v,sc=sc,rough=rough,octaves=octaves,sid=sid):
                q=Vector(v3(v(p,g,w)))*sc
                total=0.;weight=1.;weights=0.
                for j in range(octaves):
                    total += noise.noise(q,noise_basis='PERLIN_ORIGINAL')*weight
                    weights += weight;weight*=rough;q*=2
                a=clamp(.5+.55*total/weights)
                return (a,a,a,1) if sid=='Color' else a
        elif t=='VALTORGB':
            v=inp(n.inputs[0]); ramp=n.color_ramp
            f=lambda p,g,w,v=v,ramp=ramp:tuple(ramp.evaluate(clamp(scalar(v(p,g,w)))))
        elif t=='VECT_MATH':
            fs=[inp(s) for s in n.inputs[:3]];op=n.operation
            scale=inp(n.inputs['Scale']) if 'Scale' in n.inputs else (lambda p,g,w:1.)
            def f(p,g,w,fs=fs,op=op,scale=scale):
                a=v3(fs[0](p,g,w));b=v3(fs[1](p,g,w))
                if op=='MULTIPLY':return tuple(x*y for x,y in zip(a,b))
                if op=='ADD':return tuple(x+y for x,y in zip(a,b))
                if op=='SUBTRACT':return tuple(x-y for x,y in zip(a,b))
                if op=='SCALE':return tuple(x*scalar(scale(p,g,w)) for x in a)
                return a
        elif t=='MIX_RGB':
            # Caustic nodes contain world-position Voronoi branches, which are
            # reproduced by moving water light in the real-time shader instead.
            if 'caustic' in material.name.lower() or material.name in {'Harbor | rock','Harbor | rock_dark','Sea | cool sandy lagoon bed'}:
                f=inp(n.inputs[1])
            else:
                fac=inp(n.inputs[0]);a=inp(n.inputs[1]);b=inp(n.inputs[2]);op=n.blend_type
                def f(p,g,w,fac=fac,a=a,b=b,op=op):
                    k=clamp(scalar(fac(p,g,w)));x=rgba(a(p,g,w));y=rgba(b(p,g,w))
                    if op=='MULTIPLY':z=tuple(q*r for q,r in zip(x,y))
                    elif op=='ADD':z=tuple(q+r for q,r in zip(x,y))
                    else:z=y
                    return tuple(q*(1-k)+r*k for q,r in zip(x,z))
        elif t=='MATH':
            a=inp(n.inputs[0]);b=inp(n.inputs[1]);op=n.operation
            def f(p,g,w,a=a,b=b,op=op):
                x=scalar(a(p,g,w));y=scalar(b(p,g,w))
                if op=='MULTIPLY':return x*y
                if op=='ADD':return x+y
                if op=='SUBTRACT':return x-y
                if op=='LESS_THAN':return float(x<y)
                if op=='GREATER_THAN':return float(x>y)
                return x
        elif t=='SEPXYZ':
            a=inp(n.inputs[0]);idx={'X':0,'Y':1,'Z':2}.get(sid,0)
            f=lambda p,g,w,a=a,idx=idx:v3(a(p,g,w))[idx]
        else:
            c=tuple(material.diffuse_color)
            f=lambda p,g,w,c=c:c
        cache[key]=f;return f
    # White sand should keep its actual sand palette. Animated, projected
    # caustics/brightness on top of it are supplied by the browser.
    if material.name in {'Sea floor | warm white fine coral sand','Wet ivory sand on submerged beach slope','Sea | cool sandy lagoon bed'}:
        ramp=next((n for n in material.node_tree.nodes if n.type=='VALTORGB'),None)
        if ramp:return node(ramp.outputs[0])
    return inp(p.inputs['Base Color'])

# Reduce curves far below pixel size; preserve original editable source data.
reductions=[]
for obj in export_source_objects:
    if obj.type=='FONT' and not obj.hide_render:
        reductions.append({'name':obj.name,'font_resolution_before':obj.data.resolution_u,'after':3})
        obj.data=obj.data.copy();obj.data.resolution_u=3;obj.data.bevel_resolution=1
    if 'continuous soft silhouette' in obj.name and not obj.hide_render:
        for m in obj.modifiers:
            if m.type=='SUBSURF':m.levels=0;m.render_levels=0
if LOD:
    for obj in export_source_objects:
        if obj.hide_render:continue
        if obj.type=='CURVE':
            if obj.data.bevel_resolution>1:
                obj.data=obj.data.copy();obj.data.bevel_resolution=1
        elif obj.type=='MESH':
            names=' '.join(m.name.lower() for m in obj.data.materials if m)
            ratio=None
            if 'ivory sea foam' in names:ratio=.12
            elif 'granite' in names or 'rock_dark' in names:ratio=.33
            elif 'continuous soft silhouette' in obj.name:ratio=.5
            elif 'green' in names:ratio=None if 'rosette' in obj.name.lower() else .7 if 'coherent notched fronds' in obj.name else .45
            elif 'pollen' in names or 'sea floor shells' in names:ratio=.28
            elif 'white fine coral sand' in names and len(obj.data.vertices)>1000:ratio=.65
            elif len(obj.data.vertices)==222:ratio=.45
            if ratio:
                mod=obj.modifiers.new('Independent web preview detail reduction','DECIMATE');mod.ratio=ratio
                reductions.append({'name':obj.name,'decimateRatio':ratio})
bpy.context.view_layer.update()
dg=bpy.context.evaluated_depsgraph_get()

R=np.array([[1,0,0],[0,0,1],[0,-1,0]],dtype=np.float32)
boatobj=bpy.data.objects.get('Boat | gentle floating motion')
boatpivot=R@np.array(boatobj.matrix_world.translation,dtype=np.float32) if boatobj else np.array([3.47,.2,3.48],dtype=np.float32)

skip_exact={'Sea — single closed wavy volume','Seamless blue ground'}

# Geometry remains baked in the authored world orientation, preserving size.
# Only translation is moved onto actor/limb nodes so web rotation can animate
# the independent pieces around exactly the authored pivot points.
def read_json_property(owner, key, default):
    value = owner.get(key)
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return default
    if hasattr(value, 'to_list'):
        return value.to_list()
    if hasattr(value, 'to_dict'):
        return value.to_dict()
    return value

def web_vector(value):
    return (R @ np.array(value, dtype=np.float32)).tolist()

def web_xz(value):
    return [float(value[0]), -float(value[1])]

actor_roots = {}
for obj in export_source_objects:
    actor_id = obj.get('harbor_actor_id')
    if actor_id and obj.type == 'EMPTY':
        actor_id = str(actor_id)
        if not all(c.isalnum() or c in '_-' for c in actor_id):
            raise ValueError('Actor id must use letters, numbers, underscores or hyphens')
        if actor_id in actor_roots:
            raise ValueError('Duplicate actor id: ' + actor_id)
        actor_roots[actor_id] = obj

actor_parts = {}
actor_meta = []
for actor_id, root in actor_roots.items():
    name = 'ACTOR_' + actor_id
    pivot = R @ np.array(root.matrix_world.translation, dtype=np.float32)
    route = read_json_property(root, 'harbor_actor_route', [])
    if isinstance(route, dict):
        route = route.get('points', [])
    route = [web_vector(p if len(p) == 3 else [p[0],p[1],root.matrix_world.translation.z])
             for p in route]
    forward = read_json_property(root, 'harbor_actor_forward', [0,-1,0])
    actor = {'id': actor_id, 'node': name, 'pivot': pivot.tolist(),
             'route': route, 'speed': float(root.get('harbor_actor_speed', .24)),
             'forward': web_vector(forward), 'pose': str(root.get('harbor_actor_pose', 'walk')),
             'closed': bool(root.get('harbor_actor_route_closed', True)),
             'phase': float(root.get('harbor_actor_phase', 0)),
             'limbs': {}}
    actor_parts[name + ':BODY'] = {'actor':actor_id, 'part':'BODY', 'pivot':pivot,
                                 'node':name+'_BODY', 'axis':[1,0,0]}
    for obj in root.children_recursive:
        limb = obj.get('harbor_limb')
        if obj.type != 'EMPTY' or not limb:
            continue
        limb = str(limb).upper()
        if limb not in {'LEFT_LEG','RIGHT_LEG','LEFT_ARM','RIGHT_ARM','HEAD','FRONT_LEFT_LEG','FRONT_RIGHT_LEG','BACK_LEFT_LEG','BACK_RIGHT_LEG','TAIL'}:
            raise ValueError('Unsupported actor limb: ' + limb)
        key = name + ':' + limb
        if key in actor_parts:
            raise ValueError('Duplicate limb: ' + key)
        limb_pivot = R @ np.array(obj.matrix_world.translation, dtype=np.float32)
        axis = web_vector(read_json_property(obj, 'harbor_limb_axis', [1,0,0]))
        actor_parts[key] = {'actor':actor_id, 'part':limb, 'pivot':limb_pivot,
                            'node':name+'_'+limb, 'axis':axis}
        actor['limbs'][limb] = {'node':name+'_'+limb, 'pivot':(limb_pivot-pivot).tolist(),
                               'axis':axis}
    actor_meta.append(actor)

def actor_category(obj):
    parent = obj
    limb = 'BODY'
    while parent:
        if parent.get('harbor_limb'):
            limb = str(parent['harbor_limb']).upper()
        actor_id = parent.get('harbor_actor_id')
        if actor_id and str(actor_id) in actor_roots:
            key = 'ACTOR_' + str(actor_id) + ':' + limb
            if key not in actor_parts:
                raise ValueError('Missing actor pivot for ' + obj.name + ': ' + key)
            return key
        parent = parent.parent
    return None

navigation = read_json_property(scene, 'harbor_navigation_json', {})
shoreline = [web_xz(p) for p in navigation.get('shoreline', [])]
land_boundary = [web_xz(p) for p in navigation.get('landBoundary', [])]
boat_obstacles = []
for obstacle in navigation.get('boatObstacles', []):
    if 'center' in obstacle:
        boat_obstacles.append({**obstacle, 'center':web_xz(obstacle['center'])})
    elif 'polygon' in obstacle:
        boat_obstacles.append({**obstacle, 'polygon':[web_xz(p) for p in obstacle['polygon']]})
sea_object = scene.objects.get('Sea — single closed wavy volume')
water_radius = float(navigation.get('waterRadius',
    scene.get('harbor_water_radius', max(sea_object.dimensions.x,sea_object.dimensions.y)/2 if sea_object else 8.5)))
water_depth = float(navigation.get('waterDepth', scene.get('harbor_water_depth', 1.64)))


def category(o):
    actor = actor_category(o)
    if actor: return actor
    name=o.name.lower();coll=' '.join(c.name for c in o.users_collection).lower()
    parent=o.parent
    while parent:
        if parent==boatobj:return 'BOAT'
        parent=parent.parent
    if 'cloud' in name:return 'CLOUDS'
    if 'foam' in name or 'crest' in name or 'reflection accents' in coll:return 'FOAM'
    if 'submerged' in coll or 'white coral sand' in coll or name=='sand under water':return 'SEABED'
    return 'STATIC'

materials=[];matmap={};evaluators={};surface_details={}
def material_id(m):
    name=m.name if m else 'Default'
    if name in matmap:return matmap[name]
    p=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None) if m and m.use_nodes else None
    rough=float(p.inputs['Roughness'].default_value) if p else .7
    metal=float(p.inputs['Metallic'].default_value) if p else 0
    emiss=[0,0,0]
    if p and not p.inputs['Emission Strength'].is_linked:
        strength=float(p.inputs['Emission Strength'].default_value)
        # Only authored lanterns emit; avoid freezing projected seabed caustics.
        if 'glow' in name.lower():emiss=[min(1,float(v)*strength) for v in p.inputs['Emission Color'].default_value[:3]]
    md={'name':name,'pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':metal,'roughnessFactor':rough},'doubleSided':True,'emissiveFactor':emiss,'extras':{'sourceMaterial':name,'linearVertexColor':True,'sourceBaseColor':list(m.diffuse_color) if m else [.5,.5,.5,1],'sourceRoughness':rough,'surfaceKind':('wood' if any(x in name.lower() for x in ['wood','cedar','bark','sign board']) else 'sand' if 'sand' in name.lower() else 'rock' if any(x in name.lower() for x in ['rock','granite','stone','earth']) else 'leaf' if 'green' in name.lower() else 'other')}}
    i=len(materials);materials.append(md);matmap[name]=i;evaluators[i]=compile_color(m)
    detail_kind=kind_for_material(name)
    if detail_kind:
        surface_details[i]=detail_kind
        md['extras']['surfaceKind']=detail_kind
        md['extras']['embeddedMicroSurface']=True
    return i

groups={};records=[];excluded=sorted(o.name for o in excluded_environment)
for number,o in enumerate(export_source_objects):
    if o.type not in {'MESH','CURVE','FONT'} or o.hide_render:continue
    colls=[c.name for c in o.users_collection]
    if o.name in skip_exact or any('Studio / cameras / light' in c for c in colls):
        excluded.append(o.name);continue
    if 'reflection' in o.name.lower() or 'whitecap' in o.name.lower() or any('reflection accents' in c for c in colls):
        excluded.append(o.name);continue
    if number%200==0:print('EXPORT_PROGRESS',number,'groups',len(groups),'seconds',round(time.time()-START,1),flush=True)
    cat=category(o)
    e=o.evaluated_get(dg);mesh=e.to_mesh()
    if not len(mesh.vertices) or not len(mesh.polygons):e.to_mesh_clear();continue
    mesh.calc_loop_triangles()
    nverts=len(mesh.vertices);nloops=len(mesh.loops);ntris=len(mesh.loop_triangles)
    coords=np.empty(nverts*3,np.float32);mesh.vertices.foreach_get('co',coords);coords=coords.reshape(-1,3)
    mw=np.array(o.matrix_world,dtype=np.float32)
    world=coords@mw[:3,:3].T+mw[:3,3]
    pos=world@R.T
    if cat=='BOAT':pos-=boatpivot
    elif cat in actor_parts:pos-=actor_parts[cat]['pivot']
    norms=np.empty(nloops*3,np.float32);mesh.corner_normals.foreach_get('vector',norms);norms=norms.reshape(-1,3)
    local_norms=norms.copy()
    nm=np.linalg.inv(mw[:3,:3]).T
    norms=norms@nm.T@R.T
    norms/=np.maximum(np.linalg.norm(norms,axis=1,keepdims=True),1.e-12)
    loop_vids=np.empty(nloops,np.int32);mesh.loops.foreach_get('vertex_index',loop_vids)
    triangle_loops=np.empty(ntris*3,np.int32);mesh.loop_triangles.foreach_get('loops',triangle_loops);triangle_loops=triangle_loops.reshape(-1,3)
    tri_polys=np.empty(ntris,np.int32);mesh.loop_triangles.foreach_get('polygon_index',tri_polys)
    poly_mats=np.empty(len(mesh.polygons),np.int32);mesh.polygons.foreach_get('material_index',poly_mats)
    triangle_mats=poly_mats[tri_polys]
    bbox=np.array(o.bound_box,dtype=np.float32);bbmin=bbox.min(axis=0);bbsize=np.maximum(bbox.max(axis=0)-bbmin,.00001)
    gen=(coords-bbmin)/bbsize
    counts=[]
    for matidx in np.unique(triangle_mats):
        m=mesh.materials[int(matidx)] if matidx<len(mesh.materials) else None
        mi=material_id(m)
        selected_triangles=triangle_loops[triangle_mats==matidx]
        selected_loops=selected_triangles.reshape(-1)
        ids=loop_vids[selected_loops]
        detail_kind=surface_details.get(mi)
        selected_axes=None
        # Split projection changes per triangle, avoiding interpolated UV jumps.
        if detail_kind:
            uv_normals=local_norms if detail_kind in {'wood','fabric'} else norms
            triangle_axes=np.argmax(np.abs(uv_normals[selected_triangles].mean(axis=1)),axis=1)
            selected_axes=np.repeat(triangle_axes,3)
            key=np.column_stack((ids,np.rint(norms[selected_loops]*10000).astype(np.int32),selected_axes))
        else:
            key=np.column_stack((ids,np.rint(norms[selected_loops]*10000).astype(np.int32)))
        _,first,inverse=np.unique(key,axis=0,return_index=True,return_inverse=True)
        unique_ids=ids[first];unique_loops=selected_loops[first]
        p=pos[unique_ids].astype('<f4');n=norms[unique_loops].astype('<f4')
        uv=None
        if detail_kind:
            uv=np.empty((len(unique_ids),2),dtype='<f4')
            axis=selected_axes[first]
            if detail_kind in {'wood','fabric'}:
                object_scale=np.linalg.norm(mw[:3,:3],axis=0)
                uv_positions=coords[unique_ids]*object_scale
                span=bbsize*object_scale
            else:
                uv_positions=world[unique_ids]@R.T
                span=None
            for drop in range(3):
                mask=axis==drop
                plane=[j for j in range(3) if j!=drop]
                if span is not None and span[plane[0]]>span[plane[1]]:
                    plane.reverse() # grain follows the longer object dimension
                uv[mask]=uv_positions[mask][:,plane]*SPECS[detail_kind]['uvScale']
        vertids,remap=np.unique(unique_ids,return_inverse=True)
        ev=evaluators[mi]
        colors=[]
        for v in vertids:
            try:c=rgba(ev(tuple(coords[v]),tuple(gen[v]),tuple(world[v])))
            except Exception:c=tuple(m.diffuse_color) if m else (.5,.5,.5,1)
            colors.append([round(clamp(float(x))*255) for x in c[:3]]+[255])
        color=np.array(colors,dtype=np.uint8)[remap]
        k=(cat,mi)
        if k not in groups:groups[k]={'pos':[],'norm':[],'color':[],'uv':[],'indices':[],'count':0,'objects':[]}
        g=groups[k];g['pos'].append(p);g['norm'].append(n);g['color'].append(color);g['indices'].append(inverse.astype(np.uint32)+g['count']);g['count']+=len(p);g['objects'].append(o.name)
        if uv is not None:g['uv'].append(uv)
        counts.append(len(inverse)//3)
    records.append({'name':o.name,'category':cat,'vertices':nverts,'triangles':sum(counts),'min':(world@R.T).min(axis=0).tolist(),'max':(world@R.T).max(axis=0).tolist()})
    e.to_mesh_clear()

blob=bytearray();views=[];accessors=[];meshes=[];nodes=[]
def accessor(arr,typ,component,target,normalized=False,bounds=False,stride=None):
    global blob
    while len(blob)%4:blob.append(0)
    off=len(blob);data=arr.tobytes();blob.extend(data)
    vi=len(views);views.append({'buffer':0,'byteOffset':off,'byteLength':len(data),'target':target})
    if stride:views[-1]['byteStride']=stride
    a={'bufferView':vi,'componentType':component,'count':len(arr),'type':typ}
    if normalized:a['normalized']=True
    if bounds:a.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
    idx=len(accessors);accessors.append(a);return idx

categories=defaultdict(list);group_report=[]
for (cat,mi),g in groups.items():
    p=np.concatenate(g['pos']);n=np.concatenate(g['norm']);c=np.concatenate(g['color']);ind=np.concatenate(g['indices'])
    nq=np.zeros((len(n),4),dtype='<i2');nq[:,:3]=np.rint(np.clip(n,-1,1)*32767).astype('<i2')
    if len(p)<65536:ind=ind.astype('<u2');ctype=5123
    else:ind=ind.astype('<u4');ctype=5125
    primitive={'attributes':{'POSITION':accessor(p,'VEC3',5126,34962,bounds=True),'NORMAL':accessor(nq,'VEC3',5122,34962,normalized=True,stride=8),'COLOR_0':accessor(c,'VEC4',5121,34962,normalized=True)},'indices':accessor(ind,'SCALAR',ctype,34963),'material':mi,'mode':4}
    if g['uv']:primitive['attributes']['TEXCOORD_0']=accessor(np.concatenate(g['uv']),'VEC2',5126,34962)
    meshidx=len(meshes);meshes.append({'name':cat+' | '+materials[mi]['name'],'primitives':[primitive]})
    ni=len(nodes);nodes.append({'name':cat+' | '+materials[mi]['name'],'mesh':meshidx,'extras':{'category':cat,'sourceObjectCount':len(g['objects'])}})
    categories[cat].append(ni)
    group_report.append({'category':cat,'material':materials[mi]['name'],'vertices':len(p),'triangles':len(ind)//3,'sourceObjects':len(g['objects'])})
roots=[]
actor_children=defaultdict(list)
for cat,children in categories.items():
    ni=len(nodes)
    if cat in actor_parts:
        part=actor_parts[cat]
        actor=next(a for a in actor_meta if a['id']==part['actor'])
        node={'name':part['node'],'children':children,
              'translation':(part['pivot']-np.array(actor['pivot'])).tolist(),
              'extras':{'category':'ACTOR','actorId':part['actor'],'limb':part['part'],'axis':part['axis']}}
        nodes.append(node);actor_children[part['actor']].append(ni)
    else:
        node={'name':cat,'children':children,'extras':{'category':cat}}
        if cat=='BOAT':node['translation']=boatpivot.tolist()
        nodes.append(node);roots.append(ni)
for actor in actor_meta:
    if not actor_children[actor['id']]:
        raise ValueError('Actor has no visible geometry: '+actor['id'])
    nodes.append({'name':actor['node'],'translation':actor['pivot'],
                  'children':actor_children[actor['id']],
                  'extras':{'category':'ACTOR','actorId':actor['id'],'forward':actor['forward'],'pose':actor['pose']}})
    roots.append(len(nodes)-1)
# PNG images live inside the same GLB buffer; no external asset requests.
images=[];textures=[];texture_sets={}
def embed_image(data,name):
    while len(blob)%4:blob.append(0)
    off=len(blob);blob.extend(data)
    vi=len(views);views.append({'buffer':0,'byteOffset':off,'byteLength':len(data)})
    ii=len(images);images.append({'name':name,'bufferView':vi,'mimeType':'image/png'})
    ti=len(textures);textures.append({'name':name,'sampler':0,'source':ii})
    return ti
for mi,kind in surface_details.items():
    if kind not in texture_sets:
        normal,roughness=build_texture_pair(kind)
        texture_sets[kind]=(embed_image(normal,'Harbor '+kind+' micro normal'),
                            embed_image(roughness,'Harbor '+kind+' micro roughness'))
    normal_index,rough_index=texture_sets[kind]
    materials[mi]['normalTexture']={'index':normal_index,'texCoord':0,'scale':SPECS[kind]['normalScale']}
    materials[mi]['pbrMetallicRoughness']['metallicRoughnessTexture']={'index':rough_index,'texCoord':0}
while len(blob)%4:blob.append(0)
gltf={'asset':{'version':'2.0','generator':'Harbor independent viewer exporter / evaluated geometry and procedural vertex colors'},'extensionsUsed':['KHR_mesh_quantization'],'extensionsRequired':['KHR_mesh_quantization'],'scene':0,'scenes':[{'name':'Small Goods — independent harbor preview','nodes':roots}],'nodes':nodes,'meshes':meshes,'materials':materials,'accessors':accessors,'bufferViews':views,'buffers':[{'byteLength':len(blob)}]}
if images:
    gltf.update(images=images,textures=textures,
                samplers=[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}])
js=json.dumps(gltf,ensure_ascii=False,separators=(',',':')).encode('utf8')
while len(js)%4:js+=b' '
path=OUT/('harbor'+SUFFIX+'.glb')
with path.open('wb') as f:
    f.write(struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(blob)))
    f.write(struct.pack('<II',len(js),0x4e4f534a));f.write(js)
    f.write(struct.pack('<II',len(blob),0x004e4942));f.write(blob)
cam=scene.camera
metadata={'sourceScene':scene.name,'sourceFile':Path(bpy.data.filepath).name,'sourceBlendSha256':hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%S'),'coordinateSystem':'glTF right-handed Y-up: Blender (x,y,z) to (x,z,-y)','groupNames':[nodes[i]['name'] for i in roots],'boatPivot':boatpivot.tolist(),'water':{'radius':water_radius,'surfaceY':0,'bottomY':-water_depth,'depth':water_depth,'loopSeconds':6,'shoreline':shoreline},'camera':{'position':(R@np.array(cam.matrix_world.translation)).tolist(),'target':[0,1.25,0],'orthographicScale':cam.data.ortho_scale},'sourceObjectCount':len(records),'drawCalls':len(groups),'triangles':sum(x['triangles'] for x in group_report),'vertices':sum(x['vertices'] for x in group_report),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'materialMode':'Procedural base-color palette sampled into linear vertex colors; dynamic water and projected caustics are authored by the viewer. Embedded normal and roughness maps preserve fine surface response as procedural approximations.','clouds':[r for r in records if r['category']=='CLOUDS'],'groups':group_report,'excluded':excluded,'reductions':reductions,'seconds':round(time.time()-START,2)}

metadata.update({
    'schemaVersion':2,
    'embeddedMicroTextures':{'imageCount':len(images),'materialCount':len(surface_details),'kinds':list(texture_sets),'resolution':128,'mode':'Embedded repeating micro-normal and roughness maps supplement the sampled source palette; no baked lighting and no external image paths.'},
    'shoreline':shoreline,
    'landBoundary':land_boundary,
    'boatObstacles':boat_obstacles,
    'boatForward':navigation.get('boatForward', [-.819152,0,.573576]),
    'actors':actor_meta,
    'tray':navigation.get('tray', {'bottomY':-2.55}),
    'animationMode':'Web runtime animates actor routes and limbs, boat buoyancy and navigation, and the interactive height-field water. GLB contains geometry and named pivots, not baked animation tracks.',
})
assert not any(':' in actor['id'] for actor in actor_meta)

(OUT/('scene-meta'+SUFFIX+'.json')).write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf8')
(OUT/('export-report'+SUFFIX+'.json')).write_text(json.dumps({**metadata,'objects':records},ensure_ascii=False,indent=2),encoding='utf8')
print('HARBOR_EXPORT_COMPLETE',json.dumps({k:metadata[k] for k in ['sourceObjectCount','drawCalls','triangles','vertices','bytes','seconds']}),flush=True)
