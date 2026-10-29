"""Rebuild the isolated POV horizon in the open harbor working copy.

Run in Blender's Python context with __file__ pointing to this script. Existing
harbor objects, materials, camera, and geometry are verified before and after.
The GLB contains merged static meshes plus three independently movable sailboats,
and no custom properties or file paths.
"""

import array
import bpy
import bmesh
import hashlib
import json
import math
import random
from pathlib import Path
from mathutils import Vector


SCENE_NAME = "Small Goods · Reference Harbor"
BLEND_NAME = "small-goods-harbor-pov.blend"
COLLECTION_NAME = "POV_ENVIRONMENT"
PREFIX = "POV_Horizon_"
assert bpy.context.scene.name == SCENE_NAME, "Unexpected active scene"
assert Path(bpy.data.filepath).name == BLEND_NAME, "Use the POV working copy"
assert bpy.context.mode == "OBJECT", "Run in Object mode"
ROOT = Path(bpy.data.filepath).resolve().parent.parent
OUTPUT = ROOT / "output"
OUTPUT.mkdir(exist_ok=True)
GLB = ROOT / "dist" / "public" / "assets" / "harbor-horizon.glb"
scene = bpy.context.scene


def original_snapshot():
    """Hash complete original mesh arrays, transforms and material node graphs."""
    env = bpy.data.collections.get(COLLECTION_NAME)
    excluded = set(env.all_objects) if env else set()
    objects = sorted((o for o in scene.objects if o not in excluded), key=lambda o: o.name)
    digest = hashlib.sha256()
    meshes = {}
    materials = {}
    counts = {"objects": len(objects), "meshes": 0, "vertices": 0, "polygons": 0}
    for obj in objects:
        digest.update(json.dumps({
            "name": obj.name, "type": obj.type,
            "data": obj.data.name if obj.data else None,
            "matrix": [list(row) for row in obj.matrix_world],
            "hide_render": obj.hide_render, "hide_viewport": obj.hide_viewport,
            "materials": [m.name if m else None for m in obj.data.materials]
                if obj.type == "MESH" else [],
        }, sort_keys=True).encode())
        if obj.type == "MESH":
            meshes[obj.data.name] = obj.data
            for material in obj.data.materials:
                if material:
                    materials[material.name] = material
    for name, mesh in sorted(meshes.items()):
        counts["meshes"] += 1
        counts["vertices"] += len(mesh.vertices)
        counts["polygons"] += len(mesh.polygons)
        digest.update(name.encode())
        for collection, prop, width, kind in (
            (mesh.vertices, "co", 3, "f"),
            (mesh.edges, "vertices", 2, "i"),
            (mesh.loops, "vertex_index", 1, "i"),
            (mesh.polygons, "material_index", 1, "i"),
            (mesh.polygons, "loop_start", 1, "i"),
            (mesh.polygons, "loop_total", 1, "i"),
        ):
            values = array.array(kind, [0]) * (len(collection) * width)
            collection.foreach_get(prop, values)
            digest.update(values.tobytes())
    for name, mat in sorted(materials.items()):
        digest.update(name.encode())
        digest.update(str(tuple(mat.diffuse_color)).encode())
        if mat.node_tree:
            for node in sorted(mat.node_tree.nodes, key=lambda n: n.name):
                digest.update((node.name + node.bl_idname).encode())
                for socket in node.inputs:
                    if hasattr(socket, "default_value"):
                        value = socket.default_value
                        try:
                            value = list(value)
                        except TypeError:
                            value = str(value)
                        digest.update(str((socket.name, value)).encode())
            digest.update(str(sorted((l.from_node.name, l.from_socket.name,
                                      l.to_node.name, l.to_socket.name)
                                     for l in mat.node_tree.links)).encode())
    counts["sha256"] = digest.hexdigest()
    counts["camera"] = scene.camera.name if scene.camera else None
    counts["frame"] = scene.frame_current
    return counts


before = original_snapshot()
selected_names = [o.name for o in bpy.context.selected_objects]
active_name = bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None
old_collection = bpy.data.collections.get(COLLECTION_NAME)
if old_collection:
    for obj in list(old_collection.all_objects):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data and data.users == 0 and isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)
    bpy.data.collections.remove(old_collection)
for mat in list(bpy.data.materials):
    if mat.name.startswith(PREFIX) and mat.users == 0:
        bpy.data.materials.remove(mat)

collection = bpy.data.collections.new(COLLECTION_NAME)
scene.collection.children.link(collection)
collection["purpose"] = "Distant islands and clouds for first-person views"
collection["coordinates"] = "glTF Y up; authored in meters"
rng = random.Random(1029)
buckets = {}


def material(key, color, emission=0):
    mat = bpy.data.materials.new(PREFIX + key)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    principled = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    principled.inputs["Base Color"].default_value = (*color, 1)
    principled.inputs["Roughness"].default_value = 0.95
    principled.inputs["Metallic"].default_value = 0
    if emission:
        principled.inputs["Emission Color"].default_value = (*color, 1)
        principled.inputs["Emission Strength"].default_value = emission
    buckets[key] = {"material": mat, "vertices": [], "faces": [], "smooth": []}


material("Stone", (0.29, 0.365, 0.325))
material("Canopy", (0.21, 0.335, 0.235))
material("Chalk", (0.77, 0.765, 0.66))
material("BeaconRoof", (0.235, 0.30, 0.31))
material("Cloud", (0.88, 0.915, 0.92), emission=0.22)
material("BoatTimber", (0.30, 0.18, 0.105))


def append_mesh(key, verts, faces, smooth=True):
    bucket = buckets[key]
    start = len(bucket["vertices"])
    # Explicit conversion: (x, y, z) in glTF becomes (x, -z, y) in Blender.
    bucket["vertices"].extend((x, -z, y) for x, y, z in verts)
    bucket["faces"].extend(tuple(start + i for i in face) for face in faces)
    bucket["smooth"].extend([smooth] * len(faces))


def ellipsoid(key, center, scale, rotation=0, subdivisions=2, roughness=0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=1)
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    c, s = math.cos(rotation), math.sin(rotation)
    vertices = []
    for v in bm.verts:
        noise = 1 + roughness * math.sin(v.co.x * 7 + v.co.y * 3 + v.co.z * 5)
        x, y, z = (v.co[i] * scale[i] * noise for i in range(3))
        vertices.append((center[0] + c*x - s*z, center[1] + y, center[2] + s*x + c*z))
    faces = [tuple(v.index for v in face.verts) for face in bm.faces]
    bm.free()
    append_mesh(key, vertices, faces)


ISLANDS = [
    {"name": "Split ridge", "center": (-39, -24), "rx": 5.6, "rz": 2.65,
     "angle": -0.20, "height": 4.05, "phase": 0.4},
    {"name": "Beacon islet", "center": (38, 30), "rx": 3.85, "rz": 2.45,
     "angle": 0.55, "height": 2.45, "phase": 2.2},
    {"name": "Long green island", "center": (-4, 55), "rx": 5.9, "rz": 2.8,
     "angle": -0.12, "height": 3.15, "phase": 4.1},
    {"name": "Outer ridge", "center": (-56, -27), "rx": 4.2, "rz": 2.0,
     "angle": .28, "height": 3.3, "phase": 1.7},
    {"name": "Twin shoulder island", "center": (24, 50), "rx": 4.8, "rz": 2.5,
     "angle": -.32, "height": 3.65, "phase": 3.7},
    {"name": "Quiet cay", "center": (32, -21), "rx": 3.55, "rz": 1.9,
     "angle": .31, "height": 2.25, "phase": 5.5},
]


def relief(u, v, island):
    r = math.hypot(u, v)
    fade = max(0, 1 - r**2.5)
    # Two unequal humps avoid a cone or a repeated round pebble silhouette.
    a = math.exp(-((u + .27)**2 / .20 + (v + .03)**2 / .36))
    b = .73 * math.exp(-((u - .33)**2 / .13 + (v - .12)**2 / .31))
    shelf = .16 * max(0, 1 - r)
    return .055 + island["height"] * min(1, .14 + max(a, b)) * fade + shelf


def world(u, v, height, island):
    x, z = u * island["rx"], v * island["rz"]
    c, s = math.cos(island["angle"]), math.sin(island["angle"])
    return (island["center"][0] + c*x - s*z, height,
            island["center"][1] + s*x + c*z)


for island in ISLANDS:
    segments = 40
    rings = [.15, .32, .52, .72, .88, 1]
    vertices = [world(0, 0, relief(0, 0, island), island)]
    for r in rings:
        for i in range(segments):
            angle = math.tau * i / segments
            irregularity = 1 + .055*math.sin(3*angle + island["phase"]) + .03*math.cos(7*angle)
            u, v = r * math.cos(angle) * irregularity, r * math.sin(angle) * irregularity
            height = relief(u, v, island)
            if r < .9:
                height += .06 * math.sin(i*1.7 + r*6) * (1-r)
            vertices.append(world(u, v, height, island))
    faces = []
    for i in range(segments):
        faces.append((0, 1 + (i+1)%segments, 1+i))
    for ring in range(len(rings)-1):
        a, b = 1+ring*segments, 1+(ring+1)*segments
        for i in range(segments):
            j = (i+1)%segments
            faces.extend([(a+i, a+j, b+i), (a+j, b+j, b+i)])
    # A closed skirt extends below the water instead of hovering on it.
    outer = 1 + (len(rings)-1)*segments
    bottom = len(vertices)
    for i in range(segments):
        x, _, z = vertices[outer+i]
        vertices.append((x, -.28, z))
    for i in range(segments):
        j = (i+1)%segments
        faces.append((outer+i, outer+j, bottom+j, bottom+i))
    faces.append(tuple(bottom+i for i in range(segments)))
    append_mesh("Stone", vertices, faces)
    # A few exposed low rock shoulders preserve the recognizable green-gray coast.
    for u, v, sx, sy, sz in [(-.55,-.18,.9,.5,.7), (.35,.25,1.1,.6,.7), (.65,-.12,.75,.4,.6)]:
        ellipsoid("Stone", world(u,v,relief(u,v,island)-.18,island),
                  (sx,sy,sz), island["angle"], roughness=.08)
    for index in range(10 if island["rx"] > 4 else 7):
        u = rng.uniform(-.58, .55)
        v = rng.uniform(-.33, .29)
        base = relief(u,v,island)
        canopy = rng.uniform(.47,.78)
        ellipsoid("Canopy", world(u,v,base+.11,island),
                  (canopy,.25+canopy*.17,canopy*.68),
                  rng.uniform(0,math.tau), roughness=.07)


REEFS = [(-18,-10), (-24,6), (15,-13), (19,15)]
for index, (cx,cz) in enumerate(REEFS):
    for dx,dz,sx,sy,sz in [(-.8,-.12,.95,.39,.56),
                           (.15,.18,1.08,.68,.69),
                           (1.05,-.16,.62,.32,.48),
                           (.16,-.64,.54,.27,.41)]:
        ellipsoid("Stone", (cx+dx,sy*.48-.10,cz+dz),
                  (sx,sy,sz),index*.8,roughness=.13)


def cylinder(key, center, bottom_radius, top_radius, height, segments=12):
    vertices = []
    for y, radius in [(center[1], bottom_radius), (center[1]+height, top_radius)]:
        vertices.extend((center[0]+math.cos(i*math.tau/segments)*radius, y,
                         center[2]+math.sin(i*math.tau/segments)*radius) for i in range(segments))
    faces = []
    for i in range(segments):
        j = (i+1)%segments
        faces.append((i,segments+i,segments+j,j))
    faces.extend([tuple(range(segments)), tuple(segments+i for i in reversed(range(segments)))])
    append_mesh(key, vertices, faces, False)


beacon_island = ISLANDS[1]
beacon = world(-.20,-.15,relief(-.20,-.15,beacon_island)+.12,beacon_island)
cylinder("Chalk", beacon, .18, .135, .83)
cylinder("BeaconRoof", (beacon[0],beacon[1]+.77,beacon[2]), .22,.22,.10)
cylinder("Chalk", (beacon[0],beacon[1]+.87,beacon[2]), .105,.105,.17)
cylinder("BeaconRoof", (beacon[0],beacon[1]+1.04,beacon[2]), .20,0,.19)

CLOUDS = [
    {"center": (-30, 11.7, -49), "scale": .90, "angle": -.16},
    {"center": (47, 14.2, -28), "scale": 1.05, "angle": .30},
    {"center": (23, 10.8, 61), "scale": 1.13, "angle": -.18},
    {"center": (-52, 13.4, 29), "scale": .98, "angle": -.42},
    {"center": (-10, 18.0, 66), "scale": .74, "angle": .08},
]
for cloud in CLOUDS:
    cx, cy, cz = cloud["center"]
    scale = cloud["scale"]
    for x,y,z,sx,sy,sz in [(-3.1,-.15,0,2.8,.85,1.25),
                           (-1.0,.37,.10,2.45,1.38,1.58),
                           (1.1,.75,-.07,2.25,1.75,1.65),
                           (3.2,.0,.1,2.6,1.02,1.28),
                           (.25,-.36,.15,4.1,.62,1.62)]:
        c,s = math.cos(cloud["angle"]),math.sin(cloud["angle"])
        center = (cx+(c*x-s*z)*scale, cy+y*scale, cz+(s*x+c*z)*scale)
        ellipsoid("Cloud", center, (sx*scale,sy*scale,sz*scale), cloud["angle"])

BOATS = [
    {"node": "HORIZON_BOAT_01", "center": [-17,.0,19], "yaw": -.45, "scale": 1.0},
    {"node": "HORIZON_BOAT_02", "center": [24,.0,-7], "yaw": 1.20, "scale": .87},
    {"node": "HORIZON_BOAT_03", "center": [12,.0,29], "yaw": -.95, "scale": 1.12},
]
boat_parents = {}
for boat in BOATS:
    name = boat["node"]
    parent = bpy.data.objects.new(name, None)
    x,y,z = boat["center"]
    parent.location = (x,-z,y)
    parent.rotation_euler.z = boat["yaw"]
    parent.scale = (boat["scale"],)*3
    parent.empty_display_type = "PLAIN_AXES"
    parent.empty_display_size = .3
    collection.objects.link(parent)
    boat_parents[name] = parent
    for suffix, matkey in [("Hull", "BoatTimber"), ("Sail", "Chalk"), ("Spars", "BeaconRoof")]:
        buckets[name+"_"+suffix] = {
            "material": buckets[matkey]["material"], "vertices":[], "faces":[], "smooth":[],
            "parent": parent,
        }
    # Narrow pointed timber hull, +X bow, with a shallow keel below water.
    hull = [(-.72,.13,-.12),(-.50,.18,-.27),(.39,.18,-.26),(.88,.16,0),
            (.39,.18,.26),(-.50,.18,.27),(-.72,.13,.12),
            (-.63,-.09,-.055),(-.43,-.14,-.12),(.35,-.13,-.11),(.73,.04,0),
            (.35,-.13,.11),(-.43,-.14,.12),(-.63,-.09,.055)]
    faces = []
    for i in range(7):
        j=(i+1)%7
        faces.append((i,j,7+j,7+i))
    faces.extend([tuple(reversed(range(7))),tuple(7+i for i in range(7))])
    append_mesh(name+"_Hull", hull, faces, False)
    cylinder(name+"_Spars", (-.08,.18,0),.025,.018,1.42,8)
    # A curved patch rather than a single flat triangle catches oblique views.
    sail = [(-.07,1.57,0),(-.07,.45,0),(.69,.45,0),(.20,.78,.085)]
    append_mesh(name+"_Sail", sail, [(0,1,3),(1,2,3),(2,0,3)],False)
    jib = [(-.13,1.37,.015),(-.63,.43,.015),(-.13,.43,.015),(-.31,.69,-.055)]
    append_mesh(name+"_Sail", jib,[(0,1,3),(1,2,3),(2,0,3)],False)
    ellipsoid(name+"_Hull",(-.45,.24,0),(.11,.11,.11),subdivisions=1)
    boat["forward_gltf_xz"] = [math.cos(boat["yaw"]),-math.sin(boat["yaw"])]
    boat["length"] = 1.6*boat["scale"]

created = []
triangles = 0
for key, bucket in buckets.items():
    if not bucket["vertices"]:
        continue
    mesh = bpy.data.meshes.new(PREFIX+key)
    mesh.from_pydata(bucket["vertices"], [], bucket["faces"])
    mesh.materials.append(bucket["material"])
    mesh.update()
    # Recalculate closed-component face normals without changing any original data.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    for polygon, smooth in zip(mesh.polygons, bucket["smooth"]):
        polygon.use_smooth = smooth
    mesh.calc_loop_triangles()
    triangles += len(mesh.loop_triangles)
    obj = bpy.data.objects.new(key if key.startswith("HORIZON_BOAT") else PREFIX+key, mesh)
    collection.objects.link(obj)
    if bucket.get("parent"):
        obj.parent = bucket["parent"]
    created.append(obj)
assert triangles < 25000, f"Horizon is too complex: {triangles} triangles"
export_objects = created + list(boat_parents.values())

for obj in bpy.context.selected_objects:
    obj.select_set(False)
for obj in export_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = created[0]
bpy.ops.export_scene.gltf(
    filepath=str(GLB), export_format="GLB", use_selection=True,
    export_materials="EXPORT", export_animations=False, export_cameras=False,
    export_lights=False, export_extras=False, export_yup=True,
)
for obj in export_objects:
    obj.select_set(False)
for name in selected_names:
    obj = bpy.data.objects.get(name)
    if obj and obj.name in scene.objects:
        obj.select_set(True)
if active_name and bpy.data.objects.get(active_name):
    bpy.context.view_layer.objects.active = bpy.data.objects[active_name]
collection.hide_render = True
collection.hide_viewport = True
after = original_snapshot()
assert before == after, "Original harbor snapshot changed"
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
report = {
    "asset": GLB.name, "bytes": GLB.stat().st_size,
    "collection": COLLECTION_NAME, "objects": len(export_objects), "meshes": len(created),
    "triangles": triangles, "materials": len({b["material"].name for b in buckets.values()}),
    "default_hidden": {"render": collection.hide_render,"viewport": collection.hide_viewport},
    "original_before": before, "original_after": after,
    "original_unchanged": before == after,
    "islands_gltf": ISLANDS, "reefs_gltf_xz": REEFS,
    "cloud_groups_gltf": CLOUDS, "boats_gltf": BOATS,
}
(OUTPUT / "pov-environment-build-report.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps(report,indent=2))
