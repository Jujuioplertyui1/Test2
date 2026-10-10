// ORIGIN v0.24 - asgard.js
// ASGARD: a floating realm of gold above a sea of clouds - the observatory where the Bifrost lands, a rainbow bridge
// watched by two golden guardians, a palace with towers and a dome, a great golden tree, floating islets, flower
// meadows, lamps and braziers, waterfalls pouring off the edge of the world. Golden motes drift, leaves fall, light
// shafts break through, mist rises off the falls, the bridge shimmers and the northern lights hang overhead.
// The only way in is the Bifrost, and the Bifrost only answers in Midgard (the Overworld): craft a Bifrost Keystone,
// stand under open sky, use it - the rainbow slams down, pulls you up, and burns its rune ring into the ground.
// The realm builds itself around the first visitors, piece by piece as the land loads; nothing counts as built until
// every block of it is really there. /hero asgard rebuild (operators) starts it over.
import { world, system, BlockVolume, BlockPermutation, MolangVariableMap, ItemStack } from "@minecraft/server";
import { hero, RT, saveNow } from "./data.js";
import { V, at, valid, fx, sound, now } from "./util.js";
import { hudMsg } from "./voice.js";
import { runCine, EASE } from "./cine.js";
import { drawBeam, STYLES } from "./beams.js";

export const ASGARD = "origin:asgard";
system.beforeEvents.startup.subscribe((ev) => { try { ev.dimensionRegistry.registerCustomDimension(ASGARD); } catch (e) { console.warn("[ORIGIN] asgard: " + e); } });
const KEY = "origin:asgard_v2";
const RGB = [[1, 0.25, 0.25], [1, 0.6, 0.15], [1, 0.9, 0.2], [0.4, 0.9, 0.35], [0.35, 0.7, 1], [0.35, 0.4, 0.95], [0.7, 0.35, 1]].map(([r, g, b]) => ({ red: r, green: g, blue: b }));
const WHITE = { red: 1, green: 1, blue: 1 };
const ARRIVE = { x: 0.5, y: 101, z: -63.5 };
const G = "minecraft:gold_block", Q = "minecraft:quartz_block", SL = "minecraft:sea_lantern", YG = "minecraft:yellow_stained_glass", LOG = "minecraft:birch_log", HC = "minecraft:honeycomb_block", AZ = "minecraft:azalea_leaves_flowered";
const RAIN = ["red", "orange", "yellow", "lime", "light_blue", "blue", "purple"].map((c) => `minecraft:${c}_stained_glass`);
const FALLBACK = { "minecraft:azalea_leaves_flowered": ["minecraft:flowering_azalea_leaves", "minecraft:birch_leaves", "minecraft:oak_leaves"], "minecraft:grass_block": ["minecraft:grass"], "minecraft:birch_log": ["minecraft:log", "minecraft:oak_log"],
  "minecraft:quartz_block": ["minecraft:smooth_quartz", "minecraft:white_concrete"], "minecraft:sea_lantern": ["minecraft:glowstone"], "minecraft:amethyst_block": ["minecraft:purpur_block"], "minecraft:diamond_block": [G],
  "minecraft:honeycomb_block": ["minecraft:yellow_wool", "minecraft:hay_block", G], "minecraft:cherry_leaves": ["minecraft:azalea_leaves_flowered", "minecraft:flowering_azalea_leaves", "minecraft:oak_leaves"],
  "minecraft:shroomlight": ["minecraft:glowstone"], "minecraft:end_rod": ["minecraft:glowstone"], "minecraft:lantern": ["minecraft:glowstone"], "minecraft:campfire": ["minecraft:glowstone"],
  "minecraft:dandelion": ["minecraft:yellow_flower"], "minecraft:poppy": ["minecraft:red_flower"], "minecraft:cornflower": ["minecraft:red_flower"], "minecraft:azure_bluet": ["minecraft:red_flower"], "minecraft:oxeye_daisy": ["minecraft:red_flower"],
  "minecraft:lily_of_the_valley": ["minecraft:red_flower"], "minecraft:allium": ["minecraft:red_flower"] };
const PERM = new Map();
let lastErr = "";
function perm(id) {
  if (PERM.has(id)) return PERM.get(id);
  let pm = null;
  for (const cand of [id, ...(FALLBACK[id] ?? []), ...(/stained_glass/.test(id) ? ["minecraft:glass"] : [])]) { try { pm = BlockPermutation.resolve(cand); if (pm) break; } catch { } }
  PERM.set(id, pm);
  return pm;
}
function fill(d, a, b, id) {
  const pm = perm(id);
  if (!pm) return true;
  const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) }, hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
  try { for (const c of [lo, hi, { x: lo.x, y: lo.y, z: hi.z }, { x: hi.x, y: lo.y, z: lo.z }]) if (!d.getBlock(c)) return false; } catch { return false; }
  try { d.fillBlocks(new BlockVolume(lo, hi), pm); return true; }
  catch (e) {
    lastErr = String(e);
    if ((hi.x - lo.x + 1) * (hi.y - lo.y + 1) * (hi.z - lo.z + 1) > 6000) return false;
    try { for (let x = lo.x; x <= hi.x; x++) for (let y = lo.y; y <= hi.y; y++) for (let z = lo.z; z <= hi.z; z++) d.getBlock({ x, y, z })?.setPermutation(pm); return true; } catch (e2) { lastErr = String(e2); return false; }
  }
}
// a single block that only goes down on open grass (flowers): false = that chunk isn't loaded yet
function onGrass(d, a, id) {
  try {
    const blk = d.getBlock(a), below = d.getBlock({ x: a.x, y: a.y - 1, z: a.z });
    if (!blk || !below) return false;
    if (blk.isAir && /grass_block|:grass$/.test(below.typeId)) { const pm = perm(id); if (pm) blk.setPermutation(pm); }
    return true;
  } catch { return false; }
}
const box = (x1, y1, z1, x2, y2, z2, id) => [{ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }, id];
function disc(cx, y, cz, r, id) { const out = []; for (let dz = -r; dz <= r; dz++) { const w = Math.floor(Math.sqrt(r * r - dz * dz)); out.push(box(cx - w, y, cz + dz, cx + w, y, cz + dz, id)); } return out; }
function statue(x, z) { return [box(x - 1, 101, z, x - 1, 106, z, G), box(x + 1, 101, z, x + 1, 106, z, G), box(x - 2, 107, z - 1, x + 2, 111, z + 1, G), box(x - 1, 112, z - 1, x + 1, 114, z + 1, G), box(x - 1, 115, z, x + 1, 115, z, "minecraft:diamond_block"),
  box(x - 3, 107, z, x - 3, 110, z, G), box(x + 3, 105, z - 1, x + 3, 118, z - 1, G), box(x + 3, 119, z - 1, x + 3, 120, z - 1, "minecraft:diamond_block")]; }
function tower(x, z) { return [box(x - 1, 101, z - 1, x + 1, 118, z + 1, Q), box(x - 1, 112, z - 1, x + 1, 112, z + 1, G), box(x - 1, 118, z - 1, x + 1, 119, z + 1, G), box(x, 120, z, x, 123, z, G), box(x, 124, z, x, 124, z, "minecraft:end_rod")]; }
function goldenTree(x, y, z, h = 5, r = 2, leaf = HC) {
  return [box(x, y, z, x, y + h, z, LOG), ...disc(x, y + h - 1, z, r, AZ), ...disc(x, y + h, z, r + 1, leaf), ...disc(x, y + h + 1, z, r, leaf), ...disc(x, y + h + 2, z, Math.max(1, r - 1), leaf), box(x, y + h, z, x, y + h, z, "minecraft:shroomlight")];
}
// a floating islet: grass on top, a cone of earth and stone hanging below, a golden tree
function islet(cx, top, cz, r, leaf = HC, fall = false) {
  const ops = [...disc(cx, top, cz, r, "minecraft:grass_block")];
  let rr = r - 1, y = top - 1;
  while (rr >= 1) { ops.push(...disc(cx, y, cz, Math.round(rr), y > top - 3 ? "minecraft:dirt" : "minecraft:stone")); rr -= 1.25; y--; }
  ops.push(...goldenTree(cx, top + 1, cz, 5, 2, leaf));
  if (fall) ops.push(box(cx + r - 1, top, cz, cx + r - 1, top, cz, "minecraft:water"));
  return ops;
}
const ISLETS = [[-48, 96, 8, 6, HC, true], [46, 92, -10, 5, "minecraft:cherry_leaves", false], [2, 104, 54, 7, HC, true], [-36, 110, -44, 5, "minecraft:cherry_leaves", false], [40, 98, 36, 6, HC, false]];
const FLOWERS = ["minecraft:cornflower", "minecraft:lily_of_the_valley", "minecraft:azure_bluet", "minecraft:oxeye_daisy", "minecraft:allium", "minecraft:dandelion", "minecraft:poppy"];
function meadow() {
  let s = 1337; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (let i = 0; i < 110; i++) {
    const a = rnd() * Math.PI * 2, d = 5 + rnd() * 26, x = Math.round(Math.cos(a) * d), z = Math.round(Math.sin(a) * d);
    if ((Math.abs(x) <= 13 && z >= -5 && z <= 31) || (Math.abs(x) <= 3 && z <= -2)) continue;   // palace and path stay clear
    out.push([{ x, y: 101, z }, { x, y: 101, z }, FLOWERS[Math.floor(rnd() * FLOWERS.length)], "onGrass"]);
  }
  return out;
}
// ================================================================== v0.24: THE REALM ETERNAL
// Three new floating lands, each its own world-sized piece of Asgard, built tile by tile as the land loads:
//   NORTH - the CITY: a golden plaza with Odin's statue in a fountain, avenues, twenty houses with stepped gold roofs,
//           and the THRONE HALL - Odin's empty throne, braziers, and a stair down into the VAULT (three chests).
//   WEST  - the TRAINING GROUNDS: an arena ring of quartz and gold, and IDUNN'S ORCHARD of golden trees.
//   EAST  - the HALL OF HEROES under a golden dome (statues round an eternal flame) and the SKYSHIP DOCK on the edge.
// Bridges of gold with quartz rails and lanterns run out to each of them; waterfalls pour off their edges.
// Pieces that sit on a land wait until all of that land's ground is down (deps), so nothing gets buried.
export const LANDS = [
  { key: "city", cx: -14, cz: 115, r: 52, depth: 18, seed: 3 },
  { key: "west", cx: -112, cz: 4, r: 38, depth: 14, seed: 7 },
  { key: "east", cx: 112, cz: 4, r: 38, depth: 14, seed: 11 },
];
const AIR = "minecraft:air", SQ = "minecraft:smooth_quartz", LANT = "minecraft:lantern";
function landRadius(L, x, z, k) {
  const a = Math.atan2(z - L.cz, x - L.cx);
  const wob = 1 + 0.06 * Math.sin(3 * a + L.seed) + 0.04 * Math.cos(7 * a + L.seed * 2);
  return L.r * wob * Math.pow(Math.max(0, 1 - Math.pow(k / L.depth, 1.7)), 0.5);
}
function landTile(L, x0, z0, x1, z1) {
  const ops = [];
  for (let k = 0; k < L.depth; k++) {
    const id = k === 0 ? "minecraft:grass_block" : k < 3 ? "minecraft:dirt" : k > L.depth - 4 && (x0 + z0 + k) % 5 === 0 ? "minecraft:gold_ore" : "minecraft:stone";
    for (let z = z0; z <= z1; z++) {
      let run = null;
      for (let x = x0; x <= x1 + 1; x++) {
        const inside = x <= x1 && Math.hypot(x - L.cx, z - L.cz) <= landRadius(L, x, z, k);
        if (inside && run === null) run = x;
        if (!inside && run !== null) { ops.push(box(run, 100 - k, z, x - 1, 100 - k, z, id)); run = null; }
      }
    }
  }
  return ops;
}
function tilesOf(L) {
  const out = [], T = 16;
  for (let x0 = Math.floor((L.cx - L.r - 4) / T) * T; x0 <= L.cx + L.r + 4; x0 += T)
    for (let z0 = Math.floor((L.cz - L.r - 4) / T) * T; z0 <= L.cz + L.r + 4; z0 += T) {
      const nx = Math.max(x0, Math.min(L.cx, x0 + T - 1)), nz = Math.max(z0, Math.min(L.cz, z0 + T - 1));
      if (Math.hypot(nx - L.cx, nz - L.cz) > L.r * 1.12) continue;
      out.push([`${L.key}_t${x0}_${z0}`, { x: x0 + 8, y: 100, z: z0 + 8 }, () => landTile(L, x0, z0, x0 + T - 1, z0 + T - 1)]);
    }
  return out;
}
// a golden bridge: gold walkway, quartz edges, rails and lanterns, and arches hanging under it
function bridge(x0, z0, x1, z1) {
  const ops = [], alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const [a0, a1] = alongX ? [Math.min(x0, x1), Math.max(x0, x1)] : [Math.min(z0, z1), Math.max(z0, z1)];
  const c = alongX ? z0 : x0;
  const B = (a, w, y, id) => alongX ? box(a, y, c + w, a, y, c + w, id) : box(c + w, y, a, c + w, y, a, id);
  ops.push(alongX ? box(a0, 100, c - 2, a1, 100, c + 2, SQ) : box(c - 2, 100, a0, c + 2, 100, a1, SQ));
  ops.push(alongX ? box(a0, 100, c, a1, 100, c, G) : box(c, 100, a0, c, 100, a1, G));
  ops.push(alongX ? box(a0, 101, c - 3, a1, 101, c - 3, Q) : box(c - 3, 101, a0, c - 3, 101, a1, Q));
  ops.push(alongX ? box(a0, 101, c + 3, a1, 101, c + 3, Q) : box(c + 3, 101, a0, c + 3, 101, a1, Q));
  for (let a = a0 + 3; a <= a1 - 2; a += 7) {
    for (const w of [-3, 3]) { ops.push(B(a, w, 102, G), B(a, w, 103, LANT)); }
    ops.push(B(a, 0, 99, G), B(a, -1, 98, G), B(a, 1, 98, G), B(a, 0, 97, "minecraft:shroomlight"));
  }
  return ops;
}
function house(cx, cz, tx, tz) {   // (tx,tz): toward the plaza
  const fx = Math.abs(tx) >= Math.abs(tz) ? Math.sign(tx) : 0, fz = fx ? 0 : Math.sign(tz);
  const ops = [box(cx - 3, 100, cz - 3, cx + 3, 100, cz + 3, SQ), box(cx - 3, 101, cz - 3, cx + 3, 104, cz + 3, Q), box(cx - 2, 101, cz - 2, cx + 2, 104, cz + 2, AIR)];
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) ops.push(box(cx + dx, 101, cz + dz, cx + dx, 104, cz + dz, G));
  for (let k = 0; k <= 3; k++) ops.push(box(cx - 4 + k, 105 + k, cz - 4 + k, cx + 4 - k, 105 + k, cz + 4 - k, k === 3 ? "minecraft:shroomlight" : G));
  // windows on the two sides, a door facing the plaza, a light inside
  if (fx) ops.push(box(cx - 1, 102, cz - 3, cx + 1, 103, cz - 3, YG), box(cx - 1, 102, cz + 3, cx + 1, 103, cz + 3, YG), box(cx + 3 * fx, 101, cz, cx + 3 * fx, 102, cz, AIR));
  else ops.push(box(cx - 3, 102, cz - 1, cx - 3, 103, cz + 1, YG), box(cx + 3, 102, cz - 1, cx + 3, 103, cz + 1, YG), box(cx, 101, cz + 3 * fz, cx, 102, cz + 3 * fz, AIR));
  ops.push(box(cx, 104, cz, cx, 104, cz, "minecraft:glowstone"), box(cx + 4 * (fx || 0) + (fx ? 0 : 1), 101, cz + 4 * (fz || 0) + (fz ? 0 : 1), cx + 4 * (fx || 0) + (fx ? 0 : 1), 101, cz + 4 * (fz || 0) + (fz ? 0 : 1), LANT));
  return ops;
}
const CITY = LANDS[0], WEST = LANDS[1], EAST = LANDS[2];
export const PLAZA = { x: CITY.cx, y: 101, z: CITY.cz };
export const THRONE = { x: CITY.cx, y: 101, z: CITY.cz + 34 };
export const ARENA = { x: WEST.cx - 4, y: 101, z: 0 };
export const HEROES = { x: EAST.cx + 6, y: 101, z: 0 };
const HOUSES = (() => {
  const out = [];
  for (const [r, n, off] of [[26, 8, 22.5], [40, 12, 15]]) for (let i = 0; i < n; i++) {
    const deg = off + (i * 360) / n, a = (deg * Math.PI) / 180;
    const x = Math.round(CITY.cx + Math.cos(a) * r), z = Math.round(CITY.cz + Math.sin(a) * r);
    if (Math.abs(x - CITY.cx) < 6 || Math.abs(z - CITY.cz) < 6) continue;                 // keep the avenues clear
    if (z > THRONE.z - 16 && Math.abs(x - THRONE.x) < 22) continue;                         // and the throne hall's square
    out.push([x, z]);
  }
  return out;
})();
function throneHall() {
  const { x, z } = THRONE, x0 = x - 12, x1 = x + 12, z0 = z - 12, z1 = z + 14;
  const ops = [box(x0, 100, z0, x1, 100, z1, SQ), box(x0, 101, z0, x1, 112, z1, Q), box(x0 + 1, 101, z0 + 1, x1 - 1, 111, z1 - 1, AIR), box(x - 2, 101, z0, x + 2, 106, z0, AIR)];
  for (let zz = z0; zz <= z1; zz += 4) ops.push(box(x0, 101, zz, x0, 113, zz, G), box(x1, 101, zz, x1, 113, zz, G), box(x0, 105, zz + 1, x0, 108, zz + 2, YG), box(x1, 105, zz + 1, x1, 108, zz + 2, YG));
  for (let k = 0; k <= 5; k++) ops.push(box(x0 + k * 2, 112 + k, z0, x1 - k * 2, 112 + k, z1, k === 5 ? "minecraft:shroomlight" : G));
  ops.push(box(x - 1, 100, z0 + 1, x + 1, 100, z1 - 4, "minecraft:yellow_wool"));                                  // the aisle
  ops.push(box(x - 4, 101, z1 - 4, x + 4, 101, z1 - 1, G), box(x - 2, 102, z1 - 3, x + 2, 102, z1 - 1, G));          // the dais
  ops.push(box(x - 1, 103, z1 - 2, x + 1, 103, z1 - 2, G), box(x - 1, 104, z1 - 1, x + 1, 107, z1 - 1, G), box(x, 108, z1 - 1, x, 108, z1 - 1, "minecraft:diamond_block"),
    box(x - 1, 103, z1 - 1, x - 1, 104, z1 - 2, G), box(x + 1, 103, z1 - 1, x + 1, 104, z1 - 2, G));             // Odin's empty throne
  for (const zz of [z0 + 4, z0 + 12, z0 + 20]) for (const xx of [x - 6, x + 6]) ops.push(box(xx, 101, zz, xx, 101, zz, G), box(xx, 102, zz, xx, 102, zz, "minecraft:campfire"));
  return ops;
}
function vault() {   // under the hall's west end: a stair of scaffolding down to three chests
  const { x, z } = THRONE, vx = x - 8, vz = z + 4;
  return [box(vx - 3, 93, vz - 3, vx + 3, 98, vz + 3, Q), box(vx - 2, 94, vz - 2, vx + 2, 97, vz + 2, AIR), box(vx - 2, 93, vz - 2, vx + 2, 93, vz + 2, G),
    box(vx, 94, vz - 3, vx, 100, vz - 3, "minecraft:scaffolding"), box(vx - 2, 97, vz - 2, vx - 2, 97, vz - 2, "minecraft:glowstone"), box(vx + 2, 97, vz + 2, vx + 2, 97, vz + 2, "minecraft:glowstone")];
}
export const VAULT_CHESTS = [[THRONE.x - 10, 94, THRONE.z + 6], [THRONE.x - 8, 94, THRONE.z + 6], [THRONE.x - 6, 94, THRONE.z + 6]];
function plaza() {
  const { x, z } = PLAZA, ops = [];
  ops.push(...disc(x, 100, z, 12, G), ...disc(x, 100, z, 11, SQ), ...disc(x, 101, z, 6, Q), ...disc(x, 101, z, 5, "minecraft:water"));
  ops.push(...statue(x, z));                                                                    // the All-Father, in the fountain
  for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, lx = Math.round(x + Math.cos(a) * 10), lz = Math.round(z + Math.sin(a) * 10); ops.push(box(lx, 101, lz, lx, 102, lz, G), box(lx, 103, lz, lx, 103, lz, LANT)); }
  // avenues: north to the throne hall, south to the bridge, east and west to the edge
  ops.push(box(x - 1, 100, z + 12, x + 1, 100, THRONE.z - 13, SQ), box(x, 100, z + 12, x, 100, THRONE.z - 13, G));
  ops.push(box(x - 1, 100, CITY.cz - CITY.r + 2, x + 1, 100, z - 12, SQ), box(x, 100, CITY.cz - CITY.r + 2, x, 100, z - 12, G));
  ops.push(box(x - 44, 100, z - 1, x - 12, 100, z + 1, SQ), box(x + 12, 100, z - 1, x + 44, 100, z + 1, SQ), box(x - 44, 100, z, x - 12, 100, z, G), box(x + 12, 100, z, x + 44, 100, z, G));
  return ops;
}
function arena() {
  const { x, z } = ARENA, ops = [...disc(x, 100, z, 13, "minecraft:sand"), ...disc(x, 99, z, 13, "minecraft:sandstone")];
  for (let dz = -15; dz <= 15; dz++) for (let dx = -15; dx <= 15; dx++) {
    const r = Math.hypot(dx, dz);
    if (r < 13.4 || r > 15) continue;
    if (Math.abs(dx) <= 1 || Math.abs(dz) <= 1) continue;                                     // four gates
    ops.push(box(x + dx, 101, z + dz, x + dx, 103, z + dz, Q), box(x + dx, 104, z + dz, x + dx, 104, z + dz, G));
  }
  for (const [dx, dz] of [[10, 10], [-10, 10], [10, -10], [-10, -10]]) ops.push(box(x + dx, 101, z + dz, x + dx, 101, z + dz, G), box(x + dx, 102, z + dz, x + dx, 102, z + dz, "minecraft:campfire"));
  ops.push(box(x + 15, 100, z - 1, WEST.cx + WEST.r - 1, 100, z + 1, SQ), box(x + 15, 100, z, WEST.cx + WEST.r - 1, 100, z, G));
  return ops;
}
function orchard() {
  const ops = [];
  for (const [dx, dz] of [[-12, 20], [0, 22], [12, 20], [-18, 30], [-6, 32], [6, 32], [18, 28]]) ops.push(...goldenTree(WEST.cx + dx, 101, WEST.cz + dz, 5, 2, dx % 2 ? "minecraft:cherry_leaves" : HC));
  // Idunn's tree: the big one
  const x = WEST.cx + 2, z = WEST.cz - 24;
  ops.push(box(x - 1, 101, z - 1, x + 1, 113, z + 1, LOG));
  ops.push(...disc(x, 111, z, 6, AZ), ...disc(x, 112, z, 7, HC), ...disc(x, 113, z, 7, HC), ...disc(x, 114, z, 5, HC), ...disc(x, 115, z, 3, HC));
  for (const [dx, dz] of [[3, 2], [-3, 3], [-4, -2], [2, -4], [0, 0]]) ops.push(box(x + dx, 113, z + dz, x + dx, 113, z + dz, "minecraft:shroomlight"));
  return ops;
}
function heroes() {
  const { x, z } = HEROES, ops = [...disc(x, 100, z, 11, SQ)];
  for (let dy = 0; dy <= 6; dy++) for (let dz = -11; dz <= 11; dz++) for (let dx = -11; dx <= 11; dx++) {
    const r = Math.hypot(dx, dz);
    if (r < 10 || r > 11) continue;
    if (dx < -8 && Math.abs(dz) <= 1 && dy <= 3) continue;                                       // the door, facing the bridge
    ops.push(box(x + dx, 101 + dy, z + dz, x + dx, 101 + dy, z + dz, dy === 3 && Math.abs(dz) % 3 === 0 ? YG : Q));
  }
  for (let dy = 1; dy <= 10; dy++) { const rr = Math.sqrt(Math.max(0, 121 - dy * dy)); for (let dz = -11; dz <= 11; dz++) for (let dx = -11; dx <= 11; dx++) { const r = Math.hypot(dx, dz); if (r <= rr && r > rr - 1.2) ops.push(box(x + dx, 107 + dy, z + dz, x + dx, 107 + dy, z + dz, dy === 10 ? "minecraft:shroomlight" : G)); } }
  for (let k = 0; k < 6; k++) {                                                                  // six heroes round an eternal flame
    const a = (k * Math.PI) / 3, sx = Math.round(x + Math.cos(a) * 7), sz = Math.round(z + Math.sin(a) * 7);
    ops.push(box(sx, 101, sz, sx, 101, sz, Q), box(sx, 102, sz, sx, 104, sz, G), box(sx, 105, sz, sx, 105, sz, "minecraft:gold_block"), box(sx, 106, sz, sx, 106, sz, "minecraft:end_rod"));
  }
  ops.push(box(x, 101, z, x, 101, z, G), box(x, 102, z, x, 102, z, "minecraft:soul_campfire"));
  ops.push(box(EAST.cx - EAST.r + 1, 100, z - 1, x - 11, 100, z + 1, SQ), box(EAST.cx - EAST.r + 1, 100, z, x - 11, 100, z, G));
  return ops;
}
function dock() {   // a pier off the east edge with a little skyship tied to it
  const x0 = EAST.cx + 30, z = EAST.cz - 16, P = "minecraft:spruce_planks", O = "minecraft:oak_planks", W = "minecraft:white_wool";
  const ops = [box(x0, 100, z - 1, x0 + 16, 100, z + 1, P), box(x0 + 4, 99, z - 1, x0 + 4, 99, z + 1, "minecraft:spruce_log"), box(x0 + 12, 99, z - 1, x0 + 12, 99, z + 1, "minecraft:spruce_log")];
  const sx = x0 + 6, sz = z + 4;
  ops.push(box(sx, 99, sz, sx + 10, 99, sz + 4, O), box(sx, 100, sz, sx + 10, 100, sz, O), box(sx, 100, sz + 4, sx + 10, 100, sz + 4, O), box(sx, 100, sz, sx, 100, sz + 4, O), box(sx + 10, 100, sz + 1, sx + 10, 100, sz + 3, O),
    box(sx + 1, 98, sz + 1, sx + 9, 98, sz + 3, O), box(sx + 11, 99, sz + 2, sx + 12, 99, sz + 2, G));
  ops.push(box(sx + 5, 100, sz + 2, sx + 5, 108, sz + 2, "minecraft:spruce_log"), box(sx + 5, 103, sz, sx + 5, 107, sz + 4, W), box(sx + 5, 109, sz + 2, sx + 5, 109, sz + 2, "minecraft:lantern"));
  return ops;
}
function LAND_PIECES() {
  const out = [];
  const deps = {};
  for (const L of LANDS) { const t = tilesOf(L); deps[L.key] = t.map((p) => p[0]); out.push(...t); }
  const on = (land, name, c, fn) => out.push([name, c, fn, deps[land]]);
  out.push(["bridge_north", { x: -14, y: 100, z: 48 }, () => [...bridge(-14, 30, -14, CITY.cz - CITY.r + 3)]]);
  out.push(["bridge_west", { x: -54, y: 100, z: 0 }, () => [box(-33, 100, 0, -33, 100, 0, "minecraft:grass_block"), ...bridge(-35, 0, WEST.cx + WEST.r - 2, 0)]]);
  out.push(["bridge_east", { x: 54, y: 100, z: 0 }, () => [box(33, 100, 0, 33, 100, 0, "minecraft:grass_block"), ...bridge(35, 0, EAST.cx - EAST.r + 2, 0)]]);
  on("city", "city_plaza", PLAZA, plaza);
  HOUSES.forEach(([x, z], i) => on("city", `city_house${i}`, { x, y: 101, z }, () => house(x, z, PLAZA.x - x, PLAZA.z - z)));
  on("city", "throne_hall", THRONE, throneHall);
  on("city", "throne_vault", { x: THRONE.x - 8, y: 95, z: THRONE.z + 4 }, vault);
  on("city", "city_falls", { x: CITY.cx + CITY.r - 2, y: 100, z: CITY.cz }, () => [box(CITY.cx + Math.round(CITY.r * 0.94) - 1, 100, CITY.cz + 8, CITY.cx + Math.round(CITY.r * 0.94) - 1, 100, CITY.cz + 8, "minecraft:water")]);
  on("west", "west_arena", ARENA, arena);
  on("west", "west_orchard", { x: WEST.cx, y: 101, z: WEST.cz + 24 }, orchard);
  on("east", "east_heroes", HEROES, heroes);
  on("east", "east_dock", { x: EAST.cx + 36, y: 100, z: EAST.cz - 16 }, dock);
  return out;
}

const PIECES = [
  ["observatory", { x: 0, y: 100, z: -64 }, () => [...disc(0, 99, -64, 5, Q), ...disc(0, 100, -64, 6, G), ...Array.from({ length: 8 }, (_, k) => { const a = (k * Math.PI) / 4, x = Math.round(Math.cos(a) * 5), z = -64 + Math.round(Math.sin(a) * 5); return box(x, 101, z, x, 105, z, G); }),
    ...disc(0, 106, -64, 5, G), ...disc(0, 107, -64, 3, YG), box(0, 100, -64, 0, 100, -64, SL)]],
  ["bridge", { x: 0, y: 100, z: -46 }, () => [...RAIN.map((id, i) => box(i - 3, 100, -58, i - 3, 100, -33, id)), ...Array.from({ length: 5 }, (_, k) => [box(-4, 100, -56 + k * 6, -4, 101, -56 + k * 6, SL), box(4, 100, -56 + k * 6, 4, 101, -56 + k * 6, SL)]).flat()]],
  ...Array.from({ length: 12 }, (_, k) => [`isle${k}`, { x: 0, y: 100, z: 0 }, () => disc(0, 100 - k, 0, Math.max(3, Math.round(34 - k * 2.7)), k === 0 ? "minecraft:grass_block" : k < 3 ? "minecraft:dirt" : "minecraft:stone")]),
  ["path", { x: 0, y: 100, z: -18 }, () => [box(-1, 100, -33, 1, 100, -3, G)]],
  ["guardians", { x: 0, y: 101, z: -30 }, () => [...statue(-7, -30), ...statue(7, -30)]],
  ["palace", { x: 0, y: 101, z: 12 }, () => [box(-10, 101, -2, 10, 112, 28, Q), box(-9, 102, -1, 9, 111, 27, "minecraft:air"), box(-2, 102, -2, 2, 107, -2, "minecraft:air"),
    ...[-2, 3, 8, 13, 18, 23, 28].flatMap((z) => [box(-10, 101, z, -10, 113, z, G), box(10, 101, z, 10, 113, z, G)]), ...[1, 5, 9, 13, 17, 21, 25].flatMap((z) => [box(-10, 105, z, -10, 108, z + 1, YG), box(10, 105, z, 10, 108, z + 1, YG)]),
    box(-10, 112, -2, 10, 112, 28, G), box(-8, 113, 0, 8, 113, 26, G), box(-5, 114, 3, 5, 114, 23, G), box(-2, 115, 6, 2, 115, 20, G), ...[2, 8, 14, 20].map((z) => box(0, 101, z, 0, 101, z, SL)),
    box(-1, 102, 25, 1, 102, 26, G), box(-1, 103, 26, 1, 105, 26, G), box(0, 106, 26, 0, 106, 26, "minecraft:amethyst_block")]],
  ["trees", { x: 0, y: 101, z: 0 }, () => [[-20, -10], [20, -12], [-24, 14], [24, 16], [-14, -24], [16, -22]].flatMap(([x, z]) => [box(x - 2, 105, z - 2, x + 2, 107, z + 2, AZ), box(x - 1, 108, z - 1, x + 1, 108, z + 1, AZ), box(x, 101, z, x, 106, z, LOG)])],
  ["falls", { x: 0, y: 100, z: 0 }, () => [[33, 0], [-33, 0], [0, 33], [23, 23], [-23, 23]].map(([x, z]) => box(x, 100, z, x, 100, z, "minecraft:water"))],
  // v0.21 additions (new pieces: worlds that already built Asgard simply gain these)
  ["spires", { x: 0, y: 112, z: 13 }, () => [...tower(-11, -3), ...tower(11, -3), ...tower(-11, 29), ...tower(11, 29),
    ...disc(0, 116, 13, 4, G), ...disc(0, 117, 13, 3, G), ...disc(0, 118, 13, 2, G), ...disc(0, 119, 13, 1, G), box(0, 120, 13, 0, 122, 13, G), box(0, 123, 13, 0, 123, 13, "minecraft:end_rod"),
    box(-3, 101, -3, -3, 110, -3, G), box(3, 101, -3, 3, 110, -3, G), box(-3, 110, -3, 3, 111, -3, G), box(-3, 112, -3, -3, 112, -3, SL), box(3, 112, -3, 3, 112, -3, SL)]],
  ["lamps", { x: 0, y: 101, z: -18 }, () => [...[-30, -24, -18, -12, -6].flatMap((z) => [box(-3, 101, z, -3, 102, z, G), box(-3, 103, z, -3, 103, z, "minecraft:lantern"), box(3, 101, z, 3, 102, z, G), box(3, 103, z, 3, 103, z, "minecraft:lantern")]),
    box(-5, 101, -4, -5, 101, -4, G), box(-5, 102, -4, -5, 102, -4, "minecraft:campfire"), box(5, 101, -4, 5, 101, -4, G), box(5, 102, -4, 5, 102, -4, "minecraft:campfire")]],
  ["great_tree", { x: 26, y: 101, z: -2 }, () => {
    const x = 26, z = -2, ops = [box(x - 1, 101, z - 1, x + 1, 115, z + 1, LOG)];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ops.push(box(x + dx * 2, 101, z + dz * 2, x + dx * 3, 101, z + dz * 3, LOG), box(x + dx * 2, 111, z + dz * 2, x + dx * 5, 112, z + dz * 5, LOG));
    ops.push(...disc(x, 113, z, 6, AZ), ...disc(x, 114, z, 8, HC), ...disc(x, 115, z, 8, HC), ...disc(x, 116, z, 7, HC), ...disc(x, 117, z, 5, HC), ...disc(x, 118, z, 3, HC));
    for (const [dx, dz] of [[4, 2], [-3, 4], [-5, -2], [2, -5], [0, 0]]) ops.push(box(x + dx, 115, z + dz, x + dx, 115, z + dz, "minecraft:shroomlight"));
    return ops;
  }],
  ...ISLETS.map(([cx, top, cz, r, leaf, fall], i) => [`islet${i}`, { x: cx, y: top, z: cz }, () => islet(cx, top, cz, r, leaf, fall)]),
  ["meadow", { x: 0, y: 101, z: 0 }, meadow],
  // ---------------- v0.24: Asgard grows - three new lands, joined to the old island by golden bridges
  ...LAND_PIECES(),
];

export const PIECE_NAMES = PIECES.map((p) => p[0]);
const builtSet = () => new Set(String(world.getDynamicProperty(KEY) ?? "").split(",").filter(Boolean));
export function resetAsgard() { world.setDynamicProperty(KEY, ""); }
export const asgardBuilt = (name) => builtSet().has(name);
function tryBuild(dim) {
  const done = builtSet();
  let n = 0, changed = false;
  for (const [name, c, ops, deps] of PIECES) {
    if (done.has(name) || n >= 4) continue;
    if (deps && !deps.every((d) => done.has(d))) continue;
    let loaded = false; try { loaded = !!dim.getBlock(c); } catch { }
    if (!loaded) continue;
    n++;
    let ok = true;
    for (const [a, b, id, cond] of ops()) ok = (cond === "onGrass" ? onGrass(dim, a, id) : fill(dim, a, b, id)) && ok;
    if (ok) { done.add(name); changed = true; }
  }
  if (changed) world.setDynamicProperty(KEY, [...done].join(","));
  if (done.has("throne_vault") && !world.getDynamicProperty("origin:asgard_vault")) fillVault(dim);
  return done.has("observatory");
}
// Odin's vault: three chests, filled once per world
function fillVault(dim) {
  const LOOT = [
    [["minecraft:gold_ingot", 16], ["minecraft:diamond", 4], ["origin:bifrost_key", 1], ["minecraft:golden_apple", 3], ["minecraft:experience_bottle", 16]],
    [["minecraft:enchanted_golden_apple", 1], ["origin:aetherium_ingot", 4], ["origin:starmetal_plate", 2], ["minecraft:netherite_scrap", 2], ["minecraft:gold_block", 4]],
    [["origin:null_crystal", 2], ["minecraft:totem_of_undying", 1], ["minecraft:diamond", 6], ["origin:blueprint_data", 4], ["minecraft:emerald", 12]],
  ];
  let ok = 0;
  VAULT_CHESTS.forEach(([x, y, z], i) => {
    try {
      const b = dim.getBlock({ x, y, z });
      if (!b) return;
      if (b.typeId !== "minecraft:chest") b.setType("minecraft:chest");
      const c = b.getComponent("minecraft:inventory")?.container;
      if (!c) return;
      LOOT[i].forEach(([id, n], k) => { try { c.setItem(k * 2, new ItemStack(id, n)); } catch { } });
      ok++;
    } catch { }
  });
  if (ok === VAULT_CHESTS.length) world.setDynamicProperty("origin:asgard_vault", true);
}

// ------------------------------------------------------------------ the Bifrost
function bifrostBeam(dim, L, ticks = 40) {
  const top = at(L, 0, 70, 0), g = at(L, 0, 0.05, 0), style = { ...STYLES.rainbow, width: 1.35, coreW: 0.42, flare: 2.2, impact: 3, sheath: WHITE };
  for (let k = 0; k < ticks; k += 2) system.runTimeout(() => {
    drawBeam(dim, top, g, style, now(), { cols: RGB, life: 0.16, seg: 10 });
    fx(dim, "origin:beam_flare", at(L, 0, 0.5, 0), WHITE, 0.9, { size: 2.4 });
    if (k % 6 === 0) fx(dim, "origin:asg_sparkle", at(L, 0, 1, 0), RGB[(k / 2) % 7], 1, { n: 5, r: 1.6 });
  }, k);
  fx(dim, "origin:bifrost_mark", { x: L.x, y: L.y + 0.03, z: L.z }, WHITE, 1, { size: 3.6, life: 60 });
  fx(dim, "origin:shockwave", at(L, 0, 0.1, 0), WHITE, 1, { radius: 5 });
  sound(dim, "origin.sfx.thunder", L, 0.8, 1);
}
export async function useBifrost(p) {
  const r = RT(p), h = hero(p), id = p.dimension.id, toAsgard = id !== ASGARD;
  if (r.cine) return;
  if (toAsgard && id !== "minecraft:overworld") { hudMsg(p, "§6The Bifrost only answers in Midgard §7(the Overworld).", 50); return; }
  if (toAsgard) { try { const top = p.dimension.getTopmostBlock({ x: p.location.x, z: p.location.z }); if (top && top.location.y > p.location.y + 1.5) { hudMsg(p, "§7The Bifrost needs open sky above you.", 50); return; } } catch { } h.midgard = { x: p.location.x, y: p.location.y, z: p.location.z }; saveNow(p); }
  const dim = p.dimension, L = { ...p.location };
  bifrostBeam(dim, L, 60);
  sound(dim, "origin.sfx.charge", L, 0.9, 1);
  await runCine(p, async (c) => {
    c.cam(at(L, 4, 0.5, 4), at(L, 0, 7, 0));
    c.say(toAsgard ? "§6the Bifrost opens..." : "§6home, to Midgard...", 30);
    c.shake(0.5, 0.6);
    await c.wait(16);
    for (let k = 0; k < 26; k++) {   // pulled up into the light
      const y = L.y + k * k * 0.035;
      try { p.teleport({ x: L.x, y, z: L.z }); } catch { }
      c.cam(at(L, 3.4 - k * 0.04, y - L.y + 0.4 + k * 0.05, 3.4 - k * 0.04), at(L, 0, y - L.y + 1.2, 0), 0.1, EASE.Linear);
      fx(dim, "origin:bifrost_streak", at(L, 0, y - L.y + 5, 0), RGB[k % 7], 0.9, { n: 8, r: 1.7, spd: 34 });
      await c.wait(1);
    }
    c.fade(0.15, 0.5, 0.7, WHITE);
    await c.wait(10);
  }, { skippable: false });
  if (!valid(p)) return;
  try {
    if (toAsgard) { p.teleport(ARRIVE, { dimension: world.getDimension(ASGARD), rotation: { x: 0, y: 0 } }); r.asgardHold = now() + 200; }
    else { const m = h.midgard ?? world.getDefaultSpawnLocation(); p.teleport(m, { dimension: world.getDimension("minecraft:overworld") }); }
  } catch (e) { hudMsg(p, "§cThe Bifrost flickers out. §7" + e, 60); return; }
  system.runTimeout(() => {
    if (!valid(p)) return;
    bifrostBeam(p.dimension, p.location, 24);
    sound(p.dimension, "origin.sfx.chime", p.location, 0.7, 1);
    try { p.onScreenDisplay.setTitle(toAsgard ? "§6§lASGARD" : "§aMIDGARD", { fadeInDuration: 6, stayDuration: 40, fadeOutDuration: 12, subtitle: toAsgard ? "§7realm eternal" : "§7home" }); RT(p).titleUntil = now() + 60; } catch { }
  }, 6);
}

// ------------------------------------------------------------------ the realm's ambience (each player sees their own)
const TREES = [[-20, 106, -10], [20, 106, -12], [-24, 106, 14], [24, 106, 16], [-14, 106, -24], [16, 106, -22], [26, 115, -2], ...ISLETS.map(([x, y, z]) => [x, y + 6, z]),
  ...[[-12, 20], [0, 22], [12, 20], [-18, 30], [-6, 32], [6, 32], [18, 28]].map(([dx, dz]) => [-112 + dx, 106, 4 + dz]), [-110, 113, -20]];
const FALLS = [...[[0, 33], [23, 23], [-23, 23]].map(([x, z]) => { const o = V.flat({ x, y: 0, z }); return [x, z, 100, o.x, o.z]; }), ...ISLETS.filter((i) => i[5]).map(([x, y, z, r]) => [x + r - 1, z, y, 1, 0]), [LANDS[0].cx + Math.round(LANDS[0].r * 0.94) - 1, LANDS[0].cz + 8, 100, 1, 0]];
const GOLDS = [{ red: 1, green: 0.85, blue: 0.4 }, { red: 1, green: 0.95, blue: 0.7 }, { red: 1, green: 0.75, blue: 0.3 }];
const AURORA = [{ red: 0.3, green: 1, blue: 0.62 }, { red: 0.62, green: 0.4, blue: 1 }, { red: 1, green: 0.8, blue: 0.38 }, { red: 0.3, green: 0.85, blue: 1 }];
const rnd = (a, b) => a + Math.random() * (b - a);
function pfx(p, id, loc, rgb, a = 1, floats) {
  try {
    const m = new MolangVariableMap();
    m.setColorRGBA("variable.color", { red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: a });
    if (floats) for (const k in floats) m.setFloat("variable." + k, floats[k]);
    p.spawnParticle(id, loc, m);
  } catch { }
}
// k counts this player's Asgard ticks (one per 5 game ticks) so nothing depends on which tick the interval landed on
function ambience(p, k) {
  const L = p.location;
  if (k % 2 === 0) pfx(p, "origin:asg_mote", at(L, 0, 1.5, 0), GOLDS[k % 3], 0.9, { n: 6, r: 8 });
  if (k % 2 === 1) {
    const near = TREES.filter(([x, , z]) => Math.hypot(x - L.x, z - L.z) < 28).slice(0, 3);
    for (const [x, y, z] of near) pfx(p, Math.random() < 0.8 ? "origin:asg_leaf" : "origin:asg_petal", { x: x + 0.5 + rnd(-2, 2), y: y + rnd(-0.5, 1.5), z: z + 0.5 + rnd(-2, 2) }, Math.random() < 0.8 ? GOLDS[Math.floor(Math.random() * 3)] : { red: 1, green: 0.75, blue: 0.85 }, 1, { n: 2, r: 2.5 });
  }
  if (k % 8 === 0) { const a = Math.random() * Math.PI * 2, d = rnd(6, 22); pfx(p, "origin:asg_ray", { x: L.x + Math.cos(a) * d, y: 108, z: L.z + Math.sin(a) * d }, { red: 1, green: 0.93, blue: 0.7 }, 0.3, { w: rnd(0.8, 1.6), h: rnd(6, 10), life: rnd(6, 9) }); }
  if (k % 4 === 0) for (let j = 0; j < 2; j++) { const a = Math.random() * Math.PI * 2, d = rnd(18, 50); pfx(p, "origin:asg_cloud", { x: L.x + Math.cos(a) * d, y: rnd(82, 93), z: L.z + Math.sin(a) * d }, { red: 1, green: 0.97, blue: 0.92 }, 0.55, { size: rnd(3, 6) }); }
  if (k % 2 === 0) for (const [x, z, y, ox, oz] of FALLS) {
    if (Math.hypot(x - L.x, z - L.z) > 50) continue;
    const edge = { x: x + 0.5 + ox * 0.8, y: y - 0.6, z: z + 0.5 + oz * 0.8 };
    pfx(p, "origin:asg_spray", edge, WHITE, 0.8, { n: 4 });
    if (k % 6 === 0) pfx(p, "origin:asg_sparkle", at(edge, 0, -1.5, 0), RGB[Math.floor(Math.random() * 7)], 1, { n: 2, r: 1.2 });
  }
  if (Math.abs(L.x) < 30 && L.z > -80 && L.z < -18) for (let j = 0; j < 2; j++) { const i = Math.floor(Math.random() * 7); pfx(p, "origin:asg_sparkle", { x: i - 3 + 0.5, y: 101.05, z: rnd(-58, -33) }, RGB[i], 1, { n: 1, r: 0.25 }); }
  if (Math.hypot(L.x, L.z + 64) < 22 && k % 2 === 0) pfx(p, "origin:asg_sparkle", { x: 0.5, y: 101.2, z: -63.5 }, GOLDS[1], 1, { n: 3, r: 1.5 });
  if (k % 12 === 0) for (let j = 0; j < 2; j++) { const a = Math.random() * Math.PI * 2, d = rnd(70, 95); pfx(p, "origin:asg_aurora", { x: L.x + Math.cos(a) * d, y: rnd(150, 168), z: L.z + Math.sin(a) * d }, AURORA[Math.floor(Math.random() * AURORA.length)], 0.3, { w: rnd(9, 15), h: rnd(8, 12), life: rnd(8, 12) }); }
}
// every 5 ticks
export function tickAsgard() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const r = RT(p);
    let inA = false; try { inA = p.dimension.id === ASGARD; } catch { }
    if (inA && !r.inAsgard) { r.inAsgard = true; try { p.runCommand("fog @s push origin:asgard_fog origin_asgard"); } catch { } }
    if (!inA && r.inAsgard) { r.inAsgard = false; try { p.runCommand("fog @s remove origin_asgard"); } catch { } }
    if (!inA) continue;
    const k = (r.asgTick = (r.asgTick ?? 0) + 1);
    const ready = tryBuild(p.dimension);
    if ((r.asgardHold ?? 0) > t || !ready) {
      if (ready) r.asgardHold = 0;
      else {
        const pm = perm("minecraft:gold_block");
        try { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const b = p.dimension.getBlock({ x: dx, y: 100, z: -64 + dz }); if (b?.isAir && pm) b.setPermutation(pm); } } catch { }
        try { if (p.location.y < 99 || V.dist(p.location, ARRIVE) > 3) p.teleport(ARRIVE); p.addEffect("slow_falling", 40, { showParticles: false }); } catch { }
        if (k % 4 === 0) hudMsg(p, "§6The realm takes shape around you..." + (lastErr ? " §8(" + lastErr.slice(0, 60) + ")" : ""), 20);
      }
    }
    if (p.location.y < 40) { try { p.teleport(ARRIVE); p.addEffect("slow_falling", 100, { showParticles: false }); } catch { } hudMsg(p, "§6The Bifrost catches you before the void does.", 40); }
    ambience(p, k);
  }
}
