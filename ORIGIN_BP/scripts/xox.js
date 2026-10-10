// ORIGIN v0.23 - xox.js
// XoX: a gravity-bending samurai lord. Three phases, each with its own form (the origin:form property):
//   I    The Swordsman (100%-60%): strings of real cuts, a dash cut, the quick-draw you have to step out of, flying
//        crescents, gravity that presses you flat and drags flyers out of the sky.
//   II   The Mask (60%-25%): the oni mask goes on, a gravity halo turns behind him. Adds Crescent Storm, Phantom Blades,
//        the Gravity Well iai (parry it!), and his cutscene Ultimates: Thousand Cuts, Gravity Collapse, Heavenly Severance.
//   III  Event Horizon (25%-0): a black sun opens in the halo, an accretion ring and orbiting rock circle him, the arena
//        closes in. Adds Meteor Rain, a gravity aura, and at 10% his last stand: ZERO POINT.
// The fight is held in an arena around where he landed: walk out of it and gravity drags you back.
// He blocks from the front (and cuts repulsor beams in half, slices missiles), but PARRY him (start guarding right as
// he swings) and he staggers open: that's your window. Beat him and his katana and mask are yours.
// Summon: the Gravity Seal (or /hero xox).
import { world, system, EntityDamageCause, ItemStack } from "@minecraft/server";
import { hero, RT, saveNow } from "./data.js";
import { V, at, valid, fx, line, sound, now, health, hexToRgb, msg, C, isSolidBlock, yawTo } from "./util.js";
import { hudMsg } from "./voice.js";
import { runCine, EASE } from "./cine.js";
import { isFlying, stopFlight } from "./flight.js";
import { slashArc, crescent, cutLine, vortex, gravRain, STEEL, ICE, VIOLET, WHITE } from "./slashfx.js";
import { heavyLaunch, destructionOn, crater } from "./impact.js";
import { bleed } from "./gorefx.js";
import { singularity } from "./models.js";

export const XOX = "origin:xox";
const PHANTOM = "origin:xox_phantom";
const PURPLE = hexToRgb("#B07CFF"), DEEP = hexToRgb("#3a1a5c"), GOLD = hexToRgb("#ffd36a"), PALE = hexToRgb("#e6d6ff");
const NAMES = ["§5XoX", "§5XoX §d· The Mask", "§5XoX §d· Event Horizon"];
const POW = [1, 1.4, 1.65], QUICK = [1, 0.65, 0.5], ARENA_R = [26, 26, 18];
const bosses = new Map();
const wait = (t) => system.waitTicks(Math.max(1, Math.floor(t)));
function B(e) {
  let b = bosses.get(e.id);
  if (!b) { b = { e, cd: {}, form: 0, busy: 0, cine: false, dying: false, acting: false, openUntil: 0, arena: null, contrib: new Set(), threat: {}, zero: false, fxs: new Set(), mods: new Set(), fighters: new Map() }; bosses.set(e.id, b); }
  b.e = e;
  return b;
}
const pow = (b) => POW[b.form] ?? 1;
const glowOf = (b) => (b.form >= 1 ? VIOLET : ICE);
const open = (b) => (b.openUntil ?? 0) > now();
const gone = (b) => !valid(b.e) || b.dying || b.shifting;   // a move stops when he dies or changes form
const alive = (p) => { try { const m = String(p.getGameMode()).toLowerCase(); return valid(p) && m !== "creative" && m !== "spectator"; } catch { return valid(p); } };
const players = (e, r = 48) => { try { return e.dimension.getPlayers({ location: e.location, maxDistance: r }).filter(alive); } catch { return []; } };
function inFront(e, q, deg) { const f = V.flat(e.getViewDirection()), d = V.flat(V.sub(q.location, e.location)); return f.x * d.x + f.z * d.z >= Math.cos((deg * Math.PI) / 180); }
function face(e, q) { try { e.teleport(e.location, { facingLocation: q.getHeadLocation() }); } catch { } }
const chest = (e) => at(e.location, 0, 1.4, 0);
const anim = (e, n, blend = 0.12) => { try { e.playAnimation(`animation.xox.${n}`, { blendOutTime: blend }); } catch { } };
const shake = (p, a, t) => { try { p.runCommand(`camerashake add @s ${a} ${t} positional`); } catch { } };
// effect entities (phantoms, rocks) go anywhere; XoX himself never ends up inside a block: try the spot, a step up,
// then points back along the way he came
const tpRaw = (e, loc, o) => { try { e.teleport(loc, o); return true; } catch { return false; } };
function tp(e, loc, o = {}) {
  if (e?.typeId !== XOX) return tpRaw(e, loc, o);
  let from; try { from = { ...e.location }; } catch { return false; }
  const cands = [loc, at(loc, 0, 1, 0), V.lerp(loc, from, 0.25), V.lerp(loc, from, 0.5), V.lerp(loc, from, 0.75)];
  for (const c of cands) { try { if (e.tryTeleport(c, { ...o, checkForBlocks: true })) return true; } catch { } }
  return false;
}
// a hit only "lands" if the damage went through (a parry or block cancels it): knockback and launches only then
function hit(b, q, n, dir, kb = 0.6, up = 0.3) {
  if (!alive(q)) return false;
  let landed = false;
  try { landed = q.applyDamage(Math.round(n * pow(b)), { cause: EntityDamageCause.entityAttack, damagingEntity: b.e }); } catch { }
  if (!landed) return false;
  if (dir) { try { q.applyKnockback({ x: dir.x * kb, z: dir.z * kb }, up); } catch { } }
  fx(q.dimension, "origin:flare", q.getHeadLocation(), b.form >= 1 ? PURPLE : C.white, 1);
  shake(q, 0.18, 0.15);
  bleed(q, n, dir);
  return true;
}
const titleAll = (e, t, s, r = 48) => { for (const p of players(e, r)) { try { p.onScreenDisplay.setTitle(t, { fadeInDuration: 4, stayDuration: 40, fadeOutDuration: 10, subtitle: s }); RT(p).titleUntil = now() + 56; } catch { } } };
const voice = (b, text, r = 40) => { for (const p of players(b.e, r)) hudMsg(p, text, 60); };
function glint(b) { fx(b.e.dimension, "origin:sparkle", at(b.e.location, 0, 1.3, 0), GOLD, 1); sound(b.e.dimension, "origin.sfx.chime", b.e.location, 1.7, 0.5); }
function setForm(b, f) {
  b.form = f;
  try { b.e.setProperty("origin:form", f); } catch { }
  try { b.e.nameTag = NAMES[f]; } catch { }
}
// the nearest place to stand at a point's column (solid underfoot, two free blocks above), searching up and down
const solidAt = (dim, x, y, z) => { try { return isSolidBlock(dim.getBlock({ x, y, z })); } catch { return false; } };
function standable(dim, p) { const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z); return solidAt(dim, x, y - 1, z) && !solidAt(dim, x, y, z) && !solidAt(dim, x, y + 1, z); }
function groundAt(dim, p) {
  const x = Math.floor(p.x), y0 = Math.floor(p.y), z = Math.floor(p.z);
  for (let k = 0; k <= 12; k++) for (const dy of k ? [k, -k] : [0]) {
    const y = y0 + dy;
    if (solidAt(dim, x, y - 1, z) && !solidAt(dim, x, y, z) && !solidAt(dim, x, y + 1, z)) return { x: p.x, y, z: p.z };
  }
  return { ...p };
}
// as high as h above a point, but never through a ceiling
function skyAt(dim, base, h) {
  const x = Math.floor(base.x), z = Math.floor(base.z), y0 = Math.floor(base.y);
  for (let dy = 1; dy <= h + 3; dy++) if (solidAt(dim, x, y0 + dy, z)) return at(base, 0, Math.max(0, Math.min(h, dy - 3)), 0);
  return at(base, 0, h, 0);
}
function segDist(q, a, c) {
  const ab = V.sub(c, a), L2 = Math.max(0.01, ab.x * ab.x + ab.z * ab.z);
  const t = Math.max(0, Math.min(1, ((q.x - a.x) * ab.x + (q.z - a.z) * ab.z) / L2));
  return Math.hypot(q.x - (a.x + ab.x * t), q.z - (a.z + ab.z * t));
}
// effect entities and models he puts out are tracked, so they never outlive him
function spawnFx(b, id, loc, yaw) {
  try { const g = b.e.dimension.spawnEntity(id, loc); if (yaw !== undefined) g.teleport(loc, { rotation: { x: 0, y: yaw } }); b.fxs.add(g); return g; } catch { return null; }
}
function drop(b, g) { b.fxs.delete(g); try { if (valid(g)) g.remove(); } catch { } }
function well(b, c, ticks) { const m = singularity(b.e.dimension, c, ticks); if (m) b.mods.add(m); return m; }
function cleanup(b) {
  for (const g of b.fxs) { try { if (valid(g)) g.remove(); } catch { } }
  for (const m of b.mods) { try { m.cut(); } catch { } }
  b.fxs.clear(); b.mods.clear();
}
function telegraph(dim, c, size, color = PURPLE) { fx(dim, "origin:ground_ring", at(c, 0, 0.06, 0), color, 0.95, { size }); }

// ------------------------------------------------------------------ the moveset
// strike frames match the animations: slash_1 0.22s, slash_2 0.20s, slash_3 0.20s, thrust 0.18s
const CUTS = [{ a: "slash_1", strike: 4, tilt: 90, from: 15, to: 165 }, { a: "slash_2", strike: 4, tilt: 0, from: 20, to: 160 }, { a: "slash_3", strike: 4, tilt: -40, from: 165, to: 20 }, { a: "thrust", strike: 4, thrust: true }];
async function combo(b, p) {
  const e = b.e, seq = b.form >= 2 ? [0, 1, 2, 3, 1] : b.form >= 1 ? [0, 1, 2, 3] : [0, 1, 2];
  glint(b);
  for (const i of seq) {
    if (gone(b) || !valid(p) || open(b)) return;
    const cut = CUTS[i];
    face(e, p);
    const f = V.flat(V.sub(p.location, e.location));
    if (V.hdist(p.location, e.location) > 2.8) tp(e, at(p.location, -f.x * 2.2, 0, -f.z * 2.2), { facingLocation: p.getHeadLocation() });
    anim(e, cut.a, 0.06);
    sound(e.dimension, "origin.sfx.swoosh", e.location, 1.5, 0.35);
    await wait(cut.strike);
    if (gone(b) || open(b)) return;
    const ef = V.flat(e.getViewDirection());
    if (cut.thrust) cutLine(e.dimension, at(chest(e), ef.x * 0.6, 0, ef.z * 0.6), at(chest(e), ef.x * 4.4, 0, ef.z * 4.4), { glow: glowOf(b) });
    else slashArc(e.dimension, chest(e), ef, { tilt: cut.tilt, from: cut.from, to: cut.to, radius: 2.5, glow: glowOf(b) });
    sound(e.dimension, "origin.sfx.sweep2", e.location, 0.95 + i * 0.08, 1);
    for (const q of players(e, cut.thrust ? 4.8 : 4.1)) if (inFront(e, q, cut.thrust ? 30 : 75)) hit(b, q, cut.thrust ? 8 : 6, ef, cut.thrust ? 1.0 : 0.45, 0.2);
    await wait(b.form >= 1 ? 3 : 5);
  }
  if (Math.random() < 0.45) await backstep(b, p);
}
async function backstep(b, p) {
  const e = b.e;
  if (gone(b) || !valid(p)) return;
  const f = V.flat(V.sub(e.location, p.location)), side = Math.random() < 0.5 ? 1 : -1;
  const to = at(e.location, f.x * 3 - f.z * side * 1.5, 0, f.z * 3 + f.x * side * 1.5);
  cutLine(e.dimension, chest(e), at(to, 0, 1.3, 0), { color: STEEL, glow: glowOf(b), n: 6 });
  fx(e.dimension, "origin:dust", e.location, C.white, 0.7);
  tp(e, to, { facingLocation: p.getHeadLocation() });
  sound(e.dimension, "origin.sfx.swoosh", to, 1.3, 0.6);
  await wait(4);
}
async function dashCut(b, p) {
  const e = b.e, f = V.flat(V.sub(p.location, e.location)), from = { ...e.location };
  const dist = V.hdist(p.location, e.location) + 3.5, to = at(from, f.x * dist, 0, f.z * dist);
  face(e, p);
  anim(e, "dash", 0.1);
  for (let k = 1; k <= 8; k++) fx(e.dimension, "origin:dot", at(V.lerp(from, to, k / 8), 0, 0.12, 0), b.form >= 1 ? PURPLE : GOLD, 1);
  glint(b);
  await wait(b.form >= 1 ? 6 : 9);
  if (gone(b) || open(b)) return;
  tp(e, to, { facingLocation: at(to, f.x, 1.6, f.z) });
  cutLine(e.dimension, at(from, 0, 1.3, 0), at(to, 0, 1.3, 0), { glow: glowOf(b), n: 14 });
  slashArc(e.dimension, at(to, 0, 1.3, 0), f, { tilt: 0, from: 160, to: 20, radius: 2.2, glow: glowOf(b), sweep: 1 });
  sound(e.dimension, "origin.sfx.sweep2", to, 0.8, 1);
  sound(e.dimension, "origin.sfx.critical", to, 1, 0.7);
  for (const q of players(e, dist + 2)) if (segDist(q.location, from, to) < 1.7) hit(b, q, 9, f, 0.4, 0.3);
}
async function iai(b, p) {
  const e = b.e, mark = { ...p.location };
  face(e, p);
  anim(e, "iai", 0.1);
  sound(e.dimension, "origin.sfx.chime", e.location, 1.5, 1);
  for (let k = 0; k < 10; k += 2) {
    fx(e.dimension, "origin:sparkle", at(e.location, 0.4, 1.0, 0), GOLD, 1);
    telegraph(e.dimension, mark, 4.2, b.form >= 1 ? PURPLE : GOLD);
    await wait(2);
    if (gone(b)) return;
  }
  await wait(1);
  if (gone(b) || open(b)) return;
  const from = { ...e.location }, f = V.flat(V.sub(mark, from)), to = at(mark, f.x * 2.5, 0, f.z * 2.5);
  tp(e, to, { facingLocation: at(to, f.x, 1.6, f.z) });
  cutLine(e.dimension, at(from, 0, 1.3, 0), at(to, 0, 1.3, 0), { color: WHITE, glow: glowOf(b), n: 16 });
  slashArc(e.dimension, at(mark, 0, 1.3, 0), f, { tilt: 0, from: 10, to: 170, radius: 2.8, glow: glowOf(b), sweep: 1, len: 0.7 });
  sound(e.dimension, "origin.sfx.critical", mark, 0.7, 1);
  sound(e.dimension, "origin.sfx.sweep2", mark, 0.6, 1);
  for (const q of players(e, 40)) if (V.hdist(q.location, mark) < 2.1) { hit(b, q, 14, f, 0.6, 0.4); shake(q, 0.4, 0.3); }
}
async function waves(b, p) {
  const e = b.e;
  face(e, p);
  anim(e, "wave", 0.1);
  await wait(5);
  if (gone(b) || open(b)) return;
  const base = V.flat(V.sub(p.location, e.location)), fans = b.form >= 2 ? [-30, -15, 0, 15, 30] : b.form >= 1 ? [-20, 0, 20] : [0];
  slashArc(e.dimension, chest(e), base, { tilt: 90, from: 15, to: 165, radius: 2.6, glow: glowOf(b) });
  sound(e.dimension, "origin.sfx.sweep2", e.location, 0.7, 1);
  for (const deg of fans) {
    const a = (deg * Math.PI) / 180, d = { x: base.x * Math.cos(a) - base.z * Math.sin(a), y: 0, z: base.x * Math.sin(a) + base.z * Math.cos(a) };
    const dim = e.dimension, seen = new Set();
    let pos = at(e.location, d.x * 1.6, 1.2, d.z * 1.6);
    (async () => {
      for (let k = 0; k < 20; k++) {
        pos = at(pos, d.x * 1.3, 0, d.z * 1.3);
        crescent(dim, pos, d, { size: 1.6, glow: glowOf(b) });
        try { for (const q of dim.getPlayers({ location: pos, maxDistance: 1.7 })) if (alive(q) && !seen.has(q.id)) { seen.add(q.id); hit(b, q, 8, d, 0.9, 0.3); } } catch { }
        try { if (isSolidBlock(dim.getBlock(pos))) break; } catch { }
        await wait(1);
      }
    })();
  }
}
async function press(b) {
  const e = b.e, targets = players(e, b.form >= 1 ? 15 : 10);
  anim(e, "press", 0.12);
  sound(e.dimension, "origin.sfx.gravity", e.location, 0.9, 1);
  for (let k = 0; k < 7; k++) { for (const q of targets) if (valid(q)) { vortex(q.dimension, at(q.location, 0, 3.2, 0), 2.2); if (k % 3 === 0) telegraph(q.dimension, q.location, 3); } await wait(1); }
  for (const q of targets) {
    if (!alive(q)) continue;
    gravRain(q.dimension, at(q.location, 0, 4, 0), 1.6);
    fx(q.dimension, "origin:shockwave", at(q.location, 0, 0.1, 0), PURPLE, 1, { radius: 2.4 });
    if (!hit(b, q, 4, null)) continue;
    try { q.applyKnockback({ x: 0, z: 0 }, b.form >= 1 ? -2.4 : -1.6); q.addEffect("slowness", b.form >= 1 ? 80 : 60, { amplifier: b.form >= 1 ? 4 : 3 }); } catch { }
    hudMsg(q, "§5Gravity presses you flat.", 30);
  }
  sound(e.dimension, "origin.sfx.crush", e.location, 0.8, 1);
}
async function antiAir(b, p) {
  const e = b.e;
  face(e, p);
  anim(e, "gravity", 0.15);
  for (let k = 0; k < 6; k++) { if (!valid(p)) return; line(e.dimension, "origin:dot", at(e.location, 0, 1.7, 0), p.getHeadLocation(), PURPLE, 0.7, 0.8); vortex(p.dimension, p.getHeadLocation(), 1.6); await wait(1); }
  if (!valid(p) || gone(b)) return;
  gravRain(p.dimension, at(p.location, 0, 3, 0), 1.2);
  sound(p.dimension, "origin.sfx.gravity", p.location, 0.7, 1);
  if (!hit(b, p, 5, null)) return;
  if (isFlying(p)) stopFlight(p, "tired");
  RT(p).groundedUntil = now() + (b.form >= 1 ? 140 : 80);
  heavyLaunch(p, V.flat(p.getViewDirection()), b.form >= 1 ? 3 : 2, e, { down: true });
  try { p.onScreenDisplay.setTitle(" ", { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 8, subtitle: "§5gravity drags you out of the sky" }); RT(p).titleUntil = now() + 40; } catch { }
}

// ---- Phase II+: real-time set pieces (no cutscene: you dodge them)
// Crescent Storm: he rises into the air and rains crescents down on rings that flash where they will land
async function storm(b) {
  const e = b.e, dim = e.dimension, start = { ...e.location }, sky = skyAt(dim, start, 6.5);
  voice(b, "§5Look up.");
  anim(e, "storm", 0.1);
  sound(dim, "origin.sfx.gravity", start, 1.2, 1);
  await wait(5);
  if (gone(b)) return;
  cutLine(dim, at(start, 0, 1, 0), sky, { color: WHITE, glow: glowOf(b), n: 8 });
  tp(e, sky);
  const N = b.form >= 2 ? 16 : 11, falling = [];
  for (let i = 0; i < N; i++) {
    if (gone(b) || open(b)) break;
    tp(e, sky);
    const ps = players(e, 30), q = ps[i % Math.max(1, ps.length)], ang = i * 1.7, off = (i % 3) * 1.3;
    const g = groundAt(dim, q ? at(q.location, Math.cos(ang) * off, 0, Math.sin(ang) * off) : at(start, Math.cos(ang) * 5, 0, Math.sin(ang) * 5));
    telegraph(dim, g, 3.2);
    falling.push(fallCrescent(b, at(sky, 0, 1.4, 0), g, 8));
    if (i % 2 === 0) { sound(dim, "origin.sfx.sweep2", sky, 1.1 + Math.random() * 0.25, 0.8); slashArc(dim, at(sky, 0, 1.4, 0), { x: Math.cos(ang), y: 0, z: Math.sin(ang) }, { tilt: -50, radius: 2.2, glow: glowOf(b), sweep: 1 }); }
    for (let k = 0; k < 3; k++) { tp(e, sky); await wait(1); }
  }
  for (let k = 0; k < 8 && !gone(b); k++) { tp(e, sky); await wait(1); }
  await Promise.all(falling);
  if (gone(b)) return;
  // down he comes, with one cut into the ground
  const land = groundAt(dim, start);
  cutLine(dim, sky, at(land, 0, 1, 0), { color: WHITE, glow: glowOf(b), n: 10 });
  tp(e, land);
  anim(e, "slash_1", 0.05);
  fx(dim, "origin:shockwave", at(land, 0, 0.1, 0), PURPLE, 1, { radius: 4 }); fx(dim, "origin:debris", land, C.dust, 1);
  sound(dim, "origin.sfx.stonecrash", land, 0.8, 1);
  for (const q of players(e, 4)) hit(b, q, 8, V.flat(V.sub(q.location, land)), 1.2, 0.5);
}
async function fallCrescent(b, from, to, T) {
  const dim = b.e.dimension, d = V.sub(to, from), flatd = V.flat(d);
  telegraph(dim, to, 3.2);
  for (let s = 1; s <= T; s++) {
    const pos = V.lerp(from, at(to, 0, 0.6, 0), s / T);
    crescent(dim, pos, flatd.x || flatd.z ? flatd : { x: 1, y: 0, z: 0 }, { size: 1.3, glow: glowOf(b), vertical: s % 2 === 0 });
    if (s === Math.floor(T / 2)) telegraph(dim, to, 3.2);
    await wait(1);
  }
  fx(dim, "origin:shockwave", at(to, 0, 0.1, 0), PURPLE, 1, { radius: 1.8 }); fx(dim, "origin:debris", to, C.dust, 0.6);
  sound(dim, "origin.sfx.sweep2", to, 1.4, 0.6);
  if (!gone(b)) for (const q of players(b.e, 40)) if (V.hdist(q.location, to) < 1.7 && Math.abs(q.location.y - to.y) < 2.5) hit(b, q, 6, V.flat(V.sub(q.location, to)), 0.5, 0.35);
}
// Phantom Blades: violet copies of him rise around you and cut through you one after another
async function phantoms(b, p) {
  const e = b.e, dim = e.dimension, n = b.form >= 2 ? 5 : 3;
  voice(b, "§5Which of me is real?");
  face(e, p);
  anim(e, "phantom", 0.1);
  sound(dim, "origin.sfx.devil", e.location, 1.4, 0.6);
  await wait(6);
  const list = [];
  for (let k = 0; k < n && valid(p); k++) {
    const a = (k / n) * Math.PI * 2 + Math.random() * 0.7, from = groundAt(dim, at(p.location, Math.cos(a) * 6.5, 0, Math.sin(a) * 6.5));
    const g = spawnFx(b, PHANTOM, from, yawTo(from, p.location));
    fx(dim, "origin:dust_away", at(from, 0, 1, 0), PURPLE, 1); fx(dim, "origin:rise", from, PURPLE, 0.8);
    if (g) list.push({ g, from });
  }
  sound(dim, "origin.sfx.chime", p.location, 0.6, 1);
  for (const ph of list) {
    if (gone(b) || !valid(p) || open(b)) { drop(b, ph.g); continue; }
    const f = V.flat(V.sub(p.location, ph.from)), to = at(p.location, f.x * 3, 0, f.z * 3);
    tp(ph.g, ph.from, { facingLocation: at(p.location, 0, 1.6, 0) });
    try { ph.g.playAnimation("animation.xox.iai", { blendOutTime: 0.1 }); } catch { }
    for (let k = 0; k < 4; k++) fx(dim, "origin:dot", at(V.lerp(ph.from, to, k / 4 + 0.12), 0, 0.15, 0), PURPLE, 1);
    await wait(b.form >= 2 ? 6 : 8);
    if (gone(b)) break;
    try { ph.g.playAnimation("animation.xox.dash", { blendOutTime: 0.1 }); } catch { }
    for (let s = 1; s <= 3; s++) { tp(ph.g, V.lerp(ph.from, to, s / 3), { facingLocation: at(to, f.x, 1.6, f.z) }); await wait(1); }
    cutLine(dim, at(ph.from, 0, 1.3, 0), at(to, 0, 1.3, 0), { color: PALE, glow: VIOLET, n: 12 });
    sound(dim, "origin.sfx.sweep2", to, 1.25, 0.9);
    for (const q of players(e, 40)) if (segDist(q.location, ph.from, to) < 1.5) hit(b, q, 6, f, 0.5, 0.25);
    const g = ph.g;
    system.runTimeout(() => { if (valid(g)) fx(dim, "origin:dust_away", at(g.location, 0, 1, 0), PURPLE, 1); drop(b, g); }, 8);
  }
}
// The Gravity Well: he crouches over his sword while a black hole drags you in, then cuts through it. PARRY IT.
async function gravityWell(b, p) {
  const e = b.e, dim = e.dimension, mark = groundAt(dim, p.location);
  voice(b, "§5Come closer.");
  face(e, p);
  anim(e, "well", 0.1);
  sound(dim, "origin.sfx.gravity", mark, 0.6, 1);
  const s = well(b, at(mark, 0, 1.2, 0), 60);
  s?.size(0.3);
  for (let k = 0; k < 32; k++) {
    if (gone(b)) { s?.cut(); return; }
    s?.size(0.3 + k * 0.028);
    for (const q of players(e, 16)) {
      const d = V.flat(V.sub(mark, q.location)), dist = V.hdist(mark, q.location);
      if (dist > 0.8) { try { q.applyKnockback({ x: d.x * (0.18 + k * 0.006), z: d.z * (0.18 + k * 0.006) }, 0.02); } catch { } }
      if (k === 26) { try { q.onScreenDisplay.setTitle("§e§l!", { fadeInDuration: 0, stayDuration: 8, fadeOutDuration: 4, subtitle: "§eguard now §7(sneak) §eto parry" }); RT(q).titleUntil = now() + 14; } catch { } }
    }
    if (k % 3 === 0) { vortex(dim, at(mark, 0, 1.2, 0), 2.8); telegraph(dim, mark, 5); }
    if (k === 24) { glint(b); sound(dim, "origin.sfx.chime", e.location, 1.2, 1); }
    await wait(1);
  }
  if (gone(b) || open(b)) { s?.cut(); return; }
  const from = { ...e.location }, f = V.flat(V.sub(mark, from)), to = at(mark, f.x * 3, 0, f.z * 3);
  b.wellAt = now();
  tp(e, to, { facingLocation: at(to, f.x, 1.6, f.z) });
  cutLine(dim, at(from, 0, 1.3, 0), at(to, 0, 1.3, 0), { color: WHITE, glow: VIOLET, n: 18 });
  slashArc(dim, at(mark, 0, 1.3, 0), f, { tilt: 0, from: 5, to: 175, radius: 3.2, glow: VIOLET, sweep: 1, len: 0.8, steps: 18 });
  sound(dim, "origin.sfx.critical", mark, 0.55, 1); sound(dim, "origin.sfx.sweep2", mark, 0.5, 1);
  for (const q of players(e, 40)) if (V.hdist(q.location, mark) < 2.6) { hit(b, q, 13, f, 1.1, 0.5); shake(q, 0.45, 0.35); }
  system.runTimeout(() => { if (s) { fx(dim, "origin:shockwave", at(mark, 0, 0.1, 0), PURPLE, 1, { radius: 3 }); s.cut(); b.mods.delete(s); } }, 3);
}
// ---- Phase III: Meteor Rain - he tears rock out of the ground, circles it overhead, and hurls it at you
async function meteors(b) {
  const e = b.e, dim = e.dimension, n = 7;
  voice(b, "§5The sky is falling. §dRun.");
  anim(e, "meteor", 0.1);
  sound(dim, "origin.sfx.gravity", e.location, 0.7, 1); sound(dim, "origin.sfx.stonecrash", e.location, 0.6, 0.8);
  const rocks = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, g0 = groundAt(dim, at(e.location, Math.cos(a) * 3.6, 0, Math.sin(a) * 3.6));
    fx(dim, "origin:debris", g0, C.dust, 1); fx(dim, "origin:dust", g0, C.dust, 0.8);
    const r = spawnFx(b, "origin:tk_rock", at(g0, 0, 0.1, 0));
    if (r) rocks.push({ r, a });
  }
  for (let t = 0; t < 20; t++) {
    if (gone(b)) return;
    for (const rk of rocks) { const a = rk.a + t * 0.13; tp(rk.r, at(e.location, Math.cos(a) * 3.6, 1 + t * 0.3, Math.sin(a) * 3.6)); }
    if (t % 4 === 0) vortex(dim, at(e.location, 0, 4, 0), 3.5);
    await wait(1);
  }
  const ps = players(e, 32), flights = [];
  for (const [i, rk] of rocks.entries()) {
    if (gone(b) || open(b) || !ps.length || !valid(rk.r)) break;
    const q = ps[i % ps.length];
    const tgt = groundAt(dim, at(q.location, (Math.random() - 0.5) * 2.5, 0, (Math.random() - 0.5) * 2.5));
    rk.thrown = true;
    flights.push(hurl(b, rk.r, { ...rk.r.location }, tgt, 11));
    await wait(4);
  }
  for (const rk of rocks) if (!rk.thrown) { if (valid(rk.r)) fx(dim, "origin:debris", rk.r.location, C.dust, 0.6); drop(b, rk.r); }
  await Promise.all(flights);
}
async function hurl(b, r, from, to, T) {
  const dim = b.e.dimension;
  for (let s = 1; s <= T; s++) {
    if (!valid(r)) return;
    const k = s / T, pos = V.lerp(from, to, k);
    pos.y += Math.sin(Math.PI * k) * 3;
    tp(r, pos);
    fx(dim, "origin:boom_smoke", pos, DEEP, 0.6);
    if (s % 3 === 1) telegraph(dim, to, 4.6, s > T - 4 ? hexToRgb("#ff5a8a") : PURPLE);
    await wait(1);
  }
  drop(b, r);
  fx(dim, "origin:shockwave", at(to, 0, 0.1, 0), PURPLE, 1, { radius: 2.8 }); fx(dim, "origin:debris", to, C.dust, 1); fx(dim, "origin:shards", at(to, 0, 0.5, 0), C.dust, 1);
  sound(dim, "origin.sfx.stonecrash", to, 0.7, 1);
  if (destructionOn()) crater(dim, to, 1);
  if (!gone(b)) for (const q of players(b.e, 40)) if (V.dist(q.location, to) < 2.6) { hit(b, q, 7, V.flat(V.sub(q.location, to)), 1.0, 0.55); }
}
// ---- 10%: ZERO POINT. He rises over the arena and lets a black hole grow. Break his focus (hit him hard enough) or
// get far enough away before it goes off.
async function zeroPoint(b) {
  const e = b.e, dim = e.dimension, c = groundAt(dim, b.arena?.c ?? e.location), top = skyAt(dim, c, 5), hp0 = health(e);
  titleAll(e, "§5§lZERO POINT", "§dhit him to break his focus §7· or get away from the centre", 48);
  voice(b, "§5Not yet. §dNOT YET!");
  sound(dim, "origin.sfx.devil", e.location, 0.7, 1); sound(dim, "origin.sfx.gravity", e.location, 0.4, 1);
  anim(e, "zero", 0.2);
  cutLine(dim, at(e.location, 0, 1, 0), top, { color: WHITE, glow: VIOLET, n: 10 });
  tp(e, top);
  const s = well(b, at(top, 0, 2.2, 0), 160);
  const need = (hp0?.max ?? 460) * 0.06, start = hp0?.cur ?? 0;
  let broken = false;
  for (let k = 0; k < 100; k++) {
    if (gone(b)) { s?.cut(); return; }
    tp(e, top);
    s?.size(0.5 + k * 0.032);
    for (const q of players(e, 34)) {
      const d = V.flat(V.sub(c, q.location)), str = 0.1 + k * 0.0035;
      try { q.applyKnockback({ x: d.x * str, z: d.z * str }, 0.01); } catch { }
      if (k % 10 === 0) { const bar = "§5" + "▮".repeat(Math.floor(k / 10)) + "§8" + "▮".repeat(10 - Math.floor(k / 10)); hudMsg(q, `§dZERO POINT ${bar}`, 14); }
    }
    if (k % 4 === 0) { vortex(dim, at(top, 0, 2.2, 0), 4 + k * 0.05); gravRain(dim, at(c, (Math.random() - 0.5) * 16, 6, (Math.random() - 0.5) * 16), 1.5); }
    if (k % 10 === 0) sound(dim, "origin.sfx.gravity", top, 0.4 + k * 0.008, 1);
    const hp = health(e);
    if (hp && start - hp.cur >= need) { broken = true; break; }
    await wait(1);
  }
  if (gone(b)) { s?.cut(); return; }
  if (broken) {
    s?.cut(); b.mods.delete(s);
    fx(dim, "origin:shards", at(top, 0, 2.2, 0), PURPLE, 1); fx(dim, "origin:flare", at(top, 0, 2.2, 0), PALE, 1);
    sound(dim, "origin.sfx.glass", top, 0.6, 1);
    titleAll(e, "§e§lFOCUS BROKEN", "§7he falls - hit him now", 48);
    tp(e, c);
    fx(dim, "origin:shockwave", at(c, 0, 0.1, 0), GOLD, 1, { radius: 3 });
    b.openUntil = now() + 90; b.busy = 90;
    anim(e, "stagger", 0.1);
    return;
  }
  // it goes off
  for (const q of players(e, 48)) { try { q.camera.fade({ fadeTime: { fadeInTime: 0.05, holdTime: 0.15, fadeOutTime: 0.8 }, fadeColor: { red: 0.85, green: 0.75, blue: 1 } }); } catch { } shake(q, 0.8, 0.8); }
  fx(dim, "origin:shockwave", at(c, 0, 0.2, 0), PURPLE, 1, { radius: 12 }); fx(dim, "origin:shockwave", at(c, 0, 1.2, 0), PALE, 1, { radius: 8 });
  sound(dim, "origin.sfx.crush", c, 0.5, 1); sound(dim, "random.explode", c, 0.5, 1);
  s?.cut(); b.mods.delete(s);
  for (const q of players(e, 40)) {
    const d = V.hdist(q.location, c), dir = V.flat(V.sub(q.location, c));
    if (d < 8) { if (hit(b, q, 16, dir, 0.2, 0.2)) heavyLaunch(q, dir, 2, e); } else if (d < 16) hit(b, q, 8, dir, 1.2, 0.5);
  }
  tp(e, c);
  anim(e, "press", 0.2);
}

// ---- Ultimate moves play as cutscenes: everyone nearby watches the move happen, then the fight resumes.
// Each one is announced first (its name, and where it will land, drawn on the ground) and only then do the cameras
// take over - so you get a moment to get out of it.
function watch(b, fn) { return Promise.all(players(b.e, 36).map((p) => runCine(p, (c) => fn(c, p), { skippable: false, kind: "boss" }))); }
function banner(b, name) { titleAll(b.e, " ", `§5§l${name}`, 36); sound(b.e.dimension, "origin.sfx.devil", b.e.location, 1.1, 0.5); sound(b.e.dimension, "origin.sfx.chime", b.e.location, 0.8, 1); }
async function foretell(b, ticks, draw) {
  for (let k = 0; k < ticks; k++) { if (gone(b)) return false; if (k % 4 === 0) draw(k); await wait(1); }
  return !gone(b);
}
async function thousandCuts(b, p) {
  const e = b.e, dim = e.dimension;
  banner(b, "THOUSAND CUTS");
  anim(e, "iai", 0.1);
  hudMsg(p, "§5He's coming for you. §7Get away - or brace.", 30);
  if (!await foretell(b, 16, (k) => { if (valid(p)) telegraph(dim, p.location, 5 - k * 0.2); })) return;
  if (!valid(p) || V.dist(p.location, e.location) > 12) { voice(b, "§7He lets the blade rest. §8(out of reach)"); return; }
  const show = watch(b, async (c) => {
    const f0 = V.flat(V.sub(p.location, e.location)), sd = { x: -f0.z, z: f0.x };
    c.cam(at(e.location, f0.x * 2.6 + sd.x * 1.4, 0.5, f0.z * 2.6 + sd.z * 1.4), chest(e));
    await c.wait(10);
    for (let k = 0; k < 15 && valid(p); k++) { const a = k * 0.42; c.cam(at(p.location, Math.cos(a) * 5, 2.2, Math.sin(a) * 5), at(p.location, 0, 1, 0), 0.1, EASE.Linear); await c.wait(2); }
    if (valid(e) && valid(p)) { const f = V.flat(V.sub(p.location, e.location)); c.cam(at(e.location, -f.x * 2.2 + f.z * 0.8, 1.9, -f.z * 2.2 - f.x * 0.8), at(p.location, 0, 1, 0), 0, EASE.Linear); }
    await c.wait(6);
    c.fade(0, 0.05, 0.35, { red: 1, green: 1, blue: 1 }); c.shake(0.5, 0.4);
    await c.wait(12);
  });
  await wait(10);
  let last = { ...e.location };
  for (let i = 0; i < 6; i++) {
    if (gone(b) || !valid(p)) break;
    const a = Math.random() * Math.PI * 2, spot = groundAt(dim, at(p.location, Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2));
    cutLine(dim, at(last, 0, 1.3, 0), at(spot, 0, 1.3, 0), { color: STEEL, glow: VIOLET, n: 6 });
    tp(e, spot, { facingLocation: p.getHeadLocation() });
    last = { ...e.location };
    anim(e, CUTS[i % 3].a, 0.04);
    slashArc(dim, at(p.location, 0, 1.1, 0), V.flat(V.sub(p.location, last)), { tilt: [90, 0, -40, 45, -60, 20][i], radius: 1.6, glow: VIOLET, sweep: 1 });
    sound(dim, "origin.sfx.sweep2", p.location, 1.2 + i * 0.05, 0.8);
    hit(b, p, 1.5, V.flat(V.sub(p.location, e.location)), 0.05, 0.02);
    await wait(5);
  }
  if (!gone(b) && valid(p)) {
    anim(e, "slash_1", 0.06);
    slashArc(dim, chest(e), V.flat(V.sub(p.location, e.location)), { tilt: 90, radius: 3, glow: VIOLET, len: 0.9, steps: 18 });
    sound(dim, "origin.sfx.critical", p.location, 0.7, 1);
    if (hit(b, p, 6, V.flat(V.sub(p.location, e.location)), 1.6, 0.6)) heavyLaunch(p, V.sub(p.location, e.location), 2, e);
  }
  await show;
}
async function collapse(b) {
  const e = b.e, dim = e.dimension;
  banner(b, "GRAVITY COLLAPSE");
  anim(e, "gravity", 0.15);
  sound(dim, "origin.sfx.gravity", e.location, 0.6, 1);
  for (const q of players(e, 20)) hudMsg(q, "§5The ground starts to tilt toward him. §7Get out of the circle!", 30);
  if (!await foretell(b, 18, (k) => { telegraph(dim, e.location, 28); vortex(dim, at(e.location, 0, 1.2, 0), 3 + k * 0.2); })) return;
  const show = watch(b, async (c) => {
    c.cam(at(e.location, 0.2, 13, 0.2), at(e.location, 0, 0, 0));
    await c.wait(20);
    const f = V.flat(e.getViewDirection());
    c.cam(at(e.location, f.x * 3 + f.z * 2, 1.0, f.z * 3 - f.x * 2), chest(e), 0, EASE.Linear);
    await c.wait(10);
    c.fade(0, 0.05, 0.4, { red: 0.5, green: 0.2, blue: 0.8 }); c.shake(0.6, 0.5);
    c.cam(at(e.location, f.x * 9, 4, f.z * 9), at(e.location, 0, 1, 0), 0.8, EASE.OutCubic);
    await c.wait(16);
  });
  for (let k = 0; k < 20; k++) {
    if (gone(b)) break;
    for (const q of players(e, 14)) { const d = V.flat(V.sub(e.location, q.location)); try { q.applyKnockback({ x: d.x * 0.5, z: d.z * 0.5 }, 0.05); } catch { } }
    if (k % 2 === 0) vortex(dim, at(e.location, 0, 1.2, 0), 7);
    await wait(1);
  }
  if (!gone(b)) {
    anim(e, "slash_2", 0.06);
    const f = V.flat(e.getViewDirection());
    await wait(4);
    slashArc(dim, chest(e), f, { tilt: 0, from: 0, to: 180, radius: 3.4, glow: VIOLET, steps: 18 });
    slashArc(dim, chest(e), { x: -f.x, y: 0, z: -f.z }, { tilt: 0, from: 0, to: 180, radius: 3.4, glow: VIOLET, steps: 18 });
    fx(dim, "origin:shockwave", at(e.location, 0, 0.1, 0), PURPLE, 1, { radius: 6 });
    sound(dim, "origin.sfx.crush", e.location, 0.8, 1);
    for (const q of players(e, 5.5)) hit(b, q, 9, V.flat(V.sub(q.location, e.location)), 1.6, 0.6);
  }
  await show;
}
// he leaps into the sky and splits the ground with one falling cut (the line it will fall on is drawn first)
async function sever(b, p) {
  const e = b.e, dim = e.dimension, start = { ...e.location };
  banner(b, "HEAVENLY SEVERANCE");
  anim(e, "iai", 0.1);
  const mark = { ...p.location }, f = V.flat(V.sub(mark, start)), sd = { x: -f.z, z: f.x };
  for (const q of players(e, 24)) hudMsg(q, "§5A line opens in the ground. §7Step off it!", 30);
  const strip = (k) => { for (let j = -6; j <= 12; j += 2) for (const s2 of [-2.2, 2.2]) fx(dim, "origin:dot", groundish(dim, at(mark, f.x * j + sd.x * s2, 0, f.z * j + sd.z * s2)), PURPLE, 1); };
  if (!await foretell(b, 16, strip)) return;
  const show = watch(b, async (c) => {
    c.cam(at(mark, 3.5, 0.4, 3.5), at(start, 0, 2, 0));
    await c.wait(8);
    c.cam(at(mark, 2.5, 0.6, 2.5), at(start, 0, 14, 0), 0.4, EASE.OutCubic);
    await c.wait(22);
    c.cam(at(mark, sd.x * 7, 2.4, sd.z * 7), at(mark, 0, 1, 0), 0, EASE.Linear);
    await c.wait(4);
    c.fade(0, 0.05, 0.4, { red: 1, green: 1, blue: 1 }); c.shake(0.8, 0.6);
    await c.wait(18);
  });
  await wait(8);
  if (gone(b)) { await show; return; }
  const sky = skyAt(dim, start, 13);
  cutLine(dim, at(start, 0, 1, 0), sky, { color: WHITE, glow: VIOLET, n: 12 });
  tp(e, sky);
  for (const q of players(e, 14)) { try { q.addEffect("levitation", 18, { amplifier: 1, showParticles: false }); } catch { } vortex(q.dimension, at(q.location, 0, 2, 0), 2); }
  for (let k = 0; k < 18; k++) { if (!gone(b)) tp(e, sky); if (k % 3 === 0) vortex(dim, sky, 3); await wait(1); }
  if (gone(b)) { await show; return; }
  tp(e, groundAt(dim, mark), { facingLocation: at(mark, f.x, 1.6, f.z) });
  anim(e, "slash_1", 0.05);
  cutLine(dim, sky, at(mark, 0, 1, 0), { color: WHITE, glow: VIOLET, n: 14 });
  slashArc(dim, at(mark, 0, 2, 0), f, { tilt: 90, radius: 4, glow: VIOLET, len: 1, steps: 20, sweep: 1 });
  sound(dim, "origin.sfx.critical", mark, 0.6, 1); sound(dim, "origin.sfx.stonecrash", mark, 0.7, 1);
  for (let k = -6; k <= 12; k++) system.runTimeout(() => { const pt = at(mark, f.x * k, 0.1, f.z * k); fx(dim, "origin:shockwave", pt, PURPLE, 1, { radius: 1.2 }); fx(dim, "origin:debris", pt, C.dust, 0.6); }, Math.abs(k));
  for (const q of players(e, 20)) {
    const d = V.sub(q.location, mark), along = d.x * f.x + d.z * f.z, side = d.x * f.z - d.z * f.x, off = Math.abs(side);
    if (along > -6.5 && along < 12.5 && off < 2.2) {
      const push = { x: -f.z * Math.sign(side || 1), y: 0, z: f.x * Math.sign(side || 1) };
      if (hit(b, q, 10, push, 1.3, 0.5)) heavyLaunch(q, push, 2, e);
    }
  }
  await show;
}

// ------------------------------------------------------------------ cutscenes
async function intro(b) {
  b.cine = true;
  const e = b.e, base = { ...e.location }, dim = e.dimension, top = skyAt(dim, base, 10);
  b.arena = { c: { ...base }, r: ARENA_R[0] };
  setForm(b, 0);
  try { e.setDynamicProperty("origin:intro", 1); e.setDynamicProperty("origin:arena", JSON.stringify(b.arena.c)); e.addEffect("slowness", 140, { amplifier: 255, showParticles: false }); } catch { }
  tp(e, top);
  sound(dim, "origin.sfx.gravity", base, 0.5, 1);
  const descent = (async () => {
    for (let i = 0; i <= 44; i++) { if (!valid(e)) return; tp(e, V.lerp(top, base, 1 - (1 - i / 44) ** 2)); if (i % 3 === 0) vortex(dim, at(e.location, 0, 1, 0), 3); await wait(1); }
    fx(dim, "origin:shockwave", at(base, 0, 0.1, 0), PURPLE, 1, { radius: 5 }); fx(dim, "origin:debris", base, C.dust, 1);
    sound(dim, "origin.sfx.stonecrash", base, 0.8, 1);
    ringFx(b, 1);
    await wait(6);
    anim(e, "iai", 0.2);
    await wait(11);
    if (!valid(e)) return;
    slashArc(dim, at(base, 0, 1.3, 0), V.flat(e.getViewDirection()), { tilt: 0, from: 10, to: 170, radius: 3, glow: ICE, len: 0.7 });
    sound(dim, "origin.sfx.sweep2", base, 0.7, 1);
  })();
  await Promise.all([descent, ...players(e, 48).map((p) => runCine(p, async (c) => {
    const f = V.flat(V.sub(p.location, base));
    c.cam(at(base, f.x * 10 + f.z * 3, 2.2, f.z * 10 - f.x * 3), at(base, 0, 7, 0));
    c.say("§8the air gets heavy...", 30);
    await c.wait(22);
    c.cam(at(base, f.x * 6, 2.6, f.z * 6), at(base, 0, 2.4, 0), 1.0, EASE.InOutSine);
    await c.wait(24);
    c.shake(0.4, 0.5);
    c.cam(at(base, f.x * 2.6 + f.z * 0.9, 1.7, f.z * 2.6 - f.x * 0.9), at(base, 0, 1.8, 0), 0.7, EASE.OutCubic);
    await c.wait(16);
    try { p.onScreenDisplay.setTitle("§5§lXoX", { fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 10, subtitle: "§7the weight of the blade" }); RT(p).titleUntil = now() + 60; } catch { }
    await c.wait(20);
    c.say("§7\"Steel remembers every hand that held it. §5Show me yours.§7\"", 40);
    await c.wait(18);
  }, { skippable: true, kind: "boss" }))]);
  try { e.removeEffect("slowness"); } catch { }
  for (const p of players(e, 48)) hudMsg(p, "§5The duel has begun. §7Leave the circle and gravity drags you back.", 80);
  b.cine = false; b.busy = 20;
}
// the arena's edge, drawn as a ring of light on the ground
function ringFx(b, alpha = 1) {
  const A = b.arena;
  if (!A) return;
  const dim = b.e.dimension;
  for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; fx(dim, "origin:dot", groundish(dim, { x: A.c.x + Math.cos(a) * A.r, y: A.c.y, z: A.c.z + Math.sin(a) * A.r }), PURPLE, alpha); }
}
function groundish(dim, p) { const g = groundAt(dim, p); return at(g, 0, 0.15, 0); }
// a form change: decided at once (so it can't trigger twice), shown when the animation gets there, and it always
// takes its full time even if nobody is close enough to watch
async function shift(b, to, showAt, minTicks, show) {
  b.cine = true; b.shifting = true; b.form = to;
  try { b.e.setDynamicProperty("origin:formlogic", to); } catch { }
  const e = b.e;
  system.runTimeout(() => { if (valid(e) && !b.dying) setForm(b, to); }, showAt);
  try { await Promise.all([wait(minTicks), ...players(e, 48).map((p) => runCine(p, (c) => show(c, p), { skippable: false, kind: "boss" }))]); } catch { }
  if (valid(e)) setForm(b, to);
  b.shifting = false; b.cine = false; b.busy = 10;
}
// Phase II: the mask goes on
async function goMask(b) {
  const e = b.e, base = { ...e.location }, dim = e.dimension;
  try { e.addEffect("slowness", 120, { amplifier: 255, showParticles: false }); } catch { }
  anim(e, "mask_on", 0.2);
  system.runTimeout(() => {
    if (!valid(e)) return;
    sound(dim, "origin.sfx.devil", base, 0.8, 1); sound(dim, "origin.sfx.gravity", base, 0.5, 1);
    for (let k = 0; k < 4; k++) system.runTimeout(() => vortex(dim, at(base, 0, 1, 0), 8), k * 3);
    fx(dim, "origin:shockwave", at(base, 0, 0.1, 0), PURPLE, 1, { radius: 8 });
  }, 22);
  await shift(b, 1, 22, 40, async (c, p) => {
    const f = V.flat(V.sub(p.location, base));
    c.cam(at(base, f.x * 2.2, 2.0, f.z * 2.2), at(base, 0, 2.0, 0));
    c.say("§5\"Then let me show you the weight I carry.\"", 24);
    await c.wait(22);
    c.fade(0, 0.1, 0.5, { red: 0.35, green: 0.1, blue: 0.55 });
    c.shake(0.6, 1);
    await c.wait(8);
    c.cam(at(base, -f.x * 4 - f.z * 2, 2.6, -f.z * 4 + f.x * 2), at(base, 0, 2.2, 0), 1.0, EASE.InOutSine);   // round to his back: the halo
    await c.wait(22);
    c.cam(at(base, f.x * 7 + f.z * 2, 3, f.z * 7 - f.x * 2), at(base, 0, 1.6, 0), 1.0, EASE.InOutSine);
    try { p.onScreenDisplay.setTitle("§5§lXoX · THE MASK", { fadeInDuration: 3, stayDuration: 50, fadeOutDuration: 12, subtitle: "§7the mask is on. §dThere is an Ultimate you could unlock, too." }); RT(p).titleUntil = now() + 70; } catch { }
    await c.wait(30);
  });
  try { e.removeEffect("slowness"); } catch { }
}
// Phase III: Event Horizon - a black sun opens in his halo, the arena closes in
async function goHorizon(b) {
  const e = b.e, base = { ...e.location }, dim = e.dimension;
  try { e.addEffect("slowness", 160, { amplifier: 255, showParticles: false }); } catch { }
  anim(e, "horizon", 0.2);
  system.runTimeout(() => {
    if (!valid(e)) return;
    sound(dim, "origin.sfx.devil", base, 0.6, 1); sound(dim, "origin.sfx.gravity", base, 0.35, 1); sound(dim, "origin.sfx.crush", base, 0.5, 1);
    fx(dim, "origin:shockwave", at(base, 0, 0.1, 0), PURPLE, 1, { radius: 12 }); fx(dim, "origin:pillar", base, PURPLE, 1);
    for (let k = 0; k < 6; k++) system.runTimeout(() => { vortex(dim, at(base, 0, 2, 0), 10); gravRain(dim, at(base, (Math.random() - 0.5) * 10, 8, (Math.random() - 0.5) * 10), 2); }, k * 3);
  }, 38);
  await shift(b, 2, 38, 64, async (c, p) => {
    const f = V.flat(V.sub(p.location, base));
    c.cam(at(base, f.x * 3.2, 0.6, f.z * 3.2), at(base, 0, 1.2, 0));
    c.say("§5\"Gravity bends for no one.\"", 30);
    await c.wait(26);
    c.cam(at(base, -f.x * 3.5, 1.4, -f.z * 3.5), at(base, 0, 3.2, 0), 0.6, EASE.OutCubic);   // behind him, looking up into the halo
    await c.wait(14);
    c.fade(0, 0.1, 0.6, { red: 0.12, green: 0.02, blue: 0.2 }); c.shake(0.7, 1.2);
    await c.wait(10);
    c.say("§5\"Not even for me.\"", 30);
    c.cam(at(base, f.x * 10 + f.z * 4, 5, f.z * 10 - f.x * 4), at(base, 0, 2, 0), 1.4, EASE.InOutSine);
    await c.wait(22);
    try { p.onScreenDisplay.setTitle("§5§lEVENT HORIZON", { fadeInDuration: 3, stayDuration: 50, fadeOutDuration: 12, subtitle: "§7the circle closes. §dhe is at his strongest." }); RT(p).titleUntil = now() + 70; } catch { }
    await c.wait(26);
  });
  try { e.removeEffect("slowness"); } catch { }
  if (b.arena) { b.arena.r = ARENA_R[2]; for (let k = 0; k < 4; k++) system.runTimeout(() => { if (valid(e) && b.arena) ringFx(b, 1); }, k * 6); }
}
// everyone who fought him gets their own katana and mask (whoever is online; a fight with no one left drops them)
function payOut(b, base, dim) {
  const LOOT = [["origin:xox_katana", 1], ["origin:ultimate_mask", 1], ["origin:blueprint_data", 2]];
  const winners = [...(b.contrib ?? [])].map((id) => world.getEntity(id)).filter((q) => valid(q));
  if (!winners.length) { for (const [id, n] of LOOT) { try { dim.spawnItem(new ItemStack(id, n), at(base, 0, 0.6, 0)); } catch { } } }
  for (const q of winners) for (const [id, n] of LOOT) {
    try { const left = q.getComponent("minecraft:inventory").container.addItem(new ItemStack(id, n)); if (left) q.dimension.spawnItem(left, q.location); } catch { }
  }
  for (const q of winners) msg(q, "§5XoX's katana and mask are yours. §7(Everyone who fought him gets their own.)");
}
function finish(b) {
  const e = b.e;
  b.allowDeath = true;
  try { e.kill(); } catch { }
  system.runTimeout(() => { try { if (valid(e)) e.remove(); } catch { } }, 2);
  bosses.delete(e.id);
}
async function defeat(b) {
  if (b.defeated) return;
  b.defeated = true; b.dying = true; b.cine = true;
  cleanup(b);
  const e = b.e, base = { ...e.location }, dim = e.dimension;
  try { e.setDynamicProperty("origin:defeated", 1); e.setDynamicProperty("origin:contrib", JSON.stringify([...b.contrib].slice(-24))); } catch { }
  try { e.addEffect("slowness", 260, { amplifier: 255, showParticles: false }); } catch { }
  try { e.playAnimation("animation.xox.fall", { controller: "xox_fall", stopExpression: "0", blendOutTime: 0.3 }); } catch { }   // holds the kneel
  const head = at(base, 0, 2.4, 0), back = (() => { const f = V.flat(e.getViewDirection()); return at(base, -f.x * 0.7, 1.9, -f.z * 0.7); })();
  system.runTimeout(() => {   // the mask cracks, the halo shatters
    if (!valid(e)) return;
    try { e.setProperty("origin:broken", 1); } catch { }
    sound(dim, "origin.sfx.glass", head, 0.8, 1); sound(dim, "origin.sfx.glass", back, 0.6, 1);
    fx(dim, "origin:shards", head, C.white, 1); fx(dim, "origin:shards", back, PURPLE, 1); fx(dim, "origin:shards", back, PALE, 1);
    fx(dim, "origin:flare", back, PURPLE, 1);
    if (b.form >= 2) for (let k = 0; k < 6; k++) fx(dim, "origin:debris", at(base, Math.cos(k) * 3, 1.5, Math.sin(k) * 3), C.dust, 0.8);
  }, 21);
  try {
    await Promise.all([wait(60), ...players(e, 48).map((p) => runCine(p, async (c) => {
      const f = V.flat(V.sub(p.location, base)), sd = { x: -f.z, z: f.x };
      c.cam(at(base, f.x * 3 + sd.x * 1.5, 0.7, f.z * 3 + sd.z * 1.5), at(base, 0, 1.2, 0));
      c.say("§7\"...so this is the weight of losing.\"", 40);
      await c.wait(22);
      c.shake(0.3, 0.3);
      await c.wait(14);
      c.cam(at(base, f.x * 2.2 + sd.x * 0.6, 0.4, f.z * 2.2 + sd.z * 0.6), at(base, f.x * 0.6, 0.1, f.z * 0.6), 0.8, EASE.InOutSine);   // the mask in the dirt
      await c.wait(24);
      c.say("§7\"The blade is yours now.\"", 40);
      c.cam(at(base, f.x * 6, 2.6, f.z * 6), at(base, 0, 1.2, 0), 1.6, EASE.InOutSine);
      await c.wait(30);
      c.say("§7\"Carry its weight.\"", 40);
      for (let k = 0; k < 8; k++) system.runTimeout(() => { fx(dim, "origin:dust_away", at(base, (Math.random() - 0.5), 0.4 + k * 0.35, (Math.random() - 0.5)), PURPLE, 1); fx(dim, "origin:rise", base, PURPLE, 0.8); }, k * 3);
      c.cam(at(base, f.x * 7, 6, f.z * 7), at(base, 0, 3, 0), 1.4, EASE.InOutSine);
      await c.wait(26);
      c.fade(0.4, 0.3, 0.8, { red: 0.9, green: 0.85, blue: 1 });
      await c.wait(12);
    }, { skippable: true, kind: "boss" }))]);
  } catch { }
  for (let k = 0; k < 6; k++) fx(dim, "origin:dust_away", at(base, 0, 0.4 + k * 0.3, 0), PURPLE, 1);
  fx(dim, "origin:pillar", base, PALE, 1);
  sound(dim, "origin.sfx.chime", base, 0.7, 1);
  payOut(b, base, dim);
  if (valid(e)) titleAll(e, "§5§lXoX §r§7has fallen", "§dhis mask is yours: an Ultimate of your own", 64);
  finish(b);
}

// ------------------------------------------------------------------ hooks
export function onXoxHurtBefore(ev) {
  const e = ev.hurtEntity;
  if (e?.typeId !== XOX) return false;
  const b = B(e);
  if (b.dying) { if (!b.allowDeath) ev.cancel = true; return true; }
  if (b.cine) { ev.cancel = true; return true; }
  const by = ev.damageSource?.damagingEntity;
  if (by?.typeId === "minecraft:player") {
    if (!b.contrib.has(by.id)) { b.contrib.add(by.id); const ids = JSON.stringify([...b.contrib].slice(-24)); system.run(() => { try { if (valid(e)) e.setDynamicProperty("origin:contrib", ids); } catch { } }); }
    b.threat[by.id] = (b.threat[by.id] ?? 0) + ev.damage;
  }
  const crowd = players(e, 48).length;
  if (crowd > 1) ev.damage = ev.damage / (1 + 0.6 * (crowd - 1));   // more fighters, tougher samurai
  const hp = health(e);
  if (!hp) return false;
  // each phase has to be fought: one huge hit can't skip past the next form
  const floor = b.form === 0 ? 0.58 : b.form === 1 ? 0.24 : !b.zero ? 0.09 : 0;
  if (floor && hp.cur - ev.damage < hp.max * floor) ev.damage = Math.max(0, hp.cur - hp.max * floor);
  if (ev.damage >= hp.cur) { ev.cancel = true; if (!b.dying) { b.dying = true; system.run(() => defeat(b)); } return true; }
  if (open(b)) return false;
  if (by?.typeId !== "minecraft:player" || (b.cd.block ?? 0) > now() || !inFront(e, by, 80) || b.zeroing) {
    if (b.busy <= 0 && Math.random() < 0.3) system.run(() => valid(e) && anim(e, "hurt", 0.08));
    return false;
  }
  if (Math.random() > (b.busy > 0 ? 0.12 : [0.26, 0.42, 0.5][b.form])) return false;
  ev.cancel = true;
  system.run(() => block(b, by, false));
  return true;
}
function block(b, by, beam) {
  const e = b.e;
  if (!valid(e)) return;
  b.cd.block = now() + 8;
  anim(e, "block", 0.08);
  const f = V.flat(e.getViewDirection()), c = at(chest(e), f.x * 0.8, 0.3, f.z * 0.8);
  cutLine(e.dimension, at(c, -0.6, 0.5, 0), at(c, 0.6, -0.5, 0), { color: WHITE, glow: beam ? { red: 0.33, green: 0.95, blue: 1 } : glowOf(b), n: 4 });
  cutLine(e.dimension, at(c, 0.6, 0.5, 0), at(c, -0.6, -0.5, 0), { color: WHITE, glow: beam ? { red: 0.33, green: 0.95, blue: 1 } : glowOf(b), n: 4 });
  for (let k = 0; k < 6; k++) fx(e.dimension, "origin:spark", c, beam ? hexToRgb("#55f2ff") : C.white, 1);
  sound(e.dimension, "origin.sfx.guard2", e.location, 1, 1);
  sound(e.dimension, "origin.sfx.parry", e.location, 1.1, 0.8);
  if (valid(by)) hudMsg(by, beam ? "§5XoX cuts your beam in half." : "§5XoX blocks. §7Parry his swing to open him up.", 30);
  if (valid(by) && V.dist(by.location, e.location) < 4.5 && !b.acting) system.runTimeout(() => { if (valid(e) && !b.dying && !b.cine && alive(by) && !open(b)) { anim(e, "slash_2", 0.06); slashArc(e.dimension, chest(e), V.flat(V.sub(by.location, e.location)), { tilt: 0, radius: 2.3, glow: glowOf(b) }); hit(b, by, 5, V.flat(V.sub(by.location, e.location)), 0.8, 0.3); } }, 6);
}
// a player parried one of his swings: he staggers open (a parried Gravity Well cut leaves him open for longer)
export function xoxParried(e, by) {
  const b = B(e);
  if (b.cine || b.dying) return;
  const perfect = now() - (b.wellAt ?? -99) <= 3;
  b.openUntil = now() + (perfect ? 64 : 34);
  b.busy = Math.max(b.busy, perfect ? 64 : 34);
  anim(e, "stagger", 0.1);
  fx(e.dimension, "origin:flare", at(e.location, 0, 1.8, 0), GOLD, 1);
  sound(e.dimension, "origin.sfx.glass", e.location, 1.2, 0.8);
  if (perfect) { fx(e.dimension, "origin:shards", at(e.location, 0, 1.5, 0), PURPLE, 1); fx(e.dimension, "origin:shockwave", at(e.location, 0, 0.1, 0), GOLD, 1, { radius: 3 }); for (const m of b.mods) { try { m.cut(); } catch { } } b.mods.clear(); }
  if (valid(by)) { hudMsg(by, perfect ? "§e§lPERFECT PARRY §r§7- the well collapses. Hit him!" : "§e§lOPENING §r§7- hit him now", 40); shake(by, perfect ? 0.4 : 0.25, 0.3); }
}
export function xoxBlockBeam(e, by) {
  const b = B(e);
  if (b.cine || b.dying || open(b) || !inFront(e, by, 85)) return false;
  if (Math.random() > (b.busy > 0 ? 0.3 : b.form >= 1 ? 0.85 : 0.65)) return false;
  block(b, by, true);
  return true;
}
export function xoxDeflect(e) {
  const b = B(e);
  if (b.cine || b.dying || open(b) || Math.random() > (b.form >= 1 ? 0.95 : 0.8)) return false;
  anim(e, "slash_3", 0.05);
  slashArc(e.dimension, chest(e), e.getViewDirection(), { tilt: -40, from: 165, to: 20, radius: 2.2, glow: glowOf(b), sweep: 1 });
  sound(e.dimension, "origin.sfx.guard2", e.location, 1.3, 0.8);
  return true;
}
// a fighter who dies is out of the duel (no dragging them back from their respawn)
export function onXoxPlayerDeath(p) { for (const b of bosses.values()) b.fighters.delete(p.id); }

// ------------------------------------------------------------------ the arena
// Only fighters are held: anyone who has stood inside the circle during this fight. Bystanders who never stepped in,
// the dead, and anyone gone for half a minute are left alone.
function tickArena(b, t) {
  const A = b.arena;
  if (!A) return;
  const dim = b.e.dimension;
  if (t % 20 === 0 && V.hdist(b.e.location, A.c) > A.r + 3 && !b.acting) {   // he never strays from his own duel either
    const back = V.flat(V.sub(A.c, b.e.location)), to = groundAt(dim, at(A.c, -back.x * (A.r - 4), 0, -back.z * (A.r - 4)));
    cutLine(dim, chest(b.e), at(to, 0, 1.3, 0), { color: STEEL, glow: glowOf(b), n: 8 });
    tp(b.e, to);
    sound(dim, "origin.sfx.swoosh", to, 1.2, 0.6);
  }
  for (const [id, seen] of b.fighters) if (t - seen > 600) b.fighters.delete(id);
  for (const q of players(b.e, 64)) {
    const d = V.hdist(q.location, A.c);
    if (d > A.r + 14) continue;   // far away: not in this fight
    if (d <= A.r) { b.fighters.set(q.id, t); continue; }
    if (!b.fighters.has(q.id)) continue;   // never came in: not held
    if (t % 10 === 0) {   // the wall shows itself
      const a0 = Math.atan2(q.location.z - A.c.z, q.location.x - A.c.x);
      for (let k = -5; k <= 5; k++) { const a = a0 + k * 0.07; const pt = { x: A.c.x + Math.cos(a) * A.r, y: q.location.y, z: A.c.z + Math.sin(a) * A.r }; fx(dim, "origin:dot", at(pt, 0, 0.2, 0), PURPLE, 1); fx(dim, "origin:dot", at(pt, 0, 1.3, 0), PURPLE, 0.6); }
    }
    const back = V.flat(V.sub(A.c, q.location)), s = Math.min(1.6, 0.5 + (d - A.r) * 0.12);
    try { q.applyKnockback({ x: back.x * s, z: back.z * s }, 0.12); } catch { }
    vortex(dim, at(q.location, 0, 1, 0), 1.2);
    const r = RT(q);
    if ((r.xoxWallMsg ?? 0) < t) { r.xoxWallMsg = t + 60; hudMsg(q, "§5There's no leaving this duel. §7(Gravity drags you back.)", 40); sound(dim, "origin.sfx.gravity", q.location, 1.4, 0.5); }
  }
}

// ------------------------------------------------------------------ the brain (every 2 ticks)
const ready = (b, k) => (b.cd[k] ?? 0) <= now();
const setcd = (b, k, t) => { b.cd[k] = now() + Math.round(t * (QUICK[b.form] ?? 1)); };
async function act(b, fn, rest) {
  b.acting = true; b.busy = 9999;
  try { await fn(); } catch (err) { console.warn("[ORIGIN] xox: " + err); }
  finally { b.acting = false; }
  b.busy = open(b) ? Math.max(2, (b.openUntil ?? 0) - now()) : Math.round(rest * (QUICK[b.form] ?? 1));
}
// a reload: pick the fight up where it was (form, arena, who fought him, zero point) - or finish a defeat in progress
function restore(b) {
  const e = b.e;
  let logic;
  try { logic = e.getDynamicProperty("origin:formlogic"); } catch { }
  try { setForm(b, Number(logic ?? e.getProperty("origin:form") ?? 0)); } catch { }
  try { const c = JSON.parse(e.getDynamicProperty("origin:arena") ?? "null"); b.arena = { c: c ?? { ...e.location }, r: ARENA_R[b.form] }; } catch { b.arena = { c: { ...e.location }, r: ARENA_R[b.form] }; }
  try { for (const id of JSON.parse(e.getDynamicProperty("origin:contrib") ?? "[]")) b.contrib.add(id); } catch { }
  try { b.zero = !!e.getDynamicProperty("origin:zero"); } catch { }
  let done = 0;
  try { done = e.getDynamicProperty("origin:defeated") ?? 0; } catch { }
  if (done) { b.defeated = b.dying = b.cine = true; payOut(b, { ...e.location }, e.dimension); finish(b); return false; }
  return true;
}
export function tickXoX() {
  const t = now();
  for (const p of world.getAllPlayers()) { try { for (const e of p.dimension.getEntities({ type: XOX, location: p.location, maxDistance: 64 })) B(e); } catch { } }
  for (const [id, b] of bosses) {
    const e = b.e;
    if (!valid(e)) { cleanup(b); bosses.delete(id); continue; }
    if (b.cine || b.dying) continue;
    if (!b.introChecked) {
      b.introChecked = true;
      let seen = 0;
      try { seen = e.getDynamicProperty("origin:intro") ?? 0; } catch { }
      if (!seen) { intro(b); continue; }
      if (!restore(b)) continue;
    }
    tickArena(b, t);
    // passive gravity: the mask slows you and drags flyers down; Event Horizon pulls everyone toward him
    if (b.form >= 1 && t % 20 === 0) for (const q of players(e, b.form >= 2 ? 22 : 16)) {
      try { q.addEffect("slowness", 30, { amplifier: 1, showParticles: false }); if (!q.isOnGround) q.applyKnockback({ x: 0, z: 0 }, b.form >= 2 ? -1 : -0.7); } catch { }
      if (b.form >= 2 && q.isOnGround) { const d = V.flat(V.sub(e.location, q.location)); try { q.applyKnockback({ x: d.x * 0.35, z: d.z * 0.35 }, 0.02); } catch { } }
      if (t % 60 === 0) gravRain(q.dimension, at(q.location, 0, 3.5, 0), 1.2);
    }
    if (b.acting) continue;   // one move at a time; form changes wait for the move to finish
    const hp = health(e);
    if (hp && b.form === 0 && hp.cur <= hp.max * 0.6) { goMask(b); continue; }
    if (hp && b.form === 1 && hp.cur <= hp.max * 0.25) { goHorizon(b); continue; }
    if (hp && b.form === 2 && !b.zero && hp.cur <= hp.max * 0.1) {   // even with nobody close: the last floor always lifts
      b.zero = true; b.zeroing = true;
      try { e.setDynamicProperty("origin:zero", 1); } catch { }
      act(b, async () => { try { await zeroPoint(b); } finally { b.zeroing = false; } }, 30);
      continue;
    }
    if (b.busy > 0) { b.busy -= 2; continue; }
    const ps = players(e, 48).sort((a, c) => V.dist(a.location, e.location) - V.dist(c.location, e.location));
    if (!ps.length) continue;
    for (const k in b.threat) b.threat[k] *= 0.985;
    const p = ps.filter((q) => V.dist(q.location, e.location) < 24).sort((a, c) => ((b.threat[c.id] ?? 0) - V.dist(c.location, e.location) * 2) - ((b.threat[a.id] ?? 0) - V.dist(a.location, e.location) * 2))[0] ?? ps[0], d = V.dist(p.location, e.location);
    const air = ps.find((q) => isFlying(q) || (!q.isOnGround && q.location.y - e.location.y > 4));
    const F = b.form, cineOk = ready(b, "cine");
    if (air && ready(b, "air")) { setcd(b, "air", 180); act(b, () => antiAir(b, air), 16); continue; }
    if (d < 4.6 && ready(b, "combo")) { setcd(b, "combo", 46); act(b, () => combo(b, p), 18); continue; }
    if (F >= 2 && d < 24 && ready(b, "meteor")) { setcd(b, "meteor", 260); act(b, () => meteors(b), 20); continue; }
    if (F >= 1 && d < 14 && ready(b, "well")) { setcd(b, "well", 300); act(b, () => gravityWell(b, p), 18); continue; }
    if (F >= 1 && d < 16 && ready(b, "phantom")) { setcd(b, "phantom", 240); act(b, () => phantoms(b, p), 16); continue; }
    if (F >= 1 && d < 20 && ready(b, "storm")) { setcd(b, "storm", 280); act(b, () => storm(b), 18); continue; }
    if (F >= 1 && cineOk && d < 12 && ready(b, "cuts")) { setcd(b, "cuts", 320); setcd(b, "cine", 460); act(b, () => thousandCuts(b, p), 20); continue; }
    if (F >= 1 && cineOk && d < 14 && ready(b, "collapse")) { setcd(b, "collapse", 360); setcd(b, "cine", 460); act(b, () => collapse(b), 22); continue; }
    if (F >= 1 && cineOk && d < 18 && ready(b, "sever")) { setcd(b, "sever", 420); setcd(b, "cine", 460); act(b, () => sever(b, p), 24); continue; }
    if (d < 12 && ready(b, "iai")) { setcd(b, "iai", 150); act(b, () => iai(b, p), 18); continue; }
    if (d >= 5 && d < 15 && ready(b, "dash")) { setcd(b, "dash", 90); act(b, () => dashCut(b, p), 16); continue; }
    if (d >= 6 && ready(b, "wave")) { setcd(b, "wave", 70); act(b, () => waves(b, p), 14); continue; }
    if (d < 12 && ready(b, "press")) { setcd(b, "press", 170); act(b, () => press(b), 14); continue; }
  }
}

// ------------------------------------------------------------------ summoning + your own Ultimate
// he lands in front of you, on open ground at your level (in a cave too), never inside a wall
export function summonXoX(p, dist = 9) {
  const f = V.flat(p.getViewDirection()), dim = p.dimension;
  let loc = { ...p.location };
  for (const d of [dist, 7, 5, 3]) {
    const g = groundAt(dim, at(p.location, f.x * d, 0, f.z * d));
    if (standable(dim, g) && Math.abs(g.y - p.location.y) < 8) { loc = g; break; }
  }
  try { return dim.spawnEntity(XOX, loc); } catch { return null; }
}
export function useSeal(p) {
  try { const c = p.getComponent("minecraft:inventory").container, it = c.getItem(p.selectedSlotIndex); if (it?.typeId === "origin:gravity_seal") { if (it.amount > 1) { it.amount--; c.setItem(p.selectedSlotIndex, it); } else c.setItem(p.selectedSlotIndex, undefined); } } catch { }
  sound(p.dimension, "origin.sfx.gravity", p.location, 0.6, 1);
  vortex(p.dimension, at(p.location, 0, 2, 0), 5);
  msg(p, "§5The seal cracks. Something heavy is coming.");
  system.runTimeout(() => valid(p) && summonXoX(p), 40);
}
export async function useMask(p) {
  const h = hero(p), r = RT(p);
  if (!h.ultUnlocked) {
    h.ultUnlocked = true; saveNow(p);
    await runCine(p, async (c) => {
      const b0 = { ...p.location }, f = V.flat(p.getViewDirection());
      c.cam(at(b0, f.x * 1.8, 1.7, f.z * 1.8), at(b0, 0, 1.65, 0));
      c.say("§7you put on the mask...", 30);
      await c.wait(30);
      c.fade(0, 0.2, 0.8, { red: 0.4, green: 0.1, blue: 0.6 });
      sound(p.dimension, "origin.sfx.gravity", b0, 0.7, 1);
      vortex(p.dimension, at(b0, 0, 1, 0), 5);
      await c.wait(20);
    });
    try { p.onScreenDisplay.setTitle("§d§lULTIMATE UNLOCKED", { fadeInDuration: 4, stayDuration: 50, fadeOutDuration: 12, subtitle: "§7use the mask to enter it: 30s · recharges in 10 minutes" }); r.titleUntil = now() + 70; } catch { }
    return;
  }
  const left = (h.ultReadyAt ?? 0) - Date.now();
  if (left > 0) { hudMsg(p, `§7Your Ultimate recharges in §d${Math.ceil(left / 60000)} min`, 40); return; }
  h.ultReadyAt = Date.now() + 10 * 60 * 1000; saveNow(p);
  r.ultUntil = now() + 600;
  try { p.playAnimation("animation.origin.ult.flare", { controller: "origin_ult", stopExpression: "0", blendOutTime: 0.3 }); } catch { }
  vortex(p.dimension, at(p.location, 0, 1, 0), 6);
  fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), GOLD, 1, { radius: 6 });
  sound(p.dimension, "origin.sfx.devil", p.location, 1.2, 0.6);
  sound(p.dimension, "origin.sfx.gravity", p.location, 0.8, 1);
  try { p.runCommand("camerashake add @s 0.5 0.6 positional"); p.onScreenDisplay.setTitle("§d§lULTIMATE", { fadeInDuration: 2, stayDuration: 30, fadeOutDuration: 10, subtitle: "§730 seconds" }); r.titleUntil = now() + 44; } catch { }
}
export function tickUlt() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const r = RT(p);
    if (!r.ultUntil) continue;
    if (r.ultUntil < t) { r.ultUntil = 0; hudMsg(p, "§7Your Ultimate fades.", 40); continue; }
    try { for (const [id, a] of [["strength", 1], ["speed", 1], ["resistance", 0], ["regeneration", 0], ["jump_boost", 1]]) p.addEffect(id, 30, { amplifier: a, showParticles: false }); } catch { }
    r.powerCd = Math.min(r.powerCd ?? 0, t + 10);
    r.flyGrace = t + 40;
    if (t % 20 === 0) vortex(p.dimension, at(p.location, 0, 1, 0), 1.4);
  }
}
