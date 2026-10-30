import bpy, array, hashlib, json

def ids():
    seen=set()
    for prop in bpy.data.bl_rna.properties:
        if prop.type != 'COLLECTION': continue
        try: values=getattr(bpy.data,prop.identifier)
        except: continue
        for value in values:
            if isinstance(value,bpy.types.ID) and value.as_pointer() not in seen:
                seen.add(value.as_pointer()); yield value
                tree=getattr(value,'node_tree',None)
                if tree and tree.as_pointer() not in seen:
                    seen.add(tree.as_pointer()); yield tree

def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True).encode()).hexdigest()

def state(scene):
    object_rows=[]; meshes={}; materials={}; drivers=[]
    dependencies={scene};reverse={}
    for dependency,users in bpy.data.user_map().items():
        for user in users:reverse.setdefault(user,set()).add(dependency)
    queue=[scene]
    while queue:
        for dependency in reverse.get(queue.pop(),set()):
            if dependency not in dependencies:dependencies.add(dependency);queue.append(dependency)
    for obj in sorted(scene.objects,key=lambda x:x.name):
        row=[obj.name,obj.type,obj.hide_render,obj.hide_viewport,
             obj.parent.name if obj.parent else None,
             [list(r) for r in obj.matrix_basis],
             [list(r) for r in obj.matrix_parent_inverse],
             [(m.name,m.type) for m in obj.modifiers]]
        if obj.type=='MESH':
            meshes[obj.data.name]=obj.data
        if hasattr(obj.data,'materials'):
            row += [[m.name if m else None for m in obj.data.materials]]
            materials.update((m.name,m) for m in obj.data.materials if m)
        if obj.type in {'FONT','CURVE'}:
            row += [str(getattr(obj.data,'body','')),
                    [(s.type,len(s.points),len(s.bezier_points)) for s in obj.data.splines]]
        object_rows.append(row)
    geometry=hashlib.sha256()
    for name,mesh in sorted(meshes.items()):
        geometry.update(name.encode())
        for values,prop,width,kind in [(mesh.vertices,'co',3,'f'),(mesh.edges,'vertices',2,'i'),
             (mesh.loops,'vertex_index',1,'i'),(mesh.polygons,'loop_start',1,'i'),
             (mesh.polygons,'loop_total',1,'i'),(mesh.polygons,'material_index',1,'i')]:
            data=array.array(kind,[0])*(len(values)*width)
            values.foreach_get(prop,data);geometry.update(data.tobytes())
        if mesh.shape_keys:
            for key in mesh.shape_keys.key_blocks:
                data=array.array('f',[0])*(len(key.data)*3)
                key.data.foreach_get('co',data);geometry.update(data.tobytes())
    material_rows=[]
    for name,mat in sorted(materials.items()):
        nodes=[];links=[]
        if mat.node_tree:
            for node in sorted(mat.node_tree.nodes,key=lambda n:n.name):
                sockets=[]
                for socket in node.inputs:
                    if not hasattr(socket,'default_value'):continue
                    value=socket.default_value
                    try:value=list(value)
                    except TypeError:value=str(value)
                    sockets.append([socket.identifier,value])
                nodes.append([node.name,node.type,sockets])
            links=sorted((l.from_node.name,l.from_socket.identifier,l.to_node.name,l.to_socket.identifier) for l in mat.node_tree.links)
        material_rows.append([name,list(mat.diffuse_color),nodes,links])
    for item in ids():
        if item not in dependencies:continue
        anim=getattr(item,'animation_data',None)
        if anim:
            for curve in anim.drivers:
                drivers.append([item.bl_rna.identifier,item.name,curve.data_path,curve.array_index,
                    curve.driver.expression,[(v.name,v.type,[(t.id.name if t.id else None,t.data_path) for t in v.targets]) for v in curve.driver.variables]])
    env=bpy.data.collections.get('POV_ENVIRONMENT')
    return {'scene':scene.name,'objects':len(scene.objects),
        'meshObjects':sum(o.type=='MESH' for o in scene.objects),
        'curveObjects':sum(o.type=='CURVE' for o in scene.objects),
        'textObjects':sum(o.type=='FONT' for o in scene.objects),
        'cameraCount':sum(o.type=='CAMERA' for o in scene.objects),
        'lightCount':sum(o.type=='LIGHT' for o in scene.objects),
        'materials':len(materials),'activeCamera':scene.camera.name if scene.camera else None,
        'frames':[scene.frame_start,scene.frame_end],'fps':scene.render.fps,
        'driverCount':len(drivers),'driverHash':digest(sorted(drivers)),
        'objectStateHash':digest(object_rows),'geometryHash':geometry.hexdigest(),
        'materialHash':digest(material_rows),'environmentObjects':len(env.all_objects) if env else 0,
        'environmentHidden':{'viewport':env.hide_viewport,'render':env.hide_render} if env else None,
        'movableSailboatRoots':sorted(o.name for o in env.all_objects if o.type=='EMPTY' and o.name.startswith('HORIZON_BOAT_')) if env else []}
