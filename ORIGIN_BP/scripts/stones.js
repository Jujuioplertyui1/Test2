// ORIGIN v0.14 - stones.js
// THE INFINITY STONES + THE INFINITY GAUNTLET, rebuilt around how the stones are used on screen.
//  Each stone has three powers. Hold a lone stone: use = power 1, sneak + use = power 2.
//  Socket it into the Gauntlet and its third power unlocks, cooldowns drop by 30%, and the stones combine.
//  GAUNTLET:  use = unleash the active power · sneak + use = the Infinity Wheel · look down + use = next stone.
//  Socketing is a moment: the stone flies into its socket and the power surges up your arm. The Soul Stone takes
//  its price (10 levels of experience). The Gauntlet's look on your hand lights each stone you've socketed.
//  The stones still can't be found in survival (/hero stones, or creative).
import { world, system, ItemStack, EntityDamageCause, MolangVariableMap } from "@minecraft/server";
import { hero, RT } from "./data.js";
import { V, at, valid, fx, line, sound, psound, now, health, hexToRgb, msg, C, FX_IDS } from "./util.js";
import { hudMsg } from "./voice.js";
import { oform, show, ICONS } from "./forms.js";
import { runCine, EASE } from "./cine.js";
import { rewindSelfSeconds, rewindBlocks, rewindEntity } from "./mirror.js";
import { startBeam, stopBeam, beamActive, STYLES } from "./beams.js";

export const STONES = {
  space: { id: "origin:space_stone", name: "Space Stone", col: "§9", hex: "#3A7BFF", bit: 1, sfx: "origin.sfx.portal",
    lore: "Space, folded in your hand. It opens doors anywhere, puts things where it wants them, and crushes distance to nothing." },
  mind: { id: "origin:mind_stone", name: "Mind Stone", col: "§e", hex: "#FFD21F", bit: 2, sfx: "origin.sfx.mind",
    lore: "The stone behind a scepter that bent minds, and the beam of a mind made of metal. Thought, made into force." },
  reality: { id: "origin:reality_stone", name: "Reality Stone", col: "§c", hex: "#FF2A3A", bit: 4, sfx: "origin.sfx.reality",
    lore: "Reality, made liquid. It rewrites what is: fighters into bricks and ribbons, bullets into bubbles, the ground into a cage." },
  power: { id: "origin:power_stone", name: "Power Stone", col: "§5", hex: "#B04CFF", bit: 8, sfx: "origin.sfx.power",
    lore: "Raw power. Enough to shatter a moon - and to burn the hand that holds it. Most Gauntlet combos run through it." },
  time: { id: "origin:time_stone", name: "Time Stone", col: "§a", hex: "#2BE07F", bit: 16, sfx: "origin.sfx.lock",
    lore: "It freezes, loops and reverses. Once it wound back a destruction that had already happened." },
  soul: { id: "origin:soul_stone", name: "Soul Stone", col: "§6", hex: "#FF8A1F", bit: 32, sfx: "origin.sfx.soul",
    lore: "Won on a cold mountain for the worst price there is. It knows every soul - which ones are real, and how to take them." },
};
export const STONE_KEYS = Object.keys(STONES);
const SK = STONE_KEYS;
export const STONE_OF = Object.fromEntries(SK.map((k) => [STONES[k].id, k]));
export const GAUNTLET = "origin:infinity_gauntlet";
export const isGauntlet = (id) => typeof id === "string" && (id === GAUNTLET || id.startsWith(GAUNTLET + "_"));
const maskOf = (id) => (id === GAUNTLET ? 0 : Number(id.slice(GAUNTLET.length + 1)) || 0);
const idOf = (mask) => (mask ? `${GAUNTLET}_${mask}` : GAUNTLET);
const socketsOf = (mask) => SK.filter((k) => mask & STONES[k].bit);
const RGB = Object.fromEntries(SK.map((k) => [k, hexToRgb(STONES[k].hex)]));
const GOLD = hexToRgb("#ffd36a");
const NOPE = [...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "origin:float_text", "origin:exo_piece", "origin:exo_drone", "origin:archetype_orb", "origin:manifestation",
  "origin:lumen_construct", "origin:void_stain", "origin:severed_limb", "origin:ink_spike", "origin:ink_hand", "origin:prosthetic", "minecraft:player"];
const BOSS = new Set(["origin:null", "minecraft:wither", "minecraft:ender_dragon", "minecraft:warden", "minecraft:elder_guardian"]);
const PROJ = new Set(["minecraft:arrow", "minecraft:snowball", "minecraft:small_fireball", "minecraft:fireball", "minecraft:dragon_fireball", "minecraft:wither_skull", "minecraft:wither_skull_dangerous",
  "minecraft:shulker_bullet", "minecraft:llama_spit", "minecraft:thrown_trident", "minecraft:wind_charge_projectile", "minecraft:breeze_wind_charge_projectile", "minecraft:egg", "minecraft:splash_potion", "minecraft:lingering_potion"]);
const pad = (n) => String(n).padStart(2, "0");

// ------------------------------------------------------------------ helpers
const hurt = (e, n, by, cause = EntityDamageCause.entityAttack) => { try { e.applyDamage(n, by ? { cause, damagingEntity: by } : { cause }); } catch { } };
const heal = (e, n) => { try { const hc = e.getComponent("minecraft:health"); hc.setCurrentValue(Math.min(hc.effectiveMax, hc.currentValue + n)); } catch { } };
const foes = (p, c, r) => { try { return p.dimension.getEntities({ location: c, maxDistance: r, families: ["monster"], excludeTypes: NOPE }).filter((e) => e.id !== p.id); } catch { return []; } };
const living = (p, c, r) => { try { return p.dimension.getEntities({ location: c, maxDistance: r, excludeTypes: NOPE }).filter((e) => e.id !== p.id && !!health(e)); } catch { return []; } };
const look = (p, d) => { try { return p.getEntitiesFromViewDirection({ maxDistance: d }).map((h) => h.entity).find((e) => valid(e) && e.id !== p.id && !NOPE.includes(e.typeId)) ?? null; } catch { return null; } };
function lookPoint(p, d) {
  try { const h = p.getBlockFromViewDirection({ maxDistance: d, includePassableBlocks: false }); if (h) return { ...V.add(h.block.location, h.faceLocation), face: h.face, block: h.block }; } catch { }
  return null;
}
const airAt = (dim, l) => { try { const b = dim.getBlock(l); return !b || b.isAir || b.isLiquid; } catch { return true; } };
const shake = (p, a = 0.3, t = 0.3) => { try { p.runCommand(`camerashake add @s ${a} ${t} positional`); } catch { } };
const shakeNear = (dim, c, r, a, t) => { try { for (const q of dim.getPlayers({ location: c, maxDistance: r })) shake(q, a, t); } catch { } };
function hand(p) { const h = p.getHeadLocation(), d = p.getViewDirection(); return at(h, -d.z * 0.38 + d.x * 0.6, -0.42, d.x * 0.38 + d.z * 0.6); }
function portal(dim, c, dir, col, size = 1.2) { fx(dim, "origin:portal_ring", c, col, 1, { size, nx: dir.x, nz: dir.z }); fx(dim, "origin:portal", c, col, 0.8, { size: size * 1.6 }); }
function beam(p, cols, dmgN, len = 32, width = 0) {
  const dim = p.dimension, from = hand(p), dir = p.getViewDirection();
  let dist = len;
  try { const bh = dim.getBlockFromRay(p.getHeadLocation(), dir, { maxDistance: len, includePassableBlocks: false }); if (bh) dist = V.dist(p.getHeadLocation(), V.add(bh.block.location, bh.faceLocation)); } catch { }
  const end = V.add(p.getHeadLocation(), V.mul(dir, dist));
  cols.forEach((c, i) => { const o = width ? (i - (cols.length - 1) / 2) * width : 0; line(dim, "origin:beam", at(from, -dir.z * o, 0, dir.x * o), at(end, -dir.z * o, 0, dir.x * o), c, 0.5, 1); });
  line(dim, "origin:beam", from, end, C.white, 1.1, 0.8);
  let hits = [];
  try { hits = dim.getEntitiesFromRay(p.getHeadLocation(), dir, { maxDistance: dist }).map((h) => h.entity).filter((e) => e.id !== p.id && !NOPE.includes(e.typeId)); } catch { }
  for (const e of hits) { hurt(e, dmgN, p); const k = V.flat(dir); try { e.applyKnockback({ x: k.x * 1.6, z: k.z * 1.6 }, 0.4); } catch { } }
  return { end, hits };
}

// ------------------------------------------------------------------ live effects (ticked)
const frozen = new Map(), dots = [], cages = [], gates = [], wisps = [], thralls = new Map(), binds = new Map(), shareGuard = new Map(), unravel = new Map(), pulls = [];
function freeze(e, ticks) {
  if (!valid(e)) return;
  frozen.set(e.id, { e, pos: { ...e.location }, rot: e.getRotation(), until: now() + ticks });
  try { e.addEffect("slowness", ticks, { amplifier: 255, showParticles: false }); e.addEffect("weakness", ticks, { amplifier: 4, showParticles: false }); } catch { }
}
function gem(p) { const r = RT(p); return (r.gem ??= { cd: {}, pick: {}, souls: 0, sel: null }); }
function cdLeft(p, key) { return Math.max(0, (gem(p).cd[key] ?? 0) - now()); }

// ------------------------------------------------------------------ THE POWERS (3 per stone; the third needs the Gauntlet)
const MOVES = {
  space: [
    { name: "Portal Step", desc: "Tear a portal and step through to where you look (64 blocks)", cd: 50, fn(p) {
      const e = look(p, 64), pt = e ? null : lookPoint(p, 64), f = V.flat(p.getViewDirection());
      const dest = e ? at(e.location, -f.x * 1.6, 0, -f.z * 1.6) : pt ? (pt.face === "Up" ? at(pt.block.location, 0.5, 1, 0.5) : V.sub(pt, V.mul(p.getViewDirection(), 1))) : V.add(p.location, V.mul(p.getViewDirection(), 30));
      let spot = null;
      for (let dy = 0; dy <= 3 && !spot; dy++) { const l = { x: dest.x, y: Math.floor(dest.y) + dy, z: dest.z }; if (airAt(p.dimension, l) && airAt(p.dimension, at(l, 0, 1, 0))) spot = l; }
      if (!spot) { hudMsg(p, "§7No room there.", 30); return false; }
      portal(p.dimension, at(p.location, f.x, 1.1, f.z), f, RGB.space, 1.3);
      try { p.teleport(spot, e ? { facingLocation: e.getHeadLocation() } : { rotation: p.getRotation() }); } catch { return false; }
      portal(p.dimension, at(spot, 0, 1.1, 0), f, RGB.space, 1.3);
      sound(p.dimension, "origin.sfx.portal", spot, 1.2, 1);
    } },
    { name: "Gateway", desc: "Open two linked portals - here and where you look. Anything that enters one exits the other (12s)", cd: 400, fn(p) {
      const f = V.flat(p.getViewDirection()), pt = lookPoint(p, 48);
      const a = at(p.location, f.x * 2.4, 1.1, f.z * 2.4);
      const b = pt ? (pt.face === "Up" ? at(pt.block.location, 0.5, 2.1, 0.5) : at(V.sub(pt, V.mul(p.getViewDirection(), 1.4)), 0, 0.6, 0)) : V.add(p.getHeadLocation(), V.mul(p.getViewDirection(), 24));
      for (let i = gates.length - 1; i >= 0; i--) if (gates[i].by === p.id) gates.splice(i, 1);
      gates.push({ by: p.id, dim: p.dimension, a, b, f, until: now() + 240, cool: new Map() });
      sound(p.dimension, "origin.sfx.portal", a, 0.8, 1);
      sound(p.dimension, "origin.sfx.portal", b, 0.8, 1);
    } },
    { name: "Crush", g: true, desc: "Seize a target from 32 blocks away, lift it into the air and crush it", cd: 280, fn(p) {
      const e = look(p, 32);
      if (!e) { hudMsg(p, "§7Look at what you want to crush.", 30); return false; }
      const hold = at(e.location, 0, 2.2, 0);
      try { e.teleport(hold); } catch { }
      freeze(e, 32);
      sound(p.dimension, "origin.sfx.charge", e.location, 1.3, 0.8);
      for (let t = 0; t <= 28; t += 4) system.runTimeout(() => { if (!valid(e)) return; for (let k = 0; k < 6; k++) { const a = Math.random() * 6.28, rr = 1.6 - t / 20; fx(e.dimension, "origin:sparkle", at(e.location, Math.cos(a) * rr, 0.4 + Math.random() * 1.6, Math.sin(a) * rr), RGB.space, 1); } }, t);
      system.runTimeout(() => {
        if (!valid(e) || !valid(p)) return;
        frozen.delete(e.id);
        hurt(e, BOSS.has(e.typeId) ? 10 : 16, p);
        fx(e.dimension, "origin:flash", at(e.location, 0, 1, 0), RGB.space, 1, { size: 2.5 });
        sound(e.dimension, "origin.sfx.bonecrack", e.location, 1, 1);
        const k = V.flat(V.sub(e.location, p.location));
        try { e.applyKnockback({ x: k.x * 2.6, z: k.z * 2.6 }, 0.6); } catch { }
      }, 32);
    } },
  ],
  mind: [
    { name: "Mind Beam", desc: "Five seconds of golden beam from the stone itself: it burns through everything in a line and scrambles every mind it touches", cd: 260, fn(p) {
      sound(p.dimension, "origin.sfx.mind", p.location, 1.2, 0.6);
      startBeam(p, "stone", {
        dur: 100, range: 40, from: "hand", style: STYLES.mind, dmg: 3, every: 8, hurt, pierce: true, turn: 0.4, hitRadius: 0.6, label: "§e§lMIND BEAM",
        onHit: (e) => { try { e.addEffect("slowness", 30, { amplifier: 1, showParticles: false }); if (e.typeId === "minecraft:player") e.addEffect("nausea", 60, { showParticles: false }); } catch { } },
        sfx: { start: ["origin.sfx.laser", 1.3, 1], loop: ["origin.sfx.mind", 20, 1.4, 0.35] },
      });
    } },
    { name: "Enthrall", desc: "Take a creature's mind for 20s: it fights for you and can't hurt you", cd: 500, fn(p) {
      const e = look(p, 24);
      if (!e || e.typeId === "minecraft:player") { hudMsg(p, "§7Look at a creature to take its mind.", 30); return false; }
      if (BOSS.has(e.typeId)) { hurt(e, 8, p); hudMsg(p, "§7That mind is too vast to hold.", 40); return; }
      thralls.set(e.id, { e, by: p, until: now() + 400, next: now() + 20 });
      try { e.addEffect("weakness", 400, { amplifier: 255, showParticles: false }); } catch { }
      line(p.dimension, "origin:dot", hand(p), e.getHeadLocation(), RGB.mind, 0.8, 1);
      sound(p.dimension, "origin.sfx.mind", e.location, 1, 1);
    } },
    { name: "Psychic Storm", g: true, desc: "Every mind within 20 blocks is stunned and hurt. You sense every creature within 64 for 15s", cd: 600, fn(p) {
      for (const e of living(p, p.location, 20)) { freeze(e, 60); hurt(e, 8, p, EntityDamageCause.magic); try { e.addEffect("nausea", 160); } catch { } fx(e.dimension, "origin:flare", e.getHeadLocation(), RGB.mind, 1); }
      gem(p).scan = { until: now() + 300 };
      fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.05, 0), RGB.mind, 1, { radius: 20 });
      sound(p.dimension, "origin.sfx.highpitch", p.location, 0.6, 1);
      shake(p, 0.4, 0.5);
    } },
  ],
  reality: [
    { name: "Unravel", desc: "Rewrite a target into ribbons and bricks: frozen, coming apart (15 damage over 3s)", cd: 200, fn(p) {
      const e = look(p, 24);
      if (!e) { hudMsg(p, "§7Look at something to unravel.", 30); return false; }
      freeze(e, 60);
      unravel.set(e.id, { by: p, until: now() + 70 });
      dots.push({ e, by: p, n: 3, next: now() + 20, dmg: BOSS.has(e.typeId) ? 3 : 5, col: RGB.reality, fxId: "origin:ribbon" });
      fx(e.dimension, "origin:ribbon", e.location, RGB.reality, 1);
      sound(p.dimension, "origin.sfx.reality", e.location, 1.2, 1);
    } },
    { name: "Bubble Ward", desc: "For 8s, every projectile that comes near you becomes a harmless bubble", cd: 400, fn(p) {
      gem(p).bubbleUntil = now() + 160;
      fx(p.dimension, "origin:bubble", at(p.location, 0, 1, 0), RGB.reality, 1);
      sound(p.dimension, "origin.sfx.reality", p.location, 1.6, 0.6);
    } },
    { name: "Rock Cage", g: true, desc: "Reality bends the ground into a cage of rock around your target (6s)", cd: 360, fn(p) {
      const e = look(p, 24);
      if (!e) { hudMsg(p, "§7Look at what you want caged.", 30); return false; }
      const dim = e.dimension, c = { x: Math.floor(e.location.x), y: Math.floor(e.location.y), z: Math.floor(e.location.z) };
      try { e.teleport({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 }); } catch { }
      const placed = [];
      for (let dy = 0; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dy < 3 && dx === 0 && dz === 0) continue;
        if (dy === 1 && dx === 0 && dz === 0) continue;
        const l = { x: c.x + dx, y: c.y + dy, z: c.z + dz };
        try { const b = dim.getBlock(l); if (b?.isAir) { b.setType(dy === 3 || (dx && dz) ? "minecraft:red_nether_bricks" : "minecraft:crying_obsidian"); placed.push(l); } } catch { }
      }
      cages.push({ dim, placed, until: now() + 120 });
      freeze(e, BOSS.has(e.typeId) ? 60 : 120);
      fx(dim, "origin:ribbon", e.location, RGB.reality, 1);
      sound(dim, "origin.sfx.rocks", e.location, 1, 1);
    } },
  ],
  power: [
    { name: "Power Blast", desc: "Three seconds of violet beam: everything in the line burns, the ground blows apart where it lands, and it ends in a blast", cd: 240, fn(p) {
      sound(p.dimension, "origin.sfx.power", p.location, 1.3, 0.7);
      startBeam(p, "stone", {
        dur: 60, range: 40, from: "hand", style: STYLES.power, dmg: 4, every: 6, hurt, pierce: true, turn: 0.3, hitRadius: 0.8, knock: 0.35, label: "§5§lPOWER BLAST",
        pulse: { every: 15, radius: 2.6, dmg: 6, crater: 1 }, selfSlow: 2, recoil: 0.12, shake: 0.12,
        sfx: { start: ["origin.sfx.laser", 0.85, 1], loop: ["origin.sfx.charge", 12, 1.6, 0.4], end: ["origin.sfx.explode", 1.1, 0.8] },
        onEnd: (pl, b, why) => {
          if (!b.end || why === "replaced" || !valid(pl)) return;
          const dim = pl.dimension;
          fx(dim, "origin:flash", b.end, RGB.power, 1, { size: 3 }); fx(dim, "origin:shockwave", b.end, RGB.power, 1, { radius: 3.5 });
          for (const e of living(pl, b.end, 3.2)) hurt(e, 8, pl);
          shakeNear(dim, b.end, 24, 0.4, 0.4);
        },
      });
    } },
    { name: "Power Fist", desc: "Charge your fist: your next punch (6s) is a shockwave - 20 damage and a huge launch", cd: 160, fn(p) {
      gem(p).fistUntil = now() + 120;
      sound(p.dimension, "origin.sfx.powerup", p.location, 1.4, 0.7);
    } },
    { name: "Annihilate", g: true, desc: "A ring of raw power rolls out 12 blocks: 14 damage and everything is thrown. It burns you too", cd: 500, fn(p) {
      const dim = p.dimension, c = { ...p.location }, hit = new Set();
      sound(dim, "origin.sfx.explode", c, 0.6, 1);
      shake(p, 0.6, 0.6);
      for (let t = 0; t <= 12; t++) system.runTimeout(() => {
        const rad = 1 + t;
        fx(dim, "origin:shockwave", at(c, 0, 0.1, 0), RGB.power, 1, { radius: rad });
        for (const e of living(p, c, rad + 0.6)) {
          if (hit.has(e.id) || V.dist(e.location, c) < rad - 1.4) continue;
          hit.add(e.id);
          hurt(e, 14, p);
          const k = V.flat(V.sub(e.location, c));
          try { e.applyKnockback({ x: k.x * 2.4, z: k.z * 2.4 }, 0.9); } catch { }
        }
      }, t);
      try { const hc = p.getComponent("minecraft:health"); if (hc.currentValue > 3) p.applyDamage(2, { cause: EntityDamageCause.magic }); } catch { }
    } },
  ],
  time: [
    { name: "Stasis", desc: "Freeze time for every hostile within 16 blocks (6s). Arrows stop dead", cd: 300, fn(p) {
      const list = foes(p, p.location, 16);
      for (const e of list) freeze(e, 120);
      try { for (const a of p.dimension.getEntities({ location: p.location, maxDistance: 16 })) if (PROJ.has(a.typeId)) a.remove(); } catch { }
      fx(p.dimension, "origin:rewind", at(p.location, 0, 1.2, 0), RGB.time, 1);
      fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.05, 0), RGB.time, 1, { radius: 16 });
      sound(p.dimension, "origin.sfx.lock", p.location, 0.5, 1);
      hudMsg(p, `§a${list.length} frozen in time`, 40);
    } },
    { name: "Rewind", desc: "Wind yourself back 10 seconds: where you stood, the health you had", cd: 400, fn(p) {
      if (!rewindSelfSeconds(p, 10)) { hudMsg(p, "§7Not enough history yet.", 30); return false; }
      sound(p.dimension, "origin.sfx.lock", p.location, 0.8, 1);
    } },
    { name: "Time Loop", g: true, desc: "For 30s you're bound to a loop: a killing blow snaps time back to this moment instead", cd: 1200, fn(p) {
      let fxs = [];
      try { fxs = p.getEffects().map((f) => [f.typeId, f.amplifier, f.duration]); } catch { }
      gem(p).loop = { until: now() + 600, loc: { ...p.location }, dim: p.dimension.id, rot: p.getRotation(), hp: health(p)?.cur ?? 20, fxs };
      fx(p.dimension, "origin:rewind", at(p.location, 0, 1.1, 0), RGB.time, 1);
      fx(p.dimension, "origin:ring", at(p.location, 0, 0.1, 0), RGB.time, 1, { radius: 1.4 });
      hudMsg(p, "§a§lTIME LOOP §r§7- 30s", 50);
    } },
  ],
  soul: [
    { name: "Soul Rip", desc: "Tear at a target's soul: 10 damage, you heal 6. Kills while holding Soul feed your stock", cd: 160, fn(p) {
      const e = look(p, 16);
      if (!e) { hudMsg(p, "§7Look at a soul to take.", 30); return false; }
      hurt(e, 10, p, EntityDamageCause.magic);
      heal(p, 6);
      line(p.dimension, "origin:dot", e.getHeadLocation(), hand(p), RGB.soul, 0.4, 1);
      fx(p.dimension, "origin:wisp", e.getHeadLocation(), RGB.soul, 1);
      sound(p.dimension, "origin.sfx.soul", e.location, 1.1, 1);
    } },
    { name: "Soul Legion", desc: "Release every soul you hold: each one hunts an enemy and bursts (7 damage)", cd: 240, fn(p) {
      const g = gem(p);
      if (!g.souls) { hudMsg(p, "§7No souls stored. §8Kill while holding the Soul Stone.", 50); return false; }
      for (let i = 0; i < g.souls; i++) wisps.push({ by: p, pos: at(p.location, Math.cos(i) * 0.8, 1.6 + i * 0.15, Math.sin(i) * 0.8), tgt: null, t: 0 });
      hudMsg(p, `§6${g.souls} soul${g.souls > 1 ? "s" : ""} released`, 40);
      g.souls = 0;
      sound(p.dimension, "origin.sfx.soul", p.location, 0.8, 1);
    } },
    { name: "Soul Bind", g: true, desc: "Bind up to 5 enemies' souls together (10s): whatever hurts one, hurts them all", cd: 500, fn(p) {
      const pt = lookPoint(p, 32) ?? V.add(p.location, V.mul(V.flat(p.getViewDirection()), 8));
      const group = foes(p, pt, 7).slice(0, 5);
      if (group.length < 2) { hudMsg(p, "§7Need at least two souls to bind.", 30); return false; }
      const ids = group.map((e) => e.id), until = now() + 200;
      for (const e of group) binds.set(e.id, { ids, until, by: p });
      sound(p.dimension, "origin.sfx.chains", pt, 0.8, 1);
      hudMsg(p, `§6${group.length} souls bound`, 40);
    } },
  ],
};

// ------------------------------------------------------------------ COMBINATIONS (Gauntlet only)
export const COMBOS = [
  { key: "moonfall", name: "Moonfall", need: ["power", "space"], cd: 900, desc: "The Power Stone shatters a moon over your target; the Space Stone hurls the pieces down" },
  { key: "spirit", name: "Spirit Hunt", need: ["soul", "power"], cd: 600, desc: "Soul finds what's real, Power destroys the rest: invisible things exposed, spirits shredded" },
  { key: "snatch", name: "Snatch", need: ["space", "reality"], cd: 360, desc: "Pull a target from 48 blocks straight into your fist, then slam it" },
  { key: "rewrite", name: "Rewrite", need: ["mind", "reality"], cd: 600, desc: "Every enemy within 16 sees its allies as you - and attacks them" },
  { key: "undo", name: "Undo", need: ["time", "reality"], cd: 900, desc: "Reverse the battlefield: blocks broken in the last minute come back, enemies rewind 10s" },
  { key: "regenesis", name: "Regenesis", need: ["soul", "time", "reality"], cd: 1200, desc: "Close every wound: you and allies within 16 fully healed and cleansed" },
  { key: "beam", name: "Infinity Beam", need: ["power"], min: 4, cd: 1000, desc: "Power plus three more stones: six seconds of a beam of every color - it tears up the ground where it lands and ends in a blast" },
  { key: "snap", name: "The Snap", need: SK, cd: 12000, desc: "All six. Half of all hostile life within 128 blocks turns to dust. It will cost you" },
];
const comboOk = (c, s) => c.need.every((k) => s.includes(k)) && s.length >= (c.min ?? 0);
const ABIL = [...SK.flatMap((k) => [0, 1, 2].map((i) => `${k}:${i}`)), ...COMBOS.map((c) => `combo:${c.key}`)];
function parseSel(s) {
  if (!s) return null;
  const [a, b] = s.split(":");
  if (a === "combo") { const c = COMBOS.find((x) => x.key === b); return c ? { key: s, combo: c, name: c.name } : null; }
  const m = MOVES[a]?.[Number(b)];
  return m ? { key: s, stone: a, i: Number(b), move: m, name: m.name } : null;
}
function selOf(p, mask) {
  const g = gem(p), s = socketsOf(mask);
  let sel = parseSel(g.sel);
  if (sel && ((sel.stone && !s.includes(sel.stone)) || (sel.combo && !comboOk(sel.combo, s)))) sel = null;
  if (!sel && s.length) { g.sel = `${s[0]}:${g.pick[s[0]] ?? 0}`; sel = parseSel(g.sel); }
  return sel;
}

// ------------------------------------------------------------------ what you're holding
function held(p) {
  try {
    const c = p.getComponent("minecraft:inventory").container, slot = p.selectedSlotIndex, it = c.getItem(slot);
    if (!it) return null;
    if (isGauntlet(it.typeId)) return { c, slot, it, mask: maskOf(it.typeId) };
    if (STONE_OF[it.typeId]) return { c, slot, it, stone: STONE_OF[it.typeId] };
  } catch { }
  return null;
}
function activeStones(p) { const h = held(p); return !h ? [] : h.stone ? [h.stone] : socketsOf(h.mask); }
const hasActive = (p, k) => activeStones(p).includes(k);
function count(p, id) { let n = 0; try { const c = p.getComponent("minecraft:inventory").container; for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it?.typeId === id) n += it.amount; } } catch { } return n; }
function take1(p, id) {
  try { const c = p.getComponent("minecraft:inventory").container; for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it?.typeId === id) { if (it.amount > 1) { it.amount -= 1; c.setItem(i, it); } else c.setItem(i, undefined); return true; } } } catch { }
  return false;
}
function loreFor(mask) { return ["§7Stones:", ...SK.map((k) => (mask & STONES[k].bit ? `${STONES[k].col}● ${STONES[k].name}` : `§8○ ${STONES[k].name}`)), "§8Use: unleash · Sneak + use: the Wheel · Look down + use: next stone"]; }
function setMask(c, slot, mask) {
  try { const old = c.getItem(slot); const n = new ItemStack(idOf(mask), 1); if (old?.nameTag) n.nameTag = old.nameTag; n.setLore(loreFor(mask)); n.keepOnDeath = true; c.setItem(slot, n); return true; } catch { return false; }
}

// ------------------------------------------------------------------ casting
function flare(p, keys) {
  const hp = hand(p);
  try { p.playAnimation("animation.origin.gauntlet.clench", { controller: "origin_gauntlet", stopExpression: "0", blendOutTime: 0.2 }); } catch { }
  keys.forEach((k, i) => system.runTimeout(() => valid(p) && fx(p.dimension, "origin:flare", hand(p), RGB[k], 1), i * 2));
  fx(p.dimension, "origin:sparkle", hp, C.white, 1);
}
function cast(p, sel, viaGauntlet, socketed = []) {
  if (beamActive(p, "stone")) { stopBeam(p, "cut"); return; }   // use again: cut a stone beam
  const g = gem(p), t = now();
  const left = cdLeft(p, sel.key);
  if (left > 0) { hudMsg(p, `§7${sel.name} §c${(left / 20).toFixed(1)}s`, 20); return; }
  if ((g.cd.any ?? 0) > t) return;
  if (sel.combo) {
    if (!comboOk(sel.combo, socketed)) { hudMsg(p, `§7${sel.combo.name} needs ${sel.combo.need.map((k) => STONES[k].col + STONES[k].name).join("§7 + ")}`, 50); return; }
    g.cd[sel.key] = t + sel.combo.cd; g.cd.any = t + 30;
    flare(p, sel.combo.key === "snap" ? [] : sel.combo.need.length >= 4 ? socketed : sel.combo.need);
    hudMsg(p, `§6§l${sel.combo.name.toUpperCase()}`, 40);
    Promise.resolve(COMBO_FN[sel.combo.key](p, socketed)).catch((e) => console.warn("[ORIGIN] combo: " + e));
    return;
  }
  const m = sel.move;
  if (m.g && !viaGauntlet) { hudMsg(p, "§7That power needs the Infinity Gauntlet.", 40); return; }
  g.cd[sel.key] = t + Math.round(m.cd * (viaGauntlet ? 0.7 : 1)); g.cd.any = t + 8;
  flare(p, [sel.stone]);
  sound(p.dimension, STONES[sel.stone].sfx, p.location, 1.5, 0.35);
  let res;
  try { res = m.fn(p); } catch (e) { console.warn("[ORIGIN] stone: " + e); res = false; }
  if (res === false) { g.cd[sel.key] = 0; g.cd.any = 0; return; }
  hudMsg(p, `${STONES[sel.stone].col}§l${m.name.toUpperCase()}`, 30);
}
export function useStone(p, key, sneaking) {
  const i = sneaking ? 1 : 0;
  cast(p, { key: `${key}:${i}`, stone: key, i, move: MOVES[key][i], name: MOVES[key][i].name }, false);
}
export async function useGauntlet(p, sneaking) {
  const h = held(p);
  if (!h || h.stone) return;
  const s = socketsOf(h.mask);
  if (sneaking) return openWheel(p);
  if (!s.length) { hudMsg(p, "§7The Gauntlet is empty. §8Sneak + use to socket stones.", 50); return; }
  if (p.getRotation().x > 60) {                      // look down + use: next stone
    const cur = parseSel(gem(p).sel), idx = cur?.stone ? s.indexOf(cur.stone) : -1;
    const k = s[(idx + 1) % s.length];
    gem(p).sel = `${k}:${gem(p).pick[k] ?? 0}`;
    psound(p, "origin.sfx.click", 1.4, 0.5);
    fx(p.dimension, "origin:flare", hand(p), RGB[k], 1);
    hudMsg(p, `${STONES[k].col}§l${STONES[k].name.toUpperCase()}`, 25);
    return;
  }
  const sel = selOf(p, h.mask);
  if (sel) cast(p, sel, true, s);
}

// ------------------------------------------------------------------ the Infinity Wheel (custom full-screen GUI)
export async function openWheel(p) {
  const h = held(p);
  if (!h || h.stone) return;
  const s = socketsOf(h.mask), g = gem(p);
  const loose = SK.filter((k) => !s.includes(k) && count(p, STONES[k].id) > 0);
  const sel = selOf(p, h.mask);
  const flags = s.map((k) => `s${SK.indexOf(k)}_`).join("") + (sel?.stone ? `a${SK.indexOf(sel.stone)}_` : "");
  const f = oform("wheel", flags, `§7Active: §f${sel ? sel.name : "none"}\n§7Stones: §f${s.length}/6${g.souls ? ` §7· Souls: §6${g.souls}` : ""}\n§8use: unleash\n§8look down + use: next stone${loose.length ? "\n§aTap a §l+§r§a stone to socket it" : ""}`);
  f.__raw.title = "Infinity Gauntlet";
  for (const k of SK) {
    const S = STONES[k], short = S.name.split(" ")[0];
    const mk = `[${SK.indexOf(k)}]`;
    if (s.includes(k)) f.button(`${mk}${S.col}§l${short}\n§r§7${MOVES[k][g.pick[k] ?? 0].name}`, ICONS + `x_stone_${k}`);
    else if (loose.includes(k)) f.button(`${mk}§a§l+ ${short}\n§r§7tap to socket`, ICONS + `x_stone_${k}`);
    else f.button(`${mk}§8${short}\n§8empty`, ICONS + "x_sock");
  }
  for (const [ci, c] of COMBOS.entries()) {
    const ok = comboOk(c, s);
    f.button(`[${6 + ci}]${ok ? (sel?.key === "combo:" + c.key ? "§a◆ " : "§6") : "§8"}${c.name}\n${c.need.length >= 6 ? "§fall six" : c.need.map((k) => STONES[k].col + "●").join("")}${c.min ? "§7+" + (c.min - c.need.length) : ""}`, ICONS + (ok ? (c.key === "snap" ? "x_snap" : "x_combo") : "x_lock"));
  }
  const res = await show(p, f);
  if (!res || res.canceled) return;
  const i = res.selection;
  if (i < 6) {
    const k = SK[i];
    if (loose.includes(k)) return socket(p, k);
    if (s.includes(k)) return openStone(p, k);
    hudMsg(p, `§8No ${STONES[k].name}. §7They can't be found yet.`, 50);
    return;
  }
  const c = COMBOS[i - 6];
  if (!c) return;
  if (!comboOk(c, s)) { hudMsg(p, `§7${c.name} needs ${c.need.map((k) => STONES[k].col + STONES[k].name).join("§7 + ")}${c.min ? ` §7(${c.min}+ stones)` : ""}`, 60); return; }
  g.sel = "combo:" + c.key;
  psound(p, "origin.sfx.ting", 1.2, 0.5);
  hudMsg(p, `§6Active: §l${c.name}§r §7- use the Gauntlet`, 50);
}
async function openStone(p, k) {
  const g = gem(p), S = STONES[k];
  const f = oform("stone", `k${SK.indexOf(k)}_`, `§f${S.lore}\n\n§7Tap a power to make it active, then use the Gauntlet.`);
  f.__raw.title = S.name;
  MOVES[k].forEach((m, i) => {
    const on = g.sel === `${k}:${i}`;
    f.button(`[${i}]${S.col}§l${m.name}${on ? " §a◆" : ""}\n§r§7${m.desc}`, ICONS + `x_stone_${k}`);
  });
  f.button("[3]§fBack", ICONS + "act_back");
  const res = await show(p, f);
  if (!res || res.canceled) return;
  if (res.selection === 3) return openWheel(p);
  const i = res.selection;
  g.sel = `${k}:${i}`; g.pick[k] = i;
  psound(p, "origin.sfx.ting", 1.3, 0.5);
  hudMsg(p, `${S.col}Active: §l${MOVES[k][i].name}`, 40);
}

// the moment a stone goes in
async function socket(p, k) {
  const h0 = held(p);
  if (!h0 || h0.stone) return;
  const S = STONES[k];
  if (k === "soul" && (p.level ?? 0) < 10) { msg(p, "§6The Soul Stone demands a sacrifice. §7A part of you: 10 levels of experience. §8You don't have them yet."); psound(p, "origin.sfx.soul", 0.5, 0.6); return; }
  if (!take1(p, S.id)) return;
  if (k === "soul") { try { p.addLevels(-10); } catch { } }
  const slot = h0.slot, c0 = h0.c;
  await runCine(p, async (c) => {
    const f = V.flat(p.getViewDirection()), H = hand(p);
    c.cam(at(H, f.z * 1.5 - f.x * 0.5, 0.35, -f.x * 1.5 - f.z * 0.5), H);
    try { p.playAnimation("animation.origin.gauntlet.raise", { controller: "origin_gauntlet", stopExpression: "0", blendOutTime: 0.3 }); } catch { }
    const from = at(H, f.x * 2.4, 1.6, f.z * 2.4);
    for (let t = 0; t <= 14; t++) {
      const pos = V.lerp(from, hand(p), (t / 14) ** 2);
      fx(p.dimension, "origin:sparkle", pos, RGB[k], 1);
      if (t % 3 === 0) fx(p.dimension, "origin:wisp", pos, RGB[k], 1);
      await c.wait(1);
    }
    const cur = c0.getItem(slot);
    if (cur && isGauntlet(cur.typeId)) setMask(c0, slot, maskOf(cur.typeId) | S.bit);
    else { try { const left = p.getComponent("minecraft:inventory").container.addItem(new ItemStack(S.id, 1)); if (left) p.dimension.spawnItem(left, p.location); } catch { } return; }
    sound(p.dimension, "origin.sfx.click", p.location, 0.8, 1);
    sound(p.dimension, "random.anvil_land", p.location, 0.4, 0.5);
    sound(p.dimension, S.sfx, p.location, 1, 1);
    fx(p.dimension, "origin:flash", hand(p), RGB[k], 1, { size: 3 });
    c.fade(0, 0.05, 0.35, { red: RGB[k].red, green: RGB[k].green, blue: RGB[k].blue });
    c.shake(0.6, 0.6);
    c.say(`${S.col}§l${S.name.toUpperCase()}`, 40);
    for (let t = 0; t < 22; t++) {   // the surge climbs your arm
      const H2 = hand(p), sh = at(p.location, -p.getViewDirection().z * 0.38, 1.4, p.getViewDirection().x * 0.38);
      fx(p.dimension, "origin:spark", V.lerp(H2, sh, Math.random()), RGB[k], 1);
      if (t % 4 === 0) { fx(p.dimension, "origin:flare", H2, RGB[k], 1); try { p.playSound("game.player.hurt", { volume: 0.5, pitch: 0.7 }); } catch { } }
      await c.wait(1);
    }
    c.cam(at(p.location, f.x * 2.6, 1.4, f.z * 2.6), at(p.location, 0, 1.3, 0), 0.6, EASE.InOutSine);
    await c.wait(14);
  }, { skippable: false });
  gem(p).sel = `${k}:0`;
  msg(p, `${S.col}§l${S.name} §r§7socketed. ${socketsOf(maskOf(c0.getItem(slot)?.typeId ?? GAUNTLET)).length}/6. §8Its third power is now unlocked.`);
}

// ------------------------------------------------------------------ COMBO effects
const wait = (t) => system.waitTicks(t);
const COMBO_FN = {
  async moonfall(p) {
    const e = look(p, 64), pt = e ? e.location : lookPoint(p, 64) ?? V.add(p.location, V.mul(V.flat(p.getViewDirection()), 16));
    const dim = p.dimension, c = { x: pt.x, y: pt.y, z: pt.z }, sky = at(c, 0, 28, 0);
    shakeNear(dim, c, 64, 0.3, 1.5);
    for (let t = 0; t < 24; t += 2) {
      fx(dim, "origin:flash", sky, t % 4 ? RGB.power : C.white, 1, { size: 5 + t / 3 });
      fx(dim, "origin:boom_smoke", at(sky, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4), C.grey, 1);
      if (t === 12) { sound(dim, "origin.sfx.explode", sky, 0.4, 1); sound(dim, "origin.sfx.thunder", c, 0.7, 1); for (let k = 0; k < 10; k++) fx(dim, "origin:debris", at(sky, (Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6), C.dust, 1); }
      await wait(2);
    }
    for (let k = 0; k < 4; k++) fx(dim, "origin:portal", at(c, (k % 2 ? 5 : -5), 20, (k < 2 ? 5 : -5)), RGB.space, 1, { size: 4 });
    sound(dim, "origin.sfx.portal", c, 0.5, 1);
    for (let i = 0; i < 16 && valid(p); i++) {
      const start = at(c, (Math.random() - 0.5) * 18, 24 + Math.random() * 6, (Math.random() - 0.5) * 18);
      let end = at(c, (Math.random() - 0.5) * 14, 0, (Math.random() - 0.5) * 14);
      try { const top = dim.getTopmostBlock({ x: end.x, z: end.z }); if (top && Math.abs(top.location.y - c.y) < 12) end = { x: end.x, y: top.location.y + 1, z: end.z }; } catch { }
      system.runTimeout(() => {
        for (let k = 0; k <= 6; k++) { const pos = V.lerp(start, end, k / 6); fx(dim, "origin:boom_fire", pos, hexToRgb("#ff8a2a"), 0.7); fx(dim, "origin:missile_smoke", pos, C.grey, 1); }
        fx(dim, "origin:flash", end, hexToRgb("#ff8a2a"), 1, { size: 3 });
        fx(dim, "origin:shockwave", at(end, 0, 0.1, 0), RGB.power, 1, { radius: 3 });
        fx(dim, "origin:debris", end, C.dust, 1);
        sound(dim, "origin.sfx.explode", end, 0.9 + Math.random() * 0.4, 0.8);
        for (const v of living(p, end, 3.2)) { hurt(v, 9, p); const kk = V.flat(V.sub(v.location, end)); try { v.applyKnockback({ x: kk.x * 1.4, z: kk.z * 1.4 }, 0.5); } catch { } }
      }, i * 4);
    }
  },
  async spirit(p) {
    const dim = p.dimension;
    fx(dim, "origin:shockwave", at(p.location, 0, 0.1, 0), RGB.soul, 1, { radius: 24 });
    fx(dim, "origin:shockwave", at(p.location, 0, 0.3, 0), RGB.power, 1, { radius: 18 });
    sound(dim, "origin.sfx.soul", p.location, 0.7, 1);
    let n = 0;
    for (const e of living(p, p.location, 24)) {
      try { e.removeEffect("invisibility"); } catch { }
      const spirit = ["minecraft:vex", "minecraft:phantom", "minecraft:allay", "origin:static_echo", "origin:alter_ego"].includes(e.typeId);
      if (!e.matches?.({ families: ["monster"] }) && !spirit) continue;
      hurt(e, spirit ? 30 : 10, p, EntityDamageCause.magic);
      line(dim, "origin:dot", hand(p), e.getHeadLocation(), n % 2 ? RGB.soul : RGB.power, 0.6, 0.8);
      fx(dim, "origin:flare", e.getHeadLocation(), RGB.soul, 1);
      n++;
    }
    hudMsg(p, `§6${n} found`, 40);
  },
  async snatch(p) {
    const e = look(p, 48);
    if (!e) { hudMsg(p, "§7Look at what you want.", 30); gem(p).cd["combo:snatch"] = 0; return; }
    const f = V.flat(p.getViewDirection());
    portal(p.dimension, at(e.location, 0, 1, 0), f, RGB.space, 1.2);
    try { e.teleport(at(p.location, f.x * 1.7, 0.2, f.z * 1.7), { facingLocation: p.getHeadLocation() }); } catch { }
    portal(p.dimension, at(p.location, f.x * 1.7, 1.1, f.z * 1.7), f, RGB.reality, 1.1);
    freeze(e, 34);
    sound(p.dimension, "origin.sfx.portal", p.location, 1.4, 1);
    await wait(30);
    if (!valid(e) || !valid(p)) return;
    frozen.delete(e.id);
    hurt(e, 12, p);
    fx(e.dimension, "origin:shockwave", at(e.location, 0, 0.1, 0), RGB.reality, 1, { radius: 2.5 });
    sound(e.dimension, "origin.sfx.punch", e.location, 0.8, 1);
    try { e.applyKnockback({ x: f.x * 2.2, z: f.z * 2.2 }, 0.5); } catch { }
  },
  async rewrite(p) {
    for (let wave = 0; wave < 2; wave++) {
      const list = foes(p, p.location, 16);
      for (const e of list) {
        try { e.addEffect("nausea", 160); } catch { }
        fx(e.dimension, "origin:ribbon", e.location, RGB.reality, 0.8);
        const other = list.filter((o) => o.id !== e.id).sort((a, b) => V.dist(a.location, e.location) - V.dist(b.location, e.location))[0];
        if (other) { try { other.applyDamage(5, { cause: EntityDamageCause.entityAttack, damagingEntity: e }); } catch { } line(p.dimension, "origin:dot", e.getHeadLocation(), other.getHeadLocation(), RGB.mind, 0.7, 0.8); }
      }
      if (!wave) { sound(p.dimension, "origin.sfx.reality", p.location, 0.7, 1); hudMsg(p, `§e${list.length} minds rewritten`, 40); }
      await wait(20);
    }
  },
  async undo(p) {
    const n = rewindBlocks(p, p.location, 12);
    let m = 0;
    for (const e of foes(p, p.location, 16)) { if (rewindEntity(p, e, 200)) m++; }
    fx(p.dimension, "origin:rewind", at(p.location, 0, 1.2, 0), RGB.time, 1);
    fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), RGB.time, 1, { radius: 12 });
    fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.3, 0), RGB.reality, 1, { radius: 9 });
    sound(p.dimension, "origin.sfx.lock", p.location, 0.6, 1);
    hudMsg(p, `§a${n} block${n === 1 ? "" : "s"} restored · ${m} enemies rewound`, 50);
  },
  async regenesis(p) {
    const BAD = ["poison", "wither", "weakness", "slowness", "nausea", "blindness", "darkness", "hunger", "mining_fatigue"];
    for (const o of p.dimension.getPlayers({ location: p.location, maxDistance: 16 })) {
      heal(o, 999);
      for (const b of BAD) { try { o.removeEffect(b); } catch { } }
      try { o.extinguishFire(); o.addEffect("regeneration", 200, { amplifier: 1 }); } catch { }
      RT(o).bleedUntil = 0;
      fx(o.dimension, "origin:rise", o.location, RGB.soul, 1);
      fx(o.dimension, "origin:rewind", at(o.location, 0, 1.1, 0), RGB.time, 1);
      if (o.id !== p.id) msg(o, `§6${p.name}'s Gauntlet §7closes every wound you have.`);
    }
    sound(p.dimension, "origin.sfx.soul", p.location, 1.3, 1);
  },
  async beam(p, s) {
    const cols = s.map((k) => RGB[k]);
    sound(p.dimension, "origin.sfx.charge", p.location, 1.1, 1);
    for (let k = 0; k < 6; k++) { if (!valid(p)) return; fx(p.dimension, "origin:flare", hand(p), cols[k % cols.length], 1); fx(p.dimension, "origin:charge", hand(p), cols[k % cols.length], 1); await wait(2); }
    if (!valid(p)) return;
    sound(p.dimension, "origin.sfx.thunder", p.location, 1.2, 0.6);
    shake(p, 0.5, 0.4);
    startBeam(p, "stone", {
      dur: 120, range: 64, from: "hand", style: STYLES.rainbow, cols, dmg: 5, every: 6, hurt, pierce: true, turn: 0.22, hitRadius: 1.1, knock: 0.25, label: "§d§lINFINITY BEAM",
      pulse: { every: 10, radius: 3.5, dmg: 8, crater: 2 }, selfSlow: 3, recoil: 0.18, shake: 0.22,
      sfx: { start: ["origin.sfx.laser", 0.7, 1], loop: ["origin.sfx.power", 16, 0.8, 0.5], end: ["origin.sfx.explode", 0.8, 1] },
      onEnd: (pl, b, why) => {
        if (!b.end || why === "replaced" || !valid(pl)) return;
        const dim = pl.dimension;
        fx(dim, "origin:flash", b.end, C.white, 1, { size: 5 }); fx(dim, "origin:shockwave", b.end, C.white, 1, { radius: 6 });
        for (const e of living(pl, b.end, 5)) hurt(e, 12, pl);
        shakeNear(dim, b.end, 32, 0.6, 0.6);
      },
    });
  },
  async snap(p) {
    const dim = p.dimension;
    await runCine(p, async (c) => {
      const f = V.flat(p.getViewDirection()), base = { ...p.location };
      try { p.playAnimation("animation.origin.gauntlet.raise", { controller: "origin_gauntlet", stopExpression: "0", blendOutTime: 0.3 }); } catch { }
      c.cam(at(base, f.x * 1.6 + f.z * 0.9, 2.1, f.z * 1.6 - f.x * 0.9), at(base, -f.z * 0.4, 2.0, f.x * 0.4));
      await c.wait(6);
      for (let i = 0; i < SK.length; i++) { fx(dim, "origin:flare", at(base, -f.z * 0.4, 2.3, f.x * 0.4), RGB[SK[i]], 1); sound(dim, "origin.sfx.ting", base, 0.7 + i * 0.12, 0.8); await c.wait(3); }
      sound(dim, "origin.sfx.powerup", base, 0.8, 1);
      c.shake(0.5, 1.2);
      await c.wait(12);
      try { p.playAnimation("animation.origin.snap", { controller: "origin_gauntlet", stopExpression: "0", blendOutTime: 0.3 }); } catch { }
      sound(dim, "origin.sfx.awaken", base, 1, 1);
      sound(dim, "origin.sfx.thunder", base, 1, 0.8);
      c.fade(0, 0.4, 1.4, { red: 1, green: 0.96, blue: 0.88 });
      c.say("§f§l* snap *", 30);
      await c.wait(30);
      c.fade(0.4, 1.4, 0.9, { red: 0.95, green: 0.55, blue: 0.2 });
      sound(dim, "origin.sfx.wind", base, 0.6, 0.7);
      c.say("§6§oa quiet, orange place...", 34);
      await c.wait(40);
    }, { skippable: false });
    if (!valid(p)) return;
    const all = foes(p, p.location, 128).sort(() => Math.random() - 0.5);
    const half = all.slice(0, Math.ceil(all.length / 2));
    let n = 0;
    for (const e of half) {
      if (BOSS.has(e.typeId)) { hurt(e, 40, p, EntityDamageCause.magic); continue; }
      system.runTimeout(() => { if (!valid(e)) return; for (let k = 0; k < 3; k++) fx(e.dimension, "origin:dust_away", at(e.location, 0, 0.3 + k * 0.5, 0), hexToRgb("#8a7b6a"), 1); try { e.remove(); } catch { } }, 20 + Math.floor(Math.random() * 80));
      n++;
    }
    try { const hc = p.getComponent("minecraft:health"); p.applyDamage(Math.min(10, Math.max(0, hc.currentValue - 1)), { cause: EntityDamageCause.magic }); } catch { }
    try { p.addEffect("wither", 400, { amplifier: 0 }); p.addEffect("weakness", 2400, { amplifier: 1 }); p.addEffect("slowness", 200, { amplifier: 1 }); } catch { }
    msg(p, `§f${n} of ${all.length} hostiles within 128 blocks turn to dust. §8Your arm is burned. The Gauntlet is scorched for 10 minutes.`);
  },
};

// ------------------------------------------------------------------ HUD + events
export function gauntletFlags(p) {
  const h = held(p);
  if (!h) return "";
  let f = "origin_gauntlet";
  if (h.stone) {
    const i = SK.indexOf(h.stone);
    f += `origin_gs${i}_origin_ga${i}_origin_gm${pad(i * 3)}_origin_gn${pad(i * 3 + 1)}_`;
    if (cdLeft(p, `${h.stone}:0`) > 0) f += "origin_gcd_";
    return f;
  }
  f += "origin_gw_";
  for (const k of socketsOf(h.mask)) f += `origin_gs${SK.indexOf(k)}_`;
  const sel = selOf(p, h.mask);
  if (sel) {
    f += `origin_gm${pad(ABIL.indexOf(sel.key))}_`;
    if (sel.stone) f += `origin_ga${SK.indexOf(sel.stone)}_`;
    if (cdLeft(p, sel.key) > 0) f += "origin_gcd_";
  }
  return f;
}
export const gauntletLine = () => null;
export function onStoneMelee(p, target) {
  if (!valid(target)) return;
  const g = gem(p);
  if ((g.fistUntil ?? 0) > now() && hasActive(p, "power")) {
    g.fistUntil = 0;
    hurt(target, 20, p);
    for (const e of living(p, target.location, 4)) if (e.id !== target.id) hurt(e, 8, p);
    const k = V.flat(V.sub(target.location, p.location));
    try { target.applyKnockback({ x: k.x * 3.6, z: k.z * 3.6 }, 0.8); } catch { }
    fx(p.dimension, "origin:flash", target.getHeadLocation(), RGB.power, 1, { size: 3 });
    fx(p.dimension, "origin:shockwave", at(target.location, 0, 0.1, 0), RGB.power, 1, { radius: 4 });
    fx(p.dimension, "origin:debris", target.location, C.dust, 1);
    sound(p.dimension, "origin.sfx.explode", target.location, 1.1, 0.8);
    sound(p.dimension, "origin.sfx.punch", target.location, 0.8, 1);
    shake(p, 0.5, 0.3);
  }
  if (hasActive(p, "soul")) heal(p, 1.5);
}
export function onStoneHurtBefore(ev) {
  const e = ev.hurtEntity;
  if (e?.typeId !== "minecraft:player") return false;
  const g = RT(e).gem, cause = String(ev.damageSource?.cause ?? "");
  const cancel = () => { ev.cancel = true; return true; };
  if (cause === "fall" && hasActive(e, "space")) return cancel();
  if (g?.loop && g.loop.until > now()) {
    let hp = 20;
    try { hp = e.getComponent("minecraft:health").currentValue; } catch { }
    if (ev.damage >= hp) { const L = g.loop; g.loop = null; system.run(() => loopBack(e, L)); return cancel(); }
  }
  if (hasActive(e, "reality") && cause !== "void" && Math.random() < 0.15) { system.run(() => valid(e) && fx(e.dimension, "origin:ribbon", e.location, RGB.reality, 0.7)); return cancel(); }
  return false;
}
function loopBack(p, L) {
  if (!valid(p)) return;
  try { p.teleport(L.loc, { dimension: world.getDimension(L.dim), rotation: L.rot }); } catch { }
  try { const hc = p.getComponent("minecraft:health"); hc.setCurrentValue(Math.max(4, L.hp)); } catch { }
  try { for (const f of p.getEffects()) p.removeEffect(f.typeId); } catch { }
  for (const [id, amp, dur] of L.fxs ?? []) { try { p.addEffect(id, Math.max(1, dur), { amplifier: amp, showParticles: false }); } catch { } }
  try { p.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0.2, fadeOutTime: 0.8 }, fadeColor: { red: 0.1, green: 0.6, blue: 0.3 } }); } catch { }
  fx(p.dimension, "origin:rewind", at(p.location, 0, 1.1, 0), RGB.time, 1);
  psound(p, "origin.sfx.lock", 0.6, 1);
  try { p.onScreenDisplay.setTitle("§a§lTIME LOOP", { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10, subtitle: "§7that never happened" }); RT(p).titleUntil = now() + 42; } catch { }
}
export function onStoneHurtAfter(e, amount, src) {
  if (!valid(e) || !(amount > 0)) return;
  const b = binds.get(e.id);
  if (!b || b.until < now() || (shareGuard.get(e.id) ?? -1) >= now()) return;
  for (const id of b.ids) {
    if (id === e.id) continue;
    let o; try { o = world.getEntity(id); } catch { }
    if (!valid(o)) continue;
    shareGuard.set(id, now() + 1);
    hurt(o, Math.max(1, amount * 0.6), valid(b.by) ? b.by : undefined, EntityDamageCause.magic);
    line(e.dimension, "origin:dot", e.getHeadLocation(), o.getHeadLocation(), RGB.soul, 0.6, 0.6);
  }
}
export function onStoneKill(killer, dead) {
  if (!dead) return;
  const u = unravel.get(dead.id);
  if (u) { unravel.delete(dead.id); try { fx(dead.dimension, "origin:ribbon", dead.location, RGB.reality, 1); fx(dead.dimension, "origin:shards", at(dead.location, 0, 0.8, 0), RGB.reality, 1); } catch { } }
  if (killer?.typeId !== "minecraft:player" || !hasActive(killer, "soul")) return;
  const g = gem(killer);
  if (g.souls >= 6) return;
  g.souls++;
  try { line(killer.dimension, "origin:dot", at(dead.location, 0, 1, 0), killer.getHeadLocation(), RGB.soul, 0.5, 0.8); } catch { }
  hudMsg(killer, `§6Soul taken §7(${g.souls}/6)`, 30);
}

// every 2 ticks
export function tickStones() {
  const t = now();
  for (const [id, f] of frozen) {
    if (!valid(f.e) || f.until < t) { frozen.delete(id); continue; }
    try { f.e.teleport(f.pos, { rotation: f.rot }); } catch { }
    if (t % 10 === 0) fx(f.e.dimension, "origin:rewind", at(f.e.location, 0, 1.2, 0), RGB.time, 0.5);
  }
  for (let i = dots.length - 1; i >= 0; i--) {
    const d = dots[i];
    if (!valid(d.e) || d.n <= 0) { dots.splice(i, 1); continue; }
    if (t % 4 === 0 && d.fxId) fx(d.e.dimension, d.fxId, d.e.location, d.col, 0.7);
    if (t < d.next) continue;
    d.next = t + 20; d.n--;
    hurt(d.e, d.dmg, valid(d.by) ? d.by : undefined, EntityDamageCause.magic);
  }
  for (let i = cages.length - 1; i >= 0; i--) {
    const cg = cages[i];
    if (cg.until > t) continue;
    for (const l of cg.placed) { try { const b = cg.dim.getBlock(l); if (b && (b.typeId === "minecraft:red_nether_bricks" || b.typeId === "minecraft:crying_obsidian")) b.setType("minecraft:air"); } catch { } }
    fx(cg.dim, "origin:ribbon", cg.placed[0] ?? { x: 0, y: 0, z: 0 }, RGB.reality, 0.6);
    cages.splice(i, 1);
  }
  for (let i = gates.length - 1; i >= 0; i--) {
    const G = gates[i];
    if (G.until < t) { gates.splice(i, 1); continue; }
    if (t % 4 === 0) { portal(G.dim, G.a, G.f, RGB.space, 1.1); portal(G.dim, G.b, G.f, RGB.space, 1.1); }
    for (const [from, to] of [[G.a, G.b], [G.b, G.a]]) {
      let list = [];
      try { list = G.dim.getEntities({ location: from, maxDistance: 1.4 }); } catch { }
      for (const e of list) {
        if ((G.cool.get(e.id) ?? 0) > t || e.typeId.startsWith("origin:exo") || e.typeId === "origin:float_text") continue;
        G.cool.set(e.id, t + 30);
        try { e.teleport(at(to, G.f.x * 0.9, -0.9, G.f.z * 0.9), { keepVelocity: true }); } catch { }
        sound(G.dim, "origin.sfx.portal", to, 1.6, 0.4);
      }
    }
  }
  for (let i = wisps.length - 1; i >= 0; i--) {
    const w = wisps[i];
    if (!valid(w.by) || ++w.t > 120) { wisps.splice(i, 1); continue; }
    if (!valid(w.tgt)) { w.tgt = foes(w.by, w.pos, 18).sort((a, b) => V.dist(a.location, w.pos) - V.dist(b.location, w.pos))[0] ?? null; if (!w.tgt) { if (w.t > 20) { fx(w.by.dimension, "origin:sparkle", w.pos, RGB.soul, 1); wisps.splice(i, 1); } continue; } }
    const to = w.tgt.getHeadLocation(), d = V.sub(to, w.pos), dist = V.len(d);
    w.pos = dist < 1.0 ? to : V.add(w.pos, V.mul(d, 1.1 / dist));
    fx(w.by.dimension, "origin:wisp", w.pos, RGB.soul, 1);
    if (dist < 1.0) { hurt(w.tgt, 7, w.by, EntityDamageCause.magic); fx(w.by.dimension, "origin:flare", to, RGB.soul, 1); sound(w.by.dimension, "origin.sfx.soul", to, 1.5, 0.5); wisps.splice(i, 1); }
  }
  for (const [id, th] of thralls) {
    if (!valid(th.e) || th.until < t) { thralls.delete(id); continue; }
    if (t % 6 === 0) fx(th.e.dimension, "origin:sparkle", th.e.getHeadLocation(), RGB.mind, 1);
    if (t < th.next) continue;
    th.next = t + 24;
    const tgt = foes(th.by, th.e.location, 12).filter((o) => o.id !== th.e.id && !thralls.has(o.id)).sort((a, b) => V.dist(a.location, th.e.location) - V.dist(b.location, th.e.location))[0];
    if (!tgt) continue;
    const k = V.flat(V.sub(tgt.location, th.e.location));
    try { th.e.teleport(at(tgt.location, -k.x * 1.2, 0, -k.z * 1.2), { facingLocation: tgt.getHeadLocation() }); } catch { }
    try { tgt.applyDamage(6, { cause: EntityDamageCause.entityAttack, damagingEntity: th.e }); } catch { }
    line(th.e.dimension, "origin:dot", th.e.getHeadLocation(), tgt.getHeadLocation(), RGB.mind, 0.6, 0.6);
  }
  for (const [id, b] of binds) {
    if (b.until < t) { binds.delete(id); continue; }
    if (t % 10 === 0 && b.ids[0] === id) {
      const es = b.ids.map((x) => { try { return world.getEntity(x); } catch { return null; } }).filter(valid);
      for (let k = 1; k < es.length; k++) line(es[k].dimension, "origin:dot", es[k - 1].getHeadLocation(), es[k].getHeadLocation(), RGB.soul, 0.5, 0.5);
    }
  }
  for (const [id, s] of shareGuard) if (s < t - 2) shareGuard.delete(id);
  for (const [id, u] of unravel) if (u.until < t) unravel.delete(id);
  for (const p of world.getAllPlayers()) {
    const g = p.__noop ? null : RT(p).gem;
    if (!g) continue;
    if ((g.bubbleUntil ?? 0) > t) {
      if (t % 6 === 0) fx(p.dimension, "origin:bubble", at(p.location, 0, 1, 0), RGB.reality, 0.5);
      try { for (const e of p.dimension.getEntities({ location: p.location, maxDistance: 6 })) if (PROJ.has(e.typeId)) { fx(e.dimension, "origin:bubble", e.location, RGB.reality, 1); sound(e.dimension, "random.pop", e.location, 1.4, 0.6); e.remove(); } } catch { }
    }
    if ((g.fistUntil ?? 0) > t && t % 4 === 0) fx(p.dimension, "origin:missile_glow", hand(p), RGB.power, 0.8);
    if (g.scan && g.scan.until > t && t % 8 === 0) {
      const m = new MolangVariableMap();
      m.setColorRGBA("variable.color", { red: RGB.mind.red, green: RGB.mind.green, blue: RGB.mind.blue, alpha: 1 });
      m.setFloat("variable.size", 1.2);
      try { for (const e of p.dimension.getEntities({ location: p.location, maxDistance: 64, excludeTypes: NOPE })) if (e.id !== p.id) p.spawnParticle("origin:hud_ring", at(e.location, 0, 0.9, 0), m); } catch { }
    }
  }
}
// every 20 ticks: what the stones give you just by holding them
export function tickStoneFlags() {
  for (const p of world.getAllPlayers()) {
    const r = RT(p), h = held(p);
    let time = count(p, STONES.time.id) > 0;
    if (!time && h && !h.stone) time = socketsOf(h.mask).includes("time");
    r.timeHolder = time || h?.stone === "time";
    const ks = activeStones(p), gl = !!h && !h.stone;
    const eff = (id, amp, d = 40) => { try { p.addEffect(id, d, { amplifier: amp, showParticles: false }); } catch { } };
    if (ks.includes("power")) eff("strength", gl ? 1 : 0);
    if (ks.includes("space")) eff("jump_boost", 0);
    if (ks.includes("time")) eff("haste", gl ? 1 : 0);
    if (ks.includes("reality")) eff("resistance", 0);
    if (ks.includes("mind")) { eff("night_vision", 0, 400); r.gemNv = true; }
    else if (r.gemNv) { r.gemNv = false; try { p.removeEffect("night_vision"); } catch { } }
    if (gl && ks.length === 6) { eff("regeneration", 0); eff("resistance", 1); for (const k of SK) fx(p.dimension, "origin:sparkle", at(p.location, (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2), RGB[k], 1); }
  }
}
// testing helper
export function fullGauntlet() { return new ItemStack(idOf(63), 1); }
