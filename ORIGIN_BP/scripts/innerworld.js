// ORIGIN v0.02 - innerworld.js
// Each hero's Inner World lives in the custom void dimension "origin:inner_world", in its own slot.
import { world, system } from "@minecraft/server";
import {
  DIM_ID, STATIC_ID, slotCenter, HALL_CENTER, VOID_ROOM, SKY_OFFSET_Y, SKY_R, HALL_R, LANDMARKS, PEDESTALS, ISLES,
  planIslands, domeGen, planHall, planStage, stageCenter, STAGE_R, SLOT_SPACING, hallCenter,
} from "./plan.js";
import { runOps, place, clearBox } from "./builder.js";
import { hero, RT, markDirty, ARCH, ARCH_KEYS } from "./data.js";
import { V, at, valid, cmd, overworld, fx, psound, C, now, msg, locOf } from "./util.js";
import { quip, hudMsg } from "./voice.js";
import { title } from "./cine.js";
import { showLoad, hideLoad } from "./load.js";

export { DIM_ID };
export function iwDim() {
  return world.getDimension(DIM_ID);
}
export function registerDimension() {
  system.beforeEvents.startup.subscribe((ev) => {
    for (const id of [DIM_ID, STATIC_ID]) {
      try { ev.dimensionRegistry.registerCustomDimension(id); }
      catch (e) { console.warn(`[ORIGIN] could not register dimension ${id}: ${e}`); }
    }
  });
}

// ------------------------------------------------------------------ plans (one per archetype, computed once, spread over ticks)
const PLANS = new Map();   // arch -> plan
const PLANNING = new Map(); // arch -> promise
let hallPlan = null;
export function plans(arch = "brawler") {
  if (PLANS.has(arch)) return Promise.resolve(PLANS.get(arch));
  if (PLANNING.has(arch)) return PLANNING.get(arch);
  const pr = new Promise((resolve) => {
    const dome = [];
    const job = function* () {
      const islands = planIslands(arch);
      yield;
      for (const _ of domeGen(dome, SKY_R, arch)) yield;
      const ringKey = (o) => Math.round(Math.hypot(o[0], o[2]));
      const rings = [...islands].sort((a, b) => ringKey(a) - ringKey(b) || a[1] - b[1]);
      yield;
      if (!hallPlan) hallPlan = planHall();
      const P = {
        islands, dome, rings, hall: hallPlan,
        swap: [
          ...dome.filter((o) => o[3] !== o[4]).map((o) => [o[0], o[1] + SKY_OFFSET_Y, o[2], o[3], o[4]]),
          ...islands.filter((o) => o[3] !== o[4]),
        ],
      };
      PLANS.set(arch, P);
      PLANNING.delete(arch);
      resolve(P);
    };
    system.runJob(job());
  });
  PLANNING.set(arch, pr);
  return pr;
}

// ------------------------------------------------------------------ world flags + slots
const flag = (k) => { try { return world.getDynamicProperty(k); } catch { return undefined; } };
const setFlag = (k, v) => { try { world.setDynamicProperty(k, v); } catch { } };

export function slotOf(player) {
  let map = {};
  try { map = JSON.parse(flag("origin:slots") ?? "{}"); } catch { map = {}; }
  if (map[player.id] !== undefined) return map[player.id];
  const used = new Set(Object.values(map));
  let s = 0;
  while (used.has(s)) s++;
  map[player.id] = s;
  setFlag("origin:slots", JSON.stringify(map));
  return s;
}
export const centerOf = (player) => slotCenter(slotOf(player));
export const isBuilt = (slot, arch) => flag(`origin:iw_built:${slot}`) === true && (!arch || (flag(`origin:iw_arch:${slot}`) ?? "brawler") === arch);
export const hallBuilt = (slot = 0) => flag(`origin:hall_built:${slot}`) === true || (slot === 0 && flag("origin:hall_built") === true);
export const skyState = (slot) => (flag(`origin:sky:${slot}`) === "dread" ? "dread" : "light");
const skyApplied = (slot) => (flag(`origin:sky_applied:${slot}`) === "dread" ? "dread" : "light");

export function resetWorldFlags(slot) {
  setFlag(`origin:iw_built:${slot}`, false);
  setFlag(`origin:stage_built:${slot}`, false);
  setFlag(`origin:hall_built:${slot}`, false);
  if (slot === 0) setFlag("origin:hall_built", false);
}

// ------------------------------------------------------------------ chunk loading
export async function loadArea(id, center, radius, dim = iwDim()) {
  const mgr = world.tickingAreaManager;
  try { if (mgr.hasTickingArea(id)) mgr.removeTickingArea(id); } catch { }
  const opts = {
    dimension: dim,
    from: { x: Math.floor(center.x - radius), y: Math.floor(center.y - radius), z: Math.floor(center.z - radius) },
    to: { x: Math.floor(center.x + radius), y: Math.floor(center.y + radius), z: Math.floor(center.z + radius) },
  };
  try {
    if (!mgr.hasCapacity(opts)) console.warn("[ORIGIN] ticking area capacity is low; building may be slow.");
    await mgr.createTickingArea(id, opts);
    return true;
  } catch (e) {
    console.warn(`[ORIGIN] ticking area '${id}' failed: ${e}`);
    return false;
  }
}
export function unloadArea(id) {
  try { if (world.tickingAreaManager.hasTickingArea(id)) world.tickingAreaManager.removeTickingArea(id); } catch { }
}

// Spawning needs a ticking chunk: retry for a while instead of failing once.
export async function spawnRetry(dim, type, loc, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { return dim.spawnEntity(type, loc); } catch { await system.waitTicks(5); }
  }
  console.warn(`[ORIGIN] could not spawn ${type} (chunk never ticked).`);
  return null;
}

// ------------------------------------------------------------------ regions
export function inStage(p) {
  try {
    if (p.dimension.id !== DIM_ID) return false;
    const slot = Math.round(p.location.x / SLOT_SPACING);
    return V.hdist(p.location, stageCenter(slot)) < STAGE_R + 12;
  } catch { return false; }
}
export function inVoid(p) {
  try { return p.dimension.id === DIM_ID && Math.abs(p.location.x - VOID_ROOM.x - 48) < 120 && Math.abs(p.location.z - VOID_ROOM.z) < 60; } catch { return false; }
}
export function inIW(p) {
  try { return p.dimension.id === DIM_ID && !inHall(p) && !inStage(p) && !inVoid(p); } catch { return false; }
}
export function inHall(p) {
  try { return p.dimension.id === DIM_ID && V.dist(p.location, hallCenter(Math.round(p.location.x / SLOT_SPACING))) < HALL_R + 20; } catch { return false; }
}
export const lm = (C0, k) => at(C0, LANDMARKS[k].x, LANDMARKS[k].y, LANDMARKS[k].z);
export const arrivalLoc = (C0) => lm(C0, "arrival");
export const anchorFace = (C0) => at(C0, 0.5, 1.6, 0.5);

// Keep a player parked on a spot (re-teleport if they fall) until a promise settles.
export async function holdWhile(p, loc, promise, facing) {
  let done = false;
  const id = system.runInterval(() => {
    if (done || !valid(p)) return;
    try {
      if (p.dimension.id !== DIM_ID || p.location.y < loc.y - 0.6 || V.hdist(p.location, loc) > 3) {
        p.teleport(loc, { dimension: iwDim(), ...(facing ? { facingLocation: facing } : {}) });
      }
      p.addEffect("slow_falling", 30, { amplifier: 0, showParticles: false });
      p.addEffect("resistance", 30, { amplifier: 4, showParticles: false });
    } catch { }
  }, 4);
  try { return await promise; } finally { done = true; system.clearRun(id); }
}

// ------------------------------------------------------------------ building
const building = new Map(); // slot -> promise
export function buildIW(slot, opts = {}) {
  if (building.has(slot)) return building.get(slot);
  const arch = opts.arch ?? "brawler";
  const job = (async () => {
    const C0 = slotCenter(slot);
    const dim = iwDim();
    const area = `origin_iw_${slot}`;
    try {
      const pl = await plans(arch);
      await loadArea(area, at(C0, 0, SKY_OFFSET_Y, 0), SKY_R + 2);
      // a different archetype lived here before: wipe the old world first
      const prev = flag(`origin:iw_arch:${slot}`);
      if ((prev && prev !== arch) || opts.wipe) {
        const r = SKY_R + 2;
        await clearBox(dim, at(C0, -r, SKY_OFFSET_Y - r, -r), at(C0, r, SKY_OFFSET_Y + r, r));
      }
      for (let x = -1; x <= 1; x++) for (let z = 7; z <= 9; z++) place(dim, at(C0, x, 0, z), "calcite");
      const state = skyState(slot);
      const w = state === "dread" ? 4 : 3;
      const dpt = opts.domePerTick ?? 1200;
      if (opts.onDome) opts.onDome(Math.ceil(pl.dome.length / dpt));
      await runOps(dim, at(C0, 0, SKY_OFFSET_Y, 0), pl.dome, w, { perTick: dpt }).promise;
      const ipt = opts.islandPerTick ?? 500;
      if (opts.onIsland) opts.onIsland(Math.ceil(pl.rings.length / ipt));
      const res = await runOps(dim, C0, pl.rings, w, { perTick: ipt }).promise;
      setFlag(`origin:iw_built:${slot}`, true);
      setFlag(`origin:iw_arch:${slot}`, arch);
      setFlag(`origin:sky_applied:${slot}`, state);
      return res.failed === 0;
    } finally {
      unloadArea(area);
      building.delete(slot);
    }
  })();
  building.set(slot, job);
  return job;
}

const hallJobs = new Map();   // slot -> promise
export function ensureHall(slot = 0) {
  if (hallBuilt(slot)) return Promise.resolve(true);
  if (hallJobs.has(slot)) return hallJobs.get(slot);
  const job = (async () => {
    try {
      const pl = await plans("brawler");
      const res = await runOps(iwDim(), hallCenter(slot), pl.hall, 3, { perTick: 1500 }).promise;
      if (res.failed === 0) setFlag(`origin:hall_built:${slot}`, true);
      return res.failed === 0;
    } finally {
      hallJobs.delete(slot);
    }
  })();
  hallJobs.set(slot, job);
  return job;
}

// ------------------------------------------------------------------ training field (Move Forge preview)
let stageOps = null;
const stageJobs = new Map();
export function ensureStage(slot) {
  if (flag(`origin:stage_built:${slot}`) === true) return Promise.resolve(true);
  if (stageJobs.has(slot)) return stageJobs.get(slot);
  const job = (async () => {
    try {
      if (!stageOps) stageOps = planStage();
      const res = await runOps(iwDim(), stageCenter(slot), stageOps, 3, { perTick: 900 }).promise;
      if (res.failed === 0) setFlag(`origin:stage_built:${slot}`, true);
      return res.failed === 0;
    } finally {
      stageJobs.delete(slot);
    }
  })();
  stageJobs.set(slot, job);
  return job;
}
export { stageCenter };

// ------------------------------------------------------------------ sky
const swapJobs = new Map(); // slot -> job

export function setSky(slot, state, player) {
  if (state !== "light" && state !== "dread") return;
  if (skyState(slot) === state) return;
  setFlag(`origin:sky:${slot}`, state);
  if (player && inIW(player)) {
    if (state === "dread") {
      psound(player, "origin.sfx.swell", 0.55, 1);
      psound(player, "ambient.cave", 0.7, 0.8);
      quip(player, "sky_dread", "...The sky's turning. That's you, by the way.", 1200, false);
    } else {
      psound(player, "origin.sfx.swell", 1.15, 0.8);
      psound(player, "beacon.activate", 1.2, 0.6);
      quip(player, "sky_light", "There. Breathe.", 1200, false);
    }
  }
}

function startSwapIfNeeded(slot, arch) {
  const P = PLANS.get(arch);
  if (!P) { plans(arch); return; }
  if (swapJobs.has(slot) || !isBuilt(slot, arch) || building.has(slot)) return;
  const want = skyState(slot);
  if (skyApplied(slot) === want) return;
  const job = runOps(iwDim(), slotCenter(slot), P.swap, want === "dread" ? 4 : 3, { perTick: 600 });
  swapJobs.set(slot, job);
  job.promise.then((res) => {
    swapJobs.delete(slot);
    if (!res.cancelled && res.failed === 0) setFlag(`origin:sky_applied:${slot}`, want);
  });
}

function autoSky(p, slot) {
  const h = hero(p);
  if (h.skyOverride === "light" || h.skyOverride === "dread") return setSky(slot, h.skyOverride, p);
  const cur = skyState(slot);
  if (cur === "light" && h.dread >= 50) setSky(slot, "dread", p);
  else if (cur === "dread" && h.dread < 40) setSky(slot, "light", p);
}

export function updateFog(p) {
  const r = RT(p);
  const want = inIW(p) ? (skyState(slotOf(p)) === "dread" ? "origin:inner_dread" : "origin:inner_light") : null;
  if (r.iwFog === want) return;
  cmd(p, "fog @s remove origin_iw");
  if (want) cmd(p, `fog @s push ${want} origin_iw`);
  r.iwFog = want;
}

// ------------------------------------------------------------------ manifestation
export async function ensureManifestation(slot, arch) {
  const C0 = slotCenter(slot);
  const dim = iwDim();
  let list = [];
  try { list = dim.getEntities({ type: "origin:manifestation", location: C0, maxDistance: SKY_R }); } catch { }
  let m = list.shift();
  for (const extra of list) try { extra.remove(); } catch { }
  if (!valid(m)) m = await spawnRetry(dim, "origin:manifestation", lm(C0, "manifestation"));
  try { if (m) m.setProperty("origin:arch", ARCH[arch]?.idx ?? 0); } catch { }
  return m;
}

// ------------------------------------------------------------------ enter / wake
export async function enter(p, { quiet = false } = {}) {
  const h = hero(p);
  const r = RT(p);
  if (!h.awakened) { msg(p, "§7You close your eyes. Nothing answers. §8(Awaken first: use the Humming Shard.)"); return false; }
  if (inIW(p)) { hudMsg(p, "§7You're already inside."); return false; }
  if (r.cine || r.traveling) return false;
  r.traveling = true;
  try {
    h.ret = locOf(p);
    markDirty(p);
    const slot = slotOf(p);
    const C0 = slotCenter(slot);
    try { p.camera.fade({ fadeTime: { fadeInTime: 0.5, holdTime: 1.5, fadeOutTime: 1.1 }, fadeColor: { red: 0.06, green: 0.02, blue: 0.1 } }); } catch { }
    psound(p, "origin.sfx.swell", 1.1, 0.8);
    fx(p.dimension, "origin:pillar", p.location, ARCH[h.arch]?.rgb ?? C.white, 0.9);
    await system.waitTicks(11);
    if (!valid(p)) return false;
    showLoad(p, "iw", `§l${ARCH[h.arch]?.col ?? "§d"}THE INNER WORLD`);
    const dest = arrivalLoc(C0);
    await loadArea(`origin_arrive_${slot}`, dest, 12);
    p.teleport(dest, { dimension: iwDim(), facingLocation: anchorFace(C0) });
    if (!isBuilt(slot, h.arch)) {
      hudMsg(p, "§7Your Inner World is taking shape...", 200);
      await holdWhile(p, dest, buildIW(slot, { arch: h.arch }), anchorFace(C0));
    }
    unloadArea(`origin_arrive_${slot}`);
    if (!valid(p)) return false;
    await system.waitTicks(16);
    hideLoad(p);
    await ensureManifestation(slot, h.arch);
    r.gateCd = now() + 60;
    updateFog(p);
    title(p, " ", "§7You are inside yourself.", 50);
    if (!quiet) {
      const greet = {
        brawler: "Back already? Good. The arena's east. Ring the bell when you want a fight.",
        energy: "YOU'RE BACK! Okay. The forges are south-east. Make something LOUD.",
        shadow: "Welcome home. The workshop is open, the arena is east, and I'm... here.",
      }[h.arch] ?? "Welcome back.";
      quip(p, "enter", greet, 600);
    }
    return true;
  } finally {
    r.traveling = false;
  }
}

export async function wake(p) {
  const h = hero(p);
  const r = RT(p);
  if (r.caged) { hudMsg(p, "§4You're locked in. §7The Other still has your body."); return; }
  if (r.cine || r.traveling) return;
  r.traveling = true;
  try {
    try { p.camera.fade({ fadeTime: { fadeInTime: 0.4, holdTime: 0.6, fadeOutTime: 1.0 }, fadeColor: { red: 1, green: 1, blue: 1 } }); } catch { }
    psound(p, "origin.sfx.burst", 0.8, 0.7);
    await system.waitTicks(9);
    showLoad(p, "ow");
    if (!valid(p)) return;
    let dim = overworld();
    let loc = null;
    const ret = h.ret;
    if (ret && ret.dim !== DIM_ID) {
      try { dim = world.getDimension(ret.dim); loc = { x: ret.x, y: ret.y, z: ret.z }; } catch { loc = null; }
    }
    if (!loc) {
      const sp = p.getSpawnPoint();
      if (sp && sp.dimension?.id !== DIM_ID) { dim = sp.dimension; loc = { x: sp.x + 0.5, y: sp.y, z: sp.z + 0.5 }; }
      else {
        const d = world.getDefaultSpawnLocation();
        dim = overworld();
        loc = { x: d.x + 0.5, y: d.y > 320 ? 200 : d.y, z: d.z + 0.5 };
        if (d.y > 320) {
          try { p.addEffect("slow_falling", 600, { showParticles: false }); p.addEffect("resistance", 600, { amplifier: 4, showParticles: false }); } catch { }
        }
      }
    }
    p.teleport(loc, { dimension: dim, rotation: { x: 0, y: ret?.ry ?? p.getRotation().y } });
    system.runTimeout(() => hideLoad(p), 30);
    h.ret = null;
    markDirty(p);
    cmd(p, "fog @s remove origin_iw");
    r.iwFog = null;
    title(p, " ", "§7You wake up.", 40);
  } finally {
    r.traveling = false;
  }
}

// ------------------------------------------------------------------ hall (awakening set)
// only ever touches ONE hero's hall
export function clearHallEntities(slot = 0) {
  const dim = iwDim();
  for (const type of ["origin:archetype_orb", "origin:manifestation"]) {
    try { for (const e of dim.getEntities({ type, location: hallCenter(slot), maxDistance: HALL_R + 4 })) e.remove(); } catch { }
  }
}
export function orbLoc(i, slot = 0) {
  const p = PEDESTALS[i];
  return at(hallCenter(slot), p.x + 0.5, 2, p.z + 0.5);
}
export async function spawnOrbs(slot = 0, owner = "") {
  const dim = iwDim();
  const orbs = [];
  for (let i = 0; i < PEDESTALS.length; i++) {
    const a = ARCH[PEDESTALS[i].arch];
    const e = await spawnRetry(dim, "origin:archetype_orb", orbLoc(i, slot));
    if (!e) continue;
    try { e.setProperty("origin:arch", a.idx); e.nameTag = `${a.col}§l${a.name.toUpperCase()}`; } catch { }
    try { if (owner) e.setDynamicProperty("origin:owner", owner); } catch { }
    orbs.push(e);
  }
  return orbs;
}
export function archOfOrb(e) {
  try { return ARCH_KEYS[e.getProperty("origin:arch") ?? 0] ?? "brawler"; } catch { return "brawler"; }
}

// ------------------------------------------------------------------ ticks
// every 10 ticks, per player
export function tickPlayer(p) {
  const r = RT(p);
  const inside = inIW(p);
  if (inside !== r.inIW) {
    r.inIW = inside;
    if (inside) r.gateCd = Math.max(r.gateCd, now() + 40);
  }
  updateFog(p);
  if (r.cine || r.traveling || r.station) return;
  if (!inside) return;
  const C0 = centerOf(p);
  const l = p.location;
  if (l.y < C0.y - 24 || V.hdist(l, C0) > SKY_R + 4) {
    p.teleport(arrivalLoc(C0), { facingLocation: anchorFace(C0) });
    quip(p, "void", "Careful. Falling in here means falling forever. Mostly.", 2400);
    return;
  }
  const g = lm(C0, "gate");
  if (now() > r.gateCd && Math.abs(l.x - (g.x + 0.5)) < 1.6 && Math.abs(l.z - (g.z + 0.5)) < 0.9 && l.y > g.y + 0.5 && l.y < g.y + 5) {
    r.gateCd = now() + 100;
    wake(p);
    return;
  }
  // ambience: petals in the light, ash in the dread
  const dread = skyState(slotOf(p)) === "dread";
  for (let i = 0; i < 2; i++) {
    const m = at(l, (Math.random() - 0.5) * 20, 3 + Math.random() * 6, (Math.random() - 0.5) * 20);
    fx(p.dimension, dread ? "origin:ash" : "origin:petal", m, dread ? C.crimson : { red: 1, green: 0.75, blue: 0.85 }, 0.9);
  }
  if (Math.random() < 0.3) fx(p.dimension, "origin:mote", at(l, (Math.random() - 0.5) * 14, 1 + Math.random() * 4, (Math.random() - 0.5) * 14), dread ? C.crimson : C.gold, 0.8);
}

// every 20 ticks
export function tickWorld() {
  for (const p of world.getAllPlayers()) {
    if (!inIW(p)) continue;
    const slot = slotOf(p);
    autoSky(p, slot);
    startSwapIfNeeded(slot, hero(p).arch);
    // anything that fell off the island (Rift Brutes, dummies) gets put back in the arena
    try {
      const C0 = slotCenter(slot);
      for (const e of iwDim().getEntities({ location: C0, maxDistance: SKY_R + 40, excludeTypes: ["minecraft:player", "origin:manifestation", "origin:float_text", "minecraft:item", "minecraft:xp_orb"] })) {
        if (e.location.y < C0.y - 12) {
          e.teleport(lm(C0, "arena"));
          try { e.clearVelocity(); } catch { }
          fx(e.dimension, "origin:pillar", e.location, C.crimson, 0.7);
        }
      }
    } catch { }
    if (now() % 40 < 20) {
      try {
        const C0 = slotCenter(slot);
        const dim = iwDim();
        for (const e of dim.getEntities({ location: C0, maxDistance: SKY_R + 4, families: ["monster"], excludeTypes: ["origin:rift_brute"], excludeTags: ["origin_trial"] })) e.remove();
        const m = dim.getEntities({ type: "origin:manifestation", location: C0, maxDistance: SKY_R + 4 })[0];
        if (m) {
          const pl = p.location, ml = m.location;
          m.setRotation({ x: 0, y: (Math.atan2(-(pl.x - ml.x), pl.z - ml.z) * 180) / Math.PI });
        }
      } catch { }
    }
  }
}

export function landmark(player, key) {
  return lm(centerOf(player), key);
}
export function isles() {
  return ISLES;
}
