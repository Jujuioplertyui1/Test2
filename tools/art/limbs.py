"""Paints the severed-arm textures (one per look) for geometry.origin.limb (a 4x12x4 arm, box UV at 0,0).
Run from the repo root: python3 tools/art/limbs.py"""
import random
from PIL import Image, ImageDraw
S = 4                     # pixels per texel: the model is 16x16 texels, the image 64x64
OUT = "ORIGIN_RP/textures/origin/entity/limb_{}.png"
def shade(c, k): return tuple(max(0, min(255, int(v * k))) for v in c[:3]) + (255,)
def hexc(h): h = h.lstrip("#"); return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
LOOKS = {
    "flesh":   dict(skin="#C9946B", sleeve="#2E8C8C", cuff="#22696B", hand="#B98260", sleeve_rows=5),
    "armored": dict(skin="#8E949C", sleeve="#6B717A", cuff="#4B5058", hand="#7C828A", sleeve_rows=7, plate=True),
    "zombie":  dict(skin="#5E8C3F", sleeve="#2E7B7E", cuff="#1F5A5C", hand="#4E7A33", sleeve_rows=4, torn=True, rot=True),
    "bone":    dict(skin="#DCD6C3", sleeve=None, cuff=None, hand="#C9C2AB", sleeve_rows=0, bone=True),
    "grey":    dict(skin="#8E9897", sleeve="#4C4A52", cuff="#36343B", hand="#7F8988", sleeve_rows=6),
    "piglin":  dict(skin="#E3A49B", sleeve="#5B3A27", cuff="#D9A53A", hand="#D48E86", sleeve_rows=3),
    "husk":    dict(skin="#B9A274", sleeve="#6E5A3A", cuff="#54452C", hand="#A68F62", sleeve_rows=4, torn=True),
}
def paint(name, L, seed):
    rnd = random.Random(seed)
    im = Image.new("RGBA", (16 * S, 16 * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    skin, hand = hexc(L["skin"]), hexc(L["hand"])
    def px(x, y, c): d.rectangle([x, y, x, y], fill=c)
    # four sides: x from 0..16 texels, rows 4..16 (12 rows, top = shoulder)
    for side in range(4):
        x0 = side * 4 * S
        for ty in range(12):
            for tx in range(4):
                if L.get("bone"):
                    # humerus: thick top, knobby elbow at row 6, two thin forearm bones below
                    c = skin
                    if ty == 6: c = shade(skin, 1.05)
                    elif ty > 6 and tx in (0, 3): c = (0, 0, 0, 0) if ty < 10 else shade(skin, 0.9)
                    elif ty > 6 and tx in (1, 2) and side % 2 == 1 and ty < 10: c = shade(skin, 0.8)
                    base = c
                elif ty < L["sleeve_rows"]:
                    base = hexc(L["sleeve"]) if ty < L["sleeve_rows"] - 1 else hexc(L["cuff"])
                elif ty >= 9:
                    base = hand
                else:
                    base = skin
                for py in range(S):
                    for pxl in range(S):
                        if base[3] == 0: continue
                        k = 1 + (rnd.random() - 0.5) * 0.12
                        if L.get("plate") and ty < L["sleeve_rows"] and (py == 0 and ty % 3 == 0): k *= 0.7
                        if L.get("rot") and rnd.random() < 0.05: k *= 0.75
                        px(x0 + tx * S + pxl, 4 * S + ty * S + py, shade(base, k))
        # torn sleeve hem
        if L.get("torn") and L["sleeve_rows"]:
            y = 4 * S + L["sleeve_rows"] * S
            for xx in range(4 * S):
                if rnd.random() < 0.55: d.rectangle([x0 + xx, y, x0 + xx, y + rnd.randint(0, S + 2)], fill=shade(hexc(L["sleeve"]), 0.85))
        # plate rivets
        if L.get("plate"):
            for ry in (1, 4):
                d.rectangle([x0 + S * 2 - 1, 4 * S + ry * S + 1, x0 + S * 2, 4 * S + ry * S + 2], fill=(200, 205, 212, 255))
        # fingers on the front (side 1) and knuckles on the back (side 3); a thumb on the inner side (side 2)
        hy = 4 * S + 9 * S
        if not L.get("bone"):
            if side == 1:
                for f in range(1, 4): d.line([x0 + f * S, hy + S, x0 + f * S, hy + 3 * S - 1], fill=shade(hand, 0.72))
                d.line([x0, hy + S - 1, x0 + 4 * S - 1, hy + S - 1], fill=shade(hand, 0.8))
            if side == 3:
                for f in range(4): d.rectangle([x0 + f * S + 1, hy + 1, x0 + f * S + 2, hy + 2], fill=shade(hand, 1.15))
            if side == 2:
                d.rectangle([x0 + S, hy + S, x0 + 2 * S, hy + 2 * S + 2], fill=shade(hand, 0.85))
        else:
            if side == 1:
                for f in range(4): d.rectangle([x0 + f * S + 1, hy + S, x0 + f * S + 2, hy + 3 * S - 1], fill=shade(skin, 0.95))
    # top (shoulder stump) at (4,0) and bottom (hand end) at (8,0), each 4x4 texels
    sx, sy = 4 * S, 0
    if L.get("bone"):
        d.rectangle([sx, sy, sx + 4 * S - 1, sy + 4 * S - 1], fill=shade(skin, 0.85))
        d.ellipse([sx + S, sy + S, sx + 3 * S - 1, sy + 3 * S - 1], fill=shade(skin, 1.08))
    else:
        meat = hexc("#7A0E12") if name != "armored" else hexc("#5A0B0E")
        d.rectangle([sx, sy, sx + 4 * S - 1, sy + 4 * S - 1], fill=meat)
        d.rectangle([sx, sy, sx + 4 * S - 1, sy + 4 * S - 1], outline=shade(meat, 0.7))
        for _ in range(10):
            x, y = rnd.randint(sx + 1, sx + 4 * S - 2), rnd.randint(sy + 1, sy + 4 * S - 2)
            px(x, y, hexc("#B3171C"))
        d.ellipse([sx + S + 1, sy + S + 1, sx + 3 * S - 2, sy + 3 * S - 2], fill=hexc("#EDE6D2"))
        d.point([sx + 2 * S - 1, sy + 2 * S - 1], fill=hexc("#C9BFA6"))
        if L["sleeve_rows"]:
            d.rectangle([sx, sy, sx + 4 * S - 1, sy], fill=hexc(L["sleeve"])); d.rectangle([sx, sy + 4 * S - 1, sx + 4 * S - 1, sy + 4 * S - 1], fill=hexc(L["sleeve"]))
    bx = 8 * S
    d.rectangle([bx, 0, bx + 4 * S - 1, 4 * S - 1], fill=shade(hand if not L.get("bone") else skin, 0.92))
    for f in range(1, 4): d.line([bx + f * S, 0, bx + f * S, 4 * S - 1], fill=shade(hand if not L.get("bone") else skin, 0.75))
    im.save(OUT.format(name))
for i, (name, L) in enumerate(LOOKS.items()): paint(name, L, 1000 + i)
print("painted", list(LOOKS))
