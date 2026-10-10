// ORIGIN v0.13 - jarvis.js
// Your suit's assistant (default name ATLAS - rename it in the Exo Workshop). Minecraft's stable scripting can't read
// normal chat, so you talk to it with a command:  /ai <anything>   /hey <its name> <anything>   or its own command
// (/atlas, /vega, /orion, /nova, /echo, /sable). Example: /atlas where's the closest diamonds
//   -> [ATLAS] Diamonds: -30y from where you're standing, sir. 4 east, 2 north - 31 blocks. Marked on your visor.
// Answers are private: only you see and hear them. It needs the helmet on, or the Exo Interface in your bag.
import { world, BlockVolume, BlockTypes } from "@minecraft/server";
import { hero, RT, markDirty } from "./data.js";
import { V, valid, now, health, msg, psound } from "./util.js";
import { aiSay, aiOf, aiChatter } from "./say.js";
import { exoData, fullSuit, visorOn, integrity, callSuit, dismissSuit, catchCall, exoTakeoff, canExoFly, missiles, coreLance, deployDrones, arcBlade,
  statsOf, suitName, count, INTERFACE, HUD_COLORS, UPGRADES, UP_KEYS, wristLaser, repulsorBeam } from "./exo.js";
import { isFlying, stopFlight } from "./flight.js";
import { intelOf, setWaypoint, THREAT } from "./target.js";

export const AI_PRESETS = ["atlas", "vega", "orion", "nova", "echo", "sable"];
let weather = null;
export const weatherNow = () => weather;   // "Clear" / "Rain" / "Thunder" ("" until the first change)
export function onWeather(ev) { if (String(ev.dimension ?? "").includes("overworld") || !ev.dimension) weather = String(ev.newWeather ?? ""); }
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const nice = (id) => (id.split(":")[1] ?? id).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const linked = (p) => visorOn(p) || count(p, INTERFACE) > 0;

function rel(p, b) {
  const dx = Math.round(b.x + 0.5 - p.location.x), dy = Math.round(b.y - Math.floor(p.location.y)), dz = Math.round(b.z + 0.5 - p.location.z);
  const hz = [];
  if (dx) hz.push(`${Math.abs(dx)} ${dx > 0 ? "east" : "west"}`);
  if (dz) hz.push(`${Math.abs(dz)} ${dz > 0 ? "south" : "north"}`);
  const v = dy === 0 ? "Level with you" : `${dy > 0 ? "+" : ""}${dy}y from where you're standing`;
  return { v, hz: hz.length ? hz.join(", ") : "straight down", dist: Math.round(Math.hypot(dx, dy, dz)) };
}
function bearing(p, loc) {
  const ang = (Math.atan2(-(loc.x - p.location.x), loc.z - p.location.z) * 180 / Math.PI + 360) % 360;
  const yaw = ((p.getRotation().y % 360) + 360) % 360;
  const relA = ((ang - yaw + 540) % 360) - 180;
  const clock = ((Math.round(relA / 30) % 12) + 12) % 12 || 12;
  const comp = ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"][Math.round(ang / 45) % 8];
  return `${clock} o'clock (${comp})`;
}
function scanBlocks(p, ids, radius) {
  const dim = p.dimension, L = p.location;
  const types = ids.filter((id) => { try { return !!BlockTypes.get(id); } catch { return false; } });
  if (!types.length) return null;
  let lo = -64, hi = 319;
  try { lo = dim.heightRange.min; hi = dim.heightRange.max - 1; } catch { }
  const tryR = (rad) => {
    const vol = new BlockVolume({ x: Math.floor(L.x) - rad, y: Math.max(lo, Math.floor(L.y) - 56), z: Math.floor(L.z) - rad }, { x: Math.floor(L.x) + rad, y: Math.min(hi, Math.floor(L.y) + 20), z: Math.floor(L.z) + rad });
    let best = null, bd = Infinity;
    for (const b of dim.getBlocks(vol, { includeTypes: types }, true).getBlockLocationIterator()) {
      const d = (b.x + 0.5 - L.x) ** 2 + (b.y + 0.5 - L.y) ** 2 * 1.4 + (b.z + 0.5 - L.z) ** 2;
      if (d < bd) { bd = d; best = { x: b.x, y: b.y, z: b.z }; }
    }
    return best;
  };
  try { return tryR(radius); } catch { try { return tryR(12); } catch { return undefined; } }
}
const D = (...ids) => ids.flatMap((i) => [`minecraft:${i}`, `minecraft:deepslate_${i}`]);
const FINDS = [
  [/diamond/, "Diamonds", D("diamond_ore"), "Diamonds sit deep - try below y -50."],
  [/emerald/, "Emeralds", D("emerald_ore"), "Emeralds like mountains."],
  [/ancient debris|debris|netherite/, "Ancient debris", ["minecraft:ancient_debris"], "Debris hides around y 15 in the Nether."],
  [/gold/, "Gold", [...D("gold_ore"), "minecraft:nether_gold_ore"], "Gold is common in badlands and the Nether."],
  [/iron/, "Iron", D("iron_ore"), "Try a cave wall or the mountains."],
  [/coal/, "Coal", D("coal_ore"), "Coal likes the surface layers."],
  [/redstone/, "Redstone", [...D("redstone_ore"), "minecraft:lit_redstone_ore", "minecraft:lit_deepslate_redstone_ore"], "Redstone sits deep, under y 16."],
  [/lapis/, "Lapis", D("lapis_ore"), "Lapis sits around y 0."],
  [/copper/, "Copper", D("copper_ore"), "Copper loves dripstone caves."],
  [/quartz/, "Nether quartz", ["minecraft:quartz_ore"], "Quartz is a Nether thing."],
  [/amethyst|geode/, "Amethyst", ["minecraft:budding_amethyst", "minecraft:amethyst_block"], "Geodes hide underground."],
  [/aetherium/, "Aetherium", ["origin:aetherium_ore"], "Aetherium only shows up between y -58 and -24."],
  [/null crystal|crystal/, "Null crystals", ["origin:null_crystal_ore"], "They grow in the Static."],
  [/starmetal|meteor/, "Starmetal", ["origin:starmetal_core"], "Meteors fall at night - I'll warn you."],
  [/chest|loot|treasure|barrel/, "A container", ["minecraft:chest", "minecraft:barrel", "minecraft:trapped_chest"], "No containers nearby."],
  [/spawner/, "A mob spawner", ["minecraft:mob_spawner"], "No spawners in range."],
  [/lava/, "Lava", ["minecraft:lava", "minecraft:flowing_lava"], "No lava nearby. Good."],
  [/water/, "Water", ["minecraft:water", "minecraft:flowing_water"], "Bone dry around here."],
  [/obsidian/, "Obsidian", ["minecraft:obsidian", "minecraft:crying_obsidian"], "No obsidian in range."],
  [/portal/, "A portal", ["minecraft:portal", "minecraft:end_portal"], "No portals in range."],
  [/\b(tree|trees|wood|logs?)\b/, "Timber", ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry"].map((w) => `minecraft:${w}_log`), "No trees in range."],
];
const FIND_WORDS = /(where|find|closest|nearest|locate|any|scan|look|search|show|detect|is there|are there|need|got)/;
function find(p, t) {
  for (const [re, name, ids, tip] of FINDS) {
    if (!re.test(t)) continue;
    if (!FIND_WORDS.test(t) && t.split(" ").length > 3) continue;
    const st = fullSuit(p) ? statsOf(p) : null;
    const b = scanBlocks(p, ids, Math.min(32, st?.scan ?? 20));
    if (b === undefined) { aiSay(p, "The scanner choked on that one, {addr}. Try again somewhere else."); return true; }
    if (!b) { aiSay(p, `No ${name.toLowerCase()} within scanner range, {addr}. ${tip}`); return true; }
    const R = rel(p, b);
    setWaypoint(p, b, 25);
    aiSay(p, `${name}: ${R.v}, {addr}. ${R.hz} - ${R.dist} blocks. Marked on your visor.`);
    return true;
  }
  return false;
}
function entities(p, types, r = 64) { try { return p.dimension.getEntities({ location: p.location, maxDistance: r, ...(types ? { families: types } : {}) }); } catch { return []; } }

const INTENTS = [
  [/^(help|commands|what can you do|options|\?)/, (p) => aiSay(p, "Try: where's the closest diamonds · scan · status · reactor · health · time · where am i · altitude · mark this spot · take me to the mark · home · suit up · dismiss · fly · land · missiles · drones · night vision · hud color red · call me boss · your name is VEGA · be quiet · tell me a joke")],
  [/(your name is|call yourself|rename (yourself|you)( to)?|i('ll| will) call you|your new name is) ([a-z0-9]{2,12})/, (p, t, m) => { const x = exoData(hero(p)); x.ai.name = m[5].toUpperCase(); markDirty(p); aiSay(p, `${x.ai.name} it is, {addr}. Reach me with /ai, /hey ${x.ai.name.toLowerCase()} ...${AI_PRESETS.includes(m[5]) ? `, or /${m[5]}` : ""}.`); }],
  [/call me ([a-z' ]{2,16})$/, (p, t, m) => { const x = exoData(hero(p)); x.ai.addr = m[1].trim(); markDirty(p); aiSay(p, "Understood, {addr}."); }],
  [/(be quiet|mute|silence|shut up|stop talking|no chatter|quiet)/, (p) => { exoData(hero(p)).ai.chatter = false; markDirty(p); aiSay(p, "Going quiet. I'll still answer when you ask, {addr}."); }],
  [/(unmute|talk to me|chatter on|callouts on|you can talk)/, (p) => { exoData(hero(p)).ai.chatter = true; markDirty(p); aiSay(p, "Callouts back on, {addr}."); }],
  [/(suit up|call the suit|need the suit|bring (me )?the suit|armor up|send the suit|come get me|catch me)/, (p) => {
    if (fullSuit(p)) return aiSay(p, "You're already wearing me, {addr}.");
    const x = exoData(hero(p));
    if (!x.stored) return aiSay(p, "There's no parked suit to send, {addr}. Wear all four pieces, then dismiss it from the Interface.");
    if (!p.isOnGround && (RT(p).fall?.drop ?? 0) > 3) return catchCall(p, false);
    callSuit(p);
  }],
  [/(dismiss|power down|suit down|take (the suit )?off|park the suit)/, (p) => fullSuit(p) ? dismissSuit(p) : aiSay(p, "You're not wearing the suit, {addr}.")],
  [/\b(land|touch down|set me down)\b/, (p) => isFlying(p) ? (stopFlight(p, "land"), aiSay(p, "Bringing you down, {addr}.", { chat: false })) : aiSay(p, "We're not flying, {addr}.")],
  [/\b(fly|take off|lift off|thrusters)\b/, (p) => !fullSuit(p) ? aiSay(p, "I'll need the suit on for that, {addr}.") : isFlying(p) ? aiSay(p, "Already airborne, {addr}.") : canExoFly(p) ? (exoTakeoff(p), aiSay(p, "Thrusters hot. She's all yours, {addr}.", { chat: false })) : aiSay(p, "Thrusters can't fire right now, {addr}.")],
  [/missile/, (p) => fullSuit(p) ? missiles(p) : aiSay(p, "Suit first, {addr}.")],
  [/drone/, (p) => fullSuit(p) ? deployDrones(p) : aiSay(p, "Suit first, {addr}.")],
  [/\b(lance|beam)\b/, (p) => fullSuit(p) ? coreLance(p) : aiSay(p, "Suit first, {addr}.")],
  [/\brepulsor beam\b|\bboth palms\b/, (p) => fullSuit(p) ? repulsorBeam(p) : aiSay(p, "Suit first, {addr}.")],
  [/\b(laser|cutter)\b/, (p) => fullSuit(p) ? wristLaser(p) : aiSay(p, "Suit first, {addr}.")],
  [/blade/, (p) => fullSuit(p) ? arcBlade(p) : aiSay(p, "Suit first, {addr}.")],
  [/(night vision|darkvision|lights)/, (p, t) => { const x = exoData(hero(p)); x.opts.nv = /\boff\b|disable/.test(t) ? false : /\bon\b|enable/.test(t) ? true : x.opts.nv === false; markDirty(p); aiSay(p, `Night vision ${x.opts.nv ? "on" : "off"}, {addr}.`); }],
  [/(hud|visor|display) ?(colou?r)? ?(to )?(red|cyan|blue|gold|yellow|orange|green|violet|purple|pink|white)/, (p, t, m) => {
    const map = { red: 0, cyan: 1, blue: 1, gold: 2, yellow: 2, orange: 2, green: 3, violet: 4, purple: 4, pink: 4, white: 5 };
    exoData(hero(p)).paint.hud = map[m[4]] ?? 0; markDirty(p); aiSay(p, `Visor set to ${HUD_COLORS[map[m[4]] ?? 0][0].toLowerCase()}, {addr}.`);
  }],
  [/(mark|save|remember|pin) (this|the|my)? ?(spot|place|location|position|here)|set (a )?waypoint|^mark (it|here)$/, (p) => {
    const x = exoData(hero(p)), L = p.location;
    x.waypoints = [{ dim: p.dimension.id, x: Math.floor(L.x), y: Math.floor(L.y), z: Math.floor(L.z) }, ...(x.waypoints ?? [])].slice(0, 5);
    markDirty(p);
    aiSay(p, `Marked: ${Math.floor(L.x)}, ${Math.floor(L.y)}, ${Math.floor(L.z)}. Say "take me to the mark" any time, {addr}.`);
  }],
  [/(waypoint|marker|the mark|saved spot|my pin|my mark)/, (p) => {
    const w = (exoData(hero(p)).waypoints ?? [])[0];
    if (!w) return aiSay(p, "You haven't marked anywhere yet, {addr}. Say \"mark this spot\".");
    if (w.dim !== p.dimension.id) return aiSay(p, `Your mark is in ${nice(w.dim)}, {addr}.`);
    setWaypoint(p, w, 30);
    const R = rel(p, w);
    aiSay(p, `Your mark: ${R.dist} blocks, ${bearing(p, w)}. ${R.v}. Lit up on your visor, {addr}.`);
  }],
  [/\b(home|spawn|bed|base)\b/, (p) => {
    let s = null;
    try { s = p.getSpawnPoint(); } catch { }
    if (!s) { try { const d = world.getDefaultSpawnLocation(); s = { ...d, dimension: world.getDimension("minecraft:overworld") }; } catch { } }
    if (!s) return aiSay(p, "I can't find your spawn point, {addr}.");
    if (s.dimension?.id && s.dimension.id !== p.dimension.id) return aiSay(p, `Home is in ${nice(s.dimension.id)}, {addr}.`);
    if (s.y > 300) { const R0 = Math.round(Math.hypot(s.x - p.location.x, s.z - p.location.z)); return aiSay(p, `World spawn: ${R0} blocks, ${bearing(p, s)}, {addr}.`); }
    setWaypoint(p, s, 30);
    const R = rel(p, s);
    aiSay(p, `Home is ${R.dist} blocks away, ${bearing(p, s)}, {addr}. Lit up on your visor.`);
  }],
  [/(where am i|coordinates|coords|my position|location|biome|what dimension)/, (p) => {
    const L = p.location;
    let b = "";
    try { b = nice(p.dimension.getBiome(L).id); } catch { }
    aiSay(p, `${Math.floor(L.x)}, ${Math.floor(L.y)}, ${Math.floor(L.z)} in ${nice(p.dimension.id)}${b ? `, ${b} biome` : ""}, {addr}.`);
  }],
  [/(altitude|depth|how deep|how high|y level|elevation|sea level|underground)/, (p) => {
    const y = Math.floor(p.location.y);
    let under = 0;
    try { const top = p.dimension.getTopmostBlock({ x: p.location.x, z: p.location.z }); if (top) under = Math.max(0, top.location.y - y); } catch { }
    aiSay(p, `Altitude ${y}, ${y - 63 >= 0 ? `${y - 63} above` : `${63 - y} below`} sea level${under > 3 ? ` - about ${under} blocks of rock over your head` : ""}, {addr}.`);
  }],
  [/(status|report|diagnostic|integrity|damage|suit)/, (p) => {
    const x = exoData(hero(p));
    if (!fullSuit(p)) return aiSay(p, x.stored ? "The suit's parked and waiting, {addr}. Say \"suit up\" or use the Interface." : "No suit on right now, {addr}.");
    const I = integrity(p), st = statsOf(p, x);
    const pc = (v) => (v === null ? "-" : `${Math.round(v * 100)}%`);
    const ups = UP_KEYS.filter((k) => x.up[k]).map((k) => `${UPGRADES[k].name} ${x.up[k]}`).join(", ");
    aiSay(p, `${suitName(p)}: helmet ${pc(I.head)}, chest ${pc(I.chest)}, legs ${pc(I.legs)}, boots ${pc(I.feet)}. Reactor ${Math.round(x.reactor)}/${x.cap ?? st.cap}. Resistance ${["I", "II", "III"][st.resist]}, repulsors ${st.rep}.${ups ? ` Upgrades: ${ups}.` : ""}`);
  }],
  [/(reactor|battery|power level|charge|energy)/, (p) => { const x = exoData(hero(p)); aiSay(p, fullSuit(p) ? `Reactor at ${Math.round(x.reactor)} of ${x.cap ?? 100}, {addr}.${x.reactor < 20 ? " Getting low." : ""}` : "No reactor to read, {addr} - you're out of the suit."); }],
  [/(health|vitals|how am i|am i ok|\bhp\b|hurt)/, (p) => {
    const hp = health(p), r = RT(p);
    const fxs = (() => { try { return p.getEffects().map((e) => nice(e.typeId)).slice(0, 4).join(", "); } catch { return ""; } })();
    aiSay(p, `Vitals: ${Math.ceil(hp?.cur ?? 0)}/${Math.round(hp?.max ?? 20)}${(r.bleedUntil ?? 0) > now() ? ", and you're bleeding" : ""}${fxs ? `. Active: ${fxs}` : ""}. ${hp && hp.cur < hp.max * 0.35 ? "Please be careful, {addr}." : "You'll live, {addr}."}`);
  }],
  [/(what time|time is it|\btime\b|clock|how long until|sunset|sunrise)/, (p) => {
    let tod = 0, day = 0;
    try { tod = world.getTimeOfDay(); day = world.getDay(); } catch { }
    const hrs = (Math.floor(tod / 1000) + 6) % 24, mins = Math.floor((tod % 1000) * 0.06);
    const toNight = tod < 12000 ? Math.round((12000 - tod) / 20) : null, toDay = tod >= 12000 ? Math.round((24000 - tod) / 20) : null;
    aiSay(p, `It's ${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")} on day ${day + 1}, {addr}. ${toNight !== null ? `Sunset in about ${Math.max(1, Math.round(toNight / 60))} minute${toNight >= 90 ? "s" : ""}.` : `Sunrise in about ${Math.max(1, Math.round(toDay / 60))} minutes.`}`);
  }],
  [/(weather|rain|storm|thunder|forecast)/, (p) => aiSay(p, weather ? `Last reading: ${weather.toLowerCase()}, {addr}.` : "Skies have been quiet since I came online, {addr}.")],
  [/(threat|enem|hostile|mobs|monsters|anyone|anything around|scan|danger)/, (p) => {
    const list = entities(p, ["monster"], 32).filter((e) => e.id !== p.id);
    if (!list.length) return aiSay(p, "All clear within 32 blocks, {addr}.");
    const counts = {};
    for (const e of list) { const n = intelOf(e).name; counts[n] = (counts[n] ?? 0) + 1; }
    list.sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location));
    const n0 = list[0], I0 = intelOf(n0);
    aiSay(p, `${list.length} hostile${list.length > 1 ? "s" : ""}: ${Object.entries(counts).map(([n, c]) => `${c} ${n}`).join(", ")}. Closest: ${I0.name}, ${Math.round(V.dist(n0.location, p.location))}m at ${bearing(p, n0.location)}.`);
  }],
  [/(target|what is that|what's that|whats that|analy[sz]e|looking at|identify)/, (p) => {
    let e = RT(p).focus?.e;
    if (!valid(e)) { try { e = p.getEntitiesFromViewDirection({ maxDistance: 48 }).map((h) => h.entity).find((x) => x.id !== p.id); } catch { } }
    if (!e) { let b = null; try { b = p.getBlockFromViewDirection({ maxDistance: 32 })?.block; } catch { } return aiSay(p, b ? `That's ${nice(b.typeId)}, {addr}.` : "Nothing in my sights, {addr}."); }
    const I = intelOf(e), hp = health(e), T = THREAT[Math.max(0, Math.min(6, I.tier))];
    aiSay(p, `${I.name}: ${hp ? `${Math.ceil(hp.cur)}/${Math.round(hp.max)} health. ` : ""}Attacks: ${I.moves}. Threat ${T[0].toLowerCase()}, {addr}.`);
  }],
  [/(village|villager|trader)/, (p) => {
    const list = entities(p, null, 96).filter((e) => e.typeId === "minecraft:villager_v2" || e.typeId === "minecraft:villager" || e.typeId === "minecraft:wandering_trader");
    if (!list.length) return aiSay(p, "No villagers within 96 blocks, {addr}.");
    list.sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location));
    setWaypoint(p, list[0].location, 20);
    aiSay(p, `Villager ${Math.round(V.dist(list[0].location, p.location))}m out, ${bearing(p, list[0].location)}, {addr}.`);
  }],
  [/(player|friend|someone|people|anybody)/, (p) => {
    const others = world.getAllPlayers().filter((o) => o.id !== p.id && o.dimension.id === p.dimension.id);
    if (!others.length) return aiSay(p, "Just you out here, {addr}.");
    others.sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location));
    aiSay(p, `${others[0].name}: ${Math.round(V.dist(others[0].location, p.location))}m, ${bearing(p, others[0].location)}, {addr}.`);
  }],
  [/(stone|gauntlet|infinity)/, (p) => aiSay(p, "Six stones: Space, Mind, Reality, Power, Time, Soul. Nobody's found one in the wild yet, {addr}. The Gauntlet can be forged - gold, a nether star, netherite - and only it can combine them.")],
  [/(joke|funny|make me laugh)/, (p) => aiSay(p, pick(["I ran a full diagnostic on your sense of humor, {addr}. Results inconclusive.", "Why don't creepers have friends? They blow up every relationship.", "I'd tell you a UDP joke, {addr}, but you might not get it.", "Your flight record: many takeoffs, slightly fewer landings.", "Skeletons never fight each other. They don't have the guts.", "I tried to get the suit to do yoga. It only knows one pose: superhero landing."]))],
  [/(who are you|what are you|your name|introduce)/, (p) => aiSay(p, `I'm {name}, the mind in your suit. I scan, I warn, I fly you home. Rename me in the Exo Workshop, {addr}.`)],
  [/(thank|thanks|thx|cheers|good job|nice work|well done)/, (p) => aiSay(p, pick(["Always, {addr}.", "Any time, {addr}.", "That's what I'm here for, {addr}.", "Don't mention it. Really - my logs are already full."]))],
  [/^(hi|hello|hey|yo|sup|good (morning|evening|afternoon|night)|morning|evening)\b/, (p) => aiSay(p, pick(["Hello, {addr}. What do you need?", "Online and listening, {addr}.", "At your service, {addr}."]))],
];

export function aiHelp(p) {
  const a = aiOf(p);
  return `§b${a.name}§7 answers to: §f/ai <words>§7, §f/hey ${a.name.toLowerCase()} <words>§7${AI_PRESETS.includes(a.name.toLowerCase()) ? `, §f/${a.name.toLowerCase()} <words>` : ""}§7. Try §f/ai help§7. §8(Chat itself can't be read by add-ons, so it's a command.)`;
}
export function askAI(p, called, text) {
  if (!valid(p)) return;
  const a = aiOf(p);
  const t = String(text ?? "").toLowerCase().replace(/[?!.,;:"]/g, " ").replace(/\s+/g, " ").trim();
  if (called && called.toLowerCase() !== a.name.toLowerCase()) {
    msg(p, `§8(Nobody answers to "${called}". Your assistant is §f${a.name}§8 - try §f/ai ${text}§8)`);
    return;
  }
  if (!linked(p)) { msg(p, "§8(Static... your assistant lives in the Exo-Frame helmet. Wear it, or carry the Exo Interface.)"); return; }
  exoData(hero(p));
  psound(p, "origin.sfx.ting", 1.4, 0.35);
  if (!t) return aiSay(p, "Yes, {addr}?");
  try { if (find(p, t)) return; } catch (e) { console.warn("[ORIGIN] scan: " + e); }
  for (const [re, fn] of INTENTS) {
    const m = t.match(re);
    if (!m) continue;
    try { fn(p, t, m); } catch (e) { aiSay(p, "Something glitched there, {addr}."); console.warn("[ORIGIN] ai: " + e); }
    return;
  }
  aiSay(p, `${pick(["I didn't quite catch that, {addr}.", "Could you rephrase that, {addr}?", "Not in my vocabulary yet, {addr}."])} Try "where's the closest diamonds", "scan", "status" or "help".`);
}

// every 10 ticks: unprompted callouts (only to the wearer; respects "be quiet")
let lastTod = 0;
export function tickAssistant() {
  let tod = 0;
  try { tod = world.getTimeOfDay(); } catch { }
  const dusk = lastTod < 12500 && tod >= 12500;
  lastTod = tod;
  for (const p of world.getAllPlayers()) {
    if (!hero(p).exo || !visorOn(p)) continue;
    const hp = health(p), x = exoData(hero(p));
    if (hp && hp.cur > 0 && hp.cur <= hp.max * 0.3) aiChatter(p, "lowhp", "Vitals critical, {addr}. Recommend disengaging.", 600);
    if (fullSuit(p) && (x.reactor ?? 100) < 15) aiChatter(p, "lowreactor", `Reactor at ${Math.round(x.reactor)}, {addr}. Give it a minute on the ground.`, 1200);
    if (dusk) aiChatter(p, "dusk", "Sun's going down, {addr}. Night vision's standing by.", 4000);
    let near = [];
    try { near = p.dimension.getEntities({ location: p.location, maxDistance: 40, families: ["monster"] }); } catch { }
    for (const e of near) {
      const d = V.dist(e.location, p.location);
      if (e.typeId === "minecraft:creeper" && d < 5) { const b = bearing(p, e.location); if (/^(4|5|6|7|8) o'clock/.test(b)) { aiChatter(p, "creeper", "Creeper, six o'clock!", 160); break; } }
      if (["origin:null", "minecraft:warden", "minecraft:wither", "origin:villain"].includes(e.typeId) && d < 40) { aiChatter(p, "boss:" + e.typeId, `Big signature: ${intelOf(e).name}, ${Math.round(d)}m at ${bearing(p, e.location)}. Careful, {addr}.`, 2400); }
    }
  }
}
