// ORIGIN v0.18 - impact.js
// Heavy hits make bodies FLY: they smash straight through trees, crater into hillsides, then hit the ground and skid -
// a Skid Trail on normal ground, an Impact Trench on the biggest hits - in smoke and debris. Sky knockdowns come
// down at extreme speed and crater the ground. Only big hits do this (finishers, haymakers, spikes, boss finishers).
// /hero destruction off: bodies still fly and skid, but no blocks are broken.
import { world } from "@minecraft/server";
import { V, at, valid, fx, sound, C, hexToRgb } from "./util.js";
import { trailLine } from "./slashfx.js";
import { bleed, goreBurst } from "./gorefx.js";
const TRAIL = { red: 0.95, green: 0.95, blue: 0.95 };
const SPD = [0, 1.9, 2.7, 3.5], LIFT = [0, 0.36, 0.42, 0.5], GRAV = [0, 0.06, 0.045, 0.034];

const flyers = new Map();
const TREE = /(_log|_wood|_leaves|_stem|mushroom_block|bamboo$|vine)/;
const NATURAL = /(grass_block|dirt|podzol|mycelium|sand|gravel|clay|:stone$|andesite|diorite|granite|deepslate$|tuff|calcite|snow|terracotta|netherrack|end_stone|moss_block|:mud$|sandstone$|cobblestone$)/;
const SURFACE = /(grass_block|dirt$|podzol|mycelium|sand$|gravel|snow|moss_block|coarse_dirt)/;
const DUST = hexToRgb("#8a7f70"), SMOKE = hexToRgb("#5a5550"), WOOD = hexToRgb("#6b4f2e");
export const destructionOn = () => world.getDynamicProperty("origin:destruction") !== "off";
export function setDestruction(on) { world.setDynamicProperty("origin:destruction", on ? "on" : "off"); }
const shakeNear = (dim, c, r, a) => { try { for (const q of dim.getPlayers({ location: c, maxDistance: r })) q.runCommand(`camerashake add @s ${a} 0.35 positional`); } catch { } };
function smash(dim, c, r, treesOnly) {
  if (!destructionOn()) return 0;
  let n = 0;
  const R = Math.ceil(r);
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
    if (dx * dx + dy * dy + dz * dz > r * r + 0.3) continue;
    try {
      const b = dim.getBlock({ x: Math.floor(c.x) + dx, y: Math.floor(c.y) + dy, z: Math.floor(c.z) + dz });
      if (!b || b.isAir || b.isLiquid) continue;
      if (treesOnly ? !TREE.test(b.typeId) : !(TREE.test(b.typeId) || NATURAL.test(b.typeId))) continue;
      b.setType("minecraft:air"); n++;
    } catch { }
  }
  return n;
}
export function crater(dim, c, power = 2) {
  const g = at(c, 0, -1, 0);
  smash(dim, g, 1.2 + power * 0.5, false);
  fx(dim, "origin:shockwave", at(c, 0, 0.1, 0), C.white, 1, { radius: 2 + power * 1.5 });
  for (let k = 0; k < 2 + power; k++) { fx(dim, "origin:debris", c, C.dust, 1); fx(dim, "origin:boom_smoke", at(c, (Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2), SMOKE, 0.8); }
  fx(dim, "origin:dust", c, DUST, 1);
  sound(dim, "origin.sfx.stonecrash", c, 0.7, 1); sound(dim, "random.explode", c, 0.6, 0.5);
  shakeNear(dim, c, 28, 0.3 + power * 0.1);
}
// launch a body. power 1 = big hit, 2 = through trees / skid trench, 3 = through hillsides. o.down = sky knockdown
export function heavyLaunch(e, dir, power = 1, by = null, o = {}) {
  if (!valid(e)) return;
  power = Math.max(1, Math.min(3, power));
  const d = V.flat(dir), sp = SPD[power];
  const f = { e, d, power, by, sp, vy: o.down ? -(2.2 + power * 0.6) : LIFT[power], t: 0, mode: o.down ? "fall" : "air", slid: 0, last: { ...e.location } };
  goreBurst(e, power >= 3 ? 2 : 1);
  flyers.set(e.id, f);
  try { e.applyKnockback({ x: d.x * sp, z: d.z * sp }, f.vy); } catch { }
  sound(e.dimension, "origin.sfx.windblast", e.location, 0.9, 0.7);
}
export const isFlung = (e) => flyers.has(e?.id);
// every tick
export function tickImpact() {
  for (const [id, f] of flyers) {
    const e = f.e;
    if (!valid(e) || ++f.t > 110) { flyers.delete(id); continue; }
    const dim = e.dimension, L = e.location;
    if (f.mode !== "slide") trailLine(dim, at(f.last, 0, 0.9, 0), at(L, 0, 0.9, 0), TRAIL, { size: 0.5, life: 1.6 });
    else if (f.slid % 2 === 0) trailLine(dim, at(f.last, 0, 0.25, 0), at(L, 0, 0.25, 0), { red: 0.75, green: 0.7, blue: 0.62 }, { size: 0.32, life: 1.2, alpha: 0.6 });
    f.last = { ...L };
    if (f.t % 2 === 0) { fx(dim, "origin:boom_smoke", at(L, 0, 0.7, 0), SMOKE, 0.45); fx(dim, "origin:dust", L, DUST, 0.5); }
    if (f.mode === "air") {
      let hb = null;
      try { hb = dim.getBlockFromRay(at(L, 0, 0.9, 0), { x: f.d.x, y: 0, z: f.d.z }, { maxDistance: f.sp + 0.8, includePassableBlocks: false, includeLiquidBlocks: false })?.block; } catch { }
      if (hb) {
        if (TREE.test(hb.typeId) && smash(dim, hb.location, 1.7, true) > 0) {
          fx(dim, "origin:debris", hb.location, WOOD, 1); fx(dim, "origin:boom_smoke", hb.location, SMOKE, 0.7);
          sound(dim, "dig.wood", hb.location, 0.7, 1); sound(dim, "origin.sfx.impact", hb.location, 0.8, 0.8);
          f.sp *= 0.82;
        } else if (f.power >= 2 && NATURAL.test(hb.typeId) && destructionOn()) {
          smash(dim, hb.location, f.power >= 3 ? 2.3 : 1.6, false);
          fx(dim, "origin:shockwave", hb.location, C.white, 1, { radius: 2.5 }); fx(dim, "origin:debris", hb.location, C.dust, 1); fx(dim, "origin:boom_smoke", hb.location, SMOKE, 1);
          sound(dim, "origin.sfx.stonecrash", hb.location, 0.8, 1); shakeNear(dim, hb.location, 24, 0.35); bleed(e, 8);
          f.sp *= f.power >= 3 ? 0.78 : 0.45;
          if (f.sp < 1) { f.mode = "slide"; }
        } else {
          fx(dim, "origin:shockwave", hb.location, C.white, 1, { radius: 1.6 }); fx(dim, "origin:debris", hb.location, C.dust, 0.8);
          sound(dim, "origin.sfx.impact", hb.location, 0.7, 1);
          f.mode = "slide"; f.sp *= 0.3;
        }
      }
      if (f.mode === "air") {
        f.vy = Math.max(-1.4, f.vy - GRAV[f.power]);
        try { e.applyKnockback({ x: f.d.x * f.sp, z: f.d.z * f.sp }, f.vy); } catch { }
        if (e.isOnGround && f.t > 3) { f.mode = "slide"; fx(dim, "origin:shockwave", at(L, 0, 0.1, 0), DUST, 1, { radius: 1.8 }); sound(dim, "origin.sfx.impact", L, 0.9, 0.8); }
      }
    } else if (f.mode === "fall") {
      try { e.applyKnockback({ x: f.d.x * 0.25, z: f.d.z * 0.25 }, f.vy); } catch { }
      if (f.t % 2 === 0) fx(dim, "origin:streak", at(L, 0, 1.4, 0), C.white, 0.8, { dx: 0, dy: -1, dz: 0, len: 1.4, w: 0.07, spd: 0.4, life: 0.2 });
      if (e.isOnGround || f.t > 60) { crater(dim, L, f.power); f.mode = "slide"; f.sp = 0.7 + f.power * 0.25; }
    }
    if (f.mode === "slide") {
      f.sp *= 0.88; f.slid++;
      try { e.applyKnockback({ x: f.d.x * f.sp, z: f.d.z * f.sp }, 0); } catch { }
      const side = { x: -f.d.z, z: f.d.x };
      fx(dim, "origin:dust", at(L, side.x * 0.6, 0.1, side.z * 0.6), DUST, 0.8); fx(dim, "origin:dust", at(L, -side.x * 0.6, 0.1, -side.z * 0.6), DUST, 0.8);
      if (f.slid % 3 === 0) fx(dim, "origin:debris", L, C.dust, 0.5);
      if (destructionOn()) {
        try {
          const under = dim.getBlock({ x: Math.floor(L.x), y: Math.floor(L.y) - 1, z: Math.floor(L.z) });
          if (under && SURFACE.test(under.typeId)) {
            if (f.power >= 2 && f.slid <= 10) under.setType("minecraft:air");          // impact trench
            else if (under.typeId !== "minecraft:coarse_dirt") under.setType("minecraft:coarse_dirt");   // skid trail
          }
        } catch { }
      }
      if (f.sp < 0.22 || f.slid > 26) { fx(dim, "origin:dust", L, DUST, 1); flyers.delete(id); }
    }
  }
}
