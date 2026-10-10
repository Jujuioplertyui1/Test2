"""A tiny kit for building Bedrock entity models in code: cubes tagged with materials, box-UV regions packed
automatically, and a painter that fills every face with its material (noise, edge shading, per-face details).
Used by tools/art/asgardians.py. Writes a .geo.json and one texture per palette."""
import json, math, random
from PIL import Image, ImageDraw

class Cube:
    def __init__(self, bone, origin, size, mat, inflate=0.0, rotation=None, pivot=None, mirror=False, detail=None):
        self.bone, self.origin, self.size, self.mat = bone, origin, size, mat
        self.inflate, self.rotation, self.pivot, self.mirror, self.detail = inflate, rotation, pivot, mirror, detail
        self.uv = None
    def footprint(self):
        w, h, d = (max(1, math.ceil(v)) for v in self.size)
        return 2 * (d + w), d + h

class Model:
    def __init__(self, ident, tw=128, th=128):
        self.ident, self.tw, self.th = ident, tw, th
        self.bones, self.cubes = [], []
    def bone(self, name, pivot, parent=None, rotation=None):
        b = {"name": name, "pivot": pivot}
        if parent: b["parent"] = parent
        if rotation: b["rotation"] = rotation
        self.bones.append(b); return name
    def cube(self, bone, origin, size, mat, **kw):
        c = Cube(bone, origin, size, mat, **kw); self.cubes.append(c); return c
    def pack(self):
        order = sorted(self.cubes, key=lambda c: -c.footprint()[1])
        x = y = rowh = 0
        for c in order:
            w, h = c.footprint()
            if x + w > self.tw: x, y, rowh = 0, y + rowh, 0
            if y + h > self.th: raise ValueError(f"{self.ident}: texture {self.tw}x{self.th} too small")
            c.uv = [x, y]; x += w; rowh = max(rowh, h)
    def geometry(self, bounds=(3, 3.5, 1.6)):
        self.pack()
        bones = []
        for b in self.bones:
            bb = dict(b)
            cs = []
            for c in self.cubes:
                if c.bone != b["name"]: continue
                d = {"origin": c.origin, "size": c.size, "uv": c.uv}
                if c.inflate: d["inflate"] = c.inflate
                if c.rotation: d["rotation"] = c.rotation; d["pivot"] = c.pivot or c.origin
                if c.mirror: d["mirror"] = True
                cs.append(d)
            if cs: bb["cubes"] = cs
            bones.append(bb)
        return {"description": {"identifier": self.ident, "texture_width": self.tw, "texture_height": self.th,
                                "visible_bounds_width": bounds[0], "visible_bounds_height": bounds[1], "visible_bounds_offset": [0, bounds[2], 0]}, "bones": bones}
    def paint(self, palette, seed=1, details=None):
        """palette: mat -> (r,g,b[,a]) or callable(face, x, y, w, h, draw, rnd). details: {(cube_detail_key): fn(face,...)}"""
        rnd = random.Random(seed)
        im = Image.new("RGBA", (self.tw, self.th), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        for c in self.cubes:
            w, h, dd = (max(1, math.ceil(v)) for v in c.size)
            u, v = c.uv
            faces = {"up": (u + dd, v, w, dd), "down": (u + dd + w, v, w, dd), "right": (u, v + dd, dd, h), "front": (u + dd, v + dd, w, h),
                     "left": (u + dd + w, v + dd, dd, h), "back": (u + dd + w + dd, v + dd, w, h)}
            col = palette.get(c.mat)
            for face, (x, y, fw, fh) in faces.items():
                if col is None: continue
                if callable(col): col(face, x, y, fw, fh, d, rnd); continue
                base = col[:3]; a = col[3] if len(col) > 3 else 255
                shade = {"up": 1.12, "down": 0.7, "front": 1.0, "back": 0.86, "left": 0.92, "right": 0.92}[face]
                for i in range(fw):
                    for j in range(fh):
                        k = shade * (1 + (rnd.random() - 0.5) * 0.1)
                        if (i == 0 or j == 0 or i == fw - 1 or j == fh - 1) and fw > 2 and fh > 2: k *= 0.82
                        d.point((x + i, y + j), fill=tuple(max(0, min(255, int(ch * k))) for ch in base) + (a,))
                if c.detail and details and c.detail in details: details[c.detail](face, x, y, fw, fh, d, rnd)
        return im

def write_geo(path, *models_and_bounds):
    geos = [m.geometry(b) for m, b in models_and_bounds]
    json.dump({"format_version": "1.12.0", "minecraft:geometry": geos}, open(path, "w"), indent=1)
