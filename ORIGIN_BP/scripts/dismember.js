// ORIGIN v0.24 - dismember.js
// SEVERED. Rare - and it stays gone unless you do something about it.
//  Sharp: swords, axes, the Katana, and sharp powers (The Other's Rend, Arc Blade, Lumen Blade, a Shadow Step ambush).
//  It only happens when a sharp hit CONNECTS BADLY: you have to be low on health, flanked (hit from the side or
//   behind), hit by a falling critical strike, or hit very hard - and even then it's a small roll (about 1-4%), cut way
//   down by a chestplate (Exo-Frame / netherite most of all). Each person can only lose a limb once every 5 minutes.
//  The arm on the side that got hit comes off: it flies, it bleeds, it lands. Your model loses that arm, and it stays
//   gone through death and relogging.
//   Right arm gone: your strikes are weak (Weakness II) and you mine slowly. Left arm gone: your off-hand drops
//   and you're a little slower.
//  You BLEED for 20s (half a heart every 2s) unless you use a Bandage, eat a golden apple or have Regeneration.
//  Getting it back (v0.24):
//   - STITCH IT ON: pick your own arm up and use it while you carry a Bandage. It only takes if it's fresh
//     (10 minutes, real time) - after that it's gone cold.
//   - Regeneration grows it back on its own. Mirror Hour can rewind it.
//   - An Exo Prosthetic from the Exo-Forge replaces it for good (and takes modules).
//  Villains and The Other can lose arms too (and hit a lot softer for it). Sharp killing blows take arms off
//  zombies, skeletons, illagers, piglins and other people-shaped mobs (that's only for show - they're already dead).
//  /hero gore full | mild | off  (mild: no blood; off: no severing at all)
import { world, system, EntityDamageCause, EquipmentSlot, ItemStack, ItemLockMode } from "@minecraft/server";
import { hero, RT, markDirty, saveNow } from "./data.js";
import { V, at, valid, fx, sound, psound, C, now, health, msg, rightOf } from "./util.js";
import { hudMsg } from "./voice.js";
import { popNumber } from "./combat.js";

const SHARP_ITEM = /sword|_axe$|origin:katana/;
const SHARP_MOB = ["minecraft:vindicator", "minecraft:wither_skeleton", "minecraft:piglin", "minecraft:piglin_brute", "minecraft:zombified_piglin", "minecraft:vex"];
const BASE = { katana: 0.015, sword: 0.0075, axe: 0.01, power: 0.01, mob: 0.005 };
const ARMOR = (id) => (!id ? 1 : /netherite|exo_chest/.test(id) ? 0.3 : /diamond/.test(id) ? 0.45 : /iron|chainmail|suit_torso/.test(id) ? 0.6 : 0.8);
const BLEED = 20 * 20, PICKUP = 20 * 60 * 10;
const FRESH_MS = 10 * 60 * 1000;   // how long a severed arm can still be stitched back on (real time, survives relogs)
// what a flying arm looks like: 0 skin + sleeve, 1 armored, 2 zombie, 3 bone, 4 grey (illagers), 5 piglin, 6 husk/drowned
export const LIMB_LOOK = { flesh: 0, armored: 1, zombie: 2, bone: 3, grey: 4, piglin: 5, husk: 6 };
const MOB_LOOK = {
  "minecraft:zombie": 2, "minecraft:zombie_villager": 2, "minecraft:zombie_villager_v2": 2, "minecraft:husk": 6, "minecraft:drowned": 6,
  "minecraft:skeleton": 3, "minecraft:stray": 3, "minecraft:wither_skeleton": 3, "minecraft:bogged": 3,
  "minecraft:pillager": 4, "minecraft:vindicator": 4, "minecraft:evoker": 4, "minecraft:illusioner": 4, "minecraft:witch": 4,
  "minecraft:villager": 0, "minecraft:villager_v2": 0, "minecraft:wandering_trader": 0,
  "minecraft:piglin": 5, "minecraft:piglin_brute": 5, "minecraft:zombie_pigman": 5, "minecraft:zombified_piglin": 5,
  "origin:villain": 0, "origin:alter_ego": 0,
};

export function goreSetting() { const v = world.getDynamicProperty("origin:gore"); return v === "mild" || v === "off" ? v : "full"; }
export function setGore(v) { world.setDynamicProperty("origin:gore", v); }

// what kind of sharp is this attacker carrying? (null = not sharp)
export function sharpOf(attacker) {
  if (!attacker) return null;
  let held = null;
  try { held = attacker.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId ?? null; } catch { }
  if (!held && attacker.typeId === "minecraft:player") {
    try { held = attacker.getComponent("minecraft:inventory").container.getItem(attacker.selectedSlotIndex)?.typeId ?? null; } catch { }
  }
  if (held === "origin:katana") return "katana";
  if (held && /sword/.test(held)) return "sword";
  if (held && /_axe$/.test(held)) return "axe";
  if (SHARP_MOB.includes(attacker.typeId)) return "mob";
  return null;
}

// ------------------------------------------------------------------ the roll
const cooldown = new Map();   // victimId -> tick
function armsOf(v) {
  if (v.typeId === "minecraft:player") { const h = hero(v); return (h.limbs ??= { r: 1, l: 1 }); }
  let r = 1, l = 1;
  try { r = v.getProperty("origin:arm_r") === 1 ? 0 : 1; l = v.getProperty("origin:arm_l") === 1 ? 0 : 1; } catch { }
  return { r, l };
}
const CUTTABLE = (v) => v.typeId === "minecraft:player" || v.typeId === "origin:villain" || v.typeId === "origin:alter_ego";
// call after a sharp hit landed. kind: katana | sword | axe | power | mob. Returns the side cut ("r"/"l") or null.
export function tryCut(attacker, victim, damage, kind, force = false, forceSide = null) {
  if (!valid(victim) || !CUTTABLE(victim) || goreSetting() === "off") return null;
  if (victim.typeId === "minecraft:player" && !force) { try { const gm = victim.getGameMode(); if (gm === "Creative" || gm === "creative") return null; } catch { } }
  const t = now();
  if (!force && (cooldown.get(victim.id) ?? -9999) > t) return null;
  if (!force && damage < 5) return null;
  const arms = armsOf(victim);
  if (!arms.r && !arms.l) return null;
  // which side did it come from?
  let side = Math.random() < 0.5 ? "r" : "l";
  try {
    const yaw = (victim.getRotation().y * Math.PI) / 180;
    const facing = { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
    const toA = V.flat(V.sub(attacker.location, victim.location));
    const right = rightOf(facing);
    const sideDot = V.dot(toA, right), frontDot = V.dot(toA, facing);
    if (Math.abs(sideDot) > 0.3) side = sideDot > 0 ? "r" : "l";
    var flank = frontDot < 0.5;           // side or behind
  } catch { var flank = false; }
  if (forceSide && arms[forceSide]) side = forceSide;
  if (!arms[side]) side = side === "r" ? "l" : "r";
  if (!force) {
    // a bad connection needs at least one of these - otherwise it simply can't happen
    const hp = health(victim);
    const low = !!(hp && hp.cur < hp.max * 0.4);
    let crit = false;
    try { crit = attacker.typeId === "minecraft:player" && !attacker.isOnGround && attacker.getVelocity().y < -0.1; } catch { }
    const heavy = damage >= 10;
    if (!low && !flank && !crit && !heavy) return null;
    let chance = BASE[kind] ?? 0.01;
    if (low) chance += 0.01;
    if (flank) chance += 0.0075;
    if (crit) chance += 0.0075;
    if (heavy) chance += 0.005;
    let chest = null;
    try { chest = victim.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Chest)?.typeId; } catch { }
    chance *= ARMOR(chest);
    if (Math.random() > chance) return null;
  }
  cooldown.set(victim.id, t + 20 * 300);
  sever(attacker, victim, side);
  return side;
}

// ------------------------------------------------------------------ the cut
const limbs = [];   // {e, owner (id), side, until}
// throw an arm out of a shoulder. Who it belonged to and when it came off ride on the entity itself (dynamic
// properties), so a relog doesn't turn it into a stranger's arm - or leave it lying there forever.
function flingLimb(dim, from, away, look, { owner = "", side = "r", gore = goreSetting(), name = "", cut = Date.now(), spin = true } = {}) {
  let limb = null;
  try {
    limb = dim.spawnEntity("origin:severed_limb", from);
    try { limb.setProperty("origin:look", look); } catch { }
    limb.setRotation({ x: 0, y: Math.random() * 360 });
    limb.applyImpulse({ x: away.x * (spin ? 0.32 : 0.15), y: spin ? 0.28 : 0.1, z: away.z * (spin ? 0.32 : 0.15) });
    if (name) limb.nameTag = name;
    try { limb.setDynamicProperty("origin:owner", owner); limb.setDynamicProperty("origin:side", side); limb.setDynamicProperty("origin:cut", cut); limb.setDynamicProperty("origin:look", look); } catch { }
    limbs.push({ e: limb, owner, side, until: now() + (owner ? PICKUP : 20 * 120), gore });
    // a big fight shouldn't bury the place in arms: past 20 nobody owns, the oldest go first
    const strays = limbs.filter((q) => !q.owner);
    for (const q of strays.slice(0, Math.max(0, strays.length - 20))) { try { if (valid(q.e)) q.e.remove(); } catch { } limbs.splice(limbs.indexOf(q), 1); }
  } catch { }
  return limb;
}
// a sharp killing blow on something shaped like a person: an arm goes flying (for show - it's already dead)
const KILL_CHANCE = { katana: 0.45, sword: 0.22, axe: 0.3, power: 0.3, mob: 0 };
export function onSharpKill(killer, dead, kind = null) {
  if (!valid(dead) || !killer || goreSetting() === "off") return;
  const look = MOB_LOOK[dead.typeId];
  if (look === undefined || dead.typeId === "origin:villain" || dead.typeId === "origin:alter_ego") return;   // those two lose arms while alive
  kind = kind ?? sharpOf(killer);
  if (!kind || Math.random() > (KILL_CHANCE[kind] ?? 0)) return;
  const dim = dead.dimension;
  let facing = { x: 0, y: 0, z: 1 };
  try { const yaw = (dead.getRotation().y * Math.PI) / 180; facing = { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) }; } catch { }
  const right = rightOf(facing), sx = Math.random() < 0.5 ? 1 : -1;
  let top = 1.35;
  try { top = Math.max(0.8, (dead.getHeadLocation().y - dead.location.y) - 0.25); } catch { }
  const shoulder = at(dead.location, right.x * 0.38 * sx, top, right.z * 0.38 * sx);
  const away = V.flat(V.add(V.mul(right, sx), V.mul(V.flat(V.sub(dead.location, killer.location)), 0.8)));
  flingLimb(dim, shoulder, away, look, { owner: "", side: sx > 0 ? "r" : "l" });
  if (goreSetting() === "full" && look !== LIMB_LOOK.bone) {
    fx(dim, "origin:blood_spray", shoulder, C.white, 1, { dir_x: away.x, dir_z: away.z });
    fx(dim, "origin:blood_mist", shoulder, C.white, 1);
  } else fx(dim, "origin:debris", shoulder, look === LIMB_LOOK.bone ? C.white : C.dust, 1);
  sound(dim, look === LIMB_LOOK.bone ? "origin.sfx.bonecrack" : "mob.slime.attack", shoulder, 1, 0.7);
  if (killer.typeId === "minecraft:player") hudMsg(killer, "§4§lSEVERED", 16);
}
function sever(attacker, victim, side) {
  const dim = victim.dimension;
  const gore = goreSetting();
  const yaw = (victim.getRotation().y * Math.PI) / 180;
  const facing = { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  const right = rightOf(facing);
  const sx = side === "r" ? 1 : -1;
  const shoulder = at(victim.location, right.x * 0.38 * sx, 1.35, right.z * 0.38 * sx);
  const away = V.flat(V.add(V.mul(right, sx), V.mul(V.flat(V.sub(victim.location, attacker?.location ?? victim.location)), 0.6)));
  // the moment: everything stops for a beat
  try { victim.addEffect("slowness", 8, { amplifier: 10, showParticles: false }); } catch { }
  try { if (attacker?.typeId === "minecraft:player") attacker.addEffect("slowness", 4, { amplifier: 10, showParticles: false }); } catch { }
  sound(dim, "random.break", shoulder, 1, 0.6);
  sound(dim, "mob.slime.attack", shoulder, 1, 0.6);
  sound(dim, "item.trident.hit", shoulder, 1, 0.7);
  const robotic = victim.typeId === "minecraft:player" && !!hero(victim).limbs?.prosthetic?.[side];
  if (gore === "full" && !robotic) {
    fx(dim, "origin:blood_spray", shoulder, C.white, 1, { dir_x: away.x, dir_z: away.z });
    fx(dim, "origin:blood_mist", shoulder, C.white, 1);
    for (let i = 1; i <= 5; i++) system.runTimeout(() => valid(victim) && fx(dim, "origin:blood_spray", at(victim.location, right.x * 0.38 * sx, 1.35, right.z * 0.38 * sx), C.white, 1, { dir_x: away.x * 0.5, dir_z: away.z * 0.5 }), i * 4);
  } else {
    fx(dim, "origin:spark", shoulder, C.white, 1);
    fx(dim, "origin:debris", shoulder, C.dust, 1);
  }
  try { popNumber(dim, at(shoulder, 0, 0.5, 0), "§4§lSEVERED"); } catch { }
  fx(dim, "origin:flash", shoulder, gore === "full" ? { red: 0.8, green: 0.05, blue: 0.05 } : C.white, 1, { size: 1.2 });
  // the arm flies
  let chest = null;
  try { chest = victim.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Chest)?.typeId; } catch { }
  const limb = flingLimb(dim, shoulder, away, chest ? LIMB_LOOK.armored : (MOB_LOOK[victim.typeId] ?? 0), {
    owner: victim.typeId === "minecraft:player" ? victim.id : "", side, gore,
    name: victim.typeId === "minecraft:player" ? `${victim.name}'s ${side === "r" ? "right" : "left"} arm` : "",
  });
  if (victim.typeId === "minecraft:player" && hero(victim).limbs?.prosthetic?.[side]) {
    const h = hero(victim);
    h.limbs.prosthetic[side] = false;
    h.limbs[side] = 0;
    saveNow(victim);
    applyLook(victim);
    try { limb?.remove(); } catch { }
    for (let i = 0; i < 10; i++) fx(dim, "origin:spark", shoulder, i % 2 ? C.cyan : C.white, 1);
    sound(dim, "random.anvil_land", shoulder, 1, 1.4);
    try { dim.spawnItem(new ItemStack("origin:exo_prosthetic", 1), shoulder); } catch { }
    try { victim.onScreenDisplay.setTitle(" ", { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10, subtitle: "§b§lPROSTHETIC TORN OFF" }); RT(victim).titleUntil = now() + 40; } catch { }
    msg(victim, "§bYour prosthetic was torn off. §7It's on the ground - pick it up and use it to put it back on.");
    return;
  }
  if (victim.typeId === "minecraft:player") {
    const h = hero(victim), r = RT(victim);
    h.limbs = h.limbs ?? { r: 1, l: 1 };
    h.limbs[side] = 0;
    h.limbs.lostAt = h.limbs.lostAt ?? {};
    h.limbs.lostAt[side] = Date.now();
    saveNow(victim);
    r.bleedUntil = now() + (gore === "full" ? BLEED : 0);
    applyLook(victim);
    if (side === "l") {
      try { const eq = victim.getComponent("minecraft:equippable"); const off = eq.getEquipment(EquipmentSlot.Offhand); if (off) { eq.setEquipment(EquipmentSlot.Offhand, undefined); dim.spawnItem(off, shoulder); } } catch { }
    }
    try { victim.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0.12, fadeOutTime: 0.6 }, fadeColor: gore === "full" ? { red: 0.55, green: 0, blue: 0 } : { red: 1, green: 1, blue: 1 } }); } catch { }
    try { victim.runCommand("camerashake add @s 0.7 0.4 positional"); } catch { }
    try { victim.onScreenDisplay.setTitle(" ", { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10, subtitle: `§4§l${side === "r" ? "RIGHT" : "LEFT"} ARM SEVERED` }); r.titleUntil = now() + 40; } catch { }
    msg(victim, `§4Your ${side === "r" ? "right" : "left"} arm is gone - for good. §7${gore === "full" ? "You're bleeding: use a §fBandage§7. " : ""}It won't grow back. An §fExo Prosthetic§7 from the Exo-Forge can replace what it did.`);
  } else {
    try {
      victim.setProperty(side === "r" ? "origin:arm_r" : "origin:arm_l", 1);
      victim.addEffect("weakness", 20 * 600, { amplifier: side === "r" ? 1 : 0, showParticles: false });
    } catch { }
  }
  if (attacker?.typeId === "minecraft:player") hudMsg(attacker, "§4§lSEVERED", 30);
}

// ------------------------------------------------------------------ the player's model + penalties
export function applyLook(p) {
  const h = hero(p);
  const L = h.limbs ?? { r: 1, l: 1 };
  const anim = !L.r && !L.l ? "animation.origin.limb.lose_both" : !L.r ? "animation.origin.limb.lose_right" : !L.l ? "animation.origin.limb.lose_left" : null;
  try {
    if (anim) p.playAnimation(anim, { controller: "origin_limbs", stopExpression: "0", blendOutTime: 0 });
    else p.playAnimation("animation.origin.limb.whole", { controller: "origin_limbs", stopExpression: "1", blendOutTime: 0 });
  } catch { }
}
function restore(p, side, how) {
  const h = hero(p);
  const L = h.limbs ?? { r: 1, l: 1 };
  if (L[side]) return;
  L[side] = 1;
  if (L.regrow) delete L.regrow[side];
  saveNow(p);
  applyLook(p);
  const yaw = (p.getRotation().y * Math.PI) / 180;
  const right = rightOf({ x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) });
  const sx = side === "r" ? 1 : -1;
  const sh = at(p.location, right.x * 0.38 * sx, 1.35, right.z * 0.38 * sx);
  for (let i = 0; i < 8; i++) fx(p.dimension, "origin:rise", at(sh, (Math.random() - 0.5) * 0.3, -0.4 + i * 0.05, (Math.random() - 0.5) * 0.3), C.gold, 1);
  sound(p.dimension, "random.levelup", p.location, 0.6, 1.6);
  if (how !== "regen") hudMsg(p, how === "prosthetic" ? "§bThe Exo Prosthetic locks in. §7It answers like an arm should." : "§6Restored.", 50);
  if (!L.r || !L.l) return;
  try { p.removeEffect("weakness"); p.removeEffect("mining_fatigue"); } catch { }
}
// Regeneration: the arm grows back - the model regrows it out of the shoulder
export function regrowLimb(p, side) {
  const L = hero(p).limbs;
  if (!L || L[side]) return false;
  restore(p, side, "regen");
  try { p.playAnimation(`animation.origin.limb.regrow_${side === "r" ? "right" : "left"}`, { controller: "origin_limbs", stopExpression: "0", blendOutTime: 0 }); } catch { }
  return true;
}
// on spawn / respawn: losses are permanent, just put the model back the way it should be
export function reapplyLimbs(p) {
  RT(p).bleedUntil = 0;
  applyLook(p);
}
// what we know about an arm (entity or item): whose, which side, when it came off, how it looks
function limbInfo(src) {
  const get = (k) => { try { return src.getDynamicProperty(k); } catch { return undefined; } };
  let owner = get("origin:owner"), side = get("origin:side"), cut = get("origin:cut"), look = get("origin:look");
  if (owner === undefined && typeof src.getLore === "function") {   // items from before v0.24 (or a world without item properties)
    try { const tag = src.getLore().find((l) => l.startsWith("§0§r")); if (tag) [owner, side, cut, look] = tag.slice(4).split("|"); } catch { }
  }
  return { owner: String(owner ?? ""), side: side === "l" ? "l" : "r", cut: Number(cut) || 0, look: Number(look) || 0 };
}
const freshness = (info) => (info.cut ? Date.now() - info.cut : Infinity);
function armItem(info, mine) {
  const it = new ItemStack("origin:severed_arm", 1);
  const age = freshness(info), fresh = age < FRESH_MS;
  const lore = [mine ? (fresh ? `§7Your ${info.side === "r" ? "right" : "left"} arm. §aStill warm.` : "§7Yours. §8It's gone cold.") : info.owner ? "§7Someone else's." : "§7Not anyone's any more."];
  if (mine && fresh) lore.push(`§7Use it with a §fBandage§7 in your bag to stitch it back on §8(${Math.max(1, Math.ceil((FRESH_MS - age) / 60000))} min left)`);
  lore.push("§8Sneak + use: put it down");
  let stored = false;
  try { it.setDynamicProperty("origin:owner", info.owner); it.setDynamicProperty("origin:side", info.side); it.setDynamicProperty("origin:cut", info.cut); it.setDynamicProperty("origin:look", info.look); stored = true; } catch { }
  if (!stored) lore.push(`§0§r${info.owner}|${info.side}|${info.cut}|${info.look}`);
  try { it.setLore(lore); } catch { }
  return it;
}
// pick up a severed arm: it goes in your bag. Yours and still fresh? Use it with a Bandage to stitch it back on.
export function onLimbInteract(p, e) {
  const i = limbs.findIndex((q) => q.e.id === e.id);
  const info = limbInfo(e);
  if (!info.owner && i >= 0) info.owner = limbs[i].owner;
  if (!info.cut) info.cut = Date.now() - FRESH_MS;   // an arm nobody kept track of has been lying there a while
  const mine = info.owner === p.id;
  try {
    const left = p.getComponent("minecraft:inventory").container.addItem(armItem(info, mine));
    if (left) { hudMsg(p, "§7No room in your bag.", 30); return; }
  } catch { return; }
  if (i >= 0) limbs.splice(i, 1);
  try { e.remove(); } catch { }
  sound(p.dimension, "random.pop", p.location, 0.6, 0.8);
  if (mine && freshness(info) < FRESH_MS && !hero(p).limbs?.[info.side]) hudMsg(p, "§aYour arm. §7Use it with a §fBandage§7 to stitch it back on - before it goes cold.", 70);
}
// set it down again (keeps whose it is and how long ago it came off)
export function dropArm(p, consume, item = null) {
  try {
    const info = item ? limbInfo(item) : { owner: "", side: "r", cut: Date.now() - FRESH_MS, look: 0 };
    const f = V.flat(p.getViewDirection());
    const e = flingLimb(p.dimension, at(p.location, f.x * 1.2, 0.6, f.z * 1.2), f, info.look, { owner: info.owner, side: info.side, cut: info.cut, spin: false, gore: "mild" });
    if (e) consume();
  } catch { }
}
// using a Severed Arm: sneak = put it down; otherwise try to stitch it back on (yours, fresh, and you have a Bandage)
const stitching = new Map();   // playerId -> {side, until}
export function useSeveredArm(p, consume) {
  let item;
  try { item = p.getComponent("minecraft:inventory").container.getItem(p.selectedSlotIndex); } catch { }
  if (!item) return;
  if (p.isSneaking) return dropArm(p, consume, item);
  const info = limbInfo(item), L = hero(p).limbs ?? { r: 1, l: 1 };
  if (stitching.has(p.id)) return;
  if (info.owner !== p.id) { hudMsg(p, "§7That's not your arm. §8(Sneak + use to put it down.)", 40); return; }
  if (L[info.side]) { hudMsg(p, "§7You've already got that arm.", 30); return; }
  if (L.prosthetic?.[info.side]) { hudMsg(p, "§7There's a prosthetic there now.", 30); return; }
  if (freshness(info) >= FRESH_MS) { hudMsg(p, "§8It's gone cold and grey. §7It won't take any more.", 50); return; }
  if (!hasBandage(p)) { hudMsg(p, "§7You need a §fBandage§7 in your bag to stitch it on.", 50); return; }
  stitchArm(p, info.side, consume);
}
function hasBandage(p) {
  try { const c = p.getComponent("minecraft:inventory").container; for (let i = 0; i < c.size; i++) if (c.getItem(i)?.typeId === "origin:bandage") return true; } catch { }
  return false;
}
function takeBandage(p) {
  try {
    const c = p.getComponent("minecraft:inventory").container;
    for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it?.typeId !== "origin:bandage") continue; if (it.amount > 1) { it.amount--; c.setItem(i, it); } else c.setItem(i, undefined); return true; }
  } catch { }
  return false;
}
// three seconds of holding still: hold the arm in place, wrap it, pull it tight. Getting hit or walking off spoils it.
async function stitchArm(p, side, consume) {
  const start = { ...p.location }, total = 60;
  stitching.set(p.id, { side });
  RT(p).bleedUntil = 0;   // pressing the arm to the wound stops the bleeding (or the bleed itself would "interrupt" you)
  const hp0 = health(p)?.cur ?? 0;
  try { p.addEffect("slowness", total + 10, { amplifier: 3, showParticles: false }); } catch { }
  sound(p.dimension, "armor.equip_leather", p.location, 0.8, 1);
  let ok = true;
  for (let t = 0; t < total; t += 5) {
    await system.waitTicks(5);
    if (!valid(p)) { stitching.delete(p.id); return; }
    const hpNow = health(p)?.cur ?? hp0;
    if (V.hdist(p.location, start) > 1.5 || hpNow < hp0 - 0.5) { ok = false; break; }
    const k = Math.round(((t + 5) / total) * 10);
    hudMsg(p, `§fStitching... §a${"|".repeat(k)}§8${"|".repeat(10 - k)}`, 8);
    if (t % 15 === 0) sound(p.dimension, "armor.equip_leather", p.location, 1 + t / 60, 0.6);
    const yaw = (p.getRotation().y * Math.PI) / 180, right = rightOf({ x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) }), sx = side === "r" ? 1 : -1;
    if (goreSetting() === "full") fx(p.dimension, "origin:blood_drip", at(p.location, right.x * 0.38 * sx, 1.3, right.z * 0.38 * sx), C.white, 1);
  }
  stitching.delete(p.id);
  try { p.removeEffect("slowness"); } catch { }
  if (!ok) { hudMsg(p, "§cYou lost your grip on it. §7Hold still and try again.", 40); return; }
  if (!takeBandage(p)) { hudMsg(p, "§7You need a §fBandage§7 in your bag to stitch it on.", 40); return; }
  consume();
  restore(p, side, "stitch");
  RT(p).bleedUntil = 0;
  try { p.addEffect("weakness", 20 * 60, { amplifier: 0, showParticles: false }); p.addEffect("mining_fatigue", 20 * 60, { amplifier: 0, showParticles: false }); } catch { }
  try { p.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0.05, fadeOutTime: 0.5 }, fadeColor: { red: 0.4, green: 0, blue: 0 } }); } catch { }
  sound(p.dimension, "random.levelup", p.location, 0.7, 0.8);
  hudMsg(p, "§aStitched. §7It's stiff and it aches - give it a minute.", 60);
}
// keep every arm sitting ON the ground (snap it back up if it ever sinks into a block)
function keepOnGround(e) {
  try {
    const l = e.location;
    const inside = e.dimension.getBlock({ x: Math.floor(l.x), y: Math.floor(l.y + 0.05), z: Math.floor(l.z) });
    if (inside && !inside.isAir && !inside.isLiquid) {
      for (let dy = 1; dy <= 3; dy++) {
        const b = e.dimension.getBlock({ x: Math.floor(l.x), y: Math.floor(l.y) + dy, z: Math.floor(l.z) });
        if (b?.isAir) { e.teleport({ x: l.x, y: Math.floor(l.y) + dy + 0.01, z: l.z }); break; }
      }
    }
  } catch { }
}

// an Exo Prosthetic replaces a lost arm (it gives back what the arm could do)
export function installProsthetic(p, consume) {
  const h = hero(p);
  const L = h.limbs;
  if (!L || (L.r && L.l)) { hudMsg(p, "§7You have both arms.", 30); return; }
  const side = !L.r ? "r" : "l";
  consume();
  L.prosthetic = L.prosthetic ?? {};
  L.prosthetic[side] = true;
  restore(p, side, "prosthetic");
  sound(p.dimension, "random.anvil_use", p.location, 1, 1.2);
  sound(p.dimension, "armor.equip_netherite", p.location, 1, 0.9);
  for (let i = 0; i < 10; i++) fx(p.dimension, "origin:spark", at(p.location, 0, 1.3, 0), i % 2 ? C.cyan : C.gold, 1);
}

// Bandage: stops the bleeding
export function useBandage(p, consume) {
  const r = RT(p);
  if (!((r.bleedUntil ?? 0) > now())) { hudMsg(p, "§7You're not bleeding.", 30); return; }
  consume();
  r.bleedUntil = 0;
  sound(p.dimension, "armor.equip_leather", p.location, 1, 1);
  hudMsg(p, "§fBandaged. §7The bleeding stops.", 40);
}

// every 10 ticks: bleeding, penalties, regrowth, limbs on the ground, and keeping the model right
export function tickLimbs() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const h = hero(p), r = RT(p);
    const L = h.limbs;
    if (!L || (L.r && L.l)) continue;
    const yaw = (p.getRotation().y * Math.PI) / 180;
    const right = rightOf({ x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) });
    // bleeding
    if ((r.bleedUntil ?? 0) > t) {
      let regen = false;
      try { regen = !!p.getEffect("regeneration"); } catch { }
      if (regen) r.bleedUntil = 0;
      else {
        for (const s of ["r", "l"]) if (!L[s]) fx(p.dimension, "origin:blood_drip", at(p.location, right.x * 0.38 * (s === "r" ? 1 : -1), 1.3, right.z * 0.38 * (s === "r" ? 1 : -1)), C.white, 1);
        if (t % 40 < 10) { try { p.applyDamage(1, { cause: EntityDamageCause.magic }); } catch { } }
      }
    }
    // penalties
    try {
      if (!L.r) { p.addEffect("weakness", 30, { amplifier: 1, showParticles: false }); p.addEffect("mining_fatigue", 30, { amplifier: 0, showParticles: false }); }
      if (!L.l) p.addEffect("slowness", 30, { amplifier: 0, showParticles: false });
    } catch { }
    // animations played on a player don't survive a dimension change or a respawn: put the look back at once
    let dimId = ""; try { dimId = p.dimension.id; } catch { }
    if (r.limbDim !== dimId) { r.limbDim = dimId; system.runTimeout(() => valid(p) && applyLook(p), 10); }
    if (t % 100 < 10) applyLook(p);   // and keep it right for anyone who walks into view
  }
  for (let i = limbs.length - 1; i >= 0; i--) {
    const q = limbs[i];
    if (!valid(q.e) || t > q.until) { try { if (valid(q.e)) { fx(q.e.dimension, "origin:void_swirl", q.e.location, C.grey, 0.6); q.e.remove(); } } catch { } limbs.splice(i, 1); continue; }
    keepOnGround(q.e);
    if (q.gore === "full" && t % 30 < 10 && (q.e.getProperty?.("origin:look") ?? 0) !== LIMB_LOOK.bone) fx(q.e.dimension, "origin:blood_drip", at(q.e.location, 0, 0.2, 0), C.white, 1);
  }
  // arms nobody is tracking any more (the world was reloaded): clear them out once they've lain there their time
  if (t % 200 < 10) {
    const seen = new Set(limbs.map((q) => q.e.id));
    for (const p of world.getAllPlayers()) {
      let list = [];
      try { list = p.dimension.getEntities({ type: "origin:severed_limb", location: p.location, maxDistance: 96 }); } catch { }
      for (const e of list) {
        if (seen.has(e.id)) continue;
        const info = limbInfo(e);
        if (!info.cut) { try { e.setDynamicProperty("origin:cut", Date.now()); } catch { } continue; }   // old arm: start its clock now
        if (Date.now() - info.cut > FRESH_MS) { try { fx(e.dimension, "origin:void_swirl", e.location, C.grey, 0.6); e.remove(); } catch { } }
        else limbs.push({ e, owner: info.owner, side: info.side, until: t + Math.max(200, Math.floor((FRESH_MS - (Date.now() - info.cut)) / 50)), gore: goreSetting() });
      }
    }
  }
}
export function limbLine(p) {
  const L = hero(p).limbs;
  if (!L || (L.r && L.l)) return null;
  const t = now(), r = RT(p);
  const parts = [];
  for (const s of ["r", "l"]) if (!L[s]) parts.push(`${s === "r" ? "right" : "left"} arm lost`);
  if ((r.bleedUntil ?? 0) <= t) return null;           // once the bleeding stops, the HUD lets it go
  return `§4✂ ${parts.join(" · ")} §c§lBLEEDING §r§7(Bandage)`;
}

// ------------------------------------------------------------------ the Katana's draw: IAIDO (use)
export async function iaido(p) {
  const r = RT(p), t = now();
  if ((r.iaidoCd ?? 0) > t) { hudMsg(p, `§7Sheathed... §c${((r.iaidoCd - t) / 20).toFixed(1)}s`, 20); return; }
  if (r.cine || r.caged) return;
  r.iaidoCd = t + 80;
  const dim = p.dimension, f = V.flat(p.getViewDirection());
  const start = { ...p.location };
  sound(dim, "item.trident.return", start, 0.8, 1.8);
  try { p.addEffect("slowness", 6, { amplifier: 10, showParticles: false }); } catch { }
  await system.waitTicks(6);
  if (!valid(p)) return;
  let dist = 6;
  try {
    const hb = dim.getBlockFromRay(at(start, 0, 1, 0), f, { maxDistance: 6, includePassableBlocks: false });
    if (hb) dist = Math.max(0, V.dist(at(start, 0, 1, 0), V.add(hb.block.location, hb.faceLocation)) - 0.7);
  } catch { }
  const end = at(start, f.x * dist, 0, f.z * dist);
  for (let k = 0; k <= 8; k++) fx(dim, "origin:missile_glow", V.lerp(at(start, 0, 1.1, 0), at(end, 0, 1.1, 0), k / 8), C.white, 1);
  try { p.teleport(end, { rotation: p.getRotation() }); } catch { }
  sound(dim, "item.trident.riptide_1", end, 1, 1.8);
  let list = [];
  try { list = dim.getEntities({ location: V.lerp(start, end, 0.5), maxDistance: dist / 2 + 1.6, excludeTypes: ["minecraft:item", "minecraft:xp_orb", "origin:float_text", "origin:severed_limb", "origin:lumen_construct", "origin:exo_piece", "origin:exo_drone"] }); } catch { }
  await system.waitTicks(4);   // the cut lands a beat after you pass
  for (const e of list) {
    if (e.id === p.id || !valid(e)) continue;
    const ap = V.sub(e.location, start);
    const along = Math.max(0, Math.min(dist, V.dot(V.flat(ap), f)));
    if (V.hdist(at(start, f.x * along, 0, f.z * along), e.location) > 1.8) continue;
    try { e.applyDamage(9, { cause: EntityDamageCause.entityAttack, damagingEntity: p }); } catch { }
    fx(dim, "origin:spark", at(e.location, 0, 1, 0), C.white, 1);
    tryCut(p, e, 9, "katana");
  }
}

// ================================================================== THE PROSTHETIC: a robotic arm that rides your shoulder
// It sits in the player's shoulder seat (the one parrots use), so it moves with you perfectly.
// MODULES (install by using the module item; up to 3; remove from the Codex):
//   Arm Cannon  - sneak + punch the air (empty hand): a plasma bolt
//   Grapple     - sneak + punch the air (empty hand): yank yourself to a block, or a target to you
//   Piston Fist - your punches hit +4 and throw people
//   Mining Drill- Haste II
//   Shield Emitter - crouch-blocking stops 80% instead of 60% and the parry window is longer
export const MODULES = {
  cannon: { name: "Arm Cannon", item: "origin:mod_cannon", bit: 1, active: true },
  grapple: { name: "Grapple Line", item: "origin:mod_grapple", bit: 2, active: true },
  piston: { name: "Piston Fist", item: "origin:mod_piston", bit: 4 },
  drill: { name: "Mining Drill", item: "origin:mod_drill", bit: 8 },
  shield: { name: "Shield Emitter", item: "origin:mod_shield", bit: 16 },
};
export const MODULE_OF_ITEM = Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [m.item, k]));
const arms = new Map();   // "playerId:side" -> entity
function prosSides(h) { const L = h.limbs; return L?.prosthetic ? Object.keys(L.prosthetic).filter((s) => L.prosthetic[s]) : []; }
function modBits(h) { return (h.limbs?.mods ?? []).reduce((a, k) => a | (MODULES[k]?.bit ?? 0), 0); }
export function installModule(p, key, consume) {
  const h = hero(p);
  if (!prosSides(h).length) { hudMsg(p, "§7You need an Exo Prosthetic first.", 40); return; }
  const mods = (h.limbs.mods ??= []);
  if (mods.includes(key)) { hudMsg(p, "§7That module is already installed.", 30); return; }
  if (mods.length >= 3) { hudMsg(p, "§7Three modules is the limit. Remove one in the Codex.", 40); return; }
  consume();
  mods.push(key);
  if (MODULES[key].active && !h.limbs.activeMod) h.limbs.activeMod = key;
  saveNow(p);
  sound(p.dimension, "random.anvil_use", p.location, 0.8, 1.6);
  for (let i = 0; i < 6; i++) fx(p.dimension, "origin:spark", at(p.location, 0, 1.2, 0), C.cyan, 1);
  hudMsg(p, `§b◆ ${MODULES[key].name} installed`, 40);
}
export function removeModule(p, key) {
  const h = hero(p);
  const mods = h.limbs?.mods ?? [];
  const i = mods.indexOf(key);
  if (i < 0) return;
  mods.splice(i, 1);
  if (h.limbs.activeMod === key) h.limbs.activeMod = mods.find((k) => MODULES[k].active) ?? null;
  try { p.getComponent("minecraft:inventory").container.addItem(new ItemStack(MODULES[key].item, 1)); } catch { }
  saveNow(p);
}
// every 2 ticks: keep each robotic arm seated on its owner's shoulder, facing the way they face
// The Exo Prosthetic is worn as an arm: a locked offhand item whose 3D model is bound to your arm bone, so it swings
// when you walk, comes up when you guard, and fully covers the arm. (Add-ons can't safely replace the player model itself.)
const ARM_ITEM = { r: "origin:exo_arm_r", l: "origin:exo_arm_l", both: "origin:exo_arm_both" };
let sweepAt = 0;
export function tickProsthetics() {
  const t = system.currentTick;
  for (const p of world.getAllPlayers()) {
    const h = hero(p), sides = prosSides(h);
    const want = sides.length >= 2 ? ARM_ITEM.both : sides.length ? ARM_ITEM[sides[0]] : null;
    let eq;
    try { eq = p.getComponent("minecraft:equippable"); } catch { continue; }
    if (!eq) continue;
    let off;
    try { off = eq.getEquipment(EquipmentSlot.Offhand); } catch { }
    const isArm = !!off && off.typeId.startsWith("origin:exo_arm_");
    if (want && off?.typeId !== want) {
      if (off && !isArm) { try { const left = p.getComponent("minecraft:inventory").container.addItem(off); if (left) p.dimension.spawnItem(left, p.location); } catch { } }
      try { const it = new ItemStack(want, 1); it.lockMode = ItemLockMode.slot; it.keepOnDeath = true; it.nameTag = "§bExo Prosthetic"; eq.setEquipment(EquipmentSlot.Offhand, it); } catch { }
    } else if (!want && isArm) { try { eq.setEquipment(EquipmentSlot.Offhand, undefined); } catch { } }
    if (modBits(h) & MODULES.drill.bit) { try { p.addEffect("haste", 30, { amplifier: 1, showParticles: false }); } catch { } }
  }
  for (const [key, e] of arms) { try { e.remove(); } catch { } arms.delete(key); }
  if (t - sweepAt > 100) {
    sweepAt = t;
    for (const p of world.getAllPlayers()) { try { for (const e of p.dimension.getEntities({ type: "origin:prosthetic", location: p.location, maxDistance: 48 })) e.remove(); } catch { } }
  }
}
// sneak + punch the air with an empty hand: fire the active module
export function onProstheticSwing(p, ev) {
  const h = hero(p);
  if (!p.isSneaking || ev?.heldItemStack || !prosSides(h).length) return;
  const key = h.limbs?.activeMod;
  if (!key) return;
  const r = RT(p), t = now();
  if ((r.modCd ?? 0) > t) return;
  const head = p.getHeadLocation(), dir = p.getViewDirection();
  if (key === "cannon") {
    r.modCd = t + 40;
    let tg = null;
    try { tg = p.getEntitiesFromViewDirection({ maxDistance: 24 }).map((x) => x.entity).find((e) => e.id !== p.id && e.typeId !== "origin:prosthetic"); } catch { }
    const end = tg ? tg.getHeadLocation() : V.add(head, V.mul(dir, 24));
    for (let k = 0; k <= 10; k++) fx(p.dimension, "origin:missile_glow", V.lerp(at(head, 0, -0.5, 0), end, k / 10), C.cyan, 1);
    fx(p.dimension, "origin:boom_fire", end, C.cyan, 1);
    sound(p.dimension, "mob.blaze.shoot", head, 1, 1.4);
    if (tg) { try { tg.applyDamage(7, { cause: EntityDamageCause.entityAttack, damagingEntity: p }); } catch { } }
  } else if (key === "grapple") {
    r.modCd = t + 50;
    let tg = null;
    try { tg = p.getEntitiesFromViewDirection({ maxDistance: 18 }).map((x) => x.entity).find((e) => e.id !== p.id && e.typeId !== "origin:prosthetic"); } catch { }
    if (tg) {
      const d = V.flat(V.sub(p.location, tg.location)), dist = V.hdist(p.location, tg.location);
      try { tg.applyKnockback({ x: d.x * Math.min(2.4, dist * 0.2), z: d.z * Math.min(2.4, dist * 0.2) }, 0.35); } catch { }
      for (let k = 0; k <= 8; k++) fx(p.dimension, "origin:dot", V.lerp(head, tg.getHeadLocation(), k / 8), C.gold, 1);
    } else {
      let hit = null;
      try { hit = p.getBlockFromViewDirection({ maxDistance: 18 }); } catch { }
      if (!hit) return;
      const pt = V.add(hit.block.location, hit.faceLocation);
      const d = V.sub(pt, p.location), flat = V.flat(d), dist = Math.hypot(d.x, d.z);
      try { p.applyKnockback({ x: flat.x * Math.min(3, 0.6 + dist * 0.2), z: flat.z * Math.min(3, 0.6 + dist * 0.2) }, Math.max(0.4, Math.min(1.3, 0.4 + d.y * 0.12))); } catch { }
      for (let k = 0; k <= 8; k++) fx(p.dimension, "origin:dot", V.lerp(head, pt, k / 8), C.gold, 1);
    }
    sound(p.dimension, "random.bow", head, 1, 1.4);
  }
}
// punches with a Piston Fist
export function onProstheticMelee(p, target) {
  const h = hero(p);
  if (!(modBits(h) & MODULES.piston.bit)) return;
  try { target.applyDamage(4, { cause: EntityDamageCause.entityAttack, damagingEntity: p }); } catch { }
  const d = V.flat(V.sub(target.location, p.location));
  try { target.applyKnockback({ x: d.x * 1.6, z: d.z * 1.6 }, 0.4); } catch { }
  fx(p.dimension, "origin:shockwave", at(target.location, 0, 1, 0), C.white, 0.8, { radius: 1 });
  sound(p.dimension, "random.anvil_land", target.location, 0.4, 1.8);
}
export function prostheticInfo(h) { return { sides: prosSides(h), mods: h.limbs?.mods ?? [], active: h.limbs?.activeMod ?? null }; }

// Mirror Hour: a limb lost in the last minute comes back
export function rewindLimb(p, side) { restore(p, side, "rewind"); }
