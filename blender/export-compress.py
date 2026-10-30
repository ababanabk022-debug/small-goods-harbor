"""Compress a staged harbor GLB using Blender's bundled Draco encoder.

Run in a separate empty background process:
    blender -b --factory-startup --python blender/export-compress.py -- --lite
Use the same --output directory as export-harbor.py. Omit --lite for full detail.
This never opens or saves the editable source .blend. No assets are published.
"""
import argparse
import hashlib
import json
import os
import struct
import sys
import time
from pathlib import Path
import bpy

assert bpy.app.background, "Compress in a separate background Blender process"
PROJECT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--lite", action="store_true")
parser.add_argument("--output", type=Path, default=PROJECT / "output" / "export-staging")
parser.add_argument("--keep-uncompressed", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
assets = args.output.resolve()
suffix = "-lite" if args.lite else ""
src = assets / ("harbor" + suffix + ".glb")
out = assets / ("harbor" + suffix + "-compact.glb")

def read_glb(path):
    data = path.read_bytes()
    magic, version, total = struct.unpack_from("<III", data)
    assert magic == 0x46546c67 and version == 2 and total == len(data), "Invalid GLB"
    size, kind = struct.unpack_from("<II", data, 12)
    assert kind == 0x4e4f534a
    return json.loads(data[20:20+size])

original = read_glb(src)
assert "KHR_draco_mesh_compression" not in original.get("extensionsRequired", []), "Already compressed; re-export before compressing again"
scene = bpy.data.scenes.new("Harbor GLB compression")
bpy.context.window.scene = scene
start = time.time()
bpy.ops.import_scene.gltf(filepath=str(src))
bpy.ops.export_scene.gltf(
    filepath=str(out), export_format="GLB", use_active_scene=True,
    export_extras=True, export_animations=False, export_cameras=False,
    export_lights=False, export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6, export_draco_position_quantization=16,
    export_draco_normal_quantization=12, export_draco_color_quantization=10,
    export_draco_generic_quantization=12, export_draco_texcoord_quantization=16,
    export_all_vertex_colors=True,
)
compressed = read_glb(out)
assert "KHR_draco_mesh_compression" in compressed.get("extensionsRequired", []), "Draco encoder did not run"
assert len(original["meshes"]) == len(compressed["meshes"]), "Compression changed mesh count"
assert sorted(m["name"] for m in original["materials"]) == sorted(m["name"] for m in compressed["materials"]), "Compression changed materials"
assert len(original.get("images", [])) == len(compressed.get("images", [])), "Compression lost embedded textures"
assert all("bufferView" in i and "uri" not in i for i in compressed.get("images", [])), "Texture became external"
assert not compressed.get("animations") and not compressed.get("cameras")
original_roots = {original["nodes"][i]["name"] for i in original["scenes"][original.get("scene",0)]["nodes"]}
compressed_roots = {compressed["nodes"][i]["name"] for i in compressed["scenes"][compressed.get("scene",0)]["nodes"]}
assert original_roots == compressed_roots, "Compression changed root groups"
assert not any("POV_Horizon" in n.get("name","") or "HORIZON_BOAT" in n.get("name","") for n in compressed["nodes"]), "Horizon leaked into main GLB"
raw_bytes = src.stat().st_size
if args.keep_uncompressed:
    os.replace(src, assets / ("harbor" + suffix + "-uncompressed.glb"))
os.replace(out, src)
for metadata_file in [assets / ("scene-meta" + suffix + ".json"), assets / ("export-report" + suffix + ".json")]:
    meta = json.loads(metadata_file.read_text(encoding="utf-8"))
    meta.update(bytes=src.stat().st_size, uncompressedBytes=raw_bytes,
                compression="KHR_draco_mesh_compression",
                sha256=hashlib.sha256(src.read_bytes()).hexdigest(),
                compressionSeconds=round(time.time()-start,2))
    metadata_file.write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding="utf-8")
print("DRACO_COMPLETE", json.dumps({"bytes":src.stat().st_size, "seconds":round(time.time()-start,2), "sourceBytes":raw_bytes}), flush=True)
