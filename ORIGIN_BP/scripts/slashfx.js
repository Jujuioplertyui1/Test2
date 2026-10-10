// ORIGIN v0.17 - slashfx.js
// Sword trails drawn in 3D: arcs of thin streak particles laid along the path of the blade (bright core + coloured glow),
// flying crescents, gravity vortices and gravity rain. Used by XoX and by your own blades.
import { system } from "@minecraft/server";
import { fx } from "./util.js";

const rad = (d) => (d * Math.PI) / 180;
const flat = (v) => { const l = Math.hypot(v.x, v.z) || 1; return { x: v.x / l, y: 0, z: v.z / l }; };
export const STEEL = { red: 0.92, green: 0.95, blue: 1 }, ICE = { red: 0.55, green: 0.75, blue: 1 }, VIOLET = { red: 0.69, green: 0.45, blue: 1 }, WHITE = { red: 1, green: 1, blue: 1 };
// tilt: 0 = horizontal cut, 90 = overhead/vertical, +-45 = diagonals. Angles: 0 = his right side, 90 = straight ahead, 180 = his left.
export function slashArc(dim, c, fwd, o = {}) {
  const { radius = 2.2, tilt = 0, from = 15, to = 165, color = STEEL, glow = ICE, steps = 14, len = 0.5, w = 0.06, sweep = 2, life = 0.22, alpha = 1 } = o;
  const f = flat(fwd), r = { x: -f.z, y: 0, z: f.x }, t = rad(tilt);
  const u = { x: r.x * Math.cos(t), y: Math.sin(t), z: r.z * Math.cos(t) }, dir = to > from ? 1 : -1;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps, a = rad(from + (to - from) * k);
    const p = { x: c.x + (u.x * Math.cos(a) + f.x * Math.sin(a)) * radius, y: c.y + u.y * Math.cos(a) * radius, z: c.z + (u.z * Math.cos(a) + f.z * Math.sin(a)) * radius };
    const g = { dx: (-u.x * Math.sin(a) + f.x * Math.cos(a)) * dir, dy: -u.y * Math.sin(a) * dir, dz: (-u.z * Math.sin(a) + f.z * Math.cos(a)) * dir };
    const emit = () => {
      fx(dim, "origin:streak", p, color, alpha * (0.5 + 0.5 * k), { ...g, len, w, spd: 1.6, life });
      if (glow) fx(dim, "origin:streak_glow", p, glow, alpha * (0.3 + 0.35 * k), { ...g, len, w, spd: 1.6, life: life * 1.25 });
    };
    const d = Math.floor(k * sweep);
    if (d <= 0) emit(); else system.runTimeout(emit, d);
  }
}
// a flying crescent (one frame of it): bulges forward, tips trail back
export function crescent(dim, c, dir, o = {}) {
  const { size = 1.6, color = WHITE, glow = ICE, steps = 9, vertical = false } = o;
  const f = flat(dir), r = { x: -f.z, y: 0, z: f.x }, side = vertical ? { x: 0, y: 1, z: 0 } : r;
  for (let i = 0; i <= steps; i++) {
    const a = rad(-75 + (150 * i) / steps), bul = Math.cos(a) * size * 0.45;
    const p = { x: c.x + side.x * Math.sin(a) * size + f.x * bul, y: c.y + side.y * Math.sin(a) * size, z: c.z + side.z * Math.sin(a) * size + f.z * bul };
    fx(dim, "origin:streak", p, color, 0.9, { dx: f.x, dy: 0, dz: f.z, len: 0.55, w: 0.07, spd: 0.4, life: 0.12 });
    if (glow) fx(dim, "origin:streak_glow", p, glow, 0.55, { dx: f.x, dy: 0, dz: f.z, len: 0.6, w: 0.07, spd: 0.4, life: 0.14 });
  }
}
// a straight cut: streaks along a line (dashes, thrusts, the iai draw)
export function cutLine(dim, a, b, o = {}) {
  const { color = WHITE, glow = ICE, n = 10 } = o;
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, l = Math.hypot(d.x, d.y, d.z) || 1, u = { dx: d.x / l, dy: d.y / l, dz: d.z / l };
  for (let i = 0; i <= n; i++) {
    const p = { x: a.x + (d.x * i) / n, y: a.y + (d.y * i) / n, z: a.z + (d.z * i) / n };
    fx(dim, "origin:streak", p, color, 0.9, { ...u, len: Math.min(1.4, l / n + 0.3), w: 0.05, spd: 0.8, life: 0.25 });
    if (glow) fx(dim, "origin:streak_glow", p, glow, 0.5, { ...u, len: Math.min(1.4, l / n + 0.3), w: 0.05, spd: 0.8, life: 0.3 });
  }
}
export function vortex(dim, c, size = 3, color = VIOLET) { fx(dim, "origin:grav_mote", c, color, 0.9, { size }); }
export function gravRain(dim, top, size = 1.5, color = VIOLET) { fx(dim, "origin:grav_fall", top, color, 0.85, { size }); }

// a punch impact: short streaks bursting outward from the hit point, around the punch direction
export function burst(dim, c, dir, o = {}) {
  const { n = 8, size = 0.45, color = WHITE, glow = null, spd = 3 } = o;
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1, d = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
  const a = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let u = { x: d.y * a.z - d.z * a.y, y: d.z * a.x - d.x * a.z, z: d.x * a.y - d.y * a.x };
  const ul = Math.hypot(u.x, u.y, u.z) || 1; u = { x: u.x / ul, y: u.y / ul, z: u.z / ul };
  const v = { x: d.y * u.z - d.z * u.y, y: d.z * u.x - d.x * u.z, z: d.x * u.y - d.y * u.x };
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2 + Math.random() * 0.4, cs = Math.cos(t), sn = Math.sin(t);
    const r = { dx: u.x * cs + v.x * sn + d.x * 0.35, dy: u.y * cs + v.y * sn + d.y * 0.35, dz: u.z * cs + v.z * sn + d.z * 0.35 };
    const p = { x: c.x + r.dx * 0.12, y: c.y + r.dy * 0.12, z: c.z + r.dz * 0.12 };
    fx(dim, "origin:streak", p, color, 0.95, { ...r, len: size, w: 0.05, spd, life: 0.13 });
    if (glow) fx(dim, "origin:streak_glow", p, glow, 0.5, { ...r, len: size, w: 0.05, spd, life: 0.16 });
  }
}
// a persistent trail line (knocked bodies, speed ribbons, contrails)
export function trailLine(dim, a, b, color = WHITE, o = {}) {
  const { step = 0.32, size = 0.42, life = 1.4, alpha = 0.85 } = o;
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, l = Math.hypot(d.x, d.y, d.z);
  const n = Math.min(40, Math.max(1, Math.ceil(l / step)));
  for (let i = 1; i <= n; i++) fx(dim, "origin:trail_line", { x: a.x + (d.x * i) / n, y: a.y + (d.y * i) / n, z: a.z + (d.z * i) / n }, color, alpha, { size, life });
}
// laser eyes: a white-hot core inside a red glow, and a burning impact
const LCORE = { red: 1, green: 0.88, blue: 0.86 }, LGLOW = { red: 1, green: 0.08, blue: 0.06 }, LHOT = { red: 1, green: 0.55, blue: 0.12 };
export function laserLine(dim, a, b) {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, l = Math.hypot(d.x, d.y, d.z), n = Math.min(110, Math.max(2, Math.ceil(l / 0.22)));
  for (let i = 0; i <= n; i++) {
    const p = { x: a.x + (d.x * i) / n, y: a.y + (d.y * i) / n, z: a.z + (d.z * i) / n };
    fx(dim, "origin:laser_core", p, LCORE, 1, { size: 0.09 });
    if (i % 2 === 0) fx(dim, "origin:laser_glow", p, LGLOW, 0.6, { size: 0.34 });
  }
}
export function laserImpact(dim, c, t) {
  fx(dim, "origin:laser_glow", c, LHOT, 0.9, { size: 1.0 });
  fx(dim, "origin:laser_core", c, LCORE, 1, { size: 0.45 });
  if (t % 2 === 0) fx(dim, "origin:star", c, { red: 1, green: 0.95, blue: 0.8 }, 1, { n: 3 });
  if (t % 4 === 0) fx(dim, "origin:boom_smoke", c, { red: 0.3, green: 0.28, blue: 0.27 }, 0.4);
}
