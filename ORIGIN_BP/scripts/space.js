// ORIGIN v0.24 - space.js
// SPACE. Climb past the top of the sky (y 330 in the Overworld) and the blue gives way to black.
//  Who can get there: anyone who can fly that high - the Flight power, Mjolnir, the Lumen Signet, elytra and rockets.
//  The EXO-FRAME CAN'T: it ices up past 240 blocks and loses power at 290, unless you research the ORBITAL SEAL
//  blueprint at the Exo Workshop (pressure seals, de-icers, life support). Then it flies you straight out of the sky.
//  Out there:
//   - you arrive at WATCHTOWER STATION: a glass dome (air inside), a docking ring, solar wings, a drop pad
//   - low gravity: big floaty jumps, slow falls
//   - NO AIR: about 15 seconds of breath, then it starts to hurt. Safe: inside the station dome, an Exo-Frame with the
//     Orbital Seal, the Lumen Signet (the ring keeps a bubble of air around you), Super Durability, Mjolnir in hand.
//   - Earth hangs below you, the stars all around; the MOON floats a short flight away (null crystal and aetherium in
//     its craters), and a field of ASTEROIDS full of ore drifts between them
//   - every block you travel out here is SIXTEEN back home: fall back down (below y 5) - or stand on the station's
//     drop pad and sneak - and you re-enter over wherever your orbit carried you, burning, with slow falling.
import { world, system, BlockPermutation, BlockVolume, EntityDamageCause, MolangVariableMap } from "@minecraft/server";
import { hero, RT, markDirty, saveNow } from "./data.js";
import { V, at, valid, fx, sound, psound, now, msg, hexToRgb } from "./util.js";
import { hudMsg } from "./voice.js";
import { fullSuit, knows } from "./exo.js";
import { stopFlight } from "./flight.js";

export const SPACE = "origin:space";
system.beforeEvents.startup.subscribe((ev) => { try { ev.dimensionRegistry.registerCustomDimension(SPACE); } catch (e) { console.warn("[ORIGIN] space: " + e); } });
const KEY = "origin:space_v1";
export const EDGE = 330;                  // Overworld height that counts as leaving the sky
const SCALE = 16;                         // one block in orbit = this many blocks of ground
const HUB = { x: 0, y: 60, z: 0 };
const ARRIVE = { x: 0.5, y: 61, z: 0.5 };
const PAD = { x: 0, y: 60, z: -6 };       // drop pad on the station deck
const MOON = { x: 0, y: 40, z: 230, r: 38 };
const AIR_MAX = 300;                      // ticks of breath without life support
export const inSpace = (p) => { try { return p.dimension.id === SPACE; } catch { return false; } };
const COLD = hexToRgb("#cfe8ff"), FIRE = hexToRgb("#ff8a2a"), WHITE = { red: 1, green: 1, blue: 1 };

// ------------------------------------------------------------------ building (piece by piece as chunks load)
const PERM = new Map();
function perm(id) {
  if (PERM.has(id)) return PERM.get(id);
  let pm = null;
  for (const c of [id, ...(FALLBACK[id] ?? []), "minecraft:stone"]) { try { pm = BlockPermutation.resolve(c); if (pm) break; } catch { } }
  PERM.set(id, pm); return pm;
}
const FALLBACK = { "minecraft:smooth_quartz": ["minecraft:quartz_block"], "minecraft:tinted_glass": ["minecraft:black_stained_glass"], "minecraft:smooth_basalt": ["minecraft:basalt", "minecraft:stone"],
  "origin:null_crystal_ore": ["minecraft:obsidian"], "origin:aetherium_ore": ["minecraft:diamond_ore"], "origin:starmetal_core": ["minecraft:iron_block"] };
function put(d, x, y, z, id) { try { const b = d.getBlock({ x, y, z }); if (!b) return false; const pm = perm(id); if (pm) b.setPermutation(pm); return true; } catch { return false; } }
function strip(d, x0, x1, y, z, id) {
  const pm = perm(id); if (!pm) return true;
  try { if (!d.getBlock({ x: x0, y, z }) || !d.getBlock({ x: x1, y, z })) return false; } catch { return false; }
  try { d.fillBlocks(new BlockVolume({ x: x0, y, z }, { x: x1, y, z }), pm); return true; } catch { let ok = true; for (let x = x0; x <= x1; x++) ok = put(d, x, y, z, id) && ok; return ok; }
}
function disc(d, cx, y, cz, r, id) { let ok = true; for (let dz = -r; dz <= r; dz++) { const w = Math.floor(Math.sqrt(r * r - dz * dz)); ok = strip(d, cx - w, cx + w, y, cz + dz, id) && ok; } return ok; }
function ring(d, cx, y, cz, r0, r1, id) {
  let ok = true;
  for (let dz = -r1; dz <= r1; dz++) for (let dx = -r1; dx <= r1; dx++) { const r = Math.hypot(dx, dz); if (r >= r0 && r <= r1) ok = put(d, cx + dx, y, cz + dz, id) && ok; }
  return ok;
}
// seeded noise so every world gets the same sky
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
const PIECES = [
  ["station", HUB, (d) => {
    let ok = disc(d, HUB.x, HUB.y, HUB.z, 9, "minecraft:white_concrete");
    ok = disc(d, HUB.x, HUB.y, HUB.z, 7, "minecraft:smooth_quartz") && ok;
    ok = disc(d, HUB.x, HUB.y - 1, HUB.z, 8, "minecraft:light_gray_concrete") && ok;
    ok = disc(d, HUB.x, HUB.y - 2, HUB.z, 5, "minecraft:iron_block") && ok;
    // the dome
    for (let dy = 1; dy <= 9; dy++) {
      const rr = Math.sqrt(Math.max(0, 81 - dy * dy));
      ok = ring(d, HUB.x, HUB.y + dy, HUB.z, Math.max(0, rr - 1), rr, dy === 9 ? "minecraft:sea_lantern" : "minecraft:glass") && ok;
    }
    for (const [x, z] of [[4, 4], [-4, 4], [4, -4], [-4, -4]]) ok = put(d, HUB.x + x, HUB.y, HUB.z + z, "minecraft:sea_lantern") && ok;
    // the drop pad
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) ok = put(d, PAD.x + dx, PAD.y, PAD.z + dz, dx === 0 && dz === 0 ? "minecraft:redstone_lamp" : "minecraft:gold_block") && ok;
    ok = put(d, PAD.x, PAD.y, PAD.z, "minecraft:glowstone") && ok;
    return ok;
  }],
  ["ring", HUB, (d) => {
    let ok = ring(d, HUB.x, HUB.y, HUB.z, 15, 17, "minecraft:iron_block");
    ok = ring(d, HUB.x, HUB.y + 1, HUB.z, 16.5, 17, "minecraft:light_blue_stained_glass") && ok;
    for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let s = 9; s <= 15; s++) { ok = put(d, HUB.x + ux * s, HUB.y, HUB.z + uz * s, "minecraft:iron_block") && ok; if (s % 3 === 0) ok = put(d, HUB.x + ux * s, HUB.y - 1, HUB.z + uz * s, "minecraft:sea_lantern") && ok; }
    return ok;
  }],
  ["solar", { x: 26, y: HUB.y, z: 0 }, (d) => {
    let ok = true;
    for (const sx of [1, -1]) {
      for (let s = 18; s <= 36; s++) {
        ok = put(d, HUB.x + sx * s, HUB.y, HUB.z, "minecraft:iron_block") && ok;
        if (s >= 20) for (let w = -4; w <= 4; w++) if (w !== 0) ok = put(d, HUB.x + sx * s, HUB.y, HUB.z + w, s % 4 === 0 || Math.abs(w) === 4 ? "minecraft:iron_block" : "minecraft:blue_stained_glass") && ok;
      }
    }
    return ok;
  }],
  ...Array.from({ length: 8 }, (_, k) => [`moon${k}`, { x: MOON.x + Math.round(Math.cos((k / 8) * Math.PI * 2) * 24), y: MOON.y, z: MOON.z + Math.round(Math.sin((k / 8) * Math.PI * 2) * 24) }, (d) => moonSlice(d, k)]),
  ...Array.from({ length: 14 }, (_, i) => { const a = asteroid(i); return [`rock${i}`, a.c, (d) => buildAsteroid(d, a)]; }),
];
// the Moon: a flattened sphere, built in eight wedges; craters scooped out of the top, ore in the walls of them
function moonSlice(d, k) {
  const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2, R = MOON.r, H = 18;
  const rnd = rng(4242 + k);
  let ok = true;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    let a = Math.atan2(dz, dx); if (a < 0) a += Math.PI * 2;
    if (a < a0 || a >= a1) continue;
    const r = Math.hypot(dx, dz); if (r > R) continue;
    const top = Math.round(Math.sqrt(1 - (r / R) ** 2) * 9), bot = -Math.round(Math.sqrt(1 - (r / R) ** 2) * H);
    const crater = craterDepth(dx, dz);
    const x = MOON.x + dx, z = MOON.z + dz;
    try { if (!d.getBlock({ x, y: MOON.y + bot, z }) || !d.getBlock({ x, y: MOON.y + top, z })) { ok = false; continue; } } catch { ok = false; continue; }
    const core = perm("minecraft:smooth_basalt");
    try { if (core && top - crater - 1 >= bot) d.fillBlocks(new BlockVolume({ x, y: MOON.y + bot, z }, { x, y: MOON.y + top - crater - 1, z }), core); } catch { }
    ok = put(d, x, MOON.y + top - crater, z, crater ? "minecraft:light_gray_concrete_powder" : "minecraft:end_stone") && ok;
    if (crater && rnd() < 0.07) ok = put(d, x, MOON.y + top - crater - 1, z, rnd() < 0.5 ? "origin:null_crystal_ore" : "origin:aetherium_ore") && ok;
  }
  if (k === 0) { for (let y = 1; y <= 5; y++) put(d, MOON.x, MOON.y + 9 + y, MOON.z, "minecraft:iron_bars"); for (let y = 3; y <= 5; y++) for (let w = 1; w <= 3; w++) put(d, MOON.x + w, MOON.y + 9 + y, MOON.z, y === 4 ? "minecraft:white_wool" : "minecraft:red_wool"); }
  return ok;
}
const CRATERS = (() => { const rnd = rng(777); return Array.from({ length: 11 }, () => { const a = rnd() * Math.PI * 2, r = rnd() * MOON.r * 0.75; return { x: Math.cos(a) * r, z: Math.sin(a) * r, s: 3 + rnd() * 5 }; }); })();
function craterDepth(dx, dz) { let dep = 0; for (const c of CRATERS) { const r = Math.hypot(dx - c.x, dz - c.z); if (r < c.s) dep = Math.max(dep, Math.round((1 - r / c.s) * 3)); } return dep; }
function asteroid(i) {
  const rnd = rng(9001 + i * 31);
  const c = { x: Math.round((rnd() - 0.5) * 120), y: Math.round(36 + rnd() * 60), z: Math.round(40 + rnd() * 150) };
  if (Math.hypot(c.x, c.z) < 26) c.z += 30;
  return { c, r: 3 + Math.floor(rnd() * 4), seed: 100 + i };
}
function buildAsteroid(d, a) {
  const rnd = rng(a.seed), ORES = ["minecraft:iron_ore", "minecraft:gold_ore", "minecraft:diamond_ore", "origin:aetherium_ore", "minecraft:coal_ore", "minecraft:redstone_ore", "origin:starmetal_core"];
  let ok = true;
  for (let dx = -a.r - 1; dx <= a.r + 1; dx++) for (let dy = -a.r; dy <= a.r; dy++) for (let dz = -a.r - 1; dz <= a.r + 1; dz++) {
    const n = (Math.sin(dx * 1.7 + a.seed) + Math.cos(dz * 1.3 + a.seed) + Math.sin(dy * 2.1)) * 0.6;
    if (Math.hypot(dx, dy * 1.2, dz) > a.r + n) continue;
    const id = rnd() < 0.12 ? ORES[Math.floor(rnd() * ORES.length)] : rnd() < 0.3 ? "minecraft:cobblestone" : rnd() < 0.5 ? "minecraft:tuff" : "minecraft:stone";
    ok = put(d, a.c.x + dx, a.c.y + dy, a.c.z + dz, id) && ok;
  }
  return ok;
}
const builtSet = () => new Set(String(world.getDynamicProperty(KEY) ?? "").split(",").filter(Boolean));
export function resetSpace() { world.setDynamicProperty(KEY, ""); }
function tryBuild(d) {
  const done = builtSet();
  let n = 0, changed = false;
  for (const [name, c, fn] of PIECES) {
    if (done.has(name) || n >= 2) continue;
    let loaded = false; try { loaded = !!d.getBlock(c); } catch { }
    if (!loaded) continue;
    n++;
    if (fn(d)) { done.add(name); changed = true; }
  }
  if (changed) world.setDynamicProperty(KEY, [...done].join(","));
  return done.has("station");
}

// ------------------------------------------------------------------ who can breathe out here
function holding(p, id) { try { return p.getComponent("minecraft:inventory").container.getItem(p.selectedSlotIndex)?.typeId === id; } catch { return false; } }
function carries(p, id) { try { const c = p.getComponent("minecraft:inventory").container; for (let i = 0; i < c.size; i++) if (c.getItem(i)?.typeId === id) return true; } catch { } return false; }
export function spaceRated(p) { try { return fullSuit(p) && knows(hero(p), "orbital"); } catch { return false; } }
function lifeSupport(p) {
  const L = p.location;
  if (Math.hypot(L.x - HUB.x, L.z - HUB.z) < 8.5 && L.y >= HUB.y && L.y < HUB.y + 9) return "station air";
  if (spaceRated(p)) return "suit life support";
  if (carries(p, "origin:lumen_signet")) return "ring bubble";
  const h = hero(p);
  if (h.awakened && h.power === "super_durability") return "you don't need to breathe";
  if (holding(p, "origin:mjolnir")) return "the hammer's storm";
  try { const g = String(p.getGameMode()).toLowerCase(); if (g === "creative" || g === "spectator") return "creative"; } catch { }
  return null;
}

// ------------------------------------------------------------------ the sky: stars, Earth below, the Moon, the Sun (each player sees their own)
function pfx(p, id, loc, floats, rgb = WHITE, a = 1) {
  try { const m = new MolangVariableMap(); m.setColorRGBA("variable.color", { red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: a }); for (const k in floats ?? {}) m.setFloat("variable." + k, floats[k]); p.spawnParticle(id, loc, m); } catch { }
}
// The real sky would still be blue: six big black panels 60 blocks out hide it (blocks closer than that draw in front
// of them, so the station and rocks you're near look right). Everything you see past them is painted on: stars,
// Earth filling the view below, the Moon (until you're close enough to see the real one), the Sun.
const SHELL = [[60, 0, 0], [-60, 0, 0], [0, 60, 0], [0, -60, 0], [0, 0, 60], [0, 0, -60]];
function skybox(p, k) {
  const L = p.location, eye = at(L, 0, 1.6, 0);
  for (const [x, y, z] of SHELL) pfx(p, "origin:space_sky", at(eye, x, y, z), { size: 80, life: 0.16 });
  if (k % 20 === 0) pfx(p, "origin:space_star", eye, { n: 90, r: 40, life: 2.2 });
  pfx(p, "origin:planet", at(eye, 6, -48, 10), { kind: 0, size: 70, life: 0.16 });                         // Earth, filling the view below
  const toMoon = V.sub({ x: MOON.x, y: MOON.y, z: MOON.z }, eye), dm = V.len(toMoon);
  if (dm > 56) pfx(p, "origin:planet", V.add(eye, V.mul(toMoon, 46 / dm)), { kind: 1, size: Math.max(2, Math.min(24, (MOON.r * 46) / dm)), life: 0.16 });
  pfx(p, "origin:sun", at(eye, -32, 24, -28), { size: 7, life: 0.16 });                                   // the Sun
}

// ------------------------------------------------------------------ getting there and back
function launch(p) {
  const h = hero(p), r = RT(p);
  if ((r.launching ?? 0) > now()) return;
  r.launching = now() + 40;
  h.spaceRet = { x: p.location.x, z: p.location.z };
  saveNow(p);
  r.spaceHold = now() + 200; r.spaceAir = AIR_MAX; r.spaceTick = 0;
  try { p.camera.fade({ fadeTime: { fadeInTime: 0.4, holdTime: 0.3, fadeOutTime: 1.2 }, fadeColor: { red: 0, green: 0, blue: 0 } }); } catch { }
  system.runTimeout(() => {
    if (!valid(p)) return;
    try { p.teleport(ARRIVE, { dimension: world.getDimension(SPACE), rotation: { x: 0, y: 180 } }); } catch (e) { hudMsg(p, "§7The sky won't let go. §8" + e, 40); return; }
    try { p.runCommand("fog @s push origin:space origin_space"); } catch { }
    try { p.onScreenDisplay.setTitle("§f§lSPACE", { fadeInDuration: 10, stayDuration: 50, fadeOutDuration: 20, subtitle: "§7Watchtower Station" }); RT(p).titleUntil = now() + 80; } catch { }
    const ls = lifeSupport(p);
    msg(p, `§f§lYOU LEFT THE SKY. §r§7Low gravity, no air ${ls ? `§a(you're covered: ${ls})` : "§c(about 15 seconds of breath - get under the station dome)"}§7. Every block out here is §f${SCALE}§7 back home. §8Fall below the station, or sneak on the gold drop pad, to go back down.`);
    psound(p, "origin.sfx.swell", 0.6, 0.6);
  }, 10);
}
function reenter(p) {
  const h = hero(p), r = RT(p), L = p.location;
  const base = h.spaceRet ?? world.getDefaultSpawnLocation();
  const x = base.x + (L.x - ARRIVE.x) * SCALE, z = base.z + (L.z - ARRIVE.z) * SCALE;
  r.spaceHold = 0;
  try { p.runCommand("fog @s remove origin_space"); } catch { }
  try { p.teleport({ x, y: 300, z }, { dimension: world.getDimension("minecraft:overworld") }); } catch { return; }
  r.flyGrace = now() + 600; r.reentryUntil = now() + 140;
  try { p.addEffect("slow_falling", 600, { showParticles: false }); p.addEffect("fire_resistance", 200, { showParticles: false }); } catch { }
  try { p.onScreenDisplay.setTitle("§6§lRE-ENTRY", { fadeInDuration: 4, stayDuration: 40, fadeOutDuration: 16, subtitle: `§7coming down over §f${Math.round(x)}, ${Math.round(z)}` }); r.titleUntil = now() + 60; } catch { }
  sound(p.dimension, "mob.blaze.shoot", p.location, 0.6, 1);
}

// ------------------------------------------------------------------ every 2 ticks
export function tickSpace() {
  const t = now();
  let built = null;
  for (const p of world.getAllPlayers()) {
    const r = RT(p);
    let dimId = ""; try { dimId = p.dimension.id; } catch { continue; }
    if (dimId === "minecraft:overworld") {
      if ((r.reentryUntil ?? 0) > t) { const v = at(p.location, 0, 1, 0); fx(p.dimension, "origin:boom_fire", v, FIRE, 0.8); if (t % 4 === 0) fx(p.dimension, "origin:missile_smoke", at(v, 0, 1.5, 0), WHITE, 0.6); }
      if (p.location.y > EDGE && !r.cine) launch(p);
      continue;
    }
    if (dimId !== SPACE) { if (r.inSpace) { r.inSpace = false; try { p.runCommand("fog @s remove origin_space"); } catch { } } continue; }
    if (!r.inSpace) { r.inSpace = true; r.spaceAir = r.spaceAir ?? AIR_MAX; try { p.runCommand("fog @s push origin:space origin_space"); } catch { } }
    const k = (r.spaceTick = (r.spaceTick ?? 0) + 1);
    if (built === null) built = tryBuild(p.dimension);
    // hold them on the pad until the station exists under them
    if ((r.spaceHold ?? 0) > t || !built) {
      if (built) r.spaceHold = 0;
      else {
        put(p.dimension, 0, HUB.y, 0, "minecraft:white_concrete");
        try { if (V.dist(p.location, ARRIVE) > 3) p.teleport(ARRIVE); p.addEffect("slow_falling", 30, { showParticles: false }); } catch { }
        if (k % 8 === 0) hudMsg(p, "§7Docking at Watchtower Station...", 20);
      }
    }
    // low gravity
    try { p.addEffect("slow_falling", 12, { showParticles: false }); p.addEffect("jump_boost", 12, { amplifier: 3, showParticles: false }); } catch { }
    r.flyGrace = t + 40;
    // the Exo needs its seal out here
    if (r.fly?.kind === "exo" && !spaceRated(p)) { stopFlight(p, "tired"); hudMsg(p, "§c◆ SUIT NOT SPACE-RATED §7- thrusters frozen. §8(Orbital Seal blueprint)", 60); }
    // air
    const ls = lifeSupport(p);
    if (ls) r.spaceAir = Math.min(AIR_MAX, (r.spaceAir ?? AIR_MAX) + 6);
    else {
      r.spaceAir = Math.max(0, (r.spaceAir ?? AIR_MAX) - 2);
      if (k % 3 === 0) fx(p.dimension, "origin:mote", at(p.location, 0, 1.7, 0), COLD, 0.7);
      if (r.spaceAir <= 0 && k % 10 === 0) { try { p.applyDamage(2, { cause: EntityDamageCause.suffocation }); } catch { } }
      if (r.spaceAir > 0 && r.spaceAir % 40 === 0) psound(p, "random.breath", 1.3, 0.5);
    }
    // the drop pad, or falling away from the station
    const L = p.location;
    if (p.isSneaking && Math.abs(L.x - (PAD.x + 0.5)) < 1.6 && Math.abs(L.z - (PAD.z + 0.5)) < 1.6 && Math.abs(L.y - (PAD.y + 1)) < 1.5) { reenter(p); continue; }
    if (L.y < 5) { reenter(p); continue; }
    if (L.y > 300) { try { p.applyKnockback({ x: 0, z: 0 }, -0.4); } catch { } }
    skybox(p, k);
  }
}
export function spaceLine(p) {
  if (!inSpace(p)) return null;
  const r = RT(p), h = hero(p), L = p.location, ls = lifeSupport(p);
  const base = h.spaceRet ?? { x: 0, z: 0 };
  const gx = Math.round(base.x + (L.x - ARRIVE.x) * SCALE), gz = Math.round(base.z + (L.z - ARRIVE.z) * SCALE);
  const air = ls ? `§a${ls}` : `§cAIR §f${Math.ceil((r.spaceAir ?? 0) / 20)}s`;
  return `§f☾ SPACE §8· ${air} §8· §7below you: §f${gx}, ${gz}`;
}
export function rescueSpace(p) {
  if (!inSpace(p)) return;
  RT(p).spaceAir = AIR_MAX;
  system.runTimeout(() => { if (valid(p) && inSpace(p)) { try { p.teleport(ARRIVE); } catch { } } }, 20);
}
