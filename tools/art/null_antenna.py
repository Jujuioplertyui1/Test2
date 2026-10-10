"""Paints the Signal Tower textures (idle + hot) for geometry.origin.null_antenna. Run from the repo root."""
import random
from PIL import Image, ImageDraw
def box(d, u, v, w, h, dd, fn):
    """call fn(face, x0, y0, fw, fh) for each face of a box-UV cube"""
    for face, (x, y, fw, fh) in {"up": (u + dd, v, w, dd), "down": (u + dd + w, v, w, dd), "west": (u, v + dd, dd, h), "north": (u + dd, v + dd, w, h),
                                  "east": (u + dd + w, v + dd, dd, h), "south": (u + dd + w + dd, v + dd, w, h)}.items():
        if fw > 0 and fh > 0: fn(face, x, y, fw, fh)
def paint(hot):
    rnd = random.Random(7)
    im = Image.new("RGBA", (64, 64), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    def fill(col, jitter=12):
        def f(face, x, y, w, h):
            for i in range(w):
                for j in range(h):
                    k = rnd.randint(-jitter, jitter)
                    d.point((x + i, y + j), fill=tuple(max(0, min(255, c + k)) for c in col) + (255,))
        return f
    box(d, 0, 0, 12, 3, 12, fill((46, 48, 54)))
    box(d, 0, 15, 8, 2, 8, fill((70, 72, 78)))
    for u in (48, 52, 56, 60): box(d, u, 0, 1, 22, 1, fill((28, 28, 32), 6))
    def mast(face, x, y, w, h):
        for j in range(h):
            band = (j // 5) % 2
            col = (200, 40, 40) if band else (225, 225, 225)
            for i in range(w): d.point((x + i, y + j), fill=col + (255,))
    box(d, 32, 15, 2, 38, 2, mast)
    for (u, v, w, h, dd) in [(0, 25, 10, 1, 1), (0, 27, 1, 1, 8), (0, 36, 8, 1, 1)]: box(d, u, v, w, h, dd, fill((90, 92, 98), 8))
    box(d, 0, 38, 10, 8, 7, fill((184, 173, 148), 10))          # the TV box, like NULL's head
    def static(face, x, y, w, h):
        for i in range(w):
            for j in range(h):
                g = rnd.randint(30, 235)
                col = (g, int(g * 0.4), int(g * 0.4)) if hot else (int(g * 0.7), g, g)
                d.point((x + i, y + j), fill=col + (255,))
    box(d, 40, 23, 8, 6, 0, static)
    d.rectangle([40, 29, 55, 29], fill=(0, 0, 0, 0))
    box(d, 0, 53, 10, 6, 1, fill((150, 156, 166), 14))
    box(d, 24, 53, 1, 3, 1, fill((60, 60, 66), 6))
    box(d, 40, 30, 2, 2, 2, fill((255, 60, 50) if hot else (80, 240, 255), 6))
    im.save("ORIGIN_RP/textures/origin/entity/null_antenna" + ("_hot" if hot else "") + ".png")
paint(False); paint(True)
print("ok")
