"""Cross-reference check for the ORIGIN packs (no Minecraft needed).
Parses every JSON file and checks that what one file names actually exists somewhere else:
item icons -> item_texture.json -> texture files, attachable/client-entity geometry + textures + animations +
render controllers, particle textures, sound files, block textures, recipe items, manifest dependency UUIDs.
Usage: python3 tools/lint.py [root]   (root holds ORIGIN_BP and ORIGIN_RP)"""
import json, os, re, sys, glob
root = sys.argv[1] if len(sys.argv) > 1 else "."
BP, RP = os.path.join(root, "ORIGIN_BP"), os.path.join(root, "ORIGIN_RP")
errors, warns = [], []
def load(p):
    try:
        with open(p, encoding="utf-8") as f: return json.load(f)
    except Exception as e:
        errors.append(f"bad JSON {p}: {e}"); return None
def tex_exists(base):
    return any(os.path.exists(os.path.join(RP, base + e)) for e in (".png", ".tga", ".jpg"))
VANILLA_TEX = ("textures/misc/", "textures/entity/", "textures/particle/", "textures/models/", "textures/items/", "textures/blocks/")
for p in glob.glob(f"{root}/ORIGIN_*/**/*.json", recursive=True): load(p)
# geometry ids
GEO = set()
for p in glob.glob(f"{RP}/models/**/*.json", recursive=True):
    d = load(p) or {}
    for g in d.get("minecraft:geometry", []):
        GEO.add(g["description"]["identifier"])
        bones = {b["name"] for b in g.get("bones", [])}
        for b in g.get("bones", []):
            if b.get("parent") and b["parent"] not in bones and b.get("parent") not in ("rightItem", "leftItem", "rightArm", "leftArm", "body", "head"):
                warns.append(f"{p}: bone {b['name']} parent {b['parent']} missing")
ANIM = set()
for p in glob.glob(f"{RP}/animations/*.json") + glob.glob(f"{RP}/animation_controllers/*.json"):
    d = load(p) or {}
    ANIM |= set(d.get("animations", {}).keys()) | set(d.get("animation_controllers", {}).keys())
RC = set()
for p in glob.glob(f"{RP}/render_controllers/*.json"):
    d = load(p) or {}
    RC |= set(d.get("render_controllers", {}).keys())
VANILLA_RC = {"controller.render.item_default", "controller.render.armor", "controller.render.default"}
def vanilla_anim(a): return a.startswith("animation.armor.") or a.startswith("animation.humanoid.") or a.startswith("animation.player.") or a.startswith("controller.animation.humanoid") or a.startswith("controller.animation.player")
def check_client(desc, where):
    for k, g in desc.get("geometry", {}).items():
        if g not in GEO and not g.startswith("geometry.humanoid"): errors.append(f"{where}: geometry {g} not found")
    for k, t in desc.get("textures", {}).items():
        if not t.startswith(VANILLA_TEX) and not tex_exists(t): errors.append(f"{where}: texture {t} not found")
    for k, a in desc.get("animations", {}).items():
        if a not in ANIM and not vanilla_anim(a): errors.append(f"{where}: animation {a} not found")
    for r in desc.get("render_controllers", []):
        rid = r if isinstance(r, str) else list(r.keys())[0]
        if rid not in RC and rid not in VANILLA_RC: errors.append(f"{where}: render controller {rid} not found")
ATT = {}
for p in glob.glob(f"{RP}/attachables/*.json"):
    d = load(p)
    if not d: continue
    desc = d["minecraft:attachable"]["description"]; ATT[desc["identifier"]] = p
    check_client(desc, p)
CE = {}
for p in glob.glob(f"{RP}/entity/*.json"):
    d = load(p)
    if not d: continue
    desc = d["minecraft:client_entity"]["description"]; CE[desc["identifier"]] = p
    check_client(desc, p)
# behavior entities have a client entity
for p in glob.glob(f"{BP}/entities/*.json"):
    d = load(p)
    if not d: continue
    ident = d["minecraft:entity"]["description"]["identifier"]
    if ident not in CE: errors.append(f"{p}: no client entity for {ident}")
# items -> icons
IT = (load(f"{RP}/textures/item_texture.json") or {}).get("texture_data", {})
for k, v in IT.items():
    ts = v["textures"] if isinstance(v["textures"], list) else [v["textures"]]
    for t in ts:
        t = t if isinstance(t, str) else t.get("path")
        if not tex_exists(t): errors.append(f"item_texture {k}: {t} missing")
ITEMS = set()
for p in glob.glob(f"{BP}/items/*.json"):
    d = load(p)
    if not d: continue
    it = d["minecraft:item"]; ITEMS.add(it["description"]["identifier"])
    icon = it.get("components", {}).get("minecraft:icon")
    if icon:
        key = icon if isinstance(icon, str) else icon.get("textures", {}).get("default") or icon.get("texture")
        if key not in IT: errors.append(f"{p}: icon {key} not in item_texture.json")
    if "minecraft:wearable" in it.get("components", {}) and it["description"]["identifier"] not in ATT:
        warns.append(f"{p}: wearable without attachable")
# blocks
TT = (load(f"{RP}/textures/terrain_texture.json") or {}).get("texture_data", {})
BLOCKS = set()
for p in glob.glob(f"{BP}/blocks/*.json"):
    d = load(p)
    if not d: continue
    b = d["minecraft:block"]; BLOCKS.add(b["description"]["identifier"])
    comps = b.get("components", {})
    mi = comps.get("minecraft:material_instances", {})
    for k, v in mi.items():
        if v.get("texture") and v["texture"] not in TT: errors.append(f"{p}: block texture {v['texture']} not in terrain_texture.json")
    g = comps.get("minecraft:geometry")
    gid = g if isinstance(g, str) else (g or {}).get("identifier")
    if gid and gid not in GEO and not gid.startswith("minecraft:"): errors.append(f"{p}: block geometry {gid} missing")
for k, v in TT.items():
    ts = v["textures"] if isinstance(v["textures"], list) else [v["textures"]]
    for t in ts:
        t = t if isinstance(t, str) else t.get("path")
        if not tex_exists(t): errors.append(f"terrain_texture {k}: {t} missing")
# recipes reference real items
for p in glob.glob(f"{BP}/recipes/*.json"):
    d = load(p) or {}
    s = json.dumps(d)
    for ref in set(re.findall(r'"(origin:[a-z0-9_]+)"', s)):
        if ref not in ITEMS and ref not in BLOCKS and not ref.startswith("origin:") is False: pass
        if ref.startswith("origin:") and ref not in ITEMS and ref not in BLOCKS and "identifier" not in s.split(ref)[0][-40:]:
            errors.append(f"{p}: unknown item {ref}")
# particles
for p in glob.glob(f"{RP}/particles/*.json"):
    d = load(p) or {}
    t = d.get("particle_effect", {}).get("description", {}).get("basic_render_parameters", {}).get("texture")
    if t and not t.startswith(VANILLA_TEX) and not tex_exists(t): errors.append(f"{p}: particle texture {t} missing")
PARTICLES = set()
for p in glob.glob(f"{RP}/particles/*.json"):
    d = load(p) or {}
    PARTICLES.add(d.get("particle_effect", {}).get("description", {}).get("identifier"))
# sounds
SD = (load(f"{RP}/sounds/sound_definitions.json") or {}).get("sound_definitions", {})
for k, v in SD.items():
    for s in v.get("sounds", []):
        n = s if isinstance(s, str) else s.get("name")
        if n and n.startswith("sounds/origin") and not any(os.path.exists(os.path.join(RP, n + e)) for e in (".ogg", ".wav", ".fsb")):
            errors.append(f"sound {k}: {n} missing")
# scripts: particles / sounds / entity types / items they name exist
JS = "\n".join(open(p, encoding="utf-8").read() for p in glob.glob(f"{BP}/scripts/*.js"))
PART_CALL = r'(?:\bfx|\bpfx|\bline|spawnParticle|trailLine)\(\s*(?:[^,()]+(?:\([^()]*\))?\s*,\s*)?"(origin:[a-z0-9_]+)"'
for ref in sorted(set(re.findall(PART_CALL, JS))):
    if ref not in PARTICLES: errors.append(f"scripts spawn particle {ref}: not defined")
for ref in sorted(set(re.findall(r'spawnEntity\(\s*"(origin:[a-z0-9_]+)"', JS))):
    if ref not in CE: errors.append(f"scripts spawn entity {ref}: no client entity")
for ref in sorted(set(re.findall(r'new ItemStack\(\s*"(origin:[a-z0-9_]+)"', JS))):
    if ref not in ITEMS and ref not in BLOCKS: errors.append(f"scripts make item {ref}: not defined")
for ref in sorted(set(re.findall(r'"(origin\.sfx\.[a-z0-9_]+)"', JS))):
    if ref not in SD: errors.append(f"scripts play sound {ref}: not defined")
# manifests
mb, mr = load(f"{BP}/manifest.json"), load(f"{RP}/manifest.json")
if mb and mr:
    if not any(d.get("uuid") == mr["header"]["uuid"] for d in mb.get("dependencies", [])): errors.append("BP manifest doesn't depend on RP uuid")
    if mb["header"]["version"] != mr["header"]["version"]: warns.append("BP/RP versions differ")
for e in errors: print("ERROR", e)
for w in warns: print("warn ", w)
print(f"{len(errors)} errors, {len(warns)} warnings")
sys.exit(1 if errors else 0)
