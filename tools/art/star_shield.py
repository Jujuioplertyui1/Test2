"""Repaints the Vanguard Shield's face in the star-spangled pattern (red, white, red rings round a blue disc with a
white star), held and thrown models alike. The back, the straps and the rim studs' sides stay as they were.
Run from the repo root: python3 tools/art/star_shield.py"""
import json, math
from PIL import Image
RP = "ORIGIN_RP"
RED, WHITE, BLUE, RIM = (176, 28, 40), (236, 236, 232), (34, 58, 140), (196, 200, 208)
def star_hit(u, v, R):   # a five-pointed star of radius R centred on (0,0), point up (v up)
    a = math.atan2(u, v); r = math.hypot(u, v)
    k = (a % (2 * math.pi / 5)) / (2 * math.pi / 5)
    edge = R * (0.42 + 0.58 * abs(1 - 2 * k) ** 1.8)
    return r <= edge
def colour(r, a, b, scale):
    r /= scale
    if r > 7.0: return RIM
    if r > 5.6: return RED
    if r > 4.2: return WHITE
    if r > 2.9: return RED
    return WHITE if star_hit(a / scale, b / scale, 2.7) else BLUE
def paint(geo_path, tex_path, axis, front_face, scale=1.0):
    g = json.load(open(geo_path)); im = Image.open(tex_path).convert("RGBA"); px = im.load()
    tw = g["minecraft:geometry"][0]["description"]["texture_width"]; sc = im.width / tw
    for b in g["minecraft:geometry"][0]["bones"]:
        for c in b.get("cubes", []):
            f = c["uv"].get(front_face)
            if not f: continue
            (u0, v0), (uw, vh) = f["uv"], f["uv_size"]
            o, s = c["origin"], c["size"]
            for i in range(max(1, round(abs(uw) * sc))):
                for j in range(max(1, round(abs(vh) * sc))):
                    fu, fv = (i + 0.5) / max(1, abs(uw) * sc), (j + 0.5) / max(1, abs(vh) * sc)
                    if axis == "x":   # face in the YZ plane: u runs along z, v down y
                        zz, yy = o[2] + s[2] * (1 - fu), o[1] + s[1] * (1 - fv)
                        r, a, bb = math.hypot(yy, zz), zz, yy
                    else:             # face in the XZ plane (thrown, lying flat): u along x, v along z
                        xx, zz = o[0] + s[0] * fu, o[2] + s[2] * (1 - fv)
                        r, a, bb = math.hypot(xx, zz), xx, -zz
                    X, Y = int(u0 * sc + i * (1 if uw >= 0 else -1)), int(v0 * sc + j * (1 if vh >= 0 else -1))
                    if 0 <= X < im.width and 0 <= Y < im.height and px[X, Y][3] > 0:
                        col = colour(r, a, bb, scale)
                        shade = 0.92 + 0.08 * math.cos(r * 1.7)
                        px[X, Y] = tuple(int(ch * shade) for ch in col) + (255,)
    im.save(tex_path)
paint(f"{RP}/models/entity/gear/vanguard_shield.geo.json", f"{RP}/textures/origin/entity/gear/vanguard_shield.png", "x", "east")
paint(f"{RP}/models/entity/gear/vanguard_shield_thrown.geo.json", f"{RP}/textures/origin/entity/gear/vanguard_shield_thrown.png", "y", "up", scale=1.0)
print("ok")
