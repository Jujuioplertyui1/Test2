// ORIGIN v0.21 - beams.js
// Sustained beams. A beam is a solid ribbon of light - a white-hot core inside a coloured glow, wrapped in a flickering
// energy sheath, with pulses racing down it - plus a flare where it leaves you and a burning impact where it lands
// (sparks, smoke, scorch marks on whatever it hits, and real light). Beams are held for seconds, not frames:
//   Laser Eyes 7s · Mind Beam 5s · Power Blast 3s · Infinity Beam 6s · Core Lance 5s. Use the power again to cut it.
// Every target in the line takes a hit every few ticks. One beam per player at a time, all state per player.
import { world, system, BlockPermutation, EntityDamageCause } from "@minecraft/server";
import { RT } from "./data.js";
import { V, at, valid, fx, sound, now, FX_IDS } from "./util.js";
import { hudMsg } from "./voice.js";
import { destructionOn, crater } from "./impact.js";
import { XOX, xoxBlockBeam } from "./xox.js";
import { placeTemp, touchTemp, releaseTemp, isTempBlock } from "./tempblocks.js";

const SKIP = new Set([...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "origin:float_text", "origin:exo_piece", "origin:exo_drone", "origin:archetype_orb", "origin:manifestation",
  "origin:lumen_construct", "origin:carry_tree", "origin:carry_boulder", "origin:regen_body", "origin:afterimage", "origin:severed_limb", "origin:prosthetic",
  "origin:ice_shell", "origin:ice_formation", "origin:blood_spike", "origin:tk_rock"]);
const rgb = (r, g, b) => ({ red: r, green: g, blue: b });
const WHITE = rgb(1, 1, 1);
// width = glow half-width, coreW = core half-width, flare = source flare size, impact = impact flare size
export const STYLES = {
  laser: { core: rgb(1, 0.92, 0.9), glow: rgb(1, 0.09, 0.06), sheath: rgb(1, 0.4, 0.2), width: 0.15, coreW: 0.045, flare: 0.32, impact: 0.9, glowA: 0.7, burn: "laser" },
  mind: { core: rgb(1, 1, 0.88), glow: rgb(1, 0.78, 0.18), sheath: rgb(1, 0.95, 0.55), width: 0.3, coreW: 0.08, flare: 0.55, impact: 1.3, glowA: 0.6, burn: "none" },
  power: { core: rgb(1, 0.9, 1), glow: rgb(0.62, 0.16, 1), sheath: rgb(0.88, 0.5, 1), width: 0.46, coreW: 0.13, flare: 0.8, impact: 1.9, glowA: 0.65, burn: "laser" },
  rainbow: { core: WHITE, glow: rgb(1, 1, 1), sheath: rgb(1, 0.95, 0.85), width: 0.62, coreW: 0.17, flare: 1.0, impact: 2.6, glowA: 0.55, burn: "laser", helix: true },
  tracer: { core: rgb(1, 0.95, 0.7), glow: rgb(1, 0.75, 0.25), width: 0.05, coreW: 0.018, flare: 0.25, impact: 0.3, glowA: 0.6 },
};
export function tinted(base, glow) { return { ...STYLES[base], glow, sheath: { red: Math.min(1, glow.red * 0.5 + 0.5), green: Math.min(1, glow.green * 0.5 + 0.5), blue: Math.min(1, glow.blue * 0.5 + 0.5) } }; }

// ------------------------------------------------------------------ drawing
function perps(u) {
  const a = Math.abs(u.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const p1 = V.norm({ x: u.y * a.z - u.z * a.y, y: u.z * a.x - u.x * a.z, z: u.x * a.y - u.y * a.x });
  const p2 = { x: u.y * p1.z - u.z * p1.y, y: u.z * p1.x - u.x * p1.z, z: u.x * p1.y - u.y * p1.x };
  return [p1, p2];
}
// one frame of a beam from a to b. life > 0.2 makes a lingering flash (repulsors, tracers, one-shot blasts)
export function drawBeam(dim, a, b, style, t = now(), o = {}) {
  const d = V.sub(b, a), L = V.len(d);
  if (L < 0.05) return;
  const u = V.mul(d, 1 / L), life = o.life ?? 0.12, segMax = o.seg ?? 6;
  const n = Math.min(14, Math.max(1, Math.ceil(L / segMax))), sl = L / n, half = (sl / 2) * 1.06;
  const base = { dx: u.x, dy: u.y, dz: u.z, len: half, spd: 0.04, life };
  for (let i = 0; i < n; i++) {
    const c = V.add(a, V.mul(u, sl * (i + 0.5)));
    fx(dim, "origin:beam_glow", c, style.glow, style.glowA ?? 0.6, { ...base, w: style.width });
    fx(dim, "origin:beam_core", c, style.core, 1, { ...base, w: style.coreW });
    if (style.sheath && (t + i) % 2 === 0) {
      const j = (Math.random() - 0.5) * style.width * 0.5;
      fx(dim, "origin:beam_sheath", at(c, j, (Math.random() - 0.5) * style.width * 0.5, -j), style.sheath, 0.55, { ...base, w: style.width * 1.45, life: life * 0.75 });
    }
  }
  if (style.helix && o.cols?.length) {   // a rainbow twisting around the core
    const [p1, p2] = perps(u), K = o.cols.length, r0 = style.width * 0.55;
    for (let k = 0; k < K; k++) {
      if ((k + t) % 2) continue;
      const ang = t * 0.35 + (k * Math.PI * 2) / K, off = V.add(V.mul(p1, Math.cos(ang) * r0), V.mul(p2, Math.sin(ang) * r0));
      const a2 = V.add(a, V.mul(off, 0.5)), b2 = V.add(b, off), d2 = V.sub(b2, a2), L2 = V.len(d2), u2 = V.mul(d2, 1 / (L2 || 1));
      const n2 = Math.min(10, Math.max(1, Math.ceil(L2 / 7))), s2 = L2 / n2;
      for (let i = 0; i < n2; i++) fx(dim, "origin:beam_glow", V.add(a2, V.mul(u2, s2 * (i + 0.5))), o.cols[k], 0.75, { dx: u2.x, dy: u2.y, dz: u2.z, len: (s2 / 2) * 1.06, spd: 0.04, life: life * 1.6, w: style.width * 0.42 });
    }
  }
}
export function flashBeam(dim, a, b, style, o = {}) {
  drawBeam(dim, a, b, style, now(), { life: o.life ?? 0.32, seg: 8, cols: o.cols });
  fx(dim, "origin:beam_flare", a, style.glow, 0.9, { size: style.flare, life: 0.12 });
  fx(dim, "origin:beam_flare", b, style.glow, 0.9, { size: style.impact * 0.8, life: 0.18 });
  fx(dim, "origin:beam_flare", b, style.core, 1, { size: style.impact * 0.35, life: 0.14 });
}
function scorch(dim, pt, face) {
  const f = String(face ?? "Up");
  const mode = /Up|Down/.test(f) ? "xz" : /North|South/.test(f) ? "xy" : "yz";
  const n = { Up: [0, 0.02, 0], Down: [0, -0.02, 0], North: [0, 0, -0.02], South: [0, 0, 0.02], East: [0.02, 0, 0], West: [-0.02, 0, 0] }[f] ?? [0, 0.02, 0];
  fx(dim, `origin:scorch_${mode}`, { x: pt.x + n[0], y: pt.y + n[1], z: pt.z + n[2] }, WHITE, 1, { size: 0.35 + Math.random() * 0.25, life: 16 });
}
// ------------------------------------------------------------------ light where the beam lands
let LIGHT;
function lightPerm() {
  if (LIGHT !== undefined) return LIGHT;
  LIGHT = null;
  for (const [id, st] of [["minecraft:light_block_15", undefined], ["minecraft:light_block", { block_light_level: 15 }]]) { try { LIGHT = BlockPermutation.resolve(id, st); if (LIGHT) break; } catch { } }
  return LIGHT;
}
// placed through tempblocks.js: saved in the world, so quitting mid-beam can't leave an invisible light behind
function clearLight(b) {
  const L = b.light;
  b.light = null;
  if (L) releaseTemp(L.dim, L.at);
}
function moveLight(b, dim, spot) {
  const k = { x: Math.floor(spot.x), y: Math.floor(spot.y), z: Math.floor(spot.z) };
  if (b.light && b.light.dim.id === dim.id && b.light.at.x === k.x && b.light.at.y === k.y && b.light.at.z === k.z) { touchTemp(dim, k, 60); return; }
  clearLight(b);
  if (placeTemp(dim, k, lightPerm(), 60)) b.light = { dim, at: k };
}
function burnBlock(dim, blk, kind) {
  if (!blk || blk.isAir || kind === "none" || !destructionOn() || isTempBlock(dim, blk.location)) return;
  try {
    const id = blk.typeId;
    const airy = (u) => !!u && (u.isAir || u.typeId.startsWith("minecraft:light_block"));   // the beam's own light sits right there
    if (kind === "cut") { if (/(_log|_wood|_stem|leaves|_planks|glass|_pane|bamboo|_wool$|fence|_door$|_slab$|_stairs$)/.test(id)) { blk.setType("minecraft:air"); return; } }
    const up = () => dim.getBlock(V.add(blk.location, { x: 0, y: 1, z: 0 }));
    if (kind === "fire") {   // flame: melts ice and snow, sets the ground alight
      if (/snow_layer/.test(id)) { blk.setType("minecraft:air"); return; }
      if (/:ice$|packed_ice|:snow$|powder_snow/.test(id)) { blk.setType("minecraft:water"); return; }
      const u = up(); if (u && (airy(u) || /short_grass|tall_grass|:fern$|large_fern|dead_bush|:snow_layer/.test(u.typeId)) && Math.random() < 0.4) u.setType("minecraft:fire");
      return;
    }
    if (kind === "freeze") {   // frost: water freezes, lava hardens, fire goes out, snow settles
      if (/^minecraft:(flowing_)?water$/.test(id)) blk.setType("minecraft:ice");
      else if (/^minecraft:(flowing_)?lava$/.test(id)) blk.setType("minecraft:obsidian");
      else if (/:fire$|soul_fire/.test(id)) blk.setType("minecraft:air");
      else { const u = up(); if (airy(u) && Math.random() < 0.3) u.setType("minecraft:snow_layer"); else if (u && /:fire$/.test(u.typeId)) u.setType("minecraft:air"); }
      return;
    }
    if (/:sand$|red_sand$/.test(id)) blk.setType("minecraft:glass");
    else if (/leaves|short_grass|tall_grass|fern|snow_layer|vine|_carpet$/.test(id)) blk.setType("minecraft:air");
    else if (/(_log|_planks|_wool$|:wool$|hay_block|bookshelf|_wood$)/.test(id)) { const u = up(); if (airy(u)) u.setType("minecraft:fire"); }
    else if (/:ice$|packed_ice|:snow$|powder_snow/.test(id)) blk.setType("minecraft:water");
    else if (/:obsidian$|crying_obsidian|:stone$|cobblestone$|netherrack/.test(id) && kind === "melt" && Math.random() < 0.2) blk.setType("minecraft:magma");
  } catch { }
}

// ------------------------------------------------------------------ live beams
const live = new Map();   // owner id -> beam
const defHurt = (e, n, by) => { try { e.applyDamage(n, { cause: EntityDamageCause.entityAttack, damagingEntity: by }); } catch { } };
export const beamActive = (p, key) => { const b = live.get(p?.id); return !!b && (!key || b.key === key); };
export const beamedRecently = (e) => (RT(e).beamHitUntil ?? -99) > now();
function markBeamed(e, o, t, span) {   // only players read it (Regeneration's beam wounds) - mobs don't need the state
  if (e.typeId !== "minecraft:player") return;
  try { const rt = RT(e); rt.beamHitUntil = t + span; rt.beamFrom = { ...o.location }; } catch { }
}
export function startBeam(owner, key, cfg) {
  stopBeam(owner, "replaced");
  const t = now();
  const b = { owner, key, cfg, start: t, until: t + (cfg.dur ?? 60), dir: owner.getViewDirection(), hits: new Map(), dimId: owner.dimension.id, light: null, lastBlock: null, end: null };
  live.set(owner.id, b);
  const [s, sp = 1, sv = 1] = cfg.sfx?.start ?? [];
  if (s) sound(owner.dimension, s, owner.location, sp, sv);
  return b;
}
export function stopBeam(owner, why = "done") {
  const b = live.get(owner?.id);
  if (!b) return false;
  live.delete(owner.id);
  clearLight(b);
  if (b.cfg.selfSlow !== undefined) { try { if (valid(owner)) owner.removeEffect("slowness"); } catch { } }
  try { b.cfg.onEnd?.(owner, b, why); } catch (e) { console.warn("[ORIGIN] beam end: " + e); }
  const [s, sp = 1, sv = 1] = b.cfg.sfx?.end ?? [];
  if (s && valid(owner)) sound(owner.dimension, s, owner.location, sp, sv);
  if (why === "cut" && valid(owner)) hudMsg(owner, "§7Beam off.", 15);
  return true;
}
function originsOf(o, mode, dir) {
  const head = o.getHeadLocation(), rt = { x: -dir.z, y: 0, z: dir.x }, rl = Math.hypot(rt.x, rt.z) || 1;
  const r = { x: rt.x / rl, y: 0, z: rt.z / rl };
  if (mode === "eyes") return [-0.13, 0.13].map((s) => ({ x: head.x + r.x * s + dir.x * 0.3, y: head.y + 0.02 + dir.y * 0.3, z: head.z + r.z * s + dir.z * 0.3 }));
  if (mode === "hand") return [{ x: head.x + r.x * 0.38 + dir.x * 0.6, y: head.y - 0.42 + dir.y * 0.4, z: head.z + r.z * 0.38 + dir.z * 0.6 }];
  if (mode === "hands") return [0.36, -0.36].map((s) => ({ x: head.x + r.x * s + dir.x * 0.7, y: head.y - 0.38 + dir.y * 0.5, z: head.z + r.z * s + dir.z * 0.7 }));
  return [{ x: o.location.x + dir.x * 0.45, y: o.location.y + 1.25 + dir.y * 0.3, z: o.location.z + dir.z * 0.45 }];   // chest
}
function tickBeam(b, t) {
  const o = b.owner, cfg = b.cfg;
  if (!valid(o) || t >= b.until || RT(o).cine || o.dimension.id !== b.dimId) return stopBeam(o, valid(o) && t >= b.until ? "done" : "interrupt");
  try { if (o.getComponent("minecraft:health")?.currentValue <= 0) return stopBeam(o, "interrupt"); } catch { }
  const age = t - b.start;
  if (cfg.perSec && age > 0 && age % 20 === 0 && cfg.perSec(o, b) === false) return stopBeam(o, "drained");
  const dim = o.dimension, head = o.getHeadLocation(), view = o.getViewDirection();
  const want = cfg.aim ? (cfg.aim(o, b, age) ?? view) : view;   // some beams steer themselves (a sweep)
  b.dir = V.norm(V.lerp(b.dir, want, cfg.turn ?? 0.45));
  const dir = b.dir, range = cfg.range ?? 32;
  // where it lands
  let dist = range, hitBlock = null, face = null;
  try {
    let wet = false; if (cfg.liquids) { try { wet = !!dim.getBlock(head)?.isLiquid; } catch { } }   // from underwater the ray would stop at your own face
    let bh = dim.getBlockFromRay(head, dir, { maxDistance: range, includePassableBlocks: false, includeLiquidBlocks: !!cfg.liquids && !wet });
    if (bh?.block?.typeId?.startsWith("minecraft:light_block")) {
      const from2 = V.add(V.add(bh.block.location, bh.faceLocation), V.mul(dir, 0.6));
      const bh2 = dim.getBlockFromRay(from2, dir, { maxDistance: Math.max(0.5, range - V.dist(head, from2)), includePassableBlocks: false, includeLiquidBlocks: false });
      bh = bh2;
    }
    if (bh) { hitBlock = bh.block; face = bh.face; dist = V.dist(head, V.add(bh.block.location, bh.faceLocation)); }
  } catch { }
  // who is in the line
  const hitR = cfg.hitRadius ?? 0.5, cands = [];
  try {
    const mid = V.add(head, V.mul(dir, dist / 2));
    for (const e of dim.getEntities({ location: mid, maxDistance: dist / 2 + hitR + 2 })) {
      if (e.id === o.id || SKIP.has(e.typeId) || (cfg.filter && !cfg.filter(e))) continue;
      const hy = (() => { try { return e.getHeadLocation().y; } catch { return e.location.y + 1; } })();
      const c = { x: e.location.x, y: (e.location.y + hy) / 2, z: e.location.z }, v = V.sub(c, head), along = V.dot(v, dir);
      if (along < 0 || along > dist + 0.6) continue;
      if (V.len(V.sub(v, V.mul(dir, along))) > hitR + 0.45 + Math.max(0, hy - e.location.y) * 0.25) continue;
      cands.push({ e, along });
    }
  } catch { }
  cands.sort((x, y) => x.along - y.along);
  let targets = cfg.pierce === false ? cands.slice(0, 1) : cands;
  // XoX holds beams back with his blade: a roll every hit-interval; while he's holding it, nothing past him gets hit
  const xo = targets.find((c) => c.e.typeId === XOX);
  if (xo) {
    if (t >= (b.xoxRoll ?? 0)) { b.xoxRoll = t + (cfg.every ?? 8); if (xoxBlockBeam(xo.e, o)) b.xoxHold = t + (cfg.every ?? 8); }
    if ((b.xoxHold ?? 0) > t) {
      dist = Math.min(dist, xo.along); hitBlock = null; targets = [];
      const sp = V.add(head, V.mul(dir, xo.along));
      fx(dim, "origin:spark", sp, WHITE, 1); fx(dim, "origin:star", sp, cfg.style.core, 1, { n: 4 });
    }
  }
  if (cfg.pierce === false && targets.length) { dist = Math.min(dist, targets[0].along); hitBlock = null; }
  const end = V.add(head, V.mul(dir, dist));
  b.end = end;
  for (const { e } of targets) {
    if ((b.hits.get(e.id) ?? -99) + (cfg.every ?? 8) > t) continue;
    b.hits.set(e.id, t);
    (cfg.hurt ?? defHurt)(e, cfg.dmg ?? 3, o);
    markBeamed(e, o, t, (cfg.every ?? 8) + 4);
    if (cfg.knock) { try { e.applyKnockback({ x: dir.x * cfg.knock, z: dir.z * cfg.knock }, 0.08); } catch { } }
    try { cfg.onHit?.(e, o, b); } catch { }
    try { fx(dim, "origin:star", e.getHeadLocation(), cfg.style.core, 1, { n: 3 }); } catch { }   // it may already be gone
  }
  // draw
  const style = cfg.style, ors = originsOf(o, cfg.from ?? "eyes", dir);
  for (const a of ors) {
    drawBeam(dim, a, end, style, t, { cols: cfg.cols });
    fx(dim, "origin:beam_flare", a, style.glow, 0.85, { size: style.flare * (0.85 + 0.15 * Math.sin(t * 0.9)) });
    if (t % 5 === 0) { const L = V.dist(a, end), u = V.norm(V.sub(end, a)), spd = 46; fx(dim, "origin:beam_pulse", a, style.core, 0.95, { dx: u.x, dy: u.y, dz: u.z, len: 0.9 + style.width * 2, w: style.width * 0.9, spd, life: Math.min(1.4, L / spd) }); }
  }
  // impact
  fx(dim, "origin:beam_flare", end, style.glow, 0.85, { size: style.impact * (0.8 + 0.2 * Math.sin(t * 1.3)) });
  fx(dim, "origin:beam_flare", end, style.core, 1, { size: style.impact * 0.35 });
  if (t % 2 === 0) fx(dim, "origin:star", end, style.core, 1, { n: 2 + Math.round(style.width * 4) });
  if (t % 4 === 0) fx(dim, "origin:boom_smoke", end, { red: 0.3, green: 0.28, blue: 0.27 }, 0.45);
  if (hitBlock) {
    if (t % 6 === 0) scorch(dim, end, face);
    if (t % 5 === 0) burnBlock(dim, hitBlock, cfg.burn ?? style.burn ?? "none");
    if (t % 2 === 0) moveLight(b, dim, V.sub(end, V.mul(dir, 0.35)));
  } else if (dist < range - 0.5) { if (t % 2 === 0) moveLight(b, dim, V.sub(end, V.mul(dir, 0.6))); }
  else clearLight(b);
  // pulses (explosions along the way), the shooter's side
  const P = cfg.pulse;
  if (P && age > 0 && age % P.every === 0) {
    fx(dim, "origin:shockwave", end, style.glow, 1, { radius: P.radius });
    fx(dim, "origin:beam_flare", end, style.core, 1, { size: P.radius * 0.9, life: 0.25 });
    if (P.crater) crater(dim, end, P.crater); else sound(dim, "origin.sfx.explode", end, 1.2, 0.6);
    try { for (const e of dim.getEntities({ location: end, maxDistance: P.radius })) if (e.id !== o.id && !SKIP.has(e.typeId) && (!cfg.filter || cfg.filter(e))) { (cfg.hurt ?? defHurt)(e, P.dmg, o); markBeamed(e, o, t, P.every + 4); } } catch { }
  }
  if (cfg.selfSlow !== undefined && age % 10 === 0) { try { o.addEffect("slowness", 14, { amplifier: cfg.selfSlow, showParticles: false }); } catch { } }
  if (cfg.recoil && age % 4 === 0) { try { o.applyKnockback({ x: -dir.x * cfg.recoil, z: -dir.z * cfg.recoil }, 0); } catch { } }
  if (cfg.shake && age % 8 === 0) { try { o.runCommand(`camerashake add @s ${cfg.shake} 0.45 positional`); } catch { } }
  const lp = cfg.sfx?.loop;
  if (lp && age % lp[1] === 0) sound(dim, lp[0], head, lp[2] ?? 1, lp[3] ?? 0.5);
  if (cfg.label && age % 10 === 0) hudMsg(o, `${cfg.label} §f${Math.max(0, (b.until - t) / 20).toFixed(1)}s §8· use again to stop`, 12);
  try { cfg.onTick?.(o, b, end, t); } catch { }
}
// every tick
export function tickBeams() {
  if (!live.size) return;
  const t = now();
  for (const b of [...live.values()]) { try { tickBeam(b, t); } catch (e) { console.warn("[ORIGIN] beam: " + e); stopBeam(b.owner, "interrupt"); } }
}
