// ORIGIN v0.18 - physical.js
// The physical powers.
//  SUPER SPEED       - Speedster mode: sprint and the world slows to a crawl around you. Weaves around trees, hops
//                      ledges, runs across water instead of sinking. Blitz: hit up to 8 enemies in a blink.
//  SUPER STRENGTH    - Rip trees and boulders out of the ground and throw them, grab creatures and hurl them.
//                      Haymaker: a punch with a cutscene - the victim sees your fist fill their screen, then white,
//                      then black. Punching a guarding player breaks their guard into that same concussion.
//  SUPER DURABILITY  - Kinetic Skin: arrows and bullets ping off, punches hurt the puncher, falls crater the ground
//                      instead of you. Absorbed force is stored and released as Retaliation. Unstoppable: plow through.
//  REGENERATION      - A healing factor. Big hits tear skin and muscle away (you see it), then it knits back.
//                      Rapid Regeneration: watch your body rebuild itself. Once every 3 minutes a killing blow fails.
import { world, system, EntityDamageCause } from "@minecraft/server";
import { hero, RT, markDirty, saveNow } from "./data.js";
import { V, at, valid, fx, sound, psound, now, health, hexToRgb, C, FX_IDS } from "./util.js";
import { hudMsg } from "./voice.js";
import { runCine, EASE } from "./cine.js";
import { isFlying } from "./flight.js";
import { heavyLaunch, crater, destructionOn } from "./impact.js";
import { cutLine, burst, ICE, trailLine, WHITE } from "./slashfx.js";
import { bleed, goreBurst } from "./gorefx.js";
import { tickRegen, onRegenHurt, inRegenScene, rapidRegen, regenLine, regenFlag } from "./regen.js";
const RIB = { red: 0.55, green: 0.8, blue: 1 }, CYAN = { red: 0.55, green: 0.95, blue: 1 }, ORANGE = { red: 1, green: 0.62, blue: 0.2 };
const yawOf = (v) => (Math.atan2(-v.x, v.z) * 180) / Math.PI;
const tackled = new Map();

const PHYSICAL = ["super_speed", "super_strength", "super_durability", "regeneration"];
const SKIP = [...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "origin:float_text", "origin:exo_piece", "origin:exo_drone", "origin:carry_tree", "origin:carry_boulder", "origin:regen_body", "origin:archetype_orb", "origin:manifestation"];
const TREE = /(_log|_wood|_stem)$/, LEAF = /(_leaves)/, ROCK = /(:stone$|cobblestone$|andesite|diorite|granite|deepslate$|tuff|sandstone$)/;
const BLUE = { red: 0.75, green: 0.88, blue: 1 }, BLOOD = hexToRgb("#8a0f14"), FLESH = hexToRgb("#c0303a");
const active = (p, k) => { const h = hero(p); return h.awakened && h.power === k; };
const hurt = (e, n, by, cause = EntityDamageCause.entityAttack) => { try { e.applyDamage(n, by ? { cause, damagingEntity: by } : { cause }); } catch { } };
const heal = (e, n) => { try { const hc = e.getComponent("minecraft:health"); hc.setCurrentValue(Math.min(hc.effectiveMax, hc.currentValue + n)); } catch { } };
const foes = (p, r) => { try { return p.dimension.getEntities({ location: p.location, maxDistance: r, families: ["monster"], excludeTypes: SKIP }).sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location)); } catch { return []; } };
const shake = (p, a, t) => { try { p.runCommand(`camerashake add @s ${a} ${t} positional`); } catch { } };
const play = (p, n, ctl = "origin_phys") => { try { p.playAnimation(n, { controller: ctl, stopExpression: "0", blendOutTime: 0.15 }); } catch { } };
const held = (p) => { try { return p.getComponent("minecraft:inventory").container.getItem(p.selectedSlotIndex); } catch { return undefined; } };

// ================================================================== SUPER SPEED
function stopSpeed(p, r) { r.spd = 0; r.speedFx = false; runPose(p, r, false); if (r.fastFov) { r.fastFov = false; try { p.camera.setFov(); } catch { } } }
// a sprinter's lean with arms pumping, while you're really moving
function runPose(p, r, on) {
  if (on === !!r.runAnim) return;
  r.runAnim = on;
  try { p.playAnimation(on ? "animation.origin.speed.run" : "animation.origin.clear", { controller: "origin_speedrun", stopExpression: on ? "0" : "1", blendOutTime: 0.2 }); } catch { }
}
function speedToggle(p) {
  const r = RT(p);
  r.speedOn = !r.speedOn;
  if (r.speedOn) { hudMsg(p, "§b§lSPEEDSTER §r§7- sprint. The world slows down around you.", 60); sound(p.dimension, "origin.sfx.windblast", p.location, 1.3, 0.8); }
  else { stopSpeed(p, r); hudMsg(p, "§7Speedster off.", 30); }
  return { cost: r.speedOn ? 8 : 0, cd: 10 };
}
function tickSpeed(p, h, r, t) {
  if (!r.speedOn || h.power !== "super_speed") { if (r.speedFx || r.fastFov) stopSpeed(p, r); return; }
  const going = p.isSprinting && !p.isSneaking && !isFlying(p) && !p.isGliding && !r.cine;
  if (!going) { r.spd = Math.max(0, (r.spd ?? 0) - 0.2); runPose(p, r, false); if (r.spd < 0.5 && (r.speedFx || r.fastFov)) stopSpeed(p, r); r.spdY = p.location.y; return; }
  r.spd = Math.min(1.7, Math.max(0.5, (r.spd ?? 0.5) + 0.07));
  if (t % 20 === 0) { h.energy = Math.max(0, (h.energy ?? 0) - 1); markDirty(p); if (h.energy <= 0) { r.speedOn = false; stopSpeed(p, r); hudMsg(p, "§7Out of Energy - back to normal speed.", 40); return; } }
  const dim = p.dimension, L = p.location, want = V.flat(p.getViewDirection());
  let hd = r.hdg ?? want;
  hd = V.flat({ x: hd.x * 0.5 + want.x * 0.5, y: 0, z: hd.z * 0.5 + want.z * 0.5 });
  const look = 1.2 + r.spd * 2.4;
  const blocked = (dy, d) => { try { return !!dim.getBlockFromRay(at(L, 0, dy, 0), d, { maxDistance: look, includePassableBlocks: false, includeLiquidBlocks: false }); } catch { return false; } };
  let vy = null;
  const low = blocked(0.35, hd), high = blocked(1.6, hd);
  if (low && high) {
    let found = null;
    for (const deg of [22, -22, 45, -45, 70, -70]) {
      const a = (deg * Math.PI) / 180, d2 = { x: hd.x * Math.cos(a) - hd.z * Math.sin(a), y: 0, z: hd.x * Math.sin(a) + hd.z * Math.cos(a) };
      if (!blocked(0.35, d2) && !blocked(1.6, d2)) { found = d2; break; }
    }
    if (found) hd = found; else { vy = 0.78; if (t % 3 === 0) fx(dim, "origin:dust", at(L, hd.x * 0.6, 1, hd.z * 0.6), C.white, 0.7); }   // nowhere to weave: run straight up the wall
  } else if (low) vy = 0.5;
  r.hdg = hd;
  let water = false;
  try { const below = dim.getBlock(at(L, 0, -0.4, 0)); water = p.isInWater || (!!below && /water/.test(below.typeId)); } catch { }
  const dy = L.y - (r.spdY ?? L.y); r.spdY = L.y;
  if (vy === null) {
    if (water && r.spd > 0.8) { vy = p.isInWater ? 0.42 : 0.04; fx(dim, "origin:dust", at(L, 0, 0.05, 0), { red: 0.8, green: 0.92, blue: 1 }, 0.9); if (t % 6 === 0) sound(dim, "random.splash", L, 1.6, 0.3); }
    else if (p.isOnGround) vy = 0;
    else vy = Math.max(-1.2, dy - 0.08);
  }
  try { p.applyKnockback({ x: hd.x * r.spd, z: hd.z * r.spd }, vy); } catch { }
  r.flyGrace = t + 20;
  if (r.spd > 0.8) {   // light ribbons from your shoulders and a ghost of you left behind
    const rt = { x: -hd.z, z: hd.x }, now2 = [at(L, rt.x * 0.32, 1.25, rt.z * 0.32), at(L, -rt.x * 0.32, 1.25, -rt.z * 0.32), at(L, 0, 0.75, 0)];
    if (r.ribbon) for (let k = 0; k < 3; k++) trailLine(dim, r.ribbon[k], now2[k], RIB, { size: k === 2 ? 0.28 : 0.18, life: 0.7, step: 0.28, alpha: 0.9 });
    r.ribbon = now2;
    if (r.spd > 1.2 && t % 3 === 0) { try { const g = dim.spawnEntity("origin:afterimage", L); g.teleport(L, { rotation: { x: 0, y: p.getRotation().y } }); system.runTimeout(() => { try { g.remove(); } catch { } }, 7); } catch { } }
    if (r.spd >= 1.65 && !r.boomed) { r.boomed = true; fx(dim, "origin:sonic_ring", at(L, hd.x * 1.2, 1, hd.z * 1.2), CYAN, 1, { size: 4.5 }); fx(dim, "origin:ground_ring", at(L, 0, 0.1, 0), C.white, 1, { size: 7 }); sound(dim, "random.explode", L, 1.6, 0.5); sound(dim, "origin.sfx.windblast", L, 0.7, 1); shake(p, 0.3, 0.3); }
    try { for (const e of dim.getEntities({ location: at(L, hd.x * 1.1, 0, hd.z * 1.1), maxDistance: 1.7, excludeTypes: SKIP })) { if (e.id === p.id || e.typeId === "minecraft:player" || (tackled.get(e.id) ?? 0) > t) continue; tackled.set(e.id, t + 20); hurt(e, 6, p); heavyLaunch(e, hd, 1, p); burst(dim, e.getHeadLocation(), hd, { n: 8, size: 0.6 }); } } catch { }
  } else { r.ribbon = null; if (r.spd < 1) r.boomed = false; }
  r.speedFx = r.spd > 0.9;
  runPose(p, r, r.spd > 0.9);
  if (r.spd > 1.1) r.fastUntil = t + 80;   // Speed Force charge: Lightning Throw within 4s of a real run is charged
  if (r.speedFx && !r.fastFov) { r.fastFov = true; try { p.camera.setFov({ fov: 108, easeOptions: { easeTime: 0.4 } }); } catch { } }
  if (t % 2 === 0) { fx(dim, "origin:streak", at(L, -hd.x * 0.6, 0.9 + Math.random() * 0.6, -hd.z * 0.6), BLUE, 0.8, { dx: hd.x, dy: 0, dz: hd.z, len: 1.3, w: 0.08, spd: 0.2, life: 0.3 }); fx(dim, "origin:dust", L, C.white, 0.35); }
  if (t % 4 === 0) {
    try {
      for (const e of dim.getEntities({ location: L, maxDistance: 26, excludeTypes: SKIP })) {
        if (e.id === p.id || e.typeId === "minecraft:player") continue;
        if (/arrow|fireball|snowball|trident|wind_charge|shulker_bullet/.test(e.typeId)) { try { e.clearVelocity(); } catch { } continue; }
        try { e.addEffect("slowness", 8, { amplifier: 5, showParticles: false }); } catch { }
      }
    } catch { }
  }
  if (t % 30 === 0) sound(dim, "origin.sfx.wind", L, 1.2, 0.45);
}
async function blitz(p) {
  const list = foes(p, 16).slice(0, 8);
  if (!list.length) { hudMsg(p, "§7Nothing to hit.", 30); return false; }
  for (const e of list) { try { e.addEffect("slowness", 40, { amplifier: 255, showParticles: false }); } catch { } }
  try { p.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0.05, fadeOutTime: 0.3 }, fadeColor: { red: 0.7, green: 0.85, blue: 1 } }); } catch { }
  let last = { ...p.location };
  for (const [i, e] of list.entries()) {
    if (!valid(p) || !valid(e)) continue;
    const d = V.flat(V.sub(e.location, last)), spot = at(e.location, -d.x * 1.3, 0, -d.z * 1.3);
    cutLine(p.dimension, at(last, 0, 1, 0), at(spot, 0, 1, 0), { color: BLUE, glow: ICE, n: 6 });
    try { p.teleport(spot, { facingLocation: e.getHeadLocation() }); } catch { }
    hurt(e, 5, p);
    burst(p.dimension, e.getHeadLocation(), d, { n: 7, size: 0.5 });
    sound(p.dimension, "origin.sfx.punch", e.location, 1.2 + i * 0.05, 0.8);
    if (i === list.length - 1) heavyLaunch(e, d, 2, p);
    last = spot;
    await system.waitTicks(2);
  }
  return true;
}

// ================================================================== SUPER STRENGTH
const carried = new Map(), thrown = [];
function uproot(dim, start) {
  const seen = new Set(), q = [start], out = [];
  const key = (l) => `${l.x},${l.y},${l.z}`;
  while (q.length && out.length < 160) {
    const l = q.shift(), k = key(l);
    if (seen.has(k)) continue;
    seen.add(k);
    if (Math.abs(l.x - start.x) > 6 || Math.abs(l.z - start.z) > 6 || l.y < start.y - 2 || l.y > start.y + 24) continue;
    let b; try { b = dim.getBlock(l); } catch { continue; }
    if (!b || !(TREE.test(b.typeId) || LEAF.test(b.typeId))) continue;
    out.push(b);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) q.push({ x: l.x + dx, y: l.y + dy, z: l.z + dz });
  }
  for (const b of out) { try { b.setType("minecraft:air"); } catch { } }
  return out.length;
}
function strengthUse(p) {
  const r = RT(p);
  if (carried.has(p.id)) return throwCarried(p);
  const dim = p.dimension;
  let e = null;
  try { e = p.getEntitiesFromViewDirection({ maxDistance: 5 }).map((x) => x.entity).find((x) => valid(x) && x.id !== p.id && !SKIP.includes(x.typeId)) ?? null; } catch { }
  if (e) {
    carried.set(p.id, { kind: "mob", e });
    play(p, "animation.origin.strength.carry", "origin_carry");
    sound(dim, "origin.sfx.heavyhit", p.location, 0.7, 1);
    hudMsg(p, "§6Lifted. §7Use again to throw.", 40);
    return { cost: 12, cd: 8 };
  }
  let hit = null;
  try { hit = p.getBlockFromViewDirection({ maxDistance: 6 })?.block; } catch { }
  if (hit && (TREE.test(hit.typeId) || LEAF.test(hit.typeId))) {
    let base = hit.location;
    try { for (let k = 0; k < 12; k++) { const below = dim.getBlock(at(base, 0, -1, 0)); if (below && TREE.test(below.typeId)) base = below.location; else break; } } catch { }
    const n = uproot(dim, base);
    if (!n) return false;
    let te; try { te = dim.spawnEntity("origin:carry_tree", at(p.location, 0, 3.0, 0)); } catch { }
    if (!te) return false;
    carried.set(p.id, { kind: "tree", e: te });
    for (let k = 0; k < 4; k++) fx(dim, "origin:debris", base, hexToRgb("#6b4f2e"), 1);
    sound(dim, "dig.wood", base, 0.6, 1); sound(dim, "origin.sfx.rocks", base, 0.8, 1);
    play(p, "animation.origin.strength.carry", "origin_carry");
    hudMsg(p, "§6You tear the tree out of the ground. §7Use again to throw it.", 50);
    return { cost: 15, cd: 8 };
  }
  if (hit && ROCK.test(hit.typeId)) {
    if (destructionOn()) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy >= -1; dy--) { try { const b = dim.getBlock({ x: hit.location.x + dx, y: hit.location.y + dy, z: hit.location.z + dz }); if (b && ROCK.test(b.typeId)) b.setType("minecraft:air"); } catch { } }
    let be; try { be = dim.spawnEntity("origin:carry_boulder", at(p.location, 0, 2.6, 0)); } catch { }
    if (!be) return false;
    carried.set(p.id, { kind: "boulder", e: be });
    fx(dim, "origin:debris", hit.location, C.dust, 1); sound(dim, "origin.sfx.stonecrash", hit.location, 0.9, 1);
    play(p, "animation.origin.strength.carry", "origin_carry");
    hudMsg(p, "§6You rip a boulder out of the rock. §7Use again to throw it.", 50);
    return { cost: 15, cd: 8 };
  }
  // nothing to lift: ground pound
  crater(dim, p.location, 1);
  for (const f of foes(p, 6)) { hurt(f, 8, p); try { f.applyKnockback({ x: 0, z: 0 }, 0.8); } catch { } }
  return { cost: 12, cd: 60 };
}
function throwCarried(p) {
  const c = carried.get(p.id);
  carried.delete(p.id);
  play(p, "animation.origin.strength.throw", "origin_carry");
  const dir = p.getViewDirection();
  sound(p.dimension, "origin.sfx.windblast", p.location, 0.8, 1);
  if (!valid(c?.e)) return { cost: 0, cd: 6 };
  if (c.kind === "mob") { hurt(c.e, 6, p); heavyLaunch(c.e, dir, 2, p); return { cost: 0, cd: 10 }; }
  thrown.push({ e: c.e, by: p, kind: c.kind, pos: at(p.location, 0, 2.6, 0), vel: { x: dir.x * 1.7, y: dir.y * 1.7 + 0.25, z: dir.z * 1.7 }, t: 0 });
  return { cost: 0, cd: 10 };
}
function tickCarry() {
  for (const [id, c] of carried) {
    const p = world.getEntity(id);
    if (!valid(p) || !valid(c.e)) { try { if (c.kind !== "mob") c.e?.remove(); } catch { } carried.delete(id); continue; }
    try { c.e.teleport(at(p.location, 0, c.kind === "mob" ? 2.4 : c.kind === "tree" ? 3.0 : 2.7, 0), { rotation: { x: 0, y: p.getRotation().y } }); } catch { }
    if (c.kind === "mob") { try { c.e.addEffect("slowness", 4, { amplifier: 255, showParticles: false }); } catch { } }
  }
  for (let i = thrown.length - 1; i >= 0; i--) {
    const o = thrown[i];
    if (!valid(o.e) || ++o.t > 70) { try { o.e?.remove(); } catch { } thrown.splice(i, 1); continue; }
    o.pos = V.add(o.pos, o.vel); o.vel.y -= 0.045;
    const dim = o.e.dimension;
    try { o.e.teleport(o.pos, { rotation: { x: 0, y: o.kind === "tree" ? yawOf(o.vel) : (o.t * 25) % 360 } }); } catch { }
    if (o.t % 2 === 0) trailLine(dim, at(o.pos, -o.vel.x, -o.vel.y + 0.5, -o.vel.z), at(o.pos, 0, 0.5, 0), WHITE, { size: 0.45, life: 1.2 });
    if (o.t % 2 === 0) fx(dim, "origin:dust", o.pos, C.white, 0.5);
    let hitE = [];
    try { hitE = dim.getEntities({ location: at(o.pos, 0, 0.8, 0), maxDistance: o.kind === "tree" ? 3.4 : 1.8, excludeTypes: SKIP }).filter((x) => x.id !== o.by?.id); } catch { }
    let solid = false;
    try { const b = dim.getBlock(o.pos); solid = !!b && !b.isAir && !b.isLiquid && !LEAF.test(b.typeId) && !/grass|flower|fern|snow_layer/.test(b.typeId); if (b && LEAF.test(b.typeId) && destructionOn()) b.setType("minecraft:air"); } catch { }
    if (hitE.length || solid) {
      for (const x of hitE) { hurt(x, o.kind === "tree" ? 10 : 12, valid(o.by) ? o.by : undefined); heavyLaunch(x, o.vel, o.kind === "boulder" ? 2 : 1, o.by); }
      if (o.kind === "boulder") { crater(dim, o.pos, 1); for (const x of (() => { try { return dim.getEntities({ location: o.pos, maxDistance: 3.2, excludeTypes: SKIP }); } catch { return []; } })()) if (x.id !== o.by?.id) hurt(x, 6, valid(o.by) ? o.by : undefined); }
      else { for (let k = 0; k < 4; k++) fx(dim, "origin:debris", o.pos, hexToRgb("#6b4f2e"), 1); fx(dim, "origin:boom_smoke", o.pos, C.grey, 1); sound(dim, "dig.wood", o.pos, 0.6, 1); }
      sound(dim, "origin.sfx.crush", o.pos, 0.9, 1);
      try { o.e.remove(); } catch { }
      thrown.splice(i, 1);
    }
  }
}
function armHaymaker(p) { RT(p).haymaker = now() + 120; hudMsg(p, "§c§lHAYMAKER §r§7- your next punch", 50); sound(p.dimension, "origin.sfx.powerup", p.location, 1.3, 0.8); return true; }
async function haymaker(p, target, guardBreak) {
  const dir = V.flat(V.sub(target.location, p.location)), dim = p.dimension;
  try { target.addEffect("slowness", 30, { amplifier: 255, showParticles: false }); } catch { }
  play(p, "animation.origin.combat.haymaker", "origin_combat");
  if (guardBreak) { fx(dim, "origin:flare", target.getHeadLocation(), C.white, 1); sound(dim, "origin.sfx.glass", target.location, 1, 1); hudMsg(p, "§c§lGUARD BREAK", 30); }
  const viewer = target.typeId === "minecraft:player" ? target : p;
  const scene = runCine(viewer, async (c) => {
    const eye = target.getHeadLocation(), fist = at(p.getHeadLocation(), 0, -0.25, 0);
    c.cam(eye, fist);
    await c.wait(7);
    c.cam(V.lerp(eye, fist, 0.6), fist, 0.25, EASE.InCubic);
    await c.wait(5);
    c.shake(0.7, 0.3);
    c.fade(0, 0.05, 0.1, { red: 1, green: 1, blue: 1 });
    await c.wait(3);
    c.fade(0.02, 0.3, 0.5, { red: 0, green: 0, blue: 0 });
    await c.wait(8);
    for (let k = 0; k < 16 && valid(target); k++) {   // chase cam: follow them through whatever they hit
      const L = target.location, sd = { x: -dir.z, z: dir.x };
      c.cam(at(L, -dir.x * 7 + sd.x * 3, 2.6, -dir.z * 7 + sd.z * 3), at(L, 0, 1, 0), 0.12, EASE.Linear);
      await c.wait(2);
    }
  }, { skippable: false, kind: viewer === p ? "self" : "pvp" });
  await system.waitTicks(13);
  if (!valid(target) || !valid(p)) return;
  hurt(target, 14 + (hero(p).serum ? 2 : 0), p);
  burst(dim, target.getHeadLocation(), dir, { n: 14, size: 0.9, glow: { red: 1, green: 0.85, blue: 0.5 } });
  for (let k = 1; k <= 3; k++) system.runTimeout(() => valid(target) && fx(dim, "origin:sonic_ring", at(target.location, -dir.x * k * 1.6, 1.1, -dir.z * k * 1.6), C.white, 1, { size: 2 + k }), k * 2);
  fx(dim, "origin:ground_ring", at(target.location, 0, 0.1, 0), C.white, 1, { size: 8 }); fx(dim, "origin:star", target.getHeadLocation(), C.white, 1, { n: 8 });
  goreBurst(target, 3);
  fx(dim, "origin:shockwave", target.getHeadLocation(), C.white, 1, { radius: 2.5 });
  sound(dim, "origin.sfx.heavyhit", target.location, 0.7, 1); sound(dim, "origin.sfx.critical", target.location, 0.8, 1);
  shake(p, 0.5, 0.3);
  if (target.typeId === "minecraft:player") { try { target.addEffect("nausea", 140); target.addEffect("darkness", 60); target.addEffect("slowness", 60, { amplifier: 1 }); target.playSound("origin.sfx.tinnitus", { volume: 1 }); } catch { } }
  heavyLaunch(target, dir, 3, p);
  await scene;
}

// ================================================================== SUPER DURABILITY
function retaliate(p) {
  const r = RT(p), ch = r.kin ?? 0;
  if (ch < 10) { hudMsg(p, "§7Not enough absorbed force yet. §8Take some hits.", 40); return false; }
  const dmg = 6 + ch * 0.35;
  play(p, "animation.origin.pose.claw", "origin_p3");
  fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), C.white, 1, { radius: 6 });
  burst(p.dimension, at(p.location, 0, 1, 0), { x: 0, y: 1, z: 0 }, { n: 16, size: 1, glow: { red: 1, green: 0.8, blue: 0.4 } });
  sound(p.dimension, "origin.sfx.crush", p.location, 0.8, 1); sound(p.dimension, "origin.sfx.heavyhit", p.location, 0.6, 1);
  shake(p, 0.5, 0.4);
  for (const e of foes(p, 6)) { hurt(e, dmg, p); if (ch >= 50) heavyLaunch(e, V.sub(e.location, p.location), 2, p); else { const k = V.flat(V.sub(e.location, p.location)); try { e.applyKnockback({ x: k.x * 1.8, z: k.z * 1.8 }, 0.5); } catch { } } }
  r.kin = 0;
  return { cost: 0, cd: 60 };
}
function unstoppable(p) { play(p, "animation.origin.pose.charge", "origin_p3"); system.runTimeout(() => valid(p) && play(p, "animation.origin.clear", "origin_p3"), 12); RT(p).unstoppable = now() + 160; hudMsg(p, "§7§lUNSTOPPABLE §r§7- 8s: sprint through anything", 50); sound(p.dimension, "origin.sfx.guard", p.location, 0.6, 1); return true; }

// ================================================================== REGENERATION lives in regen.js

// ================================================================== hooks
export function onPhysHurtBefore(ev) {
  const p = ev.hurtEntity;
  if (p?.typeId !== "minecraft:player") return false;
  const h = hero(p), r = RT(p), cause = String(ev.damageSource?.cause ?? ""), by = ev.damageSource?.damagingEntity;
  if (!h.awakened || !PHYSICAL.includes(h.power)) return false;
  if (h.power === "super_durability") {
    if (cause === "fall") { ev.cancel = true; system.run(() => valid(p) && crater(p.dimension, p.location, ev.damage > 10 ? 2 : 1)); return true; }
    if (cause === "projectile") { ev.cancel = true; r.kin = Math.min(100, (r.kin ?? 0) + 4); system.run(() => { if (!valid(p)) return; fx(p.dimension, "origin:spark", p.getHeadLocation(), C.white, 1); sound(p.dimension, "random.anvil_land", p.location, 1.8, 0.4); }); return true; }
    const absorbed = ev.damage * ((r.unstoppable ?? 0) > now() ? 0.75 : 0.5);
    ev.damage = Math.max(0, ev.damage - absorbed);
    r.kin = Math.min(100, (r.kin ?? 0) + absorbed * 3);
    if (cause === "entityAttack" && by && by.typeId !== "minecraft:player") system.run(() => { if (!valid(by)) return; hurt(by, 2, p); try { by.addEffect("weakness", 40, { amplifier: 1 }); } catch { } fx(p.dimension, "origin:spark", at(p.location, 0, 1.2, 0), C.white, 1); sound(p.dimension, "random.anvil_land", p.location, 1.5, 0.3); });
    return false;
  }
  if (h.power === "super_speed" && r.speedOn && cause === "projectile" && Math.random() < 0.7) {
    ev.cancel = true;
    system.run(() => { if (!valid(p)) return; const s = V.flat(p.getViewDirection()), side = Math.random() < 0.5 ? 1 : -1; fx(p.dimension, "origin:streak", at(p.location, 0, 1, 0), BLUE, 0.8, { dx: -s.z * side, dy: 0, dz: s.x * side, len: 1, w: 0.08, spd: 0.4, life: 0.25 }); try { p.teleport(at(p.location, -s.z * side * 0.9, 0, s.x * side * 0.9), { rotation: p.getRotation() }); } catch { } });
    return true;
  }
  if (h.power === "regeneration" && inRegenScene(p)) { ev.cancel = true; return true; }   // the killing-blow save itself runs last (regenFinalSave)
  return false;
}
export function onPhysHurtAfter(e, amount, src) { onRegenHurt(e, amount, src); }
// called on your melee hits: true = handled (haymaker replaces the normal hit)
export function onPhysMelee(p, target) {
  if (!valid(target)) return false;
  const h = hero(p), r = RT(p);
  if (!h.awakened) return false;
  if (h.power === "super_strength") {
    const guardBreak = target.typeId === "minecraft:player" && target.isSneaking;
    if ((r.haymaker ?? 0) > now() || guardBreak) { r.haymaker = 0; haymaker(p, target, guardBreak); return true; }
    if (!held(p)) { hurt(target, 4, p); const k = V.flat(p.getViewDirection()); system.runTimeout(() => { if (valid(target)) try { target.applyKnockback({ x: k.x * 1.6, z: k.z * 1.6 }, 0.45); } catch { } }, 1); }
  }
  if (h.power === "super_speed" && r.speedOn && (r.spd ?? 0) > 1) { hurt(target, 3, p); }
  return false;
}
// every tick
export function tickPhysical() {
  const t = now();
  tickCarry();
  for (const p of world.getAllPlayers()) {
    const h = hero(p), r = RT(p);
    if ((r.haymaker ?? 0) > t && t % 3 === 0) { const f = V.flat(p.getViewDirection()), hand = at(p.location, -f.z * 0.38 + f.x * 0.35, 1.0, f.x * 0.38 + f.z * 0.35); fx(p.dimension, "origin:flare", hand, ORANGE, 0.8); if (t % 9 === 0) fx(p.dimension, "origin:star", hand, { red: 1, green: 0.9, blue: 0.6 }, 1, { n: 2 }); }
    const fl = r.fly;   // flying: contrails, and sonic rings when you're really moving
    if (fl?.v) {
      const s = Math.hypot(fl.v.x, fl.v.y, fl.v.z), L = p.location;
      if (s > 0.9 && r.contrail) trailLine(p.dimension, r.contrail, at(L, 0, 0.4, 0), WHITE, { size: 0.32, life: 1.1, alpha: 0.75 });
      r.contrail = s > 0.9 ? at(L, 0, 0.4, 0) : null;
      if (s > 1.4 && t - (r.ringAt ?? 0) > 12) { r.ringAt = t; const n = { x: fl.v.x / s, y: fl.v.y / s, z: fl.v.z / s }; fx(p.dimension, "origin:sonic_ring", at(L, n.x * 1.5, 0.9 + n.y * 1.5, n.z * 1.5), CYAN, 0.9, { size: 3.2 }); }
      if (s > 1.9 && !r.flyBoom) { r.flyBoom = true; fx(p.dimension, "origin:sonic_ring", at(L, 0, 0.9, 0), C.white, 1, { size: 6 }); sound(p.dimension, "random.explode", L, 1.5, 0.6); shake(p, 0.25, 0.3); }
      if (s < 1.2) r.flyBoom = false;
    } else r.contrail = null;
    if (!h.awakened) continue;
    if (h.power === "super_speed" || r.speedOn) tickSpeed(p, h, r, t);
    if (h.power === "regeneration") tickRegen(p, h, r, t);
    if (h.power === "super_durability" && (r.unstoppable ?? 0) > t && p.isSprinting && t % 2 === 0) {
      const f = V.flat(p.getViewDirection());
      try { for (const e of p.dimension.getEntities({ location: at(p.location, f.x * 1.2, 0, f.z * 1.2), maxDistance: 1.6, excludeTypes: SKIP })) if (e.id !== p.id && e.typeId !== "minecraft:player") { hurt(e, 6, p); heavyLaunch(e, { x: f.x - f.z * 0.5, y: 0, z: f.z + f.x * 0.5 }, 1, p); } } catch { }
      if (destructionOn()) { try { const b = p.dimension.getBlock(at(p.location, f.x * 1.2, 1, f.z * 1.2)); if (b && /leaves|glass|_planks|fence|log/.test(b.typeId)) { b.setType("minecraft:air"); fx(p.dimension, "origin:debris", b.location, C.dust, 0.8); sound(p.dimension, "dig.wood", b.location, 0.8, 0.8); } } catch { } }
    }
  }
}
export const physFlags = (p) => { const r = RT(p); return (r.speedFx ? "origin_speed" : "") + ((r.woundUntil ?? 0) > now() || regenFlag(p) ? "origin_wound" : ""); };
export function physLine(p) {
  const h = hero(p), r = RT(p);
  if (h.power === "super_speed") return r.speedOn ? ` §b${Math.round(((r.spd ?? 0) / 1.7) * 100)}%` : " §8(off)";
  if (h.power === "super_durability") return ` §7force §f${Math.round(r.kin ?? 0)}`;
  if (h.power === "regeneration") return regenLine(p);
  if (h.power === "super_strength") return carried.has(p.id) ? " §6carrying" : (r.haymaker ?? 0) > now() ? " §cHAYMAKER" : "";
  return null;
}
export const PHYS = { speed: speedToggle, strength: strengthUse, retaliate, regen: rapidRegen };
const ALTS = { blitz: [blitz, 25, 300], haymaker: [armHaymaker, 20, 160], unstoppable: [unstoppable, 25, 600] };
export async function runAlt(p, key) {
  const A = ALTS[key];
  if (!A) return;
  const h = hero(p), r = RT(p), t = now();
  r.altCd ??= {};
  if ((r.altCd[key] ?? 0) > t) { hudMsg(p, `§7Recharging §c${((r.altCd[key] - t) / 20).toFixed(1)}s`, 20); return; }
  if ((h.energy ?? 0) < A[1]) { hudMsg(p, `§bNot enough Energy §7(${A[1]})`, 30); return; }
  const res = await A[0](p);
  if (res === false) return;
  h.energy -= A[1]; r.altCd[key] = t + A[2]; markDirty(p);
}
