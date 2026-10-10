// ORIGIN v0.20 - gorefx.js
// Gore, done the BloodFX way: droplets that fall and stick where they land, pools that spread on the ground under
// the wounded and the dead and slowly dry, a red mist on heavy hits, and gibs when something is destroyed outright.
// Follows /hero gore (full | mild | off).
import { system } from "@minecraft/server";
import { at, valid, fx, isSolidBlock } from "./util.js";
import { goreSetting } from "./dismember.js";

const DRY = new Set(["minecraft:skeleton", "minecraft:stray", "minecraft:wither_skeleton", "minecraft:bogged", "minecraft:blaze", "minecraft:iron_golem", "minecraft:snow_golem", "minecraft:slime", "minecraft:magma_cube",
  "minecraft:armor_stand", "minecraft:vex", "minecraft:allay", "minecraft:breeze", "minecraft:creaking", "minecraft:shulker", "minecraft:wither", "minecraft:ender_dragon", "minecraft:end_crystal", "origin:null", "origin:static_echo"]);
const RED = { red: 0.6, green: 0.03, blue: 0.03 };
const bleeds = (e) => valid(e) && !DRY.has(e.typeId) && !/item|xp_orb|arrow|projectile|origin:(float_text|carry|regen_body|afterimage|exo_|archetype_orb|manifestation|lumen|training)/.test(e.typeId);
export function groundUnder(dim, l) {
  for (let dy = 0; dy <= 5; dy++) {
    try { const b = dim.getBlock({ x: Math.floor(l.x), y: Math.floor(l.y) - dy, z: Math.floor(l.z) }); if (isSolidBlock(b)) return b.location.y + 1.02; } catch { return null; }
  }
  return null;
}
export function bloodPool(dim, l, size = 0.8, life = 40) {
  const y = groundUnder(dim, l);
  if (y === null) return;
  fx(dim, "origin:blood_pool", { x: l.x + (Math.random() - 0.5) * 0.4, y, z: l.z + (Math.random() - 0.5) * 0.4 }, { red: 1, green: 1, blue: 1 }, 1, { size, life, v: Math.floor(Math.random() * 4) });
}
export function bleed(e, amount, dir) {
  const g = goreSetting();
  if (g === "off" || !bleeds(e)) return;
  const c = at(e.location, 0, (e.getHeadLocation().y - e.location.y) * 0.6, 0);
  fx(e.dimension, "origin:blood_drops", c, RED, 1, { n: g === "mild" ? 5 : Math.min(40, 6 + amount * 2), dx: dir?.x ?? 0, dz: dir?.z ?? 0 });
  if (g === "full" && amount >= 6) { fx(e.dimension, "origin:blood_mist", c, RED, 1, { n: Math.min(22, amount), spd: 1 }); if (Math.random() < 0.55) bloodPool(e.dimension, e.location, 0.5 + Math.min(1, amount / 20)); }
}
export function goreBurst(e, power = 1) {
  const g = goreSetting();
  if (g === "off" || !bleeds(e)) return;
  const c = at(e.location, 0, 1, 0);
  fx(e.dimension, "origin:blood_drops", c, RED, 1, { n: g === "mild" ? 10 : 40 });
  if (g !== "full") return;
  fx(e.dimension, "origin:blood_mist", c, RED, 1, { n: 18 + power * 8, spd: 1 + power * 0.4 });
  bloodPool(e.dimension, e.location, 1 + power * 0.45);
  if (power >= 3) fx(e.dimension, "origin:gibs", c, RED, 1, { n: 14 });
}
export function onGoreHurt(e, amount, src) {
  if (!(amount >= 2)) return;
  const by = src?.damagingEntity;
  let d = null;
  if (valid(by)) { const dx = e.location.x - by.location.x, dz = e.location.z - by.location.z, l = Math.hypot(dx, dz) || 1; d = { x: dx / l, z: dz / l }; }
  bleed(e, amount, d);
}
export function onGoreDeath(e) {
  if (goreSetting() !== "full" || !bleeds(e)) return;
  const loc = { ...e.location }, dim = e.dimension;
  system.runTimeout(() => bloodPool(dim, loc, 1.3, 60), 10);
  system.runTimeout(() => bloodPool(dim, at(loc, 0.3, 0, -0.2), 0.9, 60), 26);
}
