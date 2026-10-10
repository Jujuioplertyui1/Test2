"""Builds the Asgardians: Heimdall (horned golden helm, dark cape, the great sword Hofund) and the Einherjar guards
(silver-gold mail, red cape, spear and round shield). One geometry, two textures; the render controller hides the
parts a role doesn't carry. Run from the repo root: python3 tools/art/asgardians.py"""
import json, sys
sys.path.insert(0, "tools/art")
from modelkit import Model, write_geo

m = Model("geometry.origin.asgardian", 128, 128)
m.bone("root", [0, 0, 0])
m.bone("body", [0, 24, 0], "root")
m.cube("body", [-4, 12, -2], [8, 12, 4], "tunic")
m.cube("body", [-4, 16, -2], [8, 8, 4], "armor", inflate=0.6, detail="cuirass")
m.cube("body", [-4, 12, -2], [8, 2, 4], "leather", inflate=0.75)
m.cube("body", [-4, 8, -2], [8, 4, 4], "armor_dark", inflate=0.85)
m.cube("body", [-1.5, 18.5, -3.2], [3, 3, 1], "armor_bright")
m.bone("cape", [0, 24, 2.6], "body", rotation=[6, 0, 0])
m.cube("cape", [-5, 3, 2.6], [10, 21, 1], "cape", detail="cape")
m.bone("head", [0, 24, 0], "body")
m.cube("head", [-4, 24, -4], [8, 8, 8], "skin", detail="face")
m.cube("head", [-4, 30, -4], [8, 2, 8], "armor", inflate=0.6)
m.cube("head", [-4, 24, -2], [1, 6, 6], "armor", inflate=0.6)
m.cube("head", [3, 24, -2], [1, 6, 6], "armor", inflate=0.6)
m.cube("head", [-4, 24, 3], [8, 5, 1], "armor", inflate=0.6)
m.cube("head", [-1, 31.4, -4.9], [2, 2, 1], "armor_bright")
m.bone("horns", [0, 30, 0], "head")
for sx in (1, -1):
    x0 = 4.4 if sx > 0 else -6.4
    m.cube("horns", [x0, 29, -1], [2, 2, 2], "armor_bright")
    m.cube("horns", [x0 + (0.5 if sx > 0 else 0.0), 30.5, 0], [1.5, 4, 1.5], "armor_bright", rotation=[-35, 0, 22 * sx], pivot=[x0 + 1, 30.5, 1])
    m.cube("horns", [x0 + (1.6 if sx > 0 else -0.6), 33.6, 2.2], [1, 3.5, 1], "armor_bright", rotation=[-60, 0, 30 * sx], pivot=[x0 + 2, 33.6, 2.6])
for side, sx in (("rightArm", -1), ("leftArm", 1)):
    px = 5 * sx
    m.bone(side, [px, 22, 0], "body")
    x0 = -8 if sx < 0 else 4
    m.cube(side, [x0, 12, -2], [4, 12, 4], "tunic")
    m.cube(side, [x0, 12, -2], [4, 5, 4], "armor", inflate=0.45)
    m.cube(side, [x0 - (1 if sx < 0 else 0), 20, -3], [5, 4, 6], "armor", inflate=0.2, detail="pauldron")
    m.cube(side, [x0, 11, -2], [4, 1, 4], "skin")
for side, sx in (("rightLeg", -1), ("leftLeg", 1)):
    m.bone(side, [1.9 * sx, 12, 0], "root")
    x0 = -3.9 if sx < 0 else -0.1
    m.cube(side, [x0, 0, -2], [4, 12, 4], "pants")
    m.cube(side, [x0, 2, -2], [4, 5, 4], "armor", inflate=0.5)
    m.cube(side, [x0, 0, -2], [4, 2, 4], "leather", inflate=0.6)
# Hofund (Heimdall), held point-down in the right hand
m.bone("sword", [-6, 12, 0], "rightArm")
m.cube("sword", [-6.5, -15, -1], [1, 26, 2], "steel", detail="blade")
m.cube("sword", [-8.5, 11, -1.5], [5, 1, 3], "armor_bright")
m.cube("sword", [-6.5, 12, -0.5], [1, 4, 1], "leather")
m.cube("sword", [-7, 16, -1], [2, 2, 2], "armor_bright")
# Einherjar: spear in the right hand, round shield on the left arm
m.bone("spear", [-6, 12, 0], "rightArm")
m.cube("spear", [-6.5, -12, -0.5], [1, 44, 1], "wood")
m.cube("spear", [-7, 32, -1], [2, 5, 2], "steel")
m.cube("spear", [-6.75, 37, -0.75], [1.5, 2, 1.5], "steel")
m.bone("shield", [7, 14, 0], "leftArm")
m.cube("shield", [8.1, 8, -5], [1, 11, 10], "shield", detail="shield")
m.cube("shield", [9.1, 12.5, -0.5], [1, 2, 1], "armor_bright")
write_geo("ORIGIN_RP/models/entity/asgardian.geo.json", (m, (3, 4, 1.8)))

def face(eyes, brow, mouth):
    def f(face, x, y, w, h, d, rnd):
        if face != "front": return
        for ex in (1, 5):
            d.rectangle([x + ex, y + 4, x + ex + 1, y + 4], fill=(240, 240, 235, 255))
            d.point((x + ex + (1 if ex == 1 else 0), y + 4), fill=eyes)
            d.rectangle([x + ex, y + 3, x + ex + 1, y + 3], fill=brow)
        d.rectangle([x + 3, y + 5, x + 4, y + 5], fill=tuple(min(255, int(c * 1.4) + 20) for c in brow[:3]) + (255,))
        d.rectangle([x + 2, y + 6, x + 5, y + 6], fill=mouth)
    return f
def trim(col):
    def f(face, x, y, w, h, d, rnd):
        if face in ("front", "back", "left", "right"):
            d.line([x, y, x + w - 1, y], fill=col); d.line([x, y + h - 1, x + w - 1, y + h - 1], fill=col)
    return f
def cuirass(col, disc):
    def f(face, x, y, w, h, d, rnd):
        if face == "front":
            d.line([x + w // 2, y + 1, x + w // 2, y + h - 2], fill=disc)
            for (cx, cy) in ((x + 2, y + 2), (x + w - 3, y + 2)):
                d.ellipse([cx - 1, cy - 1, cx + 1, cy + 1], fill=disc)
        trim(col)(face, x, y, w, h, d, rnd)
    return f
def cape_fold(face, x, y, w, h, d, rnd):
    if face not in ("front", "back"): return
    for i in range(2, w, 3): d.line([x + i, y + 2, x + i, y + h - 1], fill=(0, 0, 0, 60))
def blade(face, x, y, w, h, d, rnd):
    if face in ("front", "back", "left", "right"):
        d.line([x, y, x, y + h - 1], fill=(255, 255, 255, 255))
        for k in range(3, h - 3, 6): d.point((x + w - 1, y + k), fill=(255, 210, 120, 255))
def shield_face(face, x, y, w, h, d, rnd):
    if face != "left": return
    d.ellipse([x, y, x + w - 1, y + h - 1], outline=(214, 170, 60, 255))
    d.ellipse([x + w // 2 - 2, y + h // 2 - 2, x + w // 2 + 1, y + h // 2 + 1], fill=(230, 190, 80, 255))
    d.line([x + w // 2, y + 1, x + w // 2, y + h - 2], fill=(214, 170, 60, 255))

H = {"skin": (92, 60, 42), "tunic": (44, 38, 34), "armor": (217, 162, 58), "armor_dark": (156, 109, 30), "armor_bright": (255, 216, 119),
     "leather": (74, 50, 32), "pants": (58, 47, 40), "cape": (40, 40, 52), "steel": (206, 214, 222), "wood": (110, 80, 50), "shield": (130, 30, 30)}
E = {"skin": (201, 154, 114), "tunic": (122, 31, 31), "armor": (190, 186, 168), "armor_dark": (128, 124, 110), "armor_bright": (226, 190, 96),
     "leather": (84, 58, 36), "pants": (70, 52, 40), "cape": (139, 29, 29), "steel": (200, 206, 214), "wood": (120, 86, 52), "shield": (150, 32, 30)}
for name, pal, eyes, brow, seed in (("heimdall", H, (255, 168, 32, 255), (40, 24, 16, 255), 3), ("einherjar", E, (60, 90, 140, 255), (110, 70, 40, 255), 4)):
    det = {"face": face(eyes, brow, (90, 40, 34, 255) if name == "heimdall" else (150, 80, 70, 255)), "cuirass": cuirass((255, 230, 150, 255), (255, 216, 119, 255)),
           "pauldron": trim((255, 230, 150, 255)), "cape": cape_fold, "blade": blade, "shield": shield_face}
    m.paint(pal, seed=seed, details=det).save(f"ORIGIN_RP/textures/origin/entity/{name}.png")
print("ok")
