// ORIGIN v0.02 - builder.js
// Resolves block specs (with fallbacks) and places plan ops a few hundred per tick.
import { system, BlockPermutation } from "@minecraft/server";
import { SPECS } from "./plan.js";

// ---------------------------------------------------------------- block specs
const permCache = new Map();
function resolveSpec(spec) {
  if (typeof spec === "string") return BlockPermutation.resolve(spec);
  if (spec && spec.alt) {
    for (const s of spec.alt) {
      try {
        const p = resolveSpec(s);
        if (p) return p;
      } catch { /* try next */ }
    }
    return null;
  }
  return BlockPermutation.resolve(spec.id, spec.states);
}
export function perm(key) {
  if (permCache.has(key)) return permCache.get(key);
  let p = null;
  try { p = resolveSpec(SPECS[key] ?? key); } catch { p = null; }
  if (!p) console.warn(`[ORIGIN] block '${key}' did not resolve on this version; skipping it.`);
  permCache.set(key, p);
  return p;
}

// 1 = placed, 0 = skipped (unknown block), -1 = chunk not ready
export function place(dim, loc, key) {
  const p = perm(key);
  if (!p) return 0;
  let b;
  try { b = dim.getBlock(loc); } catch { return -1; }
  if (!b) return -1;
  try { b.setPermutation(p); return 1; } catch { return -1; }
}

// ---------------------------------------------------------------- paced executor
// ops: [dx,dy,dz,lightKey,dreadKey]; which: 3 (light) or 4 (dread)
export function runOps(dim, center, ops, which, opts = {}) {
  const perTick = opts.perTick ?? 500;
  const job = { cancelled: false, progress: 0, done: false };
  job.promise = new Promise((resolve) => {
    let list = ops;
    let i = 0;
    let retry = [];
    let passes = 0;
    let waitUntil = 0;
    let placed = 0;
    const id = system.runInterval(() => {
      try {
        if (job.cancelled) { system.clearRun(id); job.done = true; resolve({ placed, failed: 0, cancelled: true }); return; }
        if (system.currentTick < waitUntil) return;
        let budget = perTick;
        while (budget-- > 0 && i < list.length) {
          const o = list[i++];
          const r = place(dim, { x: center.x + o[0], y: center.y + o[1], z: center.z + o[2] }, o[which]);
          if (r < 0) retry.push(o);
          else placed++;
        }
        job.progress = Math.min(1, (placed + 0.0001) / ops.length);
        if (opts.onTick) opts.onTick(job.progress);
        if (i >= list.length) {
          if (retry.length && passes < 30) {
            list = retry; retry = []; i = 0; passes++;
            waitUntil = system.currentTick + 8;
            return;
          }
          system.clearRun(id);
          job.done = true;
          if (retry.length) console.warn(`[ORIGIN] ${retry.length} blocks could not be placed (chunk never loaded).`);
          resolve({ placed, failed: retry.length, cancelled: false });
        }
      } catch (e) {
        system.clearRun(id);
        job.done = true;
        console.warn("[ORIGIN] build error: " + e);
        resolve({ placed, failed: -1, cancelled: false });
      }
    }, 1);
  });
  return job;
}

export function isLoaded(dim, loc) {
  try { return !!dim.getBlock(loc); } catch { return false; }
}

// Clear a box to air using /fill in slabs (each slab <= 32768 blocks). Waits for chunks to load.
export async function clearBox(dim, min, max, maxTries = 60) {
  const w = max.x - min.x + 1, d = max.z - min.z + 1;
  const slab = Math.max(1, Math.floor(32768 / (w * d)));
  const pending = [];
  for (let y = min.y; y <= max.y; y += slab) pending.push([y, Math.min(max.y, y + slab - 1)]);
  const cx = Math.floor((min.x + max.x) / 2), cz = Math.floor((min.z + max.z) / 2);
  let tries = 0;
  while (pending.length && tries < maxTries) {
    for (let k = pending.length - 1; k >= 0; k--) {
      const [y1, y2] = pending[k];
      const corners = [[min.x, min.z], [max.x, min.z], [min.x, max.z], [max.x, max.z], [cx, cz]];
      if (!corners.every(([x, z]) => isLoaded(dim, { x, y: y1, z }) && isLoaded(dim, { x, y: y2, z }))) continue;
      // Loaded: a throw here just means "nothing to fill" (already air).
      try { dim.runCommand(`fill ${min.x} ${y1} ${min.z} ${max.x} ${y2} ${max.z} air`); } catch { }
      pending.splice(k, 1);
    }
    if (pending.length) { tries++; await system.waitTicks(5); }
  }
  return pending.length === 0;
}

export function tickingArea(dim, name, c, on) {
  try {
    if (on) dim.runCommand(`tickingarea add circle ${Math.floor(c.x)} ${Math.floor(c.y)} ${Math.floor(c.z)} 4 ${name} true`);
    else dim.runCommand(`tickingarea remove ${name}`);
  } catch { /* already exists / already removed */ }
}
