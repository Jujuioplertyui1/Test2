// ORIGIN v0.22 - models.js
// Effect models that powers put into the world (all of them clean themselves up, and all have a despawn timer):
//   tether()      - a line between two points or two creatures, drawn as a real model of any length up to 32 blocks:
//                   steel chain, blood chain, web line, stretched rubber arm, hellfire chain, void chain, shadow tendril,
//                   psychic link. It can shoot out (grow), hold, and reel back in (shrink).
//   cocoon()      - a web cocoon wrapped around a creature, sized to it, that follows it
//   singularity() - a black hole: black core, spinning accretion disk, photon rings - it can grow
//   tendrilAt()   - a shadow tendril that bursts out of the ground, sways, lashes or grabs, and sinks back
//   clockRune()   - Mirror Hour's clock face on the ground, hands running backwards
import { system } from "@minecraft/server";
import { V, valid } from "./util.js";

export const TK = { chain: 0, blood: 1, web: 2, rubber: 3, hellfire: 4, void: 5, tendril: 6, psy: 7, lumen: 8 };
const live = new Set();
const now = () => system.currentTick;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function spawn(dim, id, loc) { try { return dim.spawnEntity(id, loc); } catch { return null; } }
function kill(e) { try { if (valid(e)) e.remove(); } catch { } }
function setProp(e, k, v) { try { e.setProperty(k, v); } catch { } }
// a point: {x,y,z}, a function returning one, or a creature (the middle of its body)
function pointOf(x) {
  if (!x) return null;
  if (typeof x === "function") { try { return x(); } catch { return null; } }
  if (typeof x.typeId === "string") {
    if (!valid(x)) return null;
    try { const l = x.location, h = x.getHeadLocation(); return { x: l.x, y: l.y + (h.y - l.y) * 0.62, z: l.z }; } catch { return null; }
  }
  return x;
}

// ------------------------------------------------------------------ tethers
// o: { life (ticks, default 20), grow (ticks to shoot out), shrink (ticks to reel in at the end), keep: () => bool }
export function tether(dim, from, to, kind, o = {}) {
  const a = pointOf(from);
  if (!a) return null;
  const e = spawn(dim, "origin:tether", a);
  if (!e) return null;
  const t = { type: "tether", e, dim, from, to, born: now(), life: o.life ?? 20, grow: o.grow ?? 0, shrink: o.shrink ?? 0, keep: o.keep, len: -1, pitch: 999, dead: false };
  setProp(e, "origin:kind", typeof kind === "number" ? kind : TK[kind] ?? 0);
  t.cut = () => { if (!t.dead) { t.dead = true; kill(t.e); live.delete(t); } };
  t.retarget = (f2, t2) => { if (f2) t.from = f2; if (t2) t.to = t2; };
  t.reel = (ticks = 5) => { t.shrink = ticks; t.life = Math.min(t.life, now() - t.born + ticks); };   // pull it back in now
  t.extend = (ticks) => { t.life = Math.max(t.life, now() - t.born + ticks); };
  t.tip = () => { const p = pointOf(t.from), q = pointOf(t.to); if (!p || !q) return null; return V.lerp(p, q, t.k ?? 1); };
  live.add(t);
  aimTether(t);
  return t;
}
function aimTether(t) {
  const a = pointOf(t.from), b = pointOf(t.to);
  if (!a || !b || !valid(t.e)) return false;
  const age = now() - t.born;
  let k = 1;
  if (t.grow > 0 && age < t.grow) k = (age + 1) / t.grow;
  if (t.shrink > 0 && age > t.life - t.shrink) k = Math.min(k, Math.max(0, (t.life - age) / t.shrink));
  t.k = k;
  const d = V.sub(b, a), L = V.len(d) * k;
  const yaw = (Math.atan2(-d.x, d.z) * 180) / Math.PI;
  const pitch = Math.round(clamp((-Math.asin(clamp(d.y / (V.len(d) || 1), -1, 1)) * 180) / Math.PI, -90, 90));
  try { t.e.teleport(a, { rotation: { x: 0, y: yaw } }); } catch { return false; }
  const segs = clamp(Math.round(L * 2), 0, 64);
  if (segs !== t.len) { t.len = segs; setProp(t.e, "origin:len", segs); }
  if (pitch !== t.pitch) { t.pitch = pitch; setProp(t.e, "origin:pitch", pitch); }
  return true;
}

// ------------------------------------------------------------------ cocoon: wraps a creature until it's free
export function cocoon(target, ticks) {
  if (!valid(target)) return null;
  for (const m of live) if (m.type === "cocoon" && m.target === target) { m.until = Math.max(m.until, now() + ticks); return m; }
  const e = spawn(target.dimension, "origin:web_wrap", target.location);
  if (!e) return null;
  let h = 1.8;
  try { h = target.getHeadLocation().y - target.location.y + 0.35; } catch { }
  const w = clamp(Math.round(((/spider|golem|ravager|hoglin|polar_bear|horse|cow|sniffer/.test(target.typeId) ? 1.3 : clamp(h * 0.42, 0.45, 1.1)) / 1.06) * 10), 3, 40);
  setProp(e, "origin:w", w);
  setProp(e, "origin:h", clamp(Math.round((h / 1.94) * 10), 3, 40));
  const m = { type: "cocoon", e, target, until: now() + ticks, dead: false };
  m.cut = () => { if (!m.dead) { m.dead = true; kill(m.e); live.delete(m); } };
  live.add(m);
  return m;
}
export const cocooned = (e) => { for (const m of live) if (m.type === "cocoon" && m.target === e && !m.dead) return true; return false; };

// ------------------------------------------------------------------ singularity
export function singularity(dim, c, ticks) {
  const e = spawn(dim, "origin:singularity", c);
  if (!e) return null;
  const m = { type: "fixed", e, until: now() + ticks, dead: false };
  m.cut = () => { if (!m.dead) { m.dead = true; kill(m.e); live.delete(m); } };
  m.size = (k) => setProp(e, "origin:size", clamp(Math.round(k * 10), 1, 40));
  m.move = (p) => { try { e.teleport(p); } catch { } };
  live.add(m);
  return m;
}

// ------------------------------------------------------------------ shadow tendril out of the ground
const TPLAY = (e, a, len = "0") => { try { e.playAnimation(`animation.origin.tendril.${a}`, { controller: "origin_tendril", stopExpression: len, blendOutTime: 0.1 }); } catch { } };
export function tendrilAt(dim, loc, ticks = 40, yaw = Math.random() * 360) {
  const e = spawn(dim, "origin:tendril", loc);
  if (!e) return null;
  try { e.teleport(loc, { rotation: { x: 0, y: yaw } }); } catch { }   // (it rises out of the ground by itself: "rise" runs from spawn)
  const m = { type: "tendril", e, until: now() + ticks, sinkAt: now() + ticks - 9, sunk: false, dead: false };
  m.whip = () => TPLAY(e, "whip");
  m.grab = () => TPLAY(e, "grab");
  m.cut = () => { if (!m.dead) { m.dead = true; kill(m.e); live.delete(m); } };
  m.face = (p) => { try { const d = V.sub(p, e.location); e.teleport(e.location, { rotation: { x: 0, y: (Math.atan2(-d.x, d.z) * 180) / Math.PI } }); } catch { } };
  live.add(m);
  return m;
}

// ------------------------------------------------------------------ Mirror Hour clock rune
export function clockRune(dim, loc, ticks = 40) {
  const e = spawn(dim, "origin:clock_rune", { x: loc.x, y: Math.floor(loc.y) + 0.03, z: loc.z });
  if (!e) return null;
  const m = { type: "fixed", e, until: now() + ticks, dead: false };
  m.cut = () => { if (!m.dead) { m.dead = true; kill(m.e); live.delete(m); } };
  live.add(m);
  return m;
}

// every tick
export function tickModels() {
  const t = now();
  for (const m of [...live]) {
    if (m.dead) { live.delete(m); continue; }
    if (!valid(m.e)) { m.dead = true; live.delete(m); continue; }
    if (m.type === "tether") {
      if (t - m.born >= m.life || (m.keep && !m.keep()) || !aimTether(m)) m.cut();
    } else if (m.type === "cocoon") {
      if (t >= m.until || !valid(m.target)) { m.cut(); continue; }
      try { m.e.teleport(m.target.location, { rotation: { x: 0, y: m.target.getRotation().y } }); } catch { m.cut(); }
    } else if (m.type === "tendril") {
      if (!m.sunk && t >= m.sinkAt) { m.sunk = true; TPLAY(m.e, "sink"); }
      if (t >= m.until) m.cut();
    } else if (t >= m.until) m.cut();
  }
}
// how many tethers are out (so a burst of chains never floods the world)
export const tetherCount = () => { let n = 0; for (const m of live) if (m.type === "tether") n++; return n; };
