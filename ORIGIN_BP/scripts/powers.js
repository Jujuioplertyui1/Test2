import { laserLine, laserImpact } from "./slashfx.js";
import { destructionOn } from "./impact.js";
// ORIGIN v0.05 - powers.js
// Signature superpowers. When you awaken, you get ONE power at random from your origin's pool,
// so two Physical heroes can play completely differently. Used with the Power Core item
// (use = power, sneak + use = Power menu). Villains (villain.js) use the same powers against you.
//   Physical: Stretch, Flight
//   Matter:   Blast, Sentry (Banish + Alter Ego)
//   Shadow:   Shadow Step, Shade Form, Tendrils
import { world, system, EntityDamageCause, InputButton, ButtonState, EquipmentSlot, EntitySwingSource } from "@minecraft/server";
import { hero, RT, markDirty, saveNow, maxEnergy, combat, ICON, BAR, bar, ARCH } from "./data.js";
import { V, at, valid, fx, line, sound, psound, C, now, hexToRgb, rightOf, health, cmd, msg, FX_IDS } from "./util.js";
import { DIM_ID, VOID_ROOM, VOID_CELLS, VOID_CELL_SPACING } from "./plan.js";
import { hudMsg } from "./voice.js";
import { popNumber } from "./combat.js";
import { addDread } from "./dread.js";
import { SUIT, PART_KEYS, suitOf, makePiece } from "./suit.js";
import { oform, show, ICONS } from "./forms.js";
import { startFlight, stopFlight, isFlying } from "./flight.js";
import { useMirror, mirrorReady } from "./mirror.js";
import { PHYS, runAlt, physLine } from "./physical.js";
import { startBeam, stopBeam, beamActive, STYLES } from "./beams.js";
import { P2_DEFS, useP2, p2Bypass, runAlt2, p2Line } from "./powers2.js";
import { ACT3, applyP3, runAlt3, p3Line, voidDrag } from "./powers3.js";

const RED = hexToRgb("#ff3b2f"), TAN = hexToRgb("#e8b48a"), VOIDC = hexToRgb("#5a2a8a"), SHADE = hexToRgb("#2a1640"), GOLD = hexToRgb("#ffd36a");

// ------------------------------------------------------------------ the powers (balance lives here)
// cost = Energy, cd = cooldown in ticks (20 = 1s). Toggles start their cooldown when they END.
export const POWERS = {
  stretch: {
    arch: "brawler", name: "Stretch", icon: "§6", cost: 12, cd: 80,
    desc: "Your body stretches like rubber. Your punches reach up to 8 blocks. Use the Power Core to GRAB: yank whoever you're looking at to you, or grab a block and sling yourself to it.",
    stats: ["Long punch: 4 dmg, up to 8 blocks, 3 Energy", "Grab: 6 dmg + yank / sling, 14 blocks", "Grab: 12 Energy, 4s cooldown"],
  },
  flight: {
    arch: "brawler", name: "Flight", icon: "§6", cost: 15, cd: 240, toggle: true, maxAir: 400,
    desc: "Real flight. Push forward to fly where you look, strafe to bank, jump climbs, sneak dives, let go to hover. Sprint or double-tap forward to BOOST. Double-tap jump in the air to take off or land.",
    stats: ["Up to 20s in the air, 1 Energy/s (boost 3/s)", "Take-off: 15 Energy · no fall damage when you land", "12s cooldown after you land"],
  },
  blast: {
    arch: "energy", name: "Blast", icon: "§c", cost: 10, cd: 300, dur: 140,
    desc: "Seven seconds of eye beams. They follow your gaze and burn through everything in the line - sand melts to glass, wood catches fire, and whatever they touch lights up. Use again to stop.",
    stats: ["3 dmg every 0.4s to everything in the line", "32 blocks · 10 Energy to start, then 2 a second", "15s cooldown · use again to stop early"],
  },
  sentry: {
    arch: "energy", name: "Sentry", icon: "§e", cost: 35, cd: 900,
    desc: "The Void answers you. BANISH (use): send whoever you're looking at - mob or player - into the Void for 6 seconds. VOID SHELL (automatic): when your health drops low or a hit would kill you, the Void swallows it and throws everything back.",
    stats: ["Banish: 12 blocks, 6s, 35 Energy, 45s cooldown", "Void Shell: below 30% HP or a killing blow, 4s, every 2 min", "(The Alter Ego is an item now: Shard of the Other)"],
  },
  shadow_step: {
    arch: "shadow", name: "Shadow Step", icon: "§8", cost: 10, cd: 50,
    desc: "Step from shadow to shadow. Into darkness: up to 24 blocks, cheap and quick. Into light: only 10 blocks, double cost, longer cooldown. Look at someone to land right behind them - your next hit within 2s deals +4.",
    stats: ["Dark: 24 blocks, 10 Energy, 2.5s cooldown", "Light: 10 blocks, 20 Energy, 5s cooldown", "Dark = light level 7 or less"],
  },
  shade_form: {
    arch: "shadow", name: "Shade Form", icon: "§8", cost: 10, cd: 60, toggle: true,
    desc: "Melt into the dark. While you stand in shadow you're invisible, fast and harder to hurt. Step into light and you're exposed (visible, drains 4x faster). Your first hit from hiding deals +6 and ends the form.",
    stats: ["Hidden: 1.5 Energy/s", "Exposed in light: 6 Energy/s, no invisibility", "3s cooldown after it ends"],
  },
  tendrils: {
    arch: "shadow", name: "Tendrils", icon: "§5", cost: 24, cd: 200,
    desc: "Shadows erupt where you look: everything within 3 blocks takes 5 damage and is pinned in place.",
    stats: ["5 dmg, radius 3, pinned for 3.5s", "16 blocks", "24 Energy, 10s cooldown"],
  },
  mirror_hour: {
    arch: "energy", name: "Mirror Hour", icon: "§6", cost: 30, cd: 60,
    desc: "Once per fight, rewind ONE thing - a creature, a person, a wound, or the blocks where you look - to exactly how it was 60 seconds ago. Everything else stays as it is. The target remembers everything, and whatever it did in that minute still happened to everyone else.",
    stats: ["Use: rewind what you look at (creature, else blocks), else your worst wound", "Sneak + use: choose - yourself, a wound, a target, or blocks", "Once per fight, 30 Energy. Something that didn't exist a minute ago... stops existing"],
  },
  titan_grip: {
    arch: "brawler", name: "Titan Grip", icon: "§6", cost: 18, cd: 140,
    desc: "Grab whatever's in front of you, hoist it overhead, and throw it. It hits the ground hard - and so does anything it lands on.",
    stats: ["Grab range 6 · 5 damage on the grab, 8 when it lands", "Thrown about 10 blocks", "18 Energy, 7s cooldown"],
  },
  arc_storm: {
    arch: "energy", name: "Arc Storm", icon: "§b", cost: 22, cd: 120,
    desc: "Lightning leaves your hand, hits your target and jumps from enemy to enemy - five links, each a little weaker.",
    stats: ["9 / 7 / 5 / 4 / 3 damage", "First target up to 20 blocks, then jumps up to 8 blocks", "22 Energy, 6s cooldown"],
  },
  umbral_clones: {
    arch: "shadow", name: "Umbral Clones", icon: "§8", cost: 24, cd: 260,
    desc: "Your shadow splits off and hunts: for six seconds, copies of you step out of the dark behind enemies and strike.",
    stats: ["6 strikes, 5 damage each", "Hunts within 12 blocks", "24 Energy, 13s cooldown"],
  },
  super_speed: {
    arch: "brawler", name: "Super Speed", icon: "§b", cost: 0, cd: 10,
    desc: "Turn on Speedster mode and sprint: the world slows to a crawl around you. You weave around trees, hop ledges and run across water instead of sinking. Arrows come at you in slow motion - and you sidestep most of them.",
    stats: ["Use: Speedster on/off (drains 1 Energy a second while running)", "Sneak + use: Blitz - hit up to 8 enemies in a blink, the last one goes flying", "Fall damage from your own hops never lands"],
    alts: [{ label: "Blitz", sub: "up to 8 enemies, one blink each", icon: "x_up_thrusters", act: "blitz" }],
  },
  super_strength: {
    arch: "brawler", name: "Super Strength", icon: "§6", cost: 0, cd: 10,
    desc: "Look at a tree and use: you rip it out by the roots and throw it. Stone gives you a boulder; a creature gets thrown bodily. Your punches hit twice as hard. Haymaker: the victim sees your fist coming in first person - then white, then black. Punch a guarding player and their guard shatters the same way.",
    stats: ["Use: uproot a tree / rip a boulder / lift a creature - use again to throw (nothing in reach: ground pound)", "Sneak + use: arm a Haymaker (sends people through trees and hillsides)", "+4 damage and double knockback on empty-hand punches"],
    alts: [{ label: "Haymaker", sub: "your next punch, with a cutscene", icon: "x_target", act: "haymaker" }],
  },
  super_durability: {
    arch: "brawler", name: "Super Durability", icon: "§7", cost: 0, cd: 10,
    desc: "Kinetic Skin: arrows and bullets ping off you, punches hurt the puncher, and when you fall you crater the ground instead of breaking. You take half of everything - the other half is stored as force. Use: Retaliation releases it all in one shockwave.",
    stats: ["Use: Retaliation (needs 10+ stored force; 50+ sends them flying)", "Sneak + use: Unstoppable - 8s of plowing through mobs, leaves, glass and wood", "Projectiles: 0 damage. Falls: 0 damage. Everything else: halved"],
    alts: [{ label: "Unstoppable", sub: "8s: sprint through anything", icon: "x_up_plating", act: "unstoppable" }],
  },
  regeneration: {
    arch: "brawler", name: "Regeneration", icon: "§c", cost: 35, cd: 1200,
    desc: "A healing factor you can watch. Hits tear you open right where they land - down to the bone on the worst, burned black by beams and fire - and every wound knits shut in front of you. Stand in a beam and it strips you to the muscle... and you grow back the moment it stops. Bullets push themselves out. Lost arms grow back. Use: Rapid Regeneration - your body rebuilds itself from the bone out. Once every three minutes, a killing blow fails: you drop as a skeleton and get back up.",
    stats: ["Use: Rapid Regeneration - skeleton, sinew, muscle, skin: full heal, cleansed, arms regrown (60s)", "Passive: wounds close on their own, a healing surge below 30% health, poison and wither don't stick, a lost arm regrows in 15s", "Once every 3 minutes: survive a killing blow"],
  },
};
Object.assign(POWERS, P2_DEFS);   // Web Slinger, Telekinesis, Pyrokinesis, Cryokinesis, Blood Manipulation, Graviton (powers2.js)
applyP3(POWERS);                  // v0.22: new moves for every power, and Hellfire (powers3.js)
export const POOLS = {
  brawler: ["stretch", "flight", "titan_grip", "super_speed", "super_strength", "super_durability", "regeneration", "web_slinger"],
  energy: ["blast", "sentry", "mirror_hour", "arc_storm", "telekinesis", "pyrokinesis", "cryokinesis"],
  shadow: ["shadow_step", "shade_form", "tendrils", "umbral_clones", "blood_manipulation", "graviton", "hellfire"],
};
export const POWER_KEYS = Object.keys(POWERS);

export function rollPower(player, force) {
  const h = hero(player);
  const pool = POOLS[h.arch] ?? POOLS.brawler;
  h.power = force && POWERS[force] ? force : pool[Math.floor(Math.random() * pool.length)];
  markDirty(player);
  return h.power;
}
export function powerOf(player) {
  const h = hero(player);
  return h.power && POWERS[h.power] ? POWERS[h.power] : null;
}

// ------------------------------------------------------------------ light (Shadow powers care about it)
// Effective light 0-15. Works whether or not getLightLevel already includes night-time darkening.
export function lightAt(dim, loc) {
  try {
    const p = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };
    const total = dim.getLightLevel(p);
    const sky = dim.getSkyLightLevel(p);
    if (total > sky) return total;                       // a torch / lamp is the brightest thing here
    const tod = world.getTimeOfDay();
    const night = tod > 13000 && tod < 23000;
    return Math.min(total, night ? Math.max(0, sky - 11) : sky);
  } catch { return 15; }
}
export const isDark = (dim, loc) => lightAt(dim, loc) <= 7;

// ------------------------------------------------------------------ helpers
export const NO_HIT = [...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "origin:manifestation", "origin:archetype_orb", "origin:float_text", "origin:static_echo", "origin:lumen_construct", "origin:exo_piece", "origin:exo_drone"];
function lookTarget(p, range) {
  try {
    const hits = p.getEntitiesFromViewDirection({ maxDistance: range })
      .filter((h) => h.entity.id !== p.id && !NO_HIT.includes(h.entity.typeId) && valid(h.entity));
    return hits[0]?.entity ?? null;
  } catch { return null; }
}
function lookBlock(p, range) {
  try {
    const hit = p.getBlockFromViewDirection({ maxDistance: range, includePassableBlocks: false });
    if (!hit) return null;
    return { block: hit.block, point: V.add(hit.block.location, hit.faceLocation), face: hit.face };
  } catch { return null; }
}
export function dmg(target, amount, by) {
  try { target.applyDamage(amount, { cause: EntityDamageCause.entityAttack, damagingEntity: by }); } catch { }
  try { popNumber(target.dimension, target.getHeadLocation(), `§d${Math.round(amount)}`); } catch { }
  if (by?.typeId === "minecraft:player") { combat(by); addDread(by, 2); }
}
const PASSABLE = /(^|_)(grass|fern|flower|torch|vine|vines|carpet|sapling|button|rail|lever|sign|dandelion|poppy|tulip|orchid|allium|bluet|daisy|cornflower|lily|bush|mushroom|sugar_cane|kelp|seagrass|wheat|carrots|potatoes|beetroot|snow_layer|deadbush|dead_bush|roots|sprouts|petals|leaf_litter)$/;
function airAt(dim, loc) {
  try {
    const b = dim.getBlock(loc);
    if (!b || b.isAir || b.isLiquid) return true;
    const id = b.typeId.replace("minecraft:", "");
    return id !== "grass_block" && PASSABLE.test(id);
  } catch { return true; }
}
// nudge a destination up until feet + head are free
function safeSpot(dim, loc) {
  for (let dy = 0; dy <= 3; dy++) {
    const l = { x: loc.x, y: Math.floor(loc.y) + dy, z: loc.z };
    if (airAt(dim, l) && airAt(dim, at(l, 0, 1, 0))) return l;
  }
  return null;
}
function hpLine(e) {
  const hp = health(e);
  return hp ? Math.ceil(hp.cur) : "?";
}

// ------------------------------------------------------------------ use (Power Core)
export function usePower(p) {
  const h = hero(p);
  const r = RT(p);
  if (!h.awakened) { hudMsg(p, "§7The core is cold. §8(Awaken first.)"); return; }
  if (!h.power || !POWERS[h.power]) rollPower(p);
  const P = POWERS[h.power];
  if (r.cine || r.station || r.traveling || r.staticLock || r.caged) return;
  const t = now();
  if (h.power === "flight" && isFlying(p)) return stopFlight(p, "land");
  if (P.toggle && r.powerOn) return toggleOff(p, h.power);   // landing / leaving shade form is free
  if (h.power === "blast" && beamActive(p, "eyes")) { stopBeam(p, "cut"); return; }   // use again: cut the beams
  if (P2_DEFS[h.power] && p2Bypass(p, h.power)) return;   // let go of a web, throw what you hold, cut a beam
  const followUp = h.power === "shadow_step" && (r.stepChain ?? 0) > t;   // the quick second step skips the cooldown
  if (!followUp && (r.powerCd ?? 0) > t) { hudMsg(p, `§7${P.name} recharging... §c${(((r.powerCd ?? 0) - t) / 20).toFixed(1)}s`, 20); return; }
  if (h.energy < P.cost) { hudMsg(p, `§bNot enough Energy for ${P.name} §7(${P.cost})`, 30); psound(p, "random.fizz", 1.5, 0.5); return; }
  const res = P2_DEFS[h.power] ? useP2(p, h.power) : (ACT3[h.power] ?? ACT[h.power])?.(p, h, r);
  if (res === false) return;
  h.energy -= res?.cost ?? P.cost;
  r.powerCd = t + (res?.cd ?? P.cd);
  h.stats.casts = (h.stats.casts ?? 0) + 1;
  markDirty(p);
}

const ACT = {
  // GRAB: yank a target in, or sling yourself to a block
  stretch(p) {
    const head = p.getHeadLocation();
    const e = lookTarget(p, 14);
    if (e) {
      line(p.dimension, "origin:trail", at(head, 0, -0.4, 0), e.getHeadLocation(), TAN, 0.35, 1);
      fx(p.dimension, "origin:impact", e.getHeadLocation(), TAN, 1, { size: 1.2 });
      sound(p.dimension, "mob.slime.big", head, 1.6, 0.9);
      sound(p.dimension, "origin.sfx.swoosh", head, 1.1, 0.7);
      dmg(e, 6, p);
      const d = V.flat(V.sub(p.location, e.location));
      const dist = V.hdist(p.location, e.location);
      stretchArm(p, dist);
      try { e.applyKnockback({ x: d.x * Math.min(2.4, 0.4 + dist * 0.18), z: d.z * Math.min(2.4, 0.4 + dist * 0.18) }, 0.35); } catch { }
      return true;
    }
    const b = lookBlock(p, 14);
    if (b) stretchArm(p, 12);
    if (!b) { hudMsg(p, "§7Nothing to grab.", 20); return false; }
    line(p.dimension, "origin:trail", at(head, 0, -0.4, 0), b.point, TAN, 0.35, 1);
    sound(p.dimension, "mob.slime.big", head, 1.3, 0.9);
    const d = V.sub(b.point, p.location);
    const dist = Math.hypot(d.x, d.z);
    const flat = V.flat(d);
    try {
      p.applyKnockback({ x: flat.x * Math.min(3.2, 0.6 + dist * 0.22), z: flat.z * Math.min(3.2, 0.6 + dist * 0.22) }, Math.max(0.4, Math.min(1.4, 0.45 + d.y * 0.12)));
      p.addEffect("slow_falling", 40, { showParticles: false });
    } catch { }
    return true;
  },
  flight(p, h, r) {
    return beginFlight(p) ? true : false;
  },
  blast(p, h, r) {
    startBeam(p, "eyes", {
      dur: POWERS.blast.dur, range: 32, from: "eyes", style: STYLES.laser, dmg: 3, every: 8, hurt: dmg, pierce: true, turn: 0.55, hitRadius: 0.45, label: "§c§lLASER EYES",
      perSec: (pl) => { const hh = hero(pl); if ((hh.energy ?? 0) < 2) { hudMsg(pl, "§7Out of Energy - the beams die.", 30); return false; } hh.energy -= 2; markDirty(pl); return true; },
      sfx: { start: ["origin.sfx.laser", 1.25, 0.8], loop: ["mob.guardian.attack_loop", 6, 2, 0.25], end: ["random.fizz", 1.6, 0.4] },
    });
    sound(p.dimension, "mob.guardian.attack_loop", p.location, 1.6, 0.8);
    return true;
  },
  sentry(p) {
    const e = lookTarget(p, 12);
    if (!e) { hudMsg(p, "§7Look at someone to Banish them.", 20); return false; }
    try { p.playAnimation("animation.origin.pose.point", { controller: "origin_p3", stopExpression: "0", blendOutTime: 0.15 }); } catch { }
    const ok = banish(p, e, 120);
    if (!ok) { hudMsg(p, "§7The Void won't open right now.", 30); return false; }
    if (ok === "immune") msg(p, `§5It's too big for the Void. It tears at it instead.`);
    else msg(p, `§5${e.typeId === "minecraft:player" ? e.name : niceName(e)} is in the Void for 6 seconds.`);
    return true;
  },
  shadow_step(p, h) {
    const head = p.getHeadLocation();
    const dir = p.getViewDirection();
    const dim = p.dimension;
    const e = lookTarget(p, 24);
    let dest, facing;
    if (e) {
      const f = V.flat(V.sub(e.location, p.location));
      dest = at(e.location, f.x * 1.4, 0, f.z * 1.4);
      facing = e.getHeadLocation();
    } else {
      const b = lookBlock(p, 24);
      if (b && b.face === "Up") dest = at(b.block.location, 0.5, 1, 0.5);
      else {
        const d = b ? Math.max(0, V.dist(head, b.point) - 0.8) : 24;
        dest = V.add(head, V.mul(dir, d));
        dest.y -= 1.2;
      }
    }
    const dark = isDark(dim, at(dest, 0, 1, 0));
    const dist = V.dist(p.location, dest);
    if (!dark) {
      if (dist > 10) {
        // too far to cross in the light: shorten the step
        if (e) { hudMsg(p, "§eToo bright over there. §7(Light steps reach 10 blocks; dark ones 24.)", 40); return false; }
        dest = V.add(p.location, V.mul(V.norm(V.sub(dest, p.location)), 10));
      }
      if (h.energy < 20) { hudMsg(p, "§bNot enough Energy for a step into the light §7(20)", 30); return false; }
    }
    const spot = safeSpot(dim, dest);
    if (!spot) { hudMsg(p, "§7No room to step there.", 20); return false; }
    fx(dim, "origin:void_swirl", at(p.location, 0, 1, 0), SHADE, 1);
    line(dim, "origin:dot", at(p.location, 0, 1, 0), at(spot, 0, 1, 0), SHADE, 1.2, 0.8);
    try {
      p.teleport(spot, facing ? { facingLocation: facing } : { rotation: p.getRotation() });
      p.addEffect("invisibility", 30, { showParticles: false });
    } catch { return false; }
    fx(dim, "origin:void_swirl", at(spot, 0, 1, 0), SHADE, 1);
    sound(dim, "mob.endermen.portal", spot, 0.7, 0.8);
    if (e) RT(p).ambushUntil = now() + 40;
    if (!dark) hudMsg(p, "§eStepped through the light. §7(costs more)", 30);
    return dark ? { cost: 10, cd: 50 } : { cost: 20, cd: 100 };
  },
  mirror_hour(p) {
    if (!useMirror(p, "auto")) return false;
    try { p.playAnimation("animation.origin.pose.rewind", { controller: "origin_p3", stopExpression: "0", blendOutTime: 0.15 }); } catch { }
    system.runTimeout(() => { try { p.playAnimation("animation.origin.clear", { controller: "origin_p3", stopExpression: "1", blendOutTime: 0.3 }); } catch { } }, 24);
    return true;
  },
  super_speed(p) { return PHYS.speed(p); },
  super_strength(p) { return PHYS.strength(p); },
  super_durability(p) { return PHYS.retaliate(p); },
  regeneration(p) { return PHYS.regen(p); },
  titan_grip(p) {
    const e = lookTarget(p, 6);
    if (!e) { hudMsg(p, "§7Nothing in reach to grab.", 30); return false; }
    const f = V.flat(p.getViewDirection());
    dmg(e, 5, p);
    try { e.teleport(at(p.location, f.x * 1.3, 1.9, f.z * 1.3)); } catch { }
    sound(p.dimension, "origin.sfx.heavyhit", p.location, 0.8, 1);
    system.runTimeout(() => {
      if (!valid(e) || !valid(p)) return;
      const d = V.flat(p.getViewDirection());
      try { e.applyKnockback({ x: d.x * 3.4, z: d.z * 3.4 }, 0.7); } catch { }
      fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), C.white, 1, { radius: 2 });
      sound(p.dimension, "origin.sfx.swoosh", p.location, 0.8, 1);
      system.runTimeout(() => { if (!valid(e)) return; dmg(e, 8, p); fx(e.dimension, "origin:debris", e.location, C.dust, 1); sound(e.dimension, "origin.sfx.stonecrash", e.location, 1.2, 0.7);
        try { for (const o of e.dimension.getEntities({ location: e.location, maxDistance: 2.5, excludeTypes: NO_HIT })) if (o.id !== e.id && o.id !== p.id && o.typeId !== "minecraft:player") dmg(o, 4, p); } catch { } }, 14);
    }, 16);
    return true;
  },
  arc_storm(p) {
    let cur = lookTarget(p, 20);
    if (!cur) { hudMsg(p, "§7No target for the storm.", 30); return false; }
    const seen = new Set(), dmgs = [9, 7, 5, 4, 3], col = hexToRgb("#9fd8ff");
    let from = p.getHeadLocation();
    for (let i = 0; i < 5 && cur; i++) {
      seen.add(cur.id);
      const to = cur.getHeadLocation();
      line(p.dimension, "origin:beam", from, to, col, 0.35, 1);
      fx(p.dimension, "origin:flash", to, col, 1, { size: 1.2 });
      dmg(cur, dmgs[i], p);
      from = to;
      let next = null;
      try { next = p.dimension.getEntities({ location: from, maxDistance: 8, excludeTypes: NO_HIT }).filter((x) => x.id !== p.id && x.typeId !== "minecraft:player" && !seen.has(x.id)).sort((a, b) => V.dist(a.location, from) - V.dist(b.location, from))[0] ?? null; } catch { }
      cur = next;
    }
    sound(p.dimension, "origin.sfx.thunderhit", p.location, 1.1, 1);
    sound(p.dimension, "origin.sfx.shock", p.location, 1, 0.8);
    return true;
  },
  umbral_clones(p) {
    const col = hexToRgb("#2a1640");
    sound(p.dimension, "origin.sfx.soul", p.location, 0.7, 1);
    for (let k = 0; k < 6; k++) system.runTimeout(() => {
      if (!valid(p)) return;
      let list = [];
      try { list = p.dimension.getEntities({ location: p.location, maxDistance: 12, families: ["monster"] }); } catch { }
      const e = list[Math.floor(Math.random() * list.length)];
      if (!e) return;
      const f = V.flat(V.sub(e.location, p.location)), spot = at(e.location, f.x * 1.2, 0, f.z * 1.2);
      fx(p.dimension, "origin:void_swirl", at(spot, 0, 1, 0), col, 1);
      fx(p.dimension, "origin:burst", e.getHeadLocation(), col, 1);
      dmg(e, 5, p);
      sound(p.dimension, "origin.sfx.swoosh", spot, 1.3, 0.6);
    }, k * 18);
    return true;
  },
  tendrils(p) {
    const e = lookTarget(p, 16);
    const b = e ? null : lookBlock(p, 16);
    const c = e ? e.location : b ? b.point : V.add(p.location, V.mul(V.flat(p.getViewDirection()), 6));
    tendrilBurst(p.dimension, c, p, 5, 70);
    return true;
  },
  shade_form(p, h, r) {
    r.powerOn = true;
    r.shadeLit = null;
    try { p.playAnimation("animation.origin.pose.vanish", { controller: "origin_p3", stopExpression: "0", blendOutTime: 0.15 }); } catch { }
    fx(p.dimension, "origin:shadow_portal", at(p.location, 0, 0.05, 0), VOIDC, 1, { size: 1.8, life: 0.8 });
    fx(p.dimension, "origin:void_swirl", at(p.location, 0, 1, 0), SHADE, 1);
    sound(p.dimension, "mob.endermen.portal", p.location, 0.5, 0.8);
    hudMsg(p, "§8§lSHADE FORM §r§7- stay in the dark. Your first hit from hiding deals +6", 60);
    return true;
  },
};

// Flight power -> flight.js engine
export function beginFlight(p) {
  const h = hero(p), r = RT(p);
  const ok = startFlight(p, {
    kind: "power", maxTicks: POWERS.flight.maxAir,
    onTick: (pl, age, boosting) => {
      const hh = hero(pl);
      hh.energy -= boosting ? 0.15 : 0.05;
      if (age % 10 === 0) markDirty(pl);
      if (hh.energy <= 0) { hh.energy = 0; hudMsg(pl, "§bOut of Energy!", 30); return false; }
      return true;
    },
    onEnd: (pl, why) => {
      const rr = RT(pl);
      rr.powerOn = false;
      rr.powerCd = now() + POWERS.flight.cd;
      hudMsg(pl, why === "tired" ? "§6Your strength gives out. §7Gliding down..." : "§7Touchdown.", 40);
    },
  });
  if (ok) { r.powerOn = true; hudMsg(p, "§6§lFLIGHT §r§7- forward = fly where you look · jump/sneak = up/down · sprint = boost", 80); }
  return ok;
}
export function canPowerFly(p) {
  const h = hero(p), r = RT(p);
  if (h.power !== "flight" || !h.awakened || r.staticLock) return false;
  if ((r.powerCd ?? 0) > now()) { hudMsg(p, `§7Flight recharging... §c${(((r.powerCd ?? 0) - now()) / 20).toFixed(1)}s`, 20); return false; }
  if (h.energy < POWERS.flight.cost) { hudMsg(p, "§bNot enough Energy to take off §7(15)", 30); return false; }
  return true;
}
export function powerTakeoff(p) {
  const h = hero(p);
  if (beginFlight(p)) { h.energy -= POWERS.flight.cost; markDirty(p); }
}

// shared with villains
export function tendrilBurst(dim, c, by, damage = 5, pin = 70) {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const s = at(c, Math.cos(a) * 2, 0, Math.sin(a) * 2);
    line(dim, "origin:dot", s, at(s, 0, 2.4, 0), SHADE, 0.3, 1);
  }
  fx(dim, "origin:shockwave", at(c, 0, 0.05, 0), VOIDC, 1, { radius: 3 });
  fx(dim, "origin:void_swirl", at(c, 0, 1, 0), VOIDC, 1);
  sound(dim, "mob.warden.dig", c, 1.2, 0.8);
  sound(dim, "origin.sfx.chains", c, 0.9, 0.8);
  let list = [];
  try { list = dim.getEntities({ location: c, maxDistance: 3.2, excludeTypes: NO_HIT }); } catch { }
  const hit = [];
  for (const t of list) {
    if (t.id === by?.id) continue;
    if (by?.typeId === "origin:villain" && t.typeId === "origin:villain") continue;
    dmg(t, damage, by);
    try { t.addEffect("slowness", pin, { amplifier: 6, showParticles: false }); t.addEffect("weakness", pin, { amplifier: 1 }); } catch { }
    hit.push(t);
  }
  return hit;
}

function toggleOff(p, key, why) {
  const r = RT(p);
  r.powerOn = false;
  if (key === "flight") { stopFlight(p, why ?? "land"); return; }
  if (key === "shade_form") {
    try { p.removeEffect("invisibility"); p.removeEffect("speed"); p.removeEffect("resistance"); } catch { }
    fx(p.dimension, "origin:void_swirl", at(p.location, 0, 1, 0), SHADE, 1);
  }
  r.powerCd = now() + (POWERS[key]?.cd ?? 20);
}

// ------------------------------------------------------------------ melee hooks
// entityHitEntity: ambushes (Shade Form from hiding, Shadow Step behind someone)
export function onPowerMelee(p, target) {
  const h = hero(p), r = RT(p);
  if (h.power === "shade_form" && r.powerOn && !r.shadeLit) {
    dmg(target, 6, p);
    fx(p.dimension, "origin:void_swirl", target.location, SHADE, 1);
    hudMsg(p, "§8§lAMBUSH §r§7+6", 30);
    toggleOff(p, "shade_form");
  } else if (h.power === "shadow_step" && (r.ambushUntil ?? 0) > now()) {
    r.ambushUntil = 0;
    dmg(target, 4, p);
    fx(p.dimension, "origin:void_swirl", target.getHeadLocation(), SHADE, 0.8);
  }
}
// playerSwingStart: Stretch's long punch (only fires past normal reach)
export function onSwing(p, ev) {
  const h = hero(p);
  if (h.power !== "stretch" || !h.awakened) return;
  if (ev && ev.swingSource !== undefined && ev.swingSource !== (EntitySwingSource?.Attack ?? "Attack")) return;
  const r = RT(p);
  const t = now();
  if (t - (r.reachAt ?? -99) < 10 || r.cine || r.station || r.staticLock) return;
  const e = lookTarget(p, 8);
  if (!e) return;
  const head = p.getHeadLocation();
  if (V.dist(head, e.getHeadLocation()) < 3.6) return;   // in normal reach: a normal punch
  if (h.energy < 3) return;
  r.reachAt = t;
  stretchArm(p, V.dist(head, e.getHeadLocation()));
  h.energy -= 3;
  markDirty(p);
  const rt = rightOf(V.flat(p.getViewDirection()));
  line(p.dimension, "origin:trail", at(head, rt.x * 0.35, -0.45, rt.z * 0.35), e.getHeadLocation(), TAN, 0.3, 1);
  fx(p.dimension, "origin:impact", e.getHeadLocation(), TAN, 1, { size: 0.9 });
  sound(p.dimension, "mob.slime.small", head, 1.4, 0.8);
  dmg(e, 4, p);
  const d = V.flat(V.sub(e.location, p.location));
  try { e.applyKnockback({ x: d.x * 0.5, z: d.z * 0.5 }, 0.2); } catch { }
}

// ------------------------------------------------------------------ continuous effects (every 2 ticks)
export function tickPowers() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const h = hero(p), r = RT(p);
    if (!h.power) continue;
    if (h.power === "shade_form" && r.powerOn) shadeTick(p, h, r, t);
  }
}

function drain(p, h, r, perSec, key) {
  h.energy -= perSec / 10;
  if (h.energy <= 0) { h.energy = 0; toggleOff(p, key); hudMsg(p, "§bOut of Energy!", 30); }
  markDirty(p);
}

function shadeTick(p, h, r, t) {
  const dark = isDark(p.dimension, at(p.location, 0, 1, 0));
  if (r.shadeLit !== !dark) {
    r.shadeLit = !dark;
    if (dark) hudMsg(p, "§8§lHIDDEN §r§7- you're part of the dark", 30);
    else { hudMsg(p, "§e§lEXPOSED §r§7- get back into the shadows", 40); try { p.removeEffect("invisibility"); } catch { } }
  }
  if (t % 20 === 0) {
    try {
      if (dark) {
        p.addEffect("invisibility", 40, { showParticles: false });
        p.addEffect("speed", 40, { amplifier: 1, showParticles: false });
      }
      p.addEffect("resistance", 40, { amplifier: dark ? 1 : 0, showParticles: false });
    } catch { }
  }
  if (t % 6 === 0) fx(p.dimension, "origin:dot", at(p.location, (Math.random() - 0.5), 0.2 + Math.random() * 1.6, (Math.random() - 0.5)), SHADE, dark ? 0.5 : 1);
  drain(p, h, r, dark ? 1.5 : 6, "shade_form");
}

// Blast: twin beams, pierce everything in the line (each target can be hit every 8 ticks)
export function beamDamage(dim, from, dir, maxDist, by, perHit, hits, filter) {
  let dist = maxDist;
  try {
    const bh = dim.getBlockFromRay(from, dir, { maxDistance: maxDist, includePassableBlocks: false });
    if (bh) dist = V.dist(from, V.add(bh.block.location, bh.faceLocation));
  } catch { }
  let list = [];
  try { list = dim.getEntitiesFromRay(from, dir, { maxDistance: dist }); } catch { }
  const t = now();
  for (const hit of list) {
    const e = hit.entity;
    if (!valid(e) || e.id === by?.id || NO_HIT.includes(e.typeId) || (filter && !filter(e))) continue;
    if ((hits.get(e.id) ?? -99) + 8 > t) continue;
    hits.set(e.id, t);
    dmg(e, perHit, by);
    fx(dim, "origin:spark", e.getHeadLocation(), RED, 1);
  }
  return dist;
}
// ------------------------------------------------------------------ the Void (Sentry's Banish)
// Each banished thing gets its own sealed black cell far away in the Inner World dimension,
// then comes back where it was. Players are protected in there; creatures slowly come apart.
const BANISH_IMMUNE = ["origin:null", "minecraft:ender_dragon", "minecraft:wither", "minecraft:warden", "origin:manifestation", "origin:archetype_orb", "origin:float_text", "origin:static_echo", "minecraft:item", "minecraft:xp_orb"];
const banished = new Map(); // id -> {e, from, until, cell, player, byName}
const VOID_AREA = "origin_void";
const cellLoc = (i) => ({ x: VOID_ROOM.x + i * VOID_CELL_SPACING + 0.5, y: VOID_ROOM.y, z: VOID_ROOM.z + 0.5 });
let voidReady = null;
async function ensureVoid() {
  const iw = world.getDimension(DIM_ID);
  const mgr = world.tickingAreaManager;
  try {
    if (!mgr.hasTickingArea(VOID_AREA)) {
      voidReady = mgr.createTickingArea(VOID_AREA, {
        dimension: iw,
        from: { x: VOID_ROOM.x - 5, y: VOID_ROOM.y - 2, z: VOID_ROOM.z - 5 },
        to: { x: VOID_ROOM.x + (VOID_CELLS - 1) * VOID_CELL_SPACING + 5, y: VOID_ROOM.y + 6, z: VOID_ROOM.z + 5 },
      });
    }
    if (voidReady) await voidReady;
  } catch (e) { console.warn("[ORIGIN] void area: " + e); }
  if (world.getDynamicProperty("origin:void_cells") !== 3) {
    try {
      // invisible walls: from inside, the Void has no edges at all
      for (let i = 0; i < VOID_CELLS; i++) {
        const c = cellLoc(i);
        const x = Math.floor(c.x), y = c.y, z = Math.floor(c.z);
        iw.runCommand(`fill ${x - 3} ${y - 1} ${z - 3} ${x + 3} ${y + 4} ${z + 3} minecraft:barrier hollow`);
      }
      world.setDynamicProperty("origin:void_cells", 3);
    } catch (e) { console.warn("[ORIGIN] void cells: " + e); return false; }
  }
  return true;
}
function freeCell() {
  const used = new Set([...banished.values()].map((b) => b.cell));
  for (let i = 0; i < VOID_CELLS; i++) if (!used.has(i)) return i;
  return -1;
}
function niceName(e) {
  if (e.nameTag) return e.nameTag.split("\n")[0];
  const id = e.typeId.split(":")[1] ?? e.typeId;
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
export const isBanished = (e) => banished.has(e?.id);

// returns true, "immune" (bosses take damage instead) or false
export function banish(by, target, ticks = 120) {
  if (!valid(target) || banished.has(target.id)) return false;
  if (target.typeId === "minecraft:player") { const rt = RT(target); if (rt.cine || rt.traveling || rt.regenScene) return false; }
  const dim = target.dimension;
  fx(dim, "origin:void_swirl", target.getHeadLocation(), VOIDC, 1);
  fx(dim, "origin:shockwave", at(target.location, 0, 0.05, 0), C.blood, 1, { radius: 2 });
  sound(dim, "mob.warden.sonic_charge", target.location, 1.4, 0.8);
  if (BANISH_IMMUNE.includes(target.typeId)) { dmg(target, 12, by); return "immune"; }
  if (target.dimension.id === DIM_ID && Math.abs(target.location.x - VOID_ROOM.x) < 200) return false;
  const cell = freeCell();
  if (cell < 0) return false;
  const isPlayer = target.typeId === "minecraft:player";
  const from = { dim: dim.id, x: target.location.x, y: target.location.y, z: target.location.z };
  const rec = { e: target, from, until: now() + ticks + 20, cell, player: isPlayer, byName: by?.name ?? (by ? niceName(by) : "Something"), arrived: false };
  // what's left behind: their shadow, burned into the floor where they stood
  try {
    const s = dim.spawnEntity("origin:void_stain", { x: from.x, y: Math.floor(from.y) + 0.02, z: from.z });
    s.setRotation({ x: 0, y: target.getRotation().y });
    rec.stain = s;
    fx(dim, "origin:void_swirl", at(from, 0, 0.3, 0), VOIDC, 1);
  } catch { }
  banished.set(target.id, rec);
  if (isPlayer) {
    const h = hero(target);
    h.banish = from;
    saveNow(target);
  }
  system.run(async () => {
    try { await voidDrag(target, by); } catch { }   // v0.22: a portal opens under them and chains drag them down into it
    const ok = await ensureVoid();
    if (!ok || !valid(target)) { banished.delete(target.id); return; }
    try {
      target.teleport(cellLoc(cell), { dimension: world.getDimension(DIM_ID) });
      rec.arrived = true;
      rec.until = now() + ticks;
    } catch (e) { banished.delete(target.id); if (isPlayer) { hero(target).banish = null; markDirty(target); } return; }
    if (isPlayer) {
      try {
        target.addEffect("darkness", ticks + 20, { showParticles: false });
        target.addEffect("resistance", ticks + 20, { amplifier: 4, showParticles: false });
        cmd(target, "fog @s push origin:void_room origin_void");
        target.onScreenDisplay.setTitle("§0.", { fadeInDuration: 0, stayDuration: ticks, fadeOutDuration: 20, subtitle: `§5${rec.byName} banished you to the Void.` });
        RT(target).titleUntil = now() + ticks;
      } catch { }
    } else {
      try { target.addEffect("slowness", ticks, { amplifier: 2, showParticles: false }); } catch { }
    }
  });
  return true;
}
function bringBack(id, rec) {
  const e = rec.e;
  if (!valid(e)) { banished.delete(id); return; }
  try {
    e.teleport({ x: rec.from.x, y: rec.from.y, z: rec.from.z }, { dimension: world.getDimension(rec.from.dim) });
  } catch {
    // its chunk unloaded (everyone left): try again for a while, then let the Void keep it
    if (now() > rec.until + 200) { banished.delete(id); try { e.remove(); } catch { } }
    return;
  }
  banished.delete(id);
  try { if (valid(rec.stain)) { fx(rec.stain.dimension, "origin:void_swirl", rec.stain.location, VOIDC, 1); rec.stain.remove(); } } catch { }
  fx(e.dimension, "origin:void_swirl", at(rec.from, 0, 1, 0), VOIDC, 1);
  sound(e.dimension, "mob.endermen.portal", rec.from, 0.6, 0.8);
  if (rec.player) {
    const h = hero(e);
    h.banish = null;
    markDirty(e);
    try { cmd(e, "fog @s remove origin_void"); e.removeEffect("darkness"); } catch { }
    hudMsg(e, "§7You claw your way back out of the Void.", 50);
  }
}
// every 20 ticks
export function tickBanished() {
  const t = now();
  for (const [id, rec] of banished) {
    if (!valid(rec.e)) { if (!rec.player) banished.delete(id); continue; }
    if (!rec.arrived) continue;
    if (valid(rec.stain) && t % 40 < 20) fx(rec.stain.dimension, "origin:void_swirl", at(rec.stain.location, 0, 0.2, 0), VOIDC, 0.5);
    if (rec.player) voidScare(rec.e, t, rec.until - t);
    if (!rec.player) {
      // the Void gnaws at creatures: 2 damage a second
      try { rec.e.applyDamage(2, { cause: EntityDamageCause.magic }); } catch { }
      fx(rec.e.dimension, "origin:void_swirl", rec.e.getHeadLocation(), VOIDC, 0.7);
    }
    if (t >= rec.until) bringBack(id, rec);
  }
  if (!banished.size) { try { if (world.tickingAreaManager.hasTickingArea(VOID_AREA)) world.tickingAreaManager.removeTickingArea(VOID_AREA); } catch { } voidReady = null; }
}
// the Void is not empty. It watches.
const EYE_RED = { red: 1, green: 0.1, blue: 0.1 };
function voidScare(p, t, left) {
  const dim = p.dimension, c = p.location;
  try { p.addEffect("darkness", 60, { showParticles: false }); p.addEffect("slowness", 30, { amplifier: 1, showParticles: false }); } catch { }
  const roll = Math.random();
  const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * 5;
  const spot = at(c, Math.cos(a) * d, 1.4 + Math.random() * 1.5, Math.sin(a) * d);
  const side = { x: -Math.sin(a) * 0.25, z: Math.cos(a) * 0.25 };
  if (roll < 0.45) {
    // eyes opening in the dark
    const col = Math.random() < 0.6 ? C.white : EYE_RED;
    fx(dim, "origin:void_eye", at(spot, side.x, 0, side.z), col, 1);
    fx(dim, "origin:void_eye", at(spot, -side.x, 0, -side.z), col, 1);
    if (Math.random() < 0.4) psound(p, "mob.warden.listening", 0.6, 0.5);
  } else if (roll < 0.7) {
    // something tall standing just at the edge of sight
    for (let y = 0; y < 3.2; y += 0.25) fx(dim, "origin:dot", at(c, Math.cos(a) * 7, y, Math.sin(a) * 7), { red: 0.02, green: 0, blue: 0.03 }, 1);
    fx(dim, "origin:void_eye", at(c, Math.cos(a) * 6.9, 2.9, Math.sin(a) * 6.9), EYE_RED, 1);
    psound(p, "mob.warden.listening_angry", 0.5, 0.4);
  } else if (roll < 0.9) {
    // hands reaching in from every side
    for (let k = 0; k < 6; k++) {
      const b = (k / 6) * Math.PI * 2 + Math.random() * 0.4;
      for (let s = 0; s < 4; s++) system.runTimeout(() => valid(p) && fx(dim, "origin:dot", at(p.location, Math.cos(b) * (4 - s), 0.4 + s * 0.15, Math.sin(b) * (4 - s)), { red: 0.12, green: 0.02, blue: 0.2 }, 1), s * 3);
    }
    psound(p, "ambient.cave", 1, 0.5);
  } else {
    psound(p, "mob.warden.heartbeat", 1, 0.6);
    try { p.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0.1, fadeOutTime: 0.4 }, fadeColor: { red: 0.25, green: 0, blue: 0 } }); } catch { }
  }
  if (left < 30 && left >= 10) { try { p.onScreenDisplay.setActionBar("§4it lets you go. this time."); } catch { } }
}

// relog / reload while banished: send them back to where they were taken from
export function rescueBanished(p) {
  const h = hero(p);
  if (!h.banish) return false;
  const b = h.banish;
  h.banish = null;
  markDirty(p);
  banished.delete(p.id);
  try {
    p.teleport({ x: b.x, y: b.y, z: b.z }, { dimension: world.getDimension(b.dim) });
    cmd(p, "fog @s remove origin_void");
  } catch { }
  return true;
}

// ------------------------------------------------------------------ Sentry's Void Shell (passive)
// (The Alter Ego moved to ego.js - it's an item now, any power can bond with it.)
// Below 30% health, or on a killing blow, the Void wraps you: the hit is swallowed, you get
// 4 seconds of near-invulnerability and the Void throws everything near you back. Every 2 minutes.
const NO_SAVE = ["void", "selfDestruct", "override"];
function shellReady(p, h, r) {
  return h.power === "sentry" && h.awakened && (r.shellCd ?? 0) <= now() && !r.cine && !r.caged && !banished.has(p.id);
}
export function onShellBefore(ev) {
  const p = ev.hurtEntity;
  const h = hero(p), r = RT(p);
  if (!shellReady(p, h, r) || r.shellPending) return false;
  if (NO_SAVE.includes(String(ev.damageSource?.cause))) return false;
  const hp = health(p);
  if (!hp || hp.cur - ev.damage > 0) return false;
  ev.cancel = true;
  r.shellPending = true;
  system.run(() => { r.shellPending = false; if (valid(p)) voidShell(p); });
  return true;
}
export function onShellAfter(p) {
  const h = hero(p), r = RT(p);
  if (!shellReady(p, h, r) || r.shellPending) return;
  const hp = health(p);
  if (!hp || hp.cur > hp.max * 0.3 || hp.cur <= 0) return;
  voidShell(p);
}
function voidShell(p) {
  const r = RT(p);
  r.shellCd = now() + 2400;
  const dim = p.dimension;
  try {
    p.addEffect("resistance", 80, { amplifier: 4, showParticles: false });
    p.addEffect("regeneration", 100, { amplifier: 1, showParticles: false });
  } catch { }
  fx(dim, "origin:void_swirl", at(p.location, 0, 1, 0), VOIDC, 1);
  fx(dim, "origin:shockwave", at(p.location, 0, 0.05, 0), VOIDC, 1, { radius: 4 });
  sound(dim, "mob.warden.sonic_boom", p.location, 0.6, 1.2);
  let list = [];
  try { list = dim.getEntities({ location: p.location, maxDistance: 4.5, excludeTypes: NO_HIT }); } catch { }
  for (const e of list) {
    if (e.id === p.id) continue;
    const d = V.flat(V.sub(e.location, p.location));
    try { e.applyKnockback({ x: d.x * 1.8, z: d.z * 1.8 }, 0.5); } catch { }
  }
  p.onScreenDisplay.setTitle(" ", { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10, subtitle: "§5the Void wraps around you" });
  r.titleUntil = now() + 40;
  for (let i = 1; i <= 8; i++) system.runTimeout(() => valid(p) && fx(p.dimension, "origin:void_swirl", at(p.location, 0, 1, 0), VOIDC, 0.7), i * 10);
}
export function tickAlter() { tickBanished(); }

// ------------------------------------------------------------------ HUD + Power menu
export function powerLine(p) {
  const h = hero(p), r = RT(p);
  const P = POWERS[h.power];
  if (!P) return null;
  const t = now();
  let state;
  if (h.power === "flight" && isFlying(p)) {
    const left = Math.max(0, P.maxAir - (t - (r.fly?.start ?? t)));
    state = `§6AIR ${bar(BAR.gold, left / P.maxAir, 6)}`;
  } else if (h.power === "shade_form" && r.powerOn) state = r.shadeLit ? "§e§lEXPOSED" : "§8§lHIDDEN";
  else if (h.power === "blast" && beamActive(p, "eyes")) state = "§c§lFIRING";
  else {
    const cd = (r.powerCd ?? 0) - t;
    state = cd > 0 ? `§c${(cd / 20).toFixed(1)}s` : h.energy >= P.cost ? "§aREADY" : "§bLOW EN";
  }
  let extra = "";
  if (h.power === "sentry") {
    const s = (r.shellCd ?? 0) - t;
    extra = s > 0 ? ` §8Shell ${Math.ceil(s / 20)}s` : " §8Shell §aready";
  }
  if ((h.power === "shadow_step" || h.power === "shade_form") && !r.powerOn) {
    extra = isDark(p.dimension, at(p.location, 0, 1, 0)) ? " §8(in shadow)" : " §e(in light)";
  }
  if (h.power === "mirror_hour") extra = mirrorReady(p) ? " §6(ready)" : " §8(spent this fight)";
  const px = p3Line(p) ?? physLine(p) ?? p2Line(p);
  if (px) extra = px;
  return `§f${ICON.flame} ${P.icon}${P.name} ${state}${extra}`;
}

// pick a different power from your archetype (5 XP levels; free in creative)
async function switchPower(p) {
  const h = hero(p), pool = (POOLS[h.arch] ?? POOLS.brawler).filter((k) => k !== h.power && POWERS[k]);
  const f = oform("menu", "Switch Power", `§7Choose a new ${ARCH[h.arch]?.name ?? ""} power. §8Costs 5 levels (free in creative).`);
  for (const k of pool) f.button(`${POWERS[k].icon}§l${POWERS[k].name}\n§8${POWERS[k].desc.slice(0, 54)}...`, ICONS + `arch_${h.arch ?? "brawler"}`);
  f.button("Back", ICONS + "act_back");
  const res = await show(p, f);
  if (!res || res.canceled || res.selection === undefined || res.selection >= pool.length) return;
  let creative = false;
  try { creative = String(p.getGameMode()).toLowerCase() === "creative"; } catch { }
  if (!creative && (p.level ?? 0) < 5) { hudMsg(p, "§7You need 5 levels to switch powers.", 40); return; }
  if (!creative) { try { p.addLevels(-5); } catch { } }
  const k = rollPower(p, pool[res.selection]);
  RT(p).powerOn = false; RT(p).powerCd = 0;
  sound(p.dimension, "random.levelup", p.location, 1.2, 0.8);
  msg(p, `§f§lNEW POWER: ${POWERS[k].icon}§l${POWERS[k].name.toUpperCase()}§r §7- ${POWERS[k].desc}`);
}
export async function openPowerMenu(p) {
  const h = hero(p);
  if (!h.awakened) { hudMsg(p, "§7The core is cold. §8(Awaken first.)"); return; }
  if (!h.power || !POWERS[h.power]) rollPower(p);
  const P = POWERS[h.power];
  const A = ARCH[h.arch];
  const body = [
    `${P.icon}§l${P.name.toUpperCase()}§r §8- ${A?.col ?? ""}${A?.name ?? ""} origin`,
    `§7${P.desc}`,
    "",
    ...P.stats.map((s) => `§f- §7${s}`),
    "",
    `§8Other ${A?.name ?? ""} powers: ${(POOLS[h.arch] ?? []).filter((k) => k !== h.power).map((k) => POWERS[k].name).join(", ")}`,
    "§8Use the Power Core = power. Sneak + use = this menu.",
  ].join("\n");
  const f = oform("menu", "Your Power", body);
  const acts = [];
  const b = (txt, icon, a) => { f.button(txt, ICONS + icon); acts.push(a); };
  if (h.power === "mirror_hour") {
    b(`Rewind yourself${mirrorReady(p) ? "" : " §8(spent)"}\n§8position, health and effects from a minute ago`, "x_mirror", "m:self");
    b("Rewind your worst wound\n§8a hit from the last minute never happened", "x_mirror", "m:wound");
    b("Rewind your target\n§8whoever you're looking at", "x_mirror", "m:target");
    b("Rewind the blocks you look at\n§8broken walls come back", "x_mirror", "m:blocks");
  }
  for (const al of P.alts ?? []) b(`${al.label}\n§8${al.sub}`, al.icon ?? "act_back", "alt:" + al.act);
  b(`Switch Power\n§8pick any ${A?.name ?? ""} power · 5 levels`, `arch_${h.arch ?? "brawler"}`, "switch");
  b("Close", "act_back", "close");
  const res = await show(p, f);
  if (!res || res.canceled || res.selection === undefined) return;
  const a = acts[res.selection];
  if (a === "switch") return switchPower(p);
  if (a?.startsWith("alt:")) { const k = a.slice(4); if (!(await runAlt3(p, k)) && !(await runAlt2(p, k))) runAlt(p, k); return; }
  if (a?.startsWith("m:")) {
    const t = now(), r = RT(p);
    if ((r.powerCd ?? 0) > t) { hudMsg(p, `§7Mirror Hour recharging... §c${(((r.powerCd ?? 0) - t) / 20).toFixed(1)}s`, 20); return; }
    if (h.energy < P.cost) { hudMsg(p, `§bNot enough Energy §7(${P.cost})`, 30); return; }
    if (!useMirror(p, a.slice(2))) return;
    h.energy -= P.cost; r.powerCd = t + P.cd; markDirty(p);
  }

}


// Stretch: the arm really stretches - the bone scales along its length toward where you're looking
export function stretchArm(p, dist) {
  const n = dist <= 5 ? 4 : dist <= 9 ? 8 : 12;
  try { p.playAnimation(`animation.origin.stretch.reach${n}`, { controller: "origin_stretch", stopExpression: "0", blendOutTime: 0.08 }); } catch { }
}
