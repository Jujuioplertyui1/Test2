// ORIGIN v0.24 - speedforce.js
// THE SPEED FORCE - where speed comes from. Only a Super Speed hero can get in.
//  Getting in: Speedster mode on, flat out (a sonic boom's worth of speed) for six seconds and the lightning around
//   you starts to sing (the HUD fills up). Then JUMP while still running flat out: you break through.
//  Inside: a ring of light hanging in a gold-white storm. You run - you can't help it - and everything you are
//   refills: Energy, Stamina, Surge, health. Echoes of yourself flicker ahead on the track.
//   Four TIME GATES stand over the track. Run through one and choose where to come out:
//     where you went in · home (your spawn) · where you last died · run back to dawn · run on to nightfall
//   Stop running (sneak for three seconds) and the Speed Force lets you go where you came in.
//  Stay too long and the BLACK FLASH comes for you: death itself, running you down. It gets faster the longer you
//   stay. If it catches you it hurts - and throws you out. You can't fight it. Run.
//  Coming out, you're SPEED FORCE CHARGED for a minute: faster, stronger, and your Lightning Throw is always charged.
import { world, system, BlockPermutation, EntityDamageCause } from "@minecraft/server";
import { hero, RT, markDirty, saveNow, maxEnergy } from "./data.js";
import { V, at, valid, fx, sound, psound, now, msg, hexToRgb } from "./util.js";
import { hudMsg } from "./voice.js";
import { oform, show, ICONS } from "./forms.js";
import { runCine, EASE } from "./cine.js";

export const SPEED_FORCE = "origin:speed_force";
system.beforeEvents.startup.subscribe((ev) => { try { ev.dimensionRegistry.registerCustomDimension(SPEED_FORCE); } catch (e) { console.warn("[ORIGIN] speed force: " + e); } });
const KEY = "origin:speedforce_v1";
const R = 56, Y = 100, HALF = 3.5;                      // the ring: radius, floor height, half-width
const ARRIVE = { x: 0.5, y: Y + 1, z: -R + 0.5 };
const GATES = [45, 135, 225, 315].map((deg) => { const a = (deg * Math.PI) / 180; return { deg, x: Math.cos(a) * R, z: Math.sin(a) * R }; });
const GOLD = hexToRgb("#ffd34a"), BLUE = hexToRgb("#7fd6ff"), WHITE = { red: 1, green: 1, blue: 1 }, RED = hexToRgb("#ff2a2a");
const CHARGE_FULL = 120;            // ticks flat out to open the way (6s)
const FLASH_AFTER = 20 * 90;        // the Black Flash comes after 90s inside
const BLACK_FLASH = "origin:black_flash";
export const inSpeedForce = (p) => { try { return p.dimension.id === SPEED_FORCE; } catch { return false; } };

// ------------------------------------------------------------------ the ring (built piece by piece as it loads)
const PERM = new Map();
function perm(id) {
  if (PERM.has(id)) return PERM.get(id);
  let pm = null;
  for (const c of [id, "minecraft:white_concrete", "minecraft:quartz_block"]) { try { pm = BlockPermutation.resolve(c); if (pm) break; } catch { } }
  PERM.set(id, pm); return pm;
}
function put(d, x, y, z, id) { try { const b = d.getBlock({ x, y, z }); if (!b) return false; const pm = perm(id); if (pm) b.setPermutation(pm); return true; } catch { return false; } }
const SEGMENTS = 24;
function buildSegment(d, k) {
  const a0 = (k / SEGMENTS) * Math.PI * 2, a1 = ((k + 1) / SEGMENTS) * Math.PI * 2;
  const mid = (a0 + a1) / 2;
  if (!d.getBlock({ x: Math.floor(Math.cos(mid) * R), y: Y, z: Math.floor(Math.sin(mid) * R) })) return false;
  const pts = [[Math.cos(a0), Math.sin(a0)], [Math.cos(a1), Math.sin(a1)], [Math.cos(mid), Math.sin(mid)]];
  const xs = pts.flatMap(([c]) => [c * (R - HALF - 2), c * (R + HALF + 2)]), zs = pts.flatMap(([, s]) => [s * (R - HALF - 2), s * (R + HALF + 2)]);
  let ok = true;
  for (let x = Math.floor(Math.min(...xs)) - 1; x <= Math.ceil(Math.max(...xs)) + 1; x++) {
    for (let z = Math.floor(Math.min(...zs)) - 1; z <= Math.ceil(Math.max(...zs)) + 1; z++) {
      const cx = x + 0.5, cz = z + 0.5;
      let a = Math.atan2(cz, cx); if (a < 0) a += Math.PI * 2;
      if (a < a0 || a >= a1) continue;
      const r = Math.hypot(cx, cz), off = r - R;
      if (Math.abs(off) > HALF + 1) continue;
      if (Math.abs(off) <= HALF) {
        const arc = Math.round(a * R);
        const id = Math.abs(off) > HALF - 1 ? "minecraft:gold_block" : Math.abs(off) < 0.6 && arc % 6 === 0 ? "minecraft:sea_lantern" : "minecraft:white_concrete";
        ok = put(d, x, Y, z, id) && ok;
        if (Math.abs(off) > HALF - 1) ok = put(d, x, Y - 1, z, "minecraft:yellow_stained_glass") && ok;
      } else {
        ok = put(d, x, Y + 1, z, "minecraft:light_blue_stained_glass") && ok;   // a low rail on both sides
        if (Math.round(a * R) % 10 === 0) ok = put(d, x, Y + 2, z, "minecraft:sea_lantern") && ok;
      }
    }
  }
  // a time gate, if one stands in this segment
  for (const g of GATES) {
    let ga = (g.deg * Math.PI) / 180;
    if (ga < a0 || ga >= a1) continue;
    const ux = Math.cos(ga), uz = Math.sin(ga);
    for (let s = -HALF - 1; s <= HALF + 1; s += 0.5) {
      const x = Math.floor(ux * (R + s)), z = Math.floor(uz * (R + s));
      ok = put(d, x, Y + 9, z, "minecraft:gold_block") && ok;
      if (Math.abs(s) >= HALF + 0.5) for (let y = Y + 1; y < Y + 9; y++) ok = put(d, x, y, z, y % 3 === 0 ? "minecraft:glowstone" : "minecraft:gold_block") && ok;
    }
  }
  return ok;
}
const builtSet = () => new Set(String(world.getDynamicProperty(KEY) ?? "").split(",").filter(Boolean));
function tryBuild(d) {
  const done = builtSet();
  let n = 0, changed = false;
  for (let k = 0; k < SEGMENTS && n < 3; k++) {
    if (done.has(String(k))) continue;
    if (buildSegment(d, k)) { done.add(String(k)); changed = true; n++; }
  }
  if (changed) world.setDynamicProperty(KEY, [...done].join(","));
}
export function resetSpeedForce() { world.setDynamicProperty(KEY, ""); }

// ------------------------------------------------------------------ getting in
// called on a jump press: true = we took it (don't also treat it as a flight double-tap)
export function trySpeedForce(p) {
  const r = RT(p);
  if (inSpeedForce(p) || (r.sfCharge ?? 0) < CHARGE_FULL || r.cine) return false;
  if (!((r.spd ?? 0) >= 1.5)) return false;
  enter(p);
  return true;
}
export async function enterSpeedForce(p) { return enter(p); }
async function enter(p) {
  const r = RT(p), h = hero(p);
  r.sfCharge = 0;
  h.sfRet = { dim: p.dimension.id, x: p.location.x, y: p.location.y, z: p.location.z };
  saveNow(p);
  const dim = p.dimension, L = { ...p.location }, f = V.flat(p.getViewDirection());
  for (let i = 0; i < 12; i++) fx(dim, "origin:arc", at(L, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), i % 2 ? GOLD : BLUE, 1);
  fx(dim, "origin:sonic_ring", at(L, f.x * 2, 1, f.z * 2), GOLD, 1, { size: 6 });
  sound(dim, "origin.sfx.lightning", L, 1.4, 1);
  sound(dim, "mob.warden.sonic_boom", L, 1.6, 0.6);
  try { p.camera.fade({ fadeTime: { fadeInTime: 0.15, holdTime: 0.25, fadeOutTime: 0.8 }, fadeColor: { red: 1, green: 0.92, blue: 0.6 } }); } catch { }
  await system.waitTicks(4);
  if (!valid(p)) return;
  try { p.teleport(ARRIVE, { dimension: world.getDimension(SPEED_FORCE), rotation: { x: 0, y: -90 } }); } catch (e) { hudMsg(p, "§7The barrier holds. §8" + e, 40); return; }
  r.sfSince = now(); r.sfIdle = 0; r.sfGateCd = now() + 60;
  try { p.runCommand("fog @s push origin:speed_force origin_sf"); } catch { }
  try { p.onScreenDisplay.setTitle("§e§lTHE SPEED FORCE", { fadeInDuration: 4, stayDuration: 40, fadeOutDuration: 12, subtitle: "§7keep running" }); r.titleUntil = now() + 56; } catch { }
  msg(p, "§e§lTHE SPEED FORCE. §r§7Keep running - it refills you. Run through a §6Time Gate§7 to come out anywhere. Sneak and slow down to drop out. §8Don't stay too long.");
}

// ------------------------------------------------------------------ getting out
async function leave(p, where, why = "") {
  const r = RT(p), h = hero(p);
  removeFlash(p);
  r.sfSince = 0;
  let dest = null, dimId = "minecraft:overworld";
  const ret = h.sfRet ?? { dim: "minecraft:overworld", ...world.getDefaultSpawnLocation() };
  if (where === "home") {
    try { const sp = p.getSpawnPoint?.(); if (sp) { dest = { x: sp.x + 0.5, y: sp.y + 0.1, z: sp.z + 0.5 }; dimId = sp.dimension?.id ?? "minecraft:overworld"; } } catch { }
    if (!dest) { const w = world.getDefaultSpawnLocation(); dest = { x: w.x + 0.5, y: w.y > 300 ? 100 : w.y, z: w.z + 0.5 }; dimId = "minecraft:overworld"; }
  } else if (where === "death" && h.lastDeath) { dest = { x: h.lastDeath.x, y: h.lastDeath.y + 0.5, z: h.lastDeath.z }; dimId = h.lastDeath.dim; }
  else { dest = { x: ret.x, y: ret.y, z: ret.z }; dimId = ret.dim; }
  try { p.camera.fade({ fadeTime: { fadeInTime: 0.1, holdTime: 0.2, fadeOutTime: 0.7 }, fadeColor: { red: 1, green: 0.95, blue: 0.75 } }); } catch { }
  await system.waitTicks(3);
  if (!valid(p)) return;
  const d = world.getDimension(dimId);
  // the ground might not be loaded yet: arrive a little high with slow falling and no fall damage
  try { p.teleport({ x: dest.x, y: dest.y + 0.5, z: dest.z }, { dimension: d }); } catch { try { p.teleport({ x: ret.x, y: ret.y, z: ret.z }, { dimension: world.getDimension(ret.dim) }); } catch { } }
  try { p.runCommand("fog @s remove origin_sf"); } catch { }
  r.flyGrace = now() + 100;
  try { p.addEffect("slow_falling", 40, { showParticles: false }); } catch { }
  if (where === "dawn") { try { world.setTimeOfDay(0); } catch { } }
  if (where === "dusk") { try { world.setTimeOfDay(13000); } catch { } }
  // SPEED FORCE CHARGED
  r.sfChargedUntil = now() + 1200;
  r.fastUntil = now() + 1200;
  try { p.addEffect("speed", 1200, { amplifier: 1, showParticles: false }); p.addEffect("strength", 1200, { amplifier: 0, showParticles: false }); p.addEffect("haste", 1200, { amplifier: 1, showParticles: false }); } catch { }
  system.runTimeout(() => {
    if (!valid(p)) return;
    for (let i = 0; i < 10; i++) fx(p.dimension, "origin:arc", at(p.location, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), i % 2 ? GOLD : BLUE, 1);
    fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.1, 0), GOLD, 1, { radius: 3 });
    sound(p.dimension, "origin.sfx.lightning", p.location, 1.5, 0.8);
    hudMsg(p, (why ? why + " §r§7· " : "") + "§e§lSPEED FORCE CHARGED §r§7- one minute", 80);
  }, 4);
}

// ------------------------------------------------------------------ the Time Gates
async function gateMenu(p) {
  const r = RT(p), h = hero(p);
  r.sfMenu = true;
  const opts = [["back", "Where I came in", "x_up_thrusters"], ["home", "Home (my spawn point)", "x_up_sensors"]];
  if (h.lastDeath) opts.push(["death", "Where I last died", "x_up_plating"]);
  opts.push(["dawn", "Run back to dawn §8(sunrise)", "x_up_reactor"], ["dusk", "Run on to nightfall", "x_up_ordnance"], ["stay", "§7Keep running", "x_upgrade"]);
  const f = oform("menu", "TIME GATE", "§7The lightning opens onto everywhere at once. §fWhere do you come out?");
  for (const [, label, icon] of opts) f.button(label, ICONS + icon);
  const res = await show(p, f);
  r.sfMenu = false;
  r.sfGateCd = now() + 120;
  if (!res || res.canceled || !valid(p) || !inSpeedForce(p)) return;
  const pick = opts[res.selection]?.[0];
  if (!pick || pick === "stay") return;
  leave(p, pick);
}

// ------------------------------------------------------------------ the Black Flash
const flashes = new Map();   // playerId -> {e, speed}
function spawnFlash(p) {
  const d = p.dimension;
  const a = Math.atan2(p.location.z, p.location.x) - 0.45;   // behind you on the ring
  let e = null;
  try { e = d.spawnEntity(BLACK_FLASH, { x: Math.cos(a) * R, y: Y + 1, z: Math.sin(a) * R }); } catch { }
  if (!e) return;
  flashes.set(p.id, { e, speed: 1.15 });
  sound(d, "mob.wither.spawn", p.location, 0.5, 0.6);
  try { p.onScreenDisplay.setTitle("§4§lTHE BLACK FLASH", { fadeInDuration: 2, stayDuration: 30, fadeOutDuration: 10, subtitle: "§7death is running you down - get out" }); RT(p).titleUntil = now() + 44; } catch { }
}
function removeFlash(p) { const f = flashes.get(p.id); if (f) { try { if (valid(f.e)) f.e.remove(); } catch { } flashes.delete(p.id); } }
function tickFlash(p, t) {
  const f = flashes.get(p.id);
  if (!f) return;
  if (!valid(f.e)) { flashes.delete(p.id); return; }
  const to = V.sub(at(p.location, 0, 0, 0), f.e.location), L = V.len(to);
  if (L < 1.6) {
    try { p.applyDamage(10, { cause: EntityDamageCause.magic }); } catch { }
    for (let i = 0; i < 16; i++) fx(p.dimension, "origin:arc", at(p.location, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), RED, 1);
    leave(p, "back", "§4The Black Flash caught you");
    return;
  }
  f.speed = Math.min(2.2, f.speed + 0.0006);
  const step = Math.min(L, f.speed);
  const u = V.mul(to, 1 / L);
  try { f.e.teleport(V.add(f.e.location, V.mul(u, step)), { rotation: { x: 0, y: (Math.atan2(-u.x, u.z) * 180) / Math.PI } }); } catch { }
  if (t % 2 === 0) fx(p.dimension, "origin:streak", at(f.e.location, 0, 1, 0), RED, 0.8, { dx: -u.x, dy: 0, dz: -u.z, len: 1.4, w: 0.12, spd: 0.1, life: 0.25 });
  if (t % 3 === 0) fx(p.dimension, "origin:arc", at(f.e.location, 0, 1 + Math.random(), 0), RED, 1);
  if (t % 20 === 0) { psound(p, "mob.warden.heartbeat", 1.6, Math.min(1, 6 / Math.max(1, L))); hudMsg(p, `§4BLACK FLASH §7- §c${Math.round(L)}m §7behind you`, 22); }
}

// ------------------------------------------------------------------ every 2 ticks
const ARC_COLS = [GOLD, BLUE, WHITE];
export function tickSpeedForce() {
  const t = now();
  let built = false;
  if (t % 200 === 0) {   // a Black Flash nobody is being chased by (left over from a reload) fades away
    const mine = new Set([...flashes.values()].map((f) => f.e?.id));
    try { for (const e of world.getDimension(SPEED_FORCE).getEntities({ type: BLACK_FLASH })) if (!mine.has(e.id)) e.remove(); } catch { }
  }
  for (const p of world.getAllPlayers()) {
    const r = RT(p), h = hero(p);
    if (!inSpeedForce(p)) {
      if (flashes.has(p.id)) removeFlash(p);
      if (r.sfSince) { r.sfSince = 0; try { p.runCommand("fog @s remove origin_sf"); } catch { } }
      // charging: Speedster mode, flat out
      const flatOut = h.power === "super_speed" && r.speedOn && (r.spd ?? 0) >= 1.6 && !r.cine;
      if (flatOut) {
        r.sfCharge = Math.min(CHARGE_FULL, (r.sfCharge ?? 0) + 2);
        if (r.sfCharge < CHARGE_FULL) { if (t % 10 === 0) { const k = Math.round((r.sfCharge / CHARGE_FULL) * 12); hudMsg(p, `§eSPEED FORCE §6${"|".repeat(k)}§8${"|".repeat(12 - k)}`, 14); } }
        else {
          if (t % 10 === 0) hudMsg(p, "§e§lTHE SPEED FORCE IS OPEN §r§7- §fjump§7 to break through", 14);
          if (t % 4 === 0) fx(p.dimension, "origin:arc", at(p.location, (Math.random() - 0.5) * 1.6, 0.5 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6), ARC_COLS[Math.floor(Math.random() * 3)], 1);
        }
      } else if (r.sfCharge) r.sfCharge = Math.max(0, r.sfCharge - 6);
      if ((r.sfChargedUntil ?? 0) > t && t % 6 === 0) fx(p.dimension, "origin:arc", at(p.location, (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2), Math.random() < 0.5 ? GOLD : BLUE, 0.8);
      continue;
    }
    // inside
    if (!r.sfSince) { r.sfSince = t; try { p.runCommand("fog @s push origin:speed_force origin_sf"); } catch { } }
    if (!built) { built = true; tryBuild(p.dimension); }
    const L = p.location, rad = Math.hypot(L.x, L.z);
    // keep them on the ring
    if (L.y < Y - 12 || Math.abs(rad - R) > 14) {
      const a = Math.atan2(L.z, L.x);
      try { p.teleport({ x: Math.cos(a) * R, y: Y + 1.2, z: Math.sin(a) * R }); p.addEffect("slow_falling", 20, { showParticles: false }); } catch { }
    }
    try { const b = p.dimension.getBlock({ x: Math.floor(L.x), y: Y, z: Math.floor(L.z) }); if (b?.isAir && Math.abs(rad - R) <= HALF) { const pm = perm("minecraft:white_concrete"); if (pm) b.setPermutation(pm); } } catch { }
    // the Speed Force runs through you: everything refills while you're inside
    if (t % 20 === 0) {
      h.energy = Math.min(maxEnergy(h), (h.energy ?? 0) + 12);
      h.surge = Math.min(100, (h.surge ?? 0) + 4);
      if (r.stamina !== undefined) r.stamina = Math.min(200, r.stamina + 20);
      try { p.addEffect("regeneration", 40, { amplifier: 1, showParticles: false }); p.addEffect("saturation", 2, { amplifier: 0, showParticles: false }); } catch { }
      markDirty(p);
    }
    if (h.power === "super_speed" && !r.speedOn) r.speedOn = true;
    // the storm
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 9;
      fx(p.dimension, "origin:arc", at(L, Math.cos(a) * d, 1 + (Math.random() - 0.3) * 6, Math.sin(a) * d), ARC_COLS[(t + k) % 3], 1);
    }
    const dir = V.flat(p.getViewDirection());
    if (t % 2 === 0) for (let k = 0; k < 2; k++) fx(p.dimension, "origin:streak", at(L, dir.x * 10 + (Math.random() - 0.5) * 8, 0.5 + Math.random() * 4, dir.z * 10 + (Math.random() - 0.5) * 8), Math.random() < 0.5 ? GOLD : WHITE, 0.7, { dx: -dir.x, dy: 0, dz: -dir.z, len: 3, w: 0.06, spd: 0.6, life: 0.3 });
    if (t % 40 === 0) { try { const e = p.dimension.spawnEntity("origin:afterimage", at(L, dir.x * 14, 0, dir.z * 14)); e.setRotation({ x: 0, y: p.getRotation().y }); system.runTimeout(() => { try { e.remove(); } catch { } }, 30); } catch { } }
    for (const g of GATES) if (Math.hypot(L.x - g.x, L.z - g.z) < 9) fx(p.dimension, "origin:portal_ring", { x: g.x, y: Y + 4.5, z: g.z }, GOLD, 0.9, { size: 4, nx: -Math.sin((g.deg * Math.PI) / 180), nz: Math.cos((g.deg * Math.PI) / 180) });
    if (t % 30 === 0) sound(p.dimension, "origin.sfx.wind", L, 0.9, 0.4);
    // a Time Gate?
    if (!r.sfMenu && (r.sfGateCd ?? 0) < t && GATES.some((g) => Math.hypot(L.x - g.x, L.z - g.z) < 3.5 && L.y < Y + 9)) gateMenu(p);
    // slowing down: sneak (and don't run) for three seconds and it lets you go
    if (p.isSneaking && (r.spd ?? 0) < 0.6) { r.sfIdle = (r.sfIdle ?? 0) + 2; if (r.sfIdle % 20 === 0) hudMsg(p, "§7Slowing down... the world is pulling you back", 20); if (r.sfIdle >= 60) { r.sfIdle = 0; leave(p, "back"); continue; } }
    else r.sfIdle = 0;
    // the Black Flash
    const inside = t - (r.sfSince ?? t);
    if (inside > FLASH_AFTER && !flashes.has(p.id)) spawnFlash(p);
    else if (inside > FLASH_AFTER - 200 && inside % 40 === 0 && !flashes.has(p.id)) hudMsg(p, "§8Something else is running in here...", 40);
    tickFlash(p, t);
  }
}
// remember where a hero last died (a Time Gate can take you back)
export function noteDeath(p) {
  try { const h = hero(p); h.lastDeath = { dim: p.dimension.id, x: p.location.x, y: p.location.y, z: p.location.z }; markDirty(p); } catch { }
}
// stranded inside after a relog / crash: put them back where they went in
export function rescueSpeedForce(p) {
  if (!inSpeedForce(p)) return;
  system.runTimeout(() => valid(p) && leave(p, "back"), 40);
}
export function sfLine(p) {
  const r = RT(p);
  if (!inSpeedForce(p)) return (r.sfChargedUntil ?? 0) > now() ? `§e⚡ SPEED FORCE CHARGED §7${Math.ceil((r.sfChargedUntil - now()) / 20)}s` : null;
  const s = Math.floor((now() - (r.sfSince ?? now())) / 20);
  return `§e⚡ SPEED FORCE §7${s}s${s * 20 > FLASH_AFTER - 400 ? " §4- it's coming" : ""}`;
}
