// ORIGIN v0.05 - staticgen.js
// THE STATIC, rebuilt: an endless dead-channel world generated around you as you walk.
//  - rolling grayscale ground dithered like TV snow, and a SKY made of static (no sun, ever)
//  - the static is ALIVE: ground and sky crawl and flicker around you
//  - landmarks: dead CRT TVs (some showing color bars), leaning antenna masts, floating dead pixels,
//    rare glitch trees in impossible colors, Null Crystal clusters, and the rare blue pools (the only way out)
//  - everything is deterministic per chunk, so the world is the same if you come back
import { world, system, BlockVolume } from "@minecraft/server";
import { STATIC_ID, STATIC_Y } from "./plan.js";

export const SKY_H = 34;                         // the static sky hangs this far above the ground
const CHUNK = 16;
const B = {
  k: "minecraft:black_concrete", d: "minecraft:gray_concrete", l: "minecraft:light_gray_concrete", w: "minecraft:white_concrete",
  base: "minecraft:gray_concrete", mark: "minecraft:bedrock", water: "minecraft:water", rim: "minecraft:light_blue_concrete", rim2: "minecraft:blue_concrete",
  bars: "minecraft:iron_bars", red: "minecraft:red_concrete", glass: "minecraft:tinted_glass", crystal: "origin:null_crystal_ore",
};
const BARS = ["minecraft:white_wool", "minecraft:yellow_wool", "minecraft:cyan_wool", "minecraft:lime_wool", "minecraft:magenta_wool", "minecraft:red_wool", "minecraft:blue_wool"];
const GLITCH = ["minecraft:magenta_concrete", "minecraft:lime_concrete", "minecraft:cyan_concrete", "minecraft:yellow_concrete", "minecraft:orange_concrete", "minecraft:purple_concrete", "minecraft:pink_concrete"];
const GRAYS = [B.k, B.d, B.l, B.w];

// ------------------------------------------------------------------ noise
function hash(x, z, s = 0) {
  let h = (x * 374761393 + z * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z, sc, s) {
  const fx = x / sc, fz = z / sc;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = fx - x0, tz = fz - z0;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash(x0, z0, s), b = hash(x0 + 1, z0, s), c = hash(x0, z0 + 1, s), d = hash(x0 + 1, z0 + 1, s);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz;
}
export function heightAt(x, z) {
  const n = vnoise(x, z, 38, 1) * 0.7 + vnoise(x, z, 13, 2) * 0.3;
  return STATIC_Y + Math.round((n - 0.5) * 6);
}
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
function grayAt(x, z, s = 3) {
  const n = vnoise(x, z, 9, s) * 0.6 + hash(x, z, s + 9) * 0.4;     // TV snow: smooth patches + pure noise
  const t = (BAYER[((z % 4) + 4) % 4][((x % 4) + 4) % 4] + 0.5) / 16;
  const v = Math.min(0.999, Math.max(0, n + (t - 0.5) * 0.35));
  return GRAYS[Math.floor(v * 4)];
}

// ------------------------------------------------------------------ what's in a chunk
export function chunkFeatures(cx, cz) {
  const r = (k) => hash(cx, cz, k);
  const f = [];
  const spot = (k) => ({ x: cx * CHUNK + 3 + Math.floor(r(k) * 10), z: cz * CHUNK + 3 + Math.floor(r(k + 1) * 10) });
  if (r(10) < 0.05) f.push({ type: "pool", ...spot(11), size: r(12) < 0.4 ? 2 : 1 });
  if (r(20) < 0.10) f.push({ type: "tree", ...spot(21), h: 5 + Math.floor(r(22) * 5) });
  if (r(30) < 0.22) f.push({ type: "tv", ...spot(31), bars: r(32) < 0.35, w: 3 + Math.floor(r(33) * 3), dir: Math.floor(r(34) * 4) });
  if (r(40) < 0.11) f.push({ type: "mast", ...spot(41), h: 12 + Math.floor(r(42) * 12), lean: r(43) < 0.5 ? 1 : -1 });
  if (r(50) < 0.12) f.push({ type: "crystal", ...spot(51) });
  if (r(60) < 0.35) f.push({ type: "pixels", ...spot(61), n: 2 + Math.floor(r(62) * 4) });
  return f;
}
export const chunkOf = (v) => Math.floor(v / CHUNK);

// ------------------------------------------------------------------ generation
const done = new Set();      // chunks finished this session (the bedrock marker covers reloads)
const queued = new Set();
export const poolsSeen = new Map();   // "cx,cz" -> {x,y,z}

function isGenerated(dim, cx, cz) {
  const k = `${cx},${cz}`;
  if (done.has(k)) return true;
  try {
    const b = dim.getBlock({ x: cx * CHUNK, y: STATIC_Y - 6, z: cz * CHUNK });
    if (b?.typeId === B.mark) { done.add(k); notePools(cx, cz); return true; }
  } catch { }
  return false;
}
function notePools(cx, cz) {
  for (const f of chunkFeatures(cx, cz)) if (f.type === "pool") poolsSeen.set(`${cx},${cz}`, { x: f.x, y: heightAt(f.x, f.z), z: f.z });
}

function* genChunk(dim, cx, cz) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const set = (x, y, z, id) => { try { dim.getBlock({ x, y, z })?.setType(id); } catch { } };
  const fill = (a, b, id) => { try { dim.fillBlocks(new BlockVolume(a, b), id); } catch { } };
  // bedrock floor + marker, under-layer
  fill({ x: x0, y: STATIC_Y - 6, z: z0 }, { x: x0 + 15, y: STATIC_Y - 6, z: z0 + 15 }, B.mark);
  fill({ x: x0, y: STATIC_Y - 5, z: z0 }, { x: x0 + 15, y: STATIC_Y - 4, z: z0 + 15 }, B.base);
  // the static sky: a black slab with snow
  const sky = STATIC_Y + SKY_H;
  fill({ x: x0, y: sky, z: z0 }, { x: x0 + 15, y: sky, z: z0 + 15 }, B.k);
  yield;
  for (let dx = 0; dx < CHUNK; dx++) {
    for (let dz = 0; dz < CHUNK; dz++) {
      const x = x0 + dx, z = z0 + dz;
      const h = heightAt(x, z);
      if (h > STATIC_Y - 3) fill({ x, y: STATIC_Y - 3, z }, { x, y: h - 1, z }, B.base);
      set(x, h, z, grayAt(x, z));
      const s = hash(x, z, 99);
      if (s < 0.3) set(x, sky, z, s < 0.1 ? B.w : s < 0.2 ? B.l : B.d);
    }
    yield;
  }
  for (const f of chunkFeatures(cx, cz)) { yield* feature(dim, f, set, fill); yield; }
  done.add(`${cx},${cz}`);
  notePools(cx, cz);
}

function* feature(dim, f, set, fill) {
  const g = heightAt(f.x, f.z);
  if (f.type === "pool") {
    const R = f.size + 1;
    for (let dx = -R - 1; dx <= R + 1; dx++) for (let dz = -R - 1; dz <= R + 1; dz++) {
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d <= R) { set(f.x + dx, g, f.z + dz, B.water); set(f.x + dx, g - 1, f.z + dz, B.rim2); }
      else set(f.x + dx, g, f.z + dz, (dx + dz) % 2 ? B.rim : B.rim2);
      for (let y = 1; y <= 3; y++) set(f.x + dx, g + y, f.z + dz, "minecraft:air");
    }
  } else if (f.type === "tree") {
    // a pixel tree in colors that shouldn't exist here
    for (let y = 1; y <= f.h; y++) set(f.x, g + y, f.z, y % 3 ? "minecraft:purple_glazed_terracotta" : "minecraft:magenta_glazed_terracotta");
    const top = g + f.h;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -1; dy <= 2; dy++) {
      const d = Math.abs(dx) + Math.abs(dz) + Math.abs(dy) * 1.5;
      if (d > 4.2 || hash(f.x + dx, f.z + dz, dy + 7) < 0.25) continue;
      set(f.x + dx, top + dy, f.z + dz, GLITCH[Math.floor(hash(f.x + dx * 3, f.z + dz * 5, dy) * GLITCH.length)]);
    }
  } else if (f.type === "tv") {
    // a dead CRT: black box, gray screen with scanlines (or color bars), tilted antenna
    const w = f.w, hgt = w;
    const ax = f.dir % 2 === 0;
    for (let i = -1; i <= w; i++) for (let y = 0; y <= hgt; y++) for (let k = 0; k < 3; k++) {
      const [x, z] = ax ? [f.x + i, f.z + k] : [f.x + k, f.z + i];
      const edge = i === -1 || i === w || y === 0 || y === hgt || k > 0;
      let id = B.k;
      if (!edge) id = f.bars ? BARS[Math.min(BARS.length - 1, Math.floor((i / w) * BARS.length))] : (y % 2 ? B.l : grayAt(x, y * 7));
      set(x, g + 1 + y, z, id);
    }
    const [mx, mz] = ax ? [f.x + Math.floor(w / 2), f.z + 1] : [f.x + 1, f.z + Math.floor(w / 2)];
    for (let y = 1; y <= 3; y++) { set(mx - y, g + hgt + 1 + y, mz, B.bars); set(mx + y, g + hgt + 1 + y, mz, B.bars); }
  } else if (f.type === "mast") {
    for (let y = 1; y <= f.h; y++) {
      const off = Math.floor((y / f.h) * 3) * f.lean;
      set(f.x + off, g + y, f.z, y % 4 === 0 ? B.d : B.bars);
      if (y % 6 === 0) { set(f.x + off + 1, g + y, f.z, B.bars); set(f.x + off - 1, g + y, f.z, B.bars); }
    }
    set(f.x + 3 * f.lean, g + f.h + 1, f.z, B.red);
  } else if (f.type === "crystal") {
    set(f.x, g + 1, f.z, B.crystal);
    set(f.x + 1, g, f.z, B.k); set(f.x - 1, g, f.z, B.k); set(f.x, g, f.z + 1, B.k); set(f.x, g, f.z - 1, B.k);
  } else if (f.type === "pixels") {
    for (let i = 0; i < f.n; i++) {
      const x = f.x + Math.floor(hash(f.x, i, 3) * 8) - 4, z = f.z + Math.floor(hash(f.z, i, 4) * 8) - 4;
      set(x, g + 4 + Math.floor(hash(x, z, 5) * 14), z, hash(x, z, 6) < 0.5 ? B.w : B.k);
    }
  }
}

// queue generation for chunks around a point (only loaded chunks can be written)
export function genAround(loc, radius = 2) {
  const dim = world.getDimension(STATIC_ID);
  const ccx = chunkOf(loc.x), ccz = chunkOf(loc.z);
  const todo = [];
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
    const cx = ccx + dx, cz = ccz + dz, k = `${cx},${cz}`;
    if (queued.has(k) || done.has(k)) continue;
    try { if (!dim.isChunkLoaded({ x: cx * CHUNK + 8, y: STATIC_Y, z: cz * CHUNK + 8 })) continue; } catch { continue; }
    if (isGenerated(dim, cx, cz)) continue;
    todo.push([cx, cz, dx * dx + dz * dz]);
  }
  todo.sort((a, b) => a[2] - b[2]);
  if (!todo.length) return null;
  for (const [cx, cz] of todo) queued.add(`${cx},${cz}`);
  return new Promise((res) => {
    system.runJob((function* () {
      for (const [cx, cz] of todo) { try { yield* genChunk(dim, cx, cz); } catch { } queued.delete(`${cx},${cz}`); }
      res(true);
    })());
  });
}

// the static crawls: flip a handful of ground/sky blocks around someone
export function crawl(p, n = 14) {
  const dim = p.dimension;
  for (let i = 0; i < n; i++) {
    const x = Math.floor(p.location.x + (Math.random() - 0.5) * 26), z = Math.floor(p.location.z + (Math.random() - 0.5) * 26);
    const ck = `${chunkOf(x)},${chunkOf(z)}`;
    if (!done.has(ck)) continue;
    const ground = i % 3 !== 0;
    const y = ground ? heightAt(x, z) : STATIC_Y + SKY_H;
    try {
      const b = dim.getBlock({ x, y, z });
      if (!b || !GRAYS.includes(b.typeId)) continue;
      b.setType(GRAYS[Math.floor(Math.random() * 4)]);
    } catch { }
  }
}

// nearest known exit: for the "signal" hint on the HUD
export function nearestPool(loc) {
  let best = null, bd = 1e9;
  for (const p of poolsSeen.values()) {
    const d = Math.hypot(p.x - loc.x, p.z - loc.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { ...best, dist: bd } : null;
}
// does this column sit in pool water? (used for the exit check)
export function isPoolAt(loc) {
  try {
    const b = world.getDimension(STATIC_ID).getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });
    return b?.typeId === B.water;
  } catch { return false; }
}
