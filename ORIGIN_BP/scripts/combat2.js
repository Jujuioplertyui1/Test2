// ORIGIN v0.15 - combat2.js
// Melee with weight: every hit has a 2-tick hit stop, sparks and stagger. Look UP + hit = UPPERCUT (launch + stun).
// Hit them in the air = JUGGLE. Look DOWN + hit an airborne target = SPIKE (they crater). Sprint + hit = shoulder charge.
// 4th hit in a string = heavy FINISHER. Blast or shoot a launched target = LAUNCH COMBO (+50%). Fill the stagger bar =
// STAGGERED (+30% damage taken). Start guarding (sneak) right as a mob swings = PARRY.
// Also: guns (pistol, rifle, shotgun, sniper), weapon specials, and the Serum's adrenaline surge.
import { world, system, EntityDamageCause, ItemStack } from "@minecraft/server";
import { hero, RT } from "./data.js";
import { V, at, valid, fx, line, sound, psound, now, health, hexToRgb, C, FX_IDS } from "./util.js";
import { hudMsg } from "./voice.js";
import { slashArc, crescent, burst, STEEL, ICE, VIOLET } from "./slashfx.js";
import { XOX, xoxParried } from "./xox.js";
import { heavyLaunch, destructionOn } from "./impact.js";
import { drawBeam, STYLES } from "./beams.js";

const SKIP = new Set([...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "origin:float_text", "origin:exo_piece", "origin:exo_drone", "origin:archetype_orb", "origin:manifestation", "origin:lumen_construct", "origin:training_dummy"]);
const ST = new Map();
const busy = new Set();
const YEL = hexToRgb("#ffd36a"), WHITE = C.white, PURPLE = hexToRgb("#B07CFF");
function T(e) { let s = ST.get(e.id); if (!s) { s = { stun: 0, at: now() }; ST.set(e.id, s); } return s; }
const shake = (p, a, t) => { try { p.runCommand(`camerashake add @s ${a} ${t} positional`); } catch { } };
function bonus(e, n, by, cause = EntityDamageCause.entityAttack) { if (!(n > 0)) return; busy.add(e.id); try { e.applyDamage(n, { cause, damagingEntity: by }); } catch { } system.run(() => busy.delete(e.id)); }
function stun(e, ticks) { try { e.addEffect("slowness", ticks, { amplifier: 255, showParticles: false }); e.addEffect("weakness", ticks, { amplifier: 255, showParticles: false }); } catch { } }
const playA = (p, n) => { try { p.playAnimation(`animation.origin.combat.${n}`, { controller: "origin_combat", stopExpression: "0", blendOutTime: 0.1 }); } catch { } };
function held(p) { try { return p.getComponent("minecraft:inventory").container.getItem(p.selectedSlotIndex); } catch { return undefined; } }

export function onCombatHit(p, target) {
  if (!valid(target) || target.typeId === "minecraft:player" || SKIP.has(target.typeId) || busy.has(target.id)) return;
  const r = RT(p), t = now(), s = T(target), f = V.flat(p.getViewDirection()), view = p.getViewDirection(), pitch = p.getRotation().x, h = hero(p);
  s.stun = Math.max(0, s.stun - (t - s.at) * 0.7); s.at = t;
  r.chain = t - (r.chainAt ?? -99) < 26 ? (r.chain ?? 0) + 1 : 1; r.chainAt = t;
  const it = held(p), empty = !it, air = !target.isOnGround, launched = air && (s.launchUntil ?? 0) > t;
  const kind = launched && pitch > 30 ? "spike" : launched ? "juggle" : pitch < -22 && !air ? "uppercut" : p.isSneaking && !air ? "sweep" : p.isSprinting ? "dash" : r.chain >= 5 ? "finisher" : "hit";
  const serum = h.serum ? 2 : 0;
  const top = target.getHeadLocation(), hitPt = at(target.location, -f.x * 0.35, (top.y - target.location.y) * 0.7, -f.z * 0.35);
  if (it?.typeId === "origin:combat_knife") for (let k = 1; k <= 3; k++) system.runTimeout(() => { if (valid(target)) { bonus(target, 1, p, EntityDamageCause.magic); fx(target.dimension, "origin:dot", target.getHeadLocation(), hexToRgb("#a01818"), 1); } }, k * 20);
  const kb = (x, y) => system.runTimeout(() => { if (valid(target)) try { target.applyKnockback({ x: f.x * x, z: f.z * x }, y); } catch { } }, 1);
  const gold = { red: 1, green: 0.82, blue: 0.35 };
  let add = 12;
  if ((r.counterUntil ?? 0) > t) {
    r.counterUntil = 0; add += 40; bonus(target, 6 + serum, p);
    slashArc(p.dimension, at(p.location, 0, 1.2, 0), f, { tilt: 30, radius: 2, glow: gold, sweep: 1 });
    sound(p.dimension, "origin.sfx.critical", hitPt, 1.2, 1); shake(p, 0.25, 0.2); hudMsg(p, "§6§lCOUNTER", 20);
  }
  if (kind === "uppercut") {
    kb(0.2, 0.95); stun(target, 25); s.launchUntil = t + 50; add = 35; bonus(target, 3 + serum, p);
    playA(p, "uppercut"); shake(p, 0.22, 0.22);
    burst(p.dimension, hitPt, { x: 0, y: 1, z: 0 }, { n: 10, size: 0.6, glow: gold });
    slashArc(p.dimension, at(target.location, 0, 0.9, 0), f, { tilt: 90, from: 165, to: 30, radius: 1.3, glow: gold, steps: 9, sweep: 1 });
    fx(p.dimension, "origin:dust", target.location, C.white, 1);
    sound(p.dimension, "origin.sfx.heavyhit", hitPt, 1.1, 0.9); sound(p.dimension, "origin.sfx.frameset", hitPt, 1, 0.5);
    if ((r.tipUpper ?? 0) < 3) { r.tipUpper = (r.tipUpper ?? 0) + 1; hudMsg(p, "§6§lUPPERCUT §r§7- hit it again in the air, look down to spike it, or blast it", 50); } else hudMsg(p, "§6§lUPPERCUT", 18);
  } else if (kind === "juggle") {
    kb(0.15, 0.45); s.launchUntil = t + 34; add = 15; bonus(target, 2 + serum, p);
    r.air = (r.air ?? 0) + 1; if (r.air >= 2) hudMsg(p, `§eAIR §l${r.air + 1}`, 15);
    if (empty) playA(p, r.air % 2 ? "jab" : "cross");
    burst(p.dimension, hitPt, view, { n: 7, size: 0.45 });
    sound(p.dimension, "origin.sfx.punch", hitPt, 1.15 + Math.min(0.6, r.air * 0.1), 0.9);
  } else if (kind === "spike") {
    heavyLaunch(target, f, 2, p, { down: true }); s.spikeBy = p; s.spikeUntil = t + 30; s.launchUntil = 0; add = 30; bonus(target, 3 + serum, p);
    playA(p, "slam"); shake(p, 0.3, 0.3); burst(p.dimension, hitPt, { x: 0, y: -1, z: 0 }, { n: 10, size: 0.7, glow: gold });
    sound(p.dimension, "origin.sfx.heavyhit", hitPt, 0.8, 1); hudMsg(p, "§c§lSPIKE", 18);
  } else if (kind === "sweep") {
    kb(0.3, 0.35); s.launchUntil = t + 30; add = 22; bonus(target, 1 + serum, p);
    try { target.addEffect("slowness", 30, { amplifier: 3, showParticles: false }); } catch { }
    playA(p, "sweep"); fx(p.dimension, "origin:shockwave", at(target.location, 0, 0.1, 0), C.white, 0.8, { radius: 1.4 });
    sound(p.dimension, "origin.sfx.swoosh", hitPt, 1.2, 0.8); sound(p.dimension, "origin.sfx.impact", hitPt, 1.1, 0.5); hudMsg(p, "§bSWEEP §7- they're off their feet", 18);
  } else if (kind === "dash") {
    if (h.power === "super_strength") heavyLaunch(target, f, 1, p); else kb(2.2, 0.4); add = 18; bonus(target, 2 + serum, p);
    burst(p.dimension, hitPt, view, { n: 9, size: 0.55 }); fx(p.dimension, "origin:dust", p.location, C.white, 0.8);
    sound(p.dimension, "origin.sfx.heavyhit", hitPt, 1, 0.8); shake(p, 0.15, 0.15);
  } else if (kind === "finisher") {
    kb(2.8, 0.6); add = 30; r.chain = 0; bonus(target, 4 + serum, p);
    playA(p, "heavy"); shake(p, 0.3, 0.25); burst(p.dimension, hitPt, view, { n: 12, size: 0.8, glow: gold });
    sound(p.dimension, "origin.sfx.critical", hitPt, 1, 1);
    fx(p.dimension, "origin:shockwave", hitPt, C.white, 1, { radius: 1.6 }); hudMsg(p, "§f§lFINISHER", 18);
  } else {
    kb(serum ? 0.9 : 0.6, 0.25); if (serum) bonus(target, serum, p);
    if (empty) playA(p, ["jab", "cross", "hook"][r.chain % 3]);
    burst(p.dimension, hitPt, view, { n: 6, size: 0.38 });
    sound(p.dimension, "origin.sfx.punch", hitPt, 0.9 + Math.random() * 0.3, 0.6);
    if (r.chain >= 3) hudMsg(p, `§7x§f§l${r.chain}`, 12);
  }
  if (kind !== "juggle") r.air = 0;
  s.stun += add;
  if (s.stun >= 100) { s.stun = 0; s.staggerUntil = t + 60; stun(target, 40); fx(p.dimension, "origin:flare", target.getHeadLocation(), YEL, 1); sound(p.dimension, "origin.sfx.glass", hitPt, 1.2, 0.7); hudMsg(p, "§e§lSTAGGERED §r§7- it takes more damage", 30); }
}
// damage landing on anything: launch combos and staggered bonus
export function onCombatHurt(e, amount, src) {
  if (!valid(e) || busy.has(e.id) || !(amount > 0)) return;
  const by = src?.damagingEntity, s = ST.get(e.id), t = now();
  if (by?.typeId !== "minecraft:player" || !s) return;
  const cause = String(src.cause ?? "");
  if ((s.launchUntil ?? 0) > t && !e.isOnGround && cause !== "entityAttack") {
    s.launchUntil = 0;
    bonus(e, Math.ceil(amount * 0.5), by, EntityDamageCause.magic);
    fx(e.dimension, "origin:flare", e.getHeadLocation(), PURPLE, 1); sound(e.dimension, "origin.sfx.thunderhit", e.location, 1.1, 0.8);
    hudMsg(by, "§d§lLAUNCH COMBO §r§7+50%", 30);
  } else if ((s.staggerUntil ?? 0) > t) bonus(e, Math.ceil(amount * 0.3), by, EntityDamageCause.magic);
}
// parry: start guarding (sneak) in the 6 ticks before a mob's swing lands
export function onParryBefore(ev) {
  const p = ev.hurtEntity;
  if (p?.typeId !== "minecraft:player") return false;
  const by = ev.damageSource?.damagingEntity, r = RT(p);
  if (!by || by.typeId === "minecraft:player" || String(ev.damageSource?.cause) !== "entityAttack") return false;
  if (!p.isSneaking || now() - (r.guardAt ?? -99) > 6) return false;
  ev.cancel = true;
  r.counterUntil = now() + 30;
  system.run(() => {
    if (!valid(by)) return;
    if (by.typeId === XOX) { xoxParried(by, p); sound(p.dimension, "origin.sfx.parry", p.location, 1, 1); return; }
    stun(by, 40); T(by).stun += 40;
    const d = V.flat(V.sub(by.location, p.location));
    try { by.applyKnockback({ x: d.x * 1.2, z: d.z * 1.2 }, 0.3); } catch { }
    fx(p.dimension, "origin:flare", at(p.location, d.x * 0.8, 1.3, d.z * 0.8), YEL, 1);
    sound(p.dimension, "origin.sfx.parry", p.location, 1, 1); shake(p, 0.15, 0.2);
    hudMsg(p, "§e§lPARRY §r§7- counter now", 25);
  });
  return true;
}

// ------------------------------------------------------------------ guns
const GUN = {
  "origin:pistol": { dmg: 7, mag: 12, cd: 5, range: 56, spread: 1.2, pellets: 1, reload: 30, kick: 0.1, snd: "origin.sfx.cannon", pitch: 1.25 },
  "origin:rifle": { dmg: 4.5, mag: 30, cd: 3, range: 64, spread: 2.0, pellets: 1, reload: 44, kick: 0.07, auto: true, snd: "origin.sfx.gunshot", pitch: 1.3 },
  "origin:shotgun": { dmg: 3.2, mag: 6, cd: 18, range: 22, spread: 8, pellets: 8, reload: 50, kick: 0.35, snd: "origin.sfx.cannon", pitch: 0.7 },
  "origin:sniper": { dmg: 24, mag: 5, cd: 30, range: 128, spread: 0.05, pellets: 1, reload: 60, kick: 0.4, pierce: 2, snd: "origin.sfx.cannon", pitch: 0.55, scope: true },
};
export const isGun = (id) => !!GUN[id];
const magOf = (it, g) => { try { const v = it.getDynamicProperty("origin:mag"); return typeof v === "number" ? v : g.mag; } catch { return g.mag; } };
function setMag(p, slot, it, n, g) {
  try { it.setDynamicProperty("origin:mag", n); it.setLore([`§7Ammo: §f${n}§7/${g.mag}`, `§8Use: fire · Sneak + use: reload${g.scope ? " · Sneak: scope" : ""}`]); p.getComponent("minecraft:inventory").container.setItem(slot, it); } catch { }
}
function jitter(d, deg) { const a = (Math.random() - 0.5) * deg * 0.0349, b = (Math.random() - 0.5) * deg * 0.0349; return V.norm({ x: d.x + Math.cos(a + 1.3) * a, y: d.y + b, z: d.z + Math.sin(a) * a }); }
function fire(p) {
  const r = RT(p), it = held(p), g = GUN[it?.typeId], t = now();
  if (!g || (r.gunCd ?? 0) > t || r.reloading) return;
  const slot = p.selectedSlotIndex, n = magOf(it, g);
  if (n <= 0) { psound(p, "origin.sfx.click", 1.6, 0.6); reload(p); return; }
  setMag(p, slot, it, n - 1, g);
  r.gunCd = t + g.cd;
  const dim = p.dimension, eye = p.getHeadLocation(), dir = p.getViewDirection();
  const muzzle = at(eye, -dir.z * 0.3 + dir.x * 0.9, -0.25, dir.x * 0.3 + dir.z * 0.9);
  for (let k = 0; k < g.pellets; k++) {
    const d = jitter(dir, g.spread);
    let dist = g.range, blk = null, hitB = null;
    try { const bh = dim.getBlockFromRay(eye, d, { maxDistance: g.range, includePassableBlocks: false }); if (bh) { blk = V.add(bh.block.location, bh.faceLocation); dist = V.dist(eye, blk); hitB = bh; } } catch { }
    let hits = [];
    try { hits = dim.getEntitiesFromRay(eye, d, { maxDistance: dist }).map((h) => h.entity).filter((e) => e.id !== p.id && !SKIP.has(e.typeId)); } catch { }
    hits = hits.slice(0, 1 + (g.pierce ?? 0));
    let end = hits.length ? hits[hits.length - 1].getHeadLocation() : V.add(eye, V.mul(d, dist));
    for (const e of hits) {
      const fall = g.pellets > 1 ? Math.max(0.4, 1 - V.dist(eye, e.location) / g.range) : 1;
      try { e.applyDamage(g.dmg * fall, { cause: EntityDamageCause.projectile, damagingEntity: p }); } catch { }
      try { e.applyKnockback({ x: d.x * (g.pellets > 1 ? 0.5 : 0.25), z: d.z * (g.pellets > 1 ? 0.5 : 0.25) }, 0.12); } catch { }
      fx(dim, "origin:spark", e.getHeadLocation(), hexToRgb("#ff5040"), 1);
    }
    if (!hits.length && blk) bulletImpact(dim, hitB, blk, d, k === 0);
    drawBeam(dim, muzzle, end, STYLES.tracer, now(), { life: 0.07, seg: 12 });
  }
  fx(dim, "origin:flash", muzzle, YEL, 1, { size: g.pellets > 1 ? 1.2 : 0.7 });
  fx(dim, "origin:boom_smoke", V.add(muzzle, V.mul(dir, 0.3)), { red: 0.55, green: 0.53, blue: 0.5 }, 0.35);
  // the spent casing kicks out of the right side and bounces on the ground
  const rl = Math.hypot(dir.x, dir.z) || 1, side = { x: -dir.z / rl, z: dir.x / rl };
  fx(dim, "origin:casing", V.add(muzzle, V.mul(dir, -0.35)), C.white, 1, { dx: side.x * 0.75 - dir.x * 0.15, dy: 0.65, dz: side.z * 0.75 - dir.z * 0.15, spd: 2 + Math.random() * 1.2 });
  sound(dim, g.snd, eye, g.pitch + Math.random() * 0.08, 0.9);
  shake(p, g.kick, 0.1);
  try { p.playAnimation("animation.origin.gun.recoil", { controller: "origin_recoil", stopExpression: "0", blendOutTime: 0.05 }); } catch { }
}
// a round hitting a block: a bullet hole on the face it hit, sparks and grit - and glass shatters (destruction on)
const GLASS = /(^|:)(glass|glass_pane|tinted_glass|.*_stained_glass|.*_stained_glass_pane|hard_glass.*)$/;
const HOLE_OF = { Up: "xz", Down: "xz", North: "xy", South: "xy", East: "yz", West: "yz" };
const N_OF = { Up: [0, 1, 0], Down: [0, -1, 0], North: [0, 0, -1], South: [0, 0, 1], East: [1, 0, 0], West: [-1, 0, 0] };
function bulletImpact(dim, bh, pt, d, loud) {
  const face = String(bh?.face ?? "Up"), id = bh?.block?.typeId ?? "";
  if (GLASS.test(id) && destructionOn()) {
    try { bh.block.setType("minecraft:air"); } catch { }
    fx(dim, "origin:shards", pt, { red: 0.85, green: 0.95, blue: 1 }, 1);
    sound(dim, "random.glass", pt, 1 + Math.random() * 0.2, 0.9);
    return;
  }
  const n = N_OF[face] ?? [0, 1, 0];
  fx(dim, `origin:bullet_hole_${HOLE_OF[face] ?? "xz"}`, { x: pt.x + n[0] * 0.012, y: pt.y + n[1] * 0.012, z: pt.z + n[2] * 0.012 }, C.white, 1, { size: 0.075 + Math.random() * 0.03 });
  fx(dim, "origin:spark", pt, YEL, 1);
  fx(dim, "origin:dust", { x: pt.x + n[0] * 0.15, y: pt.y + n[1] * 0.15, z: pt.z + n[2] * 0.15 }, C.dust, 0.55);
  if (loud) {
    const wood = /_log|_planks|_wood|bookshelf|barrel|chest|fence|door/.test(id), metal = /iron|copper|gold|anvil|cauldron|chain|bars/.test(id);
    sound(dim, metal ? "random.anvil_land" : wood ? "dig.wood" : "dig.stone", pt, metal ? 1.9 : 1.3, metal ? 0.25 : 0.45);
  }
}
function reload(p) {
  const r = RT(p), it = held(p), g = GUN[it?.typeId];
  if (!g || r.reloading || magOf(it, g) >= g.mag) return;
  let have = 0;
  try { const c = p.getComponent("minecraft:inventory").container; for (let i = 0; i < c.size; i++) { const x = c.getItem(i); if (x?.typeId === "origin:ammo") have += x.amount; } } catch { }
  if (!have) { hudMsg(p, "§7No rounds. §8(2 iron nuggets + gunpowder = 6)", 40); return; }
  r.reloading = { slot: p.selectedSlotIndex, until: now() + g.reload };
  psound(p, "origin.sfx.servo", 1.4, 0.6);
  hudMsg(p, "§7Reloading...", g.reload);
}
function finishReload(p) {
  const r = RT(p), job = r.reloading;
  r.reloading = null;
  let c; try { c = p.getComponent("minecraft:inventory").container; } catch { return; }
  const it = c.getItem(job.slot), g = GUN[it?.typeId];
  if (!g) return;
  let need = g.mag - magOf(it, g), got = 0;
  for (let i = 0; i < c.size && need > 0; i++) { const x = c.getItem(i); if (x?.typeId !== "origin:ammo") continue; const k = Math.min(need, x.amount); need -= k; got += k; if (x.amount > k) { x.amount -= k; c.setItem(i, x); } else c.setItem(i, undefined); }
  setMag(p, job.slot, it, magOf(it, g) + got, g);
  psound(p, "origin.sfx.click", 1.2, 0.8);
}
export function useGun(p, sneaking) { if (sneaking) reload(p); else if (!GUN[held(p)?.typeId]?.auto) fire(p); }
export function onGunStart(p, item) { if (GUN[item?.typeId]?.auto) { RT(p).autoFire = true; fire(p); } }
export function onGunStop(p) { RT(p).autoFire = false; }

// ------------------------------------------------------------------ weapon specials
export function isWeapon(id) { return id === "origin:war_hammer" || id === "origin:xox_katana" || id === "origin:combat_knife"; }
export function useWeapon(p, id, sneaking) {
  const r = RT(p), t = now();
  const cdOk = (k, n) => { r.wcd ??= {}; if ((r.wcd[k] ?? 0) > t) { hudMsg(p, `§7Recharging §c${((r.wcd[k] - t) / 20).toFixed(1)}s`, 20); return false; } r.wcd[k] = t + n; return true; };
  if (id === "origin:war_hammer" && sneaking && cdOk("hammer", 160)) {
    playA(p, "slam"); shake(p, 0.45, 0.4);
    fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), WHITE, 1, { radius: 4.5 }); fx(p.dimension, "origin:debris", p.location, C.dust, 1);
    sound(p.dimension, "origin.sfx.stonecrash", p.location, 0.9, 1);
    try { for (const e of p.dimension.getEntities({ location: p.location, maxDistance: 4.5, excludeTypes: [...SKIP, "minecraft:player"] })) { bonus(e, 8, p); try { e.applyKnockback({ x: 0, z: 0 }, 0.75); } catch { } T(e).launchUntil = t + 40; } } catch { }
  } else if (id === "origin:xox_katana" && !sneaking && cdOk("wave", 50)) {
    const d = V.flat(p.getViewDirection()), dim = p.dimension, hitIds = new Set();
    let pos = at(p.location, d.x * 1.5, 1.1, d.z * 1.5);
    sound(dim, "origin.sfx.sweep2", p.location, 0.9, 1);
    (async () => { for (let k = 0; k < 12; k++) { pos = at(pos, d.x * 1.3, 0, d.z * 1.3); crescent(dim, pos, d, { size: 1.4, glow: VIOLET }); try { for (const e of dim.getEntities({ location: pos, maxDistance: 1.5, excludeTypes: [...SKIP, "minecraft:player"] })) if (!hitIds.has(e.id)) { hitIds.add(e.id); bonus(e, 9, p); } } catch { } await system.waitTicks(1); } })();
  } else if (id === "origin:xox_katana" && sneaking && cdOk("pull", 160)) {
    sound(p.dimension, "origin.sfx.gravity", p.location, 1, 1); fx(p.dimension, "origin:gravity_field", at(p.location, 0, 1, 0), PURPLE, 1, { size: 6 });
    try { for (const e of p.dimension.getEntities({ location: p.location, maxDistance: 9, excludeTypes: [...SKIP, "minecraft:player"] })) { const k = V.flat(V.sub(p.location, e.location)); try { e.applyKnockback({ x: k.x * 1.3, z: k.z * 1.3 }, 0.2); e.addEffect("slowness", 40, { amplifier: 2 }); } catch { } } } catch { }
  }
}

// ------------------------------------------------------------------ Super Soldier: adrenaline surge (any serum after the first)
export function serumSurge(p) {
  const h = hero(p), r = RT(p);
  const left = (h.surgeAt ?? 0) + 5 * 60 * 1000 - Date.now();
  if (left > 0) { hudMsg(p, `§7Your body needs §b${Math.ceil(left / 60000)} min§7 before another surge.`, 40); return false; }
  h.surgeAt = Date.now();
  try { const c = p.getComponent("minecraft:inventory").container, it = c.getItem(p.selectedSlotIndex); if (it?.typeId === "origin:super_serum") { if (it.amount > 1) { it.amount--; c.setItem(p.selectedSlotIndex, it); } else c.setItem(p.selectedSlotIndex, undefined); } } catch { }
  r.surgeUntil = now() + 900;
  try { for (const [id, a] of [["strength", 1], ["speed", 1], ["jump_boost", 1], ["regeneration", 0], ["resistance", 0]]) p.addEffect(id, 900, { amplifier: a, showParticles: false }); } catch { }
  try { p.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0.1, fadeOutTime: 0.6 }, fadeColor: { red: 0.6, green: 0.05, blue: 0.05 } }); } catch { }
  psound(p, "mob.warden.heartbeat", 1.3, 1); shake(p, 0.3, 0.5);
  fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), hexToRgb("#55aaff"), 1, { radius: 3 });
  try { p.onScreenDisplay.setTitle("§b§lADRENALINE SURGE", { fadeInDuration: 2, stayDuration: 30, fadeOutDuration: 10, subtitle: "§745s · then you'll crash" }); r.titleUntil = now() + 44; } catch { }
  system.runTimeout(() => { if (!valid(p)) return; try { p.addEffect("weakness", 300, { amplifier: 0 }); p.addEffect("hunger", 300, { amplifier: 1 }); } catch { } hudMsg(p, "§7The surge burns out. You crash.", 40); }, 900);
  return true;
}

// ------------------------------------------------------------------ every tick
export function tickCombat2() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const r = RT(p);
    if (p.isSneaking && !r.wasSneak) r.guardAt = t;
    r.wasSneak = p.isSneaking;
    const it = held(p), g = GUN[it?.typeId];
    if (g && !r.aimOn) { r.aimOn = true; try { p.playAnimation("animation.origin.gun.aim", { controller: "origin_gun", stopExpression: "!query.is_item_name_any('slot.weapon.mainhand', 0, 'origin:pistol', 'origin:rifle', 'origin:shotgun', 'origin:sniper')", blendOutTime: 0.15 }); } catch { } }
    if (!g && r.aimOn) r.aimOn = false;
    if (r.autoFire) { if (!g?.auto) r.autoFire = false; else fire(p); }
    if (r.reloading && r.reloading.until <= t) finishReload(p);
    const scope = !!g?.scope && p.isSneaking;
    if (scope !== !!r.scoped) { r.scoped = scope; try { if (scope) p.camera.setFov({ fov: 22, easeOptions: { easeTime: 0.15 } }); else p.camera.setFov(); } catch { } }
    if (h_serum(p) && t % 20 === 0) { try { p.addEffect("speed", 30, { amplifier: 0, showParticles: false }); } catch { } }
  }
  if (t % 4 === 0) for (const [id, s] of ST) {
    if (s.spikeUntil > t && s.spikeBy) {
      let e; try { e = world.getEntity(id); } catch { }
      if (valid(e) && e.isOnGround) {
        s.spikeUntil = 0;
        fx(e.dimension, "origin:shockwave", at(e.location, 0, 0.1, 0), WHITE, 1, { radius: 2.6 }); fx(e.dimension, "origin:debris", e.location, C.dust, 1);
        sound(e.dimension, "origin.sfx.stonecrash", e.location, 1.2, 0.8);
        stun(e, 25);
        try { for (const o of e.dimension.getEntities({ location: e.location, maxDistance: 2.6, excludeTypes: [...SKIP, "minecraft:player"] })) bonus(o, o.id === e.id ? 4 : 3, valid(s.spikeBy) ? s.spikeBy : undefined); } catch { }
      }
    }
    if (t - s.at > 400) ST.delete(id);
  }
}
const h_serum = (p) => !!hero(p).serum;

// your own blades leave real trails: each swing alternates its angle so a string of swings reads as a combo
const BLADE = /sword|katana|knife|axe|scythe|blade/;
export function onSwingTrail(p) {
  const it = held(p), id = it?.typeId ?? "";
  if (!BLADE.test(id) && id !== "origin:war_hammer") return;
  const r = RT(p), t = now();
  if (t - (r.trailAt ?? -99) < 5) return;
  r.trailAt = t;
  r.swingN = ((r.swingN ?? 0) + 1) % 4;
  const f = V.flat(p.getViewDirection()), pitch = p.getRotation().x;
  const [tilt, from, to] = pitch < -18 ? [90, 165, 20] : pitch > 30 ? [90, 15, 165] : [[40, 15, 165], [-40, 165, 15], [0, 20, 160], [0, 160, 20]][r.swingN];
  const glow = id === "origin:xox_katana" ? VIOLET : id === "origin:war_hammer" ? { red: 1, green: 0.8, blue: 0.5 } : ICE;
  slashArc(p.dimension, at(p.location, 0, 1.25, 0), f, { tilt, from, to, radius: id === "origin:war_hammer" ? 1.8 : 2.0, glow, steps: 11, sweep: 1, alpha: 0.85 });
}
