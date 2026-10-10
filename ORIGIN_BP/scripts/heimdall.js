// ORIGIN v0.24 - heimdall.js
// HEIMDALL, the all-seeing gatekeeper, and the EINHERJAR, Asgard's guard.
//  Heimdall stands at the Bifrost observatory with his great sword planted in front of him. He greets everyone who
//   arrives (by name - he saw you coming), and he GUARDS ASGARD: anything hostile that sets foot in the realm, he goes
//   for, and at range his sword throws a blade of Bifrost light. He can't be hurt. Strike him and he warns you; strike
//   him three times and he sends you back to Midgard himself.
//  Talk to him (interact):
//   - Open the Bifrost: home to Midgard (no Keystone needed)
//   - Heimdall's Sight: for three minutes, wherever you are, everything hostile near you is marked for you
//   - "What do you see?": what's happening in the realm (raids, the hammer, who's worthy)
//  The Einherjar (eight of them) hold posts at the bridges, the plaza, the arena and the Hall of Heroes: they fight
//   anything hostile and come back to their post. Fallen guards are replaced after five minutes.
//  RAIDS: while anyone is in Asgard, every so often the realm's edge tears open and rift-spawn pour across. Heimdall
//   calls it out ("to arms!"). Clear them all and Asgard pays you for it.
import { world, system, EntityDamageCause, ItemStack, MolangVariableMap } from "@minecraft/server";
import { hero, RT, markDirty, saveNow } from "./data.js";
import { V, at, valid, fx, sound, psound, now, msg, hexToRgb, yawTo } from "./util.js";
import { hudMsg } from "./voice.js";
import { oform, show, ICONS } from "./forms.js";
import { ASGARD, useBifrost, asgardBuilt, PLAZA, ARENA, HEROES, THRONE, LANDS } from "./asgard.js";
import { drawBeam, STYLES } from "./beams.js";
import { addHonor, worthy } from "./mjolnir.js";

export const HEIMDALL = "origin:heimdall", EINHERJAR = "origin:einherjar";
const HEIM_POST = { x: 4.5, y: 101, z: -60.5 };   // beside the Bifrost landing, looking down the bridge
const POSTS = [
  { x: -4.5, y: 101, z: -27.5 }, { x: 4.5, y: 101, z: -27.5 },                               // the rainbow bridge's foot
  { x: -17.5, y: 101, z: 33.5 }, { x: -10.5, y: 101, z: 33.5 },                              // the city bridge
  { x: PLAZA.x - 8.5, y: 101, z: PLAZA.z - 13.5 }, { x: PLAZA.x + 8.5, y: 101, z: PLAZA.z - 13.5 },
  { x: ARENA.x + 16.5, y: 101, z: 2.5 }, { x: HEROES.x - 12.5, y: 101, z: 2.5 },
];
const GOLD = hexToRgb("#ffd36a"), WHITE = { red: 1, green: 1, blue: 1 }, RED = hexToRgb("#ff3a2a");
const RAINBOW = [[1, 0.25, 0.25], [1, 0.6, 0.15], [1, 0.9, 0.2], [0.4, 0.9, 0.35], [0.35, 0.7, 1], [0.35, 0.4, 0.95], [0.7, 0.35, 1]].map(([r, g, b]) => ({ red: r, green: g, blue: b }));
const asgard = () => { try { return world.getDimension(ASGARD); } catch { return null; } };
const inAsgard = (p) => { try { return p.dimension.id === ASGARD; } catch { return false; } };
const say = (p, text) => msg(p, `§6[Heimdall] §f${text}`);
const sayAll = (text) => { for (const p of world.getAllPlayers()) if (inAsgard(p)) say(p, text); };
const hostile = (e) => { try { return e.matches({ families: ["monster"] }) && !e.matches({ families: ["asgardian"] }); } catch { return /zombie|skeleton|creeper|spider|stray|husk|witch|pillager|vindicator|evoker|rift_brute|villain|blaze|wither/.test(e.typeId); } };

// ------------------------------------------------------------------ keeping them in the realm
const respawnAt = new Map();   // post index (-1 = Heimdall) -> tick a replacement may arrive
function ensure(dim, t) {
  if (!asgardBuilt("observatory")) return;
  let list = [];
  try { list = dim.getEntities({ type: HEIMDALL }); } catch { return; }
  if (!list.length) { try { if (dim.getBlock(HEIM_POST)) spawnAt(dim, HEIMDALL, HEIM_POST, -1); } catch { } }
  else for (const e of list.slice(1)) { try { e.remove(); } catch { } }   // only ever one Heimdall
  let guards = [];
  try { guards = dim.getEntities({ type: EINHERJAR }); } catch { }
  const have = new Set(guards.map((g) => { try { return g.getDynamicProperty("origin:post"); } catch { return undefined; } }));
  POSTS.forEach((post, i) => {
    if (have.has(i) || (respawnAt.get(i) ?? 0) > t) return;
    const needs = i < 2 ? "guardians" : i < 4 ? "bridge_north" : i < 6 ? "city_plaza" : i === 6 ? "west_arena" : "east_heroes";
    if (!asgardBuilt(needs)) return;
    try { if (dim.getBlock(post)) spawnAt(dim, EINHERJAR, post, i); } catch { }
  });
}
function spawnAt(dim, type, post, i) {
  let e = null;
  try { e = dim.spawnEntity(type, post); } catch { return null; }
  try { e.setDynamicProperty("origin:post", i); e.nameTag = type === HEIMDALL ? "§6Heimdall" : "§cEinherjar"; e.setRotation({ x: 0, y: type === HEIMDALL ? 180 : yawTo(post, PLAZA) }); } catch { }
  fx(dim, "origin:bifrost_streak", at(post, 0, 2, 0), RAINBOW[(i + 7) % 7], 0.9, { n: 6, r: 1, spd: 20 });
  return e;
}
export function onAsgardianDeath(e) {
  let i; try { i = e.getDynamicProperty("origin:post"); } catch { }
  if (typeof i === "number") respawnAt.set(i, now() + 20 * 300);
}

// ------------------------------------------------------------------ every 10 ticks
const greeted = new Map();      // playerId -> last greeting tick
export function tickHeimdall() {
  const t = now(), dim = asgard();
  if (!dim) return;
  const here = world.getAllPlayers().filter(inAsgard);
  for (const p of world.getAllPlayers()) tickSight(p, t);
  if (!here.length) return;
  if (t % 100 === 0) ensure(dim, t);
  let heim = null;
  try { heim = dim.getEntities({ type: HEIMDALL })[0] ?? null; } catch { }
  // greetings
  for (const p of here) {
    const r = RT(p);
    if (!r.asgGreet && heim && V.dist(p.location, heim.location) < 24) {
      r.asgGreet = true;
      const h = hero(p), first = !h.metHeimdall;
      h.metHeimdall = true; markDirty(p);
      system.runTimeout(() => valid(p) && say(p, first ? `I have watched your coming since you first lifted that Keystone, ${p.name}. Welcome to Asgard. §7(Talk to me - I keep the Bifrost.)` : `Welcome back, ${p.name}.`), 30);
      try { heim.setRotation({ x: 0, y: yawTo(heim.location, p.location) }); } catch { }
    }
  }
  for (const p of world.getAllPlayers()) if (!inAsgard(p)) RT(p).asgGreet = false;
  // the guard: leash to posts, Heimdall's sword-light at range
  const all = []; try { all.push(...dim.getEntities({ type: HEIMDALL }), ...dim.getEntities({ type: EINHERJAR })); } catch { }
  for (const e of all) {
    let i; try { i = e.getDynamicProperty("origin:post"); } catch { }
    const post = i === -1 ? HEIM_POST : POSTS[i];
    if (!post) continue;
    const far = V.dist(e.location, post);
    if (far > (i === -1 ? 22 : 18) || e.location.y < 70) {
      fx(dim, "origin:bifrost_streak", at(e.location, 0, 1, 0), GOLD, 0.8, { n: 4, r: 0.8, spd: 20 });
      try { e.teleport(post); } catch { }
      fx(dim, "origin:bifrost_streak", at(post, 0, 1, 0), GOLD, 0.8, { n: 4, r: 0.8, spd: 20 });
    }
  }
  if (heim && t % 40 === 0) heimdallStrike(heim);
  tickRaid(dim, here, t);
}
// at range, Hofund throws a blade of Bifrost light at the nearest hostile thing in sight of him
function heimdallStrike(heim) {
  let foes = [];
  try { foes = heim.dimension.getEntities({ location: heim.location, maxDistance: 30, families: ["monster"] }).filter((e) => hostile(e) && V.dist(e.location, heim.location) > 4); } catch { }
  const tg = foes.sort((a, b) => V.dist(a.location, heim.location) - V.dist(b.location, heim.location))[0];
  if (!tg) return;
  try { heim.setRotation({ x: 0, y: yawTo(heim.location, tg.location) }); heim.playAnimation("animation.origin.asgardian.raise", { blendOutTime: 0.2 }); } catch { }
  const from = at(heim.location, 0, 2.6, 0);
  system.runTimeout(() => {
    if (!valid(heim) || !valid(tg)) return;
    const to = at(tg.location, 0, 1, 0);
    drawBeam(heim.dimension, from, to, { ...STYLES.rainbow, width: 0.32, coreW: 0.09 }, now(), { cols: RAINBOW, life: 0.3 });
    fx(heim.dimension, "origin:shockwave", at(tg.location, 0, 0.2, 0), GOLD, 1, { radius: 2 });
    sound(heim.dimension, "origin.sfx.thunderhit", to, 1.3, 0.8);
    try { tg.applyDamage(14, { cause: EntityDamageCause.entityAttack, damagingEntity: heim }); } catch { }
  }, 16);
}
// Asgardians swinging land with a flourish (the swing animation, a gold spark)
export function onAsgardianHit(attacker, target) {
  try { attacker.playAnimation("animation.origin.asgardian.swing", { blendOutTime: 0.1 }); } catch { }
  fx(attacker.dimension, "origin:spark", at(target.location, 0, 1.2, 0), GOLD, 1);
  sound(attacker.dimension, "origin.sfx.sweep", target.location, 1, 0.6);
}
// someone struck Heimdall: twice he warns, the third time he opens the Bifrost under them
export function onHeimdallStruck(heim, p) {
  if (p?.typeId !== "minecraft:player") return;
  const r = RT(p), t = now();
  r.heimStrikes = (r.heimStrikeAt ?? -9999) > t - 1200 ? (r.heimStrikes ?? 0) + 1 : 1;
  r.heimStrikeAt = t;
  try { heim.setRotation({ x: 0, y: yawTo(heim.location, p.location) }); } catch { }
  if (r.heimStrikes === 1) say(p, "I would not do that.");
  else if (r.heimStrikes === 2) { say(p, "I said, I would not do that. §cOnce more and you go home.§f"); try { p.applyKnockback({ x: (p.location.x - heim.location.x) * 0.3, z: (p.location.z - heim.location.z) * 0.3 }, 0.5); } catch { } }
  else {
    say(p, "You are not welcome in Asgard today.");
    try { heim.playAnimation("animation.origin.asgardian.raise", { blendOutTime: 0.2 }); } catch { }
    r.heimStrikes = 0;
    system.runTimeout(() => valid(p) && inAsgard(p) && useBifrost(p), 20);
  }
}

// ------------------------------------------------------------------ talking to him
export async function talkHeimdall(p, heim) {
  const h = hero(p), r = RT(p), t = now();
  const sightReady = (h.sightCd ?? 0) <= Date.now();
  const f = oform("menu", "HEIMDALL", "§7The gatekeeper's golden eyes look through you, and past you, and on to the edge of everything.\n§f\"Speak.\"");
  f.button("Open the Bifrost\n§8Home to Midgard", ICONS + "x_up_thrusters");
  f.button(sightReady ? "Heimdall's Sight\n§8Three minutes of his eyes, wherever you go" : `Heimdall's Sight\n§8Again in ${Math.ceil(((h.sightCd ?? 0) - Date.now()) / 60000)} min`, ICONS + "x_up_sensors");
  f.button("\"What do you see?\"\n§8News of the realm", ICONS + "x_upgrade");
  f.button("§7Farewell", ICONS + "act_back");
  try { heim?.setRotation({ x: 0, y: yawTo(heim.location, p.location) }); } catch { }
  const res = await show(p, f);
  if (!res || res.canceled || !valid(p)) return;
  if (res.selection === 0) {
    say(p, "Then go. The Bifrost will bring you back whenever you call it.");
    try { heim?.playAnimation("animation.origin.asgardian.raise", { blendOutTime: 0.2 }); } catch { }
    system.runTimeout(() => valid(p) && inAsgard(p) && useBifrost(p), 24);
  } else if (res.selection === 1) {
    if (!sightReady) { say(p, "My sight is not a lantern to be swung about. Ask me again later."); return; }
    h.sightCd = Date.now() + 20 * 60 * 1000; markDirty(p);
    r.sightUntil = t + 20 * 180;
    say(p, "Very well. For a while, you will see what I see.");
    psound(p, "origin.sfx.chime", 0.7, 1);
    try { p.camera.fade({ fadeTime: { fadeInTime: 0.1, holdTime: 0.1, fadeOutTime: 0.8 }, fadeColor: { red: 1, green: 0.85, blue: 0.45 } }); } catch { }
  } else if (res.selection === 2) say(p, news(p));
}
function news(p) {
  const bits = [];
  if (raid) bits.push(`Rift-spawn on the ${raid.where} shore - ${raid.ids.filter((id) => { try { return valid(world.getEntity(id)); } catch { return false; } }).length} still standing.`);
  else bits.push("The realm is quiet. For now.");
  try { bits.push(worthy(p) ? "The hammer in the palace hall knows your name." : "The hammer in the palace hall waits for someone worthy. It is not you. Yet."); } catch { }
  bits.push("Odin's vault lies beneath the throne hall, in the city to the north. Take what is left there - he would have wanted it used.");
  return bits.join(" ");
}

// ------------------------------------------------------------------ Heimdall's Sight (works in any realm)
function tickSight(p, t) {
  const r = RT(p);
  if (!((r.sightUntil ?? 0) > t)) return;
  if (t % 20 !== 0) return;
  let list = [];
  try { list = p.dimension.getEntities({ location: p.location, maxDistance: 40, families: ["monster"] }); } catch { }
  for (const e of list) {
    if (!hostile(e)) continue;
    try {
      const m = new MolangVariableMap(); m.setColorRGBA("variable.color", { red: 1, green: 0.8, blue: 0.3, alpha: 1 }); m.setFloat("variable.size", 0.6);
      p.spawnParticle("origin:hud_lock", at(e.getHeadLocation(), 0, 0.7, 0), m);
    } catch { }
  }
  if ((r.sightUntil - t) <= 20) hudMsg(p, "§6Heimdall's Sight fades.", 40);
}

// ------------------------------------------------------------------ raids
let raid = null;   // {where, ids, until, players:Set}
let nextRaid = 0;
const SHORES = () => [
  { where: "eastern", c: { x: LANDS[2].cx + 24, y: 101, z: LANDS[2].cz + 18 } },
  { where: "western", c: { x: LANDS[1].cx - 20, y: 101, z: LANDS[1].cz + 20 } },
  { where: "northern", c: { x: LANDS[0].cx + 22, y: 101, z: LANDS[0].cz + 10 } },
  { where: "palace", c: { x: 18, y: 101, z: 18 } },
];
const RAIDERS = ["origin:rift_brute", "minecraft:zombie", "minecraft:husk", "minecraft:skeleton", "minecraft:stray", "minecraft:vindicator"];
function tickRaid(dim, here, t) {
  if (!nextRaid) nextRaid = t + 20 * (240 + Math.random() * 240);
  if (!raid) {
    if (t < nextRaid || !asgardBuilt("city_plaza")) return;
    nextRaid = t + 20 * (420 + Math.random() * 360);
    // they come ashore wherever the defenders are (the nearest built shore to someone in the realm)
    const ready = SHORES().filter((s) => asgardBuilt(s.where === "palace" ? "palace" : s.where === "eastern" ? "east_heroes" : s.where === "western" ? "west_arena" : "city_plaza"));
    const who = here[Math.floor(Math.random() * here.length)];
    const shore = ready.sort((a, b) => V.dist(a.c, who.location) - V.dist(b.c, who.location))[0];
    if (!shore) return;
    startRaid(dim, shore, here);
    return;
  }
  const alive = raid.ids.map((id) => { try { return world.getEntity(id); } catch { return undefined; } }).filter((e) => valid(e) && e.location.y > 60);
  for (const e of alive) if (t % 40 === 0) fx(dim, "origin:void_swirl", at(e.location, 0, 1.2, 0), RED, 0.5);
  // gone with nobody fighting them (they despawned far from everyone) doesn't count as a victory
  if (!alive.length) return endRaid(raid.killed >= Math.ceil(raid.ids.length / 2));
  if (t > raid.until) return endRaid(false, alive);
}
function startRaid(dim, shore, here) {
  const n = 4 + Math.min(6, here.length * 2);
  raid = { where: shore.where, ids: [], until: now() + 20 * 180, players: new Set(here.map((p) => p.id)), killed: 0 };
  fx(dim, "origin:shadow_portal", at(shore.c, 0, 2, 0), RED, 1, { size: 5, life: 3 });
  sound(dim, "mob.wither.spawn", shore.c, 0.7, 1);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 4;
    const type = i === 0 || (i === 5 && n > 6) ? "origin:rift_brute" : RAIDERS[1 + Math.floor(Math.random() * (RAIDERS.length - 1))];
    try { const e = dim.spawnEntity(type, at(shore.c, Math.cos(a) * d, 0, Math.sin(a) * d)); raid.ids.push(e.id); e.nameTag = "§cRift-spawn"; } catch { }
  }
  sayAll(`I see them - rift-spawn crossing onto the §c${shore.where}§f shore! §6To arms!`);
  for (const p of here) { try { p.onScreenDisplay.setTitle("§c§lASGARD IS ATTACKED", { fadeInDuration: 4, stayDuration: 40, fadeOutDuration: 12, subtitle: `§7the ${shore.where} shore - Heimdall calls you to arms` }); RT(p).titleUntil = now() + 56; } catch { } psound(p, "raid.horn", 1, 1); }
}
// a raider fell: count it if a player or an Asgardian brought it down
export function onRaiderDeath(dead, killer) {
  if (!raid || !raid.ids.includes(dead?.id)) return;
  if (killer && (killer.typeId === "minecraft:player" || killer.typeId === HEIMDALL || killer.typeId === EINHERJAR)) raid.killed++;
}
function endRaid(won, alive = []) {
  const r = raid;
  raid = null;
  if (!won) { for (const e of alive) { try { e.remove(); } catch { } } sayAll("They have fallen back into the rift. Asgard will remember who stood for her."); return; }
  sayAll("The shore is clear. §6Asgard thanks you.§f Take this - and my gratitude.");
  for (const p of world.getAllPlayers()) {
    if (!inAsgard(p)) continue;
    try {
      const c = p.getComponent("minecraft:inventory").container;
      for (const [id, n] of [["minecraft:gold_ingot", 8], ["minecraft:diamond", 2], ["origin:aetherium_ingot", 2], ["minecraft:golden_apple", 1]]) { const left = c.addItem(new ItemStack(id, n)); if (left) p.dimension.spawnItem(left, p.location); }
    } catch { }
    try { const h = hero(p); h.raidsWon = (h.raidsWon ?? 0) + 1; markDirty(p); addHonor(p, 3, "Defended Asgard"); } catch { }
    psound(p, "random.levelup", 0.8, 1);
  }
}
// /hero raid: start one now (testing)
export function forceRaid() {
  const dim = asgard(), here = world.getAllPlayers().filter(inAsgard);
  if (!dim || !here.length || raid) return false;
  startRaid(dim, SHORES()[Math.floor(Math.random() * 4)], here);
  return true;
}
export function raidLine(p) {
  if (!raid || !inAsgard(p)) return null;
  const left = raid.ids.filter((id) => { try { return valid(world.getEntity(id)); } catch { return false; } }).length;
  return `§c⚔ RAID §7- the ${raid.where} shore · §f${left}§7 left · ${Math.max(0, Math.ceil((raid.until - now()) / 20))}s`;
}
