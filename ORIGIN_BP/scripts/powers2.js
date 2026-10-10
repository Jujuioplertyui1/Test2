// ORIGIN v0.21 - powers2.js
// Six popular powers, each with a main move on the Power Core and two or three more in the Power menu (sneak + use).
//  WEB SLINGER (brawler)  - use at a creature: web it in place · at a wall/ceiling while airborne or sprinting: SWING
//                           (use again to let go with a boost) · on the ground: ZIP to it. Walk into walls to crawl
//                           up them. Spider-sense dodges incoming arrows and bullets. Menu: Web Bomb, Yank.
//  TELEKINESIS (energy)   - use at a creature: LIFT it, it floats where you look; use again to THROW it · at stone,
//                           dirt or wood: tear out a chunk and hold it, use again to hurl it · at nothing: a psychic
//                           PUSH. Menu: Crush (squeeze what you hold), Levitate.
//  PYROKINESIS (energy)   - use: FLAME STREAM (3.5s, sets everything alight). Menu: Fireball, Flame Nova, Flame On.
//  CRYOKINESIS (energy)   - use: FROST BEAM (3.5s) - targets slow, then freeze solid in ice; water freezes, lava turns
//                           to obsidian. Menu: Ice Formation (crystals erupt in a line), Ice Slide (an ice path forms
//                           under you - run across water and gaps).
//  BLOOD MANIPULATION (shadow) - use: BLOOD SPIKES erupt under up to six enemies. Menu: Piercing Blood (a compressed
//                           blood beam), Blood Whip (a lash that heals you). Each move costs a little of your blood;
//                           every kill gives some back.
//  GRAVITON (shadow)      - use: SINGULARITY - a black hole where you look drags everything in, then implodes.
//                           Menu: Uplift (everything around you floats up... then gets slammed down), Gravity Leap.
import { world, system, EntityDamageCause, BlockPermutation } from "@minecraft/server";
import { hero, RT, markDirty } from "./data.js";
import { V, at, valid, fx, sound, psound, now, health, C, isSolidBlock, FX_IDS } from "./util.js";
import { hudMsg } from "./voice.js";
import { startBeam, stopBeam, beamActive, drawBeam, flashBeam } from "./beams.js";
import { heavyLaunch, crater, destructionOn } from "./impact.js";
import { bleed, goreBurst, groundUnder } from "./gorefx.js";
import { slashArc, vortex } from "./slashfx.js";
import { startFlight, isFlying } from "./flight.js";
import { placeTemp } from "./tempblocks.js";
import { tether, cocoon, singularity } from "./models.js";

const rgb = (r, g, b) => ({ red: r, green: g, blue: b });
const WHITE = rgb(1, 1, 1), PSY = rgb(0.78, 0.38, 1), FIRE = rgb(1, 0.42, 0.08), ICE = rgb(0.5, 0.82, 1), BLOOD = rgb(0.62, 0.02, 0.04), VOID = rgb(0.55, 0.25, 0.95), INK = rgb(0.02, 0, 0.05);
const SKIP = new Set([...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "origin:float_text", "origin:exo_piece", "origin:exo_drone", "origin:archetype_orb", "origin:manifestation", "origin:lumen_construct",
  "origin:carry_tree", "origin:carry_boulder", "origin:regen_body", "origin:afterimage", "origin:ice_formation", "origin:blood_spike", "origin:tk_rock", "origin:ice_shell", "origin:severed_limb", "origin:prosthetic"]);
const NATURAL = /(dirt|grass_block|:stone$|cobblestone|andesite|diorite|granite|deepslate$|:sand$|gravel|clay|terracotta|_log$|_planks$|netherrack|end_stone|tuff|calcite|:mud$|moss_block|sandstone$|blackstone$)/;
const hurt = (e, n, by, cause = EntityDamageCause.entityAttack) => { try { e.applyDamage(n, by ? { cause, damagingEntity: by } : { cause }); } catch { } };
const canHit = (e, p) => valid(e) && e.id !== p.id && !SKIP.has(e.typeId) && !!health(e);
const foes = (p, c, r) => { try { return p.dimension.getEntities({ location: c, maxDistance: r }).filter((e) => canHit(e, p)); } catch { return []; } };
const lookE = (p, d) => { try { return p.getEntitiesFromViewDirection({ maxDistance: d }).map((h) => h.entity).find((e) => canHit(e, p)) ?? null; } catch { return null; } };
const lookB = (p, d) => { try { const h = p.getBlockFromViewDirection({ maxDistance: d, includePassableBlocks: false }); return h ? { block: h.block, face: h.face, pt: V.add(h.block.location, h.faceLocation) } : null; } catch { return null; } };
const play = (p, a, ctl) => { try { p.playAnimation(a, { controller: ctl, stopExpression: "0", blendOutTime: 0.15 }); } catch { } };
const clearPose = (p, ctl) => { try { p.playAnimation("animation.origin.clear", { controller: ctl, stopExpression: "1", blendOutTime: 0.2 }); } catch { } };
const handPos = (p) => { const h = p.getHeadLocation(), d = p.getViewDirection(); return { x: h.x - d.z * 0.38 + d.x * 0.6, y: h.y - 0.42 + d.y * 0.4, z: h.z + d.x * 0.38 + d.z * 0.6 }; };
const shake = (p, a, t) => { try { p.runCommand(`camerashake add @s ${a} ${t} positional`); } catch { } };
const shakeNear = (dim, c, r, a) => { try { for (const q of dim.getPlayers({ location: c, maxDistance: r })) shake(q, a, 0.35); } catch { } };
const dead = (p) => { try { return p.getComponent("minecraft:health").currentValue <= 0; } catch { return false; } };
const heal = (p, n) => { try { const hc = p.getComponent("minecraft:health"); hc.setCurrentValue(Math.min(hc.effectiveMax, hc.currentValue + n)); } catch { } };
function spawnFx(dim, id, loc, life, yaw) { try { const e = dim.spawnEntity(id, loc); if (yaw !== undefined) e.teleport(loc, { rotation: { x: 0, y: yaw } }); if (life) system.runTimeout(() => { try { e.remove(); } catch { } }, life); return e; } catch { return null; } }
function inCone(p, e, deg, r) { const f = V.flat(p.getViewDirection()), d = V.sub(e.location, p.location), l = Math.hypot(d.x, d.z) || 1; return l <= r && (d.x * f.x + d.z * f.z) / l >= Math.cos((deg * Math.PI) / 360); }
const yawOf = (v) => (Math.atan2(-v.x, v.z) * 180) / Math.PI;
function cone(p, deg, r) { return foes(p, p.location, r).filter((e) => inCone(p, e, deg, r)).sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location)); }
const groundAt = (dim, l) => { const y = groundUnder(dim, at(l, 0, 1.5, 0)); return y === null ? l.y : y - 0.02; };

// ================================================================== WEB SLINGER
const WEB = { core: WHITE, glow: rgb(0.85, 0.9, 1), width: 0.035, coreW: 0.014, flare: 0.12, impact: 0.3, glowA: 0.45 };
const webbed = new Map();
function web(e, ticks) {
  const w = webbed.get(e.id);
  webbed.set(e.id, { e, until: Math.max(w?.until ?? 0, now() + ticks) });
  try { e.addEffect("slowness", ticks, { amplifier: 255, showParticles: false }); e.addEffect("weakness", ticks, { amplifier: 2, showParticles: false }); } catch { }
  cocoon(e, ticks);   // v0.22: a real web cocoon wrapped around them
  try { fx(e.dimension, "origin:web_net", e.getHeadLocation(), WHITE, 1, { size: 0.8, life: 0.3 }); fx(e.dimension, "origin:web_splat_xz", { x: e.location.x, y: Math.floor(e.location.y) + 0.03, z: e.location.z }, WHITE, 0.9, { size: 1.1, life: ticks / 20 + 2 }); } catch { }
}
// where a web line sticks: a splat of web on that face
const SPLAT = { Up: ["xz", 0, 1, 0], Down: ["xz", 0, -1, 0], North: ["xy", 0, 0, -1], South: ["xy", 0, 0, 1], East: ["yz", 1, 0, 0], West: ["yz", -1, 0, 0] };
function splat(dim, pt, face, size = 0.8, life = 8) {
  const s0 = SPLAT[String(face ?? "Up")] ?? SPLAT.Up;
  fx(dim, `origin:web_splat_${s0[0]}`, { x: pt.x + s0[1] * 0.015, y: pt.y + s0[2] * 0.015, z: pt.z + s0[3] * 0.015 }, WHITE, 1, { size, life });
}
function webShot(p, e) {
  play(p, "animation.origin.web.shoot", "origin_p2s");
  tether(p.dimension, () => handPos(p), e, "web", { life: 9, grow: 2, shrink: 4 });
  sound(p.dimension, "origin.sfx.swoosh", p.location, 1.8, 0.7); sound(p.dimension, "mob.slime.small", e.location, 1.4, 0.6);
  web(e, 60);
  hurt(e, 2, p);
}
function startSwing(p, anchor, face) {
  const r = RT(p), f = V.flat(p.getViewDirection());
  let v0 = { x: 0, y: 0, z: 0 };
  try { v0 = p.getVelocity(); } catch { }
  if (p.isOnGround) v0 = { x: f.x * 0.6, y: 0.65, z: f.z * 0.6 };
  r.web = { anchor, len: Math.max(3, V.dist(at(p.location, 0, 1.2, 0), anchor) * 0.92), v: v0, t: 0 };
  play(p, "animation.origin.web.swing", "origin_p2");
  const w = r.web;
  w.line = tether(p.dimension, () => handPos(p), anchor, "web", { life: 400, grow: 2, keep: () => RT(p).web === w });   // the web line you swing on
  splat(p.dimension, anchor, face, 0.9, 8);
  sound(p.dimension, "origin.sfx.swoosh", p.location, 1.5, 0.8);
}
function releaseWeb(p, boost) {
  const r = RT(p), w = r.web;
  r.web = null;
  if (w?.line && !w.line.dead) { w.line.keep = null; w.line.reel(4); }   // the line snaps back to your wrist
  clearPose(p, "origin_p2");
  r.flyGrace = now() + 80;
  if (!boost || !w || !valid(p)) return;
  const f = V.flat(p.getViewDirection());
  try { p.applyKnockback({ x: w.v.x * 1.15 + f.x * 0.25, z: w.v.z * 1.15 + f.z * 0.25 }, Math.max(0.35, w.v.y + 0.45)); } catch { }
  sound(p.dimension, "origin.sfx.swoosh", p.location, 1.2, 0.8);
}
function tickSwing(p, r) {
  const w = r.web;
  if (++w.t > 140 || (p.isOnGround && w.t > 6) || r.cine || dead(p)) return releaseWeb(p, false);
  let mv = { x: 0, y: 0 };
  try { mv = p.inputInfo.getMovementVector(); } catch { }
  const f = V.flat(p.getViewDirection()), push = Math.max(0, mv.y) * 0.035;
  w.v = { x: w.v.x * 0.995 + f.x * push, y: w.v.y - 0.075, z: w.v.z * 0.995 + f.z * push };
  if (mv.y > 0.5) w.len = Math.max(3, w.len - 0.06);
  const hand = at(p.location, 0, 1.2, 0), next = V.add(hand, w.v), d = V.sub(next, w.anchor), dl = V.len(d);
  if (dl > w.len) w.v = V.sub(V.add(w.anchor, V.mul(d, w.len / dl)), hand);   // the line is taut: swing on it
  const s = V.len(w.v);
  if (s > 2.2) w.v = V.mul(w.v, 2.2 / s);
  try { p.applyKnockback({ x: w.v.x, z: w.v.z }, w.v.y + 0.08); } catch { }
  r.flyGrace = now() + 60;
  if (w.t % 3 === 0 && s > 0.6) fx(p.dimension, "origin:trail_line", at(p.location, 0, 0.9, 0), WHITE, 0.45, { size: 0.12, life: 0.5 });
}
function webZip(p, pt, face) {
  const dim = p.dimension, r = RT(p), d = V.sub(pt, p.location), L = V.len(d), u = V.mul(d, 1 / (L || 1)), n = Math.min(14, Math.ceil(L / 2.2));
  play(p, "animation.origin.web.zip", "origin_p2s");
  tether(dim, () => handPos(p), pt, "web", { life: n + 4, grow: 2, shrink: 3 });
  splat(dim, pt, face, 0.8, 6);
  sound(dim, "origin.sfx.swoosh", p.location, 1.6, 0.8);
  let k = 0;
  const id = system.runInterval(() => {
    if (!valid(p) || ++k > n) { system.clearRun(id); return; }
    try { p.applyKnockback({ x: u.x * 2.1, z: u.z * 2.1 }, u.y * 2.1 + 0.12); } catch { }
  }, 1);
  r.flyGrace = now() + 60;
}
function webUse(p) {
  const r = RT(p);
  if (r.web) { releaseWeb(p, true); return { cost: 0, cd: 4 }; }
  const e = lookE(p, 24);
  if (e) { webShot(p, e); return { cost: 6, cd: 10 }; }
  const b = lookB(p, 42);
  if (!b) { hudMsg(p, "§7Nothing to stick a web to.", 25); return false; }
  // zip instead of swinging when you're flying (the flight controller owns your motion), standing still, or the anchor isn't above you
  if (isFlying(p) || (p.isOnGround && !p.isSprinting) || b.pt.y < p.location.y + 1.5) { webZip(p, b.pt, b.face); return { cost: 6, cd: 14 }; }
  startSwing(p, b.pt, b.face);
  return { cost: 4, cd: 6 };
}
function webBomb(p) {
  const dim = p.dimension, list = foes(p, p.location, 8);
  play(p, "animation.origin.pose.push", "origin_p2s");
  fx(dim, "origin:web_decal", at(p.location, 0, 0.05, 0), WHITE, 0.9, { size: 4.5, life: 8 });
  sound(dim, "mob.slime.big", p.location, 1.3, 1); sound(dim, "origin.sfx.swoosh", p.location, 0.9, 1);
  for (const [i, e] of list.entries()) {
    if (i < 6) tether(dim, at(p.location, 0, 1, 0), e, "web", { life: 10, grow: 2, shrink: 4 });
    web(e, 90);
    const d = V.flat(V.sub(p.location, e.location));
    try { e.applyKnockback({ x: d.x * 0.5, z: d.z * 0.5 }, 0.1); } catch { }
  }
  hudMsg(p, list.length ? `§fWEBBED §7${list.length}` : "§7The net catches nothing.", 25);
  return true;
}
function webYank(p) {
  const e = lookE(p, 26);
  if (!e) { hudMsg(p, "§7Nothing to yank.", 25); return false; }
  tether(p.dimension, () => handPos(p), e, "web", { life: 9, grow: 2, shrink: 5 });
  const d = V.flat(V.sub(p.location, e.location)), dist = V.hdist(p.location, e.location);
  try { e.applyKnockback({ x: d.x * Math.min(3, 0.6 + dist * 0.18), z: d.z * Math.min(3, 0.6 + dist * 0.18) }, 0.5); } catch { }
  play(p, "animation.origin.web.shoot", "origin_p2s");
  sound(p.dimension, "origin.sfx.swoosh", p.location, 0.9, 1);
  hurt(e, 4, p);
  web(e, 25);
  return true;
}
function wallCrawl(p, r) {
  const was = r.crawl;
  r.crawl = false;
  crawlPose(p, r, was);
  if (r.web || isFlying(p)) return;
  let mv; try { mv = p.inputInfo.getMovementVector(); } catch { return; }
  if (!mv || mv.y < 0.5) return;
  const f = V.flat(p.getViewDirection()), L = p.location;
  const solid = (dy) => { try { return isSolidBlock(p.dimension.getBlock({ x: Math.floor(L.x + f.x * 0.55), y: Math.floor(L.y + dy), z: Math.floor(L.z + f.z * 0.55) })); } catch { return false; } };
  if (!solid(0.3) && !solid(1.2)) return;
  r.crawl = true;
  crawlPose(p, r, was);
  try { p.applyKnockback({ x: f.x * 0.05, z: f.z * 0.05 }, 0.22); } catch { }
  r.flyGrace = now() + 20;
  if (now() % 8 === 0) sound(p.dimension, "mob.spider.step", L, 1.2, 0.25);
}

// climbing: arms and legs reach up the wall (and let go when you stop)
function crawlPose(p, r, was) {
  if (r.crawl && !r.crawlAnim) { r.crawlAnim = true; play(p, "animation.origin.web.crawl", "origin_crawl"); }
  else if (!r.crawl && r.crawlAnim && was === false) { r.crawlAnim = false; clearPose(p, "origin_crawl"); }
}

// ================================================================== TELEKINESIS
const PSY_BEAM = { core: rgb(0.95, 0.85, 1), glow: PSY, width: 0.05, coreW: 0.015, flare: 0.25, impact: 0.4, glowA: 0.35 };
const rocks = [];
function tkUse(p) {
  const r = RT(p);
  if (r.tk) return tkThrow(p);
  const e = lookE(p, 28);
  if (e) {
    r.tk = { kind: "mob", e, t: 0 };
    play(p, "animation.origin.tk.hold", "origin_p2");
    sound(p.dimension, "origin.sfx.mind", p.location, 1.4, 0.8);
    hudMsg(p, "§dLifted. §7Use again to throw · menu: Crush", 40);
    return { cost: 10, cd: 8 };
  }
  const b = lookB(p, 20);
  if (b && NATURAL.test(b.block.typeId) && destructionOn()) {
    const at0 = { x: b.block.location.x + 0.5, y: b.block.location.y + 0.5, z: b.block.location.z + 0.5 };
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) { try { const q = p.dimension.getBlock({ x: b.block.location.x + dx, y: b.block.location.y, z: b.block.location.z + dz }); if (q && NATURAL.test(q.typeId)) q.setType("minecraft:air"); } catch { } }
    fx(p.dimension, "origin:debris", at0, C.dust, 1);
    sound(p.dimension, "origin.sfx.rocks", at0, 0.8, 1);
    const rock = spawnFx(p.dimension, "origin:tk_rock", at0);
    if (!rock) return false;
    r.tk = { kind: "rock", e: rock, t: 0 };
    play(p, "animation.origin.tk.hold", "origin_p2");
    hudMsg(p, "§dYou tear the ground loose. §7Use again to hurl it.", 40);
    return { cost: 10, cd: 8 };
  }
  // nothing to hold: a psychic push
  const dim = p.dimension, f = p.getViewDirection();
  play(p, "animation.origin.pose.push", "origin_p2s");
  fx(dim, "origin:sonic_ring", at(p.getHeadLocation(), f.x * 1.5, f.y * 1.5 - 0.2, f.z * 1.5), PSY, 1, { size: 2.5 });
  fx(dim, "origin:beam_ring", at(p.getHeadLocation(), f.x * 2.5, f.y * 2.5 - 0.2, f.z * 2.5), PSY, 0.9, { dx: f.x, dy: f.y, dz: f.z, size: 3, life: 0.35 });
  fx(dim, "origin:shockwave", at(p.location, 0, 0.1, 0), PSY, 1, { radius: 3 });
  sound(dim, "origin.sfx.windblast", p.location, 1.3, 1); sound(dim, "origin.sfx.mind", p.location, 0.9, 0.7);
  for (const e2 of cone(p, 70, 9)) { hurt(e2, 4, p); heavyLaunch(e2, f, 1, p); }
  return { cost: 12, cd: 40 };
}
function tkThrow(p) {
  const r = RT(p), h = r.tk;
  r.tk = null;
  clearPose(p, "origin_p2");
  play(p, "animation.origin.pose.throw", "origin_p2s");
  const dir = p.getViewDirection();
  sound(p.dimension, "origin.sfx.windblast", p.location, 0.9, 1);
  if (!h || !valid(h.e)) return { cost: 0, cd: 4 };
  if (h.kind === "mob") { try { h.e.removeEffect("slowness"); } catch { } hurt(h.e, 6, p); heavyLaunch(h.e, dir, 2, p); }
  else rocks.push({ e: h.e, by: p, pos: { ...h.e.location }, vel: V.mul(dir, 1.8), t: 0 });
  return { cost: 0, cd: 10 };
}
function tickHold(p, r) {
  const h = r.tk;
  if (!valid(h.e) || ++h.t > 180 || r.cine || dead(p)) { if (h.kind === "rock") { try { h.e.remove(); } catch { } } r.tk = null; clearPose(p, "origin_p2"); return; }
  const head = p.getHeadLocation(), dir = p.getViewDirection(), pos = V.add(head, V.mul(dir, h.kind === "rock" ? 3.2 : 4.2));
  pos.y -= h.kind === "rock" ? 0.4 : 0.9;
  try { h.e.teleport(pos); } catch { }
  if (h.kind === "mob") { try { h.e.addEffect("slowness", 4, { amplifier: 255, showParticles: false }); } catch { } }
  if (h.t % 3 === 0) vortex(p.dimension, at(pos, 0, h.kind === "mob" ? 0.9 : 0.4, 0), 1.2, PSY);
  if (!h.link || h.link.dead) { const hh = h; h.link = tether(p.dimension, () => at(p.getHeadLocation(), 0, 0.12, 0), () => valid(hh.e) ? at(hh.e.location, 0, hh.kind === "mob" ? 0.9 : 0.4, 0) : null, "psy", { life: 400, grow: 3, keep: () => RT(p).tk === hh }); }
  if (h.t % 20 === 0) sound(p.dimension, "origin.sfx.mind", pos, 1.6, 0.25);
  if (h.crush) {
    if (h.t % 5 === 0) { hurt(h.e, 3, p); shake(p, 0.12, 0.2); sound(p.dimension, "origin.sfx.bonecrack", pos, 0.8 + Math.random() * 0.4, 0.7); bleed(h.e, 4); }
    if (h.t >= h.crushEnd) { h.crush = false; goreBurst(h.e, 2); hudMsg(p, "§dCrushed.", 20); }
  }
}
function tkCrush(p) {
  const h = RT(p).tk;
  if (!h || h.kind !== "mob" || !valid(h.e)) { hudMsg(p, "§7Lift a creature first (use the Power Core on it).", 40); return false; }
  h.crush = true; h.crushEnd = h.t + 40;
  sound(p.dimension, "origin.sfx.crush", p.location, 0.8, 1);
  return true;
}
function tkLevitate(p) {
  if (isFlying(p)) { hudMsg(p, "§7Already off the ground.", 20); return false; }
  const ok = startFlight(p, { kind: "power", maxTicks: 200, mult: 0.6, col: PSY });
  if (ok) hudMsg(p, "§dLevitating §7- 10s", 30);
  return ok;
}
function tickRocks() {
  for (let i = rocks.length - 1; i >= 0; i--) {
    const o = rocks[i];
    if (!valid(o.e) || ++o.t > 60) { try { o.e?.remove(); } catch { } rocks.splice(i, 1); continue; }
    o.pos = V.add(o.pos, o.vel); o.vel.y -= 0.04;
    const dim = o.e.dimension;
    try { o.e.teleport(o.pos); } catch { }
    if (o.t % 2 === 0) fx(dim, "origin:dust", o.pos, C.dust, 0.5);
    let hitE = [];
    try { hitE = dim.getEntities({ location: o.pos, maxDistance: 1.8 }).filter((e) => valid(o.by) ? canHit(e, o.by) : !SKIP.has(e.typeId)); } catch { }
    let solid = false;
    try { solid = isSolidBlock(dim.getBlock(o.pos)); } catch { }
    if (hitE.length || solid) {
      for (const e of hitE) { hurt(e, 10, valid(o.by) ? o.by : undefined); heavyLaunch(e, o.vel, 1, o.by); }
      crater(dim, o.pos, 1);
      try { o.e.remove(); } catch { }
      rocks.splice(i, 1);
    }
  }
}

// ================================================================== PYROKINESIS
const FLAME = { core: rgb(1, 0.95, 0.65), glow: FIRE, sheath: rgb(1, 0.7, 0.2), width: 0.34, coreW: 0.1, flare: 0.55, impact: 1.4, glowA: 0.7, burn: "fire" };
const balls = [];
function pyroUse(p) {
  play(p, "animation.origin.power.channel", "origin_p2");
  startBeam(p, "p2", {
    dur: 70, range: 18, from: "hand", style: FLAME, dmg: 2, every: 5, hurt, pierce: true, turn: 0.5, hitRadius: 0.9, burn: "fire", label: "§6§lFLAME STREAM",
    onHit: (e) => { try { e.setOnFire(5, true); } catch { } },
    onTick: (o, b, end, t) => { if (t % 2 === 0) fx(o.dimension, "origin:ember", V.lerp(handPos(o), end, Math.random()), FIRE, 1); },
    onEnd: (o) => clearPose(o, "origin_p2"),
    sfx: { start: ["origin.sfx.flame", 1, 1], loop: ["origin.sfx.fire", 12, 1, 0.5], end: ["random.fizz", 0.8, 0.6] },
  });
  return true;
}
function fireball(p) {
  play(p, "animation.origin.power.cast", "origin_p2s");
  balls.push({ by: p, dim: p.dimension, pos: handPos(p), vel: V.mul(p.getViewDirection(), 1.25), t: 0 });
  sound(p.dimension, "mob.ghast.fireball", p.location, 0.8, 1);
  return true;
}
function tickBalls() {
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    b.pos = V.add(b.pos, b.vel); b.vel.y -= 0.01;
    const dim = b.dim;
    fx(dim, "origin:beam_flare", b.pos, FIRE, 1, { size: 0.8, life: 0.1 });
    fx(dim, "origin:beam_flare", b.pos, rgb(1, 0.9, 0.5), 1, { size: 0.35, life: 0.1 });
    if (b.t % 2 === 0) { fx(dim, "origin:ember", b.pos, FIRE, 1); fx(dim, "origin:boom_smoke", b.pos, C.grey, 0.4); }
    let hitE = false, solid = false;
    try { hitE = dim.getEntities({ location: b.pos, maxDistance: 1.4 }).some((e) => valid(b.by) ? canHit(e, b.by) : !SKIP.has(e.typeId)); } catch { }
    try { solid = isSolidBlock(dim.getBlock(b.pos)); } catch { }
    if (!hitE && !solid && ++b.t < 70) continue;
    balls.splice(i, 1);
    fx(dim, "origin:flash", b.pos, FIRE, 1, { size: 3 }); fx(dim, "origin:shockwave", b.pos, FIRE, 1, { radius: 3.5 });
    for (let k = 0; k < 3; k++) fx(dim, "origin:boom_fire", b.pos, FIRE, 1);
    crater(dim, b.pos, 1);
    try { for (const e of dim.getEntities({ location: b.pos, maxDistance: 3.5 })) if (valid(b.by) ? canHit(e, b.by) : !SKIP.has(e.typeId)) { hurt(e, 10, valid(b.by) ? b.by : undefined); try { e.setOnFire(6, true); } catch { } } } catch { }
    if (destructionOn()) for (let k = 0; k < 6; k++) { try { const q = dim.getBlock({ x: Math.floor(b.pos.x + (Math.random() - 0.5) * 4), y: Math.floor(b.pos.y + 1), z: Math.floor(b.pos.z + (Math.random() - 0.5) * 4) }); const below = q && dim.getBlock({ x: q.location.x, y: q.location.y - 1, z: q.location.z }); if (q?.isAir && isSolidBlock(below)) q.setType("minecraft:fire"); } catch { } }
  }
}
function flameNova(p) {
  const dim = p.dimension, c = at(p.location, 0, 0.6, 0);
  play(p, "animation.origin.ult.flare", "origin_p2s");
  fx(dim, "origin:shockwave", at(p.location, 0, 0.1, 0), FIRE, 1, { radius: 6 }); fx(dim, "origin:flash", c, FIRE, 1, { size: 4 });
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; fx(dim, "origin:boom_fire", at(p.location, Math.cos(a) * 3.5, 0.5, Math.sin(a) * 3.5), FIRE, 1); }
  sound(dim, "origin.sfx.explode", p.location, 0.9, 1); sound(dim, "origin.sfx.flame", p.location, 0.8, 1);
  shake(p, 0.4, 0.4);
  for (const e of foes(p, p.location, 6)) { hurt(e, 8, p); try { e.setOnFire(6, true); } catch { } if (V.dist(e.location, p.location) < 4) heavyLaunch(e, V.sub(e.location, p.location), 1, p); }
  return true;
}
function flameOn(p) {
  RT(p).flameOn = now() + 300;
  try { p.addEffect("fire_resistance", 320, { showParticles: false }); } catch { }
  fx(p.dimension, "origin:flash", at(p.location, 0, 1, 0), FIRE, 1, { size: 2.5 });
  fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), FIRE, 1, { radius: 4 });
  sound(p.dimension, "origin.sfx.flame", p.location, 1.2, 1); sound(p.dimension, "mob.blaze.shoot", p.location, 0.7, 1);
  // v0.22: Flame On means flying - a trail of fire behind you until it burns out (double-tap jump to land)
  const flying = isFlying(p) || startFlight(p, { kind: "power", maxTicks: 300, mult: 1.05, col: FIRE,
    onTick: (pl, age) => { if (age % 2 === 0) { fx(pl.dimension, "origin:boom_fire", at(pl.location, 0, 0.5, 0), FIRE, 0.6); fx(pl.dimension, "origin:ember", at(pl.location, (Math.random() - 0.5) * 0.6, Math.random() * 1.6, (Math.random() - 0.5) * 0.6), rgb(1, 0.75, 0.3), 1); } return (RT(pl).flameOn ?? 0) > now(); } });
  hudMsg(p, `§6§lFLAME ON §r§7- 15s: ${flying ? "you fly, " : ""}fire can't touch you, your punches burn`, 50);
  return true;
}

// ================================================================== CRYOKINESIS
const FROST = { core: rgb(0.95, 1, 1), glow: ICE, sheath: rgb(0.82, 0.95, 1), width: 0.28, coreW: 0.085, flare: 0.5, impact: 1.3, glowA: 0.65, burn: "freeze" };
const chill = new Map(), frozen = new Map();
let ICE_PERM = null;
function freezeSolid(e, ticks) {
  const f = frozen.get(e.id);
  if (f) { f.until = Math.min(f.born + 400, Math.max(f.until, now() + ticks)); return; }   // 20s at most, however often it's refrozen
  const shell = spawnFx(e.dimension, "origin:ice_shell", e.location);
  frozen.set(e.id, { e, shell, pos: { ...e.location }, until: now() + ticks, born: now() });
  sound(e.dimension, "origin.sfx.ice", e.location, 1, 1);
  fx(e.dimension, "origin:sparkle", at(e.location, 0, 1, 0), ICE, 1);
}
function cryoHit(e, p) {
  const n = (chill.get(e.id)?.n ?? 0) + 1;
  chill.set(e.id, { n, at: now() });
  try { e.addEffect("slowness", 40, { amplifier: Math.min(4, n), showParticles: false }); } catch { }
  if (n >= 5) { chill.delete(e.id); freezeSolid(e, 70); }
}
function cryoUse(p) {
  play(p, "animation.origin.power.channel", "origin_p2");
  startBeam(p, "p2", {
    dur: 70, range: 24, from: "hand", style: FROST, dmg: 2, every: 6, hurt, pierce: true, turn: 0.5, hitRadius: 0.75, burn: "freeze", liquids: true, label: "§b§lFROST BEAM",
    onHit: (e, o) => cryoHit(e, o),
    onTick: (o, b, end, t) => { if (t % 2 === 0) fx(o.dimension, "origin:sparkle", V.lerp(handPos(o), end, Math.random()), ICE, 1); },
    onEnd: (o) => clearPose(o, "origin_p2"),
    sfx: { start: ["origin.sfx.ice", 1.2, 1], loop: ["origin.sfx.wind", 14, 1.6, 0.4], end: ["random.glass", 1.6, 0.4] },
  });
  return true;
}
function iceFormation(p) {
  const dim = p.dimension, f = V.flat(p.getViewDirection()), yaw = yawOf(f);
  play(p, "animation.origin.power.slam", "origin_p2s");
  sound(dim, "origin.sfx.ice", p.location, 0.8, 1);
  for (let i = 1; i <= 6; i++) system.runTimeout(() => {
    if (!valid(p)) return;
    const c0 = at(p.location, f.x * i * 2.4, 0, f.z * i * 2.4), c = { x: c0.x, y: groundAt(dim, c0), z: c0.z };
    spawnFx(dim, "origin:ice_formation", c, 70, yaw);
    fx(dim, "origin:shockwave", at(c, 0, 0.1, 0), ICE, 1, { radius: 1.6 }); fx(dim, "origin:shards", at(c, 0, 0.6, 0), ICE, 1);
    sound(dim, "random.glass", c, 0.7 + i * 0.05, 0.8); shakeNear(dim, c, 16, 0.15);
    for (const e of foes(p, c, 2.4)) { hurt(e, 8, p); heavyLaunch(e, { x: f.x, y: 0, z: f.z }, 1, p); cryoHit(e, p); }
  }, i * 3);
  return true;
}
function iceSlide(p) {
  RT(p).iceSlide = now() + 240;
  sound(p.dimension, "origin.sfx.ice", p.location, 1.4, 0.8);
  hudMsg(p, "§b§lICE SLIDE §r§7- 12s: run across water and gaps", 40);
  return true;
}
function tickSlide(p, r, t) {
  if ((r.iceSlide ?? 0) <= t) { if (r.surfAnim) { r.surfAnim = false; clearPose(p, "origin_surf"); } return; }
  try { p.addEffect("speed", 10, { amplifier: 1, showParticles: false }); } catch { }
  if (t % 2 === 0) fx(p.dimension, "origin:sparkle", p.location, ICE, 0.8);
  let mv = { x: 0, y: 0 }, vy = 0;
  try { mv = p.inputInfo.getMovementVector(); vy = p.getVelocity().y; } catch { }
  if (!r.surfAnim && Math.hypot(mv.x, mv.y) > 0.3) { r.surfAnim = true; play(p, "animation.origin.pose.surf", "origin_surf"); }
  if (p.isSneaking || vy > 0.05) return;   // jumping or sneaking: no ice (sneak to drop down)
  const L = p.location, f = V.flat(p.getViewDirection());
  const spots = [{ x: Math.floor(L.x), y: Math.floor(L.y - 0.5), z: Math.floor(L.z) }];
  if (mv.y > 0.3) spots.push({ x: Math.floor(L.x + f.x), y: Math.floor(L.y - 0.5), z: Math.floor(L.z + f.z) });
  ICE_PERM ??= (() => { try { return BlockPermutation.resolve("minecraft:packed_ice"); } catch { return null; } })();
  // temporary blocks: each one puts back exactly what was there (even after a crash or quitting mid-slide)
  for (const s of spots) placeTemp(p.dimension, s, ICE_PERM, 200, (b) => b.isAir || /water/.test(b.typeId));
}
function tickIce(t) {
  for (const [id, f] of frozen) {
    if (!valid(f.e) || f.until <= t) {
      frozen.delete(id);
      try { if (valid(f.shell)) { fx(f.shell.dimension, "origin:shards", at(f.shell.location, 0, 1, 0), ICE, 1); sound(f.shell.dimension, "random.glass", f.shell.location, 1, 1); f.shell.remove(); } } catch { }
      if (valid(f.e)) hurt(f.e, 4);
      continue;
    }
    try { f.e.teleport(f.pos); f.e.addEffect("slowness", 4, { amplifier: 255, showParticles: false }); f.e.addEffect("weakness", 4, { amplifier: 255, showParticles: false }); } catch { }
    try { if (valid(f.shell)) f.shell.teleport(f.pos); } catch { }
  }
  for (const [id, c] of chill) if (t - c.at > 60) chill.delete(id);
}

// ================================================================== BLOOD MANIPULATION
const PIERCE = { core: rgb(1, 0.55, 0.55), glow: BLOOD, width: 0.085, coreW: 0.03, flare: 0.25, impact: 0.8, glowA: 0.8 };
function bloodPrice(p, n) {   // your own blood - never enough to kill you
  try { const hc = p.getComponent("minecraft:health"); if (hc.currentValue > n + 2) hc.setCurrentValue(hc.currentValue - n); } catch { }
  fx(p.dimension, "origin:blood_drops", at(p.location, 0, 1.1, 0), BLOOD, 1, { n: 6 });
}
function spike(p, c) {
  const dim = p.dimension, g = { x: c.x, y: groundAt(dim, c), z: c.z };
  spawnFx(dim, "origin:blood_spike", g, 40, Math.random() * 360);
  fx(dim, "origin:blood_mist", at(g, 0, 0.6, 0), BLOOD, 1, { n: 10, spd: 1 });
  sound(dim, "mob.slime.big", g, 0.6, 0.9); sound(dim, "origin.sfx.crush", g, 1.1, 0.6);
  return g;
}
function bloodUse(p) {
  const list = cone(p, 80, 16).slice(0, 6);
  play(p, "animation.origin.power.slam", "origin_p2s");
  bloodPrice(p, 1);
  if (!list.length) {   // nothing to impale: they erupt in a line anyway
    const f = V.flat(p.getViewDirection());
    for (let i = 1; i <= 3; i++) system.runTimeout(() => valid(p) && spike(p, at(p.location, f.x * i * 2.2, 0, f.z * i * 2.2)), i * 3);
    return true;
  }
  list.forEach((e, i) => system.runTimeout(() => {
    if (!valid(p) || !valid(e)) return;
    spike(p, e.location);
    hurt(e, 9, p);
    bleed(e, 9);
    try { e.applyKnockback({ x: 0, z: 0 }, 0.65); e.addEffect("slowness", 30, { amplifier: 3, showParticles: false }); } catch { }
  }, i * 3));
  return true;
}
function piercingBlood(p) {
  bloodPrice(p, 2);
  fx(p.dimension, "origin:beam_flare", handPos(p), BLOOD, 1, { size: 0.6, life: 0.3 });
  play(p, "animation.origin.power.cast", "origin_p2s");
  startBeam(p, "p2", {
    dur: 14, range: 40, from: "hand", style: PIERCE, dmg: 10, every: 4, hurt, pierce: true, turn: 0.7, hitRadius: 0.35, label: "§4§lPIERCING BLOOD",
    onHit: (e) => bleed(e, 8), sfx: { start: ["origin.sfx.laser", 1.6, 1], loop: ["mob.slime.small", 4, 1.8, 0.3] },
  });
  return true;
}
function bloodWhip(p) {
  const dim = p.dimension, f = V.flat(p.getViewDirection());
  bloodPrice(p, 1);
  play(p, "animation.origin.pose.whip", "origin_p2s");
  slashArc(dim, at(p.location, 0, 1.2, 0), f, { tilt: 8, from: 170, to: 10, radius: 4.2, color: rgb(1, 0.35, 0.35), glow: BLOOD, steps: 18, len: 0.6, w: 0.08 });
  sound(dim, "origin.sfx.sweep2", p.location, 0.8, 1); sound(dim, "mob.slime.big", p.location, 1.4, 0.6);
  let n = 0;
  for (const e of cone(p, 140, 5.5)) { hurt(e, 8, p); bleed(e, 8); n++; try { const k = V.flat(V.sub(e.location, p.location)); e.applyKnockback({ x: k.x * 1.1, z: k.z * 1.1 }, 0.3); } catch { } }
  if (n) { heal(p, n); hudMsg(p, `§4+${n}§c❤ §7taken back`, 20); }
  return true;
}

// ================================================================== GRAVITON
const holes = [];
const SWALLOW = /^minecraft:(arrow|small_fireball|fireball|dragon_fireball|wither_skull(_dangerous)?|snowball|egg|wind_charge_projectile|breeze_wind_charge_projectile|shulker_bullet|llama_spit|splash_potion|lingering_potion|xp_bottle)$/;   // never tridents: that's someone's item
function gravUse(p) {
  const b = lookB(p, 24), e = lookE(p, 24);
  const c = e ? at(e.location, 0, 1.2, 0) : b ? at(b.pt, 0, 1.6, 0) : V.add(p.getHeadLocation(), V.mul(p.getViewDirection(), 16));
  holes.push({ by: p, dim: p.dimension, c, t: 0, dur: 80, m: singularity(p.dimension, c, 100) });
  play(p, "animation.origin.power.cast", "origin_p2s");
  sound(p.dimension, "origin.sfx.gravity", c, 0.6, 1); sound(p.dimension, "mob.warden.sonic_charge", c, 0.6, 0.6);
  return true;
}
function tickHoles() {
  for (let i = holes.length - 1; i >= 0; i--) {
    const h = holes[i], dim = h.dim, c = h.c, k = ++h.t / h.dur;
    fx(dim, "origin:beam_flare", c, INK, 1, { size: 0.45 + k * 0.45, life: 0.1 });   // the event horizon (the model carries the disk)
    if (h.t % 4 === 0) h.m?.size(0.6 + k * 1.3);
    if (!h.m && h.t % 2 === 0) fx(dim, "origin:accretion", c, VOID, 0.9, { size: 1.8 + k * 0.8, rot: h.t * 14, life: 0.12 });
    if (h.t % 3 === 0) vortex(dim, c, 4 + k * 3, VOID);
    if (h.t % 20 === 0) sound(dim, "origin.sfx.gravity", c, 0.5 + k * 0.3, 0.6);
    if (h.t < h.dur) {
      try {
        for (const e of dim.getEntities({ location: c, maxDistance: 11 })) {
          if (e.id === h.by?.id) continue;
          if (SWALLOW.test(e.typeId)) { if (V.dist(e.location, c) < 6) { fx(dim, "origin:spark", e.location, VOID, 1); try { e.remove(); } catch { } } continue; }
          if (SKIP.has(e.typeId) || !health(e)) continue;
          const d = V.sub(c, e.location), l = V.len(d) || 1, s = Math.min(0.9, 0.3 + (11 - l) * 0.06);
          try { e.applyKnockback({ x: (d.x / l) * s, z: (d.z / l) * s }, Math.max(-0.3, Math.min(0.4, (d.y / l) * s + 0.08))); } catch { }
          if (l < 2.2 && h.t % 10 === 0) hurt(e, 2, valid(h.by) ? h.by : undefined);
        }
      } catch { }
      continue;
    }
    holes.splice(i, 1);   // collapse
    h.m?.cut();
    fx(dim, "origin:flash", c, WHITE, 1, { size: 4 }); fx(dim, "origin:shockwave", c, VOID, 1, { radius: 6 }); fx(dim, "origin:sonic_ring", c, VOID, 1, { size: 6 });
    sound(dim, "origin.sfx.explode", c, 0.6, 1); sound(dim, "mob.warden.sonic_boom", c, 0.7, 0.8);
    shakeNear(dim, c, 30, 0.45);
    try { if (isSolidBlock(dim.getBlock(at(c, 0, -2, 0)))) crater(dim, at(c, 0, -1.5, 0), 1); } catch { }
    try { for (const e of dim.getEntities({ location: c, maxDistance: 6 })) { if (e.id === h.by?.id || SKIP.has(e.typeId) || !health(e)) continue; if (V.dist(e.location, c) < 4.5) hurt(e, 10, valid(h.by) ? h.by : undefined); heavyLaunch(e, V.sub(e.location, c), 1, h.by); } } catch { }
  }
}
function uplift(p) {
  const list = foes(p, p.location, 10);
  if (!list.length) { hudMsg(p, "§7Nothing to lift.", 25); return false; }
  play(p, "animation.origin.ult.flare", "origin_p2s");
  sound(p.dimension, "origin.sfx.gravity", p.location, 1.2, 1);
  for (const e of list) { try { e.addEffect("levitation", 30, { amplifier: 3, showParticles: false }); } catch { } vortex(e.dimension, e.getHeadLocation(), 1.5, VOID); }
  system.runTimeout(() => {
    if (!valid(p)) return;
    play(p, "animation.origin.power.slam", "origin_p2s");
    sound(p.dimension, "origin.sfx.crush", p.location, 0.7, 1);
    for (const e of list) if (valid(e)) { try { e.removeEffect("levitation"); } catch { } hurt(e, 6, p); heavyLaunch(e, V.flat(V.sub(e.location, p.location)), 2, p, { down: true }); }
  }, 32);
  return true;
}
function gravLeap(p) {
  const r = RT(p), f = V.flat(p.getViewDirection());
  play(p, "animation.origin.pose.leap", "origin_p2s");
  try { p.applyKnockback({ x: f.x * 1.2, z: f.z * 1.2 }, 1.7); } catch { }
  r.leap = { t: 0, slam: false };
  r.flyGrace = now() + 200;
  fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), VOID, 1, { radius: 2.5 });
  sound(p.dimension, "origin.sfx.windblast", p.location, 0.8, 1);
  return true;
}
function tickLeap(p, r) {
  const L = r.leap;
  if (++L.t > 100 || dead(p)) { r.leap = null; return; }
  if (!L.slam && L.t > 12) { L.slam = true; try { p.applyKnockback({ x: 0, z: 0 }, -3); } catch { } sound(p.dimension, "origin.sfx.gravity", p.location, 0.6, 1); }
  if (L.slam && L.t % 2 === 0) fx(p.dimension, "origin:streak", at(p.location, 0, 1.6, 0), VOID, 0.9, { dx: 0, dy: -1, dz: 0, len: 1.2, w: 0.07, spd: 0.4, life: 0.2 });
  if (L.slam && p.isOnGround) {
    r.leap = null;
    crater(p.dimension, p.location, 2);
    fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), VOID, 1, { radius: 6 });
    for (const e of foes(p, p.location, 5.5)) { hurt(e, 8, p); heavyLaunch(e, V.sub(e.location, p.location), 1, p); }
    r.flyGrace = now() + 20;
  }
}

// ================================================================== definitions, dispatch, hooks
export const P2_DEFS = {
  web_slinger: { arch: "brawler", name: "Web Slinger", icon: "§f", cost: 4, cd: 6,
    desc: "Use at a creature to web it in place. Use at a wall or ceiling while you're in the air or sprinting to SWING on a web line - push forward to pump the swing, use again to let go with a boost. On the ground, use at a block to ZIP to it. Walk into a wall to crawl up it. Spider-sense dodges arrows and bullets.",
    stats: ["Web: 3s snare · Swing: up to 7s, no fall damage · Zip: 40 blocks", "Passive: wall crawl, spider-sense (35% of projectiles miss)", "Sneak + use: Web Bomb, Yank"],
    alts: [{ label: "Web Bomb", sub: "snare everything within 8 blocks", icon: "x_target", act: "web_bomb" }, { label: "Yank", sub: "pull what you look at to you", icon: "form_dash", act: "web_yank" }] },
  telekinesis: { arch: "energy", name: "Telekinesis", icon: "§d", cost: 10, cd: 8,
    desc: "Use at a creature to LIFT it - it floats wherever you look - and use again to THROW it. Use at stone, dirt or wood to tear a chunk out of the ground and hurl it. With nothing to hold, a psychic PUSH blasts everything in front of you away.",
    stats: ["Lift up to 28 blocks away, hold up to 9s · thrown creatures go flying", "Rock: 10 damage + crater · Push: 9 blocks", "Sneak + use: Crush (squeeze what you hold), Levitate (10s)"],
    alts: [{ label: "Crush", sub: "squeeze what you're holding", icon: "fin_shatter", act: "tk_crush" }, { label: "Levitate", sub: "float for 10 seconds", icon: "form_leap", act: "tk_levitate" }] },
  pyrokinesis: { arch: "energy", name: "Pyrokinesis", icon: "§6", cost: 12, cd: 120,
    desc: "Use: a FLAME STREAM for 3.5 seconds - everything it touches catches fire, and so does the ground. Fireballs, novas of flame, and Flame On: wreathed in fire you FLY, nothing burns you and your punches set things alight.",
    stats: ["Flame Stream: 18 blocks, 2 dmg + fire every 0.25s", "Fireball: 10 dmg blast · Flame Nova: 8 dmg ring", "Sneak + use: Fireball, Flame Nova, Flame On (15s of burning flight), Fire Tornado"],
    alts: [{ label: "Fireball", sub: "a blast of fire where it lands", icon: "el_flame", act: "pyro_ball" }, { label: "Flame Nova", sub: "a ring of fire around you", icon: "form_nova", act: "pyro_nova" }, { label: "Flame On", sub: "15s wreathed in fire", icon: "fin_detonate", act: "pyro_on" }] },
  cryokinesis: { arch: "energy", name: "Cryokinesis", icon: "§b", cost: 12, cd: 120,
    desc: "Use: a FROST BEAM for 3.5 seconds - whatever it touches slows, then freezes solid in a block of ice. Water freezes over and lava hardens. Ice Formation splits the ground with a line of crystals; Ice Slide paves an ice road under your feet.",
    stats: ["Frost Beam: 24 blocks · 5 hits = frozen solid for 3.5s", "Ice Formation: 6 eruptions, 8 dmg each, launches", "Sneak + use: Ice Formation, Ice Slide (12s - sneak to drop off your road)"],
    alts: [{ label: "Ice Formation", sub: "crystals erupt in a line", icon: "el_frost", act: "cryo_form" }, { label: "Ice Slide", sub: "an ice road under your feet", icon: "form_dash", act: "cryo_slide" }] },
  blood_manipulation: { arch: "shadow", name: "Blood Manipulation", icon: "§4", cost: 10, cd: 80,
    desc: "Use: BLOOD SPIKES erupt under up to six enemies in front of you and impale them. Piercing Blood fires a compressed beam of blood; the Blood Whip lashes everything around you and takes their blood back into you. Every move costs a little of your own blood - every kill gives some back.",
    stats: ["Spikes: 9 dmg each + bleeding · 16 blocks", "Piercing Blood: 10 dmg a hit, 40 blocks · Whip: 8 dmg, heals you", "Costs 1-2 HP per move (never lethal) · kills heal 2"],
    alts: [{ label: "Piercing Blood", sub: "a compressed blood beam", icon: "form_blast", act: "blood_pierce" }, { label: "Blood Whip", sub: "lash everything, heal yourself", icon: "form_strike", act: "blood_whip" }] },
  graviton: { arch: "shadow", name: "Graviton", icon: "§5", cost: 18, cd: 200,
    desc: "Use: a SINGULARITY tears open where you look - for 4 seconds it drags everything toward it, swallows arrows, then implodes. Uplift floats everything around you helplessly into the air... and slams it into the ground. Gravity Leap throws you skyward and drops you like a meteor.",
    stats: ["Singularity: 11-block pull, 10 dmg implosion", "Uplift: 10 blocks · Gravity Leap: crater on landing", "Passive: half fall damage"],
    alts: [{ label: "Uplift", sub: "float them up, slam them down", icon: "fin_launch", act: "grav_uplift" }, { label: "Gravity Leap", sub: "launch up, land like a meteor", icon: "form_leap", act: "grav_leap" }] },
};
const USE = { web_slinger: webUse, telekinesis: tkUse, pyrokinesis: pyroUse, cryokinesis: cryoUse, blood_manipulation: bloodUse, graviton: gravUse };
const ALT2 = { web_bomb: [webBomb, 15, 300], web_yank: [webYank, 8, 80], tk_crush: [tkCrush, 12, 120], tk_levitate: [tkLevitate, 15, 300], pyro_ball: [fireball, 14, 100],
  pyro_nova: [flameNova, 20, 240], pyro_on: [flameOn, 25, 700], cryo_form: [iceFormation, 18, 200], cryo_slide: [iceSlide, 15, 500], blood_pierce: [piercingBlood, 14, 160], blood_whip: [bloodWhip, 10, 80],
  grav_uplift: [uplift, 18, 300], grav_leap: [gravLeap, 12, 160] };
export const isP2 = (key) => !!P2_DEFS[key];
export const useP2 = (p, key) => USE[key]?.(p) ?? false;
// release / throw / cut a beam: these ignore cooldowns and cost nothing
export function p2Bypass(p, key) {
  const r = RT(p);
  if (key === "web_slinger" && r.web) { releaseWeb(p, true); return true; }
  if (key === "telekinesis" && r.tk) { tkThrow(p); return true; }
  if ((key === "pyrokinesis" || key === "cryokinesis") && beamActive(p, "p2")) { stopBeam(p, "cut"); return true; }
  return false;
}
export async function runAlt2(p, act) {
  const A = ALT2[act];
  if (!A) return false;
  const h = hero(p), r = RT(p), t = now();
  r.altCd ??= {};
  if ((r.altCd[act] ?? 0) > t) { hudMsg(p, `§7Recharging §c${((r.altCd[act] - t) / 20).toFixed(1)}s`, 20); return true; }
  if ((h.energy ?? 0) < A[1]) { hudMsg(p, `§bNot enough Energy §7(${A[1]})`, 30); return true; }
  const res = await A[0](p);
  if (res === false) return true;
  h.energy -= A[1]; r.altCd[act] = t + A[2]; markDirty(p);
  return true;
}
// every tick
export function tickP2() {
  const t = now();
  tickRocks(); tickBalls(); tickHoles(); tickIce(t);
  for (const [id, w] of webbed) {
    if (!valid(w.e) || w.until <= t) { webbed.delete(id); continue; }
    if (t % 3 === 0) fx(w.e.dimension, "origin:web_net", at(w.e.location, 0, (w.e.getHeadLocation().y - w.e.location.y) * 0.6, 0), WHITE, 0.9, { size: 0.7, life: 0.2 });
  }
  for (const p of world.getAllPlayers()) {
    const h = hero(p), r = RT(p);
    if (r.web) tickSwing(p, r);
    if (r.tk) tickHold(p, r);
    if (r.leap) tickLeap(p, r);
    if (!h.awakened) continue;
    if (h.power === "web_slinger") wallCrawl(p, r);
    if (r.iceSlide) tickSlide(p, r, t);
    if ((r.flameOn ?? 0) > t) {
      if (t % 2 === 0) fx(p.dimension, "origin:ember", at(p.location, (Math.random() - 0.5) * 0.8, Math.random() * 1.8, (Math.random() - 0.5) * 0.8), FIRE, 1);
      if (t % 5 === 0) fx(p.dimension, "origin:boom_fire", at(p.location, 0, 0.1, 0), FIRE, 0.4);
      try { p.extinguishFire(); } catch { }
    }
  }
}
// before damage: spider-sense, fire immunity, graviton's light landing - true = handled
export function onP2HurtBefore(ev) {
  const p = ev.hurtEntity;
  if (p?.typeId !== "minecraft:player") return false;
  const h = hero(p), r = RT(p), cause = String(ev.damageSource?.cause ?? "");
  if (!h.awakened) return false;
  if (h.power === "web_slinger" && cause === "projectile" && Math.random() < 0.35) {
    ev.cancel = true;
    system.run(() => {
      if (!valid(p)) return;
      const f = V.flat(p.getViewDirection()), s = Math.random() < 0.5 ? 1 : -1, hd = p.getHeadLocation();
      try { p.applyKnockback({ x: -f.z * s * 0.6, z: f.x * s * 0.6 }, 0.25); } catch { }
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; fx(p.dimension, "origin:streak", at(hd, Math.cos(a) * 0.35, 0.25 + Math.sin(a) * 0.2, Math.sin(a) * 0.35), k % 2 ? rgb(1, 0.2, 0.2) : WHITE, 0.9, { dx: Math.cos(a), dy: 0.4, dz: Math.sin(a), len: 0.35, w: 0.03, spd: 1.5, life: 0.18 }); }
      psound(p, "random.orb", 2, 0.4);
      hudMsg(p, "§c( §fspider-sense §c)", 15);
    });
    return true;
  }
  if ((r.flameOn ?? 0) > now() && /fire|lava|magma/i.test(cause)) { ev.cancel = true; return true; }
  if (h.power === "graviton" && cause === "fall") { ev.damage = ev.damage / 2; return false; }
  return false;
}
export function onP2Melee(p, target) {
  if (!valid(target)) return;
  if ((RT(p).flameOn ?? 0) > now()) { try { target.setOnFire(5, true); } catch { } hurt(target, 3, p); fx(p.dimension, "origin:boom_fire", target.getHeadLocation(), FIRE, 0.7); }
}
export function onP2Kill(killer, deadE) {
  if (killer?.typeId !== "minecraft:player" || !valid(killer)) return;
  const h = hero(killer);
  if (!h.awakened || h.power !== "blood_manipulation" || deadE?.typeId === "minecraft:player") return;
  heal(killer, 2);
  try { const d = V.norm(V.sub(killer.location, deadE.location)); fx(killer.dimension, "origin:streak", at(deadE.location, 0, 1, 0), BLOOD, 0.9, { dx: d.x, dy: d.y, dz: d.z, len: 0.3, w: 0.05, spd: 6, life: 0.4 }); } catch { }
}
export function p2Line(p) {
  const h = hero(p), r = RT(p), t = now();
  if (!P2_DEFS[h.power]) return null;
  if (r.web) return " §fSWINGING";
  if (r.tk) return r.tk.crush ? " §5§lCRUSHING" : " §dHOLDING";
  if (beamActive(p, "p2")) return " §6§lFIRING";
  if ((r.flameOn ?? 0) > t) return ` §6FLAME ON ${Math.ceil((r.flameOn - t) / 20)}s`;
  if ((r.iceSlide ?? 0) > t) return ` §bSLIDE ${Math.ceil((r.iceSlide - t) / 20)}s`;
  return null;
}
