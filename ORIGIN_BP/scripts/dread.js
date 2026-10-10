// ORIGIN v0.02 - dread.js
// Dread meter (0-100, on the player) and the two fear effects (on mobs): Unease and Dread.
import { world } from "@minecraft/server";
import { hero, RT, markDirty } from "./data.js";
import { clamp, now, valid, fx, sound, psound, cmd, C } from "./util.js";
import { quip } from "./voice.js";

// ------------------------------------------------------------------ meter
export function addDread(player, amount) {
  const h = hero(player);
  if (!h.awakened) return;
  let a = amount;
  if (a > 0 && h.arch === "shadow") a *= 1.5;
  h.dread = clamp(h.dread + a, 0, 100);
  markDirty(player);
}

export function setDread(player, value) {
  const h = hero(player);
  h.dread = clamp(Number(value) || 0, 0, 100);
  markDirty(player);
}

// Runs every 20 ticks
export function tickDreadMeter(player) {
  const h = hero(player);
  if (!h.awakened) return;
  const r = RT(player);
  const t = now();
  const idle = t - r.lastCombat;
  // Decay after 8s out of combat: 1 point every 2s (Shadow: every 3s)
  const every = h.arch === "shadow" ? 60 : 40;
  if (idle > 160 && h.dread > 0 && t % every < 20) {
    h.dread = Math.max(0, h.dread - 1);
    markDirty(player);
  }
  // High-dread haze
  // the red haze belongs to your Inner World only - never the overworld
  const inside = player.dimension.id === "origin:inner_world";
  if (h.dread >= 70 && !r.dreadFog && inside) {
    r.dreadFog = true;
    cmd(player, "fog @s push origin:dread_haze origin_dread");
    if (!r.highDreadSeen) {
      r.highDreadSeen = true;
      quip(player, "high_dread", "Careful. I like it in here a little too much right now.", 6000);
    }
  } else if ((h.dread < 65 || !inside) && r.dreadFog) {
    r.dreadFog = false;
    cmd(player, "fog @s remove origin_dread");
  }
  // Menace aura: monsters near you get Uneasy
  const threshold = h.arch === "shadow" ? 25 : 35;
  if (h.dread >= threshold && t % 40 < 20) {
    try {
      const mobs = player.dimension.getEntities({ location: player.location, maxDistance: 5, families: ["monster"] });
      for (const m of mobs) applyFear(m, "unease", 60, false);
      if (mobs.length) fx(player.dimension, "origin:ring", { ...player.location, y: player.location.y + 0.1 }, C.blood, 0.6, { radius: 5 });
    } catch { }
  }
}

// Runs every 10 ticks
export function tickHeartbeat(player) {
  const h = hero(player);
  if (!h.awakened || h.dread < 70) return;
  const r = RT(player);
  const t = now();
  if (t - r.lastHeart >= 30) {
    r.lastHeart = t;
    psound(player, "mob.warden.heartbeat", 1, 0.7);
  }
}

// ------------------------------------------------------------------ fear effects
const fears = new Map(); // entityId -> { e, type, until, nextStagger }

export function applyFear(e, type, ticks, loud = true) {
  if (!valid(e)) return;
  if (e.typeId === "minecraft:player") return; // v0.01: fear only affects mobs
  const t = now();
  const cur = fears.get(e.id);
  if (cur && cur.until > t && cur.type === "dread" && type === "unease") return; // never downgrade
  const until = Math.max(t + ticks, cur && cur.type === type ? cur.until : 0);
  fears.set(e.id, { e, type, until, nextStagger: cur?.nextStagger ?? t + 20 });
  const dur = until - t;
  try {
    e.addEffect("slowness", dur, { amplifier: type === "dread" ? 2 : 0, showParticles: false });
    e.addEffect("weakness", dur, { amplifier: type === "dread" ? 1 : 0, showParticles: false });
  } catch { }
  if (loud) {
    try {
      const head = e.getHeadLocation();
      fx(e.dimension, "origin:burst", head, type === "dread" ? C.crimson : C.grey, 0.8);
      if (type === "dread") sound(e.dimension, "mob.warden.heartbeat", head, 1.3, 0.6);
    } catch { }
  }
}

export function fearOf(e) {
  const f = fears.get(e.id);
  if (!f || f.until <= now()) return null;
  return f.type;
}

// Runs every 10 ticks
export function tickFears() {
  const t = now();
  for (const [id, f] of fears) {
    if (!valid(f.e) || f.until <= t) { fears.delete(id); continue; }
    try {
      const head = f.e.getHeadLocation();
      fx(f.e.dimension, "origin:wisp", head, f.type === "dread" ? C.blood : C.grey, 0.9);
      if (f.type === "dread" && t >= f.nextStagger) {
        // Stagger: a short freeze that reads as the mob flinching
        f.nextStagger = t + 40;
        f.e.addEffect("slowness", 8, { amplifier: 6, showParticles: false });
        fx(f.e.dimension, "origin:burst", head, C.crimson, 0.6);
      }
    } catch { }
  }
}

export function fearCount() {
  return fears.size;
}

export function allPlayers() {
  return world.getAllPlayers();
}
