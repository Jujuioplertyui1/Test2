// ORIGIN v0.13 - target.js
// Helmet targeting. Only the suit wearer sees it (per-player particles): a red ring around every hostile in sensor
// range with a health bar over its head, a spinning lock ring on whatever you look at, and a target panel on the
// visor (name, health, its attacks, threat level). Waypoints from the assistant are drawn here too.
import { world, MolangVariableMap } from "@minecraft/server";
import { hero, RT, BAR, bar } from "./data.js";
import { V, at, valid, now, health, hexToRgb, psound, FX_IDS } from "./util.js";
import { exoData, visorOn, statsOf, HUD_COLORS, HUD_CODES, hudIndex } from "./exo.js";
import { aiOf } from "./say.js";

const INTEL = {
  zombie: ["Zombie", "Melee 3 · calls the horde", 1], husk: ["Husk", "Melee 3 · Hunger", 1], drowned: ["Drowned", "Melee 3 · Trident 8", 2],
  zombie_villager_v2: ["Zombie Villager", "Melee 3", 1], zombie_villager: ["Zombie Villager", "Melee 3", 1],
  skeleton: ["Skeleton", "Bow 2-5 · keeps its distance", 2], stray: ["Stray", "Bow · Slowness arrows", 2], bogged: ["Bogged", "Bow · Poison arrows", 2],
  creeper: ["Creeper", "Explodes on a 1.5s fuse · up to 22", 3], spider: ["Spider", "Leap · Melee 2 · climbs walls", 1], cave_spider: ["Cave Spider", "Melee 2 · Poison", 2],
  enderman: ["Enderman", "Melee 7 · teleports · don't stare", 3], witch: ["Witch", "Potions: Harm, Poison, Slowness", 2], blaze: ["Blaze", "3 fireballs · flies", 3],
  ghast: ["Ghast", "Explosive fireball · return it", 3], slime: ["Slime", "Bounce 0-4 · splits", 1], magma_cube: ["Magma Cube", "Bounce 3-6 · splits", 2],
  phantom: ["Phantom", "Swoop 2 from above", 2], pillager: ["Pillager", "Crossbow 3-5", 2], vindicator: ["Vindicator", "Axe 13", 3],
  evocation_illager: ["Evoker", "Fangs 6 · summons Vexes", 4], vex: ["Vex", "Phases through walls · 9", 2], ravager: ["Ravager", "Ram 12 · roar stun", 4],
  guardian: ["Guardian", "Laser 6 · thorns", 3], elder_guardian: ["Elder Guardian", "Laser 8 · Mining Fatigue", 5], wither_skeleton: ["Wither Skeleton", "Melee 8 · Wither", 3],
  piglin: ["Piglin", "Crossbow or sword · wants gold", 2], piglin_brute: ["Piglin Brute", "Axe 13", 4], zombie_pigman: ["Zombified Piglin", "Melee 5 · angers in packs", 2],
  hoglin: ["Hoglin", "Toss 6", 3], zoglin: ["Zoglin", "Toss 6 · attacks anything", 3], silverfish: ["Silverfish", "Melee 1 · swarms", 1], endermite: ["Endermite", "Melee 2", 1],
  shulker: ["Shulker", "Levitation bullets", 3], warden: ["Warden", "Melee 30 · Sonic Boom 10 · blinds", 6], wither: ["Wither", "Wither skulls · explosions", 6],
  ender_dragon: ["Ender Dragon", "Breath · charge · perch", 6], breeze: ["Breeze", "Wind charges · knockback", 3], creaking: ["Creaking", "Melee 3 · freezes when watched", 3],
  iron_golem: ["Iron Golem", "Toss 7-21", 4], wolf: ["Wolf", "Bite 4", 1], bee: ["Bee", "Sting 2 · Poison", 1], polar_bear: ["Polar Bear", "Maul 6", 2],
  "origin:rift_brute": ["Rift Brute", "Slam · Charge · Rock throw", 4], "origin:villain": ["Villain", "Signature power · tells before every move", 5],
  "origin:null": ["NULL", "Static Slam · Dead Air · Test Pattern · Broadcast", 6], "origin:alter_ego": ["The Other", "Your power, no restraint", 4],
  "origin:static_echo": ["Static Echo", "Pops when it reaches you", 2], "origin:training_dummy": ["Training Dummy", "Takes hits", 0],
};
export const THREAT = [["MINIMAL", "§7"], ["LOW", "§a"], ["MODERATE", "§e"], ["HIGH", "§6"], ["SEVERE", "§c"], ["EXTREME", "§4"], ["CATASTROPHIC", "§4§l"]];
const SKIP = new Set([...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "origin:float_text", "origin:exo_piece", "origin:exo_drone", "origin:archetype_orb",
  "origin:manifestation", "origin:lumen_construct", "origin:void_stain", "origin:severed_limb", "origin:ink_spike", "origin:ink_hand", "origin:prosthetic"]);
const nice = (id) => (id.split(":")[1] ?? id).replace(/_v2$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function intelOf(e) {
  const id = e.typeId;
  if (id === "minecraft:player") {
    const h = hero(e);
    return { name: e.name, moves: h.awakened ? `Hero · ${nice(h.power ?? "unknown")}${h.exo?.suited ? " · Exo-Frame" : ""}` : "Civilian", tier: h.awakened ? 4 : 1 };
  }
  const k = INTEL[id] ?? INTEL[id.replace("minecraft:", "")];
  const hp = health(e);
  const named = e.nameTag ? e.nameTag.split("\n")[0].replace(/§./g, "") : null;
  if (k) return { name: named || k[0], moves: k[1], tier: k[2] };
  const t = !hp ? 1 : hp.max >= 100 ? 5 : hp.max >= 40 ? 3 : hp.max >= 20 ? 2 : 1;
  return { name: named || nice(id), moves: "Unknown · analyzing", tier: t };
}
function ring(p, e, col, lock) {
  let top, base;
  try { top = e.getHeadLocation(); base = e.location; } catch { return; }
  const hgt = Math.max(0.5, top.y - base.y + 0.3);
  const m = new MolangVariableMap();
  m.setColorRGBA("variable.color", { red: col.red, green: col.green, blue: col.blue, alpha: 1 });
  m.setFloat("variable.size", Math.min(3.4, Math.max(0.85, hgt * 1.05)));
  try { p.spawnParticle(lock ? "origin:hud_lock" : "origin:hud_ring", at(base, 0, hgt * 0.5, 0), m); } catch { }
  const hp = health(e);
  if (!hp || hp.max <= 0) return;
  const m2 = new MolangVariableMap();
  m2.setFloat("variable.hp", Math.max(0, Math.min(1, hp.cur / hp.max)));
  m2.setFloat("variable.size", lock ? 1.05 : 0.75);
  try { p.spawnParticle("origin:hud_hp", at(top, 0, 0.62, 0), m2); } catch { }
}
function drawWaypoint(p, r, t) {
  const w = r.waypoint;
  if (!w) return;
  if (w.until < t) { r.waypoint = null; return; }
  if (t % 8 >= 4 || w.dim !== p.dimension.id) return;
  const col = hexToRgb(HUD_COLORS[p ? (hero(p).exo ? hudIndex(p) : 1) : 1][1]);
  const m = new MolangVariableMap();
  m.setColorRGBA("variable.color", { red: col.red, green: col.green, blue: col.blue, alpha: 1 });
  for (let k = 0; k < 4; k++) { try { p.spawnParticle("origin:hud_waypoint", { x: w.x + 0.5, y: w.y + 1.3 + k * 1.1, z: w.z + 0.5 }, m); } catch { } }
}
export function setWaypoint(p, loc, secs = 20) { RT(p).waypoint = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z), dim: p.dimension.id, until: now() + secs * 20 }; }

// every 4 ticks
export function tickTargets() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const r = RT(p);
    drawWaypoint(p, r, t);
    if (r.cine || !visorOn(p)) { r.focus = null; r.tracked = 0; continue; }
    const x = exoData(hero(p));
    if (x.opts.target === false) { r.focus = null; r.tracked = 0; continue; }
    const st = r.exoStats ?? statsOf(p, x);
    const col = hexToRgb(HUD_COLORS[hudIndex(p)][1]);
    let list = [];
    try { list = p.dimension.getEntities({ location: p.location, maxDistance: st.sensor, families: ["monster"] }); } catch { }
    list = list.filter((e) => e.id !== p.id && !SKIP.has(e.typeId)).sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location)).slice(0, st.tracks);
    let focus = null;
    try { focus = p.getEntitiesFromViewDirection({ maxDistance: st.sensor }).map((hh) => hh.entity).find((e) => valid(e) && e.id !== p.id && !SKIP.has(e.typeId)) ?? null; } catch { }
    for (const e of list) ring(p, e, col, focus?.id === e.id);
    if (focus && !list.some((e) => e.id === focus.id)) ring(p, focus, col, true);
    if (focus && r.lockId !== focus.id) { r.lockId = focus.id; psound(p, "origin.sfx.lock", 2, 0.22); }
    if (!focus) r.lockId = null;
    r.tracked = list.length;
    if (focus) {
      const hp = health(focus), I = intelOf(focus);
      r.focus = { e: focus, name: I.name, moves: I.moves, tier: I.tier, hp: hp?.cur ?? 0, max: hp?.max ?? 0, dist: Math.round(V.dist(p.location, focus.location) * 10) / 10 };
    } else r.focus = null;
  }
}
function wrap(s, w = 30, max = 3) {
  const out = [];
  let line = "";
  for (const word of String(s).split(" ")) {
    if ((line + " " + word).trim().length > w) { out.push(line.trim()); line = word; if (out.length >= max) break; } else line += " " + word;
  }
  if (out.length < max && line.trim()) out.push(line.trim());
  return out.join("\n§f");
}
// the visor's target panel (sent on the subtitle channel by hud.js)
export function targetPanel(p) {
  const r = RT(p);
  if (r.cine || !visorOn(p)) return "";
  const c = HUD_CODES[hudIndex(p)];
  const L = [];
  const f = r.focus;
  if (f && valid(f.e)) {
    L.push(`${c}◎ §l${f.name.toUpperCase().slice(0, 20)}§r §7${f.dist}m`);
    if (f.max) L.push(`§f${bar(BAR.health, f.hp / f.max, 8)} §f${Math.ceil(f.hp)}§7/${Math.round(f.max)}`);
    L.push(`§7ATK §f${f.moves}`);
    const T = THREAT[Math.max(0, Math.min(6, f.tier))];
    L.push(`§7THREAT ${T[1]}${T[0]}`);
  } else L.push(`${c}◎ §7NO LOCK`);
  L.push(`§7HOSTILES ${c}${r.tracked ?? 0} §7· ALT ${c}${Math.round(p.location.y)}`);
  if ((r.aiUntil ?? 0) > now() && r.aiLine) L.push(`${c}${aiOf(p).name}§7: §f${wrap(r.aiLine.replace(/§./g, ""))}`);
  return L.join("\n");
}
