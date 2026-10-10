// ORIGIN v0.05 - static.js
// THE STATIC: a flat grayscale analog void. The Static Remote pulls a target (or you) in.
// Every ~60s a GLITCH hits the trapped player: random stat, inventory shuffle, garbled chat,
// reversed controls, missing UI. The longer you stay the worse and more frequent it gets.
// You escape by stepping into a rare blue pool, or the caster pulls you out. Then everything resets.
import { world, system } from "@minecraft/server";
import { STATIC_ID, staticCenter, planStaticTile, STATIC_Y } from "./plan.js";
import { runOps } from "./builder.js";
import { hero, RT, markDirty } from "./data.js";
import { V, at, valid, cmd, now, msg, fx, sound, psound, C, locOf } from "./util.js";
import { hudMsg, quip } from "./voice.js";
import { loadArea, unloadArea, spawnRetry } from "./innerworld.js";
import { title, runCine, EASE } from "./cine.js";
import { genAround, crawl, nearestPool, isPoolAt, heightAt, SKY_H } from "./staticgen.js";
import { showLoad, hideLoad } from "./load.js";

export function staticDim() { return world.getDimension(STATIC_ID); }
export function inStatic(p) { try { return p.dimension.id === STATIC_ID; } catch { return false; } }

// one arena slot per active session, stored so we can reuse / clean up
function nextSlot() {
  let map = {};
  try { map = JSON.parse(world.getDynamicProperty("origin:static_slots") ?? "{}"); } catch { }
  const used = new Set(Object.values(map).map(Number));
  let s = 0; while (used.has(s)) s++;
  return s;
}
function saveSlot(id, slot) {
  let map = {}; try { map = JSON.parse(world.getDynamicProperty("origin:static_slots") ?? "{}"); } catch { }
  if (slot === null) delete map[id]; else map[id] = slot;
  try { world.setDynamicProperty("origin:static_slots", JSON.stringify(map)); } catch { }
}

const sessions = new Map(); // victimId -> session

// The Static is endless now: we only make sure the ground around your arrival point exists.
async function prepareArrival(slot) {
  const C0 = staticCenter(slot);
  const dim = staticDim();
  await loadArea(`origin_static_${slot}`, C0, 40, dim);
  for (let i = 0; i < 3; i++) { await genAround(C0, 2); await system.waitTicks(2); }
  // never arrive in a pool or inside a TV
  let best = null;
  for (let r = 0; r < 12 && !best; r++) for (let a = 0; a < 8 && !best; a++) {
    const x = Math.floor(C0.x + Math.cos(a * 0.785) * r * 2), z = Math.floor(C0.z + Math.sin(a * 0.785) * r * 2);
    const y = heightAt(x, z);
    try {
      const g = dim.getBlock({ x, y, z }), b1 = dim.getBlock({ x, y: y + 1, z }), b2 = dim.getBlock({ x, y: y + 2, z });
      if (g && !g.isAir && g.typeId !== "minecraft:water" && b1?.isAir && b2?.isAir) best = { x: x + 0.5, y: y + 1, z: z + 0.5 };
    } catch { }
  }
  return best ?? at(C0, 0.5, 2, 0.5);
}

// "waking up" in the Static: the screen snaps on like an old TV, the camera pulls out over the dead channel
async function arrivalScene(p, dest) {
  await runCine(p, async (c) => {
    const W = { red: 1, green: 1, blue: 1 }, K = { red: 0, green: 0, blue: 0 };
    c.fade(0, 0.25, 0.05, W);
    await c.wait(4);
    c.fade(0, 0.08, 0.05, K);
    c.cam(at(dest, 0, 1.6, 0.01), at(dest, 0, -4, 6));
    c.say("§8. . .", 14);
    await c.wait(6);
    c.fade(0, 0.1, 0.4, W);
    psound(p, "random.fizz", 0.4, 1.5);
    c.cam(at(dest, 0, SKY_H - 6, 0.01), at(dest, 0, 0, 0), 2.6, EASE.InOutSine);
    c.say("§7N O   S I G N A L", 50);
    for (let i = 0; i < 10; i++) {
      for (let k = 0; k < 8; k++) fx(p.dimension, "origin:static_dot", at(dest, (Math.random() - 0.5) * 20, Math.random() * 16, (Math.random() - 0.5) * 20), Math.random() < 0.5 ? C.white : { red: 0.1, green: 0.1, blue: 0.1 }, 1);
      if (i === 4) { c.fade(0, 0.05, 0.1, K); psound(p, "mob.warden.heartbeat", 1, 0.6); }
      await c.wait(5);
    }
    c.cam(at(dest, 7, 3, 7), at(dest, 0, 1.4, 0), 1.6, EASE.InOutCubic);
    c.say("§8channel §f∅", 40);
    await c.wait(30);
    c.cam(at(dest, -0.6, 1.7, -2.2), at(dest, 0, 1.6, 0), 0.8, EASE.OutQuad);
    await c.wait(14);
  });
}

// ------------------------------------------------------------------ enter / exit
export async function pullIn(caster, victim) {
  if (!victim || inStatic(victim)) { hudMsg(caster, "§7They're already somewhere else."); return false; }
  const vh = hero(victim);
  const r = RT(victim);
  if (r.staticLock || r.cine || r.traveling) return false;
  r.staticLock = true;
  try {
    const slot = nextSlot();
    saveSlot(victim.id, slot);
    const C = staticCenter(slot);
    try { victim.camera.fade({ fadeTime: { fadeInTime: 0.5, holdTime: 1.4, fadeOutTime: 1.0 }, fadeColor: { red: 0, green: 0, blue: 0 } }); } catch { }
    sound(victim.dimension, "ambient.cave", victim.location, 1.2, 0.5);
    psound(victim, "mob.warden.sonic_charge", 1.2, 0.7);
    fx(victim.dimension, "origin:void_swirl", at(victim.location, 0, 1, 0), C.grey, 1);
    await system.waitTicks(12);
    if (!valid(victim)) { saveSlot(victim.id, null); return false; }
    showLoad(victim, "st");
    const dest = await prepareArrival(slot);
    vh.staticState = { slot, from: locOf(victim), since: now(), caster: caster?.id ?? null, glitches: 0, nextGlitch: now() + 1200 };
    markDirty(victim);
    victim.teleport(dest, { dimension: staticDim() });
    cmd(victim, "fog @s push origin:static origin_static");
    try { victim.addEffect("slow_falling", 80, { showParticles: false }); victim.addEffect("night_vision", 99999, { showParticles: false }); } catch { }
    hideLoad(victim);
    await arrivalScene(victim, dest);
    title(victim, "§7T H E   S T A T I C", "§8find the blue water", 60);
    hudMsg(victim, "§7Find a §9blue pool§7 to get out. It gets worse the longer you stay.", 200);
    sessions.set(victim.id, { victim, slot, caster });
    if (caster && caster.id !== victim.id) {
      msg(caster, `§7You pulled §f${victim.name}§7 into the Static.`);
      quip(caster, "pulled_in", "They're in. Finish it, or let the noise do it for you.", 300, false);
    }
    return true;
  } finally {
    r.staticLock = false;
  }
}

export async function pullOut(victim, by = "exit") {
  const vh = hero(victim);
  const st = vh.staticState;
  if (!st) return;
  const r = RT(victim);
  vh.staticState = null;
  showLoad(victim, "ow", "§l§fSIGNAL RESTORED", "§7back to the world");
  system.runTimeout(() => hideLoad(victim), 50);
  markDirty(victim);
  sessions.delete(victim.id);
  saveSlot(victim.id, null);
  // undo every glitch
  restoreAll(victim);
  try { victim.camera.fade({ fadeTime: { fadeInTime: 0.4, holdTime: 0.8, fadeOutTime: 1.0 }, fadeColor: { red: 0.8, green: 0.9, blue: 1 } }); } catch { }
  psound(victim, "origin.sfx.swell", 1.2, 0.8);
  await system.waitTicks(9);
  if (!valid(victim)) return;
  const f = st.from;
  let dim = world.getDimension("overworld"), loc = null;
  if (f && f.dim !== STATIC_ID) { try { dim = world.getDimension(f.dim); loc = { x: f.x, y: f.y, z: f.z }; } catch { } }
  if (!loc) { const d = world.getDefaultSpawnLocation(); loc = { x: d.x + 0.5, y: d.y > 300 ? 120 : d.y, z: d.z + 0.5 }; }
  victim.teleport(loc, { dimension: dim });
  cmd(victim, "fog @s remove origin_static");
  try { victim.removeEffect("night_vision"); } catch { }
  try { victim.inputPermissions.setPermissionCategory(2, true); } catch { } // Movement back on (enum 2 = Movement)
  title(victim, "§f ", by === "pool" ? "§7You surface. Color rushes back." : "§7You're pulled free.", 50);
  unloadArea(`origin_static_${st.slot}`);
}

// ------------------------------------------------------------------ the glitches
const GLITCH_NAMES = ["stat", "shuffle", "chat", "reverse", "ui"];
function restoreAll(victim) {
  const r = RT(victim);
  try { victim.inputPermissions.setPermissionCategory(2, true); } catch { }
  try { victim.onScreenDisplay.setHudVisibility(1, []); } catch { } // Reset
  r.staticReverse = 0;
  r.staticChat = false;
  r.staticHideUi = false;
}

function doGlitch(victim, st) {
  const r = RT(victim);
  const intensity = Math.min(5, 1 + Math.floor((now() - st.since) / 1200)); // ramps up over time
  const pool = [];
  for (let i = 0; i < intensity + 1; i++) pool.push(GLITCH_NAMES[Math.floor(Math.random() * GLITCH_NAMES.length)]);
  st.glitches++;
  psound(victim, "mob.warden.heartbeat", 1.6, 0.6);
  sound(victim.dimension, "ambient.cave", victim.location, 1, 0.4);
  fx(victim.dimension, "origin:glitch", at(victim.getHeadLocation(), 0, 0.3, 0), C.white, 1);
  cmd(victim, "camerashake add @s 0.5 0.4 positional");
  for (const g of new Set(pool)) {
    if (g === "stat") {
      const n = Math.floor(Math.random() * 20);
      hudMsg(victim, `§7§kX§r §8stat corrupted §7(${n}) §kX`, 60);
      psound(victim, "random.levelup", 2, 0.3);
    } else if (g === "shuffle") {
      shuffleInv(victim);
      hudMsg(victim, "§8your things rearranged themselves", 50);
    } else if (g === "chat") {
      r.staticChat = true;
      const fake = ["can anyone hear me", "where did everyone go", "it's still watching", "turn it off turn it off", "channel zero is live"];
      for (let i = 0; i < 2 + intensity; i++) system.runTimeout(() => valid(victim) && victim.sendMessage(`§8<${garbleChat(victim, "????")}> §7${garbleChat(victim, fake[Math.floor(Math.random() * fake.length)])}`), i * 15);
      hudMsg(victim, "§8y̶o̶u̶r̶ ̶w̶o̶r̶d̶s̶ ̶d̶o̶n̶'̶t̶ ̶c̶o̶m̶e̶ ̶o̶u̶t̶ ̶r̶i̶g̶h̶t", 60);
    } else if (g === "reverse") {
      r.staticReverse = now() + 20 * (6 + intensity * 2);
      hudMsg(victim, "§8which way is forward?", 50);
    } else if (g === "ui") {
      r.staticHideUi = true;
      try { victim.onScreenDisplay.setHudVisibility(0, [0, 1, 4, 5, 10]); } catch { } // Hide a few HUD elements
      system.runTimeout(() => { if (valid(victim) && hero(victim).staticState) { try { victim.onScreenDisplay.setHudVisibility(1, []); } catch { } RT(victim).staticHideUi = false; } }, 20 * 8);
    }
  }
  st.nextGlitch = now() + Math.max(200, 1200 - intensity * 160) + Math.floor(Math.random() * 200);
}

function shuffleInv(victim) {
  try {
    const c = victim.getComponent("minecraft:inventory")?.container;
    if (!c) return;
    const idx = [];
    for (let i = 0; i < 9; i++) idx.push(i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (let i = 0; i < 9; i++) if (i < idx[i]) c.swapItems(i, idx[i], c);
  } catch { }
}

// ------------------------------------------------------------------ ticks
// every 10 ticks
export function tickStatic() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const h = hero(p);
    const st = h.staticState;
    if (!st) {
      if (inStatic(p)) { // somehow in the Static with no session (relog): get them out
        h.staticState = { slot: 0, from: null, since: t, caster: null, glitches: 0, nextGlitch: t };
        pullOut(p, "exit");
      }
      continue;
    }
    if (!inStatic(p)) { h.staticState = null; markDirty(p); continue; }
    // ambient grayscale dots raining
    for (let i = 0; i < 3; i++) {
      const m = at(p.location, (Math.random() - 0.5) * 18, 6 + Math.random() * 6, (Math.random() - 0.5) * 18);
      fx(p.dimension, "origin:static_dot", m, Math.random() < 0.5 ? C.white : { red: 0.1, green: 0.1, blue: 0.1 }, 0.9);
    }
    // the world builds itself ahead of you, and the static crawls
    const k = Math.floor(t / 10);   // tickStatic runs every 10 ticks
    if (k % 2 === 0) genAround(p.location, 3);
    crawl(p, 10 + Math.min(20, Math.floor((t - st.since) / 600) * 4));
    if (k % 20 === 0) { try { p.addEffect("night_vision", 99999, { showParticles: false }); } catch { } }
    if (k % 4 === 0) psound(p, "random.fizz", 0.15, 0.3 + Math.random() * 0.4);
    // the faint pull of water: a hint toward the nearest pool you've passed near
    if (k % 10 === 0) {
      const np = nearestPool(p.location);
      if (np && np.dist < 120) {
        const a = Math.atan2(np.z - p.location.z, np.x - p.location.x) * 180 / Math.PI;
        const dirs = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
        hudMsg(p, `§9...you hear water to the ${dirs[Math.round(((a + 360) % 360) / 45) % 8]} §8(~${Math.round(np.dist)}m)`, 60);
      }
    }
    // escape pool?
    if (isPoolAt(p.location) || isPoolAt(at(p.location, 0, -0.4, 0))) { pullOut(p, "pool"); continue; }
    // reversed controls: shove them opposite their input
    if ((RT(p).staticReverse ?? 0) > t) {
      try {
        const mv = p.inputInfo.getMovementVector();
        if (Math.hypot(mv.x, mv.y) > 0.1) {
          const f = V.flat(p.getViewDirection());
          const r = { x: f.z, z: -f.x };
          const push = { x: -(f.x * mv.y + r.x * mv.x) * 0.5, z: -(f.z * mv.y + r.z * mv.x) * 0.5 };
          p.applyKnockback(push, 0);
        }
      } catch { }
    }
    if (t >= st.nextGlitch) doGlitch(p, st);
    // keep them from falling through the void
    if (p.location.y < STATIC_Y - 10) {
      try { p.teleport({ x: p.location.x, y: heightAt(p.location.x, p.location.z) + 2, z: p.location.z }, { dimension: staticDim() }); } catch { }
    }
  }
}

// chat garble (before-event)
export function garbleChat(player, message) {
  const CH = "▓▒░#@%&!?*".split("");
  return [...message].map((c) => (c === " " ? " " : Math.random() < 0.7 ? CH[Math.floor(Math.random() * CH.length)] : c)).join("");
}

export function isCaster(p) {
  for (const s of sessions.values()) if (s.caster?.id === p.id) return true;
  return false;
}
export function victimsOf(casterId) {
  const out = [];
  for (const s of sessions.values()) if (s.caster?.id === casterId && valid(s.victim)) out.push(s.victim);
  return out;
}
export function anyVictimNear(p, range = 48) {
  for (const s of sessions.values()) if (valid(s.victim) && s.victim.dimension.id === p.dimension.id && V.dist(s.victim.location, p.location) < range) return s.victim;
  return null;
}
