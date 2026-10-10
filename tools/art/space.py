"""Paints the space art: the planet atlas (Earth, Moon, Sun), the star dot, the sky panel, and the Orbital Seal icon.
Run from the repo root: python3 tools/art/space.py"""
import math, random
from PIL import Image, ImageDraw, ImageFilter
rnd = random.Random(2024)
W, H = 256, 128
atlas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
# --- Earth (0,0)-(128,128): oceans, continents, ice caps, clouds, a thin blue limb
def noise2(x, y, s):
    v = 0
    for o in range(4):
        f = 2 ** o
        v += math.sin((x * 0.07 * f + s) * 1.3 + math.cos(y * 0.05 * f - s)) * math.cos(y * 0.06 * f + x * 0.02 * f + s * 2) / f
    return v
earth = Image.new("RGBA", (128, 128), (0, 0, 0, 0)); ep = earth.load()
cx = cy = 63.5; R = 60
for x in range(128):
    for y in range(128):
        dx, dy = (x - cx) / R, (y - cy) / R
        r2 = dx * dx + dy * dy
        if r2 > 1:
            if r2 < 1.06: ep[x, y] = (90, 160, 255, int(200 * (1.06 - r2) / 0.06))
            continue
        z = math.sqrt(1 - r2)
        u, v = math.atan2(dx, z), math.asin(dy)
        land = noise2(u * 60, v * 60, 1.7) > 0.35
        lat = abs(dy)
        if lat > 0.86: col = (235, 242, 250)
        elif land: col = (70 + int(40 * noise2(u * 90, v * 90, 3)), 120 + int(30 * noise2(u * 80, v * 70, 5)), 60) if lat < 0.6 else (150, 140, 110)
        else: col = (24, 70, 150)
        if noise2(u * 45 + 7, v * 70, 9) > 0.55: col = tuple(int(c * 0.3 + 240 * 0.7) for c in col)   # clouds
        light = max(0.18, 0.35 + 0.75 * (z * 0.7 + (-dx) * 0.5 + (-dy) * 0.3))
        col = tuple(min(255, int(c * light)) for c in col)
        rim = max(0, 1 - z) ** 3
        col = (int(col[0] * (1 - rim) + 110 * rim), int(col[1] * (1 - rim) + 170 * rim), int(col[2] * (1 - rim) + 255 * rim))
        ep[x, y] = col + (255,)
atlas.paste(earth, (0, 0))
# --- Moon (128,0)-(192,64)
moon = Image.new("RGBA", (64, 64), (0, 0, 0, 0)); mp = moon.load()
craters = [(rnd.uniform(-0.7, 0.7), rnd.uniform(-0.7, 0.7), rnd.uniform(0.08, 0.22)) for _ in range(14)]
for x in range(64):
    for y in range(64):
        dx, dy = (x - 31.5) / 30, (y - 31.5) / 30
        r2 = dx * dx + dy * dy
        if r2 > 1: continue
        z = math.sqrt(1 - r2)
        g = 190 + int(20 * noise2(x * 3, y * 3, 2))
        for (a, b, s) in craters:
            d = math.hypot(dx - a, dy - b)
            if d < s: g -= int(45 * (1 - d / s))
            elif d < s * 1.2: g += 15
        light = max(0.25, 0.4 + 0.7 * (z * 0.7 + (-dx) * 0.5))
        g = max(40, min(255, int(g * light)))
        mp[x, y] = (g, g, int(g * 0.97), 255)
atlas.paste(moon, (128, 0))
# --- Sun (192,0)-(256,64): white core, soft gold glow
sun = Image.new("RGBA", (64, 64), (0, 0, 0, 0)); sp = sun.load()
for x in range(64):
    for y in range(64):
        d = math.hypot(x - 31.5, y - 31.5) / 32
        if d > 1: continue
        if d < 0.35: sp[x, y] = (255, 255, 245, 255)
        else:
            a = int(255 * max(0, (1 - d) / 0.65) ** 1.6)
            sp[x, y] = (255, 230, 150, a)
atlas.paste(sun, (192, 0))
# --- a star dot (128,64)-(136,72) and a black sky panel (136,64)-(144,72)
d = ImageDraw.Draw(atlas)
d.rectangle([129, 65, 134, 70], fill=(255, 255, 255, 255)); d.point([(128, 67), (135, 67), (131, 64), (131, 71)], fill=(200, 210, 255, 160))
d.rectangle([136, 64, 143, 71], fill=(2, 2, 6, 255))
atlas.save("ORIGIN_RP/textures/origin/particle/space.png")
# --- Orbital Seal icon (32x32): a white helmet visor over a ringed planet
ic = Image.new("RGBA", (32, 32), (0, 0, 0, 0)); d = ImageDraw.Draw(ic)
d.ellipse([7, 8, 25, 26], fill=(40, 90, 170, 255), outline=(150, 210, 255, 255))
d.arc([1, 13, 31, 22], 200, 340, fill=(255, 210, 120, 255), width=2)
d.arc([1, 13, 31, 22], 20, 160, fill=(255, 210, 120, 255), width=2)
d.ellipse([12, 11, 17, 15], fill=(190, 230, 255, 255))
d.rectangle([14, 2, 17, 6], fill=(220, 225, 235, 255)); d.rectangle([13, 6, 18, 7], fill=(150, 160, 175, 255))
ic.save("ORIGIN_RP/textures/origin/ui/x_orbital.png")
print("ok")
