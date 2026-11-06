"""Install the additive harbor assets after export-harbor-mode and compression.

Run from any directory with Python. Uses the pinned original harbor metadata and
horizon; --source-ref permits another explicitly reviewed baseline commit. Existing island
GLBs and editable Blender files are never written.
"""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import struct
import subprocess

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source-ref", default="3d8139546d149487a4bf59db801ed682fbaff82f")
args = parser.parse_args()
SOURCE_COMMIT = subprocess.check_output(["git", "rev-parse", args.source_ref], cwd=ROOT).decode().strip()
STAGE = ROOT / "output" / "harbor-mode"
ASSETS = ROOT / "dist" / "public" / "assets"


def committed(name):
    return subprocess.check_output(["git", "show", f"{args.source_ref}:dist/public/assets/{name}"], cwd=ROOT)


def read_glb(raw):
    magic, version, total = struct.unpack_from("<III", raw)
    assert magic == 0x46546c67 and version == 2 and total == len(raw)
    size, kind = struct.unpack_from("<II", raw, 12)
    assert kind == 0x4e4f534a
    document = json.loads(raw[20:20 + size])
    bin_size, bin_kind = struct.unpack_from("<II", raw, 20 + size)
    assert bin_kind == 0x004e4942
    return document, raw[28 + size:28 + size + bin_size]


def write_glb(path, document, binary):
    data = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf8")
    data += b" " * (-len(data) % 4)
    binary += b"\0" * (-len(binary) % 4)
    raw = struct.pack("<III", 0x46546c67, 2, 28 + len(data) + len(binary))
    raw += struct.pack("<II", len(data), 0x4e4f534a) + data
    raw += struct.pack("<II", len(binary), 0x004e4942) + binary
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


def horizon_boats(document, binary):
    """Copy original horizon boat data byte for byte, pruning unused content."""
    assert not document.get("animations") and not document.get("skins")
    assert not document.get("images") and not document.get("textures")
    roots = [i for i in document["scenes"][document.get("scene", 0)]["nodes"]
             if document["nodes"][i]["name"].startswith("HORIZON_BOAT_")]
    node_ids = set()

    def visit(i):
        node_ids.add(i)
        for child in document["nodes"][i].get("children", []):
            visit(child)

    for root in roots:
        visit(root)
    mesh_ids = {document["nodes"][i]["mesh"] for i in node_ids if "mesh" in document["nodes"][i]}
    accessor_ids, material_ids = set(), set()
    for i in mesh_ids:
        for primitive in document["meshes"][i]["primitives"]:
            assert not primitive.get("extensions") and not primitive.get("targets")
            accessor_ids.update(primitive["attributes"].values())
            if "indices" in primitive:
                accessor_ids.add(primitive["indices"])
            if "material" in primitive:
                material_ids.add(primitive["material"])
    view_ids = {document["accessors"][i]["bufferView"] for i in accessor_ids}
    maps = {key: {old: new for new, old in enumerate(sorted(ids))} for key, ids in [
        ("nodes", node_ids), ("meshes", mesh_ids), ("materials", material_ids),
        ("accessors", accessor_ids), ("bufferViews", view_ids)]}
    result = {"asset": deepcopy(document["asset"]), "scene": 0,
              "scenes": [{"name": "Harbor mode distant boats", "nodes": [maps["nodes"][i] for i in roots]}]}
    for key, mapping in maps.items():
        result[key] = [deepcopy(document[key][i]) for i in mapping]
    for node in result["nodes"]:
        if "children" in node:
            node["children"] = [maps["nodes"][i] for i in node["children"]]
        if "mesh" in node:
            node["mesh"] = maps["meshes"][node["mesh"]]
    for mesh in result["meshes"]:
        for primitive in mesh["primitives"]:
            primitive["attributes"] = {key: maps["accessors"][i] for key, i in primitive["attributes"].items()}
            if "indices" in primitive:
                primitive["indices"] = maps["accessors"][primitive["indices"]]
            if "material" in primitive:
                primitive["material"] = maps["materials"][primitive["material"]]
    for accessor in result["accessors"]:
        assert "sparse" not in accessor
        accessor["bufferView"] = maps["bufferViews"][accessor["bufferView"]]
    result_binary = bytearray()
    for view in result["bufferViews"]:
        result_binary.extend(b"\0" * (-len(result_binary) % 4))
        start = view.get("byteOffset", 0)
        segment = binary[start:start + view["byteLength"]]
        view["byteOffset"] = len(result_binary)
        view["buffer"] = 0
        result_binary.extend(segment)
    result["buffers"] = [{"byteLength": len(result_binary)}]
    assert len(roots) == 3 and len(result["nodes"]) == 12
    return result, bytes(result_binary)


main, main_binary = read_glb((STAGE / "harbor-lite.glb").read_bytes())
assert "KHR_draco_mesh_compression" in main.get("extensionsRequired", [])
for array in (main["nodes"], main["meshes"]):
    for item in array:
        if item.get("name", "").startswith("STATIC"):
            item["name"] = item["name"].replace("STATIC", "DOCK_STATIC", 1)
        if item.get("extras", {}).get("category") == "STATIC":
            item["extras"]["category"] = "DOCK_STATIC"
roots = [main["nodes"][i]["name"] for i in main["scenes"][main.get("scene", 0)]["nodes"]]
assert set(roots) == {"DOCK_STATIC", "BOAT", "ACTOR_dockhand"}
main["scenes"][main.get("scene", 0)]["name"] = "Harbor mode dock boat and crew"
main_hash = write_glb(ASSETS / "harbor-mode.glb", main, main_binary)

original_horizon = committed("harbor-horizon.glb")
horizon, horizon_binary = read_glb(original_horizon)
boats, boats_binary = horizon_boats(horizon, horizon_binary)
horizon_hash = write_glb(ASSETS / "harbor-horizon-boats.glb", boats, boats_binary)

source_metadata = json.loads(committed("scene-meta-lite.json"))
exported_metadata = json.loads((STAGE / "scene-meta-lite.json").read_text(encoding="utf8"))
dockhand = next(actor for actor in source_metadata["actors"] if actor["id"] == "dockhand")
assert exported_metadata["actors"] == [dockhand], "The source actor definition changed"
metadata = {key: source_metadata[key] for key in ("boatPivot", "boatForward", "boatObstacles")}
metadata.update(schemaVersion=1, groupNames=roots, actors=[dockhand],
                sourceBaseline=SOURCE_COMMIT, sourceBlendSha256=exported_metadata["sourceBlendSha256"],
                sourceObjectCount=exported_metadata["sourceObjectCount"],
                triangles=exported_metadata["triangles"], drawCalls=exported_metadata["drawCalls"],
                sha256=main_hash, horizonSha256=horizon_hash,
                coordinateSystem=exported_metadata["coordinateSystem"])
if "boat" in source_metadata:
    metadata["boat"] = source_metadata["boat"]
(ASSETS / "harbor-mode-meta.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf8")

# Verify every embedded normal/roughness PNG matches the original site asset.
original, original_binary = read_glb(committed("harbor-lite.glb"))
def image_hashes(document, binary):
    hashes = set()
    for image in document.get("images", []):
        assert "uri" not in image
        view = document["bufferViews"][image["bufferView"]]
        start = view.get("byteOffset", 0)
        hashes.add(hashlib.sha256(binary[start:start + view["byteLength"]]).hexdigest())
    return hashes
assert image_hashes(main, main_binary) <= image_hashes(original, original_binary), "Embedded texture differs from main"
island_metadata = json.loads((ASSETS / "scene-meta-lite.json").read_text(encoding="utf8"))
assert island_metadata["sourceObjectCount"] + metadata["sourceObjectCount"] == source_metadata["sourceObjectCount"], "Additive object count does not restore the baseline"
assert island_metadata["triangles"] + metadata["triangles"] == source_metadata["triangles"], "Additive triangle count does not restore the baseline"
report = {
    "sourceBaselineCommit": SOURCE_COMMIT,
    "mainRoots": roots, "mainObjects": metadata["sourceObjectCount"],
    "mainBytes": (ASSETS / "harbor-mode.glb").stat().st_size,
    "horizonBytes": (ASSETS / "harbor-horizon-boats.glb").stat().st_size,
    "mainTriangles": metadata["triangles"], "mainDrawCalls": metadata["drawCalls"],
    "horizonBoatCount": 3, "distantBoatGeometryCopiedWithoutReencoding": True,
    "allEmbeddedTexturesMatchOriginalSite": True,
    "dockhandMetadataMatchesOriginalSite": True,
    "boatMetadataMatchesOriginalSite": True,
    "combinedObjectCountMatchesOriginalSite": True,
    "combinedTriangleCountMatchesOriginalSite": True,
    "mainSha256": main_hash, "horizonSha256": horizon_hash,
}
(STAGE / "verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
print(json.dumps(report, indent=2))
