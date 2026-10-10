// ORIGIN v0.21 - tempblocks.js
// Blocks that are only meant to be there for a while: a beam's light where it lands, the Ice Slide road.
// Each one remembers exactly what was there before (block + states, so flowing water stays flowing) and puts it back
// when it expires. If its chunk isn't loaded at that moment it waits until it is, and the list is saved in the world,
// so quitting, a crash or /reload can't strand one - anything left over is put back after the next load.
// Nothing gets overwritten: if the block was changed since (mined, burned, built over), it's left alone.
import { world, system, BlockPermutation } from "@minecraft/server";

const KEY = "origin:tempblocks";
const PER_PROP = 220;                  // entries per world property (keeps each under the 32k string limit)
const live = new Map();                // "dim|x|y|z" -> { dimId, at, type, prev: [id, states], until }
let dirty = false, loaded = false, lastSave = 0, propsUsed = 0;
const fl = (a) => ({ x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) });
const kOf = (dimId, a) => `${dimId}|${a.x}|${a.y}|${a.z}`;
const DIMS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const short = (id) => (id.startsWith("minecraft:") ? id.slice(10) : id);
const long = (id) => (id.includes(":") ? id : "minecraft:" + id);

export function isTempBlock(dim, loc) { try { return live.has(kOf(dim.id, fl(loc))); } catch { return false; } }

// put `perm` at loc for `ticks`, only over a block that passes `over` (default: air). true = placed
export function placeTemp(dim, loc, perm, ticks, over = (b) => b.isAir) {
  if (!perm) return false;
  const a = fl(loc), k = kOf(dim.id, a);
  if (live.has(k)) return false;
  try {
    const b = dim.getBlock(a);
    if (!b || !over(b)) return false;
    const pv = b.permutation;
    let st = {};
    try { st = pv.getAllStates(); } catch { }
    b.setPermutation(perm);
    live.set(k, { dimId: dim.id, at: a, type: perm.type.id, prev: [pv.type.id, st], until: system.currentTick + ticks });
    dirty = true;
    return true;
  } catch { return false; }
}
// keep one alive a while longer (a beam held on the same spot)
export function touchTemp(dim, loc, ticks) {
  const q = live.get(kOf(dim.id, fl(loc)));
  if (q) q.until = Math.max(q.until, system.currentTick + ticks);
}
// put it back now (or as soon as its chunk is loaded)
export function releaseTemp(dim, loc) {
  const k = kOf(dim.id, fl(loc)), q = live.get(k);
  if (q && !restore(k, q)) q.until = 0;
}

function restore(k, q) {
  let dim;
  try { dim = world.getDimension(q.dimId); } catch { live.delete(k); dirty = true; return true; }
  try { if (!dim.isChunkLoaded(q.at)) return false; } catch { return false; }
  try {
    const b = dim.getBlock(q.at);
    if (!b) return false;
    if (b.typeId === q.type) {
      let pm = null;
      try { pm = BlockPermutation.resolve(q.prev[0], q.prev[1]); } catch { try { pm = BlockPermutation.resolve(q.prev[0]); } catch { } }
      if (pm) b.setPermutation(pm); else b.setType("minecraft:air");
    }
  } catch { return false; }
  live.delete(k);
  dirty = true;
  return true;
}

function save() {
  lastSave = system.currentTick;
  dirty = false;
  try {
    const rows = [...live.values()].map((q) => {
      const d = DIMS.indexOf(q.dimId);
      const row = [d >= 0 ? d : q.dimId, q.at.x, q.at.y, q.at.z, short(q.type), short(q.prev[0])];
      if (q.prev[1] && Object.keys(q.prev[1]).length) row.push(q.prev[1]);
      return row;
    });
    const n = Math.ceil(rows.length / PER_PROP);
    for (let i = 0; i < n; i++) world.setDynamicProperty(`${KEY}:${i}`, JSON.stringify(rows.slice(i * PER_PROP, (i + 1) * PER_PROP)));
    for (let i = n; i < propsUsed; i++) world.setDynamicProperty(`${KEY}:${i}`, undefined);
    propsUsed = n;
  } catch (e) { dirty = true; }
}

function loadLeftovers() {
  for (let i = 0; i < 64; i++) {
    const raw = world.getDynamicProperty(`${KEY}:${i}`);
    if (typeof raw !== "string") break;
    propsUsed = i + 1;
    let rows = [];
    try { rows = JSON.parse(raw); } catch { }
    for (const r of rows) {
      try {
        const dimId = typeof r[0] === "number" ? DIMS[r[0]] : r[0], a = { x: r[1], y: r[2], z: r[3] };
        const k = kOf(dimId, a);
        if (!live.has(k)) live.set(k, { dimId, at: a, type: long(r[4]), prev: [long(r[5]), r[6] ?? {}], until: 0 });   // from last session: put back asap
      } catch { }
    }
  }
  loaded = true;
}

// every 5 ticks
export function tickTempBlocks() {
  if (!loaded) { try { loadLeftovers(); } catch { return; } }
  const t = system.currentTick;
  let n = 0;
  for (const [k, q] of live) {
    if (q.until > t) continue;
    if (restore(k, q) && ++n >= 300) break;
  }
  if (dirty && t - lastSave >= 20) save();
}
