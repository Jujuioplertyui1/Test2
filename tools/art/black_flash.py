"""Paints the Black Flash skin (64x64 player layout, used on geometry.origin.ghost_body). Run from the repo root."""
import random
from PIL import Image, ImageDraw
rnd = random.Random(13)
im = Image.new("RGBA", (64, 64), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
def region(x0, y0, x1, y1, base, j=10):
    for x in range(x0, x1):
        for y in range(y0, y1):
            k = rnd.randint(-j, j); d.point((x, y), fill=tuple(max(0, min(255, c + k)) for c in base) + (255,))
# head: black cowl, a grey skull-face, red eyes
region(0, 0, 32, 16, (18, 16, 20))
region(9, 10, 15, 16, (70, 66, 72), 6)                # face (front is 8..16 x 8..16)
d.rectangle([9, 11, 10, 11], fill=(255, 30, 20, 255)); d.rectangle([13, 11, 14, 11], fill=(255, 30, 20, 255))
d.rectangle([10, 14, 13, 14], fill=(20, 18, 22, 255))
d.rectangle([7, 8, 8, 9], fill=(150, 20, 20, 255)); d.rectangle([16, 8, 17, 9], fill=(150, 20, 20, 255))   # little lightning ears
# body + limbs: black suit with red lightning
for (x0, y0, x1, y1) in [(16, 16, 40, 32), (40, 16, 56, 32), (32, 48, 48, 64), (0, 16, 16, 32), (16, 48, 32, 64)]:
    region(x0, y0, x1, y1, (14, 12, 16), 8)
bolt = [(23, 20), (24, 21), (22, 22), (23, 23), (21, 24), (24, 25), (23, 26), (25, 27)]
for (x, y) in bolt: d.point((x, y), fill=(220, 30, 25, 255)); d.point((x + 1, y), fill=(255, 90, 60, 255))
d.rectangle([20, 31, 27, 31], fill=(120, 15, 15, 255))   # belt
for x0 in (40, 32, 0, 16):
    d.rectangle([x0, 27 if x0 in (40, 0) else 59, x0 + 15, 27 if x0 in (40, 0) else 59], fill=(160, 20, 20, 255))
im.save("ORIGIN_RP/textures/origin/entity/black_flash.png")
print("ok")
