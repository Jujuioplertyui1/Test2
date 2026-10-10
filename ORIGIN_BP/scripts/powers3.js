// ORIGIN v0.22 - powers3.js
// The power overhaul: every power gets new moves (Power menu: sneak + use) and a better main move, with real models -
// chains, web lines, a stretching rubber arm, shadow tendrils, shadow clones, a clock rune - and new body animations.
// Plus a new Shadow power: HELLFIRE (a burning chain in your arm).
//
//   STRETCH       main: the arm really stretches out (a rubber arm model) to grab or sling · Gatling · Rubber Rocket
//                 passive: Rubber Body - falls bounce you instead of hurting, some arrows bounce off
//   FLIGHT        Sonic Ram (fists first through everything) · Meteor Dive (straight down, crater)
//   TITAN GRIP    main: hoist overhead, then throw · Piledriver · Giant Swing
//   SUPER SPEED   Speed Tornado · Lightning Throw  (+ lightning crackling off you at full speed, a sprinter's lean)
//   SUPER STRENGTH  Thunderclap · Hulk Leap
//   SUPER DURABILITY  Seismic Stomp · Bulwark (reflects arrows, unmovable)
//   REGENERATION  Berserker
//   BLAST         eyes charge before they fire · Sweep (a 120° cutting sweep) · Overcharge (a huge beam)
//   SENTRY        Banish now opens a void portal and chains drag them under · Void Chains · Sunburst
//   MIRROR HOUR   a clock rune on the ground, hands running backwards · Still Hour (stop time around you)
//   ARC STORM     real forked lightning, stuns, +50% on anything wet · Thunder Call · Arc Dash
//   SHADOW STEP   shadow portals, a shadow left where you stood, a cheap follow-up step · Shadow Strike
//   SHADE FORM    trailing shadow · Night Terror · Shadow Meld
//   TENDRILS      real tendrils burst out of the ground and lash · Tendril Grab · Abyss Field
//   UMBRAL CLONES real shadow clones step out behind enemies and cut them · Shadow Army
//   + new moves for the v0.21 powers: Web Cocoon · Debris Orbit · Fire Tornado · Ice Wall · Blood Chains · Gravity Crush
//   HELLFIRE (new) main: Chain Lash (hook and drag, or haul yourself) · Penance Stare · Chain Whirl · Hell Shackle
//                 passive: fire can't hurt you, your punches ignite, your head burns while you fight
import { world, system, BlockPermutation } from "@minecraft/server";
import { hero, RT, markDirty } from "./data.js";
import { V, at, valid, fx, sound, psound, now, health, C, isSolidBlock, FX_IDS, hexToRgb } from "./util.js";
import { hudMsg } from "./voice.js";
import { startBeam, stopBeam, beamActive, drawBeam, flashBeam, STYLES, tinted } from "./beams.js";
import { heavyLaunch, crater, destructionOn } from "./impact.js";
import { bleed, goreBurst, groundUnder } from "./gorefx.js";
import { slashArc, burst, cutLine, vortex, trailLine } from "./slashfx.js";
import { isFlying, stopFlight, flightOverride } from "./flight.js";
import { tether, cocoon, singularity, tendrilAt, clockRune } from "./models.js";
import { landAnim } from "./fall.js";
import { placeTemp } from "./tempblocks.js";
import { dmg, isDark, beginFlight } from "./powers.js";   // (circular import: only used inside functions)
import { weatherNow } from "./jarvis.js";

// ------------------------------------------------------------------ helpers
const rgb = (r, g, b) => ({ red: r, green: g, blue: b });
const WHITE = rgb(1, 1, 1), TAN = hexToRgb("#e8b48a"), VOIDC = hexToRgb("#7a3cff"), SHADE = hexToRgb("#2a1640"), GOLD = hexToRgb("#ffd36a"), HELL = rgb(1, 0.45, 0.08),
  BLUE = rgb(0.55, 0.8, 1), YEL = rgb(1, 0.85, 0.3), RED = rgb(1, 0.15, 0.1), ICE = rgb(0.5, 0.82, 1), BLOOD = rgb(0.62, 0.02, 0.04), PSY = rgb(0.78, 0.38, 1), FIRE = rgb(1, 0.42, 0.08), DUST = rgb(0.78, 0.72, 0.62);
const SKIP = new Set([...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "origin:exo_drone", "origin:static_echo"]);
const canHit = (e, p) => valid(e) && e.id !== p?.id && !SKIP.has(e.typeId) && !!health(e);
const foes = (p, c, r) => { try { return p.dimension.getEntities({ location: c, maxDistance: r }).filter((e) => canHit(e, p)); } catch { return []; } };
// area moves leave other players alone unless they've been fighting you
const pvp = (p, e) => (RT(p).pvpFoes?.[e.id] ?? 0) > now();
const area = (p, c, r) => foes(p, c, r).filter((e) => e.typeId !== "minecraft:player" || pvp(p, e));
const lookE = (p, d) => { try { return p.getEntitiesFromViewDirection({ maxDistance: d }).map((h) => h.entity).find((e) => canHit(e, p)) ?? null; } catch { return null; } };
const lookB = (p, d) => { try { const h = p.getBlockFromViewDirection({ maxDistance: d, includePassableBlocks: false }); return h ? { block: h.block, face: h.face, pt: V.add(h.block.location, h.faceLocation) } : null; } catch { return null; } };
const play = (p, a, ctl = "origin_p3") => { try { p.playAnimation(a, { controller: ctl, stopExpression: "0", blendOutTime: 0.15 }); } catch { } };
const clear = (p, ctl = "origin_p3") => { try { p.playAnimation("animation.origin.clear", { controller: ctl, stopExpression: "1", blendOutTime: 0.2 }); } catch { } };
const shake = (p, a, t) => { try { p.runCommand(`camerashake add @s ${a} ${t} positional`); } catch { } };
const shakeNear = (dim, c, r, a) => { try { for (const q of dim.getPlayers({ location: c, maxDistance: r })) shake(q, a, 0.35); } catch { } };
const heal = (p, n) => { try { const hc = p.getComponent("minecraft:health"); hc.setCurrentValue(Math.min(hc.effectiveMax, hc.currentValue + n)); } catch { } };
const pin = (e, ticks, amp = 255) => { try { e.addEffect("slowness", ticks, { amplifier: amp, showParticles: false }); e.addEffect("weakness", ticks, { amplifier: 2, showParticles: false }); } catch { } };
const stun = (e, ticks) => pin(e, ticks, 255);
const knock = (e, d, h, v) => { try { const f = V.flat(d); e.applyKnockback({ x: f.x * h, z: f.z * h }, v); } catch { } };
const fire = (e, s) => { try { e.setOnFire(s, true); } catch { } };
const mid = (e) => { try { const l = e.location, h = e.getHeadLocation(); return { x: l.x, y: l.y + (h.y - l.y) * 0.62, z: l.z }; } catch { return null; } };
const handPos = (p, side = 1) => { const h = p.getHeadLocation(), d = p.getViewDirection(), l = Math.hypot(d.x, d.z) || 1; return { x: h.x - (d.z / l) * 0.38 * side + d.x * 0.6, y: h.y - 0.42 + d.y * 0.4, z: h.z + (d.x / l) * 0.38 * side + d.z * 0.6 }; };
const shoulder = (p, side = 1) => { const h = p.getHeadLocation(), d = V.flat(p.getViewDirection()); return { x: h.x - d.z * 0.36 * side + d.x * 0.12, y: h.y - 0.36, z: h.z + d.x * 0.36 * side + d.z * 0.12 }; };
const groundAt = (dim, l) => { const y = groundUnder(dim, at(l, 0, 1.5, 0)); return y === null ? l.y : y - 0.02; };
const rot = (v, deg) => { const a = (deg * Math.PI) / 180; return { x: v.x * Math.cos(a) - v.z * Math.sin(a), y: v.y, z: v.x * Math.sin(a) + v.z * Math.cos(a) }; };
const inCone = (p, e, deg, r) => { const f = V.flat(p.getViewDirection()), d = V.sub(e.location, p.location), l = Math.hypot(d.x, d.z) || 1; return l <= r && (d.x * f.x + d.z * f.z) / l >= Math.cos((deg * Math.PI) / 360); };
const near = (a, b) => V.dist(a.location, b.location);
const dead = (p) => { try { return p.getComponent("minecraft:health").currentValue <= 0; } catch { return false; } };
function safeSpot(dim, loc) {
  const free = (l) => { try { const b = dim.getBlock(l); return !b || b.isAir || b.isLiquid || !isSolidBlock(b); } catch { return true; } };
  for (let dy = 0; dy <= 3; dy++) { const l = { x: loc.x, y: Math.floor(loc.y) + dy, z: loc.z }; if (free(l) && free(at(l, 0, 1, 0))) return l; }
  return null;
}
function spawnE(dim, id, loc, life, yaw) {
  try { const e = dim.spawnEntity(id, loc); if (yaw !== undefined) e.teleport(loc, { rotation: { x: 0, y: yaw } }); if (life) system.runTimeout(() => { try { e.remove(); } catch { } }, life); return e; } catch { return null; }
}
const yawOf = (v) => (Math.atan2(-v.x, v.z) * 180) / Math.PI;
const hitOnce = (set, e) => { if (set.has(e.id)) return false; set.add(e.id); return true; };

// ------------------------------------------------------------------ lightning: a jagged, forking bolt drawn with the beam renderer
const BOLT = { core: WHITE, glow: rgb(0.55, 0.8, 1), width: 0.1, coreW: 0.03, flare: 0.3, impact: 0.55, glowA: 0.85 };
const SPEED_BOLT = { core: rgb(1, 1, 0.85), glow: YEL, width: 0.09, coreW: 0.028, flare: 0.25, impact: 0.5, glowA: 0.85 };
function perps(u) {
  const a = Math.abs(u.y) < 0.95 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const p1 = V.norm({ x: u.y * a.z - u.z * a.y, y: u.z * a.x - u.x * a.z, z: u.x * a.y - u.y * a.x });
  return [p1, { x: u.y * p1.z - u.z * p1.y, y: u.z * p1.x - u.x * p1.z, z: u.x * p1.y - u.y * p1.x }];
}
export function bolt(dim, a, b, style = BOLT, o = {}) {
  const d = V.sub(b, a), L = V.len(d);
  if (L < 0.2) return;
  const n = Math.max(3, Math.min(16, Math.round(L / 1.3))), u = V.mul(d, 1 / L), [p1, p2] = perps(u), amp = o.amp ?? Math.min(1.1, 0.22 + L * 0.07), life = o.life ?? 0.2;
  let prev = a;
  for (let i = 1; i <= n; i++) {
    let q = V.add(a, V.mul(d, i / n));
    if (i < n) q = V.add(q, V.add(V.mul(p1, (Math.random() - 0.5) * 2 * amp), V.mul(p2, (Math.random() - 0.5) * 2 * amp)));
    drawBeam(dim, prev, q, style, now(), { life, seg: 4 });
    if (o.fork !== false && i < n && Math.random() < 0.28) {
      const fd = V.norm(V.add(u, V.add(V.mul(p1, (Math.random() - 0.5) * 2.4), V.mul(p2, (Math.random() - 0.5) * 2.4))));
      drawBeam(dim, q, V.add(q, V.mul(fd, 0.5 + Math.random() * 1.3)), { ...style, width: style.width * 0.55, coreW: style.coreW * 0.55 }, now(), { life: life * 0.8, seg: 4 });
    }
    prev = q;
  }
  fx(dim, "origin:beam_flare", b, style.glow, 1, { size: style.impact, life: 0.16 });
  fx(dim, "origin:beam_flare", a, style.glow, 0.9, { size: style.flare, life: 0.12 });
}
// in water, or out in the rain (overworld, nothing overhead)
const wet = (e) => { try { if (e.isInWater) return true; const w = weatherNow(); return /rain|thunder/i.test(w) && e.dimension.id === "minecraft:overworld" && !e.dimension.getBlockAbove(e.location); } catch { return false; } };

// ================================================================== STRETCH
function stretchMain(p) {
  const dim = p.dimension, e = lookE(p, 16);
  play(p, "animation.origin.pose.point");
  if (e) {
    tether(dim, () => shoulder(p, 1), e, "rubber", { life: 13, grow: 3, shrink: 6 });
    sound(dim, "mob.slime.big", p.location, 1.6, 0.9); sound(dim, "origin.sfx.swoosh", p.location, 1.1, 0.7);
    system.runTimeout(() => {
      if (!valid(p) || !valid(e)) return;
      dmg(e, 6, p);
      fx(dim, "origin:impact", e.getHeadLocation(), TAN, 1, { size: 1.2 });
      sound(dim, "mob.slime.attack", e.location, 1.2, 1);
      const d = V.sub(p.location, e.location), dist = V.hdist(p.location, e.location);
      knock(e, d, Math.min(2.6, 0.4 + dist * 0.19), 0.4);
    }, 3);
    return { cost: 12, cd: 80 };
  }
  const b = lookB(p, 18);
  if (!b) { hudMsg(p, "§7Nothing to grab.", 20); return false; }
  tether(dim, () => shoulder(p, 1), b.pt, "rubber", { life: 18, grow: 3, shrink: 9 });
  sound(dim, "mob.slime.big", p.location, 1.3, 0.9);
  system.runTimeout(() => {
    if (!valid(p)) return;
    const d = V.sub(b.pt, p.location), dist = Math.hypot(d.x, d.z), f = V.flat(d);
    try { p.applyKnockback({ x: f.x * Math.min(3.4, 0.6 + dist * 0.23), z: f.z * Math.min(3.4, 0.6 + dist * 0.23) }, Math.max(0.45, Math.min(1.5, 0.5 + d.y * 0.13))); } catch { }
    RT(p).flyGrace = now() + 60;
    sound(dim, "origin.sfx.swoosh", p.location, 1.4, 0.9);
  }, 3);
  return { cost: 12, cd: 80 };
}
function gatling(p) {
  const dim = p.dimension;
  let e = lookE(p, 9), k = 0;
  play(p, "animation.origin.pose.gatling");
  hudMsg(p, "§6§lGATLING", 20);
  const id = system.runInterval(() => {
    if (!valid(p) || ++k > 28 || RT(p).cine || dead(p)) { system.clearRun(id); if (valid(p)) clear(p); return; }
    if (k % 2) return;
    if (!valid(e)) e = lookE(p, 9);
    const side = (k / 2) % 2 ? 1 : -1, head = p.getHeadLocation(), dir = p.getViewDirection();
    const aim = (e && mid(e)) || V.add(head, V.mul(dir, 6)), hitAt = at(aim, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.7);
    tether(dim, () => shoulder(p, side), hitAt, "rubber", { life: 3, grow: 1, shrink: 1 });
    sound(dim, "origin.sfx.punch", hitAt, 1.2 + Math.random() * 0.4, 0.5);
    fx(dim, "origin:impact", hitAt, TAN, 0.9, { size: 0.65 });
    if (e && valid(e)) { dmg(e, 1.5, p); knock(e, dir, 0.08, 0.02); if (k === 28) heavyLaunch(e, V.flat(dir), 1, p); }
    else for (const f of area(p, V.add(head, V.mul(dir, 4)), 2.4)) dmg(f, 1.5, p);
  }, 1);
  return true;
}
function rubberRocket(p) {
  const dim = p.dimension, b = lookB(p, 16);
  play(p, "animation.origin.pose.slingback");
  try { p.addEffect("slowness", 12, { amplifier: 4, showParticles: false }); } catch { }
  if (b) for (const sd of [1, -1]) tether(dim, () => shoulder(p, sd), b.pt, "rubber", { life: 14, grow: 3, shrink: 3 });
  sound(dim, "mob.slime.big", p.location, 0.7, 1);
  for (let i = 1; i <= 3; i++) system.runTimeout(() => valid(p) && sound(dim, "mob.slime.small", p.location, 0.6 + i * 0.15, 0.6), i * 3);
  system.runTimeout(() => {
    if (!valid(p)) return;
    clear(p);
    const d = b ? V.norm(V.sub(b.pt, p.location)) : p.getViewDirection(), f = V.flat(d);
    try { p.applyKnockback({ x: f.x * 3.4, z: f.z * 3.4 }, Math.max(0.5, Math.min(1.6, 0.55 + d.y * 1.4))); } catch { }
    const r = RT(p);
    r.flyGrace = now() + 80;
    r.rocket = { until: now() + 16, dir: f, hit: new Set() };
    fx(dim, "origin:beam_ring", at(p.location, 0, 1, 0), WHITE, 1, { dx: f.x, dy: 0, dz: f.z, size: 2, life: 0.3 });
    sound(dim, "origin.sfx.windblast", p.location, 1.1, 1); sound(dim, "mob.slime.big", p.location, 1.5, 1);
    hudMsg(p, "§6§lRUBBER ROCKET", 20);
  }, 12);
  return true;
}
function rubberBounce(p, dmgIn) {
  if (!valid(p)) return;
  const dim = p.dimension;
  fx(dim, "origin:ground_ring", at(p.location, 0, 0.08, 0), TAN, 0.9, { size: 2.5 });
  sound(dim, "mob.slime.big", p.location, 0.8 + Math.random() * 0.3, 1);
  landAnim(p, "crouch", 0.1);
  if (p.isSneaking || dmgIn < 2) return;   // sneak to land without bouncing
  try { p.applyKnockback({ x: 0, z: 0 }, Math.min(1.5, 0.35 + dmgIn * 0.06)); } catch { }
  RT(p).flyGrace = now() + 60;
}

// ================================================================== FLIGHT
function sonicRam(p) {
  if (!isFlying(p) && !beginFlight(p)) { hudMsg(p, "§7Take off first.", 30); return false; }
  const r = RT(p), dir = p.getViewDirection();
  r.ram = { until: now() + 26, hit: new Set() };
  flightOverride(p, V.mul(dir, 2.5), 26, "animation.origin.fly.ram");
  fx(p.dimension, "origin:beam_ring", at(p.location, dir.x * 2, 1 + dir.y * 2, dir.z * 2), WHITE, 1, { dx: dir.x, dy: dir.y, dz: dir.z, size: 3.5, life: 0.4 });
  sound(p.dimension, "mob.warden.sonic_boom", p.location, 0.9, 0.7); sound(p.dimension, "origin.sfx.windblast", p.location, 0.8, 1);
  shake(p, 0.3, 0.3);
  hudMsg(p, "§6§lSONIC RAM", 20);
  return true;
}
function tickRam(p, r, t) {
  const f = r.fly;
  if (!f || t > r.ram.until) { r.ram = null; return; }
  const dir = p.getViewDirection();
  if (f.force) f.force.v = V.mul(dir, 2.5);
  const dim = p.dimension, front = at(p.location, dir.x * 1.4, 0.9 + dir.y * 1.4, dir.z * 1.4);
  if (t % 4 === 0) fx(dim, "origin:beam_ring", front, WHITE, 0.8, { dx: dir.x, dy: dir.y, dz: dir.z, size: 2.2, life: 0.25 });
  if (t % 2 === 0) fx(dim, "origin:streak", front, WHITE, 0.6, { dx: -dir.x, dy: -dir.y, dz: -dir.z, len: 1.6, w: 0.06, spd: 0.4, life: 0.2 });
  for (const e of area(p, front, 2.4)) {
    if (!hitOnce(r.ram.hit, e)) continue;
    dmg(e, 12, p); heavyLaunch(e, dir, 2, p); burst(dim, mid(e) ?? front, dir, { n: 12, size: 0.9 });
    sound(dim, "origin.sfx.heavyhit", e.location, 0.8, 1); shake(p, 0.35, 0.25);
  }
  if (destructionOn() && t % 2 === 0) for (const dy of [0, 1]) { try { const b = dim.getBlock(at(front, 0, dy - 0.5, 0)); if (b && /leaves|glass|_pane/.test(b.typeId)) { b.setType("minecraft:air"); fx(dim, "origin:debris", b.location, DUST, 0.8); } } catch { } }
}
function meteorDive(p) {
  const r = RT(p);
  if (p.isOnGround && !isFlying(p)) {   // from the ground: up first
    try { p.applyKnockback({ x: 0, z: 0 }, 2.5); } catch { }
    play(p, "animation.origin.pose.leap");
    r.meteor = { phase: "up", t: 0 };
    r.flyGrace = now() + 200;
    sound(p.dimension, "origin.sfx.windblast", p.location, 0.7, 1);
    return true;
  }
  if (isFlying(p)) stopFlight(p, "dive");
  r.meteor = { phase: "down", t: 0 };
  r.flyGrace = now() + 200;
  sound(p.dimension, "mob.ghast.fireball", p.location, 0.6, 1);
  return true;
}
function tickMeteor(p, r) {
  const m = r.meteor, dim = p.dimension;
  if (++m.t > 140 || dead(p)) { r.meteor = null; clear(p); return; }
  if (m.phase === "up") { if (m.t >= 12) { m.phase = "down"; m.t = 0; } return; }
  const f = V.flat(p.getViewDirection());
  try { p.applyKnockback({ x: f.x * 0.25, z: f.z * 0.25 }, -2.6); } catch { }
  r.flyGrace = now() + 40;
  fx(dim, "origin:boom_fire", at(p.location, 0, 1.2, 0), FIRE, 0.7);
  fx(dim, "origin:streak", at(p.location, 0, 2, 0), rgb(1, 0.75, 0.3), 0.9, { dx: 0, dy: 1, dz: 0, len: 2.2, w: 0.12, spd: 0.3, life: 0.25 });
  if (!p.isOnGround || m.t < 2) return;
  r.meteor = null;
  clear(p);
  const L = p.location;
  crater(dim, L, 2);
  fx(dim, "origin:shockwave", at(L, 0, 0.1, 0), FIRE, 1, { radius: 7 }); fx(dim, "origin:flash", at(L, 0, 0.5, 0), rgb(1, 0.8, 0.5), 1, { size: 5 });
  for (let k = 0; k < 4; k++) fx(dim, "origin:boom_fire", at(L, (Math.random() - 0.5) * 3, 0.4, (Math.random() - 0.5) * 3), FIRE, 1);
  sound(dim, "origin.sfx.explode", L, 0.7, 1); sound(dim, "random.explode", L, 0.6, 0.8);
  shakeNear(dim, L, 30, 0.6);
  landAnim(p, "hero");
  for (const e of area(p, L, 7)) { const d = near(e, p); dmg(e, Math.max(4, 14 * (1 - d / 9)), p); heavyLaunch(e, V.sub(e.location, L), d < 3.5 ? 2 : 1, p); }
}

// ================================================================== TITAN GRIP
function titanMain(p) {
  const e = lookE(p, 6);
  if (!e) { hudMsg(p, "§7Nothing in reach to grab.", 30); return false; }
  return grip(p, e, "lift");
}
function grip(p, e, mode) {
  if (RT(p).grip) return false;
  dmg(e, 5, p);
  play(p, "animation.origin.strength.carry", "origin_carry");
  sound(p.dimension, "origin.sfx.heavyhit", p.location, 0.8, 1);
  RT(p).grip = { e, t: 0, mode, hit: new Set(), ang: (p.getRotation().y * Math.PI) / 180 };
  if (mode === "pile") { try { p.applyKnockback({ x: 0, z: 0 }, 1.25); } catch { } RT(p).flyGrace = now() + 80; }
  if (mode === "swing") play(p, "animation.origin.pose.spin");
  return true;
}
function tickGrip(p, r) {
  const g = r.grip, e = g.e, dim = p.dimension;
  if (!valid(e) || dead(p) || r.cine) { r.grip = null; clear(p, "origin_carry"); return; }
  g.t++;
  const f = V.flat(p.getViewDirection());
  if (g.mode === "lift") {
    try { e.teleport(at(p.location, f.x * 0.2, 2.3, f.z * 0.2)); } catch { }
    pin(e, 4);
    if (g.t < 14) return;
    r.grip = null;
    play(p, "animation.origin.strength.throw", "origin_carry");
    sound(dim, "origin.sfx.windblast", p.location, 0.8, 1);
    fx(dim, "origin:shockwave", at(p.location, 0, 0.1, 0), WHITE, 1, { radius: 2 });
    dmg(e, 6, p); heavyLaunch(e, p.getViewDirection(), 2, p);
  } else if (g.mode === "pile") {
    try { e.teleport(at(p.location, f.x * 0.2, 2.2, f.z * 0.2)); } catch { }
    pin(e, 4);
    if (g.t < 11) return;
    r.grip = null;
    clear(p, "origin_carry");
    const spot = at(p.location, f.x * 1.4, 0, f.z * 1.4); spot.y = groundAt(dim, spot);
    try { e.teleport(spot); } catch { }
    try { p.applyKnockback({ x: 0, z: 0 }, -1.6); } catch { }
    play(p, "animation.origin.pose.claw");
    crater(dim, spot, 2);
    fx(dim, "origin:shockwave", at(spot, 0, 0.1, 0), WHITE, 1, { radius: 5 }); fx(dim, "origin:ground_ring", at(spot, 0, 0.08, 0), DUST, 1, { size: 8 });
    sound(dim, "origin.sfx.crush", spot, 0.7, 1); sound(dim, "origin.sfx.bonecrack", spot, 0.8, 1);
    shakeNear(dim, spot, 24, 0.5);
    dmg(e, 14, p); goreBurst(e, 2); stun(e, 30);
    for (const o of area(p, spot, 4.5)) if (o.id !== e.id) { dmg(o, 6, p); knock(o, V.sub(o.location, spot), 1, 0.5); }
    hudMsg(p, "§6§lPILEDRIVER", 25);
  } else if (g.mode === "swing") {
    g.ang += 0.45;
    const c = at(p.location, -Math.sin(g.ang) * 2.4, 1.0, Math.cos(g.ang) * 2.4);
    try { e.teleport(c); } catch { }
    pin(e, 4);
    if (g.t % 12 === 0) play(p, "animation.origin.pose.spin");
    if (g.t % 2 === 0) trailLine(dim, at(c, Math.cos(g.ang) * 0.6, 0, Math.sin(g.ang) * 0.6), c, WHITE, { size: 0.35, life: 0.5 });
    for (const o of area(p, c, 1.8)) if (o.id !== e.id && hitOnce(g.hit, o)) { dmg(o, 5, p); knock(o, V.sub(o.location, p.location), 1.6, 0.5); sound(dim, "origin.sfx.punch", o.location, 0.8, 1); }
    if (g.t < 32) return;
    r.grip = null;
    clear(p, "origin_carry");
    const tang = { x: -Math.cos(g.ang), y: 0, z: -Math.sin(g.ang) };
    heavyLaunch(e, V.add(V.mul(tang, 0.4), V.mul(f, 0.6)), 2, p); dmg(e, 8, p);
    sound(dim, "origin.sfx.windblast", p.location, 0.7, 1);
    hudMsg(p, "§6§lGIANT SWING", 20);
  }
}
const piledriver = (p) => { const e = lookE(p, 6); if (!e) { hudMsg(p, "§7Nothing in reach to grab.", 30); return false; } return grip(p, e, "pile"); };
const giantSwing = (p) => { const e = lookE(p, 6); if (!e) { hudMsg(p, "§7Nothing in reach to grab.", 30); return false; } return grip(p, e, "swing"); };

// ================================================================== SUPER SPEED
function speedTornado(p) {
  const r = RT(p);
  r.tornado = { t: 0, c: { ...p.location }, hit: new Map() };
  try { p.addEffect("slowness", 64, { amplifier: 255, showParticles: false }); } catch { }
  sound(p.dimension, "origin.sfx.windblast", p.location, 0.6, 1);
  hudMsg(p, "§b§lSPEED TORNADO", 30);
  return true;
}
function tickTornado(p, r, t) {
  const T = r.tornado, dim = p.dimension, c = T.c;
  if (++T.t > 60 || dead(p)) {
    r.tornado = null;
    for (const e of area(p, c, 9)) { dmg(e, 4, p); heavyLaunch(e, V.sub(e.location, c), 1, p); }
    fx(dim, "origin:shockwave", at(c, 0, 0.1, 0), BLUE, 1, { radius: 7 });
    return;
  }
  const a = T.t * 0.9;
  if (T.t % 12 === 1) play(p, "animation.origin.pose.spin");
  for (let k = 0; k < 3; k++) {   // you, running the circle: afterimages and ribbons
    const ang = a + (k * Math.PI * 2) / 3, pt = at(c, Math.cos(ang) * 2.8, 0, Math.sin(ang) * 2.8), nx = at(c, Math.cos(ang + 0.5) * 2.8, 0, Math.sin(ang + 0.5) * 2.8);
    trailLine(dim, at(pt, 0, 1, 0), at(nx, 0, 1, 0), BLUE, { size: 0.3, life: 0.5, alpha: 0.9 });
    if (T.t % 3 === k) spawnE(dim, "origin:afterimage", pt, 4, yawOf({ x: -Math.sin(ang), z: Math.cos(ang) }) + 90);
  }
  for (let h = 0; h < 6; h++) { const ang = -a * 1.3 + h; fx(dim, "origin:streak", at(c, Math.cos(ang) * (1 + h * 0.5), h * 1.1, Math.sin(ang) * (1 + h * 0.5)), WHITE, 0.5, { dx: -Math.sin(ang), dy: 0.2, dz: Math.cos(ang), len: 1.1, w: 0.05, spd: 0.4, life: 0.25 }); }
  if (T.t % 4 === 0) {
    for (const e of area(p, c, 8)) {
      const d = V.sub(c, e.location), l = Math.hypot(d.x, d.z) || 1;
      try { e.applyKnockback({ x: (d.x / l) * 0.35 - (d.z / l) * 0.45, z: (d.z / l) * 0.35 + (d.x / l) * 0.45 }, 0.32); } catch { }
      if (T.t % 8 === 0) dmg(e, 1.5, p);
    }
  }
  if (T.t % 10 === 0) sound(dim, "origin.sfx.wind", c, 1.4, 0.8);
}
function lightningThrow(p) {
  const r = RT(p), dim = p.dimension, e = lookE(p, 28), head = p.getHeadLocation(), dir = p.getViewDirection();
  play(p, "animation.origin.pose.throw");
  const charged = (r.fastUntil ?? 0) > now() || (r.spd ?? 0) > 1.1;
  const b = e ? null : lookB(p, 28);
  const end = (e && mid(e)) || (b ? b.pt : V.add(head, V.mul(dir, 28)));
  const hand = handPos(p, 1);
  for (let k = 0; k < (charged ? 3 : 2); k++) bolt(dim, hand, end, SPEED_BOLT, { life: 0.3 });
  fx(dim, "origin:flash", end, YEL, 1, { size: charged ? 3 : 2 });
  sound(dim, "origin.sfx.thunderhit", end, 1.2, 1); sound(dim, "origin.sfx.shock", p.location, 1.2, 0.8);
  if (e) { dmg(e, charged ? 20 : 13, p); stun(e, 30); heavyLaunch(e, dir, charged ? 2 : 1, p); }
  hudMsg(p, charged ? "§e§lLIGHTNING THROW §r§7- Speed Force charged" : "§e§lLIGHTNING THROW §r§8(run first to charge it)", 30);
  return true;
}

// ================================================================== SUPER STRENGTH
function thunderclap(p) {
  const dim = p.dimension, f = V.flat(p.getViewDirection());
  play(p, "animation.origin.pose.clap");
  system.runTimeout(() => {
    if (!valid(p)) return;
    const c = at(p.location, f.x * 1.2, 1.3, f.z * 1.2);
    fx(dim, "origin:flash", c, WHITE, 1, { size: 2 });
    for (let k = 0; k < 5; k++) system.runTimeout(() => fx(dim, "origin:beam_ring", at(c, f.x * k * 2.2, 0, f.z * k * 2.2), WHITE, 0.9 - k * 0.12, { dx: f.x, dy: 0, dz: f.z, size: 2 + k * 1.3, life: 0.35 }), k);
    for (let k = 0; k < 10; k++) fx(dim, "origin:dust", at(p.location, f.x * (2 + k), 0.2, f.z * (2 + k)), DUST, 0.9);
    sound(dim, "origin.sfx.explode", c, 1.3, 1); sound(dim, "mob.warden.sonic_boom", c, 1.2, 0.8);
    shakeNear(dim, c, 30, 0.5);
    for (const e of area(p, p.location, 13)) {
      if (!inCone(p, e, 75, 13)) continue;
      const d = near(e, p);
      dmg(e, d < 5 ? 10 : 7, p); heavyLaunch(e, f, d < 5 ? 2 : 1, p);
      if (e.typeId === "minecraft:player") { try { e.addEffect("nausea", 100); e.addEffect("slowness", 40, { amplifier: 1 }); } catch { } }
    }
    if (destructionOn()) for (let s = 2; s <= 12; s++) for (const w of [-1, 0, 1]) for (const dy of [0, 1, 2]) {
      try { const b = dim.getBlock(at(p.location, f.x * s - f.z * w * (s / 4), dy, f.z * s + f.x * w * (s / 4))); if (b && /leaves|glass|_pane|short_grass|tall_grass|flower/.test(b.typeId)) b.setType("minecraft:air"); } catch { }
    }
  }, 3);
  return true;
}
function hulkLeap(p) {
  const r = RT(p), dim = p.dimension;
  if (!p.isOnGround) { hudMsg(p, "§7You need the ground to push off.", 30); return false; }
  play(p, "animation.origin.pose.charge");
  try { p.addEffect("slowness", 9, { amplifier: 255, showParticles: false }); } catch { }
  fx(dim, "origin:dust", p.location, DUST, 1);
  sound(dim, "origin.sfx.powerup", p.location, 0.7, 0.8);
  system.runTimeout(() => {
    if (!valid(p)) return;
    const f = V.flat(p.getViewDirection());
    play(p, "animation.origin.pose.leap");
    try { p.applyKnockback({ x: f.x * 2.6, z: f.z * 2.6 }, 1.65); } catch { }
    crater(dim, p.location, 1);
    fx(dim, "origin:shockwave", at(p.location, 0, 0.1, 0), WHITE, 1, { radius: 3 });
    sound(dim, "origin.sfx.stonecrash", p.location, 0.7, 1);
    r.flyGrace = now() + 220;
    r.leapS = { t: 0 };
  }, 8);
  return true;
}
function tickLeapS(p, r) {
  const L = r.leapS;
  if (++L.t > 160 || dead(p)) { r.leapS = null; clear(p); return; }
  if (L.t % 2 === 0) trailLine(p.dimension, at(p.location, 0, 0.5, 0), at(p.location, 0, 1.4, 0), WHITE, { size: 0.3, life: 0.6 });
  if (L.t < 8 || !p.isOnGround) return;
  r.leapS = null;
  clear(p);
  const dim = p.dimension, c = p.location;
  crater(dim, c, 2);
  fx(dim, "origin:shockwave", at(c, 0, 0.1, 0), WHITE, 1, { radius: 6 }); fx(dim, "origin:ground_ring", at(c, 0, 0.08, 0), DUST, 1, { size: 9 });
  sound(dim, "origin.sfx.crush", c, 0.6, 1); sound(dim, "random.explode", c, 0.6, 0.6);
  shakeNear(dim, c, 28, 0.55);
  for (const e of area(p, c, 6)) { dmg(e, 10, p); heavyLaunch(e, V.sub(e.location, c), 1, p); }
}

// ================================================================== SUPER DURABILITY
function seismicStomp(p) {
  const r = RT(p), dim = p.dimension, force = r.kin ?? 0;
  play(p, "animation.origin.pose.stomp");
  system.runTimeout(() => {
    if (!valid(p)) return;
    const c = { ...p.location }, extra = force * 0.12;
    r.kin = force / 2;
    sound(dim, "origin.sfx.stonecrash", c, 0.6, 1); sound(dim, "origin.sfx.heavyhit", c, 0.5, 1);
    shakeNear(dim, c, 24, 0.45);
    const hit = new Set();
    for (let w = 1; w <= 4; w++) system.runTimeout(() => {
      const R = w * 2;
      fx(dim, "origin:ground_ring", at(c, 0, 0.08, 0), DUST, 1 - w * 0.15, { size: R * 2 });
      for (let k = 0; k < 6 + w * 3; k++) { const a = Math.random() * Math.PI * 2; fx(dim, "origin:debris", at(c, Math.cos(a) * R, 0.2, Math.sin(a) * R), DUST, 0.8); }
      for (const e of area(p, c, R + 0.6)) {
        if (near(e, { location: c }) < R - 2.2 || !hitOnce(hit, e)) continue;
        dmg(e, 6 + extra, p); knock(e, V.sub(e.location, c), 0.5, 0.7);
        try { e.addEffect("slowness", 40, { amplifier: 2, showParticles: false }); } catch { }
      }
    }, (w - 1) * 2);
  }, 5);
  return true;
}
function bulwark(p) {
  RT(p).bulwark = now() + 120;
  try { p.addEffect("slowness", 120, { amplifier: 0, showParticles: false }); } catch { }
  play(p, "animation.origin.pose.charge");
  system.runTimeout(() => valid(p) && clear(p), 10);
  fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), rgb(0.85, 0.9, 1), 1, { radius: 2.5 });
  sound(p.dimension, "random.anvil_land", p.location, 0.6, 0.7);
  hudMsg(p, "§7§lBULWARK §r§7- 6s: nothing moves you, arrows go back where they came from", 50);
  return true;
}

// ================================================================== REGENERATION
function berserker(p) {
  const r = RT(p);
  r.berserk = now() + 200;
  play(p, "animation.origin.pose.roar");
  try { p.addEffect("strength", 200, { amplifier: 1, showParticles: false }); p.addEffect("speed", 200, { amplifier: 1, showParticles: false }); p.addEffect("regeneration", 200, { amplifier: 1, showParticles: false }); } catch { }
  fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), RED, 1, { radius: 4 });
  sound(p.dimension, "mob.ravager.roar", p.location, 0.9, 1); sound(p.dimension, "mob.warden.heartbeat", p.location, 0.7, 1);
  try { p.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0.1, fadeOutTime: 0.6 }, fadeColor: { red: 0.5, green: 0, blue: 0 } }); } catch { }
  hudMsg(p, "§4§lBERSERKER §r§7- 10s: every hit heals you", 50);
  return true;
}

// ================================================================== BLAST (laser eyes)
const EYES = (p) => { const h = p.getHeadLocation(), d = p.getViewDirection(), l = Math.hypot(d.x, d.z) || 1, r = { x: -d.z / l, z: d.x / l }; return [-0.13, 0.13].map((s) => ({ x: h.x + r.x * s + d.x * 0.3, y: h.y + 0.02 + d.y * 0.3, z: h.z + r.z * s + d.z * 0.3 })); };
function eyeGlow(p, size, col = RED) { for (const e of EYES(p)) fx(p.dimension, "origin:beam_flare", e, col, 0.9, { size, life: 0.08 }); }
function blastMain(p) {
  const P = (b) => { const hh = hero(b); if ((hh.energy ?? 0) < 2) { hudMsg(b, "§7Out of Energy - the beams die.", 30); return false; } hh.energy -= 2; markDirty(b); return true; };
  sound(p.dimension, "beacon.activate", p.location, 2.2, 0.4);
  for (let k = 0; k < 4; k++) system.runTimeout(() => valid(p) && eyeGlow(p, 0.08 + k * 0.05), k);
  system.runTimeout(() => {
    if (!valid(p)) return;
    startBeam(p, "eyes", {
      dur: 140, range: 32, from: "eyes", style: STYLES.laser, dmg: 3, every: 8, hurt: dmg, pierce: true, turn: 0.55, hitRadius: 0.45, label: "§c§lLASER EYES", perSec: P,
      sfx: { start: ["origin.sfx.laser", 1.25, 0.8], loop: ["mob.guardian.attack_loop", 6, 2, 0.25], end: ["random.fizz", 1.6, 0.4] },
    });
    sound(p.dimension, "mob.guardian.attack_loop", p.location, 1.6, 0.8);
  }, 4);
  return true;
}
function blastSweep(p) {
  const f0 = V.flat(p.getViewDirection()), y0 = p.getViewDirection().y;
  for (let k = 0; k < 3; k++) system.runTimeout(() => valid(p) && eyeGlow(p, 0.1 + k * 0.06), k);
  system.runTimeout(() => {
    if (!valid(p)) return;
    startBeam(p, "eyes", {
      dur: 30, range: 26, from: "eyes", style: { ...STYLES.laser, width: 0.2, coreW: 0.06 }, dmg: 4, every: 4, hurt: dmg, pierce: true, turn: 0.85, hitRadius: 0.6, burn: "cut", label: "§c§lSWEEP",
      filter: (e) => e.typeId !== "minecraft:player" || pvp(p, e),
      aim: (o, b, age) => { const d = rot(f0, -60 + (age / 30) * 120); return V.norm({ x: d.x, y: y0 - 0.12, z: d.z }); },
      sfx: { start: ["origin.sfx.laser", 1.1, 1], loop: ["mob.guardian.attack_loop", 6, 2.2, 0.3], end: ["random.fizz", 1.6, 0.4] },
    });
  }, 3);
  return true;
}
function blastOvercharge(p) {
  const dim = p.dimension;
  try { p.addEffect("slowness", 70, { amplifier: 3, showParticles: false }); } catch { }
  sound(dim, "origin.sfx.charge", p.location, 0.8, 1);
  for (let k = 0; k < 20; k++) system.runTimeout(() => { if (!valid(p)) return; eyeGlow(p, 0.1 + k * 0.025); if (k % 4 === 0) fx(dim, "origin:charge", p.getHeadLocation(), RED, 1); }, k);
  system.runTimeout(() => {
    if (!valid(p)) return;
    sound(dim, "mob.warden.sonic_boom", p.location, 1.3, 0.9);
    shake(p, 0.3, 0.3);
    startBeam(p, "eyes", {
      dur: 40, range: 40, from: "eyes", style: { ...tinted("power", rgb(1, 0.12, 0.06)), width: 0.58, coreW: 0.16, impact: 2.4 }, dmg: 6, every: 6, hurt: dmg, pierce: true, turn: 0.35, hitRadius: 0.95, knock: 0.6,
      pulse: { every: 10, radius: 2.6, dmg: 6, crater: 1 }, burn: "melt", label: "§4§lOVERCHARGE", selfSlow: 3, recoil: 0.08, shake: 0.14,
      filter: (e) => e.typeId !== "minecraft:player" || pvp(p, e),
      sfx: { start: ["origin.sfx.laser", 0.8, 1], loop: ["mob.guardian.attack_loop", 6, 1.2, 0.4], end: ["random.fizz", 0.8, 0.6] },
    });
  }, 20);
  return true;
}

// ================================================================== SENTRY
// Banish (powers.js) calls this first: a void portal opens under them and chains drag them down into it
export async function voidDrag(target, by) {
  if (!valid(target)) return;
  const dim = target.dimension, base = { ...target.location };
  let eye = 1.6;
  try { eye = target.getHeadLocation().y - base.y; } catch { }
  const step = Math.min(0.1, eye * 0.05);   // small things sink less (their eyes stay above the floor)
  sound(dim, "origin.sfx.chains", base, 0.8, 1); sound(dim, "mob.warden.emerge", base, 1.3, 0.6);
  const ring = [0, 1, 2, 3].map((k) => { const a = (k / 4) * Math.PI * 2 + 0.4; return at(base, Math.cos(a) * 1.6, 0.05, Math.sin(a) * 1.6); });
  for (const r0 of ring) tether(dim, r0, target, "void", { life: 16, grow: 4, keep: () => valid(target) && target.dimension.id === dim.id && V.dist(target.location, base) < 4 });
  for (let k = 0; k < 12; k++) {
    if (!valid(target)) return;
    if (k % 3 === 0) fx(dim, "origin:shadow_portal", at(base, 0, 0.06, 0), VOIDC, 1, { size: 2.6, life: 0.5 });
    stun(target, 4);
    if (k >= 4) { try { target.teleport(at(target.location, 0, -step, 0)); } catch { } }   // sinking
    await system.waitTicks(1);
  }
}
function voidChains(p) {
  const list = area(p, p.location, 14).sort((a, b) => near(a, p) - near(b, p)).slice(0, 4);
  if (!list.length) { hudMsg(p, "§7Nothing to bind.", 30); return false; }
  const dim = p.dimension;
  play(p, "animation.origin.pose.claw");
  sound(dim, "origin.sfx.chains", p.location, 0.7, 1);
  const bound = [];
  for (const e of list) {
    const base = { ...e.location };
    for (const k of [0, 1]) { const a = Math.random() * Math.PI * 2; tether(dim, at(base, Math.cos(a) * 1.5, 0.05, Math.sin(a) * 1.5), e, "void", { life: 80, grow: 4, keep: () => valid(e) }); }
    bound.push({ e, base });
  }
  RT(p).vchains = { t: 0, bound };
  hudMsg(p, `§5§lVOID CHAINS §r§7- ${list.length} bound`, 30);
  return true;
}
function tickVChains(p, r) {
  const V0 = r.vchains, dim = p.dimension;
  if (++V0.t > 80) {
    r.vchains = null;
    const live = V0.bound.filter((b) => valid(b.e));
    if (!live.length) return;
    const c = live.reduce((s, b) => V.add(s, V.mul(b.e.location, 1 / live.length)), { x: 0, y: 0, z: 0 });
    for (const b of live) { dmg(b.e, 6, p); knock(b.e, V.sub(c, b.e.location), Math.min(2.4, near(b.e, { location: c }) * 0.35), 0.35); }
    sound(dim, "origin.sfx.chains", c, 0.6, 1);
    return;
  }
  for (const b of V0.bound) {
    if (!valid(b.e)) continue;
    stun(b.e, 4);
    if (V0.t % 6 === 0) fx(dim, "origin:shadow_portal", at(b.base, 0, 0.06, 0), VOIDC, 0.9, { size: 2, life: 0.4 });
    if (V0.t % 20 === 0) dmg(b.e, 2, p);
  }
}
function sunburst(p) {
  const dim = p.dimension;
  play(p, "animation.origin.pose.raise");
  try { p.addEffect("resistance", 30, { amplifier: 3, showParticles: false }); } catch { }
  for (let k = 0; k < 20; k += 2) system.runTimeout(() => { if (!valid(p)) return; fx(dim, "origin:beam_flare", at(p.location, 0, 1.1, 0), GOLD, 1, { size: 0.5 + k * 0.06, life: 0.12 }); fx(dim, "origin:charge", at(p.location, 0, 1, 0), GOLD, 1); }, k);
  sound(dim, "origin.sfx.charge", p.location, 1.3, 1);
  system.runTimeout(() => {
    if (!valid(p)) return;
    const c = at(p.location, 0, 1, 0);
    fx(dim, "origin:flash", c, GOLD, 1, { size: 7 }); fx(dim, "origin:shockwave", at(p.location, 0, 0.1, 0), GOLD, 1, { radius: 10 }); fx(dim, "origin:sonic_ring", c, GOLD, 1, { size: 9 });
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; drawBeam(dim, c, at(c, Math.cos(a) * 7, (Math.random() - 0.3) * 3, Math.sin(a) * 7), { core: WHITE, glow: GOLD, width: 0.18, coreW: 0.05, glowA: 0.7 }, now(), { life: 0.35, seg: 6 }); }
    sound(dim, "origin.sfx.explode", c, 1.2, 1); sound(dim, "random.levelup", c, 0.6, 0.6);
    shakeNear(dim, c, 30, 0.5);
    heal(p, 4);
    for (const e of area(p, c, 10)) { dmg(e, 12, p); heavyLaunch(e, V.sub(e.location, c), near(e, p) < 5 ? 2 : 1, p); if (/zombie|skeleton|phantom|wither|drowned|husk|stray|zoglin/.test(e.typeId)) fire(e, 8); }
  }, 20);
  return true;
}

// ================================================================== MIRROR HOUR: Still Hour
function stillHour(p) {
  const r = RT(p), dim = p.dimension;
  const held = [];
  try {
    for (const e of dim.getEntities({ location: p.location, maxDistance: 11 })) {
      if (e.id === p.id || SKIP.has(e.typeId) && e.typeId !== "minecraft:arrow") continue;
      if (e.typeId === "minecraft:player" && !pvp(p, e)) continue;
      held.push({ e, at: { ...e.location }, rot: (() => { try { return e.getRotation(); } catch { return null; } })() });
    }
  } catch { }
  r.still = { t: 0, held, c: { ...p.location } };
  clockRune(dim, p.location, 90);
  play(p, "animation.origin.pose.rewind");
  sound(dim, "origin.sfx.lock", p.location, 0.4, 1); sound(dim, "block.bell.hit", p.location, 0.5, 1);
  try { p.camera.fade({ fadeTime: { fadeInTime: 0.05, holdTime: 0.1, fadeOutTime: 0.5 }, fadeColor: { red: 0.55, green: 0.42, blue: 0.2 } }); } catch { }
  hudMsg(p, `§6§lSTILL HOUR §r§7- time stops (${held.length})`, 40);
  return true;
}
function tickStill(p, r) {
  const S = r.still;
  if (++S.t > 80 || dead(p)) {
    r.still = null; clear(p);
    sound(p.dimension, "block.bell.hit", p.location, 0.8, 0.8);
    for (const h of S.held) if (valid(h.e)) fx(h.e.dimension, "origin:rewind", at(h.e.location, 0, 1, 0), GOLD, 0.8);
    return;
  }
  for (const h of S.held) {
    if (!valid(h.e)) continue;
    try { h.e.teleport(h.at, h.rot ? { rotation: h.rot } : undefined); } catch { }
    try { h.e.clearVelocity(); } catch { }
    if (h.e.typeId !== "minecraft:arrow") pin(h.e, 4);
    if (S.t % 10 === 0) fx(h.e.dimension, "origin:sparkle", at(h.e.location, 0, 1, 0), GOLD, 0.7);
  }
  if (S.t % 10 === 0) psound(p, "random.click", 0.6, 0.6);
}

// ================================================================== ARC STORM
function arcMain(p) {
  let cur = lookE(p, 22);
  if (!cur) { hudMsg(p, "§7No target for the storm.", 30); return false; }
  const dim = p.dimension, seen = new Set(), dmgs = [9, 7, 5, 4, 3];
  let from = handPos(p, 1);
  play(p, "animation.origin.pose.point");
  for (let i = 0; i < 5 && cur; i++) {
    seen.add(cur.id);
    const to = mid(cur) ?? cur.location;
    bolt(dim, from, to, BOLT, { life: 0.25 });
    fx(dim, "origin:flash", to, BOLT.glow, 1, { size: 1.2 });
    dmg(cur, dmgs[i] * (wet(cur) ? 1.5 : 1), p);
    stun(cur, 14);
    for (let k = 0; k < 3; k++) fx(dim, "origin:spark", at(to, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.6), BOLT.glow, 1);
    from = to;
    cur = area(p, from, 8).filter((x) => !seen.has(x.id)).sort((a, b) => V.dist(a.location, from) - V.dist(b.location, from))[0] ?? null;
  }
  sound(dim, "origin.sfx.thunderhit", p.location, 1.1, 1); sound(dim, "origin.sfx.shock", p.location, 1, 0.8);
  return true;
}
function thunderCall(p) {
  const list = area(p, p.location, 18).sort((a, b) => near(a, p) - near(b, p)).slice(0, 5);
  if (!list.length) { hudMsg(p, "§7Nothing for the sky to strike.", 30); return false; }
  const dim = p.dimension;
  play(p, "animation.origin.pose.fist_up");
  sound(dim, "ambient.weather.thunder", p.location, 1.1, 0.6);
  list.forEach((e, i) => system.runTimeout(() => {
    if (!valid(e) || !valid(p)) return;
    const g = e.location, top = at(g, (Math.random() - 0.5) * 3, 28, (Math.random() - 0.5) * 3);
    bolt(dim, top, at(g, 0, 0.1, 0), { ...BOLT, width: 0.16, coreW: 0.05 }, { life: 0.35, amp: 1.4 });
    bolt(dim, top, at(g, 0, 0.1, 0), BOLT, { life: 0.3, amp: 1.1, fork: false });
    fx(dim, "origin:flash", at(g, 0, 1, 0), WHITE, 1, { size: 3 }); fx(dim, "origin:shockwave", at(g, 0, 0.1, 0), BOLT.glow, 1, { radius: 2.5 });
    sound(dim, "origin.sfx.thunderhit", g, 0.9, 1);
    dmg(e, 10 * (wet(e) ? 1.5 : 1), p); stun(e, 24);
    for (const o of area(p, g, 2.5)) if (o.id !== e.id) dmg(o, 4, p);
  }, 6 + i * 5));
  return true;
}
function arcDash(p) {
  const dim = p.dimension, head = p.getHeadLocation(), dir = p.getViewDirection();
  let dist = 12;
  try { const bh = dim.getBlockFromRay(head, dir, { maxDistance: 12, includePassableBlocks: false }); if (bh) dist = Math.max(0, V.dist(head, V.add(bh.block.location, bh.faceLocation)) - 0.8); } catch { }
  const dest = safeSpot(dim, at(V.add(p.location, V.mul(dir, dist)), 0, 0, 0));
  if (!dest || dist < 2) { hudMsg(p, "§7No room to dash.", 20); return false; }
  const from = { ...p.location };
  bolt(dim, at(from, 0, 1, 0), at(dest, 0, 1, 0), BOLT, { life: 0.4 });
  bolt(dim, at(from, 0, 1.4, 0), at(dest, 0, 1.4, 0), BOLT, { life: 0.3, fork: false });
  try { p.teleport(dest, { rotation: p.getRotation() }); } catch { return false; }
  fx(dim, "origin:flash", at(dest, 0, 1, 0), BOLT.glow, 1, { size: 2 });
  sound(dim, "origin.sfx.shock", dest, 1.4, 1); sound(dim, "origin.sfx.thunderhit", from, 1.6, 0.5);
  const len = V.dist(from, dest), u = V.norm(V.sub(dest, from));
  for (const e of area(p, V.lerp(from, dest, 0.5), len / 2 + 1.5)) {
    const v = V.sub(e.location, from), along = V.dot(v, u);
    if (along < -0.5 || along > len + 0.5 || V.len(V.sub(v, V.mul(u, along))) > 1.8) continue;
    dmg(e, 7, p); stun(e, 18); fx(dim, "origin:spark", mid(e) ?? e.location, BOLT.glow, 1);
  }
  return true;
}

// ================================================================== SHADOW STEP
function stepMain(p, h) {
  const dim = p.dimension, head = p.getHeadLocation(), dir = p.getViewDirection(), r = RT(p);
  const e = lookE(p, 24);
  let dest, facing;
  if (e) { const f = V.flat(V.sub(e.location, p.location)); dest = at(e.location, f.x * 1.4, 0, f.z * 1.4); facing = e.getHeadLocation(); }
  else {
    const b = lookB(p, 24);
    if (b && b.face === "Up") dest = at(b.block.location, 0.5, 1, 0.5);
    else { const d = b ? Math.max(0, V.dist(head, b.pt) - 0.8) : 24; dest = V.add(head, V.mul(dir, d)); dest.y -= 1.2; }
  }
  const dark = isDark(dim, at(dest, 0, 1, 0)), chain = (r.stepChain ?? 0) > now();
  if (!dark) {
    if (V.dist(p.location, dest) > 10) {
      if (e) { hudMsg(p, "§eToo bright over there. §7(Light steps reach 10 blocks; dark ones 24.)", 40); return false; }
      dest = V.add(p.location, V.mul(V.norm(V.sub(dest, p.location)), 10));
    }
    if (!chain && (h.energy ?? 0) < 20) { hudMsg(p, "§bNot enough Energy for a step into the light §7(20)", 30); return false; }
  }
  const spot = safeSpot(dim, dest);
  if (!spot) { hudMsg(p, "§7No room to step there.", 20); return false; }
  const from = { ...p.location }, yaw = p.getRotation().y;
  play(p, "animation.origin.pose.vanish");
  // what's left behind: a shadow of you that comes apart, and a portal in the floor
  const g = spawnE(dim, "origin:shade_clone", from, 14, yaw);
  if (g) system.runTimeout(() => { try { g.playAnimation("animation.origin.shade_clone.fade", { controller: "fade", stopExpression: "0" }); } catch { } }, 4);
  fx(dim, "origin:shadow_portal", at(from, 0, 0.05, 0), VOIDC, 1, { size: 1.8, life: 0.9 });
  fx(dim, "origin:shadow_portal_v", at(from, 0, 1, 0), VOIDC, 0.9, { size: 1.1, life: 0.5 });
  try { p.teleport(spot, facing ? { facingLocation: facing } : { rotation: p.getRotation() }); p.addEffect("invisibility", 20, { showParticles: false }); } catch { return false; }
  fx(dim, "origin:shadow_portal", at(spot, 0, 0.05, 0), VOIDC, 1, { size: 1.8, life: 0.9 });
  fx(dim, "origin:shadow_portal_v", at(spot, 0, 1, 0), VOIDC, 0.9, { size: 1.1, life: 0.5 });
  fx(dim, "origin:void_swirl", at(spot, 0, 1, 0), SHADE, 1);
  sound(dim, "mob.endermen.portal", spot, 0.7, 0.8);
  if (e) r.ambushUntil = now() + 40;
  r.stepChain = chain ? 0 : now() + 40;
  if (chain) { hudMsg(p, "§8§lFOLLOW-UP STEP", 20); return { cost: 5, cd: 20 }; }
  if (!dark) hudMsg(p, "§eStepped through the light. §7(costs more)", 30);
  return dark ? { cost: 10, cd: 50 } : { cost: 20, cd: 100 };
}
async function shadowStrike(p) {
  const list = area(p, p.location, 16).sort((a, b) => near(a, p) - near(b, p)).slice(0, 5);
  if (!list.length) { hudMsg(p, "§7Nothing to strike.", 30); return false; }
  const dim = p.dimension;
  for (const e of list) stun(e, 30);
  let last = { ...p.location };
  for (const [i, e] of list.entries()) {
    if (!valid(p) || !valid(e)) continue;
    const d = V.flat(V.sub(e.location, last)), spot = safeSpot(dim, at(e.location, d.x * 1.3, 0, d.z * 1.3)) ?? e.location;
    fx(dim, "origin:shadow_portal_v", at(last, 0, 1, 0), VOIDC, 0.9, { size: 1, life: 0.35 });
    try { p.teleport(spot, { facingLocation: e.getHeadLocation() }); } catch { }
    fx(dim, "origin:shadow_portal_v", at(spot, 0, 1, 0), VOIDC, 0.9, { size: 1, life: 0.35 });
    slashArc(dim, at(spot, 0, 1.2, 0), V.flat(V.sub(e.location, spot)), { tilt: i % 2 ? 30 : -30, radius: 1.8, color: rgb(0.85, 0.7, 1), glow: VOIDC, steps: 10 });
    dmg(e, 6, p);
    sound(dim, "origin.sfx.sweep2", spot, 1.1 + i * 0.06, 0.8);
    if (i === list.length - 1) { stun(e, 40); heavyLaunch(e, d, 1, p); }
    last = spot;
    await system.waitTicks(3);
  }
  return true;
}

// ================================================================== SHADE FORM
function nightTerror(p) {
  const dim = p.dimension, c = at(p.location, 0, 1, 0);
  play(p, "animation.origin.pose.roar");
  fx(dim, "origin:shockwave", at(p.location, 0, 0.1, 0), SHADE, 1, { radius: 10 }); fx(dim, "origin:sonic_ring", c, VOIDC, 1, { size: 8 });
  for (let k = 0; k < 10; k++) { const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 5; fx(dim, "origin:void_eye", at(c, Math.cos(a) * d, Math.random() * 2, Math.sin(a) * d), Math.random() < 0.5 ? WHITE : RED, 1); }
  sound(dim, "mob.warden.roar", p.location, 0.8, 1); sound(dim, "mob.ghast.scream", p.location, 0.5, 0.8);
  for (const e of foes(p, p.location, 10)) {
    if (e.typeId === "minecraft:player") { if (!pvp(p, e)) continue; try { e.addEffect("darkness", 120); e.addEffect("nausea", 120); e.addEffect("slowness", 60, { amplifier: 1 }); } catch { } continue; }
    knock(e, V.sub(e.location, p.location), 1.5, 0.4);
    try { e.addEffect("weakness", 140, { amplifier: 2, showParticles: false }); e.addEffect("slowness", 60, { amplifier: 2, showParticles: false }); } catch { }
  }
  return true;
}
function shadowMeld(p) {
  RT(p).meld = now() + 60;
  try { p.addEffect("invisibility", 64, { showParticles: false }); p.addEffect("resistance", 64, { amplifier: 4, showParticles: false }); p.addEffect("slowness", 60, { amplifier: 1, showParticles: false }); } catch { }
  play(p, "animation.origin.pose.vanish");
  fx(p.dimension, "origin:shadow_portal", at(p.location, 0, 0.05, 0), VOIDC, 1, { size: 2, life: 1 });
  sound(p.dimension, "mob.endermen.portal", p.location, 0.5, 0.8);
  hudMsg(p, "§8§lSHADOW MELD §r§7- you're part of the floor. You come up swinging.", 40);
  return true;
}
function tickMeld(p, r, t) {
  if (t % 3 === 0) fx(p.dimension, "origin:shadow_portal", at(p.location, 0, 0.05, 0), VOIDC, 0.8, { size: 1.6, life: 0.3 });
  if (t < r.meld) return;
  r.meld = null;
  try { p.removeEffect("invisibility"); } catch { }
  fx(p.dimension, "origin:shadow_portal_v", at(p.location, 0, 1, 0), VOIDC, 1, { size: 1.4, life: 0.5 });
  sound(p.dimension, "origin.sfx.heavyhit", p.location, 1.1, 1);
  const e = area(p, p.location, 4).sort((a, b) => near(a, p) - near(b, p))[0];
  if (e) { dmg(e, 8, p); try { e.applyKnockback({ x: 0, z: 0 }, 1.1); } catch { } stun(e, 20); burst(p.dimension, mid(e) ?? e.location, { x: 0, y: 1, z: 0 }, { n: 10, size: 0.7 }); }
}

// ================================================================== TENDRILS
function tendrilBurst2(p, c, dmgN = 5, pinT = 70) {
  const dim = p.dimension, models = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.random() * 0.4, d = 1.6 + Math.random() * 0.6;
    const spot = { x: c.x + Math.cos(a) * d, y: 0, z: c.z + Math.sin(a) * d }; spot.y = groundAt(dim, at(spot, 0, c.y - spot.y, 0));
    const m = tendrilAt(dim, spot, 50, yawOf({ x: c.x - spot.x, z: c.z - spot.z }));
    if (m) models.push(m);
  }
  fx(dim, "origin:shadow_portal", at(c, 0, 0.06, 0), VOIDC, 1, { size: 4.5, life: 1.4 });
  fx(dim, "origin:shockwave", at(c, 0, 0.05, 0), VOIDC, 1, { radius: 3 });
  sound(dim, "mob.warden.dig", c, 1.2, 0.8); sound(dim, "origin.sfx.chains", c, 0.9, 0.8);
  system.runTimeout(() => { for (const m of models) m.whip(); sound(dim, "origin.sfx.sweep2", c, 0.6, 0.8); }, 7);
  const hit = area(p, c, 3.3);
  system.runTimeout(() => {
    for (const t of hit) { if (!valid(t)) continue; dmg(t, dmgN, p); pin(t, pinT, 6); try { t.applyKnockback({ x: 0, z: 0 }, 0.45); } catch { } }
    for (const m of models) m.grab();
  }, 10);
  return hit;
}
function tendrilsMain(p) {
  const e = lookE(p, 16), b = e ? null : lookB(p, 16);
  const c = e ? e.location : b ? b.pt : V.add(p.location, V.mul(V.flat(p.getViewDirection()), 6));
  play(p, "animation.origin.pose.claw");
  tendrilBurst2(p, c);
  return true;
}
function tendrilGrab(p) {
  const e = lookE(p, 24);
  if (!e) { hudMsg(p, "§7Look at something to grab.", 30); return false; }
  const dim = p.dimension, f = V.flat(p.getViewDirection()), base = at(p.location, f.x * 1.2, 0.05, f.z * 1.2);
  base.y = groundAt(dim, base);
  play(p, "animation.origin.pose.claw");
  fx(dim, "origin:shadow_portal", at(base, 0, 0.06, 0), VOIDC, 1, { size: 1.6, life: 0.8 });
  tether(dim, base, e, "tendril", { life: 18, grow: 4, shrink: 6, keep: () => valid(e) });
  sound(dim, "mob.warden.dig", base, 1.4, 0.8);
  system.runTimeout(() => {
    if (!valid(e) || !valid(p)) return;
    dmg(e, 5, p); pin(e, 40, 3);
    const d = V.sub(p.location, e.location);
    knock(e, d, Math.min(2.6, 0.5 + V.hdist(p.location, e.location) * 0.17), 0.45);
    sound(dim, "origin.sfx.chains", e.location, 1.2, 0.8);
  }, 4);
  return true;
}
function abyssField(p) {
  const e = lookE(p, 18), b = e ? null : lookB(p, 18);
  const c = e ? { ...e.location } : b ? b.pt : V.add(p.location, V.mul(V.flat(p.getViewDirection()), 6));
  const dim = p.dimension, models = [];
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2, d = 2 + Math.random() * 2.5, s = { x: c.x + Math.cos(a) * d, y: c.y, z: c.z + Math.sin(a) * d }; s.y = groundAt(dim, s); const m = tendrilAt(dim, s, 125); if (m) models.push(m); }
  RT(p).abyss = { t: 0, c, models, dim };
  play(p, "animation.origin.pose.claw");
  sound(dim, "mob.warden.emerge", c, 1, 0.8);
  hudMsg(p, "§5§lABYSS FIELD §r§7- 6s", 30);
  return true;
}
function tickAbyss(p, r) {
  const A = r.abyss;
  if (++A.t > 120 || p.dimension.id !== A.dim.id) { r.abyss = null; return; }
  if (A.t % 5 === 0) fx(A.dim, "origin:shadow_portal", at(A.c, 0, 0.06, 0), VOIDC, 0.85, { size: 9, life: 0.4 });
  if (A.t % 10 !== 0) return;
  const inside = area(p, A.c, 5.5);
  for (const m of A.models) {
    if (Math.random() < 0.5 || !inside.length) continue;
    const e = inside[Math.floor(Math.random() * inside.length)];
    m.face(e.location); m.whip();
    system.runTimeout(() => { if (valid(e)) { dmg(e, 4, p); pin(e, 30, 4); } }, 5);
  }
  if (A.t % 20 === 0) sound(A.dim, "origin.sfx.chains", A.c, 0.7, 0.5);
}

// ================================================================== UMBRAL CLONES
const cloneTargets = (p, r) => {
  const out = [];
  try { for (const e of p.dimension.getEntities({ location: p.location, maxDistance: 14, families: ["monster"] })) if (canHit(e, p)) out.push(e); } catch { }
  for (const e of area(p, p.location, 14)) if (e.typeId === "minecraft:player" && !out.includes(e)) out.push(e);
  return out;
};
function cloneStrike(p, e, dmgN = 5) {
  if (!valid(e)) return;
  const dim = p.dimension, f = V.flat(V.sub(e.location, p.location)), spot = at(e.location, f.x * 1.2, 0, f.z * 1.2);
  fx(dim, "origin:shadow_portal_v", at(spot, 0, 1, 0), VOIDC, 1, { size: 1.2, life: 0.5 });
  const c = spawnE(dim, "origin:shade_clone", spot, 12, yawOf(V.sub(e.location, spot)));
  if (c) { try { c.playAnimation("animation.origin.shade_clone.slash", { controller: "act", stopExpression: "0" }); } catch { } system.runTimeout(() => { try { c.playAnimation("animation.origin.shade_clone.fade", { controller: "fade", stopExpression: "0" }); } catch { } }, 8); }
  system.runTimeout(() => {
    if (!valid(e)) return;
    slashArc(dim, at(spot, 0, 1.2, 0), V.flat(V.sub(e.location, spot)), { tilt: Math.random() < 0.5 ? 35 : -35, radius: 1.6, color: rgb(0.8, 0.65, 1), glow: VOIDC, steps: 9 });
    dmg(e, dmgN, p);
    sound(dim, "origin.sfx.swoosh", spot, 1.3, 0.7);
  }, 3);
}
function clonesMain(p) {
  const r = RT(p);
  if (!cloneTargets(p, r).length) { hudMsg(p, "§7Nothing for your shadow to hunt.", 30); return false; }
  sound(p.dimension, "origin.sfx.soul", p.location, 0.7, 1);
  play(p, "animation.origin.pose.summon");
  for (let k = 0; k < 6; k++) system.runTimeout(() => { if (!valid(p)) return; const list = cloneTargets(p, r); const e = list[Math.floor(Math.random() * list.length)]; if (e) cloneStrike(p, e); }, 4 + k * 16);
  return true;
}
function shadowArmy(p) {
  const dim = p.dimension, yaw = p.getRotation().y, clones = [];
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2, c = spawnE(dim, "origin:shade_clone", at(p.location, Math.cos(a) * 1.8, 0, Math.sin(a) * 1.8), 210, yaw); if (c) clones.push({ e: c, a }); }
  if (!clones.length) return false;
  RT(p).army = { t: 0, clones };
  play(p, "animation.origin.pose.summon");
  sound(dim, "origin.sfx.soul", p.location, 0.5, 1); sound(dim, "mob.wither.ambient", p.location, 1.4, 0.4);
  hudMsg(p, "§8§lSHADOW ARMY §r§7- 10s", 30);
  return true;
}
function tickArmy(p, r) {
  const A = r.army;
  if (++A.t > 200 || dead(p)) { for (const c of A.clones) { try { c.e.playAnimation("animation.origin.shade_clone.fade", { controller: "fade", stopExpression: "0" }); } catch { } system.runTimeout(() => { try { c.e.remove(); } catch { } }, 6); } r.army = null; return; }
  const dim = p.dimension, list = cloneTargets(p, r);
  for (const [i, c] of A.clones.entries()) {
    if (!valid(c.e)) continue;
    if (c.busy && A.t < c.busy) continue;
    c.busy = 0;
    c.a += 0.08;
    const home = at(p.location, Math.cos(c.a) * 1.8, 0, Math.sin(c.a) * 1.8);
    if ((A.t + i * 7) % 20 === 0 && list.length) {
      const e = list[(A.t + i) % list.length];
      const f = V.flat(V.sub(e.location, home)), spot = at(e.location, -f.x * 1.1, 0, -f.z * 1.1);
      try { c.e.teleport(spot, { rotation: { x: 0, y: yawOf(f) } }); c.e.playAnimation("animation.origin.shade_clone.slash", { controller: "act", stopExpression: "0" }); } catch { }
      fx(dim, "origin:shadow_portal_v", at(spot, 0, 1, 0), VOIDC, 0.9, { size: 1, life: 0.35 });
      system.runTimeout(() => { if (valid(e)) { dmg(e, 5, p); slashArc(dim, at(spot, 0, 1.2, 0), f, { tilt: 30, radius: 1.5, color: rgb(0.8, 0.65, 1), glow: VOIDC, steps: 8 }); } }, 3);
      c.busy = A.t + 10;
      continue;
    }
    try { c.e.teleport(home, { rotation: { x: 0, y: p.getRotation().y } }); } catch { }
  }
}

// ================================================================== the v0.21 powers: one more move each
function webCocoon(p) {
  const e = lookE(p, 20);
  if (!e) { hudMsg(p, "§7Look at something to cocoon.", 30); return false; }
  const dim = p.dimension;
  play(p, "animation.origin.web.shoot", "origin_p2s");
  tether(dim, () => handPos(p, 1), e, "web", { life: 8, grow: 2, shrink: 3 });
  sound(dim, "origin.sfx.swoosh", p.location, 1.8, 0.7);
  system.runTimeout(() => {
    if (!valid(e)) return;
    cocoon(e, 100);
    stun(e, 100);
    sound(dim, "mob.slime.big", e.location, 1.4, 0.8);
    // hang it from the ceiling if there is one
    try {
      const up = dim.getBlockFromRay(e.getHeadLocation(), { x: 0, y: 1, z: 0 }, { maxDistance: 7, includePassableBlocks: false });
      if (up) { const top = V.add(up.block.location, up.faceLocation); try { e.teleport(at(e.location, 0, 1.2, 0)); } catch { } tether(dim, () => at(e.location, 0, (e.getHeadLocation().y - e.location.y) + 0.4, 0), top, "web", { life: 100, keep: () => valid(e) }); fx(dim, `origin:web_splat_xz`, at(top, 0, -0.02, 0), WHITE, 1, { size: 0.9 }); }
    } catch { }
    for (let k = 0; k < 100; k += 4) system.runTimeout(() => { if (valid(e)) try { e.clearVelocity(); } catch { } }, k);
  }, 2);
  return true;
}
function debrisOrbit(p) {
  const dim = p.dimension, rocks = [];
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2, e = spawnE(dim, "origin:tk_rock", at(p.location, Math.cos(a) * 2.2, 1, Math.sin(a) * 2.2)); if (e) rocks.push({ e, a }); }
  if (!rocks.length) return false;
  fx(dim, "origin:debris", p.location, DUST, 1); fx(dim, "origin:shockwave", at(p.location, 0, 0.1, 0), PSY, 1, { radius: 3 });
  sound(dim, "origin.sfx.rocks", p.location, 0.8, 1); sound(dim, "origin.sfx.mind", p.location, 1, 0.8);
  RT(p).orbit = { t: 0, rocks };
  hudMsg(p, "§d§lDEBRIS ORBIT §r§7- 10s: rocks stop arrows and hit whatever comes close", 40);
  return true;
}
function tickOrbit(p, r) {
  const O = r.orbit, dim = p.dimension;
  if (++O.t > 200 || dead(p)) {   // time's up: whatever's left flies at the nearest enemies
    const list = area(p, p.location, 16);
    for (const [i, k] of O.rocks.entries()) {
      if (!valid(k.e)) continue;
      const e = list[i % Math.max(1, list.length)];
      if (e) { tether(dim, { ...k.e.location }, e, "psy", { life: 4 }); dmg(e, 6, p); knock(e, V.sub(e.location, p.location), 1.2, 0.4); fx(dim, "origin:debris", e.location, DUST, 1); }
      try { k.e.remove(); } catch { }
    }
    r.orbit = null; return;
  }
  for (const k of O.rocks) {
    if (!valid(k.e)) continue;
    k.a += 0.14;
    const pos = at(p.location, Math.cos(k.a) * 2.2, 1.1 + Math.sin(k.a * 2) * 0.25, Math.sin(k.a) * 2.2);
    try { k.e.teleport(pos); } catch { }
    if (O.t % 4 === 0) fx(dim, "origin:sparkle", pos, PSY, 0.6);
  }
  try {
    for (const e of dim.getEntities({ location: p.location, maxDistance: 3 })) {
      if (/^minecraft:(arrow|small_fireball|fireball|snowball|egg|wind_charge_projectile|breeze_wind_charge_projectile|shulker_bullet|llama_spit)$/.test(e.typeId)) {
        let own = false; try { own = e.getComponent("minecraft:projectile")?.owner?.id === p.id; } catch { }
        if (own) continue;   // your own shots go out through the rocks
        fx(dim, "origin:spark", e.location, PSY, 1); try { e.remove(); } catch { } sound(dim, "dig.stone", p.location, 1.5, 0.6);
      }
    }
  } catch { }
  if (O.t % 4 === 0) for (const e of area(p, p.location, 2.9)) {
    const k = O.rocks.find((x) => valid(x.e));
    if (!k) break;
    dmg(e, 5, p); knock(e, V.sub(e.location, p.location), 1.4, 0.4);
    fx(dim, "origin:debris", k.e.location, DUST, 1); sound(dim, "origin.sfx.stonecrash", k.e.location, 1.2, 0.6);
    try { k.e.remove(); } catch { }
  }
  O.rocks = O.rocks.filter((k) => valid(k.e));
  if (!O.rocks.length) r.orbit = null;
}
function fireTornado(p) {
  const e = lookE(p, 22), b = e ? null : lookB(p, 22);
  const c = e ? { ...e.location } : b ? b.pt : V.add(p.location, V.mul(V.flat(p.getViewDirection()), 8));
  c.y = groundAt(p.dimension, c);
  RT(p).ftornado = { t: 0, c, dim: p.dimension };
  play(p, "animation.origin.pose.push");
  sound(p.dimension, "mob.blaze.shoot", c, 0.6, 1); sound(p.dimension, "origin.sfx.flame", c, 0.7, 1);
  hudMsg(p, "§6§lFIRE TORNADO §r§7- 6s", 30);
  return true;
}
function tickFTornado(p, r) {
  const T = r.ftornado, dim = T.dim, c = T.c;
  if (++T.t > 120 || p.dimension.id !== dim.id) { r.ftornado = null; fx(dim, "origin:flash", at(c, 0, 2, 0), FIRE, 1, { size: 4 }); return; }
  for (let h = 0; h < 7; h++) {
    const ang = T.t * 0.5 + h * 0.9, rad = 0.5 + h * 0.35;
    fx(dim, "origin:boom_fire", at(c, Math.cos(ang) * rad, h * 0.9, Math.sin(ang) * rad), FIRE, 0.75);
    if (h % 2 === 0) fx(dim, "origin:ember", at(c, Math.cos(ang + 3) * rad, h * 0.9, Math.sin(ang + 3) * rad), rgb(1, 0.7, 0.2), 1);
  }
  if (T.t % 3 === 0) fx(dim, "origin:boom_smoke", at(c, 0, 7, 0), C.grey, 0.5);
  if (T.t % 4 !== 0) return;
  for (const e of area(p, c, 6.5)) {
    const d = V.sub(c, e.location), l = Math.hypot(d.x, d.z) || 1;
    try { e.applyKnockback({ x: (d.x / l) * 0.32 - (d.z / l) * 0.4, z: (d.z / l) * 0.32 + (d.x / l) * 0.4 }, 0.3); } catch { }
    if (T.t % 8 === 0) { dmg(e, 2, p); fire(e, 4); }
  }
  if (destructionOn() && T.t % 10 === 0) { try { const q = dim.getBlock({ x: Math.floor(c.x + (Math.random() - 0.5) * 6), y: Math.floor(c.y), z: Math.floor(c.z + (Math.random() - 0.5) * 6) }); if (q?.isAir) q.setType("minecraft:fire"); } catch { } }
  if (T.t % 20 === 0) sound(dim, "origin.sfx.fire", c, 0.8, 0.8);
}
// a wall of ice in front of you - temporary blocks, so it melts back to exactly what was there (12s)
const ICEC = rgb(0.6, 0.88, 1);
let ICE_P = null;
function placeIce(dim, pt) {
  if (!ICE_P) { try { ICE_P = BlockPermutation.resolve("minecraft:packed_ice"); } catch { return false; } }
  return placeTemp(dim, pt, ICE_P, 240, (b) => b.isAir || b.isLiquid || /short_grass|tall_grass|fern|flower|snow_layer|dead_bush/.test(b.typeId));
}
function iceWall(p) {
  const dim = p.dimension, f = V.flat(p.getViewDirection()), side = { x: -f.z, z: f.x };
  const c = at(p.location, f.x * 3.2, 0, f.z * 3.2);
  play(p, "animation.origin.pose.push");
  for (let w = -3; w <= 3; w++) {
    const col = at(c, side.x * w, 0, side.z * w), gy = Math.round(groundAt(dim, col));
    for (let h = 0; h < 3; h++) {
      const pt = { x: Math.floor(col.x), y: gy + h, z: Math.floor(col.z) };
      system.runTimeout(() => { if (placeIce(dim, pt) && h === 2) fx(dim, "origin:shards", at(pt, 0.5, 0.8, 0.5), ICEC, 0.8); }, Math.abs(w) + h);
    }
  }
  for (const e of area(p, c, 2.5)) { stun(e, 50); fx(dim, "origin:sparkle", at(e.location, 0, 1, 0), ICEC, 1); }
  sound(dim, "origin.sfx.ice", c, 0.7, 1); sound(dim, "random.glass", c, 0.6, 0.8);
  hudMsg(p, "§b§lICE WALL §r§7- 12s", 30);
  return true;
}
function bloodChains(p) {
  const list = area(p, p.location, 12).sort((a, b) => near(a, p) - near(b, p)).slice(0, 3);
  if (!list.length) { hudMsg(p, "§7Nothing to bind.", 30); return false; }
  const dim = p.dimension;
  try { const hc = p.getComponent("minecraft:health"); if (hc.currentValue > 4) hc.setCurrentValue(hc.currentValue - 2); } catch { }
  play(p, "animation.origin.pose.pull");
  for (const e of list) tether(dim, () => handPos(p, 1), e, "blood", { life: 64, grow: 4, shrink: 4, keep: () => valid(e) && valid(p) });
  RT(p).bchains = { t: 0, list };
  sound(dim, "origin.sfx.chains", p.location, 1, 1); sound(dim, "mob.slime.big", p.location, 1.2, 0.6);
  hudMsg(p, `§4§lBLOOD CHAINS §r§7- draining ${list.length}`, 30);
  return true;
}
function tickBChains(p, r) {
  const B = r.bchains, dim = p.dimension;
  if (++B.t > 60 || dead(p)) {
    r.bchains = null; clear(p);
    for (const e of B.list) if (valid(e)) { knock(e, V.sub(p.location, e.location), Math.min(2.6, 0.5 + near(e, p) * 0.2), 0.4); dmg(e, 3, p); }
    sound(dim, "origin.sfx.chains", p.location, 0.7, 1);
    return;
  }
  for (const e of B.list) {
    if (!valid(e)) continue;
    try { e.addEffect("slowness", 4, { amplifier: 2, showParticles: false }); } catch { }
    if (B.t % 10 === 0) { dmg(e, 2, p); heal(p, 1); bleed(e, 3); fx(dim, "origin:blood_drops", mid(e) ?? e.location, BLOOD, 1, { n: 4 }); }
  }
}
function gravityCrush(p) {
  const e = lookE(p, 20);
  if (!e) { hudMsg(p, "§7Look at something to crush.", 30); return false; }
  play(p, "animation.origin.pose.claw");
  try { e.applyKnockback({ x: 0, z: 0 }, -2); } catch { }
  RT(p).gcrush = { t: 0, e };
  sound(p.dimension, "origin.sfx.gravity", e.location, 0.5, 1); sound(p.dimension, "origin.sfx.crush", e.location, 0.6, 0.8);
  return true;
}
function tickGCrush(p, r) {
  const G = r.gcrush, e = G.e;
  if (!valid(e) || ++G.t > 60) {
    r.gcrush = null;
    if (valid(e)) { dmg(e, 8, p); crater(e.dimension, e.location, 1); goreBurst(e, 1); fx(e.dimension, "origin:shockwave", at(e.location, 0, 0.1, 0), VOIDC, 1, { radius: 3 }); }
    return;
  }
  const dim = e.dimension;
  pin(e, 4);
  try { e.applyKnockback({ x: 0, z: 0 }, -1); } catch { }
  if (G.t % 4 === 0) { fx(dim, "origin:grav_fall", at(e.location, 0, 2.5, 0), VOIDC, 1); fx(dim, "origin:shockwave", at(e.location, 0, 0.08, 0), VOIDC, 0.6, { radius: 1.6 }); }
  if (G.t % 10 === 0) { dmg(e, G.t > 40 ? 4 : 2, p); fx(dim, "origin:scorch_xz", { x: e.location.x + (Math.random() - 0.5), y: Math.floor(e.location.y) + 0.02, z: e.location.z + (Math.random() - 0.5) }, WHITE, 1, { size: 0.7, life: 12 }); sound(dim, "origin.sfx.bonecrack", e.location, 0.6 + G.t / 100, 0.5); }
}

// ================================================================== HELLFIRE (new)
const HELL_CORE = rgb(1, 0.75, 0.25);
function hellHead(p) { const h = p.getHeadLocation(); fx(p.dimension, "origin:boom_fire", at(h, 0, 0.15, 0), HELL, 0.55); if (Math.random() < 0.5) fx(p.dimension, "origin:ember", at(h, (Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4), HELL_CORE, 1); }
function hellMain(p) {
  const dim = p.dimension, e = lookE(p, 18), r = RT(p);
  r.hellUntil = now() + 100;
  play(p, "animation.origin.pose.whip");
  sound(dim, "origin.sfx.chains", p.location, 1.1, 1); sound(dim, "mob.blaze.shoot", p.location, 1.3, 0.6);
  if (e) {
    tether(dim, () => handPos(p, 1), e, "hellfire", { life: 14, grow: 3, shrink: 6, keep: () => valid(e) });
    system.runTimeout(() => {
      if (!valid(e) || !valid(p)) return;
      dmg(e, 5, p); fire(e, 4);
      fx(dim, "origin:boom_fire", mid(e) ?? e.location, HELL, 1);
      knock(e, V.sub(p.location, e.location), Math.min(2.8, 0.5 + V.hdist(p.location, e.location) * 0.18), 0.45);
      sound(dim, "origin.sfx.chains", e.location, 0.8, 1);
    }, 3);
    return { cost: 8, cd: 30 };
  }
  const b = lookB(p, 20);
  if (!b) { hudMsg(p, "§7Nothing to hook.", 20); return false; }
  tether(dim, () => handPos(p, 1), b.pt, "hellfire", { life: 18, grow: 3, shrink: 9 });
  fx(dim, "origin:boom_fire", b.pt, HELL, 1);
  system.runTimeout(() => {
    if (!valid(p)) return;
    const d = V.sub(b.pt, p.location), dist = Math.hypot(d.x, d.z), f = V.flat(d);
    try { p.applyKnockback({ x: f.x * Math.min(3.2, 0.6 + dist * 0.22), z: f.z * Math.min(3.2, 0.6 + dist * 0.22) }, Math.max(0.45, Math.min(1.5, 0.5 + d.y * 0.13))); } catch { }
    r.flyGrace = now() + 60;
  }, 3);
  return { cost: 8, cd: 30 };
}
function penanceStare(p) {
  const e = lookE(p, 16);
  if (!e) { hudMsg(p, "§7Look them in the eye.", 30); return false; }
  const dim = p.dimension, r = RT(p);
  r.hellUntil = now() + 100;
  play(p, "animation.origin.pose.stare");
  sound(dim, "mob.ghast.moan", e.location, 0.5, 1); sound(dim, "origin.sfx.flame", e.location, 0.6, 1);
  let sins = 0;
  if (e.typeId === "minecraft:player") {
    try { sins = Math.min(6, Math.floor((hero(e).stats?.kills ?? 0) / 20)); } catch { }
    try { e.camera.fade({ fadeTime: { fadeInTime: 0.1, holdTime: 0.8, fadeOutTime: 1.2 }, fadeColor: { red: 0.45, green: 0.05, blue: 0 } }); e.addEffect("nausea", 120); e.addEffect("darkness", 60); } catch { }
    try { e.onScreenDisplay.setTitle("§4§lPENANCE", { fadeInDuration: 2, stayDuration: 40, fadeOutDuration: 12, subtitle: "§cyou feel every sin" }); } catch { }
  }
  r.stare = { t: 0, e, sins };
  return true;
}
function tickStare(p, r) {
  const S = r.stare, e = S.e;
  if (!valid(e) || ++S.t > 60) { r.stare = null; return; }
  const dim = e.dimension;
  stun(e, 4);
  if (S.t % 3 === 0) { const hd = e.getHeadLocation(); fx(dim, "origin:boom_fire", hd, HELL, 0.8); fx(dim, "origin:ember", at(hd, 0, 0.2, 0), HELL_CORE, 1); }
  if (S.t % 2 === 0) { const a = p.getHeadLocation(), b2 = e.getHeadLocation(); drawBeam(dim, a, b2, { core: HELL_CORE, glow: HELL, width: 0.04, coreW: 0.012, glowA: 0.5 }, now(), { life: 0.1, seg: 8 }); }
  if (S.t % 10 === 0) { dmg(e, 3 + S.sins * 0.5, p); fire(e, 3); }
}
function chainWhirl(p) {
  RT(p).whirl = { t: 0, a: (p.getRotation().y * Math.PI) / 180, hit: new Map(), ch: null };
  RT(p).hellUntil = now() + 100;
  play(p, "animation.origin.pose.chain_swing");
  sound(p.dimension, "origin.sfx.chains", p.location, 0.9, 1);
  hudMsg(p, "§6§lCHAIN WHIRL", 20);
  return true;
}
function tickWhirl(p, r) {
  const W = r.whirl, dim = p.dimension;
  if (++W.t > 44 || dead(p)) { r.whirl = null; W.ch?.cut(); clear(p); return; }
  W.a += 0.55;
  const tip = () => at(p.location, -Math.sin(W.a) * 4.6, 1.2, Math.cos(W.a) * 4.6);
  if (!W.ch || W.ch.dead) W.ch = tether(dim, () => handPos(p, 1), tip, "hellfire", { life: 60 });
  const tp = tip();
  if (W.t % 2 === 0) fx(dim, "origin:boom_fire", tp, HELL, 0.7);
  if (W.t % 5 === 0) sound(dim, "origin.sfx.swoosh", p.location, 0.8, 0.5);
  for (const e of area(p, p.location, 5.3)) {
    if ((W.hit.get(e.id) ?? -99) + 8 > W.t) continue;
    const d = V.sub(e.location, p.location), ang = Math.atan2(-d.x, d.z), diff = Math.abs(Math.atan2(Math.sin(ang - W.a), Math.cos(ang - W.a)));
    if (diff > 0.7) continue;
    W.hit.set(e.id, W.t);
    dmg(e, 4, p); fire(e, 4); knock(e, d, 1.2, 0.35);
    fx(dim, "origin:boom_fire", mid(e) ?? e.location, HELL, 1);
  }
}
function hellShackle(p) {
  const e = lookE(p, 16);
  if (!e) { hudMsg(p, "§7Look at something to shackle.", 30); return false; }
  const dim = p.dimension, base = { ...e.location };
  RT(p).hellUntil = now() + 100;
  play(p, "animation.origin.pose.claw");
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.3; tether(dim, at(base, Math.cos(a) * 1.7, 0.05, Math.sin(a) * 1.7), e, "hellfire", { life: 70, grow: 4, keep: () => valid(e) }); }
  fx(dim, "origin:shockwave", at(base, 0, 0.08, 0), HELL, 1, { radius: 2.5 });
  sound(dim, "origin.sfx.chains", base, 0.7, 1); sound(dim, "mob.blaze.shoot", base, 0.6, 1);
  RT(p).shackle = { t: 0, e };
  return true;
}
function tickShackle(p, r) {
  const S = r.shackle, e = S.e;
  if (!valid(e) || ++S.t > 70) { r.shackle = null; return; }
  stun(e, 4);
  if (S.t % 20 === 0) { dmg(e, 2, p); fire(e, 2); }
  if (S.t % 4 === 0) fx(e.dimension, "origin:ember", at(e.location, (Math.random() - 0.5), 0.2, (Math.random() - 0.5)), HELL_CORE, 1);
}

// ================================================================== definitions: new alts for every power + Hellfire
const A = (label, sub, icon, act) => ({ label, sub, icon, act });
const NEW_ALTS = {
  stretch: [A("Gatling", "14 rubber punches in a blur", "p3_gatling", "p3_gatling"), A("Rubber Rocket", "stretch back... and launch", "p3_sling", "p3_rocket")],
  flight: [A("Sonic Ram", "fists first through everything", "p3_ram", "p3_ram"), A("Meteor Dive", "straight down - crater", "p3_meteor", "p3_meteor")],
  titan_grip: [A("Piledriver", "up with it, then into the ground", "p3_piledriver", "p3_pile"), A("Giant Swing", "spin it through everyone, then let go", "p3_swing", "p3_swing")],
  super_speed: [A("Speed Tornado", "run circles until the air spins", "p3_tornado", "p3_tornado"), A("Lightning Throw", "throw a bolt - run first to charge it", "p3_arcdash", "p3_lthrow")],
  super_strength: [A("Thunderclap", "one clap - a cone of shockwave", "p3_clap", "p3_clap"), A("Hulk Leap", "a leap that ends in a crater", "p3_leap", "p3_leap")],
  super_durability: [A("Seismic Stomp", "ground rings spread out from you", "p3_stomp", "p3_stomp"), A("Bulwark", "6s: unmovable, arrows bounce back", "p3_shield", "p3_bulwark")],
  regeneration: [A("Berserker", "10s: every hit heals you", "p3_berserk", "p3_berserk")],
  blast: [A("Sweep", "a 120° cutting sweep", "p3_sweep", "p3_sweep"), A("Overcharge", "charge, then a beam that shakes the ground", "p3_overcharge", "p3_overcharge")],
  sentry: [A("Void Chains", "chains from the Void bind up to 4", "p3_voidchain", "p3_vchains"), A("Sunburst", "the light of a million suns", "p3_sunburst", "p3_sunburst")],
  mirror_hour: [A("Still Hour", "stop time around you for 4s", "p3_still", "p3_still")],
  arc_storm: [A("Thunder Call", "the sky strikes up to 5", "p3_thunder", "p3_thunder"), A("Arc Dash", "become lightning for 12 blocks", "p3_arcdash", "p3_arcdash")],
  shadow_step: [A("Shadow Strike", "step through up to 5 enemies", "p3_strike", "p3_sstrike")],
  shade_form: [A("Night Terror", "everything near you runs", "p3_terror", "p3_terror"), A("Shadow Meld", "sink into the floor, come up swinging", "p3_meld", "p3_meld")],
  tendrils: [A("Tendril Grab", "one tendril drags them to you", "p3_tendril", "p3_tgrab"), A("Abyss Field", "6s of tendrils lashing out", "p3_field", "p3_abyss")],
  umbral_clones: [A("Shadow Army", "three clones fight beside you for 10s", "p3_army", "p3_army")],
  web_slinger: [A("Web Cocoon", "wrap it up - hang it from the ceiling", "p3_cocoon", "p3_cocoon")],
  telekinesis: [A("Debris Orbit", "rocks circle you, stop arrows, hit back", "p3_orbit", "p3_orbit")],
  pyrokinesis: [A("Fire Tornado", "a pillar of spinning fire for 6s", "p3_firetornado", "p3_ftornado")],
  cryokinesis: [A("Ice Wall", "a wall of ice, 12s", "p3_icewall", "p3_icewall")],
  blood_manipulation: [A("Blood Chains", "chain 3 enemies and drain them", "p3_bloodchain", "p3_bchains")],
  graviton: [A("Gravity Crush", "pin it to the ground and crush it", "p3_crush", "p3_gcrush")],
  hellfire: [A("Penance Stare", "it feels every sin it ever did", "p3_stare", "p3_stare"), A("Chain Whirl", "a storm of burning chain around you", "p3_whirl", "p3_whirl"), A("Hell Shackle", "four chains from below hold it", "p3_shackle", "p3_shackle")],
};
const NEW_STATS = {
  stretch: "Rubber Body: falls bounce you (sneak to stick the landing), 30% of arrows bounce off",
  super_durability: "Bulwark reflects arrows back at the shooter",
  blast: "Your eyes charge for a moment before they fire",
  sentry: "Banish: a void portal opens and chains drag them under",
  arc_storm: "Real forked lightning · stuns · +50% on anything wet",
  shadow_step: "A follow-up step within 2s costs 5",
  tendrils: "Real tendrils rise out of the ground and lash",
  umbral_clones: "Shadow clones step out behind enemies and cut them",
};
// called by powers.js while it builds the power list (a function declaration, so it's safe during the circular import)
export function applyP3(POWERS) {
  POWERS.hellfire = {
    arch: "shadow", name: "Hellfire", icon: "§6", cost: 8, cd: 30,
    desc: "A burning chain lives in your arm. Lash it out to HOOK whatever you look at and drag it to you - or hook a wall and haul yourself there. Penance Stare makes a creature feel every sin. Chain Whirl turns you into a storm of burning steel. Fire can't hurt you, your punches ignite, and your head burns while you fight.",
    stats: ["Chain Lash: 18 blocks, 5 dmg + fire + drag (or grapple)", "Penance Stare: 3s of hellfire (players: worse the more they've killed)", "Chain Whirl: 2s, 4 dmg + fire per pass · Hell Shackle: 3.5s pinned"],
  };
  for (const k in NEW_ALTS) {
    const P = POWERS[k];
    if (!P) continue;
    P.alts = [...(P.alts ?? []), ...NEW_ALTS[k]];
    if (NEW_STATS[k]) P.stats = [...P.stats, NEW_STATS[k]];
  }
}
// main moves that changed (powers.js asks here first)
export const ACT3 = {
  stretch: (p) => stretchMain(p),
  titan_grip: (p) => titanMain(p),
  blast: (p) => blastMain(p),
  arc_storm: (p) => arcMain(p),
  shadow_step: (p, h) => stepMain(p, h),
  tendrils: (p) => tendrilsMain(p),
  umbral_clones: (p) => clonesMain(p),
  hellfire: (p) => hellMain(p),
};
const ALT3 = {
  p3_gatling: [gatling, 16, 160], p3_rocket: [rubberRocket, 14, 140], p3_ram: [sonicRam, 18, 200], p3_meteor: [meteorDive, 20, 240],
  p3_pile: [piledriver, 20, 200], p3_swing: [giantSwing, 18, 180], p3_tornado: [speedTornado, 22, 300], p3_lthrow: [lightningThrow, 20, 200],
  p3_clap: [thunderclap, 18, 200], p3_leap: [hulkLeap, 15, 160], p3_stomp: [seismicStomp, 15, 160], p3_bulwark: [bulwark, 10, 300], p3_berserk: [berserker, 25, 600],
  p3_sweep: [blastSweep, 18, 260], p3_overcharge: [blastOvercharge, 30, 600], p3_vchains: [voidChains, 24, 360], p3_sunburst: [sunburst, 30, 600],
  p3_still: [stillHour, 30, 600], p3_thunder: [thunderCall, 26, 360], p3_arcdash: [arcDash, 14, 120], p3_sstrike: [shadowStrike, 22, 240],
  p3_terror: [nightTerror, 18, 300], p3_meld: [shadowMeld, 12, 240], p3_tgrab: [tendrilGrab, 12, 120], p3_abyss: [abyssField, 26, 400], p3_army: [shadowArmy, 30, 600],
  p3_cocoon: [webCocoon, 14, 220], p3_orbit: [debrisOrbit, 18, 400], p3_ftornado: [fireTornado, 22, 360], p3_icewall: [iceWall, 16, 300],
  p3_bchains: [bloodChains, 16, 300], p3_gcrush: [gravityCrush, 16, 240], p3_stare: [penanceStare, 20, 300], p3_whirl: [chainWhirl, 18, 220], p3_shackle: [hellShackle, 16, 260],
};
export async function runAlt3(p, act) {
  const X = ALT3[act];
  if (!X) return false;
  const h = hero(p), r = RT(p), t = now();
  if (r.cine || r.caged || r.staticLock) return true;
  r.altCd ??= {};
  if ((r.altCd[act] ?? 0) > t) { hudMsg(p, `§7Recharging §c${((r.altCd[act] - t) / 20).toFixed(1)}s`, 20); return true; }
  if ((h.energy ?? 0) < X[1]) { hudMsg(p, `§bNot enough Energy §7(${X[1]})`, 30); return true; }
  h.energy -= X[1]; r.altCd[act] = t + X[2]; markDirty(p);   // committed up front: a move that takes a while can't be cast twice
  let res = false;
  try { res = await X[0](p); } catch (e) { console.warn("[ORIGIN] " + act + ": " + e); }
  if (res === false) { h.energy += X[1]; r.altCd[act] = 0; markDirty(p); }   // it didn't happen: nothing spent
  return true;
}

// ================================================================== hooks
// every tick
export function tickP3() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const r = RT(p), h = hero(p);
    try {
      if (r.rocket) { if (t > r.rocket.until) r.rocket = null; else { const f = r.rocket.dir, front = at(p.location, f.x * 1.2, 0.9, f.z * 1.2); if (t % 2 === 0) trailLine(p.dimension, at(p.location, 0, 0.9, 0), front, TAN, { size: 0.35, life: 0.5 }); for (const e of area(p, front, 1.9)) if (hitOnce(r.rocket.hit, e)) { dmg(e, 7, p); heavyLaunch(e, f, 1, p); } } }
      if (r.ram) tickRam(p, r, t);
      if (r.meteor) tickMeteor(p, r);
      if (r.grip) tickGrip(p, r);
      if (r.tornado) tickTornado(p, r, t);
      if (r.leapS) tickLeapS(p, r);
      if (r.vchains) tickVChains(p, r);
      if (r.still) tickStill(p, r);
      if (r.meld) tickMeld(p, r, t);
      if (r.abyss) tickAbyss(p, r);
      if (r.army) tickArmy(p, r);
      if (r.orbit) tickOrbit(p, r);
      if (r.ftornado) tickFTornado(p, r);
      if (r.bchains) tickBChains(p, r);
      if (r.gcrush) tickGCrush(p, r);
      if (r.stare) tickStare(p, r);
      if (r.whirl) tickWhirl(p, r);
      if (r.shackle) tickShackle(p, r);
      if (!h.awakened) continue;
      // the look of a power in use
      if (h.power === "hellfire" && ((r.hellUntil ?? 0) > t || r.fight) && t % 2 === 0) hellHead(p);
      if (h.power === "shade_form" && r.powerOn && t % 3 === 0) { let v = { x: 0, y: 0, z: 0 }; try { v = p.getVelocity(); } catch { } if (Math.hypot(v.x, v.z) > 0.05) fx(p.dimension, "origin:boom_smoke", at(p.location, (Math.random() - 0.5) * 0.5, 0.3 + Math.random(), (Math.random() - 0.5) * 0.5), SHADE, 0.55); }
      if ((r.berserk ?? 0) > t && t % 4 === 0) fx(p.dimension, "origin:aura", at(p.location, 0, 1, 0), RED, 0.6);
      if ((r.bulwark ?? 0) > t && t % 5 === 0) fx(p.dimension, "origin:sparkle", at(p.location, (Math.random() - 0.5) * 0.8, Math.random() * 1.8, (Math.random() - 0.5) * 0.8), rgb(0.85, 0.9, 1), 0.8);
      if (h.power === "super_speed" && r.speedOn && (r.spd ?? 0) > 1.05 && t % 3 === 0) {   // the Speed Force crackling off you
        const L = p.location, a = at(L, (Math.random() - 0.5) * 0.9, 0.3 + Math.random() * 1.4, (Math.random() - 0.5) * 0.9);
        bolt(p.dimension, a, at(a, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.9), { ...SPEED_BOLT, width: 0.05, coreW: 0.016 }, { life: 0.1, fork: false, amp: 0.15 });
      }
    } catch (e) { console.warn("[ORIGIN] p3: " + e); }
  }
}
// before damage (players): true = handled
export function onP3HurtBefore(ev) {
  const p = ev.hurtEntity;
  if (p?.typeId !== "minecraft:player") return false;
  const h = hero(p), r = RT(p), cause = String(ev.damageSource?.cause ?? "");
  if (!h.awakened) return false;
  if (h.power === "hellfire" && /^(fire|fireTick|lava|magma|campfire|soulCampfire)$/.test(cause)) { ev.cancel = true; return true; }
  if (h.power === "stretch" && cause === "fall") { ev.cancel = true; const d = ev.damage; system.run(() => rubberBounce(p, d)); return true; }
  if (h.power === "stretch" && cause === "projectile" && Math.random() < 0.3) { ev.cancel = true; system.run(() => { if (valid(p)) { sound(p.dimension, "mob.slime.big", p.location, 1.6, 0.6); fx(p.dimension, "origin:impact", at(p.location, 0, 1.2, 0), TAN, 0.8); } }); return true; }
  if ((r.meld ?? 0) > now()) { ev.cancel = true; return true; }
  if ((r.bulwark ?? 0) > now()) {
    if (cause === "projectile") {
      ev.cancel = true;
      const by = ev.damageSource?.damagingEntity;
      system.run(() => { if (!valid(p)) return; fx(p.dimension, "origin:spark", at(p.location, 0, 1.3, 0), WHITE, 1); sound(p.dimension, "random.anvil_land", p.location, 1.9, 0.4); if (valid(by) && V.dist(by.location, p.location) < 48) { drawBeam(p.dimension, at(p.location, 0, 1.3, 0), mid(by) ?? by.location, STYLES.tracer, now(), { life: 0.15, seg: 10 }); dmg(by, 5, p); } });
      return true;
    }
    ev.damage = ev.damage * 0.25;
  }
  return false;
}
// after damage: remember who's fighting whom (area moves only hit players who fought you)
export function onP3HurtAfter(e, amount, src) {
  const by = src?.damagingEntity;
  if (e?.typeId === "minecraft:player" && by?.typeId === "minecraft:player" && by.id !== e.id) {
    const re = RT(e), rb = RT(by), t = now();
    for (const m of [(re.pvpFoes ??= {}), (rb.pvpFoes ??= {})]) for (const k in m) if (m[k] < t) delete m[k];
    re.pvpFoes[by.id] = t + 400;
    rb.pvpFoes[e.id] = t + 400;
  }
}
export function onP3Melee(p, target) {
  if (!valid(target)) return;
  const h = hero(p), r = RT(p), t = now();
  if (!h.awakened) return;
  if (h.power === "hellfire") { fire(target, 3); fx(p.dimension, "origin:boom_fire", target.getHeadLocation(), HELL, 0.6); }
  if ((r.berserk ?? 0) > t) { heal(p, 1.5); bleed(target, 4); try { fx(p.dimension, "origin:blood_spray", target.getHeadLocation(), BLOOD, 1); } catch { } }
}
export function onP3Kill(killer, deadE) {
  if (killer?.typeId !== "minecraft:player" || !valid(killer)) return;
  const h = hero(killer);
  if (h.awakened && h.power === "hellfire" && valid(deadE)) { try { fx(deadE.dimension, "origin:boom_fire", deadE.location, HELL, 1); } catch { } }
}
export function p3Line(p) {
  const h = hero(p), r = RT(p), t = now();
  if ((r.berserk ?? 0) > t) return ` §4§lBERSERK ${Math.ceil((r.berserk - t) / 20)}s`;
  if ((r.bulwark ?? 0) > t) return ` §7§lBULWARK ${Math.ceil((r.bulwark - t) / 20)}s`;
  if (r.still) return " §6§lTIME STOPPED";
  if (r.army) return " §8§lARMY";
  if (r.orbit) return ` §dORBIT ${r.orbit.rocks.length}`;
  if (h.power === "hellfire") return r.whirl ? " §6§lWHIRL" : r.stare ? " §4§lPENANCE" : null;
  return null;
}
