// ORIGIN v0.07 - ascend.js
// THE LADDER: Stirring -> Kindled -> Tempered -> Ascendant -> Exalted -> Apex.
//  - Fights earn RESOLVE. When you have enough, your Inner World offers a personal TRIAL.
//  - Each Trial is fought on your own island. Win it and you climb a stage:
//    a bigger power budget, new move parts, and at Ascendant your AWAKENED FORM, at Apex your ULTIMATE.
//  - SURGE (0-100) fills as you land hits, take hits and pull off combos.
//    Full Surge + sneak + use the Power Focus: Awaken (Ascendant, Exalted) / Ultimate (Apex).
import { world, system, EntityDamageCause, GameMode } from "@minecraft/server";
import { hero, RT, markDirty, saveNow, ARCH, STAGES, stageOf, budgetOf, ICON, BAR, bar } from "./data.js";
import { V, at, valid, fx, line, sound, psound, C, now, hexToRgb, msg, health } from "./util.js";
import { hudMsg } from "./voice.js";
import { runCine, EASE } from "./cine.js";
import { oform, show, ICONS } from "./forms.js";
import { spawnBrute } from "./enemy.js";
import { spawnVillain, VPOWERS } from "./villain.js";
import { flashBeam, tinted } from "./beams.js";

// ------------------------------------------------------------------ Resolve
const GAIN = { mob: 1, "origin:rift_brute": 3, "origin:villain": 5, "origin:null": 15 };
export function gainResolve(p, dead) {
  const h = hero(p);
  if (!h.awakened) return;
  let n = GAIN[dead.typeId] ?? 0;
  if (!n) { try { const fam = dead.getComponent("minecraft:type_family")?.getTypeFamilies?.() ?? []; if (fam.includes("monster")) n = GAIN.mob; } catch { } }
  if (dead.typeId === "origin:villain") { try { if (dead.getDynamicProperty("origin:nemesis")) n = 10; } catch { } }
  if (!n) return;
  const before = trialReady(h);
  h.resolve = (h.resolve ?? 0) + n;
  markDirty(p);
  // no Trials any more: enough Resolve and you simply climb (one stage at a time, with the cinematic)
  if (trialReady(h) && !RT(p).ascending && !RT(p).cine) {
    RT(p).ascending = true;
    h.stage = stageOf(h) + 1;
    saveNow(p);
    ascension(p, h.stage).finally(() => { RT(p).ascending = false; });
  }
}
export function trialReady(h) {
  const s = stageOf(h);
  return s < STAGES.length - 1 && (h.resolve ?? 0) >= STAGES[s + 1].resolve;
}

// ------------------------------------------------------------------ the Trials (index = the stage you're trying to reach)
// waves: arrays of spawners; goal: "clear" (beat every wave) or "form" (a technique test on a dummy)
const TRIALS = [
  null,
  { name: "Trial of Will", line: "Fear only wins if you stop. Don't stop.", time: 240, waves: [["brute", "brute"], ["brute", "villain"]] },
  { name: "Trial of Form", line: "Power without shape is noise. Show me shape.", time: 150, goal: "form" },
  { name: "Trial of Fear", line: "This is what you're afraid of becoming. Beat it.", time: 240, waves: [["dread"]] },
  { name: "Trial of Self", line: "Everything you can do, it can do. So be better.", time: 240, waves: [["mirror"]] },
  { name: "Trial of the Apex", line: "Everything at once. The way it will really happen.", time: 360, waves: [["brute", "brute"], ["villain", "villain"], ["mirror"]] },
];
const trials = new Map(); // playerId -> state

export async function startTrial(p) {
  const h = hero(p), r = RT(p);
  if (!h.awakened) return;
  if (trials.has(p.id)) { hudMsg(p, "§7You're already in a Trial."); return; }
  if (!trialReady(h)) {
    const s = stageOf(h);
    if (s >= STAGES.length - 1) { hudMsg(p, "§cYou are at the Apex. §7There is no higher."); return; }
    hudMsg(p, `§7Not yet. §fResolve ${h.resolve ?? 0}/${STAGES[s + 1].resolve}§7 - win more fights.`, 60);
    return;
  }
  if (r.cine || r.traveling || r.caged || r.station) return;
  const target = stageOf(h) + 1;
  const T = TRIALS[target];
  const iw = await import("./innerworld.js");
  if (!iw.inIW(p)) {
    await iw.enter(p, { quiet: true });
    for (let i = 0; i < 200 && !iw.inIW(p); i++) await system.waitTicks(5);
    if (!iw.inIW(p)) { msg(p, "§7The Trial needs you in your Inner World."); return; }
    await system.waitTicks(30);
  }
  const C0 = iw.centerOf(p);
  const st = { p, target, T, wave: -1, foes: [], until: 0, center: { ...p.location }, C0, started: now() };
  trials.set(p.id, st);
  r.trial = { forms: new Set(), combos: 0 };
  // the opening shot: your guardian names the Trial
  await runCine(p, async (c) => {
    const base = { ...p.location };
    const f = V.flat(p.getViewDirection());
    c.cam(at(base, -f.x * 6 + f.z * 3, 4, -f.z * 6 - f.x * 3), at(base, 0, 1.4, 0));
    c.say(`§6${T.line}`, 70);
    sound(p.dimension, "mob.evocation_illager.prepare_summon", base, 0.8, 0.8);
    for (let i = 0; i < 10; i++) { fx(p.dimension, "origin:pillar", at(base, Math.cos(i) * 6, 0, Math.sin(i) * 6), C.gold, 1); await c.wait(4); }
    c.cam(at(base, f.x * 2.5, 1.7, f.z * 2.5), at(base, 0, 1.6, 0), 1.2, EASE.InOutSine);
    await c.wait(26);
  });
  try { p.onScreenDisplay.setTitle(`§6§l${T.name.toUpperCase()}`, { fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 15, subtitle: `§7${STAGES[target - 1].name} → ${STAGES[target].name}` }); r.titleUntil = now() + 70; } catch { }
  st.until = now() + T.time * 20;
  if (T.goal === "form") {
    try {
      const f = V.flat(p.getViewDirection());
      const d = p.dimension.spawnEntity("origin:training_dummy", at(p.location, f.x * 4, 0, f.z * 4));
      d.addTag("origin_trial"); d.nameTag = "§6Trial Construct";
      st.foes.push(d);
    } catch { }
    msg(p, "§6Trial of Form: §7use §f4 different forms§7 and land §f2 combos§7 (open your Move Forge → Combos to see them).");
  } else nextWave(st);
}

function spawnFoe(st, kind) {
  const p = st.p, dim = p.dimension, h = hero(p);
  const a = Math.random() * Math.PI * 2;
  const loc = at(st.center, Math.cos(a) * 7, 0.2, Math.sin(a) * 7);
  let e = null;
  if (kind === "brute") e = spawnBrute(dim, loc);
  else if (kind === "villain") e = spawnVillain(dim, loc, null, null);
  else if (kind === "dread") {
    const pw = VPOWERS[Math.floor(Math.random() * VPOWERS.length)];
    e = spawnVillain(dim, loc, null, null, { owner: "trial", base: `Dread of ${p.name}`, power: pw, power2: VPOWERS.find((k) => k !== pw), level: 2, scarWord: "Unspoken" });
  } else if (kind === "mirror") {
    const pw = VPOWERS.includes(h.power) ? h.power : "stretch";
    e = spawnVillain(dim, loc, null, null, { owner: "trial", base: `Reflection of ${p.name}`, power: pw, power2: VPOWERS.find((k) => k !== pw), level: 2, scarWord: "Unbroken" });
  }
  if (e) { try { e.addTag("origin_trial"); } catch { } st.foes.push(e); }
}
function nextWave(st) {
  st.wave++;
  const waves = st.T.waves;
  if (st.wave >= waves.length) return win(st);
  for (const k of waves[st.wave]) spawnFoe(st, k);
  hudMsg(st.p, `§6Wave ${st.wave + 1}/${waves.length}`, 40);
  sound(st.p.dimension, "mob.evocation_illager.prepare_summon", st.p.location, 1, 0.9);
}
function clear(st) { for (const e of st.foes) { try { if (valid(e)) e.remove(); } catch { } } st.foes = []; }
function fail(st, why) {
  trials.delete(st.p.id);
  clear(st);
  if (valid(st.p)) {
    RT(st.p).trial = null;
    msg(st.p, `§c§lTRIAL FAILED §r§7- ${why}. §8You can try again whenever you're ready.`);
    try { st.p.onScreenDisplay.setTitle("§cnot yet", { fadeInDuration: 5, stayDuration: 30, fadeOutDuration: 15, subtitle: `§7${why}` }); } catch { }
  }
}
async function win(st) {
  trials.delete(st.p.id);
  clear(st);
  const p = st.p;
  if (!valid(p)) return;
  RT(p).trial = null;
  const h = hero(p);
  h.stage = st.target;
  saveNow(p);
  await ascension(p, st.target);
}
// every 10 ticks
export function tickTrials() {
  const t = now();
  for (const [id, st] of trials) {
    const p = st.p;
    if (!valid(p)) { trials.delete(id); clear(st); continue; }
    if (!st.until) continue;                       // still in the opening cinematic
    if (p.dimension.id !== "origin:inner_world") { fail(st, "you left your Inner World"); continue; }
    try { if ((p.getComponent("minecraft:health")?.currentValue ?? 1) <= 0) { fail(st, "you fell"); continue; } } catch { }
    if (t > st.until) { fail(st, "time ran out"); continue; }
    const left = Math.ceil((st.until - t) / 20);
    if (st.T.goal === "form") {
      const tr = RT(p).trial;
      const forms = tr?.forms?.size ?? 0, combos = tr?.combos ?? 0;
      RT(p).trialLine = `§6${st.T.name} §7forms §f${Math.min(4, forms)}/4 §7combos §f${Math.min(2, combos)}/2 §8${left}s`;
      if (forms >= 4 && combos >= 2) win(st);
      continue;
    }
    st.foes = st.foes.filter((e) => valid(e));
    RT(p).trialLine = `§6${st.T.name} §7wave §f${st.wave + 1}/${st.T.waves.length} §7foes §f${st.foes.length} §8${left}s`;
    if (!st.foes.length) nextWave(st);
  }
}
export function trialLine(p) { return trials.has(p.id) ? RT(p).trialLine ?? null : null; }
export function onTrialDeath(p) { const st = trials.get(p.id); if (st) fail(st, "you fell"); }

// ------------------------------------------------------------------ ascension (stage up) cinematic
const UNLOCK = [
  "",
  "Wave & Leap forms · Frost · Pierce · Pull · power budget 11",
  "Nova form · Storm · Echo · Detonate · power budget 12",
  "Volley form · Drain · Shatter · AWAKENED FORM · power budget 13",
  "power budget 14 · Awakened Form lasts longer",
  "ULTIMATE · power budget 15",
];
export async function ascension(p, s) {
  const S = STAGES[s];
  const A = ARCH[hero(p).arch];
  await runCine(p, async (c) => {
    const base = { ...p.location }, dim = p.dimension;
    try { p.addEffect("slowness", 120, { amplifier: 10, showParticles: false }); p.addEffect("levitation", 30, { amplifier: 0, showParticles: false }); } catch { }
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 1.4;
      c.cam(at(base, Math.cos(a) * 4.5, 0.8 + i * 0.15, Math.sin(a) * 4.5), at(base, 0, 1.6, 0), i ? 0.3 : 0, EASE.Linear);
      fx(dim, "origin:pillar", base, A?.rgb ?? C.gold, 1);
      fx(dim, "origin:rise", at(base, (Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2), C.gold, 1);
      if (i === 2) c.say(`§7${S.name}...`, 40);
      await c.wait(6);
    }
    sound(dim, "random.totem", base, 1, 1);
    fx(dim, "origin:shockwave", at(base, 0, 0.05, 0), C.gold, 1, { radius: 6 });
    fx(dim, "origin:burst", at(base, 0, 1.2, 0), C.white, 1);
    c.fade(0, 0.15, 0.6, { red: 1, green: 0.95, blue: 0.8 });
    c.shake(0.5, 0.6);
    await c.wait(30);
  });
  try { p.removeEffect("slowness"); } catch { }
  try { p.onScreenDisplay.setTitle(`${S.col}§l${S.name.toUpperCase()}`, { fadeInDuration: 5, stayDuration: 70, fadeOutDuration: 20, subtitle: `§7${UNLOCK[s]}` }); RT(p).titleUntil = now() + 90; } catch { }
  msg(p, `${S.col}§lYOU HAVE BECOME ${S.name.toUpperCase()}. §r§7Unlocked: ${UNLOCK[s]}.`);
  if (s === 3) msg(p, `§b§lAWAKENED FORM: §r§f${FORMS[hero(p).arch]?.name}§7. Fill your Surge in fights, then §fsneak + use the Power Focus§7.`);
  if (s === 5) msg(p, `§c§lULTIMATE: §r§f${ULTS[hero(p).arch]?.name}§7. Full Surge, then §fsneak + use the Power Focus§7.`);
}

// ------------------------------------------------------------------ Surge
export function onHurtSurge(p) {
  const h = hero(p);
  if (!h.awakened || stageOf(h) < 3) return;
  h.surge = Math.min(100, (h.surge ?? 0) + 2);
}
export function surgeLine(p) {
  const h = hero(p);
  if (!h.awakened || stageOf(h) < 3) return null;
  const r = RT(p), t = now();
  if ((r.awakenUntil ?? 0) > t) return `§b§l${FORMS[h.arch]?.name ?? "AWAKENED"} §r§f${Math.ceil((r.awakenUntil - t) / 20)}s`;
  const s = Math.floor(h.surge ?? 0);
  const ready = s >= 100;
  return `§f${ICON.star} §6SURGE §f${bar(BAR.gold, s / 100, 6)} ${ready ? `§e§l${stageOf(h) >= 5 ? "ULTIMATE" : "AWAKEN"} §r§7(sneak+Focus)` : `§7${s}%`}`;
}
// called by the Power Focus on sneak + use; returns true if it used the Surge
export function trySurge(p) {
  const h = hero(p);
  if (!h.awakened || stageOf(h) < 3 || (h.surge ?? 0) < 100) return false;
  if ((RT(p).awakenUntil ?? 0) > now() && stageOf(h) < 5) return false;
  if (stageOf(h) >= 5) ultimate(p); else awaken(p);
  return true;
}

// ------------------------------------------------------------------ Awakened Forms
export const FORMS = {
  brawler: { name: "TITANBORN", col: hexToRgb("#FFB347"), line: "Your body remembers it was never small." },
  energy: { name: "STARFORGED", col: hexToRgb("#9FF4FF"), line: "Every cell lights up at once." },
  shadow: { name: "NIGHTBOUND", col: hexToRgb("#7A3FD1"), line: "The dark stops hiding you. It becomes you." },
};
export async function awaken(p) {
  const h = hero(p), r = RT(p);
  const F = FORMS[h.arch] ?? FORMS.brawler;
  h.surge = 0;
  markDirty(p);
  const secs = stageOf(h) >= 4 ? 30 : 20;
  try { p.playAnimation("animation.origin.awaken.roar", { controller: "origin_awaken", stopExpression: "0", blendOutTime: 0.3 }); } catch { }
  await runCine(p, async (c) => {
    const base = { ...p.location }, dim = p.dimension, f = V.flat(p.getViewDirection());
    c.cam(at(base, f.x * 3.2, 0.6, f.z * 3.2), at(base, 0, 1.5, 0));
    c.say(`§7${F.line}`, 40);
    for (let i = 0; i < 8; i++) { fx(dim, "origin:aura", base, F.col, 1); fx(dim, "origin:rise", base, F.col, 1); await c.wait(3); }
    sound(dim, "mob.enderdragon.growl", base, 0.6, 1.4);
    fx(dim, "origin:shockwave", at(base, 0, 0.05, 0), F.col, 1, { radius: 7 });
    fx(dim, "origin:burst", at(base, 0, 1.2, 0), F.col, 1);
    c.cam(at(base, f.x * 1.9, 1.7, f.z * 1.9), at(base, 0, 1.6, 0), 0.4, EASE.OutCubic);
    c.shake(0.6, 0.5);
    await c.wait(14);
  }, { skippable: false });
  try { p.playAnimation("animation.origin.fly.end", { controller: "origin_awaken", stopExpression: "1", blendOutTime: 0.3 }); } catch { }
  r.awakenUntil = now() + secs * 20;
  try {
    p.addEffect("strength", secs * 20, { amplifier: h.arch === "brawler" ? 2 : 1, showParticles: false });
    p.addEffect("speed", secs * 20, { amplifier: h.arch === "shadow" ? 2 : 1, showParticles: false });
    p.addEffect("resistance", secs * 20, { amplifier: 1, showParticles: false });
  } catch { }
  p.onScreenDisplay.setTitle(`§l${F.name}`, { fadeInDuration: 2, stayDuration: 40, fadeOutDuration: 15, subtitle: "§7awakened form" });
  r.titleUntil = now() + 50;
}
// every 2 ticks: the aura, the energy surge, and the crash when it ends
export function tickAwakened() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const r = RT(p);
    if (!r.awakenUntil) continue;
    const h = hero(p);
    const F = FORMS[h.arch] ?? FORMS.brawler;
    if (t < r.awakenUntil) {
      if (t % 4 === 0) fx(p.dimension, "origin:aura", p.location, F.col, 1);
      if (t % 6 === 0) fx(p.dimension, "origin:rise", at(p.location, (Math.random() - 0.5), 0, (Math.random() - 0.5)), F.col, 1);
      if (h.arch === "energy" && t % 10 === 0) { h.energy = Math.min(h.energy + 4, 999); markDirty(p); }
      if (h.arch === "shadow" && t % 40 === 0) { try { p.addEffect("invisibility", 14, { showParticles: false }); } catch { } }
    } else {
      r.awakenUntil = 0;
      try { p.addEffect("slowness", 100, { amplifier: 0, showParticles: false }); p.addEffect("weakness", 100, { amplifier: 0, showParticles: false }); } catch { }
      hudMsg(p, "§7The form fades. §8You're drained for a moment.", 50);
      fx(p.dimension, "origin:void_swirl", at(p.location, 0, 1, 0), F.col, 1);
    }
  }
}

// ------------------------------------------------------------------ Ultimates (Apex)
export const ULTS = {
  brawler: { name: "WORLDBREAKER" },
  energy: { name: "SUPERNOVA" },
  shadow: { name: "ECLIPSE" },
};
function foes(p, c, R) {
  let list = [];
  try { list = p.dimension.getEntities({ location: c, maxDistance: R, excludeFamilies: ["player", "inanimate"], excludeTypes: ["minecraft:item", "minecraft:xp_orb", "origin:float_text", "origin:manifestation", "origin:exo_piece"] }); } catch { }
  return list.filter((e) => e.id !== p.id && valid(e) && e.getComponent("minecraft:health"));
}
function hurt(p, e, n) { try { e.applyDamage(n, { cause: EntityDamageCause.entityAttack, damagingEntity: p }); } catch { } }
export async function ultimate(p) {
  const h = hero(p);
  h.surge = 0;
  markDirty(p);
  const U = ULTS[h.arch] ?? ULTS.brawler;
  const dim = p.dimension;
  try { p.onScreenDisplay.setTitle(`§c§l${U.name}`, { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10, subtitle: " " }); RT(p).titleUntil = now() + 40; } catch { }
  if (h.arch === "brawler") {
    // leap into the sky, then come down like a meteor
    try { p.applyKnockback({ x: 0, z: 0 }, 2.4); } catch { }
    sound(dim, "mob.enderdragon.flap", p.location, 1.5, 0.6);
    for (let i = 0; i < 22; i++) { await system.waitTicks(1); fx(dim, "origin:trail", p.location, C.ember, 1); }
    try { p.applyKnockback({ x: 0, z: 0 }, -3.5); } catch { }
    for (let i = 0; i < 20 && valid(p) && !p.isOnGround; i++) { await system.waitTicks(1); fx(dim, "origin:boom_fire", p.location, C.ember, 0.6); }
    const c = { ...p.location };
    for (let k = 0; k < 3; k++) fx(dim, "origin:shockwave", at(c, 0, 0.05, 0), k ? C.white : C.ember, 1, { radius: 3 + k * 3 });
    fx(dim, "origin:boom_fire", c, C.ember, 1); fx(dim, "origin:boom_smoke", c, C.grey, 1); fx(dim, "origin:debris", c, C.dust, 1);
    sound(dim, "random.explode", c, 2, 0.5); sound(dim, "mob.warden.sonic_boom", c, 1.5, 0.6);
    for (const pl of dim.getPlayers({ location: c, maxDistance: 30 })) { try { pl.runCommand("camerashake add @s 1 0.8 positional"); } catch { } }
    for (const e of foes(p, c, 8)) { hurt(p, e, 22); const d = V.flat(V.sub(e.location, c)); try { e.applyKnockback({ x: d.x * 2, z: d.z * 2 }, 1.1); } catch { } }
  } else if (h.arch === "energy") {
    try { p.addEffect("levitation", 40, { amplifier: 1, showParticles: false }); p.addEffect("resistance", 80, { amplifier: 4, showParticles: false }); } catch { }
    sound(dim, "beacon.activate", p.location, 2, 0.6);
    for (let i = 0; i < 30; i++) {
      await system.waitTicks(1);
      const c = at(p.location, 0, 1, 0);
      const a = i * 0.6, R = 5 - i * 0.15;
      fx(dim, "origin:dot", at(c, Math.cos(a) * R, Math.sin(i) * 1.5, Math.sin(a) * R), C.cyan, 1);
      fx(dim, "origin:charge", c, C.white, 1);
    }
    const c = at(p.location, 0, 1, 0);
    for (let s2 = 0; s2 < 12; s2++) { const a = (s2 / 12) * Math.PI * 2; flashBeam(dim, c, at(c, Math.cos(a) * 9, (Math.random() - 0.3) * 3, Math.sin(a) * 9), tinted("laser", C.cyan), { life: 0.4 }); }
    fx(dim, "origin:boom_fire", c, C.cyan, 1); fx(dim, "origin:shockwave", c, C.white, 1, { radius: 9 });
    sound(dim, "random.explode", c, 2, 1.2); sound(dim, "mob.warden.sonic_boom", c, 1.5, 1.2);
    for (const e of foes(p, c, 9)) { hurt(p, e, 20); try { e.setOnFire(6, true); } catch { } }
  } else {
    // ECLIPSE: the lights go out for everyone around you, then you're everywhere at once
    const c0 = { ...p.location };
    const list = foes(p, c0, 14).slice(0, 7);
    for (const e of list) { try { e.addEffect("darkness", 120, { showParticles: false }); e.addEffect("slowness", 80, { amplifier: 3 }); } catch { } }
    for (const pl of dim.getPlayers({ location: c0, maxDistance: 20 })) { try { pl.addEffect("darkness", 60, { showParticles: false }); } catch { } }
    fx(dim, "origin:void_swirl", at(c0, 0, 1, 0), C.violet, 1); fx(dim, "origin:shockwave", at(c0, 0, 0.05, 0), C.violet, 1, { radius: 14 });
    sound(dim, "mob.warden.emerge", c0, 1, 0.6);
    await system.waitTicks(10);
    for (const e of list) {
      if (!valid(e) || !valid(p)) continue;
      const f = V.flat(V.sub(e.location, p.location));
      try { p.teleport(at(e.location, -f.x * 1.2, 0, -f.z * 1.2), { facingLocation: e.getHeadLocation() }); } catch { }
      line(dim, "origin:trail", at(e.location, -1.5, 2, 0), at(e.location, 1.5, 0.2, 0), C.violet, 0.3, 1);
      fx(dim, "origin:void_swirl", e.getHeadLocation(), C.violet, 1);
      sound(dim, "item.trident.riptide_1", e.location, 0.8, 1.6);
      hurt(p, e, 14);
      await system.waitTicks(5);
    }
    try { p.teleport(c0); } catch { }
  }
}

// ------------------------------------------------------------------ Codex page
export async function trialsPage(p) {
  const h = hero(p);
  const s = stageOf(h);
  const lines = STAGES.map((S, i) => `${i === s ? "§f» " : i < s ? "§a✔ " : "§8  "}${S.col}${S.name}§r${i > 0 ? ` §8(${S.resolve} Resolve)` : ""}`);
  const next = STAGES[s + 1];
  const body = [
    `§7Stage: ${STAGES[s].col}§l${STAGES[s].name}§r  §7Resolve: §f${h.resolve ?? 0}${next ? `/${next.resolve}` : ""}  §7Budget: §f${budgetOf(h)}`,
    "", ...lines, "",
    next ? `§7Earn Resolve by fighting: monsters 1, Rift Brutes 3, villains 5, nemeses 10, NULL 15. You climb the moment you have enough.` : "§cYou stand at the Apex.",
    s >= 3 ? `§bAwakened Form: §f${FORMS[h.arch]?.name}§7${s >= 5 ? `   §cUltimate: §f${ULTS[h.arch]?.name}` : ""} §8(full Surge + sneak + Focus)` : "§8Awakened Form unlocks at Ascendant. Ultimate at Apex.",
  ].join("\n");
  const f = oform("menu", "Stages", body);
  f.button("Back", ICONS + "act_back");
  await show(p, f);
}
