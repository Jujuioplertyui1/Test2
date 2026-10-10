// ORIGIN v0.24 - gear.js
// Hero gear (original designs):
//  VANGUARD SHIELD   sneak = guard (blocks everything from the front, arrows included); raise it just as a hit lands
//                    for a PERFECT BLOCK (shots go back at the shooter) · guard while you fall = SHIELD LANDING ·
//                    use = throw it: real ricochet physics off walls (bank shots into people behind cover), chains
//                    through up to five enemies, curves home like a boomerang · catch it after 3+ hits = TRICK SHOT ·
//                    hit, hit, hit = bash, bash, UPPERCUT · sprint + use = shield charge · sneak + use = shield slam ·
//                    use the empty strap to call it back early
//  SHOCK BATONS      every hit shocks and staggers · every third hit in a row is a flip kick · use = chain shock
//                    (arcs through four enemies) · sneak + use = takedown (vault onto them and slam them down)
//  AGENT GAUNTLETS   use = shock dart · sneak + use = grapple line (pull yourself to a block, or yank an enemy to you)
//                    · sprint + use = ghost (ten seconds unseen; your first strike from it is an ambush)
import { world, system, ItemStack, EntityDamageCause } from "@minecraft/server";
import { hero, RT, markDirty, saveNow } from "./data.js";
import { V, at, valid, fx, sound, now, C, isSolidBlock, FX_IDS, hexToRgb } from "./util.js";
import { hudMsg } from "./voice.js";
import { tether } from "./models.js";
import { bolt } from "./powers3.js";
import { flashBeam, STYLES } from "./beams.js";

export const SHIELD = "origin:vanguard_shield", SHIELD_STRAP = "origin:shield_strap", BATONS = "origin:shock_batons", GAUNTLETS = "origin:agent_gauntlets";
export const GEAR = new Set([SHIELD, SHIELD_STRAP, BATONS, GAUNTLETS]);
const THROWN = "origin:shield_thrown";
const STEEL = hexToRgb("#cfd6e0"), BRONZE = hexToRgb("#e0a860"), SHOCK = hexToRgb("#5fd0ff"), WHITE = { red: 1, green: 1, blue: 1 };
const ZAP = { core: WHITE, glow: SHOCK, width: 0.07, coreW: 0.02, flare: 0.2, impact: 0.4, glowA: 0.85 };
const SKIP = new Set([...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", THROWN, "origin:mjolnir_thrown", "origin:mjolnir_stone", "origin:float_text", "origin:exo_piece", "origin:exo_drone"]);
const wait = (t) => system.waitTicks(Math.max(1, Math.floor(t)));
const container = (p) => { try { return p.getComponent("minecraft:inventory").container; } catch { return null; } };
const heldId = (p) => { try { return container(p).getItem(p.selectedSlotIndex)?.typeId; } catch { return undefined; } };
const play = (p, a, stop) => { try { p.playAnimation(a, { controller: "origin_gear", ...(stop !== undefined ? { stopExpression: stop } : {}), blendOutTime: 0.15 }); } catch { } };
const clear = (p) => play(p, "animation.origin.clear", "1");
const shake = (p, a, t) => { try { p.runCommand(`camerashake add @s ${a} ${t} positional`); } catch { } };
const handPos = (p) => { const h = p.getHeadLocation(), d = p.getViewDirection(); return { x: h.x - d.z * 0.38 + d.x * 0.5, y: h.y - 0.5 + d.y * 0.3, z: h.z + d.x * 0.38 + d.z * 0.5 }; };
function cdOk(p, k, n) {
  const r = RT(p), t = now();
  if ((r[k] ?? 0) > t) { hudMsg(p, `§7Recharging §b${((r[k] - t) / 20).toFixed(1)}s`, 20); return false; }
  r[k] = t + n;
  return true;
}
function stun(e, ticks) { try { e.addEffect("slowness", ticks, { amplifier: 5, showParticles: false }); e.addEffect("weakness", ticks, { amplifier: 2, showParticles: false }); } catch { } }
function hurt(e, n, p, cause = EntityDamageCause.entityAttack) { try { e.applyDamage(n, { cause, damagingEntity: p }); } catch { } }
function creatures(dim, c, r, owner) {
  try { return dim.getEntities({ location: c, maxDistance: r, excludeFamilies: ["inanimate"] }).filter((e) => e !== owner && !SKIP.has(e.typeId)); } catch { return []; }
}
function bodyHit(e, pos) {
  try { const l = e.location, top = e.getHeadLocation().y + 0.3; return Math.hypot(l.x - pos.x, l.z - pos.z) < 0.95 && pos.y > l.y - 0.3 && pos.y < top; } catch { return false; }
}
// what you're looking at (a creature, then a block)
function lookE(p, d) { try { const h = p.getEntitiesFromViewDirection({ maxDistance: d }).find((x) => !SKIP.has(x.entity.typeId) && x.entity !== p); return h?.entity ?? null; } catch { return null; } }
function lookB(p, d) { try { const b = p.getBlockFromViewDirection({ maxDistance: d }); if (!b) return null; const L = b.block.location; return { block: b.block, pt: { x: L.x + b.faceLocation.x, y: L.y + b.faceLocation.y, z: L.z + b.faceLocation.z }, face: String(b.face) }; } catch { return null; } }
function tutorial(p, id) {
  const h = hero(p);
  h.gearSeen ??= {};
  if (h.gearSeen[id]) return;
  h.gearSeen[id] = 1; markDirty(p);
  const T = {
    [SHIELD]: "§eVanguard Shield §7- sneak: guard (time it = perfect block) · use: throw (bounces off walls into enemies) · 3 hits: uppercut · sprint + use: charge · sneak + use: slam · guard while falling: shield landing",
    [BATONS]: "§bShock Batons §7- hits shock and stagger, every 3rd is a flip kick · use: chain shock · sneak + use: takedown",
    [GAUNTLETS]: "§bAgent Gauntlets §7- use: shock dart · sneak + use: grapple · sprint + use: ghost",
  };
  if (T[id]) hudMsg(p, T[id], 140);
}

// ------------------------------------------------------------------ use
export function useGear(p, id, sneaking) {
  const sprint = (() => { try { return p.isSprinting; } catch { return false; } })();
  if (id === SHIELD_STRAP) return recallShield(p);
  if (id === SHIELD) { if (sneaking) return shieldSlam(p); if (sprint) return shieldCharge(p); return throwShield(p); }
  if (id === BATONS) { if (sneaking) return takedown(p); return chainShock(p); }
  if (id === GAUNTLETS) { if (sneaking) return grapple(p); if (sprint) return ghost(p); return dart(p); }
}

// ------------------------------------------------------------------ the shield: guard
// Sneak with it up: blocks everything from the front. Raise it just as a hit lands (a PERFECT BLOCK) and arrows,
// bolts and fireballs go straight back at whoever sent them. Falling with it raised under you: a SHIELD LANDING -
// you ride it down, no fall damage, and the impact flattens everything around you.
export function onShieldBefore(ev) {
  const p = ev.hurtEntity;
  if (p?.typeId !== "minecraft:player" || !p.isSneaking || heldId(p) !== SHIELD) return false;
  const cause = String(ev.damageSource?.cause);
  if (cause === "fall") return shieldLanding(p, ev);
  const src = ev.damageSource.damagingEntity ?? ev.damageSource.damagingProjectile;
  if (!src && cause !== "entityExplosion" && cause !== "blockExplosion") return false;
  if (!src) return false;   // can't tell where it came from: the shield can't be sure it's in the way
  const yaw = (p.getRotation().y * Math.PI) / 180, facing = { x: -Math.sin(yaw), z: Math.cos(yaw) }, to = V.flat(V.sub(src.location, p.location));
  if (to.x * facing.x + to.z * facing.z <= 0.15) return false;
  if (/xplosion/.test(cause)) {   // a blast is only softened: the rest of the chain (death saves, guard) still runs
    ev.damage = ev.damage * 0.35;
    system.run(() => { if (valid(p)) { sound(p.dimension, "item.shield.block", p.location, 0.7, 1); fx(p.dimension, "origin:spark", at(p.location, facing.x * 0.7, 1.2, facing.z * 0.7), BRONZE, 1); } });
    return false;
  }
  if (cause === "entityAttack" || cause === "projectile" || cause === "magic" || cause === "fireworks") ev.cancel = true;
  else return false;
  const attacker = ev.damageSource.damagingEntity, dmg = ev.damage, r = RT(p);
  const perfect = now() - (r.guardAt ?? -99) <= 8;
  system.run(() => {
    if (!valid(p)) return;
    const yaw = (p.getRotation().y * Math.PI) / 180, c = at(p.location, -Math.sin(yaw) * 0.7, 1.2, Math.cos(yaw) * 0.7);
    for (let k = 0; k < 4; k++) fx(p.dimension, "origin:spark", c, k % 2 ? BRONZE : WHITE, 1);
    sound(p.dimension, "item.shield.block", p.location, 0.9, 1); sound(p.dimension, "random.anvil_land", p.location, 1.8, 0.25);
    if (cause !== "entityAttack" && perfect && valid(attacker) && attacker !== p && V.dist(attacker.location, p.location) < 40) {
      // the shot goes back the way it came
      const to2 = at(attacker.location, 0, 1.1, 0);
      try { flashBeam(p.dimension, c, to2, { ...STYLES.tracer, glow: BRONZE }, { life: 0.25 }); } catch { }
      hurt(attacker, Math.max(4, dmg * 1.5), p);
      stun(attacker, 30);
      fx(p.dimension, "origin:flash", c, BRONZE, 1, { size: 1.2 });
      sound(p.dimension, "origin.sfx.ting", c, 1.4, 1);
      hudMsg(p, "§e§lREFLECTED", 20);
    } else if (valid(attacker) && cause === "entityAttack" && V.dist(attacker.location, p.location) < 4) {
      const d = V.flat(V.sub(attacker.location, p.location));
      try { attacker.applyKnockback({ x: d.x * (perfect ? 1.4 : 0.7), z: d.z * (perfect ? 1.4 : 0.7) }, perfect ? 0.35 : 0.2); } catch { }
      if (perfect) { stun(attacker, 40); hudMsg(p, "§e§lPERFECT BLOCK", 20); sound(p.dimension, "origin.sfx.parry", p.location, 1.2, 1); }
    }
  });
  return true;
}
function shieldLanding(p, ev) {
  const dmg = ev.damage;
  if (dmg > 40) { ev.damage = dmg - 40; return false; }   // even vibranium has limits
  ev.cancel = true;
  system.run(() => {
    if (!valid(p)) return;
    const c = { ...p.location }, dim = p.dimension, power = Math.min(1, dmg / 20), R = 3 + power * 4;
    fx(dim, "origin:shockwave", at(c, 0, 0.1, 0), BRONZE, 1, { radius: R }); fx(dim, "origin:shockwave", at(c, 0, 0.3, 0), WHITE, 1, { radius: R * 0.5 });
    fx(dim, "origin:debris", c, C.dust, 1); fx(dim, "origin:dust", c, C.dust, 1);
    sound(dim, "random.anvil_land", c, 0.5, 1); sound(dim, "origin.sfx.stonecrash", c, 0.8, 1);
    try { for (const q of dim.getPlayers({ location: c, maxDistance: 16 })) shake(q, 0.25 + power * 0.3, 0.3); } catch { }
    for (const e of creatures(dim, c, R, p)) {
      const d = V.flat(V.sub(e.location, c));
      hurt(e, 4 + Math.round(power * 8), p);
      try { e.applyKnockback({ x: d.x * (0.6 + power), z: d.z * (0.6 + power) }, 0.4 + power * 0.4); } catch { }
      stun(e, 20);
    }
    hudMsg(p, dmg >= 6 ? "§e§lSHIELD LANDING" : "§7Shield landing", 25);
  });
  return true;
}

// ------------------------------------------------------------------ the shield: throw, ricochet, return
// The throw is real geometry now: every sub-step it ray-casts for blocks and reflects off the face it hits (angle in =
// angle out), losing a little speed each time. After a wall it looks for a target near the new heading and banks
// into it - aim at a wall to hit someone behind cover. Each enemy it hits sends it on to the nearest one it hasn't
// hit yet (up to five). On the way back it curves home like a boomerang, and still clips anyone in its path.
// Catch it after three or more hits for a TRICK SHOT: your charge and slam come back off cooldown.
const shields = new Map();
const MAX_BOUNCES = 5;
const NORMAL = { Up: { x: 0, y: 1, z: 0 }, Down: { x: 0, y: -1, z: 0 }, North: { x: 0, y: 0, z: -1 }, South: { x: 0, y: 0, z: 1 }, East: { x: 1, y: 0, z: 0 }, West: { x: -1, y: 0, z: 0 } };
const reflect = (d, n) => { const k = 2 * V.dot(d, n); return V.norm({ x: d.x - k * n.x, y: d.y - k * n.y, z: d.z - k * n.z }); };
function strapStack() { const s = new ItemStack(SHIELD_STRAP, 1); try { s.keepOnDeath = true; s.setLore(["§7Your shield is out there.", "§8Use: call it back."]); } catch { } return s; }
function shieldStack() { const s = new ItemStack(SHIELD, 1); try { s.keepOnDeath = true; } catch { } return s; }
function throwShield(p) {
  if (shields.has(p.id)) return recallShield(p);
  const slot = p.selectedSlotIndex;
  play(p, "animation.origin.shield.throw");
  sound(p.dimension, "origin.sfx.swoosh", p.location, 1.1, 1);
  system.runTimeout(() => {
    if (!valid(p) || shields.has(p.id)) return;
    const c = container(p);
    if (!c || c.getItem(slot)?.typeId !== SHIELD) return;
    c.setItem(slot, strapStack());
    hero(p).shieldOut = true; saveNow(p);   // saved at once: a quick log-off can't lose or copy it
    let dir = V.norm(p.getViewDirection());
    // a little aim assist: someone close to where you're looking gets the shield
    const lock = lookE(p, 28);
    const pos = V.add(handPos(p), V.mul(dir, 0.7));
    if (lock) dir = V.norm(V.sub(at(lock.location, 0, 1, 0), pos));
    let e; try { e = p.dimension.spawnEntity(THROWN, pos); } catch { }
    if (!e) { c.setItem(slot, shieldStack()); hero(p).shieldOut = false; saveNow(p); return; }
    shields.set(p.id, { p, e, pos, dir, phase: "out", t: 0, dist: 0, bounces: 0, hits: new Set(), dim: p.dimension, speed: 1.6, born: now(), hitCount: 0, walls: 0 });
  }, 3);
}
function recallShield(p) {
  const m = shields.get(p.id);
  if (!m) {
    if (hero(p).shieldOut) { restoreShield(p); return; }
    try { const c = container(p); if (c.getItem(p.selectedSlotIndex)?.typeId === SHIELD_STRAP) c.setItem(p.selectedSlotIndex, undefined); } catch { }
    return;
  }
  m.phase = "back";
}
function ricochetFrom(m, from) {   // the next enemy it can bounce to
  let best = null, bd = 99;
  for (const e of creatures(m.dim, from, 12, m.p)) {
    if (m.hits.has(e.id) || e.typeId === "minecraft:player") continue;
    const d = V.dist(e.location, from);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
// after a wall: someone within ~40 degrees of the new heading and 18 blocks gets banked into
function bankTarget(m, from, dir) {
  let best = null, bs = 0.76;
  for (const e of creatures(m.dim, from, 18, m.p)) {
    if (m.hits.has(e.id) || e.typeId === "minecraft:player") continue;
    const to = V.norm(V.sub(at(e.location, 0, 1, 0), from)), s = V.dot(to, dir);
    if (s > bs) { bs = s; best = e; }
  }
  return best;
}
function clang(m, at0) { for (let k = 0; k < 4; k++) fx(m.dim, "origin:spark", at0, k % 2 ? BRONZE : WHITE, 1); sound(m.dim, "random.anvil_land", at0, 1.7, 0.45); sound(m.dim, "item.shield.block", at0, 1.2, 0.8); }
function shieldHit(m, hit, at0) {
  const p = m.p, dim = m.dim;
  m.hits.add(hit.id); m.bounces++; m.hitCount++;
  hurt(hit, 9 + Math.min(4, m.hitCount - 1), p);   // each link in the chain hits a little harder
  try { hit.applyKnockback({ x: m.dir.x * 1.2, z: m.dir.z * 1.2 }, 0.3); } catch { }
  stun(hit, 14);
  clang(m, at(hit.location, 0, 1, 0)); sound(dim, "origin.sfx.heavyhit", hit.location, 1.2, 0.8);
  if (m.hitCount >= 2) hudMsg(p, `§e§lRICOCHET §r§fx${m.hitCount}`, 16);
}
function stepShield(m) {
  const dim = m.dim, p = m.p;
  if (m.phase === "out") {
    const n = 4;
    for (let s = 0; s < n && m.phase === "out"; s++) {
      const len = m.speed / n, step = V.mul(m.dir, len), next = V.add(m.pos, step);
      const hit = creatures(dim, next, 2.6, p).find((e) => !m.hits.has(e.id) && bodyHit(e, next));
      if (hit) {
        shieldHit(m, hit, next);
        const nxt = m.bounces < MAX_BOUNCES ? ricochetFrom(m, next) : null;
        if (nxt) m.dir = V.norm(V.sub(at(nxt.location, 0, 1, 0), next)); else m.phase = "back";
        m.pos = next;
        break;
      }
      // walls: find the face we hit and bounce off it properly
      let rh = null;
      try { rh = dim.getBlockFromRay(m.pos, m.dir, { maxDistance: len + 0.25, includePassableBlocks: false, includeLiquidBlocks: false }); } catch { }
      if (rh?.block && isSolidBlock(rh.block)) {
        const L = rh.block.location, pt = { x: L.x + rh.faceLocation.x, y: L.y + rh.faceLocation.y, z: L.z + rh.faceLocation.z };
        const nrm = NORMAL[String(rh.face)] ?? V.mul(m.dir, -1);
        let d = reflect(m.dir, nrm);
        m.pos = V.add(pt, V.mul(nrm, 0.3));
        const bank = bankTarget(m, m.pos, d);
        if (bank) d = V.norm(V.sub(at(bank.location, 0, 1, 0), m.pos));
        m.dir = d; m.bounces++; m.walls++; m.speed = Math.max(1.0, m.speed * 0.93);
        clang(m, m.pos);
        sound(dim, "random.orb", m.pos, 0.6 + Math.random() * 0.2, 0.5);   // the ring of it
        if (m.bounces >= MAX_BOUNCES) m.phase = "back";
        break;
      }
      // fallback for blocks the ray can't see (inside a block already): the old axis flip
      let blk; try { blk = dim.getBlock(next); } catch { m.phase = "back"; break; }
      if (blk && isSolidBlock(blk)) {
        const solid = (o) => { try { return isSolidBlock(dim.getBlock(V.add(m.pos, o))); } catch { return true; } };
        const d = { ...m.dir };
        if (solid({ x: step.x, y: 0, z: 0 })) d.x = -d.x;
        if (solid({ x: 0, y: step.y, z: 0 })) d.y = -d.y;
        if (solid({ x: 0, y: 0, z: step.z })) d.z = -d.z;
        if (d.x === m.dir.x && d.y === m.dir.y && d.z === m.dir.z) { d.x = -d.x; d.z = -d.z; }
        m.dir = V.norm(d); m.bounces++;
        clang(m, m.pos);
        if (m.bounces >= MAX_BOUNCES) m.phase = "back";
        break;
      }
      m.pos = next;
    }
    m.dist += m.speed;
    if (m.phase === "out" && m.dist >= 30) m.phase = "back";
  } else {
    const hand = handPos(p);
    if (p.dimension.id !== dim.id || V.dist(hand, m.pos) > 160) return catchShield(p, m);
    m.backT = (m.backT ?? 0) + 1;
    const sp = Math.min(2.6, 1.0 + m.backT * 0.1), to = V.sub(hand, m.pos), L = V.len(to);
    if (L <= sp + 0.6) return catchShield(p, m);
    // boomerang: turn toward the hand a bit more each tick instead of snapping straight at it
    const want = V.mul(to, 1 / L), turn = Math.min(1, 0.22 + m.backT * 0.04);
    m.dir = V.norm(V.lerp(m.dir, want, turn));
    m.pos = V.add(m.pos, V.mul(m.dir, sp));
    const hit = creatures(dim, m.pos, 2.4, p).find((e) => !m.hits.has(e.id) && e.typeId !== "minecraft:player" && bodyHit(e, m.pos));
    if (hit) shieldHit(m, hit, m.pos);
  }
  try { m.e.teleport(m.pos, { rotation: { x: 0, y: (Math.atan2(-m.dir.x, m.dir.z) * 180) / Math.PI } }); } catch { }
  if (m.t % 2 === 0) fx(dim, "origin:streak_glow", m.pos, STEEL, 0.5, { dx: -m.dir.x, dy: -m.dir.y, dz: -m.dir.z, len: 0.9, w: 0.1, spd: 0.1, life: 0.1 });
  if (m.t % 5 === 0) sound(dim, "origin.sfx.swoosh", m.pos, 1.6, 0.35);
}
function catchShield(p, m) {
  shields.delete(p.id);
  try { if (valid(m.e)) m.e.remove(); } catch { }
  if (!valid(p)) return;
  putBack(p);
  hero(p).shieldOut = false; saveNow(p);
  sound(p.dimension, "item.shield.block", p.location, 1.4, 0.8); sound(p.dimension, "random.anvil_land", p.location, 2, 0.2);
  fx(p.dimension, "origin:spark", handPos(p), BRONZE, 1);
  shake(p, 0.12, 0.12);
  if (m.hitCount >= 3) {   // TRICK SHOT: the rest of your kit comes back
    const r = RT(p);
    r.shCharge = 0; r.shSlam = 0;
    hudMsg(p, `§e§lTRICK SHOT §r§fx${m.hitCount}${m.walls ? ` §7(${m.walls} bank${m.walls > 1 ? "s" : ""})` : ""} §8- charge & slam ready`, 40);
    sound(p.dimension, "random.levelup", p.location, 1.6, 0.4);
  }
}
function putBack(p) {
  const c = container(p);
  if (!c) return;
  let done = false;
  try {
    for (let i = 0; i < c.size; i++) if (c.getItem(i)?.typeId === SHIELD) done = true;   // already there: never a second one
    if (c.getItem(p.selectedSlotIndex)?.typeId === SHIELD_STRAP) { c.setItem(p.selectedSlotIndex, done ? undefined : shieldStack()); done = true; }
    for (let i = 0; i < c.size; i++) {
      if (c.getItem(i)?.typeId !== SHIELD_STRAP) continue;
      if (!done) { c.setItem(i, shieldStack()); done = true; } else c.setItem(i, undefined);
    }
    if (!done) { const left = c.addItem(shieldStack()); if (left) p.dimension.spawnItem(left, p.location); }
  } catch { }
}
export function restoreShield(p) {
  const h = hero(p);
  if (!h.shieldOut || shields.has(p.id)) return;
  putBack(p);
  h.shieldOut = false; saveNow(p);
}
export function onGearLeave(id) { const m = shields.get(id); if (m) { try { if (valid(m.e)) m.e.remove(); } catch { } shields.delete(id); } }

// ------------------------------------------------------------------ the shield: charge and slam
async function shieldCharge(p) {
  if (!cdOk(p, "shCharge", 120)) return;
  const dim = p.dimension, f = V.flat(p.getViewDirection()), seen = new Set();
  play(p, "animation.origin.shield.charge", "0");
  sound(dim, "origin.sfx.windblast", p.location, 1.1, 0.8);
  for (let k = 0; k < 10; k++) {
    if (!valid(p)) return;
    let ahead; try { ahead = dim.getBlock(at(p.location, f.x * 1.1, 0.6, f.z * 1.1)); } catch { }
    if (ahead && isSolidBlock(ahead)) { clang({ dim }, at(p.location, f.x, 1, f.z)); shake(p, 0.3, 0.25); break; }
    try { p.applyKnockback({ x: f.x * 1.4, z: f.z * 1.4 }, 0.02); } catch { }
    for (const e of creatures(dim, at(p.location, f.x * 1.2, 0, f.z * 1.2), 1.8, p)) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      hurt(e, 7, p);
      try { e.applyKnockback({ x: f.x * 2.2, z: f.z * 2.2 }, 0.5); } catch { }
      stun(e, 20);
      clang({ dim }, at(e.location, 0, 1, 0)); sound(dim, "origin.sfx.heavyhit", e.location, 1, 1);
      shake(p, 0.2, 0.15);
    }
    if (k % 2 === 0) fx(dim, "origin:dust", p.location, C.dust, 0.6);
    await wait(1);
  }
  if (valid(p)) clear(p);
}
async function shieldSlam(p) {
  if (!cdOk(p, "shSlam", 160)) return;
  const dim = p.dimension;
  play(p, "animation.origin.mjolnir.slam");
  if (p.isOnGround) { try { p.applyKnockback({ x: 0, z: 0 }, 0.7); } catch { } }
  await wait(6);
  if (!valid(p)) return;
  RT(p).flyGrace = now() + 60;
  try { p.applyKnockback({ x: 0, z: 0 }, -2.2); } catch { }
  for (let k = 0; k < 24 && valid(p) && !p.isOnGround; k++) await wait(1);
  if (!valid(p)) return;
  const c = { ...p.location };
  fx(dim, "origin:shockwave", at(c, 0, 0.1, 0), BRONZE, 1, { radius: 5 }); fx(dim, "origin:shockwave", at(c, 0, 0.5, 0), WHITE, 1, { radius: 2.5 }); fx(dim, "origin:debris", c, C.dust, 1); fx(dim, "origin:dust", c, C.dust, 1);
  sound(dim, "random.anvil_land", c, 0.6, 1); sound(dim, "origin.sfx.stonecrash", c, 0.9, 1);
  try { for (const q of dim.getPlayers({ location: c, maxDistance: 16 })) shake(q, 0.4, 0.35); } catch { }
  for (const e of creatures(dim, c, 5, p)) {
    const d = V.flat(V.sub(e.location, c));
    hurt(e, 8, p);
    try { e.applyKnockback({ x: d.x * 1.1, z: d.z * 1.1 }, 0.75); } catch { }
    stun(e, 24);
  }
}

// ------------------------------------------------------------------ the shield: melee (bash, bash, UPPERCUT)
function shieldBash(p, target) {
  const r = RT(p), t = now(), dim = p.dimension;
  if ((r.shBashAt ?? 0) > t) return;
  r.shBashAt = t + 4;
  r.shCombo = t - (r.shBashLast ?? -99) < 30 ? (r.shCombo ?? 0) + 1 : 1;
  r.shBashLast = t;
  const d = V.flat(V.sub(target.location, p.location)), n = r.shCombo % 3;
  play(p, "animation.origin.shield.bash");
  system.run(() => {
    if (!valid(target)) return;
    if (n === 0) {   // third in a row: the uppercut
      hurt(target, 6, p);
      try { target.applyKnockback({ x: d.x * 0.4, z: d.z * 0.4 }, 0.95); } catch { }
      stun(target, 30);
      fx(dim, "origin:flash", at(target.location, 0, 1.2, 0), BRONZE, 1, { size: 1.3 }); fx(dim, "origin:shockwave", at(target.location, 0, 0.2, 0), WHITE, 0.9, { radius: 1.6 });
      sound(dim, "origin.sfx.heavyhit", target.location, 0.9, 1); sound(dim, "random.anvil_land", target.location, 1.4, 0.4);
      shake(p, 0.2, 0.15);
      hudMsg(p, "§e§lSHIELD UPPERCUT", 16);
    } else {
      hurt(target, 2, p);
      try { target.applyKnockback({ x: d.x * (n === 2 ? 1.4 : 1.0), z: d.z * (n === 2 ? 1.4 : 1.0) }, 0.3); } catch { }
      if (n === 2) stun(target, 10);
      fx(dim, "origin:spark", at(target.location, 0, 1.2, 0), BRONZE, 1);
      sound(dim, "item.shield.block", target.location, 1.2 + n * 0.1, 0.7);
    }
  });
}

// ------------------------------------------------------------------ shock batons
export function onGearMelee(p, target) {
  const id = heldId(p);
  if (!valid(target)) return;
  if (id === SHIELD) return shieldBash(p, target);
  if (id === GAUNTLETS) return ambushHit(p, target);
  if (id !== BATONS) return;
  const r = RT(p), t = now(), dim = p.dimension;
  if ((r.batonAt ?? 0) > t) return;
  r.batonAt = t + 4;
  r.batonCombo = t - (r.batonLast ?? -99) < 30 ? (r.batonCombo ?? 0) + 1 : 1;
  r.batonLast = t;
  ambushHit(p, target);
  system.run(() => {
    if (!valid(target)) return;
    hurt(target, 2, p, EntityDamageCause.magic);
    stun(target, 14);
    fx(dim, "origin:spark", at(target.location, 0, 1.1, 0), SHOCK, 1);
    try { bolt(dim, handPos(p), at(target.location, 0, 1.1, 0), ZAP, { life: 0.08, fork: false }); } catch { }
    sound(dim, "origin.sfx.shock", target.location, 1.4, 0.6);
    if (r.batonCombo % 3 === 0) {   // flip kick
      play(p, "animation.origin.agent.kick");
      const d = V.flat(V.sub(target.location, p.location));
      system.runTimeout(() => {
        if (!valid(target)) return;
        hurt(target, 5, p);
        try { target.applyKnockback({ x: d.x * 2.0, z: d.z * 2.0 }, 0.55); } catch { }
        fx(dim, "origin:flare", at(target.location, 0, 1.2, 0), WHITE, 1); sound(dim, "origin.sfx.punch", target.location, 0.8, 1);
        hudMsg(p, "§b§lFLIP KICK", 14);
      }, 3);
    }
  });
}
async function chainShock(p) {
  if (!cdOk(p, "batShock", 100)) return;
  const first = lookE(p, 10), dim = p.dimension;
  play(p, "animation.origin.agent.dart");
  if (!first) { hudMsg(p, "§7Nothing to shock.", 20); RT(p).batShock = now() + 10; return; }
  const chain = [first], seen = new Set([first.id]);
  for (let k = 0; k < 3; k++) {
    const last = chain[chain.length - 1];
    const nxt = creatures(dim, last.location, 6, p).filter((e) => !seen.has(e.id) && e.typeId !== "minecraft:player").sort((a, b) => V.dist(a.location, last.location) - V.dist(b.location, last.location))[0];
    if (!nxt) break;
    seen.add(nxt.id); chain.push(nxt);
  }
  sound(dim, "origin.sfx.shock", p.location, 1, 1);
  let from = handPos(p);
  for (const e of chain) {
    if (!valid(e)) continue;
    const to = at(e.location, 0, 1.1, 0);
    try { bolt(dim, from, to, ZAP, { life: 0.18 }); } catch { }
    hurt(e, 6, p, EntityDamageCause.magic);
    stun(e, 30);
    fx(dim, "origin:spark", to, SHOCK, 1); sound(dim, "origin.sfx.shock", to, 1.2, 0.7);
    from = to;
    await wait(2);
  }
}
async function takedown(p) {
  const e = lookE(p, 5);
  if (!e) { hudMsg(p, "§7Get close to someone first.", 20); return; }
  if (!cdOk(p, "batTake", 200)) return;
  const dim = p.dimension;
  play(p, "animation.origin.agent.takedown");
  const d = V.flat(V.sub(e.location, p.location));
  try { p.applyKnockback({ x: d.x * 0.9, z: d.z * 0.9 }, 0.55); } catch { }
  sound(dim, "origin.sfx.swoosh", p.location, 1.3, 1);
  await wait(9);
  if (!valid(e) || !valid(p)) return;
  hurt(e, 12, p);
  stun(e, 60);
  try { e.applyKnockback({ x: d.x * 0.3, z: d.z * 0.3 }, -1.2); } catch { }
  fx(dim, "origin:shockwave", at(e.location, 0, 0.1, 0), SHOCK, 1, { radius: 2 }); fx(dim, "origin:dust", e.location, C.dust, 0.8);
  try { bolt(dim, handPos(p), at(e.location, 0, 0.8, 0), ZAP, { life: 0.15 }); } catch { }
  sound(dim, "origin.sfx.heavyhit", e.location, 0.8, 1); sound(dim, "origin.sfx.shock", e.location, 0.9, 1);
  shake(p, 0.3, 0.25);
  hudMsg(p, "§b§lTAKEDOWN", 20);
}

// ------------------------------------------------------------------ agent gauntlets
async function dart(p) {
  if (!cdOk(p, "gDart", 16)) return;
  const dim = p.dimension, dir = V.norm(p.getViewDirection());
  play(p, "animation.origin.agent.dart");
  sound(dim, "origin.sfx.click", p.location, 1.6, 0.8);
  let pos = handPos(p);
  for (let s = 0; s < 32; s++) {
    const next = V.add(pos, V.mul(dir, 1));
    const e = creatures(dim, next, 2.6, p).find((x) => bodyHit(x, next));
    if (e) {
      hurt(e, 5, p);
      stun(e, 40);
      fx(dim, "origin:spark", next, SHOCK, 1);
      try { bolt(dim, next, at(e.location, 0, 0.2, 0), ZAP, { life: 0.1, fork: false }); } catch { }
      sound(dim, "origin.sfx.shock", next, 1.5, 0.8);
      return;
    }
    let blk; try { blk = dim.getBlock(next); } catch { return; }
    if (blk && isSolidBlock(blk)) { fx(dim, "origin:spark", pos, SHOCK, 1); sound(dim, "origin.sfx.click", pos, 2, 0.6); return; }
    if (s % 2 === 0) fx(dim, "origin:streak_glow", next, SHOCK, 0.7, { dx: dir.x, dy: dir.y, dz: dir.z, len: 0.8, w: 0.05, spd: 0.2, life: 0.08 });
    pos = next;
    if (s % 6 === 5) await wait(1);
  }
}
async function grapple(p) {
  if (!cdOk(p, "gGrap", 40)) return;
  const dim = p.dimension, e = lookE(p, 24);
  play(p, "animation.origin.agent.grapple");
  sound(dim, "origin.sfx.click", p.location, 0.9, 1);
  if (e) {   // yank them to you
    const line = tether(dim, () => handPos(p), e, "chain", { life: 12, grow: 3, shrink: 4 });
    await wait(3);
    if (!valid(e) || !valid(p)) return;
    const d = V.norm(V.sub(p.location, e.location));
    try { e.applyKnockback({ x: d.x * 2.4, z: d.z * 2.4 }, 0.45); } catch { }
    stun(e, 20);
    sound(dim, "origin.sfx.chains", e.location, 1.3, 0.8);
    line?.extend?.(4);
    return;
  }
  const b = lookB(p, 30);
  if (!b) { hudMsg(p, "§7Nothing to hook.", 20); RT(p).gGrap = now() + 6; return; }
  const anchor = b.pt;
  const line = tether(dim, () => handPos(p), anchor, "chain", { life: 40, grow: 3 });
  sound(dim, "origin.sfx.chains", anchor, 1.4, 0.8); fx(dim, "origin:spark", anchor, STEEL, 1);
  await wait(3);
  RT(p).flyGrace = now() + 80;
  for (let k = 0; k < 30; k++) {
    if (!valid(p)) break;
    const to = V.sub(anchor, at(p.location, 0, 1, 0)), L = V.len(to);
    if (L < 1.6) break;
    const u = V.mul(to, 1 / L), sp = Math.min(1.6, 0.6 + k * 0.08);
    try { p.applyKnockback({ x: u.x * sp, z: u.z * sp }, u.y * sp + 0.12); } catch { }
    await wait(1);
  }
  line?.reel?.(4);
}
function ghost(p) {
  if (!cdOk(p, "gGhost", 600)) return;
  try { p.addEffect("invisibility", 200, { showParticles: false }); p.addEffect("speed", 200, { amplifier: 1, showParticles: false }); } catch { }
  RT(p).ghostUntil = now() + 200;
  fx(p.dimension, "origin:dust", p.location, C.white, 0.8);
  sound(p.dimension, "origin.sfx.poof", p.location, 1.3, 0.6);
  hudMsg(p, "§b§lGHOST §r§7- unseen for ten seconds. Your first strike is an ambush.", 60);
}
function ambushHit(p, target) {
  const r = RT(p);
  if ((r.ghostUntil ?? 0) <= now()) return;
  r.ghostUntil = 0;
  try { p.removeEffect("invisibility"); } catch { }
  system.run(() => {
    if (!valid(target)) return;
    hurt(target, 6, p);
    stun(target, 40);
    fx(p.dimension, "origin:flare", at(target.location, 0, 1.2, 0), SHOCK, 1);
    sound(p.dimension, "origin.sfx.critical", target.location, 1.2, 1);
    hudMsg(p, "§b§lAMBUSH", 20);
  });
}

// ------------------------------------------------------------------ every tick
export function tickGear() {
  const t = now();
  for (const [id, m] of shields) {
    if (!valid(m.p)) { try { if (valid(m.e)) m.e.remove(); } catch { } shields.delete(id); continue; }
    if (!valid(m.e)) { try { m.e = m.dim.spawnEntity(THROWN, m.pos); } catch { catchShield(m.p, m); continue; } }
    m.t++;
    stepShield(m);
  }
  if (t % 2 !== 0) return;
  for (const p of world.getAllPlayers()) {
    const id = heldId(p), r = RT(p);
    if (GEAR.has(id)) tutorial(p, id);
    const guard = id === SHIELD && p.isSneaking;
    if (guard && !r.shieldGuard) { r.shieldGuard = true; play(p, "animation.origin.shield.guard", "0"); }
    else if (!guard && r.shieldGuard) { r.shieldGuard = false; clear(p); }
    if (id === BATONS && t % 20 === 0) fx(p.dimension, "origin:spark", handPos(p), SHOCK, 0.7);
  }
}
