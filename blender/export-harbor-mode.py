"""Export only the harbor objects removed from the island-wave scene.

Run in a separate factory-startup background Blender process, without opening or
saving a working .blend. The verified portable V14.3.1 archive is the source.
Outputs remain in output/harbor-mode until explicitly installed in dist.

    blender -b --factory-startup --python-exit-code 1 --python blender/export-harbor-mode.py
    blender -b --factory-startup --python-exit-code 1 --python blender/export-compress.py -- --lite --output output/harbor-mode
    python tools/package-harbor-mode.py

The main asset uses the same evaluated geometry, vertex palette and embedded
microtextures as export-harbor.py. Main island geometry is never duplicated.
"""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

import bpy

assert bpy.app.background, "Run in an independent background Blender process"
SCRIPT = Path(__file__).resolve()
PROJECT = SCRIPT.parent.parent
STAGE = PROJECT / "output" / "harbor-mode"
STAGE.mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(SCRIPT.parent / "small-goods-harbor-pov.blend.zip") as archive:
    manifest = json.loads(archive.read("manifest.json"))
    source = manifest["file"]
    raw = archive.read(source["name"])
    assert hashlib.sha256(raw).hexdigest() == source["sha256"]
    baseline = STAGE / source["name"]
    baseline.write_bytes(raw)
bpy.ops.wm.open_mainfile(filepath=str(baseline))
scene = bpy.context.scene
scene.frame_set(1)
jetty = bpy.data.collections["05 • Rope and timber landing jetty"]
launch = bpy.data.collections["06 • Little Tide trading launch"]
motion = bpy.data.collections["07 | Harbor animation controls"]
boat = bpy.data.objects["Boat | gentle floating motion"]
dockhand = bpy.data.objects["ACTOR_dockhand"]
removed = set(jetty.all_objects) | set(launch.all_objects) | set(motion.all_objects)
removed.update([boat, dockhand, *boat.children_recursive, *dockhand.children_recursive])
removed.add(bpy.data.objects["Dock amber lantern warm light"])
main_names = {obj.name for obj in removed}

# Filter the existing exporter in memory: keep exactly the source pipeline and
# scene dependency graph, without editing it or any source Blender object.
exporter = SCRIPT.parent / "export-harbor.py"
code = exporter.read_text(encoding="utf8")
needle = "export_source_objects = [o for o in scene.objects if o not in excluded_environment]"
assert code.count(needle) == 1, "Review exporter selection after upstream changes"
code = code.replace(needle, needle + "\nexport_source_objects = [o for o in export_source_objects if o.name in harbor_mode_names]")
sys.argv = [str(exporter), "--", "--lite", "--output", str(STAGE)]
namespace = {"__name__": "__main__", "__file__": str(exporter), "harbor_mode_names": main_names}
exec(compile(code, str(exporter), "exec"), namespace)

# Keep the standard names until export-compress.py has run. The packaging script
# renames STATIC to DOCK_STATIC and writes the compact runtime metadata.
report = json.loads((STAGE / "export-report-lite.json").read_text(encoding="utf8"))
assert {actor["id"] for actor in report["actors"]} == {"dockhand"}
assert set(report["groupNames"]) == {"STATIC", "BOAT", "ACTOR_dockhand"}
assert all(obj["name"] in main_names for obj in report["objects"])
(STAGE / "selection.json").write_text(json.dumps({
    "sourceBlendSha256": source["sha256"],
    "sourceArchiveSha256": hashlib.sha256((SCRIPT.parent / "small-goods-harbor-pov.blend.zip").read_bytes()).hexdigest(),
    "selectedMainObjects": sorted(main_names),
    "exportedMainObjects": [obj["name"] for obj in report["objects"]],
    "sourceWorkingFilesChanged": False,
}, ensure_ascii=False, indent=2), encoding="utf8")
print("HARBOR_MODE_EXPORTED", len(report["objects"]), "source objects", flush=True)
