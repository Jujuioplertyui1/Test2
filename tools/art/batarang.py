"""Builds the batarang: geometry (held + thrown), textures, item icons. Run from the repo root."""
import json
from PIL import Image, ImageDraw
SHAPE = [
    "........X.X........",
    "X.......XXX.......X",
    "XX.....XXXXX.....XX",
    "XXXXXXXXXXXXXXXXXXX",
    ".XXXXXXXXXXXXXXXXX.",
    "..XXXX.XXXXX.XXXX..",
    "...XX...XXX...XX...",
    ".........X.........",
]
CELL, THICK = 0.6, 0.5
W = len(SHAPE[0])
def face_uv(col):  # 8x8 texture: (0,0) top, (2,0) bottom, (4,0) edge, (6,0) light
    return {"uv": [col, 0], "uv_size": [1, 1]}
def cubes(y0=-THICK / 2):
    out = []
    for r, row in enumerate(SHAPE):
        c = 0
        while c < W:
            if row[c] != "X": c += 1; continue
            s = c
            while c < W and row[c] == "X": c += 1
            x0 = (s - W / 2) * CELL
            z0 = (r - len(SHAPE) / 2) * CELL
            out.append({"origin": [round(x0, 3), y0, round(z0, 3)], "size": [round((c - s) * CELL, 3), THICK, CELL],
                        "uv": {"up": face_uv(0), "down": face_uv(2), "north": face_uv(4), "south": face_uv(4), "east": face_uv(4), "west": face_uv(4)}})
    # the explosive's light / the plain one's grip wrap, in the middle
    out.append({"origin": [-0.4, THICK / 2 - 0.05, -0.6], "size": [0.8, 0.2, 0.8], "uv": {k: face_uv(6) for k in ("up", "down", "north", "south", "east", "west")}})
    return out
def geo(ident, bones):
    return {"description": {"identifier": ident, "texture_width": 8, "texture_height": 8, "visible_bounds_width": 2, "visible_bounds_height": 2, "visible_bounds_offset": [0, 0.5, 0]}, "bones": bones}
held = geo("geometry.origin.batarang", [{"name": "gun", "pivot": [0, 0, 0], "binding": "q.item_slot_to_bone_name(c.item_slot)", "cubes": cubes()}])
thrown = geo("geometry.origin.batarang_thrown", [{"name": "root", "pivot": [0, 0, 0]}, {"name": "spin", "parent": "root", "pivot": [0, 0, 0], "cubes": cubes()}])
json.dump({"format_version": "1.12.0", "minecraft:geometry": [held, thrown]}, open("ORIGIN_RP/models/entity/gear/batarang.geo.json", "w"), indent=1)
def tex(light):
    im = Image.new("RGBA", (8, 8), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 1, 1], fill=(34, 36, 42, 255)); d.rectangle([2, 0, 3, 1], fill=(22, 23, 27, 255)); d.rectangle([4, 0, 5, 1], fill=(92, 98, 110, 255)); d.rectangle([6, 0, 7, 1], fill=light)
    return im
tex((60, 64, 72, 255)).save("ORIGIN_RP/textures/origin/entity/gear/batarang.png")
tex((255, 40, 30, 255)).save("ORIGIN_RP/textures/origin/entity/gear/batarang_explosive.png")
def icon(light, out):
    S = 16; im = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    oy = 4
    for r, row in enumerate(SHAPE):
        for c, ch in enumerate(row):
            if ch != "X": continue
            x = c - 1 if c > 9 else c
            if c == 9: continue
            x = int(c * 15 / 18); y = oy + r
            d.point((x, y), fill=(30, 32, 38, 255))
    # rim light on the top edge of the wings
    for x in range(16):
        for y in range(16):
            p = im.getpixel((x, y))
            if p[3] and (y == 0 or im.getpixel((x, y - 1))[3] == 0): im.putpixel((x, y), (110, 118, 132, 255))
    if light: d.rectangle([7, 7, 8, 8], fill=light)
    im.save(out)
icon(None, "ORIGIN_RP/textures/origin/items/batarang.png")
icon((255, 50, 40, 255), "ORIGIN_RP/textures/origin/items/explosive_batarang.png")
print("ok", len(cubes()), "cubes")
