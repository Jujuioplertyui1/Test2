// ORIGIN v0.21 - exo.js (v0.21: repulsor jets on palms + boots, twin-palm repulsor blasts, Nano Housing, Wrist Laser, hunting drones, suit status HUD)
// THE EXO-FRAME, rebuilt. Four Marks you research, build, paint and upgrade at the Exo Workshop (workshop.js):
//   Mark I Forgeborn (riveted, tough, short rocket hops) · Mark II Skylark (fastest flyer, thin plating)
//   Mark III Vanguard (all-rounder) · Mark IV Bastion (siege plating, big reactor, shoulder cannon)
// Mix pieces freely: boots = thrusters, chest = reactor + weapons, helmet = sensors, plating averages across all four.
// Every piece is dyeable (your paint job), and the HUD/beam colors and the suit's name are yours too.
// Systems (Core Lance, Micro-Missiles, Drones, Arc Blade, Sky Catch) are Blueprints you research.
// Dismiss the suit and call it back: on the ground it flies in plate by plate; while you FALL it assembles on you
// mid-air and flies you down to a safe landing (Sky Catch).
import { world, system, ItemStack, EquipmentSlot, EnchantmentTypes } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { hero, RT, markDirty, saveNow, BAR, bar } from "./data.js";
import { V, at, valid, fx, line, sound, psound, C, now, hexToRgb, rgbToHex, msg, rightOf } from "./util.js";
import { oform, show, ICONS } from "./forms.js";
import { hudMsg } from "./voice.js";
import { runCine, EASE } from "./cine.js";
import { startFlight, stopFlight, isFlying } from "./flight.js";
import { dmg, NO_HIT, beamDamage } from "./powers.js";
import { aiSay, aiOf } from "./say.js";
import { XOX, xoxBlockBeam, xoxDeflect } from "./xox.js";
import { startBeam, stopBeam, beamActive, flashBeam, tinted } from "./beams.js";
import { heavyLaunch } from "./impact.js";

const R = (id, n) => ({ id, n });
const CYAN = hexToRgb("#55f2ff"), GOLD = hexToRgb("#d9a441"), EMBER = hexToRgb("#ff7a1a"), FIRE = hexToRgb("#ff8a2a");
export const SLOT_KEYS = ["head", "chest", "legs", "feet"];
const SLOTS = [["head", "Head"], ["chest", "Chest"], ["legs", "Legs"], ["feet", "Feet"]];
const SLOT_WORD = { head: "helmet", chest: "chestplate", legs: "leggings", feet: "boots" };
export const SLOT_NAME = { head: "Helmet", chest: "Chestplate", legs: "Leggings", feet: "Boots" };
const STAGES = ["", "_scuffed", "_battered"];

// ------------------------------------------------------------------ the Marks (balance lives here)
export const MARKS = {
  mk1: { key: "mk1", idx: 0, num: "I", name: "Mark I", title: "Forgeborn", prefix: "origin:exo1_", paint: "#6E737B", glow: "#FFA347",
    armor: 1, fly: 0.72, drain: 1.2, air: 20 * 14, reactor: 80, rep: 6, sensor: 20,
    blurb: "Riveted scrap-plate built from iron and stubbornness. Tough and heavy: short rocket hops, not real flight." },
  mk2: { key: "mk2", idx: 1, num: "II", name: "Mark II", title: "Skylark", prefix: "origin:exo2_", paint: "#D8DEE6", glow: "#7CF3FF",
    armor: -1, fly: 1.3, drain: 0.7, air: 20 * 180, reactor: 100, rep: 6, sensor: 28,
    blurb: "A sleek interceptor. The fastest flyer with the most efficient thrusters - and the thinnest plating." },
  mk3: { key: "mk3", idx: 2, num: "III", name: "Mark III", title: "Vanguard", prefix: "origin:exo_", paint: "#2F4E8C", glow: "#D8FBFF",
    armor: 0, fly: 1.0, drain: 1.0, air: 20 * 120, reactor: 100, rep: 7, sensor: 32,
    blurb: "The all-rounder: balanced plating, flight and firepower. Best sensors of the four." },
  mk4: { key: "mk4", idx: 3, num: "IV", name: "Mark IV", title: "Bastion", prefix: "origin:exo4_", paint: "#3B3F46", glow: "#FF4A3D",
    armor: 2, fly: 0.85, drain: 1.25, air: 20 * 90, reactor: 130, rep: 9, sensor: 28,
    blurb: "Siege armor. The heaviest plating, the biggest reactor and a shoulder cannon. Slow in the air." },
};
export const MARK_KEYS = ["mk1", "mk2", "mk3", "mk4"];
export const pieceId = (mark, slot, stage = 0) => MARKS[mark].prefix + SLOT_WORD[slot] + STAGES[stage];
const ID_INFO = new Map();
for (const m of MARK_KEYS) for (const s of SLOT_KEYS) for (let st = 0; st < 3; st++) ID_INFO.set(pieceId(m, s, st), { mark: m, slot: s, stage: st, base: pieceId(m, s, 0) });
export function pieceOf(typeId) { return typeId ? ID_INFO.get(typeId) ?? null : null; }
export const EXO = { head: pieceId("mk3", "head"), chest: pieceId("mk3", "chest"), legs: pieceId("mk3", "legs"), feet: pieceId("mk3", "feet") };
export const INTERFACE = "origin:exo_interface";

export const HUD_COLORS = [["Red", "#FF3B30"], ["Cyan", "#4FE3FF"], ["Gold", "#FFC845"], ["Green", "#4CFF7A"], ["Violet", "#B07CFF"], ["White", "#F2F6FF"]];
export const HUD_CODES = ["§c", "§b", "§6", "§a", "§d", "§f"];
export const BEAM_COLORS = [["Arc Blue", "#55F2FF"], ["Red", "#FF4A3D"], ["Gold", "#FFD36A"], ["White", "#FFFFFF"], ["Violet", "#B07CFF"], ["Green", "#5CFF8A"]];

export const UPGRADES = {
  reactor: { name: "Reactor", icon: "x_up_reactor", desc: "+25 reactor capacity and +25% recharge per level" },
  thrusters: { name: "Thrusters", icon: "x_up_thrusters", desc: "+12% flight speed, -15% drain, +25% air time per level" },
  plating: { name: "Plating", icon: "x_up_plating", desc: "tougher armor: more damage resistance" },
  repulsors: { name: "Repulsors", icon: "x_up_repulsor", desc: "+2 repulsor damage and a faster recharge per level" },
  sensors: { name: "Sensors", icon: "x_up_sensors", desc: "+8 blocks targeting range, +2 tracked targets, wider ore scans" },
  ordnance: { name: "Ordnance", icon: "x_up_ordnance", desc: "+2 missile locks and +1 missile damage per level" },
};
export const UP_KEYS = Object.keys(UPGRADES);
export const MAX_UP = 3;
export function upCost(level) {
  const c = [R("origin:aetherium_ingot", level * 2), R("origin:starmetal_plate", level), R("minecraft:redstone_block", level)];
  if (level === 3) c.push(R("origin:null_crystal", 1));
  return c;
}

export const BLUEPRINTS = {
  mk1: { name: "Mark I · Forgeborn", kind: "mark", icon: "x_mk1", data: 0, need: [], desc: MARKS.mk1.blurb },
  mk2: { name: "Mark II · Skylark", kind: "mark", icon: "x_mk2", data: 3, need: [R("origin:aetherium_ingot", 2), R("minecraft:phantom_membrane", 4), R("minecraft:feather", 8)], desc: MARKS.mk2.blurb },
  mk3: { name: "Mark III · Vanguard", kind: "mark", icon: "x_mk3", data: 4, need: [R("origin:aetherium_ingot", 3), R("minecraft:gold_block", 1), R("origin:starmetal_plate", 1)], desc: MARKS.mk3.blurb },
  mk4: { name: "Mark IV · Bastion", kind: "mark", icon: "x_mk4", data: 6, need: [R("minecraft:netherite_ingot", 2), R("minecraft:obsidian", 16), R("origin:starmetal_plate", 2)], desc: MARKS.mk4.blurb },
  lance: { name: "Core Lance", kind: "system", icon: "x_lance", data: 3, need: [R("origin:null_crystal", 1), R("minecraft:amethyst_shard", 8)], desc: "Charge 1.5s, then a 5s piercing beam from the chest reactor." },
  missiles: { name: "Micro-Missiles", kind: "system", icon: "x_missiles", data: 3, need: [R("minecraft:tnt", 4), R("minecraft:firework_rocket", 8)], desc: "Shoulder pods lock several targets and fire homing micro-missiles." },
  drones: { name: "Sentinel Drones", kind: "system", icon: "x_drones", data: 4, need: [R("minecraft:observer", 2), R("origin:aetherium_ingot", 2)], desc: "Two drones orbit you and shoot hostiles for 30 seconds." },
  blade: { name: "Arc Blade", kind: "system", icon: "x_blade", data: 3, need: [R("minecraft:diamond", 2), R("minecraft:prismarine_crystals", 4)], desc: "A hard-light blade forms on your forearm for 15 seconds." },
  laser: { name: "Wrist Laser", kind: "system", icon: "x_laser", data: 3, need: [R("minecraft:diamond", 1), R("minecraft:redstone", 16), R("minecraft:glass", 4)], desc: "A thin cutting laser from the wrist for 1.5 seconds: it slices through whatever you sweep it across." },
  nano: { name: "Nano Housing", kind: "system", icon: "x_nano", data: 5, need: [R("minecraft:netherite_ingot", 1), R("origin:null_crystal", 1), R("minecraft:redstone_block", 2)], desc: "The suit lives inside the reactor: call it and it flows over you in a second (even mid-fall); stow it and it pours back in." },
  skycatch: { name: "Sky Catch Protocol", kind: "system", icon: "x_skycatch", data: 2, need: [R("minecraft:feather", 4), R("minecraft:redstone", 8)], desc: "Fall too far and the suit catches you on its own. No button needed." },
  advanced: { name: "Advanced Schematics", kind: "tier", icon: "x_upgrade", data: 5, need: [R("origin:rift_heart", 1)], desc: "Unlocks level 3 upgrades." },
};
export const BP_KEYS = Object.keys(BLUEPRINTS);

export function buildCost(mark, slot) {
  const A = "origin:aetherium_ingot", S = "origin:starmetal_plate", N = "minecraft:netherite_ingot";
  if (mark === "mk1") return {
    head: [R("minecraft:iron_block", 2), R(A, 1)],
    chest: [R("minecraft:iron_block", 4), R(A, 2), R("minecraft:blaze_rod", 2), R("minecraft:redstone_block", 1)],
    legs: [R("minecraft:iron_block", 3), R(A, 1)],
    feet: [R("minecraft:iron_block", 2), R(A, 1), R("minecraft:blaze_rod", 2)],
  }[slot];
  const base = {
    head: [R(A, 3), R(S, 2), R(N, 1), R("origin:null_crystal", 1)],
    chest: [R("origin:reactor_core", 1), R(S, 4), R(A, 4), R(N, 2)],
    legs: [R(A, 3), R(S, 3), R(N, 1)],
    feet: [R(A, 2), R(S, 2), R(N, 1), R("minecraft:blaze_rod", 2)],
  }[slot].map((x) => ({ ...x }));
  if (mark === "mk2") base.push(R("minecraft:phantom_membrane", 2));
  if (mark === "mk4") base.push(R("minecraft:obsidian", 6));
  return base;
}

// ------------------------------------------------------------------ saved data (migrates v0.12 heroes)
export function exoData(h) {
  const legacy = !!h.exo && !h.exo.v13 && Object.keys(h.exo).length > 0;
  if (!h.exo) h.exo = {};
  const x = h.exo;
  if (!x.v13) {
    x.v13 = 1;
    x.paint = { primary: null, hud: 0, beam: 0, name: "", ...(x.paint ?? {}) };
    x.up = { ...(x.up ?? {}) };
    x.bp = Array.isArray(x.bp) ? x.bp : [];
    if (!x.bp.includes("mk1")) x.bp.push("mk1");
    // heroes who already built the old Exo-Frame keep everything it could do
    if (legacy) for (const k of ["mk3", "lance", "missiles", "drones", "blade", "skycatch"]) if (!x.bp.includes(k)) x.bp.push(k);
    x.ai = { name: "ATLAS", addr: "sir", chatter: true, ...(x.ai ?? {}) };
    x.opts = { target: true, nv: true, autoCatch: true, ...(x.opts ?? {}) };
    x.waypoints = Array.isArray(x.waypoints) ? x.waypoints : [];
  }
  if (x.reactor === undefined || Number.isNaN(x.reactor)) x.reactor = 100;
  return x;
}
export const knows = (h, key) => exoData(h).bp.includes(key);
export const hudIndex = (p) => Math.max(0, Math.min(HUD_COLORS.length - 1, exoData(hero(p)).paint.hud ?? 0));
export const hudCode = (p) => HUD_CODES[hudIndex(p)];
export function beamCol(p) { const i = exoData(hero(p)).paint.beam ?? 0; return hexToRgb((BEAM_COLORS[i] ?? BEAM_COLORS[0])[1]); }

// ------------------------------------------------------------------ inventory helpers
export function inv(p) { try { return p.getComponent("minecraft:inventory").container; } catch { return null; } }
function eq(p) { try { return p.getComponent("minecraft:equippable"); } catch { return null; } }
export function count(p, id) {
  const c = inv(p); if (!c) return 0;
  let n = 0;
  for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it?.typeId === id) n += it.amount; }
  return n;
}
export function take(p, id, n) {
  const c = inv(p); if (!c) return;
  for (let i = 0; i < c.size && n > 0; i++) {
    const it = c.getItem(i);
    if (it?.typeId !== id) continue;
    const k = Math.min(n, it.amount);
    n -= k;
    if (it.amount > k) { it.amount -= k; c.setItem(i, it); } else c.setItem(i, undefined);
  }
}
export function give(p, idOrStack, n = 1) {
  try {
    const st = typeof idOrStack === "string" ? new ItemStack(idOrStack, n) : idOrStack;
    const left = inv(p).addItem(st);
    if (left) p.dimension.spawnItem(left, p.location);
  } catch { }
}
export const NICE = (id) => (id.split(":")[1] ?? id).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const hasAll = (p, need) => need.every((x) => count(p, x.id) >= x.n);
export const needText = (p, need) => need.map((x) => `${count(p, x.id) >= x.n ? "§a" : "§c"}${Math.min(count(p, x.id), x.n)}/${x.n} ${NICE(x.id)}`).join("§8, ");

// ------------------------------------------------------------------ what you're wearing
export function fullSuit(p) {
  const e = eq(p); if (!e) return false;
  try { return SLOTS.every(([slot, s]) => pieceOf(e.getEquipment(EquipmentSlot[s])?.typeId)?.slot === slot); } catch { return false; }
}
export function wornMarks(p) {
  const e = eq(p), out = {};
  for (const [slot, s] of SLOTS) { try { const pc = pieceOf(e?.getEquipment(EquipmentSlot[s])?.typeId); out[slot] = pc?.slot === slot ? pc.mark : null; } catch { out[slot] = null; } }
  return out;
}
export function integrity(p) {
  const e = eq(p), out = {};
  for (const [slot, s] of SLOTS) {
    out[slot] = null;
    try {
      const it = e?.getEquipment(EquipmentSlot[s]);
      if (pieceOf(it?.typeId)?.slot !== slot) continue;
      const d = it.getComponent("minecraft:durability");
      out[slot] = d ? 1 - d.damage / d.maxDurability : 1;
    } catch { }
  }
  return out;
}
export function offline(p) {
  const I = integrity(p), out = {};
  for (const k in I) out[k] = I[k] !== null && I[k] <= 0.05;
  return out;
}
export function statsOf(p, x = exoData(hero(p))) {
  const mk = wornMarks(p);
  const M = (slot) => MARKS[mk[slot] ?? "mk3"];
  const up = (k) => Math.max(0, Math.min(MAX_UP, x.up?.[k] ?? 0));
  const armorAvg = SLOT_KEYS.reduce((a, s) => a + (mk[s] ? MARKS[mk[s]].armor : 0), 0) / 4;
  return {
    marks: mk,
    fly: M("feet").fly * (1 + 0.12 * up("thrusters")),
    drain: M("feet").drain * (1 - 0.15 * up("thrusters")),
    air: Math.round(M("feet").air * (1 + 0.25 * up("thrusters"))),
    cap: M("chest").reactor + 25 * up("reactor"),
    regen: 1.2 * (1 + 0.25 * up("reactor")),
    rep: M("chest").rep + 2 * up("repulsors"),
    repCd: Math.max(10, 24 - 4 * up("repulsors")),
    resist: Math.max(0, Math.min(2, Math.floor((armorAvg + up("plating") + 2) / 2))),
    sensor: M("head").sensor + 8 * up("sensors"),
    tracks: 4 + 2 * up("sensors"),
    scan: 20 + 6 * up("sensors"),
    locks: 6 + 2 * up("ordnance"),
    missileDmg: 5 + up("ordnance"),
    cannon: mk.chest === "mk4",
    swift: mk.legs === "mk2",
  };
}
export function suitName(p) {
  const x = exoData(hero(p));
  if (x.paint.name) return x.paint.name;
  const mk = Object.values(wornMarks(p)).filter(Boolean);
  if (mk.length && mk.every((m) => m === mk[0])) return `${MARKS[mk[0]].name} ${MARKS[mk[0]].title}`;
  if (x.stored?.length) { const m = x.stored[0].mark ?? "mk3"; if (x.stored.every((d) => (d.mark ?? "mk3") === m)) return `${MARKS[m].name} ${MARKS[m].title}`; }
  return "Custom Frame";
}

// ------------------------------------------------------------------ pieces: making, painting, damage states
const CAP = 30;   // durability left when a piece "bottoms out" (pieces never break; they go offline)
export function enchOf(it) {
  try { return it.getComponent("minecraft:enchantable")?.getEnchantments().map((e) => [e.type.id, e.level]) ?? []; } catch { return []; }
}
export function colorOf(it) {
  try { const c = it?.getComponent("minecraft:dyeable")?.color; return c ? rgbToHex(c) : null; } catch { return null; }
}
export function paintFor(x, mark) { return x.paint.primary || MARKS[mark]?.paint || "#2F4E8C"; }
export function makePiece(slot, stage = 0, damage = 0, ench = [], nameTag = null, mark = "mk3", color = null) {
  const it = new ItemStack(pieceId(mark, slot, stage), 1);
  try { const d = it.getComponent("minecraft:durability"); if (d) d.damage = Math.max(0, Math.min(d.maxDurability - CAP, damage)); } catch { }
  if (color) try { const dy = it.getComponent("minecraft:dyeable"); if (dy) dy.color = hexToRgb(color); } catch { }
  try {
    const en = it.getComponent("minecraft:enchantable");
    for (const [id, lvl] of ench ?? []) { const t = EnchantmentTypes.get(id); if (t) en?.addEnchantment({ type: t, level: lvl }); }
  } catch { }
  if (nameTag) try { it.nameTag = nameTag; } catch { }
  it.keepOnDeath = true;
  return it;
}
// repaint every Exo piece you're wearing or carrying (and the stored suit)
export function repaintSuit(p, hex) {
  const rgbC = hexToRgb(hex);
  let n = 0;
  const e = eq(p);
  for (const [, s] of SLOTS) {
    try {
      const it = e.getEquipment(EquipmentSlot[s]);
      if (!pieceOf(it?.typeId)) continue;
      const d = it.getComponent("minecraft:dyeable");
      if (d) { d.color = rgbC; e.setEquipment(EquipmentSlot[s], it); n++; }
    } catch { }
  }
  const c = inv(p);
  for (let i = 0; c && i < c.size; i++) {
    try {
      const it = c.getItem(i);
      if (!pieceOf(it?.typeId)) continue;
      const d = it.getComponent("minecraft:dyeable");
      if (d) { d.color = rgbC; c.setItem(i, it); n++; }
    } catch { }
  }
  const x = exoData(hero(p));
  for (const d of x.stored ?? []) { d.color = hex; n++; }
  markDirty(p);
  return n;
}
export function repaintFactory(p) {
  const e = eq(p), c = inv(p);
  const set = (it) => { const pc = pieceOf(it?.typeId); if (!pc) return false; try { const d = it.getComponent("minecraft:dyeable"); if (d) { d.color = hexToRgb(MARKS[pc.mark].paint); return true; } } catch { } return false; };
  for (const [, s] of SLOTS) { try { const it = e.getEquipment(EquipmentSlot[s]); if (set(it)) e.setEquipment(EquipmentSlot[s], it); } catch { } }
  for (let i = 0; c && i < c.size; i++) { try { const it = c.getItem(i); if (set(it)) c.setItem(i, it); } catch { } }
  for (const d of exoData(hero(p)).stored ?? []) d.color = MARKS[d.mark ?? "mk3"].paint;
  markDirty(p);
}
export function damagedPieces(p) {
  const out = [];
  const e = eq(p);
  for (const [, s] of SLOTS) { try { const it = e.getEquipment(EquipmentSlot[s]); const d = it?.getComponent("minecraft:durability"); if (pieceOf(it?.typeId) && d && d.damage > 0) out.push({ where: "worn", s, it }); } catch { } }
  const c = inv(p);
  for (let i = 0; c && i < c.size; i++) { const it = c.getItem(i); const d = it?.getComponent?.("minecraft:durability"); if (pieceOf(it?.typeId) && d && d.damage > 0) out.push({ where: "inv", i, it }); }
  return out;
}
export function repairPieces(p, hurt) {
  const e = eq(p), c = inv(p);
  for (const hp of hurt) {
    const pc = pieceOf(hp.it.typeId);
    const fresh = makePiece(pc.slot, 0, 0, enchOf(hp.it), hp.it.nameTag, pc.mark, colorOf(hp.it));
    try { if (hp.where === "worn") e.setEquipment(EquipmentSlot[hp.s], fresh); else c.setItem(hp.i, fresh); } catch { }
  }
}
const stageFor = (frac) => (frac > 0.6 ? 0 : frac > 0.3 ? 1 : 2);
function syncDamage(p) {
  const e = eq(p); if (!e) return;
  for (const [slot, s] of SLOTS) {
    let it; try { it = e.getEquipment(EquipmentSlot[s]); } catch { continue; }
    const pc = pieceOf(it?.typeId);
    if (!pc || pc.slot !== slot) continue;
    const d = it.getComponent("minecraft:durability");
    if (!d) continue;
    let damage = d.damage;
    const clampIt = damage > d.maxDurability - CAP;
    if (clampIt) damage = d.maxDurability - CAP;
    const want = stageFor(1 - damage / d.maxDurability);
    if (want === pc.stage && !clampIt) continue;
    const next = makePiece(slot, want, damage, enchOf(it), it.nameTag, pc.mark, colorOf(it));
    try { e.setEquipment(EquipmentSlot[s], next); } catch { }
    if (want > pc.stage) {
      const name = { head: "HELMET", chest: "CHEST", legs: "LEGS", feet: "BOOTS" }[slot];
      hudMsg(p, want === 2 ? `§c◆ ${name} BATTERED §7- repair at the Exo Workshop` : `§e◆ ${name} DAMAGED`, 50);
      if (want === 2) aiSay(p, `${SLOT_NAME[slot]} integrity critical, {addr}. I'd get that looked at.`);
      sound(p.dimension, "random.anvil_land", p.location, 0.5, 0.7);
      for (let i = 0; i < 6; i++) fx(p.dimension, "origin:spark", at(p.location, 0, slotY(slot), 0), FIRE, 1);
    }
  }
}
const slotY = (slot) => ({ head: 1.75, chest: 1.25, legs: 0.75, feet: 0.2 })[slot];
export function exoHurt(p, amount) {
  if (!Object.values(integrity(p)).some((v) => v !== null)) return;
  const h = p.getHeadLocation();
  for (let i = 0; i < 4 + Math.min(8, amount); i++) fx(p.dimension, "origin:spark", at(h, (Math.random() - 0.5) * 0.6, -0.4 - Math.random() * 0.6, (Math.random() - 0.5) * 0.6), i % 2 ? FIRE : C.white, 1);
  sound(p.dimension, "random.anvil_land", p.location, 0.25, 1.6 + Math.random() * 0.3);
  if (amount >= 5) sound(p.dimension, "origin.sfx.impact", p.location, 0.9 + Math.random() * 0.2, 0.6);
  system.run(() => valid(p) && syncDamage(p));
}

// ------------------------------------------------------------------ suiting up (first time) + the per-second loop
async function suitUp(p) {
  const h = hero(p), x = exoData(h);
  x.suited = true;
  saveNow(p);
  await runCine(p, async (c) => {
    const base = { ...p.location }, dim = p.dimension;
    const f = V.flat(p.getViewDirection());
    try { p.addEffect("slowness", 160, { amplifier: 10, showParticles: false }); } catch { }
    const parts = [["feet", 0.2], ["legs", 0.8], ["chest", 1.3], ["head", 1.75]];
    for (let i = 0; i < parts.length; i++) {
      const y = parts[i][1];
      const a = (i / 4) * Math.PI * 1.4 - 0.8;
      c.cam(at(base, Math.cos(a) * 2.2, y + 0.3, Math.sin(a) * 2.2), at(base, 0, y, 0), i ? 0.5 : 0, EASE.OutCubic);
      await c.wait(6);
      sound(dim, "origin.sfx.servo", base, 0.9 + i * 0.08, 1);
      sound(dim, "armor.equip_netherite", base, 1, 1);
      for (let k = 0; k < 6; k++) fx(dim, "origin:spark", at(base, (Math.random() - 0.5) * 0.9, y + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.9), k % 2 ? GOLD : CYAN, 1);
      await c.wait(8);
    }
    c.cam(at(base, f.x * 2.4, 1.7, f.z * 2.4), at(base, 0, 1.55, 0), 0.6, EASE.InOutSine);
    c.say("§b◆ REACTOR ONLINE", 40);
    sound(dim, "beacon.activate", base, 1, 1.4);
    fx(dim, "origin:burst", at(base, 0, 1.3, 0), CYAN, 1);
    await c.wait(24);
    c.say(`§b◆ ${suitName(p).toUpperCase()}`, 40);
    fx(dim, "origin:shockwave", at(base, 0, 0.05, 0), CYAN, 1, { radius: 3 });
    try { p.applyKnockback({ x: 0, z: 0 }, 0.7); } catch { }
    await c.wait(30);
  });
  try { p.removeEffect("slowness"); } catch { }
  if (count(p, INTERFACE) === 0) give(p, INTERFACE, 1);
  aiSay(p, `Hello, {addr}. I'm {name} - I run the suit. Talk to me any time: /${aiOf(p).name.toLowerCase()} status, or /ai <anything>.`);
  msg(p, "§b§lEXO-FRAME ONLINE. §r§7Double-tap jump: thrusters. §fExo Interface§7: use = repulsor, sneak + use = systems. §8Build, paint and upgrade at the Exo Workshop.");
}

// every 10 ticks
export function tickExo() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const full = fullSuit(p);
    const r = RT(p);
    const h = hero(p);
    if (!full) {
      if (r.exoOn) {
        r.exoOn = false;
        if (isFlying(p) && r.fly?.kind === "exo") stopFlight(p, "tired");
        if (r.exoNv) { r.exoNv = false; try { p.removeEffect("night_vision"); } catch { } }
      }
      continue;
    }
    const x = exoData(h);
    if (!x.suited && !r.cine && !r.suitBusy) { suitUp(p); continue; }
    r.exoOn = true;
    syncDamage(p);
    const st = statsOf(p, x);
    r.exoStats = st;
    const off = offline(p), I = integrity(p);
    try {
      p.addEffect("resistance", 60, { amplifier: st.resist, showParticles: false });
      p.addEffect("fire_resistance", 60, { showParticles: false });
      p.addEffect("water_breathing", 60, { showParticles: false });
      if (!off.head && x.opts.nv !== false) { p.addEffect("night_vision", 400, { showParticles: false }); r.exoNv = true; }
      else if (r.exoNv && (x.opts.nv === false || Math.random() < 0.3)) { p.removeEffect("night_vision"); if (x.opts.nv === false) r.exoNv = false; }
      if (off.legs) p.addEffect("slowness", 30, { amplifier: 1, showParticles: false });
      else if (st.swift) p.addEffect("speed", 30, { amplifier: 0, showParticles: false });
    } catch { }
    x.cap = off.chest ? 30 : st.cap;
    if (!isFlying(p)) x.reactor = Math.min(x.cap, (x.reactor ?? 100) + (I.chest < 0.3 ? st.regen / 2 : st.regen));
    if (off.feet && isFlying(p) && r.fly?.kind === "exo") { stopFlight(p, "tired"); hudMsg(p, "§c◆ THRUSTERS OFFLINE", 40); }
    for (const k in I) if (I[k] !== null && I[k] < 0.3 && Math.random() < 0.5) fx(p.dimension, k === "chest" ? "origin:boom_smoke" : "origin:spark", at(p.location, (Math.random() - 0.5) * 0.5, slotY(k), (Math.random() - 0.5) * 0.5), k === "chest" ? C.grey : FIRE, 0.5);
    if (t % 40 < 10) markDirty(p);
  }
}
export function exoLine(p) {
  const r = RT(p);
  if (!r.exoOn) return null;
  const x = exoData(hero(p));
  const cap = Math.max(1, x.cap ?? 100);
  const I = integrity(p);
  const col = (v) => (v === null ? "§8" : v <= 0.05 ? "§4" : v < 0.3 ? "§c" : v < 0.6 ? "§e" : "§a");
  const parts = [["H", I.head], ["C", I.chest], ["L", I.legs], ["B", I.feet]].map(([k, v]) => `${col(v)}${k}${v === null ? "-" : Math.round(v * 100)}`).join(" ");
  if (I.head !== null && I.head < 0.3 && Math.random() < 0.25) return "§8◆ EXO §k#####§r §8signal lost";
  const c = hudCode(p);
  const fl = isFlying(p) && r.fly?.kind === "exo" ? r.fly : null;
  const nav = fl ? ` §7ALT §f${Math.round(groundDist(p, 128))}§7m SPD §f${Math.round(Math.hypot(fl.v?.x ?? 0, fl.v?.y ?? 0, fl.v?.z ?? 0) * 20)}` : "";
  return `${c}◆ §f${bar(BAR.energy, (x.reactor ?? 0) / cap, 6)} ${c}${Math.round(x.reactor ?? 0)}§7/${cap}${nav} ${parts}`;
}
export function visorOn(p) {
  const I = integrity(p);
  return I.head !== null && I.head > 0.05;
}

// ------------------------------------------------------------------ thrusters
export function canExoFly(p) {
  if (!fullSuit(p)) return false;
  if ((RT(p).groundedUntil ?? 0) > now()) { hudMsg(p, "§5Gravity lock - the thrusters can't fight it", 30); return false; }
  if (offline(p).feet) { hudMsg(p, "§c◆ THRUSTERS OFFLINE §7- repair the boots", 30); return false; }
  const x = exoData(hero(p));
  if ((x.reactor ?? 0) < 10) { hudMsg(p, "§bReactor too low for thrusters", 30); return false; }
  return true;
}
export function exoTakeoff(p) {
  const st = statsOf(p);
  RT(p).exoStats = st;
  let engineAt = 0;
  return startFlight(p, {
    kind: "exo", maxTicks: st.air, mult: st.fly, col: beamCol(p),
    onTick: (pl, age, boosting) => {
      const x = exoData(hero(pl));
      x.reactor -= (boosting ? 0.2 : 0.08) * st.drain;
      thrusterJets(pl, age, boosting);
      if (age - engineAt >= (boosting ? 26 : 40)) { engineAt = age; sound(pl.dimension, "origin.sfx.engine", pl.location, boosting ? 1.15 : 0.95, boosting ? 0.55 : 0.35); }
      if (x.reactor <= 0) { x.reactor = 0; hudMsg(pl, "§bREACTOR DEPLETED", 40); aiSay(pl, "Reactor's dry, {addr}. Gliding you down."); return false; }
      if (x.reactor < 12 && age % 100 === 0) aiSay(pl, `Reactor at ${Math.round(x.reactor)}, {addr}. I'd find somewhere to land.`, { chat: false });
      return true;
    },
    onEnd: (pl) => markDirty(pl),
  });
}
// repulsor jets on both palms and both boots: a white-hot core inside the beam colour. They point down while you
// hover and back while you fly, and stretch long and orange-hot when you boost. Hovering low kicks up dust.
const JET_HOT = { red: 1, green: 0.62, blue: 0.25 }, JWHITE = { red: 1, green: 1, blue: 1 };
function thrusterJets(p, age, boosting) {
  const f = RT(p).fly;
  if (!f) return;
  const dim = p.dimension, L = p.location, v = f.v ?? { x: 0, y: 0, z: 0 }, spd = Math.hypot(v.x, v.y, v.z);
  const look = p.getViewDirection(), lf = V.flat(look), rt = { x: -lf.z, y: 0, z: lf.x };
  const glow = boosting ? JET_HOT : beamCol(p), cruising = f.pose === "fly";
  let pts, dir;
  if (cruising) {
    const c0 = at(L, 0, 0.42, 0), heel = V.add(c0, V.mul(lf, -0.95)), hip = V.add(c0, V.mul(lf, -0.15));
    pts = [V.add(heel, V.mul(rt, 0.13)), V.add(heel, V.mul(rt, -0.13)), V.add(hip, V.mul(rt, 0.4)), V.add(hip, V.mul(rt, -0.4))];
    dir = V.mul(V.norm(spd > 0.05 ? v : look), -1);
  } else {
    pts = [at(L, rt.x * 0.13, 0.02, rt.z * 0.13), at(L, -rt.x * 0.13, 0.02, -rt.z * 0.13), at(L, rt.x * 0.55, 0.72, rt.z * 0.55), at(L, -rt.x * 0.55, 0.72, -rt.z * 0.55)];
    dir = { x: 0, y: -1, z: 0 };
  }
  const len = boosting ? 1.6 : cruising ? 0.95 : 0.55 + Math.min(0.4, spd);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], palm = i >= 2, ln = palm ? len * 0.75 : len;
    fx(dim, "origin:beam_pulse", V.add(a, V.mul(dir, ln / 2)), glow, 0.9, { dx: dir.x, dy: dir.y, dz: dir.z, len: ln / 2, w: palm ? 0.07 : 0.09, spd: 0.05, life: 0.1 });
    if ((age + i) % 2 === 0) fx(dim, "origin:beam_pulse", V.add(a, V.mul(dir, ln * 0.3)), JWHITE, 1, { dx: dir.x, dy: dir.y, dz: dir.z, len: ln * 0.3, w: palm ? 0.03 : 0.04, spd: 0.05, life: 0.12 });
    if (age % 3 === i % 3) fx(dim, "origin:beam_flare", a, glow, 0.8, { size: palm ? 0.14 : 0.18, life: 0.1 });
  }
  if (!cruising && age % 4 === 0) { const g = groundDist(p, 4); if (g < 3.5) fx(dim, "origin:dust", at(L, 0, -g, 0), C.white, 0.5); }
}
// wearing the suit and falling: thrusters catch you, then the stick is yours
export function autoThrust(p) {
  if (isFlying(p)) return false;
  if (!canExoFly(p)) {
    try { p.addEffect("slow_falling", 80, { showParticles: false }); } catch { }
    aiSay(p, "Thrusters won't answer - deploying air brakes. Brace, {addr}!");
    RT(p).flyGrace = now() + 120;
    return false;
  }
  exoTakeoff(p);
  aiSay(p, "Thrusters engaged. You have the stick, {addr}.");
  return true;
}

// ------------------------------------------------------------------ the Exo Interface
export async function useInterface(p, sneaking) {
  const r = RT(p);
  const x = exoData(hero(p));
  const falling = !p.isOnGround && (r.fall?.drop ?? 0) > 3 && !isFlying(p);
  if (!fullSuit(p)) {
    if (x.stored) return knows(hero(p), "nano") ? nanoDeploy(p, falling) : falling ? catchCall(p, false) : callSuit(p);
    if (sneaking) return talkBox(p);
    hudMsg(p, "§7No suit to talk to. §8(Wear all four Exo-Frame pieces - later you can dismiss it and call it back.)");
    return;
  }
  if (falling) return autoThrust(p);
  if (sneaking) return exoMenu(p);
  repulsor(p);
}
function spend(p, cost, cdKey, cd) {
  const r = RT(p), x = exoData(hero(p)), t = now();
  if ((r[cdKey] ?? 0) > t) { hudMsg(p, `§7Recharging §c${(((r[cdKey]) - t) / 20).toFixed(1)}s`, 20); return false; }
  if ((x.reactor ?? 0) < cost) { hudMsg(p, `§bReactor too low §7(${cost})`, 30); return false; }
  x.reactor -= cost;
  r[cdKey] = t + cd;
  markDirty(p);
  return true;
}
// Repulsors. The arm snaps up and aims (left and right palms take turns), the palm charges for a beat with a rising
// whine, then a concussive blast: a white-hot beam with shock rings racing down it, a kick back through your arm, and a
// shock ring where it lands. Tap again while one palm cools down: BOTH palms at once - a heavier blast that sends
// whatever it hits flying. (Repulsor Beam in the suit menu holds both palms open for a sustained blast.)
const repPalm = (p, side) => {   // side: 1 = right palm, -1 = left
  const head = p.getHeadLocation(), dir = p.getViewDirection(), rl = Math.hypot(dir.x, dir.z) || 1, rt = { x: -dir.z / rl, z: dir.x / rl };
  return at(head, rt.x * 0.38 * side + dir.x * 0.62, -0.42 + dir.y * 0.45, rt.z * 0.38 * side + dir.z * 0.62);
};
function repulsor(p) {
  const r = RT(p), t = now(), st = r.exoStats ?? statsOf(p);
  if (beamActive(p, "repbeam")) { stopBeam(p, "cut"); return; }
  const dual = (r.repCd ?? 0) > t && !r.repDual && t - (r.repLast ?? -99) <= 14;
  if (dual) { const x = exoData(hero(p)); if ((x.reactor ?? 0) < 8) { hudMsg(p, "§bReactor too low §7(8)", 30); return; } x.reactor -= 8; r.repCd = t + st.repCd * 2; markDirty(p); }
  else if (!spend(p, 4, "repCd", st.repCd)) return;
  r.repLast = t; r.repDual = dual; r.repHand = !r.repHand;
  const right = r.repHand, sides = dual ? [1, -1] : [right ? 1 : -1];
  const anim = dual ? "animation.origin.exo.repulse_dual" : right ? "animation.origin.exo.repulse_r" : "animation.origin.exo.repulse_l";
  try { p.playAnimation(anim, { controller: "origin_rep", stopExpression: "0", blendOutTime: 0.12 }); } catch { }
  const dim = p.dimension, col = beamCol(p);
  // the charge: palms glow and whine for two ticks while the arm comes up
  for (const sd of sides) fx(dim, "origin:beam_flare", repPalm(p, sd), col, 0.9, { size: dual ? 0.32 : 0.24, life: 0.12 });
  sound(dim, "beacon.activate", p.location, dual ? 2 : 2.4, 0.25);
  system.runTimeout(() => { if (valid(p)) fireRepulsor(p, sides, dual, st, col); }, 2);
}
function fireRepulsor(p, sides, dual, st, col) {
  const dim = p.dimension, head = p.getHeadLocation(), dir = p.getViewDirection();
  let target = null, dist = 24;
  try { target = p.getEntitiesFromViewDirection({ maxDistance: 24 }).map((hh) => hh.entity).find((e) => e.id !== p.id && !NO_HIT.includes(e.typeId)); } catch { }
  try { const bh = p.getBlockFromViewDirection({ maxDistance: 24 }); if (bh) dist = Math.min(dist, V.dist(head, V.add(bh.block.location, bh.faceLocation))); } catch { }
  let end = V.add(head, V.mul(dir, dist));
  try { if (target) end = target.getHeadLocation(); } catch { }
  const style = { ...tinted("laser", col), width: dual ? 0.32 : 0.23, coreW: dual ? 0.1 : 0.07, flare: dual ? 0.7 : 0.52, impact: dual ? 1.7 : 1.15 };
  for (const sd of sides) {
    const hnd = repPalm(p, sd), L = V.dist(hnd, end), u = V.norm(V.sub(end, hnd));
    flashBeam(dim, hnd, end, style, { life: dual ? 0.42 : 0.3 });
    fx(dim, "origin:missile_glow", hnd, col, 1);
    fx(dim, "origin:beam_ring", V.add(hnd, V.mul(u, 0.25)), C.white, 0.9, { dx: u.x, dy: u.y, dz: u.z, size: dual ? 0.9 : 0.65, life: 0.22 });
    // shock rings racing down the beam
    for (let k = 1; k <= 3; k++) {
      const s0 = Math.min(L - 0.5, (L * k) / 4);
      if (s0 < 1) continue;
      system.runTimeout(() => fx(dim, "origin:beam_ring", V.add(hnd, V.mul(u, s0)), col, 0.75, { dx: u.x, dy: u.y, dz: u.z, size: (dual ? 1.2 : 0.85) + k * 0.12, life: 0.25 }), k - 1);
    }
  }
  fx(dim, "origin:burst", end, col, dual ? 1 : 0.85);
  fx(dim, "origin:beam_ring", end, C.white, 1, { dx: dir.x, dy: dir.y, dz: dir.z, size: dual ? 2.2 : 1.5, life: 0.3 });
  fx(dim, "origin:dust", end, C.white, 0.6);
  sound(dim, "origin.sfx.repulsor", head, dual ? 0.75 : 0.9 + Math.random() * 0.2, dual ? 1 : 0.9);
  sound(dim, "origin.sfx.impact", end, dual ? 0.8 : 1.1, 0.6);
  // the kick back through your arm
  try { p.applyKnockback({ x: -dir.x * (dual ? 0.5 : 0.15), z: -dir.z * (dual ? 0.5 : 0.15) }, dual ? 0.08 : 0.02); } catch { }
  try { p.runCommand(`camerashake add @s ${dual ? 0.22 : 0.08} 0.15 positional`); } catch { }
  if (dual) { sound(dim, "origin.sfx.windblast", head, 1.2, 0.7); hudMsg(p, "§b§lDUAL REPULSOR", 15); }
  if (target && target.typeId === XOX && xoxBlockBeam(target, p)) { /* he cut the beam */ } else if (target && valid(target)) {
    dmg(target, st.rep * (dual ? 1.8 : 1), p);
    const k = V.flat(dir);
    if (dual) heavyLaunch(target, k, 1, p);
    else { try { target.applyKnockback({ x: k.x * 1.4, z: k.z * 1.4 }, 0.35); } catch { } }
  }
}
// Repulsor Beam: both palms open, a sustained concussive stream (2.5s) that shoves everything in the line back.
export function repulsorBeam(p) {
  if (beamActive(p, "repbeam")) { stopBeam(p, "cut"); return; }
  if (!spend(p, 16, "rbeamCd", 260)) return;
  const st = statsOf(p), col = beamCol(p), dim = p.dimension;
  try { p.playAnimation("animation.origin.exo.repulse_hold", { controller: "origin_rep", stopExpression: "0", blendOutTime: 0.2 }); } catch { }
  sound(dim, "beacon.activate", p.location, 1.6, 0.6);
  sound(dim, "origin.sfx.repulsor", p.location, 0.6, 1);
  startBeam(p, "repbeam", {
    dur: 50, range: 28, from: "hands", style: { ...tinted("laser", col), width: 0.27, coreW: 0.085, flare: 0.6, impact: 1.5 }, dmg: Math.max(2, st.rep * 0.45), every: 5, hurt: dmg,
    pierce: true, turn: 0.4, hitRadius: 0.6, knock: 0.55, selfSlow: 2, recoil: 0.06, shake: 0.06, label: "§b§lREPULSOR BEAM", burn: "none",
    onTick: (o, b, end, tk) => {
      if (tk % 3 !== 0) return;
      for (const sd of [1, -1]) { const hnd = repPalm(o, sd), u = V.norm(V.sub(end, hnd)), L = V.dist(hnd, end); fx(o.dimension, "origin:beam_ring", V.add(hnd, V.mul(u, Math.min(L, 1 + ((tk / 3) % 4) * (L / 4)))), col, 0.7, { dx: u.x, dy: u.y, dz: u.z, size: 0.9, life: 0.2 }); }
    },
    sfx: { start: ["origin.sfx.repulsor", 0.7, 1], loop: ["beacon.ambient", 10, 1.8, 0.5], end: ["random.fizz", 1.4, 0.5] },
    onEnd: (o) => { try { o.playAnimation("animation.origin.clear", { controller: "origin_rep", stopExpression: "1", blendOutTime: 0.25 }); } catch { } },
  });
}
export async function talkBox(p) {
  const a = aiOf(p);
  const f = new ModalFormData().title(`Talk to ${a.name}`).textField(`Ask ${a.name} anything. §8(Only you hear the answer.)`, "where's the closest diamonds?", { defaultValue: "" });
  const res = await show(p, f);
  if (!res || res.canceled) return;
  const text = String(res.formValues?.[0] ?? "").trim();
  if (!text) return;
  import("./jarvis.js").then((m) => m.askAI(p, null, text)).catch((e) => console.warn("[ORIGIN] ai: " + e));
}
async function exoMenu(p) {
  const h = hero(p), x = exoData(h), r = RT(p), t = now();
  const st = statsOf(p, x);
  const cd = (k) => ((r[k] ?? 0) > t ? ` §c${Math.ceil((r[k] - t) / 20)}s` : " §aready");
  const a = aiOf(p);
  const f = oform("menu", suitName(p), [
    `${hudCode(p)}§l${suitName(p).toUpperCase()}§r §8· reactor §b${Math.round(x.reactor)}§8/${x.cap ?? st.cap}`,
    `§7Repulsor ${st.rep} dmg (use the Interface). Thrusters: double-tap jump. Locked systems need a Blueprint (Exo Workshop).`,
  ].join("\n"));
  const acts = [];
  const b = (txt, icon, act) => { f.button(txt, ICONS + icon); acts.push(act); };
  const sys = (key, label, line2, icon, act) => knows(h, key) ? b(`${label}${cd(act + "Cd")}\n§8${line2}`, icon, act) : b(`§8${label} §7· locked\n§8Blueprint: ${BLUEPRINTS[key].name}`, "x_lock", "locked:" + key);
  b(`Talk to ${a.name}\n§8Ask anything - only you hear it`, "x_talk", "talk");
  b(`Thrusters: ${isFlying(p) ? "§aON" : "§7off"}\n§8Fly · sprint to boost`, "x_up_thrusters", "fly");
  sys("lance", "Core Lance", "Charge 1.5s, then a 5s piercing beam · 30", "x_lance", "lance");
  sys("missiles", "Micro-Missiles", `Locks up to ${st.locks} targets · 25`, "x_missiles", "miss");
  sys("drones", "Sentinel Drones", "Two drones guard you for 30s · 30", "x_drones", "drone");
  sys("blade", "Arc Blade", "A hard-light blade on your arm · 20", "x_blade", "blade");
  sys("laser", "Wrist Laser", "1.5s cutting laser - sweep it · 20", "x_laser", "laser");
  b(`Repulsor Beam${cd("rbeamCd")}\n§8Both palms: a 2.5s concussive stream · 16`, "p3_repbeam", "rbeam");
  if (st.cannon) b(`Bastion Cannon${cd("canCd")}\n§8Shoulder shell, 12 dmg blast · 20`, "x_cannon", "cannon");
  b(`Sky Catch auto: ${knows(h, "skycatch") ? (x.opts.autoCatch !== false ? "§aON" : "§7off") : "§8locked"}\n§8Falling? Use the Interface - or let it catch you`, "x_skycatch", "catch");
  b(`Targeting HUD: ${x.opts.target !== false ? "§aON" : "§7off"}`, "x_target", "target");
  b(`Night vision: ${x.opts.nv !== false ? "§aON" : "§7off"}`, "x_nv", "nv");
  b(knows(h, "nano") ? "Stow Suit\n§8It pours back into the reactor - call it back in a second" : "Dismiss Suit\n§8It flies off - call it back any time (even mid-fall)", knows(h, "nano") ? "x_nano" : "act_takeoff", "dismiss");
  b("Close", "act_back", "close");
  const res = await show(p, f);
  if (!res || res.canceled) return;
  const act = acts[res.selection];
  if (!act || act === "close") return;
  if (act.startsWith("locked:")) { const k = act.split(":")[1]; aiSay(p, `I'll need the ${BLUEPRINTS[k].name} blueprint for that, {addr}. Research it at an Exo Workshop.`); return; }
  if (act === "talk") return talkBox(p);
  if (act === "dismiss") return knows(h, "nano") ? nanoRetract(p) : dismissSuit(p);
  if (act === "laser") return wristLaser(p);
  if (act === "rbeam") return repulsorBeam(p);
  if (act === "drone") return deployDrones(p);
  if (act === "blade") return arcBlade(p);
  if (act === "cannon") return cannon(p);
  if (act === "fly") { if (isFlying(p)) stopFlight(p, "land"); else if (canExoFly(p)) exoTakeoff(p); return; }
  if (act === "lance") return coreLance(p);
  if (act === "miss") return missiles(p);
  if (act === "catch") {
    if (!knows(h, "skycatch")) { aiSay(p, "Manual catches always work, {addr} - use the Interface while you fall. Automatic needs the Sky Catch Protocol blueprint."); return; }
    x.opts.autoCatch = x.opts.autoCatch === false; markDirty(p); hudMsg(p, `§bSky Catch auto ${x.opts.autoCatch ? "§aON" : "§7off"}`, 40); return;
  }
  if (act === "target") { x.opts.target = x.opts.target === false; markDirty(p); hudMsg(p, `§bTargeting ${x.opts.target ? "§aON" : "§7off"}`, 40); return; }
  if (act === "nv") { x.opts.nv = x.opts.nv === false; markDirty(p); hudMsg(p, `§bNight vision ${x.opts.nv ? "§aON" : "§7off"}`, 40); return; }
}
export async function coreLance(p) {
  if (!knows(hero(p), "lance")) return aiSay(p, "Core Lance needs its blueprint, {addr}.");
  if (!spend(p, 30, "lanceCd", 400)) return;
  const dim = p.dimension, col = beamCol(p);
  try { p.addEffect("slowness", 70, { amplifier: 3, showParticles: false }); } catch { }
  sound(dim, "origin.sfx.charge", p.location, 1.1, 1);
  for (let i = 0; i < 30; i += 2) {
    if (!valid(p)) return;
    fx(dim, "origin:charge", at(p.location, 0, 1.3, 0), col, 1);
    await system.waitTicks(2);
  }
  if (!valid(p)) return;
  sound(dim, "mob.warden.sonic_boom", p.location, 1, 1.0);
  startBeam(p, "lance", {
    dur: 100, range: 40, from: "chest", style: { ...tinted("power", col), width: 0.4, coreW: 0.11 }, dmg: 5, every: 8, hurt: dmg, pierce: true, turn: 0.3, hitRadius: 0.8, knock: 0.2,
    selfSlow: 3, recoil: 0.1, shake: 0.12, label: "§b§lCORE LANCE", burn: "laser",
    sfx: { start: ["origin.sfx.laser", 1, 1], loop: ["mob.guardian.attack_loop", 8, 1.2, 0.35], end: ["random.fizz", 1, 0.5] },
  });
}
export function missiles(p) {
  if (!knows(hero(p), "missiles")) { aiSay(p, "Micro-Missiles need their blueprint, {addr}."); return; }
  const st = statsOf(p);
  const dim = p.dimension;
  let list = [];
  try { list = dim.getEntities({ location: p.location, maxDistance: 32, excludeTypes: [...NO_HIT, "minecraft:player"], families: ["monster"] }); } catch { }
  if (!list.length) { try { list = dim.getEntities({ location: p.location, maxDistance: 32, excludeTypes: [...NO_HIT, "minecraft:player", "origin:alter_ego"] }).filter((e) => e.typeId !== "minecraft:item"); } catch { } }
  list = list.sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location)).slice(0, st.locks);
  if (!list.length) { hudMsg(p, "§7No targets to lock.", 30); return; }
  if (!spend(p, 25, "missCd", 500)) return;
  hudMsg(p, `§b◆ ${list.length} LOCKED`, 30);
  sound(dim, "origin.sfx.lock", p.location, 1.6, 0.5);
  launch(p, list, st.missileDmg);
}

// ------------------------------------------------------------------ meteors (Starmetal)
let nextMeteor = 0;
export function tickMeteors() {
  const t = now();
  if (!nextMeteor) nextMeteor = t + 20 * 60 * 4;
  if (t < nextMeteor) return;
  let tod = 0; try { tod = world.getTimeOfDay(); } catch { }
  if (tod < 13000 || tod > 23000) return;
  const cand = world.getAllPlayers().filter((p) => p.dimension.id === "minecraft:overworld" && hero(p).awakened);
  if (!cand.length) return;
  nextMeteor = t + 20 * 60 * (6 + Math.floor(Math.random() * 8));
  meteor(cand[Math.floor(Math.random() * cand.length)]);
}
export async function meteor(p) {
  const dim = p.dimension;
  let impact = null;
  for (let i = 0; i < 10 && !impact; i++) {
    const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 25;
    const x = Math.floor(p.location.x + Math.cos(a) * d), z = Math.floor(p.location.z + Math.sin(a) * d);
    try { const top = dim.getTopmostBlock({ x, z }); if (top && !top.isLiquid) impact = { x: x + 0.5, y: top.location.y + 1, z: z + 0.5 }; } catch { }
  }
  if (!impact) return;
  const start = at(impact, 60, 90, 40);
  for (const pl of dim.getPlayers({ location: impact, maxDistance: 160 })) {
    const ang = Math.atan2(impact.z - pl.location.z, impact.x - pl.location.x) * 180 / Math.PI;
    const dirs = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
    msg(pl, `§6A meteor tears across the sky... §7it came down to the ${dirs[Math.round(((ang + 360) % 360) / 45) % 8]} (~${Math.round(V.dist(pl.location, impact))}m). §8Starmetal - bring a diamond pickaxe.`);
    psound(pl, "mob.ghast.fireball", 0.6, 0.5);
  }
  for (let k = 0; k <= 30; k++) {
    const s = k / 30, c = V.lerp(start, impact, s * s);
    fx(dim, "origin:burst", c, EMBER, 1);
    fx(dim, "origin:trail", c, hexToRgb("#ffd36a"), 1);
    await system.waitTicks(2);
  }
  fx(dim, "origin:flash", impact, EMBER, 1, { size: 6 });
  fx(dim, "origin:shards", impact, C.dust, 1); fx(dim, "origin:dust", impact, C.white, 1); fx(dim, "origin:ember", impact, EMBER, 1);
  sound(dim, "origin.sfx.explode", impact, 0.7, 1);
  try { dim.createExplosion(impact, 3.2, { breaksBlocks: true, causesFire: true }); } catch { }
  await system.waitTicks(4);
  const cy = impact.y - 2;
  try {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const b = dim.getBlock({ x: Math.floor(impact.x) + dx, y: Math.floor(cy) - 1, z: Math.floor(impact.z) + dz });
      if (b && !b.isAir) b.setType(Math.random() < 0.5 ? "minecraft:magma" : "minecraft:blackstone");
    }
    dim.getBlock({ x: Math.floor(impact.x), y: Math.floor(cy), z: Math.floor(impact.z) })?.setType("origin:starmetal_core");
  } catch { }
  fx(dim, "origin:shockwave", impact, EMBER, 1, { radius: 6 });
}

// ================================================================== CALL / DISMISS / SKY CATCH
// 15 fragments per suit. On the ground they fly in from all around you; mid-fall they come in fast from above,
// lock on while the suit holds you in a controlled drop, then the thrusters fly you to a safe landing.
const FRAG = ["boot_r", "boot_l", "shin_r", "shin_l", "thigh_r", "thigh_l", "belt", "core", "back", "upper_r", "upper_l", "fore_r", "fore_l", "helm", "face"];
const FRAG_SLOT = { boot_r: "feet", boot_l: "feet", shin_r: "legs", shin_l: "legs", thigh_r: "legs", thigh_l: "legs", belt: "legs",
  core: "chest", back: "chest", upper_r: "chest", upper_l: "chest", fore_r: "chest", fore_l: "chest", helm: "head", face: "head" };
const SLOT_PIECE = { head: 0, chest: 1, legs: 2, feet: 3 };
const FROM = { boot_r: [-60, 3], boot_l: [60, 3], shin_r: [-100, 5], shin_l: [100, 5], thigh_r: [-140, 8], thigh_l: [140, 8], belt: [180, 6],
  core: [0, 10], back: [180, 12], upper_r: [-75, 14], upper_l: [75, 14], fore_r: [-30, 9], fore_l: [30, 9], helm: [150, 18], face: [10, 6] };
const parts = [];
function spawnFrag(dim, loc, frag, stage, mark = "mk3", color = "#2F4E8C") {
  let e;
  try { e = dim.spawnEntity("origin:exo_piece", loc); } catch { return null; }
  const c = hexToRgb(color || "#2F4E8C");
  try {
    e.setProperty("origin:frag", FRAG.indexOf(frag));
    e.setProperty("origin:piece", SLOT_PIECE[FRAG_SLOT[frag]]);
    e.setProperty("origin:dmg", stage);
    e.setProperty("origin:mark", MARKS[mark]?.idx ?? 2);
    e.setProperty("origin:pr", Math.round(c.red * 31));
    e.setProperty("origin:pg", Math.round(c.green * 31));
    e.setProperty("origin:pb", Math.round(c.blue * 31));
    e.setProperty("origin:spin", 1);
  } catch { }
  return e;
}
const bez = (a, b, c, t) => V.add(V.add(V.mul(a, (1 - t) * (1 - t)), V.mul(b, 2 * (1 - t) * t)), V.mul(c, t * t));
function aroundYou(p, deg, dist, up) {
  const f = V.flat(p.getViewDirection());
  const a = (deg * Math.PI) / 180;
  const d = { x: f.x * Math.cos(a) - f.z * Math.sin(a), z: f.x * Math.sin(a) + f.z * Math.cos(a) };
  return at(p.location, d.x * dist, up, d.z * dist);
}
function stripWorn(p) {
  const e = eq(p);
  for (const [, s] of SLOTS) {
    try { const it = e.getEquipment(EquipmentSlot[s]); if (it) { e.setEquipment(EquipmentSlot[s], undefined); const left = inv(p).addItem(it); if (left) p.dimension.spawnItem(left, p.location); } } catch { }
  }
}
function queueFragments(p, air) {
  const r = RT(p);
  FRAG.forEach((frag, i) => {
    const [deg, up] = FROM[frag];
    const d = r.suitData[FRAG_SLOT[frag]];
    const from = air ? aroundYou(p, deg + 180, 9 + (i % 3) * 3, up * 0.6 + 6) : aroundYou(p, deg, 20 + (i % 3) * 3, up);
    parts.push({ owner: p, frag, slot: FRAG_SLOT[frag], mode: "in", from, t: 0, dur: air ? 9 + (i % 3) * 2 : 26 + (i % 4) * 3, delay: air ? 3 + i * 2 : 6 + i * 5,
      e: null, attached: false, stage: d?.stage ?? 0, mark: d?.mark ?? "mk3", color: d?.color ?? paintFor(exoData(hero(p)), d?.mark ?? "mk3") });
  });
}
export async function callSuit(p) {
  const h = hero(p), x = exoData(h);
  if (!x.stored) { hudMsg(p, "§7Nothing to call. §8(Wear the suit, then Dismiss it from the Exo Interface.)"); return; }
  const r = RT(p);
  if (r.cine || r.suitBusy) return;
  r.suitBusy = true; r.suitDone = false;
  const stored = x.stored;
  x.stored = null; x.suited = true;
  saveNow(p);
  stripWorn(p);
  r.suitData = Object.fromEntries(stored.map((d) => [d.slot, d]));
  queueFragments(p, false);
  hudMsg(p, "§b◆ SUIT INBOUND", 60);
  aiSay(p, "Suit inbound, {addr}. Arms out.", { chat: false });
  sound(p.dimension, "beacon.activate", p.location, 1, 1.6);
  const f = V.flat(p.getViewDirection());
  runCine(p, async (c) => {
    const base = { ...p.location };
    c.cam(at(base, f.x * 5 + f.z * 2.5, 1.2, f.z * 5 - f.x * 2.5), at(base, 0, 1.1, 0));
    c.say("§b◆ suit inbound", 40);
    await c.wait(26);
    c.cam(at(base, -f.z * 3.5, 0.8, f.x * 3.5), at(base, 0, 0.7, 0), 1.6, EASE.InOutSine);
    await c.wait(32);
    c.cam(at(base, f.x * 3.2 - f.z * 1.5, 1.6, f.z * 3.2 + f.x * 1.5), at(base, 0, 1.3, 0), 1.6, EASE.InOutSine);
    await c.wait(30);
    c.cam(at(base, f.x * 1.9, 1.75, f.z * 1.9), at(base, 0, 1.65, 0), 1.0, EASE.InOutSine);
    await c.wait(20);
  });
}
export function dismissSuit(p) {
  if (!fullSuit(p)) { hudMsg(p, "§7You need the whole suit on to send it away."); return; }
  const r = RT(p);
  if (r.suitBusy) return;
  const h = hero(p), x = exoData(h), e = eq(p);
  if (isFlying(p)) stopFlight(p, "land");
  r.suitBusy = true;
  const stored = [];
  for (const [slot, s] of SLOTS) {
    const it = e.getEquipment(EquipmentSlot[s]);
    const pc = pieceOf(it?.typeId);
    const d = it.getComponent("minecraft:durability");
    stored.push({ slot, mark: pc?.mark ?? "mk3", damage: d?.damage ?? 0, ench: enchOf(it), name: it.nameTag ?? null, stage: pc?.stage ?? 0, color: colorOf(it) ?? paintFor(x, pc?.mark ?? "mk3") });
    try { e.setEquipment(EquipmentSlot[s], undefined); } catch { }
  }
  x.stored = stored;
  r.exoOn = false;
  if (r.exoNv) { r.exoNv = false; try { p.removeEffect("night_vision"); } catch { } }
  saveNow(p);
  [...FRAG].reverse().forEach((frag, i) => {
    const d = stored.find((q) => q.slot === FRAG_SLOT[frag]);
    const q = { owner: p, frag, slot: FRAG_SLOT[frag], mode: "out", t: 0, dur: 26, delay: i * 3, e: spawnFrag(p.dimension, p.location, frag, d?.stage ?? 0, d?.mark, d?.color), attached: true, stage: d?.stage ?? 0 };
    try { q.e?.setProperty("origin:spin", 0); } catch { }
    parts.push(q);
  });
  sound(p.dimension, "armor.equip_netherite", p.location, 1, 0.7);
  sound(p.dimension, "origin.sfx.servo", p.location, 0.8, 0.8);
  hudMsg(p, "§b◆ SUIT DISMISSED §7- call it back with the Exo Interface", 60);
  aiSay(p, "Standing by, {addr}. Call if you need me - even mid-air.", { chat: false });
}
function holdOn(q, p) { try { q.e.teleport(p.location, { rotation: { x: 0, y: p.getRotation().y } }); } catch { } }
// every tick
export function tickSuitParts() {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    const p = q.owner;
    if (!valid(p)) { try { q.e?.remove(); } catch { } parts.splice(i, 1); continue; }
    if (q.done) continue;
    if (q.attached && q.mode === "in") { if (q.e) holdOn(q, p); continue; }
    if (q.delay > 0) { q.delay--; if (q.mode === "out" && q.e) holdOn(q, p); continue; }
    if (!q.e) {
      q.e = spawnFrag(p.dimension, q.from, q.frag, q.stage, q.mark, q.color);
      if (!q.e) { q.attached = true; lockOn(q, p); continue; }
      sound(p.dimension, "firework.launch", q.from, 0.6, 0.6 + Math.random() * 0.3);
    }
    if (q.mode === "out" && q.t === 0) {
      q.from = { ...p.location };
      q.away = aroundYou(p, Math.random() * 360, 24, 18 + Math.random() * 8);
      try { q.e.setProperty("origin:spin", 1); } catch { }
      sound(p.dimension, "random.anvil_use", p.location, 0.3, 1.8);
      fx(p.dimension, "origin:spark", at(p.location, 0, 1, 0), CYAN, 0.8);
    }
    q.t++;
    const s = Math.min(1, q.t / q.dur);
    let pos;
    if (q.mode === "in") {
      const end = { ...p.location };
      pos = bez(q.from, at(V.lerp(q.from, end, 0.55), 0, 5, 0), end, 1 - (1 - s) * (1 - s));
      if (s > 0.85) { try { q.e.setProperty("origin:spin", 0); } catch { } }
    } else pos = bez(q.from, at(q.from, 0, 4, 0), q.away, s * s);
    try { q.e.teleport(pos, { rotation: { x: 0, y: p.getRotation().y } }); } catch { }
    fx(p.dimension, "origin:missile_glow", at(pos, 0, 0.9, 0), CYAN, 1);
    if (q.t % 2 === 0) fx(p.dimension, "origin:missile_smoke", at(pos, 0, 0.9, 0), C.white, 1);
    if (s < 1) continue;
    if (q.mode === "out") { try { q.e.remove(); } catch { } parts.splice(i, 1); if (!parts.some((o) => o.owner === p)) RT(p).suitBusy = false; continue; }
    q.attached = true;
    lockOn(q, p);
  }
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].done) parts.splice(i, 1);
}
function lockOn(q, p) {
  sound(p.dimension, "origin.sfx.click", p.location, 0.9 + Math.random() * 0.3, 0.8);
  sound(p.dimension, "armor.equip_netherite", p.location, 0.7, 1.1);
  for (let k = 0; k < 5; k++) fx(p.dimension, "origin:spark", at(p.location, 0, slotY(q.slot), 0), k % 2 ? CYAN : GOLD, 1);
  const r = RT(p);
  const mine = parts.filter((o) => o.owner === p && o.slot === q.slot && o.mode === "in");
  if (mine.some((o) => !o.attached)) return;
  const d = r.suitData?.[q.slot];
  if (d) equipStored(p, d);
  for (const o of mine) { try { o.e?.remove(); } catch { } o.done = true; }
  try { p.runCommand("camerashake add @s 0.2 0.15 positional"); } catch { }
  if (q.slot === "head") {
    fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.05, 0), CYAN, 1, { radius: 3 });
    sound(p.dimension, "beacon.activate", p.location, 1, 1.5);
    try { p.onScreenDisplay.setTitle(`${hudCode(p)}◆`, { fadeInDuration: 0, stayDuration: 20, fadeOutDuration: 10, subtitle: `${hudCode(p)}systems online` }); RT(p).titleUntil = now() + 32; } catch { }
    r.suitBusy = false;
    r.suitDone = true;
    r.suitData = null;
  }
}
function equipStored(p, d) {
  const s = SLOTS.find((q) => q[0] === d.slot)[1];
  const it = makePiece(d.slot, d.stage ?? 0, d.damage, d.ench, d.name, d.mark ?? "mk3", d.color);
  try {
    const e = eq(p);
    const old = e.getEquipment(EquipmentSlot[s]);
    if (old) { const left = inv(p).addItem(old); if (left) p.dimension.spawnItem(left, p.location); }
    e.setEquipment(EquipmentSlot[s], it);
  } catch { give(p, it); }
}
export function rescueSuit(p) {
  const x = exoData(hero(p));
  const r = RT(p);
  r.suitBusy = false; r.skyCatch = false;
  // a relog in the middle of a call: whatever was still on its way just lands on you
  if (r.suitData) { for (const d of Object.values(r.suitData)) equipStored(p, d); r.suitData = null; }
  for (let i = parts.length - 1; i >= 0; i--) if (!valid(parts[i].owner) || parts[i].owner.id === p.id) parts.splice(i, 1);
  try { for (const e of p.dimension.getEntities({ type: "origin:exo_piece", location: p.location, maxDistance: 64 })) { try { e.remove(); } catch { } } } catch { }
  return !!x.stored;
}

// ------------------------------------------------------------------ SKY CATCH
function groundDist(p, max = 64) {
  try {
    const hit = p.dimension.getBlockFromRay(at(p.location, 0, 0.1, 0), { x: 0, y: -1, z: 0 }, { maxDistance: max, includeLiquidBlocks: true, includePassableBlocks: false });
    return hit ? Math.max(0, p.location.y - (hit.block.location.y + 1)) : max;
  } catch { return max; }
}
export const groundBelow = groundDist;
const BAD_GROUND = /lava|magma|cactus|fire|campfire|sweet_berry|powder_snow|pointed_dripstone/;
function landingAt(dim, x, z, fromY) {
  try {
    const hit = dim.getBlockFromRay({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }, { maxDistance: 96, includeLiquidBlocks: true, includePassableBlocks: false });
    if (!hit) return null;
    const b = hit.block;
    if (b.isLiquid || BAD_GROUND.test(b.typeId)) return null;
    const y = b.location.y + 1;
    const a1 = dim.getBlock({ x, y, z }), a2 = dim.getBlock({ x, y: y + 1, z });
    if ((a1 && !a1.isAir && !a1.isLiquid) || (a2 && !a2.isAir)) return null;
    return { x: Math.floor(x) + 0.5, y, z: Math.floor(z) + 0.5 };
  } catch { return null; }
}
function findLanding(p) {
  const dim = p.dimension, f = V.flat(p.getViewDirection()), rt = rightOf(f);
  for (const d of [12, 16, 8, 20, 24, 5, 28, 2, 0]) {
    for (const side of [0, 5, -5]) {
      const x = p.location.x + f.x * d + rt.x * side, z = p.location.z + f.z * d + rt.z * side;
      const L = landingAt(dim, x, z, p.location.y + 2);
      if (L && L.y < p.location.y + 3) return L;
    }
  }
  return null;
}
export async function catchCall(p, auto = false) {
  const h = hero(p), x = exoData(h), r = RT(p);
  if (!x.stored || r.suitBusy || r.cine || r.skyCatch) return false;
  r.skyCatch = true; r.suitBusy = true; r.suitDone = false;
  r.flyGrace = now() + 20 * 40;
  const stored = x.stored;
  x.stored = null; x.suited = true;
  saveNow(p);
  stripWorn(p);
  r.suitData = Object.fromEntries(stored.map((d) => [d.slot, d]));
  const gd0 = groundDist(p, 96);
  const tight = gd0 < 16;
  // the plates dive in from high above: they have to catch up with you
  FRAG.forEach((frag, i) => {
    const [deg, up] = FROM[frag];
    const d = r.suitData[FRAG_SLOT[frag]];
    parts.push({ owner: p, frag, slot: FRAG_SLOT[frag], mode: "in", from: aroundYou(p, deg + 180, 6 + (i % 3) * 2, 16 + up * 0.5), t: 0,
      dur: tight ? 6 + (i % 2) : 8 + (i % 3) * 2, delay: tight ? 1 + i : 3 + Math.round(i * 1.7), e: null, attached: false, stage: d?.stage ?? 0,
      mark: d?.mark ?? "mk3", color: d?.color ?? paintFor(x, d?.mark ?? "mk3") });
  });
  const assemble = tight ? 24 : 42;
  const vFall = Math.max(0.3, Math.min(1.6, (gd0 - 12) / (assemble + 4)));   // a fall that leaves room to pull out
  aiSay(p, auto ? "Altitude critical. Sky Catch engaged - don't fight it, {addr}." : "On my way, {addr}!");
  psound(p, "origin.sfx.swoosh", 0.8, 1);
  sound(p.dimension, "origin.sfx.windblast", p.location, 0.8, 0.8);
  const hudRgb = hexToRgb(HUD_COLORS[hudIndex(p)][1]);
  const col = beamCol(p);
  let landed = false;
  await runCine(p, async (c) => {
    const fwd = V.flat(p.getViewDirection()), side = { x: -fwd.z, z: fwd.x };
    try { p.playAnimation("animation.origin.fall.dive", { controller: "origin_fall", stopExpression: "0", blendOutTime: 0.2 }); } catch { }
    // 1) the dive: you keep falling while the suit chases you down and closes around you
    for (let i = 0; i < 110 && !r.suitDone; i++) {
      if (!valid(p)) return;
      const gd = groundDist(p, 64);
      let vy = -vFall;
      if (gd < 10) vy = -Math.max(0.05, Math.min(vFall, (gd - 3.5) / 5));
      if (gd < 3.5) vy = 0.05;
      try { p.applyKnockback({ x: fwd.x * 0.06, z: fwd.z * 0.06 }, vy + 0.08); } catch { }
      const head = at(p.location, 0, 1.0 + vy, 0);
      const below = Math.min(7, gd - 1.5);
      if (i < 16 || below < 2.5) c.cam(at(head, side.x * 7.5 - fwd.x * 1.5, -1.6, side.z * 7.5 - fwd.z * 1.5), head, 0, EASE.Linear);      // wide: the leap
      else if (i < 30) c.cam(at(head, fwd.x * 1.2 + side.x * 0.6, -below, fwd.z * 1.2 + side.z * 0.6), at(head, 0, 3, 0), 0, EASE.Linear); // from below, plates streaking in
      else { const ang = Math.atan2(side.z, side.x) + (i - 30) * 0.09; c.cam(at(head, Math.cos(ang) * 2.7, 0.6, Math.sin(ang) * 2.7), at(head, 0, 0.3, 0), 0, EASE.Linear); }
      if (i % 2 === 0) for (let k = 0; k < 3; k++) fx(p.dimension, "origin:speedline", at(head, (Math.random() - 0.5) * 3, -2 + Math.random() * 4, (Math.random() - 0.5) * 3), C.white, 0.6, { dir_x: 0, dir_z: 0 });
      if (i % 12 === 0) sound(p.dimension, "origin.sfx.wind", p.location, 1, 0.5);
      await c.wait(1);
    }
    if (!r.suitDone && r.suitData) {
      for (const d of Object.values(r.suitData)) equipStored(p, d);
      r.suitData = null; r.suitDone = true; r.suitBusy = false;
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].owner.id === p.id) { try { parts[i].e?.remove(); } catch { } parts.splice(i, 1); }
    }
    // 2) the faceplate closes: systems online (still falling)
    try { p.playAnimation("animation.origin.fall.end", { controller: "origin_fall", stopExpression: "1", blendOutTime: 0.1 }); } catch { }
    try { p.playAnimation("animation.origin.fly.exo", { controller: "origin_fly", stopExpression: "0", blendOutTime: 0.25 }); } catch { }
    const f2 = V.flat(p.getViewDirection());
    c.fade(0, 0.05, 0.3, { red: hudRgb.red * 0.6, green: hudRgb.green * 0.6, blue: hudRgb.blue * 0.6 });
    sound(p.dimension, "origin.sfx.powerup", p.location, 1.2, 0.8);
    c.say(`${hudCode(p)}◆ ${suitName(p).toUpperCase()} ONLINE`, 30);
    for (let k = 0; k < 4; k++) {
      const gd = groundDist(p, 16);
      try { p.applyKnockback({ x: 0, z: 0 }, (gd < 4 ? 0.05 : -0.3) + 0.08); } catch { }
      const H2 = at(p.location, 0, 1.6, 0);
      c.cam(at(H2, f2.x * 1.25, 0.05, f2.z * 1.25), H2, 0, EASE.Linear);
      await c.wait(1);
    }
    // 3) thrusters fire: pull out of the dive and swoop
    const land = findLanding(p);
    const dir = land ? V.flat(V.sub(land, p.location)) : f2;
    const vel = { x: 0, y: -Math.min(vFall, 0.9), z: 0 };
    sound(p.dimension, "origin.sfx.engine", p.location, 1.2, 1);
    sound(p.dimension, "origin.sfx.windblast", p.location, 1, 0.8);
    fx(p.dimension, "origin:shockwave", at(p.location, 0, -0.2, 0), col, 1, { radius: 2.2 });
    c.shake(0.3, 0.4);
    for (let k = 0; k < 16; k++) {
      if (!valid(p)) return;
      const s = k / 15, gd = groundDist(p, 32);
      const wantVy = gd < 3 ? 0.3 : 0.04 + s * 0.12;
      vel.y += (wantVy - vel.y) * 0.3;
      vel.x += (dir.x * 1.25 - vel.x) * 0.22; vel.z += (dir.z * 1.25 - vel.z) * 0.22;
      try { p.applyKnockback({ x: vel.x, z: vel.z }, vel.y + 0.08); } catch { }
      const L = p.location;
      c.cam(at(L, -dir.x * 4.6 + dir.z * 1.2, 1.7 - s * 0.5, -dir.z * 4.6 - dir.x * 1.2), at(L, dir.x * 3, 0.9, dir.z * 3), 0, EASE.Linear);
      fx(p.dimension, "origin:heat", at(L, 0, 0.05, 0), col, 1);
      fx(p.dimension, "origin:missile_glow", at(L, 0, 0.1, 0), col, 0.8);
      await c.wait(1);
    }
    if (!land) return;
    // 4) glide in and land
    const start = { ...p.location };
    const dist = V.dist(start, land);
    const N = Math.round(Math.max(20, Math.min(80, dist * 1.6)));
    const mid = at(V.lerp(start, land, 0.5), 0, Math.min(5, 1 + dist * 0.12), 0);
    for (let i = 1; i <= N; i++) {
      if (!valid(p)) return;
      const s = i / N, e = s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2;
      const want = bez(start, mid, land, e);
      let v = V.mul(V.sub(want, p.location), 0.85);
      const sp = V.len(v);
      if (sp > 2.2) v = V.mul(v, 2.2 / sp);
      try { p.applyKnockback({ x: v.x, z: v.z }, v.y + 0.08); } catch { }
      const d2 = V.flat(V.sub(land, p.location)), pl = p.location;
      c.cam(at(pl, -d2.x * 5 + d2.z * 1.5, 2.2, -d2.z * 5 - d2.x * 1.5), at(pl, d2.x * 2, 0.9, d2.z * 2), 0.15, EASE.Linear);
      if (i % 2 === 0) { fx(p.dimension, "origin:heat", at(pl, 0, 0.05, 0), col, 1); fx(p.dimension, "origin:missile_glow", at(pl, 0, 0.1, 0), col, 0.8); }
      if (i % 24 === 0) sound(p.dimension, "origin.sfx.engine", pl, 1.05, 0.6);
      await c.wait(1);
      if (V.dist(p.location, land) < 1.0 || (i > N * 0.7 && p.isOnGround)) break;
    }
    try { p.applyKnockback({ x: 0, z: 0 }, 0); } catch { }
    import("./fall.js").then((m) => m.landAnim(p, "hero", 0.3)).catch(() => { });
    const L = { ...p.location };
    fx(p.dimension, "origin:shockwave", at(L, 0, 0.05, 0), col, 1, { radius: 3.4 });
    fx(p.dimension, "origin:dust", L, C.white, 1);
    fx(p.dimension, "origin:debris", L, C.dust, 1);
    sound(p.dimension, "origin.sfx.impact", L, 0.7, 1);
    sound(p.dimension, "random.anvil_land", L, 0.35, 0.6);
    c.shake(0.5, 0.4);
    const f = V.flat(p.getViewDirection());
    c.cam(at(L, f.x * 3.4 + f.z * 1.2, 0.35, f.z * 3.4 - f.x * 1.2), at(L, 0, 0.8, 0), 0, EASE.Linear);
    await c.wait(10);
    c.cam(at(L, f.x * 2.6 + f.z * 0.6, 1.6, f.z * 2.6 - f.x * 0.6), at(L, 0, 1.2, 0), 1.2, EASE.InOutSine);
    await c.wait(24);
    landed = true;
  }, { skippable: false, hideHud: true });
  try { p.playAnimation("animation.origin.fly.end", { controller: "origin_fly", stopExpression: "1", blendOutTime: 0.3 }); } catch { }
  r.skyCatch = false; r.suitBusy = false;
  r.flyGrace = now() + 100;
  if (!valid(p)) return true;
  if (landed) aiSay(p, "Touchdown. Try not to make a habit of that, {addr}.");
  else if (!p.isOnGround) { exoTakeoff(p); aiSay(p, "No safe ground below - you're flying, {addr}. Double-tap jump to land when you find a spot."); }
  return true;
}

// ================================================================== MICRO-MISSILES + BASTION CANNON
const flying = [];
const shells = [];
function launch(p, targets, damage = 5) {
  const dim = p.dimension;
  const f = V.flat(p.getViewDirection()), r = rightOf(f);
  const n = Math.max(targets.length, Math.min(8, targets.length * 2));
  for (let i = 0; i < n; i++) {
    const tg = targets[i % targets.length];
    const side = i % 2 ? 1 : -1;
    const start = at(p.location, r.x * 0.45 * side - f.x * 0.2, 1.75, r.z * 0.45 * side - f.z * 0.2);
    const fan = (Math.random() * 0.6 + 0.4) * side;
    const p1 = at(start, r.x * fan * 7 + f.x * 3, 7 + Math.random() * 6, r.z * fan * 7 + f.z * 3);
    const d = V.dist(p.location, tg.location);
    flying.push({ by: p, tg, start, p1, last: start, t: 0, delay: i * 3, dur: Math.round(24 + d * 0.9 + Math.random() * 8), wob: Math.random() * 6.28, dim, end: tg.getHeadLocation(), dmg: damage });
  }
  sound(dim, "random.click", p.location, 1, 1.8);
}
export function cannon(p) {
  if (!(RT(p).exoStats ?? statsOf(p)).cannon) return;
  if (!spend(p, 20, "canCd", 20 * 10)) return;
  const dir = p.getViewDirection(), r = rightOf(V.flat(dir));
  const start = at(p.getHeadLocation(), r.x * 0.55, 0.4, r.z * 0.55);
  shells.push({ by: p, dim: p.dimension, pos: start, dir, t: 0 });
  sound(p.dimension, "origin.sfx.cannon", start, 0.6, 1.2);
  sound(p.dimension, "random.explode", start, 1.8, 0.3);
  fx(p.dimension, "origin:flash", start, FIRE, 1, { size: 1.2 });
  try { p.applyKnockback({ x: -dir.x * 0.5, z: -dir.z * 0.5 }, 0.12); } catch { }
}
// every tick
export function tickMissiles() {
  for (let i = flying.length - 1; i >= 0; i--) {
    const m = flying[i];
    if (m.delay > 0) {
      if (--m.delay === 0) { sound(m.dim, "firework.launch", m.start, 1, 1.3 + Math.random() * 0.3); fx(m.dim, "origin:boom_smoke", m.start, C.white, 0.5); }
      continue;
    }
    m.t++;
    if (valid(m.tg)) m.end = m.tg.getHeadLocation();
    if (!m.deflected && valid(m.tg) && m.tg.typeId === XOX && V.dist(m.last, m.end) < 4 && xoxDeflect(m.tg, m)) {
      m.deflected = true;
      if (Math.random() < 0.5 && valid(m.by)) { m.tg = m.by; m.start = { ...m.last }; m.p1 = at(m.last, 0, 4, 0); m.t = 0; m.dur = 22; }
      else { flying.splice(i, 1); fx(m.dim, "origin:flash", m.last, FIRE, 1, { size: 1.5 }); sound(m.dim, "random.explode", m.last, 1.4, 0.4); continue; }
    }
    const s = Math.min(1, m.t / m.dur);
    const p2 = at(V.lerp(m.p1, m.end, 0.6), 0, 6 * (1 - s), 0);
    const a = V.lerp(m.start, m.p1, s), b = V.lerp(m.p1, p2, s), c = V.lerp(p2, m.end, s);
    let pos = V.lerp(V.lerp(a, b, s), V.lerp(b, c, s), s);
    pos = at(pos, Math.sin(m.t * 0.7 + m.wob) * 0.12 * (1 - s), Math.cos(m.t * 0.9 + m.wob) * 0.1 * (1 - s), 0);
    fx(m.dim, "origin:missile_head", pos, C.white, 1);
    fx(m.dim, "origin:missile_glow", pos, FIRE, 1);
    for (let k = 1; k <= 3; k++) fx(m.dim, "origin:missile_smoke", V.lerp(m.last, pos, k / 3), C.white, 1);
    m.last = pos;
    if (s >= 1 || V.dist(pos, m.end) < 0.7) {
      flying.splice(i, 1);
      fx(m.dim, "origin:flash", pos, FIRE, 1, { size: 2 });
      fx(m.dim, "origin:boom_fire", pos, FIRE, 1);
      fx(m.dim, "origin:boom_smoke", pos, C.grey, 1);
      fx(m.dim, "origin:shards", pos, C.dust, 1);
      sound(m.dim, "random.explode", pos, 0.55, 1.5 + Math.random() * 0.3);
      if (valid(m.tg)) dmg(m.tg, m.dmg ?? 5, m.by);
      try { for (const e of m.dim.getEntities({ location: pos, maxDistance: 1.8, excludeTypes: [...NO_HIT, "minecraft:player"] })) if (e.id !== m.tg?.id) dmg(e, 2, m.by); } catch { }
    }
  }
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i];
    s.t++;
    let hit = s.t > 30 || !valid(s.by);
    try { if (s.dim.getBlockFromRay(s.pos, s.dir, { maxDistance: 1.8, includePassableBlocks: false })) hit = true; } catch { }
    try { if (s.dim.getEntitiesFromRay(s.pos, s.dir, { maxDistance: 1.8 }).some((hh) => hh.entity.id !== s.by?.id && !NO_HIT.includes(hh.entity.typeId))) hit = true; } catch { }
    const next = V.add(s.pos, V.mul(s.dir, 1.8));
    fx(s.dim, "origin:missile_glow", s.pos, FIRE, 1);
    fx(s.dim, "origin:missile_smoke", s.pos, C.grey, 1);
    if (hit) {
      shells.splice(i, 1);
      fx(s.dim, "origin:flash", next, FIRE, 1, { size: 3 });
      fx(s.dim, "origin:boom_fire", next, FIRE, 1);
      fx(s.dim, "origin:boom_smoke", next, C.grey, 1);
      fx(s.dim, "origin:shockwave", next, FIRE, 1, { radius: 3.5 });
      sound(s.dim, "origin.sfx.explode", next, 0.9, 1);
      try { for (const e of s.dim.getEntities({ location: next, maxDistance: 3.5, excludeTypes: NO_HIT })) if (e.id !== s.by?.id) { dmg(e, 12, s.by); const k = V.flat(V.sub(e.location, next)); try { e.applyKnockback({ x: k.x * 1.2, z: k.z * 1.2 }, 0.45); } catch { } } } catch { }
      continue;
    }
    s.pos = next;
  }
}

// ================================================================== SENTINEL DRONES
// Three drones. Nothing around: they orbit you. A hostile within 18 blocks: each picks one, circles it and fires
// three-shot bursts. After 30 seconds they peel off.
const drones = [];
export function deployDrones(p) {
  if (!knows(hero(p), "drones")) { aiSay(p, "Drones need their blueprint, {addr}."); return; }
  if (!spend(p, 30, "droneCd", 20 * 90)) return;
  for (let i = 0; i < 3; i++) {
    let e;
    const start = at(p.location, 0, 2.5, 0);
    try { e = p.dimension.spawnEntity("origin:exo_drone", start); } catch { continue; }
    drones.push({ owner: p, e, i, a: (i * Math.PI * 2) / 3, until: now() + 600, pos: start, tg: null, shots: 0, next: now() + 10 + i * 6 });
  }
  sound(p.dimension, "beacon.activate", p.location, 1, 1.8);
  hudMsg(p, "§b◆ SENTINELS ONLINE §7- 3 drones, 30s", 40);
}
export function tickDrones() {
  const t = now();
  for (let k = drones.length - 1; k >= 0; k--) {
    const d = drones[k], p = d.owner;
    if (!valid(p) || !valid(d.e) || t > d.until) { try { fx(d.e.dimension, "origin:burst", d.e.location, CYAN, 1); d.e.remove(); } catch { } drones.splice(k, 1); continue; }
    if ((t + d.i * 7) % 20 === 0 || (d.tg && !valid(d.tg))) {
      let list = [];
      try { list = p.dimension.getEntities({ location: p.location, maxDistance: 18, families: ["monster"] }).filter((e) => !NO_HIT.includes(e.typeId)).sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location)); } catch { }
      d.tg = list.length ? list[d.i % list.length] : null;
    }
    let goal, face;
    if (d.tg && valid(d.tg)) {
      d.a += 0.08;
      goal = at(d.tg.location, Math.cos(d.a) * 4, 2.6 + Math.sin(d.a * 1.7) * 0.5, Math.sin(d.a) * 4);
      face = d.tg.getHeadLocation();
    } else {
      d.a += 0.05;
      goal = at(p.location, Math.cos(d.a) * 2.4, 2.5 + Math.sin(d.a * 2) * 0.3, Math.sin(d.a) * 2.4);
      face = p.getHeadLocation();
    }
    d.pos = V.lerp(d.pos, goal, 0.22);
    try { d.e.teleport(d.pos, { facingLocation: face }); } catch { }
    if (t % 2 === 0) fx(p.dimension, "origin:missile_glow", at(d.pos, 0, -0.12, 0), CYAN, 0.6);
    if (!d.tg || !valid(d.tg) || t < d.next) continue;
    const end = d.tg.getHeadLocation(), col = beamCol(p);
    flashBeam(p.dimension, d.pos, end, { ...tinted("laser", col), width: 0.1, coreW: 0.032, flare: 0.3, impact: 0.6 }, { life: 0.18 });
    sound(p.dimension, "origin.sfx.repulsor", d.pos, 1.5, 0.35);
    dmg(d.tg, 3, p);
    d.shots++;
    d.next = t + (d.shots % 3 === 0 ? 26 : 4);
  }
}

// ================================================================== WRIST LASER
export function wristLaser(p) {
  if (!knows(hero(p), "laser")) { aiSay(p, "The Wrist Laser needs its blueprint, {addr}."); return; }
  if (!spend(p, 20, "laserCd", 20 * 18)) return;
  const col = beamCol(p);
  startBeam(p, "exo_laser", {
    dur: 32, range: 26, from: "hand", style: { ...tinted("laser", col), width: 0.07, coreW: 0.024, flare: 0.25, impact: 0.75 }, dmg: 6, every: 4, hurt: dmg, pierce: true, turn: 0.85, hitRadius: 0.4,
    burn: "cut", label: "§b§lWRIST LASER", sfx: { start: ["origin.sfx.laser", 1.9, 0.8], loop: ["origin.sfx.laser", 8, 2, 0.25], end: ["random.fizz", 1.8, 0.4] },
  });
  aiSay(p, "Laser's hot, {addr}. Sweep it.", { chat: false });
}

// ================================================================== NANO HOUSING
// body-space paths (sideways, forward, height) from the arc reactor out over the body
const NANO_PATHS = [
  [[0, 0.16, 1.3], [0.3, 0.05, 1.45], [0.4, 0, 1.12], [0.42, 0.05, 0.78]], [[0, 0.16, 1.3], [-0.3, 0.05, 1.45], [-0.4, 0, 1.12], [-0.42, 0.05, 0.78]],
  [[0, 0.16, 1.3], [0.12, 0.1, 0.95], [0.14, 0.05, 0.5], [0.14, 0.05, 0.08]], [[0, 0.16, 1.3], [-0.12, 0.1, 0.95], [-0.14, 0.05, 0.5], [-0.14, 0.05, 0.08]],
  [[0, 0.16, 1.3], [0, 0.1, 1.55], [0, 0.2, 1.75], [0, 0, 1.98]],
];
function bodyPt(p, [s, f, y]) {
  const yaw = (p.getRotation().y * Math.PI) / 180, fw = { x: -Math.sin(yaw), z: Math.cos(yaw) }, rt = { x: -fw.z, z: fw.x };
  return { x: p.location.x + rt.x * s + fw.x * f, y: p.location.y + y, z: p.location.z + rt.z * s + fw.z * f };
}
function pathAt(path, k) {
  const n = path.length - 1, u = Math.min(n - 1e-6, Math.max(0, k * n)), i = Math.floor(u), w = u - i;
  return [0, 1, 2].map((j) => path[i][j] + (path[i + 1][j] - path[i][j]) * w);
}
function nanoFlow(p, k, col) {
  for (const path of NANO_PATHS) {
    const a = bodyPt(p, pathAt(path, k));
    fx(p.dimension, "origin:nanite", a, col, 1, { n: 4, r: 0.1 });
    fx(p.dimension, "origin:spark", a, CYAN, 0.6);
    fx(p.dimension, "origin:nanite", bodyPt(p, pathAt(path, Math.max(0, k - 0.12))), col, 1, { n: 2, r: 0.14 });
  }
}
const NANO_ON = [["chest", 4], ["legs", 10], ["feet", 15], ["head", 21]];    // the faceplate closes last
const NANO_OFF = [["head", 2], ["feet", 8], ["legs", 13], ["chest", 20]];
export async function nanoDeploy(p, thenFly = false) {
  const h = hero(p), x = exoData(h), r = RT(p);
  if (!x.stored || r.suitBusy) return false;
  r.suitBusy = true;
  const stored = x.stored, bySlot = Object.fromEntries(stored.map((d) => [d.slot, d]));
  x.stored = null; x.suited = true;
  saveNow(p);
  const col = hexToRgb(bySlot.chest?.color ?? paintFor(x, bySlot.chest?.mark ?? "mk3"));
  fx(p.dimension, "origin:beam_flare", bodyPt(p, [0, 0.18, 1.3]), CYAN, 1, { size: 0.5, life: 0.25 });
  sound(p.dimension, "beacon.activate", p.location, 1, 2);
  psound(p, "origin.sfx.servo", 1.6, 0.7);
  hudMsg(p, "§b◆ NANO SUIT", 30);
  try {
    for (let t = 0; t <= 24; t++) {
      if (!valid(p)) return false;
      nanoFlow(p, t / 24, col);
      for (const [slot, at0] of NANO_ON) if (t === at0 && bySlot[slot]) { equipStored(p, bySlot[slot]); sound(p.dimension, "armor.equip_netherite", p.location, 1.3, 0.5); }
      if (t % 4 === 0) sound(p.dimension, "origin.sfx.servo", p.location, 1.5 + t * 0.02, 0.35);
      await system.waitTicks(1);
    }
    for (const d of stored) if (!NANO_ON.some(([s]) => s === d.slot)) equipStored(p, d);
  } finally { r.suitBusy = false; }
  fx(p.dimension, "origin:shockwave", at(p.location, 0, 1.2, 0), CYAN, 1, { radius: 1.2 });
  sound(p.dimension, "origin.sfx.lock", p.location, 1.2, 0.8);
  aiSay(p, "Nano suit online, {addr}.", { chat: false });
  if (thenFly) system.runTimeout(() => { if (valid(p)) autoThrust(p); }, 2);
  return true;
}
export async function nanoRetract(p) {
  if (!fullSuit(p)) { hudMsg(p, "§7You need the whole suit on to stow it."); return; }
  const r = RT(p);
  if (r.suitBusy) return;
  const h = hero(p), x = exoData(h), e = eq(p);
  if (isFlying(p)) stopFlight(p, "land");
  r.suitBusy = true;
  const stored = [];
  for (const [slot, s] of SLOTS) {
    const it = e.getEquipment(EquipmentSlot[s]);
    const pc = pieceOf(it?.typeId);
    const d = it?.getComponent("minecraft:durability");
    stored.push({ slot, mark: pc?.mark ?? "mk3", damage: d?.damage ?? 0, ench: enchOf(it), name: it?.nameTag ?? null, stage: pc?.stage ?? 0, color: colorOf(it) ?? paintFor(x, pc?.mark ?? "mk3") });
  }
  x.stored = stored;
  r.exoOn = false;
  if (r.exoNv) { r.exoNv = false; try { p.removeEffect("night_vision"); } catch { } }
  saveNow(p);
  const col = hexToRgb(stored.find((d) => d.slot === "chest")?.color ?? "#2F4E8C");
  try {
    for (let t = 0; t <= 22; t++) {
      if (!valid(p)) break;
      nanoFlow(p, 1 - t / 22, col);
      for (const [slot, at0] of NANO_OFF) if (t === at0) { const s = SLOTS.find((q) => q[0] === slot)[1]; try { e.setEquipment(EquipmentSlot[s], undefined); } catch { } }
      await system.waitTicks(1);
    }
  } finally { r.suitBusy = false; }
  if (valid(p)) {
    fx(p.dimension, "origin:beam_flare", bodyPt(p, [0, 0.18, 1.3]), CYAN, 1, { size: 0.4, life: 0.2 });
    sound(p.dimension, "origin.sfx.servo", p.location, 1.2, 0.6);
    hudMsg(p, "§b◆ SUIT STOWED §7- it's in the reactor. Use the Exo Interface to call it.", 50);
  }
}
// the suit status diagram on the visor: helmet / chest / legs / boots, each 0 ok · 1 damaged · 2 critical · 3 offline
export function exoFlags(p) {
  if (!RT(p).exoOn) return "";
  const I = integrity(p), st = (v) => (v === null || v <= 0.05 ? 3 : v < 0.3 ? 2 : v < 0.6 ? 1 : 0);
  return `origin_sdh${st(I.head)}_origin_sdc${st(I.chest)}_origin_sdl${st(I.legs)}_origin_sdb${st(I.feet)}_`;
}

// ================================================================== ARC BLADE
export function arcBlade(p) {
  if (!knows(hero(p), "blade")) { aiSay(p, "The Arc Blade needs its blueprint, {addr}."); return; }
  if (!spend(p, 20, "bladeCd", 20 * 40)) return;
  RT(p).bladeUntil = now() + 300;
  sound(p.dimension, "origin.sfx.sweep", p.location, 1.3, 0.8);
  fx(p.dimension, "origin:burst", at(p.location, 0, 1, 0), beamCol(p), 1);
  hudMsg(p, "§b◆ ARC BLADE §7- 15s", 40);
}
export function bladeOn(p) { return (RT(p).bladeUntil ?? 0) > now(); }
export function tickBlade() {
  for (const p of world.getAllPlayers()) {
    if (!bladeOn(p)) continue;
    const f = V.flat(p.getViewDirection()), r = rightOf(f);
    const base = at(p.location, r.x * 0.38 + f.x * 0.3, 0.95, r.z * 0.38 + f.z * 0.3);
    const col = beamCol(p);
    for (let k = 0; k < 4; k++) fx(p.dimension, "origin:missile_glow", at(base, f.x * k * 0.28, k * 0.02, f.z * k * 0.28), col, 0.7);
  }
}
export function bladeHit(p, target) {
  if (!bladeOn(p)) return;
  const f = V.flat(p.getViewDirection()), r = rightOf(f);
  const c = at(p.location, f.x * 1.4, 1.1, f.z * 1.4);
  const col = beamCol(p);
  for (let k = -3; k <= 3; k++) fx(p.dimension, "origin:missile_glow", at(c, r.x * k * 0.4 + f.x * (1 - Math.abs(k) * 0.12), Math.abs(k) * 0.08, r.z * k * 0.4 + f.z * (1 - Math.abs(k) * 0.12)), k ? col : C.white, 1);
  sound(p.dimension, "origin.sfx.sweep", p.location, 1.1, 0.8);
  dmg(target, 6, p);
  try {
    for (const e of p.dimension.getEntities({ location: c, maxDistance: 2.2, excludeTypes: [...NO_HIT, "minecraft:player", "origin:exo_drone", "origin:exo_piece"] }))
      if (e.id !== target.id) dmg(e, 4, p);
  } catch { }
  import("./dismember.js").then((m) => m.tryCut(p, target, 6, "power")).catch(() => { });
}
