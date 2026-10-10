// ORIGIN v0.05 - villain.js
// Villains: powered NPCs that roll a power from the same pools you do and use it on you.
// Every power attack has a tell (a wind-up you can see and hear) and a cooldown, so they're fair:
//   Stretch    - coils (tan sparks), then snaps a punch from up to 12 blocks and yanks you in. Dodge it.
//   Flight     - launches, hovers over you (a ring follows you), locks the ring, dives. Leave the ring.
//   Blast      - eyes glow red for 1.2s, then a slow-tracking beam for 1.5s. Strafe or break line of sight.
//   Sentry     - a purple ring closes on you for 1.5s, then banishes you to the Void for 5s. Break line of sight.
//                Below 35% health it splits off a hostile Alter Ego.
//   Shadow Step- smoke appears behind you, then it's there. Next hit within 2s deals extra.
//   Shade Form - turns invisible (any time in the dark, briefly in the light) and ambushes you.
//   Tendrils   - a ring marks the ground under you for 1.2s, then shadows erupt and pin you.
// Double-tap sneak right before a hit lands for a Perfect Dodge (it misses, you get Energy).
// Spawns: near awakened heroes in the overworld, more at night. /hero villains <off|rare|normal|often>.
import { world, system, GameMode, EntityDamageCause, ItemStack } from "@minecraft/server";
import { hero, RT, markDirty, bar, BAR } from "./data.js";
import { V, at, valid, fx, line, sound, C, now, hexToRgb, health, msg } from "./util.js";
import { POWERS, banish, isBanished, tendrilBurst, beamDamage, isDark, dmg } from "./powers.js";
import { villainEgo } from "./ego.js";
import { telegraphRing, telegraphLine } from "./vfx.js";
import { addDodgeHook } from "./combat.js";
import { hudMsg, quip } from "./voice.js";
import { drawBeam, STYLES } from "./beams.js";

export const VILLAIN = "origin:villain";
export const VPOWERS = ["stretch", "flight", "blast", "sentry", "shadow_step", "shade_form", "tendrils"];
const FAM = { stretch: 0, flight: 0, blast: 1, sentry: 1, shadow_step: 2, shade_form: 2, tendrils: 2 };
const FAM_NAME = ["Physical", "Matter", "Shadow"];
const FAM_COL = ["§6", "§b", "§5"];
const TITLES = ["Baron", "Lady", "Mister", "Madame", "General", "Count", "The"];
const CORES = [
  ["Gristle", "Ironjaw", "Tarmac", "Bulwark", "Slabfist", "Gravelgut", "Rebar"],
  ["Isotope", "Red Halo", "Fission", "Lumen", "Gamma Rae", "Ozone", "Cathode"],
  ["Nightjar", "Gloam", "Umbra", "Cinder Veil", "Wick", "Pale Hand", "Lampblack"],
];
const TAN = hexToRgb("#e8b48a"), RED = hexToRgb("#ff3b2f"), VOIDC = hexToRgb("#7a3fd1"), SMOKE = hexToRgb("#2a1640"), GOLD = hexToRgb("#ffd36a");
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// cooldowns (ticks) after each power attack; wind-ups are the tells
const CD = { stretch: 100, flight: 220, blast: 150, sentry: 520, shadow_step: 130, shade_form: 220, tendrils: 170 };

const vs = new Map(); // id -> brain
let scanAt = 0;

export function villainName(power) {
  const core = pick(CORES[FAM[power] ?? 0]);
  return Math.random() < 0.55 ? `${pick(TITLES)} ${core}` : core;
}

function brain(e) {
  let b = vs.get(e.id);
  if (b) return b;
  let power, name;
  try {
    if (e.getDynamicProperty("origin:vinit") === true) {
      power = VPOWERS[e.getProperty("origin:vpower") ?? 0] ?? "stretch";
      name = e.getDynamicProperty("origin:vname") ?? villainName(power);
    }
  } catch { }
  if (!power) {
    // spawn egg / summon: roll now
    power = pick(VPOWERS);
    name = villainName(power);
    setup(e, power, name);
  }
  let nemJ = null; try { const js = e.getDynamicProperty("origin:nemesis"); if (js) nemJ = JSON.parse(js); } catch { }
  b = { nemesis: nemJ, level: nemJ?.level ?? 0, e, power, name, state: 0, end: 0, cd: now() + 60, target: null, phase: null, aim: null, lock: null, hits: new Map(), missed: false, egoDone: false, ambushUntil: 0, hidden: false, tagAt: 0 };
  vs.set(e.id, b);
  return b;
}
function setup(e, power, name) {
  try {
    e.setProperty("origin:vpower", VPOWERS.indexOf(power));
    e.setProperty("origin:vfam", FAM[power]);
    e.setProperty("origin:vstate", 0);
    e.setDynamicProperty("origin:vinit", true);
    e.setDynamicProperty("origin:vname", name);
  } catch { }
}
function setState(b, s) {
  b.state = s;
  try { b.e.setProperty("origin:vstate", s); } catch { }
}
function updateTag(b) {
  const hp = health(b.e);
  const f = FAM[b.power];
  try { b.e.nameTag = `§c${b.name}\n${FAM_COL[f]}${POWERS[b.power].name} §f${hp ? bar(BAR.health, hp.cur / hp.max, 8) : ""}`; } catch { }
}
function root(e, ticks) { try { e.addEffect("slowness", ticks, { amplifier: 10, showParticles: false }); } catch { } }
function los(from, to, dim) {
  try {
    const d = V.sub(to, from);
    const len = V.len(d);
    const hit = dim.getBlockFromRay(from, V.norm(d), { maxDistance: len, includePassableBlocks: false });
    return !hit;
  } catch { return true; }
}
function nearTargets(b) {
  const e = b.e;
  let best = null, bd = 1e9;
  try {
    for (const p of e.dimension.getPlayers({ location: e.location, maxDistance: 24, excludeGameModes: [GameMode.Creative, GameMode.Spectator] })) {
      if (isBanished(p)) continue;
      const d = V.dist(p.location, e.location);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) {
      for (const a of e.dimension.getEntities({ type: "origin:alter_ego", location: e.location, maxDistance: 16, excludeTags: ["origin_villain_ego"] })) {
        const d = V.dist(a.location, e.location);
        if (d < bd) { bd = d; best = a; }
      }
    }
  } catch { }
  return best;
}
const headOf = (e) => { try { return e.getHeadLocation(); } catch { return at(e.location, 0, 1.6, 0); } };
const notVillainSide = (t) => t.typeId !== VILLAIN && !(t.hasTag?.("origin_villain_ego"));

function rescan() {
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end", "origin:inner_world"]) {
    let list = [];
    try { list = world.getDimension(id).getEntities({ type: VILLAIN }); } catch { }
    for (const e of list) brain(e);
  }
}

// ------------------------------------------------------------------ AI (every 2 ticks)
export function tickVillains() {
  const t = now();
  if (t >= scanAt) { scanAt = t + 40; rescan(); }
  for (const [id, b] of vs) {
    const e = b.e;
    if (!valid(e)) { vs.delete(id); continue; }
    if (isBanished(e)) { if (b.state) { setState(b, 0); b.phase = null; } continue; }
    if (t >= b.tagAt) { b.tagAt = t + 20; updateTag(b); }
    try { step(b, t); } catch (err) { console.warn("[ORIGIN] villain: " + err); setState(b, 0); b.phase = null; }
  }
}

function step(b, t) {
  const e = b.e, dim = e.dimension;
  // Sentry villains split off a hostile double when they're losing
  if (b.power === "sentry" && !b.egoDone) {
    const hp = health(e);
    if (hp && hp.cur < hp.max * 0.35) {
      b.egoDone = true;
      villainEgo(e, `${b.name}'s Alter Ego`);
      for (const p of dim.getPlayers({ location: e.location, maxDistance: 24 })) msg(p, `§c${b.name}'s other self steps out of it.`);
    }
  }
  if (b.state === 0 || b.state === 3) {
    if (b.power === "shade_form") return shadeIdle(b, t);
    if (t < b.cd) return;
    const T = nearTargets(b);
    if (!T) return;
    const d = V.dist(T.location, e.location);
    const sees = los(headOf(e), headOf(T), dim);
    start(b, T, d, sees, t);
    return;
  }
  run(b, t);
}

function begin(b, T, ticks, state = 1) {
  b.target = T;
  b.end = now() + ticks;
  b.missed = false;
  setState(b, state);
}
function finish(b) {
  setState(b, 0);
  b.phase = null;
  b.cd = now() + Math.round(CD[b.power] * (1 - 0.12 * (b.level ?? 0)));
  if (b.power2) { const p1 = b.power; b.power = b.power2; b.power2 = p1; }   // nemeses alternate two powers
}

function start(b, T, d, sees, t) {
  const e = b.e, dim = e.dimension;
  switch (b.power) {
    case "stretch":
      if (d < 3.5 || d > 12 || !sees) return;
      begin(b, T, 14); b.phase = "coil"; root(e, 16);
      sound(dim, "mob.slime.big", e.location, 0.6, 1);
      return;
    case "flight":
      if (d > 16) return;
      begin(b, T, 12, 2); b.phase = "rise";
      fx(dim, "origin:shockwave", at(e.location, 0, 0.05, 0), C.white, 1, { radius: 2 });
      sound(dim, "mob.enderdragon.flap", e.location, 1.2, 1);
      try { e.addEffect("levitation", 12, { amplifier: 9, showParticles: false }); } catch { }
      return;
    case "blast":
      if (d < 4 || d > 20 || !sees) return;
      begin(b, T, 24); b.phase = "charge"; root(e, 56);
      b.aim = V.norm(V.sub(headOf(T), headOf(e)));
      b.hits = new Map();
      sound(dim, "beacon.activate", e.location, 1.7, 1);
      return;
    case "sentry":
      if (d > 12 || !sees) return;
      begin(b, T, 30); b.phase = "reach"; root(e, 32);
      sound(dim, "mob.warden.sonic_charge", e.location, 0.8, 1);
      if (T.typeId === "minecraft:player") hudMsg(T, `§5${b.name} is reaching for you through the Void! §7Break line of sight!`, 40);
      return;
    case "shadow_step": {
      if (d < 3 || d > 20) return;
      let back;
      try { back = V.flat(T.getViewDirection()); } catch { back = V.flat(V.sub(T.location, e.location)); }
      b.lock = at(T.location, -back.x * 1.6, 0, -back.z * 1.6);
      begin(b, T, 10); b.phase = "smoke";
      fx(dim, "origin:void_swirl", at(b.lock, 0, 1, 0), SMOKE, 1);
      sound(dim, "mob.endermen.portal", b.lock, 0.5, 0.6);
      return;
    }
    case "tendrils":
      if (d < 3 || d > 14 || !sees) return;
      b.lock = { ...T.location };
      begin(b, T, 24); b.phase = "mark"; root(e, 26);
      sound(dim, "mob.warden.dig", b.lock, 0.7, 0.8);
      return;
  }
}

function run(b, t) {
  const e = b.e, dim = e.dimension, T = b.target;
  if (!valid(T) || isBanished(T)) return finish(b);
  const left = b.end - t;
  switch (b.power) {
    case "stretch": {
      fx(dim, "origin:charge", at(e.location, 0, 1.2, 0), TAN, 1);
      telegraphLine(dim, e.location, T.location, TAN);
      if (left > 0) return;
      const d = V.dist(T.location, e.location);
      if (b.missed || d > 13 || !los(headOf(e), headOf(T), dim)) { whiff(b); return finish(b); }
      line(dim, "origin:trail", at(e.location, 0, 1.3, 0), headOf(T), TAN, 0.35, 1);
      fx(dim, "origin:impact", headOf(T), TAN, 1, { size: 1.2 });
      sound(dim, "mob.slime.big", e.location, 1.6, 1);
      dmg(T, 5, e);
      fx(dim, "origin:flash", headOf(T), TAN, 1, { size: 1.2 });
      const pull = V.flat(V.sub(e.location, T.location));
      try { T.applyKnockback({ x: pull.x * Math.min(2.2, 0.4 + d * 0.16), z: pull.z * Math.min(2.2, 0.4 + d * 0.16) }, 0.35); } catch { }
      return finish(b);
    }
    case "flight": return flightRun(b, t, left);
    case "blast": {
      const head = headOf(e);
      if (b.phase === "charge") {
        fx(dim, "origin:charge", head, RED, 1);
        b.aim = V.norm(V.add(V.mul(b.aim, 0.7), V.mul(V.norm(V.sub(headOf(T), head)), 0.3)));
        line(dim, "origin:dot", head, V.add(head, V.mul(b.aim, 6)), RED, 0.8, 0.6);
        if (left > 0) return;
        b.phase = "fire"; b.end = t + 50; setState(b, 2);
        sound(dim, "mob.guardian.attack_loop", head, 1.2, 1);
        return;
      }
      // slow tracking: you can outrun the beam sideways
      b.aim = V.norm(V.add(V.mul(b.aim, 0.88), V.mul(V.norm(V.sub(headOf(T), head)), 0.12)));
      const dist = beamDamage(dim, head, b.aim, 22, e, 2, b.hits, notVillainSide);
      drawBeam(dim, at(head, 0, -0.05, 0), V.add(head, V.mul(b.aim, dist)), { ...STYLES.laser, glow: RED, width: 0.18 }, t, { life: 0.16 });
      fx(dim, "origin:beam_flare", V.add(head, V.mul(b.aim, dist)), RED, 0.9, { size: 0.9 });
      fx(dim, "origin:spark", V.add(head, V.mul(b.aim, dist)), RED, 1);
      if (t % 6 === 0) sound(dim, "mob.guardian.attack_loop", head, 2, 0.3);
      if (left <= 0) finish(b);
      return;
    }
    case "sentry": {
      if (t % 4 === 0) {
        telegraphRing(dim, T.location, 1.4 + left / 30, VOIDC, 1);
        fx(dim, "origin:void_swirl", headOf(T), VOIDC, 0.6);
      }
      if (left > 0) return;
      const ok = !b.missed && V.dist(T.location, e.location) <= 14 && los(headOf(e), headOf(T), dim);
      if (!ok) { whiff(b); return finish(b); }
      banish(e, T, 100);
      return finish(b);
    }
    case "shadow_step": {
      fx(dim, "origin:dot", at(b.lock, (Math.random() - 0.5), 0.3 + Math.random() * 1.6, (Math.random() - 0.5)), SMOKE, 1);
      if (left > 0) return;
      fx(dim, "origin:void_swirl", at(e.location, 0, 1, 0), SMOKE, 1);
      try {
        if (!e.tryTeleport(b.lock, { checkForBlocks: true, facingLocation: headOf(T) })) e.teleport(at(T.location, 0, 0, 0.01), { facingLocation: headOf(T) });
      } catch { }
      fx(dim, "origin:void_swirl", at(b.lock, 0, 1, 0), SMOKE, 1);
      sound(dim, "mob.endermen.portal", b.lock, 0.7, 1);
      b.ambushUntil = t + 40;
      return finish(b);
    }
    case "tendrils": {
      if (t % 4 === 0) telegraphRing(dim, b.lock, 3, VOIDC, 1);
      if (t % 6 === 0) fx(dim, "origin:dot", at(b.lock, (Math.random() - 0.5) * 5, 0.1, (Math.random() - 0.5) * 5), SMOKE, 1);
      if (left > 0) return;
      tendrilBurst(dim, b.lock, e, 4, 50);
      return finish(b);
    }
    case "shade_form": return shadeRun(b, t);
  }
  finish(b);
}

function flightRun(b, t, left) {
  const e = b.e, dim = e.dimension, T = b.target;
  const ground = T.location;
  if (b.phase === "rise") {
    fx(dim, "origin:trail", e.location, GOLD, 0.7);
    if (left > 0) return;
    b.phase = "hover"; b.end = t + 30;
    try { e.addEffect("slow_falling", 80, { showParticles: false }); } catch { }
    return;
  }
  if (b.phase === "hover") {
    const want = at(ground, 0, 6, 0);
    const pos = V.lerp(e.location, want, 0.25);
    try { e.teleport(pos, { facingLocation: headOf(T) }); } catch { }
    if (t % 6 === 0) telegraphRing(dim, ground, 2.5, GOLD, 0.8);
    if (left > 0) return;
    b.phase = "lock"; b.end = t + 10; b.lock = { ...ground };
    sound(dim, "mob.phantom.swoop", e.location, 0.9, 1);
    return;
  }
  if (b.phase === "lock") {
    try { e.teleport(e.location, { facingLocation: b.lock }); } catch { }
    if (t % 2 === 0) telegraphRing(dim, b.lock, 2.5, RED, 1);
    if (left > 0) return;
    b.phase = "dive"; b.end = t + 6; b.from = { ...e.location };
    return;
  }
  if (b.phase === "dive") {
    const k = 1 - Math.max(0, left) / 6;
    try { e.teleport(V.lerp(b.from, at(b.lock, 0, 0.1, 0), k)); } catch { }
    fx(dim, "origin:trail", e.location, GOLD, 1);
    if (left > 0) return;
    fx(dim, "origin:shockwave", at(b.lock, 0, 0.05, 0), GOLD, 1, { radius: 3 });
    fx(dim, "origin:debris", b.lock, C.dust, 1);
    sound(dim, "random.explode", b.lock, 1.3, 0.8);
    let list = [];
    try { list = dim.getEntities({ location: b.lock, maxDistance: 2.8 }); } catch { }
    for (const v of list) {
      if (v.id === e.id || !notVillainSide(v) || v.typeId === "minecraft:item" || v.typeId === "origin:float_text") continue;
      if (v.id === T.id && b.missed) continue;
      dmg(v, 6, e);
      const away = V.flat(V.sub(v.location, b.lock));
      try { v.applyKnockback({ x: away.x * 1.4, z: away.z * 1.4 }, 0.5); } catch { }
    }
    try { e.removeEffect("slow_falling"); } catch { }
    return finish(b);
  }
  finish(b);
}

// Shade Form villains: invisible stalkers. In the dark they stay hidden until they pounce;
// in daylight they can only hold it for a few seconds.
function shadeIdle(b, t) {
  const e = b.e, dim = e.dimension;
  const T = nearTargets(b);
  if (b.hidden) {
    const dark = isDark(dim, at(e.location, 0, 1, 0));
    if (t % 20 === 0) { try { e.addEffect("invisibility", 40, { showParticles: false }); e.addEffect("speed", 40, { amplifier: 1, showParticles: false }); } catch { } }
    if (t % 8 === 0) fx(dim, "origin:dot", at(e.location, (Math.random() - 0.5), 0.3 + Math.random() * 1.4, (Math.random() - 0.5)), SMOKE, 0.5);
    const close = T && V.dist(T.location, e.location) < 2.8;
    if (close || (!dark && t >= b.end)) reveal(b, close);
    return;
  }
  if (t < b.cd || !T) return;
  const d = V.dist(T.location, e.location);
  if (d < 4) return;
  b.hidden = true;
  b.target = T;
  b.end = t + 100;   // 5s in the light
  setState(b, 3);
  fx(dim, "origin:void_swirl", at(e.location, 0, 1, 0), SMOKE, 1);
  sound(dim, "mob.endermen.portal", e.location, 0.4, 0.7);
  try { e.addEffect("invisibility", 40, { showParticles: false }); } catch { }
}
function reveal(b, ambush) {
  const e = b.e, dim = e.dimension;
  b.hidden = false;
  try { e.removeEffect("invisibility"); e.removeEffect("speed"); } catch { }
  fx(dim, "origin:void_swirl", at(e.location, 0, 1, 0), SMOKE, 1);
  sound(dim, "mob.endermen.scream", e.location, 0.5, 0.6);
  if (ambush) {
    b.ambushUntil = now() + 40;
    if (b.target?.typeId === "minecraft:player") hudMsg(b.target, `§8${b.name} steps out of the dark!`, 30);
  }
  finish(b);
}
function shadeRun(b, t) { shadeIdle(b, t); }

function whiff(b) {
  const e = b.e;
  fx(e.dimension, "origin:void_swirl", at(e.location, 0, 1, 0), C.grey, 0.6);
  sound(e.dimension, "random.fizz", e.location, 0.8, 0.6);
}

// Perfect Dodge support: an attack is "about to land" in the last 6 ticks of a tell
addDodgeHook(
  (player) => {
    const t = now();
    for (const b of vs.values()) {
      if (b.target?.id !== player.id || b.state === 0 || b.state === 3) continue;
      const left = b.end - t;
      if (b.power === "flight" && b.phase !== "lock" && b.phase !== "dive") continue;
      if (b.power === "blast" && b.phase === "fire") continue;
      if (left >= 0 && left <= 6) return b;
    }
    return null;
  },
  (player) => {
    const t = now();
    for (const b of vs.values()) {
      if (b.target?.id === player.id && b.state !== 0 && b.end - t <= 6) b.missed = true;
    }
  },
);

// ------------------------------------------------------------------ combat hooks
// entityHitEntity with a villain as the attacker: ambush bonus after Shadow Step / Shade Form
export function onVillainHit(e, target) {
  const b = vs.get(e.id);
  if (!b) return;
  if (b.ambushUntil > now()) {
    b.ambushUntil = 0;
    dmg(target, b.power === "shade_form" ? 5 : 4, e);
    import("./dismember.js").then((m) => m.tryCut(e, target, 6, "power")).catch(() => { });
    fx(e.dimension, "origin:void_swirl", headOf(target), SMOKE, 0.8);
  }
}
// any damage drags a hidden Shade Form villain out of the dark
export function onVillainHurt(e, attacker) {
  const b = vs.get(e.id);
  if (!b) return;
  if (b.hidden) reveal(b, false);
  maybeEscape(b, attacker);
}

// ------------------------------------------------------------------ spawning
export function spawnVillain(dim, loc, power, announceTo, nem = null) {
  const pw = nem?.power ?? (power && VPOWERS.includes(power) ? power : pick(VPOWERS));
  const name = nem ? nemesisTitle(nem) : villainName(pw);
  let e;
  try { e = dim.spawnEntity(VILLAIN, loc); } catch (err) { console.warn("[ORIGIN] villain spawn failed: " + err); return null; }
  setup(e, pw, name);
  const b = brain(e);
  b.power = pw; b.name = name;
  b.cd = now() + 60;
  if (nem) {
    b.nemesis = { owner: nem.owner, level: nem.level };
    b.level = nem.level;
    b.power2 = nem.level >= 2 ? nem.power2 : null;
    try {
      e.addEffect("health_boost", 999999, { amplifier: nem.level * 3 - 1, showParticles: false });
      e.addEffect("instant_health", 1, { amplifier: 4 });
      e.addEffect("strength", 999999, { amplifier: nem.level - 1, showParticles: false });
      e.setDynamicProperty("origin:nemesis", JSON.stringify({ owner: nem.owner, level: nem.level }));
    } catch { }
  }
  updateTag(b);
  const f = FAM[pw];
  fx(dim, "origin:pillar", loc, f === 0 ? C.ember : f === 1 ? C.cyan : C.violet, 1);
  fx(dim, "origin:shockwave", at(loc, 0, 0.05, 0), C.crimson, 1, { radius: 2.5 });
  sound(dim, "mob.evocation_illager.prepare_summon", loc, 0.8, 1);
  const who = announceTo ? [announceTo] : [];
  try { for (const p of dim.getPlayers({ location: loc, maxDistance: 48 })) if (!who.includes(p)) who.push(p); } catch { }
  for (const p of who) {
    if (nem && p.id === nem.owner) { nemesisIntro(p, e, nem); continue; }
    msg(p, `§c§l${name}§r §7- a ${FAM_COL[f]}${FAM_NAME[f]}§7 villain with §f${POWERS[pw].name}§7 - has found you.`);
    try { p.onScreenDisplay.setTitle("§c§lVILLAIN", { fadeInDuration: 5, stayDuration: 40, fadeOutDuration: 15, subtitle: `§f${name} §8· ${POWERS[pw].name}` }); RT(p).titleUntil = now() + 60; } catch { }
  }
  return e;
}

// ------------------------------------------------------------------ NEMESIS: villains who get away come back, and remember
// A villain that drops low while fighting you may ESCAPE (once you have no nemesis). It returns later stronger,
// scarred by how you beat it, with a new title, more health, faster powers and (from Lv 2) a second power.
// Lv 3 fights to the end. Beating a nemesis is the best loot in the game.
const SCAR = { stretch: "Snapped", flight: "Grounded", blast: "Burned", sentry: "Voidtouched", shadow_step: "Shadow-Cut", shade_form: "Blindsided", tendrils: "Bound" };
const TAUNTS = [
  (h, n) => `"You still fight with ${POWERS[h.power]?.name ?? "your fists"}? I've had ${n.level === 2 ? "weeks" : "months"} to think about that."`,
  (h, n) => `"${h.stats.kills} kills, hero. I counted every one. Let's make it ${h.stats.kills + 1}... or not."`,
  (h, n) => `"Last time you got lucky. I left a piece of myself on that ground."`,
  (h, n) => `"They call me ${SCAR[n.scar] ?? "Scarred"} now. Because of you."`,
];
function nemesisTitle(n) { return n.level >= 3 ? `${n.base}, Twice-${n.scarWord}` : `${n.base} the ${n.scarWord}`; }
async function nemesisIntro(p, e, n) {
  const { runCine, EASE } = await import("./cine.js");
  const h = hero(p);
  await runCine(p, async (c) => {
    const el = e.location;
    const f = V.flat(V.sub(el, p.location));
    c.cam(at(el, f.x * -4 + f.z * 1.5, 1.6, f.z * -4 - f.x * 1.5), at(el, 0, 1.6, 0));
    c.say(`§4N E M E S I S`, 30);
    sound(p.dimension, "mob.wither.spawn", p.location, 0.6, 0.8);
    await c.wait(24);
    c.cam(at(el, f.x * -2.2, 1.8, f.z * -2.2), at(el, 0, 1.75, 0), 1, EASE.InOutSine);
    c.say(`§f${TAUNTS[Math.floor(Math.random() * TAUNTS.length)](h, n)}`, 70);
    await c.wait(50);
  });
  try { p.onScreenDisplay.setTitle(`§4§l${nemesisTitle(n).toUpperCase()}`, { fadeInDuration: 4, stayDuration: 50, fadeOutDuration: 15, subtitle: `§7your nemesis · Lv ${n.level} · ${POWERS[n.power].name}${n.level >= 2 ? " + " + POWERS[n.power2].name : ""}` }); RT(p).titleUntil = now() + 70; } catch { }
}
function maybeEscape(b, attacker) {
  if (!attacker || attacker.typeId !== "minecraft:player" || b.escaping) return;
  const hp = health(b.e);
  if (!hp || hp.cur > hp.max * 0.15) return;
  const h = hero(attacker);
  const lvl = b.nemesis?.level ?? 0;
  if (lvl >= 3) return;                                        // Lv 3 fights to the end
  if (b.nemesis && b.nemesis.owner !== attacker.id) return;
  if (!b.nemesis && (h.nemesis && !h.nemesis.defeated)) return; // one nemesis at a time
  if (!b.nemesis && Math.random() > 0.45) return;
  b.escaping = true;
  const e = b.e, dim = e.dimension;
  const prev = h.nemesis && !h.nemesis.defeated ? h.nemesis : null;
  const scar = h.power ?? "stretch";
  const base = prev?.base ?? b.name.replace(/^(Baron|Lady|Mister|Madame|General|Count|The) /, "");
  const others = VPOWERS.filter((k) => k !== b.power);
  h.nemesis = {
    owner: attacker.id, base, power: prev?.power ?? b.power, power2: prev?.power2 ?? pick(others), level: lvl + 1,
    scar, scarWord: SCAR[scar] ?? "Scarred", escapes: (prev?.escapes ?? 0) + 1, back: Date.now() + 1000 * 60 * 6, defeated: false,
  };
  markDirty(attacker);
  for (let i = 0; i < 6; i++) fx(dim, "origin:void_swirl", at(e.location, (Math.random() - 0.5), 0.5 + Math.random() * 1.5, (Math.random() - 0.5)), SMOKE, 1);
  sound(dim, "mob.evocation_illager.cast_spell", e.location, 1, 0.6);
  msg(attacker, `§4§l${b.name} ESCAPES. §r§7"This isn't over, ${attacker.name}." §8(They'll be back - stronger. They're your §4Nemesis§8 now.)`);
  try { attacker.onScreenDisplay.setTitle("§4§lESCAPED", { fadeInDuration: 2, stayDuration: 40, fadeOutDuration: 15, subtitle: `§7${nemesisTitle(h.nemesis)} will remember this` }); RT(attacker).titleUntil = now() + 60; } catch { }
  vs.delete(e.id);
  try { e.remove(); } catch { }
}
export function nemesisInfo(p) {
  const n = hero(p).nemesis;
  if (!n) return "§7No nemesis. §8(Villains who escape you become one.)";
  if (n.defeated) return `§7Nemesis §f${nemesisTitle(n)}§7: §adefeated§7. §8(${hero(p).nemesesBeaten ?? 1} beaten)`;
  const mins = Math.max(0, Math.ceil((n.back - Date.now()) / 60000));
  return `§4Nemesis: §f${nemesisTitle(n)} §8· Lv ${n.level} · ${POWERS[n.power].name}${n.level >= 2 ? " + " + POWERS[n.power2].name : ""} · ${mins ? `back in ~${mins} min` : "hunting you"}`;
}
export function spawnNemesis(p, loc) {
  const n = hero(p).nemesis;
  if (!n || n.defeated) return null;
  return spawnVillain(p.dimension, loc, null, p, n);
}

const RATE = { off: 0, rare: 0.4, normal: 1, often: 2.5 };
export function villainSetting() {
  const v = world.getDynamicProperty("origin:villains");
  return RATE[v] !== undefined ? v : "normal";
}
export function setVillainSetting(v) { world.setDynamicProperty("origin:villains", v); }

function findSpot(p) {
  const dim = p.dimension;
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 18 + Math.random() * 8;
    const x = Math.floor(p.location.x + Math.cos(a) * r), z = Math.floor(p.location.z + Math.sin(a) * r);
    let top;
    try { top = dim.getTopmostBlock({ x, z }); } catch { continue; }
    if (!top || top.isLiquid || top.isAir) continue;
    if (/leaves|lava|water|cactus|magma|fire/.test(top.typeId)) continue;
    if (Math.abs(top.location.y + 1 - p.location.y) > 10) continue;
    const loc = { x: x + 0.5, y: top.location.y + 1, z: z + 0.5 };
    try {
      const a1 = dim.getBlock(loc), a2 = dim.getBlock(at(loc, 0, 1, 0));
      if ((a1 && !a1.isAir) || (a2 && !a2.isAir)) continue;
    } catch { continue; }
    return loc;
  }
  return null;
}

let nextCheck = 0;
// every 20 ticks
export function tickVillainSpawns() {
  const t = now();
  if (t < nextCheck) return;
  nextCheck = t + 400;
  const rate = RATE[villainSetting()];
  if (!rate) return;
  let tod = 6000;
  try { tod = world.getTimeOfDay(); } catch { }
  const night = tod > 13000 && tod < 23000;
  for (const p of world.getAllPlayers()) {
    const h = hero(p), r = RT(p);
    if (!h.awakened || r.cine || r.station || r.traveling) continue;
    if (p.dimension.id !== "minecraft:overworld") continue;
    try { const gm = p.getGameMode(); if (gm === GameMode.Creative || gm === GameMode.Spectator) continue; } catch { }
    if (r.villainCd === undefined) { r.villainCd = t + 20 * 180; continue; }   // a few minutes of peace after joining
    if (t < r.villainCd) continue;
    let near = 0;
    try { near = p.dimension.getEntities({ type: VILLAIN, location: p.location, maxDistance: 64 }).length; } catch { }
    if (near) continue;
    if (Math.random() > (night ? 0.2 : 0.07) * rate) continue;
    const loc = findSpot(p);
    if (!loc) continue;
    const n = h.nemesis;
    const nem = n && !n.defeated && Date.now() >= (n.back ?? 0) && Math.random() < 0.6;
    if (nem ? spawnNemesis(p, loc) : spawnVillain(p.dimension, loc, null, p)) r.villainCd = t + Math.round((20 * 60 * 5) / rate);
  }
}

// ------------------------------------------------------------------ death
export function onVillainDeath(e, source) {
  const b = vs.get(e.id);
  vs.delete(e.id);
  let name = b?.name;
  if (!name) { try { name = e.getDynamicProperty("origin:vname"); } catch { } }
  name = name ?? "The villain";
  const killer = source?.damagingEntity;
  try { fx(e.dimension, "origin:void_swirl", at(e.location, 0, 1, 0), C.crimson, 1); } catch { }
  let nem = b?.nemesis;
  if (!nem) { try { const js = e.getDynamicProperty("origin:nemesis"); if (js) nem = JSON.parse(js); } catch { } }
  if (nem && killer?.typeId === "minecraft:player" && nem.owner === killer.id) {
    const h = hero(killer);
    if (h.nemesis) h.nemesis.defeated = true;
    h.nemesesBeaten = (h.nemesesBeaten ?? 0) + 1;
    markDirty(killer);
    const drop = (id, n = 1) => { try { e.dimension.spawnItem(new ItemStack(id, n), at(e.location, 0, 1, 0)); } catch { } };
    drop("minecraft:emerald", 8 + nem.level * 4);
    drop("origin:starmetal_fragment", nem.level);
    if (Math.random() < 0.3 + nem.level * 0.1) drop("origin:rift_heart");
    if (Math.random() < 0.08 + nem.level * 0.04) drop("origin:other_shard");
    try { killer.onScreenDisplay.setTitle("§6§lNEMESIS DEFEATED", { fadeInDuration: 4, stayDuration: 60, fadeOutDuration: 20, subtitle: `§f${name}` }); RT(killer).titleUntil = now() + 80; } catch { }
    sound(e.dimension, "random.levelup", killer.location, 1, 1);
  }
  if (killer?.typeId === "minecraft:player") {
    const h = hero(killer);
    h.stats.villains = (h.stats.villains ?? 0) + 1;
    markDirty(killer);
    msg(killer, `§6§lVILLAIN DEFEATED: §r§f${name} §8(${h.stats.villains} total)`);
    quip(killer, "villain_down", "One less monster with a cape. Nice work.", 600);
  }
}
export function villainCount() { return vs.size; }
