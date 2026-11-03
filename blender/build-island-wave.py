"""Build the island-wave working copy and its horizon from the V14.3.1 archive.

Run once with blender -b --factory-startup --python-exit-code 1 --python
blender/build-island-wave.py. Subsequent edits belong in blender/island-wave.blend.
"""
import hashlib
import json
from pathlib import Path
import zipfile

import bpy

assert bpy.app.background, "Use a separate background Blender process"
folder = Path(__file__).resolve().parent
stage = folder.parent / "output" / "island-wave"
stage.mkdir(parents=True, exist_ok=True)
target = folder / "island-wave.blend"
if target.exists():
    raise FileExistsError("Preserve the existing island-wave.blend before rebuilding from the baseline")

with zipfile.ZipFile(folder / "small-goods-harbor-pov.blend.zip") as archive:
    source = json.loads(archive.read("manifest.json"))["file"]
    assert source["name"] == "small-goods-harbor-pov.blend"
    raw = archive.read(source["name"])
    assert hashlib.sha256(raw).hexdigest() == source["sha256"]
    baseline = stage / source["name"]
    baseline.write_bytes(raw)
bpy.ops.wm.open_mainfile(filepath=str(baseline))
scene = bpy.context.scene
horizon = bpy.data.collections["POV_ENVIRONMENT"]
jetty = bpy.data.collections["05 • Rope and timber landing jetty"]
launch = bpy.data.collections["06 • Little Tide trading launch"]
motion = bpy.data.collections["07 | Harbor animation controls"]
boat = bpy.data.objects["Boat | gentle floating motion"]
dockhand = bpy.data.objects["ACTOR_dockhand"]
removed = set(jetty.all_objects) | set(launch.all_objects) | set(motion.all_objects)
removed.update([boat, dockhand, *boat.children_recursive, *dockhand.children_recursive])
removed.add(bpy.data.objects["Dock amber lantern warm light"])
removed.update(o for o in horizon.all_objects if o.name.startswith("HORIZON_BOAT_"))
survivors = {o.name for o in scene.objects if o not in removed}
removed_count = len(removed)
bpy.data.batch_remove(ids=[*removed, jetty, launch, motion])
assert {o.name for o in scene.objects} == survivors
assert not any(n.startswith(("Dock ", "Boat ", "Little Tide ", "HORIZON_BOAT_", "ACTOR_dockhand")) for n in survivors)

navigation = json.loads(scene["harbor_navigation_json"])
for key in ("boatObstacles", "boatForward"):
    navigation.pop(key, None)
scene["harbor_navigation_json"] = json.dumps(navigation)
del scene["harbor_boat_motion_v1"]

# Export only the background island, reef, cloud and beacon meshes. Keep the
# collection hidden in the editable overview exactly as it was in the baseline.
horizon.hide_viewport = horizon.hide_render = False
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
for obj in horizon.all_objects:
    obj.select_set(True)
assert set(bpy.context.selected_objects) == set(horizon.all_objects)
bpy.ops.export_scene.gltf(filepath=str(stage / "harbor-horizon.glb"),
    export_format="GLB", use_selection=True, export_animations=False,
    export_lights=False, export_cameras=False, export_extras=False)
bpy.ops.object.select_all(action="DESELECT")
horizon.hide_viewport = horizon.hide_render = True
bpy.ops.wm.save_as_mainfile(filepath=str(target), relative_remap=False, compress=True)
print(f"ISLAND_WAVE_READY {len(survivors)} objects retained; {removed_count} removed")
