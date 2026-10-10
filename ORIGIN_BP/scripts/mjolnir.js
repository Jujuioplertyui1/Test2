// ORIGIN v0.24 - mjolnir.js
// MJOLNIR, the thunder god's hammer from Norse myth (forged by the dwarf brothers Brokkr and Eitri). It rests on a
// rune stone in Asgard's palace hall, and only the WORTHY can lift it. Worthiness is honour: you earn it by protecting
// (beating monsters and bosses) and lose it by preying on the innocent (villagers, golems, pets, and players who never
// raised a hand against you). /hero honor shows yours.
//   hit            heavy blows that crack with lightning; every third one is a thunder smash
//   use            throw it: it flies head first, smashes through what it meets, and comes back to your hand.
//                  Use again (the empty strap) to call it back early - it comes through walls.
//   sneak + use    the Thunder menu: Lightning Call, Thunder Slam, Summon the Storm, Fly
//   double-tap jump while holding it: fly
// Unworthy hands can't hold it: it leaves them and goes home to Asgard.
import { world, system, ItemStack, EntityDamageCause, WeatherType } from "@minecraft/server";
import { hero, RT, markDirty, saveNow } from "./data.js";
import { V, at, valid, fx, sound, psound, now, msg, C, isSolidBlock, FX_IDS } from "./util.js";
import { hudMsg } from "./voice.js";
import { runCine, EASE } from "./cine.js";
import { startFlight, stopFlight, isFlying } from "./flight.js";
import { oform, show, ICONS } from "./forms.js";
import { bolt } from "./powers3.js";
import { destructionOn, crater } from "./impact.js";
import { ASGARD, asgardBuilt } from "./asgard.js";

export const MJ = "origin:mjolnir", STRAP = "origin:mjolnir_strap";
const THROWN = "origin:mjolnir_thrown", STONE = "origin:mjolnir_stone";
const STONE_AT = { x: 0.5, y: 102, z: 19.5 };   // in the palace hall, before the empty throne
const WORTHY = 20;
const SKY = { red: 0.55, green: 0.8, blue: 1 }, WHITE = { red: 1, green: 1, blue: 1 };
const STORM_BOLT = { core: WHITE, glow: SKY, width: 0.17, coreW: 0.055, flare: 0.7, impact: 1.3, glowA: 0.9 };
const ARC = { core: WHITE, glow: SKY, width: 0.08, coreW: 0.025, flare: 0.25, impact: 0.45, glowA: 0.85 };
const SKIP = new Set([...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:lightning_bolt", THROWN, STONE, "origin:shield_thrown", "origin:float_text", "origin:exo_piece", "origin:exo_drone"]);
const BOSSES = /origin:(xox|villain|rift_brute|null)|minecraft:(wither|ender_dragon|warden|elder_guardian)/;
const wait = (t) => system.waitTicks(Math.max(1, Math.floor(t)));
const container = (p) => { try { return p.getComponent("minecraft:inventory").container; } catch { return null; } };
const held = (p) => { try { return container(p).getItem(p.selectedSlotIndex); } catch { return undefined; } };
export const holdingMj = (p) => held(p)?.typeId === MJ;
const play = (p, a, stop) => { try { p.playAnimation(a, { controller: "origin_mj", ...(stop !== undefined ? { stopExpression: stop } : {}), blendOutTime: 0.2 }); } catch { } };
const clear = (p) => play(p, "animation.origin.clear", "1");
const shake = (p, a, t) => { try { p.runCommand(`camerashake add @s ${a} ${t} positional`); } catch { } };
const shakeNear = (dim, c, r, a) => { try { for (const q of dim.getPlayers({ location: c, maxDistance: r })) shake(q, a, 0.4); } catch { } };
const setProp = (e, k, v) => { try { e.setProperty(k, v); } catch { } };
const handPos = (p) => { const h = p.getHeadLocation(), d = p.getViewDirection(); return { x: h.x - d.z * 0.38 + d.x * 0.5, y: h.y - 0.55 + d.y * 0.3, z: h.z + d.x * 0.38 + d.z * 0.5 }; };
function cdOk(p, k, n) {
  const r = RT(p), t = now();
  if ((r[k] ?? 0) > t) { hudMsg(p, `§7Recharging §b${((r[k] - t) / 20).toFixed(1)}s`, 20); return false; }
  r[k] = t + n;
  return true;
}
// Every hammer lifted from the stone carries its lifter's id and a serial number. Lifting it again (or /hero mjolnir)
// bumps the serial, and any older copy fades the moment someone holds it - so the stone can't be farmed.
const serialKey = (owner) => `origin:mj:${owner}`;
function newSerial(p) { const k = serialKey(p.id), n = (Number(world.getDynamicProperty(k)) || 0) + 1; world.setDynamicProperty(k, n); return n; }
function stampOf(it) { try { const o = it?.getDynamicProperty("origin:owner"); return o ? { o: String(o), s: Number(it.getDynamicProperty("origin:serial")) || 0 } : null; } catch { return null; } }
function stale(it) { const st = stampOf(it); if (!st) return false; return Number(world.getDynamicProperty(serialKey(st.o)) ?? 0) !== st.s; }
function hammerStack(stamp) {
  const s = new ItemStack(MJ, 1);
  try { s.keepOnDeath = true; s.setLore(["§7Forged by the dwarf brothers Brokkr and Eitri.", "§7Its handle came out short. §8(Loki's doing.)", "§8Only the worthy can lift it."]); } catch { }
  if (stamp) { try { s.setDynamicProperty("origin:owner", stamp.o); s.setDynamicProperty("origin:serial", stamp.s); } catch { } }
  return s;
}
const sameStamp = (it, st) => { const a = stampOf(it); return !st ? !a : !!a && a.o === st.o && a.s === st.s; };
function strapStack() { const s = new ItemStack(STRAP, 1); try { s.keepOnDeath = true; s.setLore(["§7Mjolnir is out there.", "§8Use: call it back."]); } catch { } return s; }

// ------------------------------------------------------------------ honour
export const honorOf = (p) => hero(p).honor ?? 10;
export function worthy(p) {
  try { if (String(p.getGameMode()).toLowerCase() === "creative") return true; } catch { }
  return honorOf(p) >= WORTHY;
}
export function addHonor(p, n, why) {
  const h = hero(p), before = h.honor ?? 10;
  h.honor = Math.max(-100, Math.min(100, before + n));
  markDirty(p);
  if (before < WORTHY && h.honor >= WORTHY) { hudMsg(p, "§b§lYou feel worthy. §r§7Far above the clouds, a hammer stirs.", 90); psound(p, "origin.sfx.thunder", 1.3, 0.35); }
  else if (n < 0) hudMsg(p, `§c${why} §8(honor ${h.honor}${before >= WORTHY && h.honor < WORTHY ? " - you are no longer worthy" : ""})`, 70);
}
// who started it: players remember who hit them, so defending yourself is never dishonourable
export function onMjHurt(victim, by) {
  if (victim?.typeId !== "minecraft:player" || by?.typeId !== "minecraft:player" || victim === by) return;
  const r = RT(victim);
  r.hitBy ??= {};
  r.hitBy[by.id] = now();
}
export function onMjKill(killer, dead) {
  if (killer?.typeId !== "minecraft:player" || !dead || dead === killer) return;
  const id = dead.typeId;
  let tamed = false; try { tamed = !!dead.getComponent("minecraft:is_tamed"); } catch { }
  if (id === "minecraft:player") {
    const r = RT(killer), struck = (r.hitBy?.[dead.id] ?? -99999) > now() - 1200;
    if (!struck) addHonor(killer, -15, "You killed a hero who never raised a hand against you.");
    return;
  }
  if (/minecraft:(villager|villager_v2|wandering_trader)/.test(id)) return addHonor(killer, -15, "You struck down an innocent.");
  if (/minecraft:(iron_golem|snow_golem)/.test(id)) return addHonor(killer, -10, "You struck down a protector.");
  if (tamed) return addHonor(killer, -20, "You slew someone's companion.");
  if (BOSSES.test(id)) return addHonor(killer, 5);
  let monster = false; try { monster = dead.matches({ families: ["monster"] }); } catch { }
  if (monster) addHonor(killer, 1);
}

// ------------------------------------------------------------------ throwing it
const flying = new Map();   // player id -> the hammer in flight
export const mjOut = (p) => flying.has(p.id);
function spawnThrown(dim, loc) { try { return dim.spawnEntity(THROWN, loc); } catch { return null; } }
function kill(e) { try { if (valid(e)) e.remove(); } catch { } }
function orient(m, d) {
  const yaw = (Math.atan2(-d.x, d.z) * 180) / Math.PI, pitch = Math.round(Math.max(-90, Math.min(90, (-Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI)));
  try { m.e.teleport(m.pos, { rotation: { x: 0, y: yaw } }); } catch { }
  if (pitch !== m.pitch) { m.pitch = pitch; setProp(m.e, "origin:pitch", pitch); }
}
function creatureAt(dim, pos, owner, seen) {
  let list = [];
  try { list = dim.getEntities({ location: pos, maxDistance: 2.6, excludeFamilies: ["inanimate"] }); } catch { return null; }
  for (const e of list) {
    if (e === owner || SKIP.has(e.typeId) || seen.has(e.id)) continue;
    try {
      const l = e.location, top = e.getHeadLocation().y + 0.3;
      if (Math.hypot(l.x - pos.x, l.z - pos.z) < 0.95 && pos.y > l.y - 0.3 && pos.y < top) return e;
    } catch { }
  }
  return null;
}
function strike(m, e, back) {
  const dim = m.dim, p = m.p, d = back ? V.norm(V.sub(e.location, m.pos)) : m.dir;
  try { e.applyDamage(back ? 8 : 14, { cause: EntityDamageCause.entityAttack, damagingEntity: p }); } catch { }
  try { e.applyKnockback({ x: d.x * 2.2, z: d.z * 2.2 }, 0.45); } catch { }
  try { bolt(dim, at(e.location, (Math.random() - 0.5) * 2, 7, (Math.random() - 0.5) * 2), at(e.location, 0, 1, 0), ARC, { life: 0.15 }); } catch { }
  fx(dim, "origin:flare", at(e.location, 0, 1, 0), SKY, 1); fx(dim, "origin:spark", at(e.location, 0, 1, 0), WHITE, 1);
  sound(dim, "origin.sfx.heavyhit", e.location, 0.8, 1); sound(dim, "origin.sfx.thunderhit", e.location, 1.1, 0.7);
  shakeNear(dim, e.location, 10, 0.25);
}
function trail(m) {
  const dim = m.dim;
  fx(dim, "origin:spark", m.pos, SKY, 1);
  if (m.t % 2 === 0) fx(dim, "origin:streak_glow", m.pos, SKY, 0.5, { dx: -m.lastDir.x, dy: -m.lastDir.y, dz: -m.lastDir.z, len: 1.2, w: 0.08, spd: 0.1, life: 0.12 });
  if (m.t % 4 === 0) { try { const q = V.add(m.pos, { x: (Math.random() - 0.5) * 1.6, y: (Math.random() - 0.5) * 1.2, z: (Math.random() - 0.5) * 1.6 }); bolt(dim, m.pos, q, ARC, { life: 0.08, fork: false }); } catch { } }
  if (m.t % 6 === 0) sound(dim, "origin.sfx.wind", m.pos, 1.5, 0.5);
}
export function throwHammer(p) {
  if (flying.has(p.id)) return recall(p);
  if (!worthy(p)) return;
  const slot = p.selectedSlotIndex;
  play(p, "animation.origin.mjolnir.throw");
  sound(p.dimension, "origin.sfx.swoosh", p.location, 0.7, 1);
  system.runTimeout(() => {   // let go on the throw frame
    if (!valid(p) || flying.has(p.id)) return;
    const c = container(p), it = c?.getItem(slot);
    if (!c || it?.typeId !== MJ || stale(it)) return;
    const stamp = stampOf(it);
    c.setItem(slot, strapStack());
    const h = hero(p); h.mjOut = true; h.mjStamp = stamp; saveNow(p);   // saved at once: a quick log-off can't lose or copy it
    const dir = V.norm(p.getViewDirection()), pos = V.add(handPos(p), V.mul(dir, 0.8));
    const e = spawnThrown(p.dimension, pos);
    if (!e) { c.setItem(slot, hammerStack(stamp)); h.mjOut = false; saveNow(p); return; }
    const m = { p, e, pos, dir, lastDir: dir, phase: "out", t: 0, dist: 0, hits: new Set(), backHits: new Set(), dim: p.dimension, speed: 1.8, range: 30, pitch: 999, stamp };
    flying.set(p.id, m);
    orient(m, dir);
    sound(p.dimension, "origin.sfx.thunder", p.location, 1.7, 0.3); sound(p.dimension, "origin.sfx.windblast", p.location, 1.2, 0.6);
    shake(p, 0.15, 0.2);
  }, 4);
}
export function recall(p) {
  const m = flying.get(p.id);
  if (!m) {
    if (hero(p).mjOut) { restoreMj(p); return; }
    // an empty strap with no hammer out there: it was a leftover
    try { const c = container(p), it = c.getItem(p.selectedSlotIndex); if (it?.typeId === STRAP) c.setItem(p.selectedSlotIndex, undefined); } catch { }
    hudMsg(p, "§7The strap hangs empty.", 30);
    return;
  }
  if (m.phase === "back") return;
  m.phase = "back";
  play(p, "animation.origin.mjolnir.catch");
  hudMsg(p, "§bMjolnir answers.", 25);
  sound(m.dim, "origin.sfx.thunder", m.pos, 1.5, 0.4);
}
function stepOut(m) {
  const dim = m.dim, p = m.p, n = 4, d = V.mul(m.dir, m.speed / n);
  for (let s = 0; s < n && m.phase === "out"; s++) {
    const next = V.add(m.pos, d);
    const e = creatureAt(dim, next, p, m.hits);
    if (e) { m.hits.add(e.id); strike(m, e, false); if (m.hits.size >= 3) m.phase = "back"; }
    let blk; try { blk = dim.getBlock(next); } catch { m.phase = "back"; break; }
    if (blk && isSolidBlock(blk)) {
      fx(dim, "origin:shockwave", m.pos, SKY, 1, { radius: 1.6 }); fx(dim, "origin:debris", m.pos, C.dust, 1); fx(dim, "origin:shards", m.pos, C.dust, 1);
      sound(dim, "origin.sfx.stonecrash", m.pos, 0.9, 1); sound(dim, "origin.sfx.thunderhit", m.pos, 1, 0.6);
      if (destructionOn()) crater(dim, next, 1);
      shakeNear(dim, m.pos, 12, 0.2);
      m.phase = "back";
      break;
    }
    m.pos = next;
  }
  m.dist += m.speed;
  if (m.phase === "out" && m.dist >= m.range) m.phase = "back";
  m.lastDir = m.dir;
  orient(m, m.dir);
}
function stepBack(m) {
  const p = m.p, hand = handPos(p);
  if (p.dimension.id !== m.dim.id || V.dist(hand, m.pos) > 220) { catchIt(p, m); return; }
  m.backT = (m.backT ?? 0) + 1;
  const sp = Math.min(2.8, 1.1 + m.backT * 0.12), to = V.sub(hand, m.pos), L = V.len(to);
  if (L <= sp + 0.7) { catchIt(p, m); return; }
  const u = V.mul(to, 1 / L), n = 4;
  for (let s = 0; s < n; s++) {
    m.pos = V.add(m.pos, V.mul(u, sp / n));
    const e = creatureAt(m.dim, m.pos, p, m.backHits);
    if (e) { m.backHits.add(e.id); strike(m, e, true); }
  }
  m.lastDir = u;
  orient(m, V.mul(u, -1));   // handle first into your hand
}
function catchIt(p, m) {
  flying.delete(p.id);
  kill(m.e);
  if (!valid(p)) return;
  const h = hero(p);
  putBack(p, m.stamp);
  h.mjOut = false; h.mjStamp = null; saveNow(p);
  play(p, "animation.origin.mjolnir.catch");
  fx(p.dimension, "origin:flare", handPos(p), SKY, 1); fx(p.dimension, "origin:spark", handPos(p), WHITE, 1);
  sound(p.dimension, "origin.sfx.heavyhit", p.location, 1.3, 0.6); sound(p.dimension, "origin.sfx.thunder", p.location, 1.9, 0.25);
  shake(p, 0.18, 0.15);
}
// the hammer back into the inventory: where the strap is, else the first free slot, else at your feet - and never a
// second copy (if that very hammer is already in the inventory, the straps just go)
function putBack(p, stamp) {
  const c = container(p);
  if (!c) return;
  try {
    let have = false;
    for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it?.typeId === MJ && sameStamp(it, stamp)) have = true; }
    let done = have;
    const sel = c.getItem(p.selectedSlotIndex);
    if (sel?.typeId === STRAP) { c.setItem(p.selectedSlotIndex, done ? undefined : hammerStack(stamp)); done = true; }
    for (let i = 0; i < c.size; i++) {
      if (c.getItem(i)?.typeId !== STRAP) continue;
      if (!done) { c.setItem(i, hammerStack(stamp)); done = true; } else c.setItem(i, undefined);
    }
    if (!done) { const left = c.addItem(hammerStack(stamp)); if (left) p.dimension.spawnItem(left, p.location); }
  } catch { }
}
// a relog while it was out: it's back in your hand
export function restoreMj(p) {
  const h = hero(p);
  if (!h.mjOut || flying.has(p.id)) return;
  putBack(p, h.mjStamp ?? null);
  h.mjOut = false; h.mjStamp = null; saveNow(p);
  hudMsg(p, "§bMjolnir found its way back to you.", 50);
}
export function onMjLeave(id) { const m = flying.get(id); if (m) { kill(m.e); flying.delete(id); } }

// ------------------------------------------------------------------ in your hand
export function onMjMelee(p, target) {
  if (!holdingMj(p) || !valid(target) || !worthy(p)) return;
  const r = RT(p), t = now(), dim = p.dimension;
  if ((r.mjHitAt ?? 0) > t) return;
  r.mjHitAt = t + 6;
  r.mjCombo = t - (r.mjLast ?? -99) < 30 ? (r.mjCombo ?? 0) + 1 : 1;
  r.mjLast = t;
  const d = V.flat(V.sub(target.location, p.location));
  system.run(() => {
    if (!valid(target)) return;
    try { target.applyDamage(4, { cause: EntityDamageCause.lightning, damagingEntity: p }); } catch { }
    try { target.applyKnockback({ x: d.x * 1.1, z: d.z * 1.1 }, 0.38); } catch { }
    fx(dim, "origin:spark", at(target.location, 0, 1, 0), SKY, 1);
    try { bolt(dim, handPos(p), at(target.location, 0, 1, 0), ARC, { life: 0.1, fork: false }); } catch { }
    sound(dim, "origin.sfx.thunderhit", target.location, 1.3, 0.6);
    if (r.mjCombo % 3 === 0) {   // thunder smash
      try { bolt(dim, at(target.location, 0, 14, 0), at(target.location, 0, 0.2, 0), STORM_BOLT, { life: 0.22 }); } catch { }
      fx(dim, "origin:shockwave", at(target.location, 0, 0.1, 0), SKY, 1, { radius: 3.2 });
      sound(dim, "origin.sfx.thunder", target.location, 1.1, 0.9);
      for (const e of around(dim, target.location, 3.2, p)) { try { e.applyDamage(6, { cause: EntityDamageCause.lightning, damagingEntity: p }); e.applyKnockback({ x: 0, z: 0 }, 0.5); } catch { } }
      shakeNear(dim, target.location, 10, 0.3);
      hudMsg(p, "§b§lTHUNDER", 14);
    }
  });
}
function around(dim, c, r, owner) {
  try { return dim.getEntities({ location: c, maxDistance: r, excludeFamilies: ["inanimate"] }).filter((e) => e !== owner && !SKIP.has(e.typeId) && e.typeId !== "minecraft:player"); } catch { return []; }
}
function hostiles(p, r) {
  return around(p.dimension, p.location, r, p).filter((e) => { try { return e.matches({ families: ["monster"] }) || BOSSES.test(e.typeId); } catch { return false; } })
    .sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location));
}
// the unworthy can't hold it; and the worthy feel it crackle
function sendHome(p, slotItem) {
  const dim = p.dimension, c = container(p);
  try { c.setItem(p.selectedSlotIndex, slotItem ?? undefined); } catch { }
  try { bolt(dim, at(p.location, 0, 1.2, 0), at(p.location, 0, 30, 0), STORM_BOLT, { life: 0.25 }); } catch { }
  const e = spawnThrown(dim, at(p.location, 0, 1.2, 0));
  if (e) { setProp(e, "origin:pitch", -90); for (let k = 1; k <= 20; k++) system.runTimeout(() => { try { if (valid(e)) e.teleport(at(p.location, 0, 1.2 + k * 2, 0)); } catch { } if (k === 20) kill(e); }, k); }
  sound(dim, "origin.sfx.thunder", p.location, 1, 1);
  try { p.applyKnockback({ x: 0, z: 0 }, 0.4); } catch { }
  hudMsg(p, `§7Mjolnir will not stay in your hand. It goes home to Asgard. §8(honor ${honorOf(p)}/${WORTHY})`, 100);
}
function fade(p) {
  try { container(p).setItem(p.selectedSlotIndex, undefined); } catch { }
  fx(p.dimension, "origin:spark", handPos(p), SKY, 1); sound(p.dimension, "origin.sfx.thunder", p.location, 1.8, 0.3);
  hudMsg(p, "§7This hammer fades like an echo - Mjolnir was lifted from the stone again since it was made.", 80);
}
// every tick
export function tickMjolnir() {
  const t = now();
  for (const [id, m] of flying) {
    const p = m.p;
    if (!valid(p)) { kill(m.e); flying.delete(id); continue; }
    if (!valid(m.e)) { m.e = spawnThrown(m.dim, m.pos); if (!m.e) { catchIt(p, m); continue; } m.pitch = 999; }
    m.t++;
    if (m.phase === "out") stepOut(m); else stepBack(m);
    if (flying.has(id)) trail(m);
  }
  if (t % 4 !== 0) return;
  for (const p of world.getAllPlayers()) {
    if (!holdingMj(p)) continue;
    if (stale(held(p))) { fade(p); continue; }
    if (!worthy(p)) { sendHome(p); continue; }
    const r = RT(p);
    if (t % 16 === 0) fx(p.dimension, "origin:spark", handPos(p), SKY, 0.8);
    if (t % 60 === 0 && Math.random() < 0.5) { try { const hp = handPos(p); bolt(p.dimension, hp, V.add(hp, { x: (Math.random() - 0.5) * 1.2, y: -0.8, z: (Math.random() - 0.5) * 1.2 }), ARC, { life: 0.08, fork: false }); } catch { } }
    if ((r.mjStormUntil ?? 0) > t && t % 80 === 0) {   // the storm hunts your enemies while you hold it
      const e = hostiles(p, 22)[0];
      if (e) skyStrike(p, e, 8);
    }
  }
}
function skyStrike(p, e, dmg) {
  const dim = p.dimension;
  try { bolt(dim, at(e.location, (Math.random() - 0.5) * 3, 24, (Math.random() - 0.5) * 3), at(e.location, 0, 0.2, 0), STORM_BOLT, { life: 0.25, amp: 1.3 }); } catch { }
  if (destructionOn()) { try { dim.spawnEntity("minecraft:lightning_bolt", e.location); } catch { } }
  try { e.applyDamage(dmg, { cause: EntityDamageCause.lightning, damagingEntity: p }); e.applyKnockback({ x: 0, z: 0 }, 0.6); } catch { }
  fx(dim, "origin:shockwave", at(e.location, 0, 0.1, 0), SKY, 1, { radius: 2 }); fx(dim, "origin:flare", at(e.location, 0, 1, 0), WHITE, 1);
  sound(dim, "origin.sfx.thunder", e.location, 0.9, 1); sound(dim, "origin.sfx.lightning", e.location, 1, 0.8);
}

// ------------------------------------------------------------------ the Thunder menu
export async function thunderMenu(p) {
  const r = RT(p), t = now();
  const cd = (k) => ((r[k] ?? 0) > t ? ` §c${Math.ceil((r[k] - t) / 20)}s` : " §aready");
  const f = oform("menu", "Mjolnir", `§b§lMJOLNIR§r §8· honor §b${honorOf(p)}\n§7Use: throw it, use again to call it back. Double-tap jump: fly.`);
  const acts = [];
  const b = (txt, icon, act) => { f.button(txt, ICONS + icon); acts.push(act); };
  b(`Lightning Call${cd("mjCall")}\n§8Raise it: the sky strikes everything hostile near you`, "mj_lightning", "call");
  b(`Thunder Slam${cd("mjSlam")}\n§8Leap and bring it down in a ring of lightning`, "mj_slam", "slam");
  b(`Summon the Storm${cd("mjStorm")}\n§8Thunder rolls in; lightning hunts your enemies`, "mj_storm", "storm");
  b(isFlying(p) ? "Land" : "Fly\n§8or double-tap jump while you hold it", "mj_fly", "fly");
  b("Close", "act_back", "close");
  const res = await show(p, f);
  if (!res || res.canceled || !valid(p)) return;
  const act = acts[res.selection];
  if (!holdingMj(p) && act !== "close") return hudMsg(p, "§7Hold Mjolnir.", 30);
  if (act === "call") return lightningCall(p);
  if (act === "slam") return thunderSlam(p);
  if (act === "storm") return summonStorm(p);
  if (act === "fly") { if (isFlying(p)) stopFlight(p, "land"); else mjTakeoff(p); }
}
async function lightningCall(p) {
  if (!cdOk(p, "mjCall", 600)) return;
  const dim = p.dimension;
  play(p, "animation.origin.mjolnir.raise");
  sound(dim, "origin.sfx.charge", p.location, 0.8, 1);
  for (let k = 0; k < 14; k++) {
    if (!valid(p)) return;
    const top = at(p.location, 0, 3.1, 0);
    fx(dim, "origin:spark", top, SKY, 1);
    if (k % 4 === 0) { try { bolt(dim, at(p.location, (Math.random() - 0.5) * 6, 9, (Math.random() - 0.5) * 6), top, ARC, { life: 0.12 }); } catch { } }
    await wait(1);
  }
  if (!valid(p)) return;
  const top = at(p.location, 0, 3.1, 0);
  try { bolt(dim, at(p.location, 0, 30, 0), top, STORM_BOLT, { life: 0.32, amp: 1.2 }); } catch { }
  for (const q of dim.getPlayers({ location: p.location, maxDistance: 24 })) { try { q.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0.05, fadeOutTime: 0.35 }, fadeColor: { red: 0.85, green: 0.92, blue: 1 } }); } catch { } }
  sound(dim, "origin.sfx.thunder", p.location, 0.8, 1); sound(dim, "origin.sfx.lightning", p.location, 0.9, 1);
  shakeNear(dim, p.location, 24, 0.5);
  hudMsg(p, "§b§lLIGHTNING CALL", 20);
  const targets = hostiles(p, 18).slice(0, 8);
  targets.forEach((e, i) => system.runTimeout(() => {
    if (!valid(e) || !valid(p)) return;
    try { bolt(dim, at(p.location, 0, 3.1, 0), at(e.location, 0, 1, 0), STORM_BOLT, { life: 0.2 }); } catch { }
    skyStrike(p, e, 12);
    try { e.setOnFire(3, true); } catch { }
  }, 3 + i * 3));
}
async function thunderSlam(p) {
  if (!cdOk(p, "mjSlam", 240)) return;
  const dim = p.dimension;
  play(p, "animation.origin.mjolnir.slam");
  if (isFlying(p)) stopFlight(p, "interrupt");
  if (p.isOnGround) { try { p.applyKnockback({ x: 0, z: 0 }, 1.0); } catch { } }
  sound(dim, "origin.sfx.charge", p.location, 1.2, 0.8);
  await wait(7);
  if (!valid(p)) return;
  RT(p).flyGrace = now() + 80;
  try { p.applyKnockback({ x: 0, z: 0 }, -2.6); } catch { }
  for (let k = 0; k < 30 && valid(p) && !p.isOnGround; k++) { fx(dim, "origin:spark", at(p.location, 0, 1, 0), SKY, 1); await wait(1); }
  if (!valid(p)) return;
  const c = { ...p.location };
  fx(dim, "origin:shockwave", at(c, 0, 0.1, 0), SKY, 1, { radius: 6 }); fx(dim, "origin:shockwave", at(c, 0, 0.6, 0), WHITE, 1, { radius: 3.5 }); fx(dim, "origin:debris", c, C.dust, 1); fx(dim, "origin:dust", c, C.dust, 1);
  for (let k = 0; k < 8; k++) system.runTimeout(() => { const a = (k / 8) * Math.PI * 2; try { bolt(dim, at(c, Math.cos(a) * 4, 16, Math.sin(a) * 4), at(c, Math.cos(a) * 4, 0.1, Math.sin(a) * 4), STORM_BOLT, { life: 0.2 }); } catch { } }, k);
  sound(dim, "origin.sfx.stonecrash", c, 0.7, 1); sound(dim, "origin.sfx.thunder", c, 0.75, 1);
  if (destructionOn()) crater(dim, c, 1);
  shakeNear(dim, c, 20, 0.55);
  for (const e of around(dim, c, 6, p)) {
    const d = V.flat(V.sub(e.location, c)), fall = 1 - Math.min(1, V.dist(e.location, c) / 7);
    try { e.applyDamage(Math.round(6 + 10 * fall), { cause: EntityDamageCause.lightning, damagingEntity: p }); e.applyKnockback({ x: d.x * 1.4, z: d.z * 1.4 }, 0.8); } catch { }
  }
}
function summonStorm(p) {
  if (p.dimension.id !== "minecraft:overworld") return hudMsg(p, "§7The sky here doesn't answer to Midgard's storms.", 50);
  if (!cdOk(p, "mjStorm", 3600)) return;
  play(p, "animation.origin.mjolnir.raise");
  system.runTimeout(() => {
    if (!valid(p)) return;
    try { bolt(p.dimension, at(p.location, 0, 30, 0), at(p.location, 0, 3.1, 0), STORM_BOLT, { life: 0.3 }); } catch { }
    try { p.dimension.setWeather(WeatherType.Thunder, 2400); } catch { }
    RT(p).mjStormUntil = now() + 2400;
    sound(p.dimension, "origin.sfx.thunder", p.location, 0.6, 1);
    hudMsg(p, "§b§lTHE STORM ANSWERS §r§7- for two minutes, lightning hunts your enemies while you hold the hammer.", 90);
  }, 16);
}
// flight: double-tap jump while holding it (it pulls you through the air, arm out front)
export const canMjFly = (p) => holdingMj(p) && worthy(p) && !flying.has(p.id);
export function mjTakeoff(p) {
  play(p, "animation.origin.mjolnir.whirl", "0");
  system.runTimeout(() => valid(p) && clear(p), 12);
  sound(p.dimension, "origin.sfx.wind", p.location, 1.4, 1);
  startFlight(p, { kind: "mjolnir", maxTicks: 1200, onTick: (pp) => holdingMj(pp) });
}

// ------------------------------------------------------------------ the stone in Asgard
let stoneCheck = 0;
export function tickMjStone() {
  let dim;
  try { dim = world.getDimension(ASGARD); } catch { return; }
  const ps = world.getAllPlayers().filter((p) => { try { return p.dimension.id === ASGARD && V.dist(p.location, STONE_AT) < 64; } catch { return false; } });
  if (!ps.length) return;
  if (++stoneCheck % 4 === 0 && asgardBuilt("palace")) {
    let stones = [];
    try { stones = dim.getEntities({ type: STONE, location: STONE_AT, maxDistance: 6 }); } catch { return; }
    if (!stones.length) { try { const e = dim.spawnEntity(STONE, STONE_AT); e.teleport(STONE_AT, { rotation: { x: 0, y: 90 } }); } catch { } }
    for (const e of stones.slice(1)) kill(e);
  }
  for (const p of ps) {
    if (V.dist(p.location, STONE_AT) > 14) continue;
    const h = hero(p);
    if (!h.mjHint && asgardBuilt("palace")) { h.mjHint = 1; markDirty(p); hudMsg(p, `§bA hammer rests on a rune stone before the empty throne. §7Only the worthy can lift it. §8(your honor: ${honorOf(p)}/${WORTHY})`, 120); }
    fx(p.dimension, "origin:spark", at(STONE_AT, (Math.random() - 0.5) * 1.2, 0.8 + Math.random(), (Math.random() - 0.5) * 1.2), SKY, 0.8);
    if (Math.random() < 0.06) psound(p, "origin.sfx.thunder", 0.6, 0.15);
  }
}
const hasMj = (p) => {
  if (flying.has(p.id) || hero(p).mjOut) return true;
  const c = container(p);
  if (!c) return false;
  for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it?.typeId === MJ && !stale(it)) return true; }
  return false;
};
export async function onStoneInteract(p, e) {
  const r = RT(p);
  if (r.cine || (r.mjTry ?? 0) > now()) return;
  r.mjTry = now() + 50;
  if (hasMj(p)) { hudMsg(p, "§bMjolnir already answers to you.", 50); return; }
  const f = V.flat(V.sub(p.location, e.location)), spot = at(e.location, f.x * 1.3, 0, f.z * 1.3);
  try { p.teleport(spot, { facingLocation: at(e.location, 0, 1.0, 0) }); } catch { }
  if (worthy(p)) return lift(p, e, f);
  return strain(p, e);
}
async function strain(p, e) {
  const dim = p.dimension;
  play(p, "animation.origin.mjolnir.strain", "0");
  setProp(e, "origin:shake", 1);
  hudMsg(p, "§7You take hold of the handle and pull...", 40);
  for (let k = 0; k < 40; k++) {
    if (!valid(p) || !valid(e)) break;
    if (k % 8 === 0) { fx(dim, "origin:dust", at(e.location, 0, 0.7, 0), C.dust, 0.8); sound(dim, "origin.sfx.heavyhit", e.location, 0.4, 0.4); }
    await wait(1);
  }
  if (valid(e)) setProp(e, "origin:shake", 0);
  if (!valid(p)) return;
  clear(p);
  try { bolt(dim, at(e.location, 0, 1.6, 0), at(p.location, 0, 1.2, 0), ARC, { life: 0.15 }); } catch { }
  const d = V.flat(V.sub(p.location, e.location));
  try { p.applyKnockback({ x: d.x * 0.8, z: d.z * 0.8 }, 0.25); } catch { }
  sound(dim, "origin.sfx.shock", p.location, 1, 0.8);
  hudMsg(p, `§7It will not move for you. §8Honor ${honorOf(p)}/${WORTHY}: beat monsters and bosses to earn it - harming villagers, golems, pets or players who never fought you costs it.`, 140);
}
async function lift(p, e, f) {
  const dim = p.dimension, base = { ...e.location }, side = { x: -f.z, z: f.x };
  await runCine(p, async (c) => {
    c.lock();
    c.cam(at(base, f.x * 1.6 + side.x * 2.4, 0.35, f.z * 1.6 + side.z * 2.4), at(base, f.x * 0.9, 1.2, f.z * 0.9));
    c.say("§7you take hold of the handle...", 30);
    play(p, "animation.origin.mjolnir.lift");
    await c.wait(18);
    if (valid(e)) setProp(e, "origin:empty", 1);
    give(p);
    fx(dim, "origin:dust", at(base, 0, 0.7, 0), C.dust, 1); fx(dim, "origin:debris", at(base, 0, 0.7, 0), C.dust, 0.8);
    sound(dim, "origin.sfx.stonecrash", base, 1.2, 0.6);
    c.cam(at(base, f.x * 4.2 + side.x * 2.4, 0.9, f.z * 4.2 + side.z * 2.4), at(p.location, 0, 2.4, 0), 0.5, EASE.OutCubic);
    await c.wait(9);
    try { bolt(dim, at(p.location, 0, 30, 0), at(p.location, 0, 3.2, 0), STORM_BOLT, { life: 0.35, amp: 1.2 }); } catch { }
    c.fade(0, 0.05, 0.5, { red: 0.85, green: 0.93, blue: 1 }); c.shake(0.5, 0.6);
    sound(dim, "origin.sfx.thunder", p.location, 0.8, 1); sound(dim, "origin.sfx.lightning", p.location, 0.9, 1);
    fx(dim, "origin:shockwave", at(p.location, 0, 0.1, 0), SKY, 1, { radius: 5 });
    try { p.onScreenDisplay.setTitle("§b§lWORTHY", { fadeInDuration: 3, stayDuration: 45, fadeOutDuration: 12, subtitle: "§7the storm knows your hand" }); RT(p).titleUntil = now() + 64; } catch { }
    await c.wait(34);
  }, { skippable: false });
  if (valid(e)) system.runTimeout(() => { if (valid(e)) setProp(e, "origin:empty", 0); }, 160);   // the stone keeps its shape for the next worthy hand
  if (!valid(p)) return;
  hero(p).mjOwned = true; saveNow(p);
  msg(p, "§b§lMJOLNIR §r§7- use: throw it (use again to call it back) · sneak + use: Thunder menu · double-tap jump: fly · every 3rd hit: thunder.");
}
function give(p) {
  const c = container(p);
  if (!c) return;
  const s = hammerStack({ o: p.id, s: newSerial(p) });   // a new serial: any older hammer of yours fades
  try {
    if (!c.getItem(p.selectedSlotIndex)) { c.setItem(p.selectedSlotIndex, s); return; }
    const left = c.addItem(s);
    if (left) p.dimension.spawnItem(left, p.location);
  } catch { }
}
// /hero mjolnir (testing)
export function giveMjolnir(p) {
  const h = hero(p);
  if ((h.honor ?? 10) < WORTHY) h.honor = WORTHY;
  markDirty(p);
  give(p);
}
