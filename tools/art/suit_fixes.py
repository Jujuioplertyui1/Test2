"""v0.24 armor fixes: repaints / nudges the suit pieces that looked wrong.
  - Vanguard torso + mask (the Captain-America-style suit): star on the chest, red/white stripes round the waist,
    leather gloves and belt; helmet with a white A on the brow, white wings, eye holes, open jaw. The brow band that sat
    across the eyes moves up above them.
  - Thunder God (Asgardian) torso: the brown 'barrel' arms become dark mail with steel bracers; six silver discs on
    the chest.
  - Visor mask: the earpieces floated half a pixel off the head - now they sit on it.
  - Lenses mask: the black ear discs read as holes - now they're suit-coloured with a dark speaker ring.
  - Exo Mark IV: the shoulder cannon's muzzle is a deep red glow instead of a pink nub.
Dye convention (armor_leather material): alpha 255 = tinted by the suit colour, alpha 1 = fixed colour, alpha 0 = hole.
Run from the repo root: python3 tools/art/suit_fixes.py"""
import json, random
from PIL import Image, ImageDraw
RP = "ORIGIN_RP"
rnd = random.Random(24)
TINT = lambda k=1.0: (int(225 * k), int(225 * k), int(225 * k), 255)
FIX = lambda r, g, b: (r, g, b, 1)
HOLE = (0, 0, 0, 0)

def load(name):
    return Image.open(f"{RP}/textures/origin/models/armor/{name}.tga").convert("RGBA")
def save(im, name):
    im.save(f"{RP}/textures/origin/models/armor/{name}.tga")
def geo(name):
    return json.load(open(f"{RP}/models/entity/suit/{name}.geo.json"))
def faces(g, bone, i):
    for b in g["minecraft:geometry"][0]["bones"]:
        if b["name"] == bone: return {k: (v["uv"][0], v["uv"][1], v["uv_size"][0], v["uv_size"][1]) for k, v in b["cubes"][i]["uv"].items()}
def fill(px, rect, fn):
    x, y, w, h = rect
    for i in range(w):
        for j in range(h):
            c = fn(i, j, w, h)
            if c is not None: px[x + i, y + j] = c
def tinted(edge=0.72, noise=0.06):
    def f(i, j, w, h):
        k = 1 + (rnd.random() - 0.5) * noise
        if i == 0 or j == 0 or i == w - 1 or j == h - 1: k *= edge
        return TINT(k)
    return f
def fixed(col, noise=0.08, edge=0.8):
    def f(i, j, w, h):
        k = 1 + (rnd.random() - 0.5) * noise
        if i == 0 or j == 0 or i == w - 1 or j == h - 1: k *= edge
        return FIX(*(max(0, min(255, int(c * k))) for c in col))
    return f
STAR = ["....X....", "....X....", "...XXX...", "XXXXXXXXX", ".XXXXXXX.", "..XXXXX..", "..XX.XX..", ".XX...XX.", ".X.....X."]
WHITE, RED, LEATHER, LEATHER_D, STEEL = (238, 238, 232), (178, 34, 52), (122, 74, 40), (82, 48, 26), (176, 180, 188)

# ------------------------------------------------------------------ Vanguard torso
def vanguard_torso():
    g, im = geo("suit_torso_vanguard"), load("suit_torso_vanguard")
    px = im.load()
    for x in range(im.width):
        for y in range(im.height): px[x, y] = HOLE
    F = faces(g, "body", 0)
    def front(i, j, w, h):        # 16x24: blue chest with a white star, stripes from row 15 down
        if j >= 15: return FIX(*(RED if (i // 2) % 2 == 0 else WHITE))
        sx, sy = i - 3, j - 3
        if 0 <= sy < len(STAR) and 0 <= sx < 9 and STAR[sy][sx] == "X": return FIX(*WHITE)
        if j in (13, 14): return TINT(0.8)
        return TINT(0.93 if 0 < i < w - 1 else 0.75)
    def back(i, j, w, h):
        if j >= 15: return FIX(*(RED if (i // 2) % 2 == 0 else WHITE))
        if i in (4, 11) and j < 15: return FIX(*LEATHER_D)                    # harness straps
        return TINT(0.88 if 0 < i < w - 1 else 0.72)
    def side(i, j, w, h):
        if j >= 15: return FIX(*(RED if (i // 2) % 2 == 0 else WHITE))
        return TINT(0.85)
    fill(px, F["north"], front); fill(px, F["south"], back); fill(px, F["east"], side); fill(px, F["west"], side)
    fill(px, F["up"], tinted()); fill(px, F["down"], fixed(WHITE))
    B = faces(g, "body", 1)          # the belt, with a silver buckle
    for k, r in B.items(): fill(px, r, fixed(LEATHER))
    x, y, w, h = B["north"]; fill(px, (x + 6, y, 4, h), fixed(STEEL, edge=0.9))
    for k, r in faces(g, "body", 2).items(): fill(px, r, tinted(0.65))      # collar
    for arm in ("rightArm", "leftArm"):
        for k, r in faces(g, arm, 0).items():
            fill(px, r, (lambda i, j, w, h: FIX(*WHITE) if j in (1, 2) and k not in ("up", "down") else TINT(0.88 if 0 < i < w - 1 else 0.74)) if k not in ("up", "down") else tinted())
        for k, r in faces(g, arm, 1).items(): fill(px, r, fixed(LEATHER) if k != "down" else fixed(LEATHER_D))   # gloves
        for k, r in faces(g, arm, 2).items(): fill(px, r, tinted(0.62))                                         # shoulder plates
        for k, r in faces(g, arm, 3).items(): fill(px, r, fixed(LEATHER_D))                                     # glove cuffs
    save(im, "suit_torso_vanguard")

# ------------------------------------------------------------------ Vanguard mask
A_MARK = ["..XX..", ".X..X.", "XXXXXX", "X....X"]
def vanguard_mask():
    path = f"{RP}/models/entity/suit/suit_mask_vanguard.geo.json"
    g, im = geo("suit_mask_vanguard"), load("suit_mask_vanguard")
    # the brow band sat across the eyes: lift it above them
    for b in g["minecraft:geometry"][0]["bones"]:
        for c in b["cubes"]:
            if c["size"] == [8.6, 1.5, 0.4]: c["origin"] = [-4.3, 29.2, -4.75]; c["size"] = [8.6, 1.0, 0.4]
    json.dump(g, open(path, "w"), indent=1)
    px = im.load()
    for x in range(im.width):
        for y in range(im.height): px[x, y] = HOLE
    F = faces(g, "head", 0)
    def front(i, j, w, h):         # 16x16 (2 texels per pixel): rows 0-7 helmet + A, rows 8-9 eye band with holes, 10-15 open jaw
        if j >= 10: return TINT(0.8) if i < 2 or i > 13 else HOLE
        if j in (8, 9): return HOLE if (2 <= i <= 5 or 10 <= i <= 13) else TINT(0.85)
        ax, ay = (i - 5) // 1, j - 2
        if 0 <= ay < 4 and 0 <= i - 5 < 6 and A_MARK[ay][i - 5] == "X": return FIX(*WHITE)
        return TINT(0.95 if 0 < i < w - 1 else 0.78)
    def sides(flip):
        def f(i, j, w, h):            # 16x16: a white wing swept back from the temple
            ii = w - 1 - i if flip else i
            wing = (j == 5 and 4 <= ii <= 12) or (j == 6 and 5 <= ii <= 11) or (j == 7 and 7 <= ii <= 10) or (j == 4 and 9 <= ii <= 13)
            if wing: return FIX(*WHITE)
            if j >= 12 and ii < 4: return TINT(0.7)
            return TINT(0.9 if 0 < i < w - 1 else 0.75)
        return f
    fill(px, F["north"], front); fill(px, F["east"], sides(False)); fill(px, F["west"], sides(True))
    fill(px, F["south"], tinted()); fill(px, F["up"], tinted(0.85)); fill(px, F["down"], lambda *a: HOLE)
    for k, r in faces(g, "head", 1).items(): fill(px, r, fixed(WHITE))                       # the crest
    for k, r in faces(g, "head", 2).items(): fill(px, r, tinted(0.7))                        # brow ridge
    for i in (3, 4):
        for k, r in faces(g, "head", i).items(): fill(px, r, tinted(0.75) if k not in ("east", "west") else fixed(WHITE, edge=0.85))
    save(im, "suit_mask_vanguard")

# ------------------------------------------------------------------ Thunder God torso
def asgard_torso():
    g, im = geo("suit_torso_asgard"), load("suit_torso_asgard")
    px = im.load()
    MAIL, MAIL_D = (64, 66, 72), (38, 40, 46)
    def mail(i, j, w, h):
        return FIX(*(MAIL if (i + (j % 2)) % 2 == 0 else MAIL_D))
    for arm in ("rightArm", "leftArm"):
        for k, r in faces(g, arm, 0).items(): fill(px, r, mail)                                    # sleeves: dark mail
        for k, r in faces(g, arm, 1).items():                                                     # bracers: steel, two rivet rows
            fill(px, r, lambda i, j, w, h: FIX(220, 222, 228) if j in (2, h - 3) and i % 3 == 1 else FIX(*(int(c * (0.78 if i in (0, w - 1) else 1)) for c in STEEL)))
    # six silver discs on the chest (the front face is 16x24 at 2 texels per pixel)
    x, y, w, h = faces(g, "body", 0)["north"]
    for cy in (5, 11, 17):
        for cx in (4, 11):
            for i in range(-2, 3):
                for j in range(-2, 3):
                    if i * i + j * j <= 5:
                        rim = i * i + j * j >= 4
                        px[x + cx + i, y + cy + j] = FIX(*((150, 154, 162) if rim else (214, 218, 226)))
    save(im, "suit_torso_asgard")

# ------------------------------------------------------------------ Visor mask: earpieces onto the head
def visor_mask():
    path = f"{RP}/models/entity/suit/suit_mask_visor.geo.json"
    g = json.load(open(path))
    for b in g["minecraft:geometry"][0]["bones"]:
        for c in b["cubes"]:
            if c["size"] == [1, 3, 4]:   # straight, flush with the head, level with the ears
                c["origin"][0] = -5.2 if c["origin"][0] < 0 else 4.2; c["origin"][1] = 26.5
                c.pop("rotation", None); c.pop("pivot", None)
            elif c["size"] == [2, 1, 5]: c["origin"][1] = 32.4
    json.dump(g, open(path, "w"), indent=1)

# ------------------------------------------------------------------ Lenses mask: ear discs in the suit colour
def lens_mask():
    path = f"{RP}/models/entity/suit/suit_mask.geo.json"
    g = json.load(open(path))
    im = load("suit_mask"); px = im.load()
    for b in g["minecraft:geometry"][0]["bones"]:
        for c in b["cubes"]:
            if c["size"] != [1, 3, 3]: continue
            u, v = c["uv"]; w, h, d = 1, 3, 3
            sc = im.width // 64
            for i in range(2 * (w + d) * sc):
                for j in range((d + h) * sc):
                    X, Y = u * sc + i, v * sc + j
                    if px[X, Y][3] == 0: continue
                    px[X, Y] = TINT(0.8)
            # a dark speaker ring on the outer faces
            for (fx, fy) in [(u, v + d), (u + d + w, v + d)]:
                X, Y = fx * sc, fy * sc
                for i in range(d * sc):
                    for j in range(h * sc):
                        cx, cy = i - (d * sc - 1) / 2, j - (h * sc - 1) / 2
                        if 0.6 < (cx * cx + cy * cy) ** 0.5 < 1.4: px[X + i, Y + j] = FIX(40, 40, 46)
    save(im, "suit_mask")

# ------------------------------------------------------------------ Mark IV muzzle
def mk4_muzzle():
    for stage in ("", "_scuffed", "_battered"):
        p = f"{RP}/textures/origin/models/armor/xmk4_chestplate{stage}.tga"
        im = Image.open(p).convert("RGBA"); px = im.load()
        for X in range(0, 4):
            for Y in range(30, 32):
                if px[X, Y][3]: px[X, Y] = (210, 30, 24, 1)
        im.save(p)

vanguard_torso(); vanguard_mask(); asgard_torso(); visor_mask(); lens_mask(); mk4_muzzle()
print("ok")
