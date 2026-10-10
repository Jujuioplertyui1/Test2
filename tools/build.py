"""Packs ORIGIN_BP + ORIGIN_RP into dist/ORIGIN_v<version>.mcaddon (double-click it to import into Minecraft).
Run from the repo root: python3 tools/build.py"""
import json, os, zipfile
v = json.load(open("ORIGIN_BP/manifest.json"))["header"]["version"]
name = f"ORIGIN_v{v[1]}_{v[2]:02d}.mcaddon"
os.makedirs("dist", exist_ok=True)
out = os.path.join("dist", name)
n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for pack in ("ORIGIN_BP", "ORIGIN_RP"):
        for root, dirs, files in os.walk(pack):
            dirs.sort()
            for f in sorted(files):
                if f.startswith(".") or f.endswith((".py", ".pyc")): continue
                p = os.path.join(root, f)
                z.write(p, p.replace(os.sep, "/")); n += 1
print(f"{out}: {n} files, {os.path.getsize(out) / 1e6:.1f} MB")
