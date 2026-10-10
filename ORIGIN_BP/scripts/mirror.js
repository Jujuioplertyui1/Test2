// ORIGIN v0.13 - mirror.js
// MIRROR HOUR (a Matter power). Once per fight, rewind ONE thing to exactly how it was 60 seconds ago:
//   a creature or a person (position, health, effects - even a lost arm), one wound, or the blocks where you look.
// Everything else stays as it is. The target remembers everything, and whatever it did in that minute still
// happened to everyone else. Rewind something that didn't exist a minute ago and it simply... stops existing.
// The Time Stone uses the same recorder for a short self-rewind.
import { world, system, EntityDamageCause } from "@minecraft/server";
import { hero, RT, markDirty } from "./data.js";
import { V, at, valid, fx, line, sound, psound, now, health, hexToRgb, msg, C, FX_IDS } from "./util.js";
import { hudMsg } from "./voice.js";
import { clockRune } from "./models.js";

const GOLD = hexToRgb("#ffd36a"), PALE = hexToRgb("#cfe6ff");
const WINDOW = 1200, KEEP = 1400;
const NO_TRACK = [...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "origin:float_text", "origin:exo_piece", "origin:exo_drone", "origin:archetype_orb", "origin:manifestation",
  "origin:static_echo", "origin:lumen_construct", "origin:void_stain", "origin:severed_limb", "origin:ink_spike", "origin:ink_hand", "origin:prosthetic", "minecraft:player"];
const BOSSES = new Set(["origin:null", "minecraft:wither", "minecraft:ender_dragon", "minecraft:warden", "minecraft:elder_guardian"]);
const hist = new Map();
const wounds = new Map();
const blockLog = [];
const spawnedAt = new Map();

function rec(e, t) {
  let H = hist.get(e.id);
  if (!H) { H = { e, snaps: [], last: t }; hist.set(e.id, H); }
  H.e = e; H.last = t;
  try {
    const l = e.location, rot = e.getRotation(), hp = health(e);
    const s = { t, dim: e.dimension.id, x: l.x, y: l.y, z: l.z, rx: rot.x, ry: rot.y, hp: hp?.cur ?? null };
    if (e.typeId === "minecraft:player") {
      try { s.fx = e.getEffects().map((f) => [f.typeId, f.amplifier, f.duration]); } catch { }
      s.limbs = { ...(hero(e).limbs ?? { r: 1, l: 1 }) };
    }
    H.snaps.push(s);
  } catch { return; }
  while (H.snaps.length && t - H.snaps[0].t > KEEP) H.snaps.shift();
}
// every 20 ticks
export function tickRecord() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    rec(p, t);
    if (hero(p).power !== "mirror_hour" && !RT(p).timeHolder) continue;
    let list = [];
    try { list = p.dimension.getEntities({ location: p.location, maxDistance: 32, excludeTypes: NO_TRACK }); } catch { }
    for (const e of list.slice(0, 40)) rec(e, t);
  }
  for (const [id, H] of hist) if (t - H.last > 400) hist.delete(id);
  while (blockLog.length && t - blockLog[0].t > KEEP) blockLog.shift();
  if (blockLog.length > 6000) blockLog.splice(0, blockLog.length - 6000);
  for (const [id, w] of wounds) { while (w.length && t - w[0].t > KEEP) w.shift(); if (!w.length) wounds.delete(id); }
  for (const [id, s] of spawnedAt) if (t - s > KEEP) spawnedAt.delete(id);
}
export function onSpawn(ev) {
  const c = String(ev.cause ?? "");
  if (c === "Spawned" || c === "Born" || c === "Event") { try { spawnedAt.set(ev.entity.id, now()); } catch { } }
}
export function logWound(p, amount, src) {
  if (!(amount > 0)) return;
  const l = wounds.get(p.id) ?? [];
  l.push({ t: now(), amount, cause: String(src?.cause ?? ""), by: src?.damagingEntity?.typeId ?? null, healed: false });
  wounds.set(p.id, l);
}
export function logBlock(dim, loc, perm) {
  try { blockLog.push({ t: now(), dim: dim.id, x: loc.x, y: loc.y, z: loc.z, perm: perm ?? null }); } catch { }
}
const at60 = (H, ticks) => { const want = now() - ticks; let s = null; for (const q of H.snaps) if (q.t <= want) s = q; return s ?? H.snaps[0] ?? null; };
function ghost(dim, H, s) {
  const pts = H.snaps.filter((q) => q.t >= s.t && q.dim === dim.id);
  for (let i = pts.length - 1; i > 0; i -= 2) line(dim, "origin:dot", at(pts[i], 0, 1, 0), at(pts[i - 1] ?? pts[i], 0, 1, 0), GOLD, 0.6, 0.6);
}
// v0.22: a clock rune opens on the ground, its hands running backwards (one per spot)
const runes = [];
function clockFx(dim, loc) {
  const t = now();
  for (let i = runes.length - 1; i >= 0; i--) if (t - runes[i].t > 20) runes.splice(i, 1);
  if (!runes.some((q) => q.dim === dim.id && Math.hypot(q.x - loc.x, q.z - loc.z) < 2.5)) {
    runes.push({ t, dim: dim.id, x: loc.x, z: loc.z });
    let y = loc.y;
    try { const hit = dim.getBlockFromRay(at(loc, 0, 0.5, 0), { x: 0, y: -1, z: 0 }, { maxDistance: 6, includePassableBlocks: false }); if (hit) y = hit.block.location.y + 1; } catch { }
    clockRune(dim, { x: loc.x, y, z: loc.z }, 45);
  }
  fx(dim, "origin:rewind", at(loc, 0, 1.1, 0), GOLD, 1);
  fx(dim, "origin:ring", at(loc, 0, 0.1, 0), GOLD, 1, { radius: 1.2 });
  for (let k = 0; k < 6; k++) fx(dim, "origin:sparkle", at(loc, (Math.random() - 0.5) * 1.2, 0.3 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2), PALE, 1);
}

export function rewindEntity(by, e, ticks = WINDOW) {
  if (!valid(e)) return null;
  const sp = spawnedAt.get(e.id);
  if (sp !== undefined && now() - sp < ticks && e.typeId !== "minecraft:player") {
    if (BOSSES.has(e.typeId)) {
      try { e.applyDamage(40, { cause: EntityDamageCause.magic, damagingEntity: by }); } catch { }
      clockFx(e.dimension, e.location);
      return { text: "It fights the rewind - and it hurts" };
    }
    const dim = e.dimension, l = { ...e.location };
    for (let k = 0; k < 3; k++) fx(dim, "origin:dust_away", at(l, 0, 0.4 + k * 0.5, 0), PALE, 1);
    clockFx(dim, l);
    sound(dim, "origin.sfx.lock", l, 0.55, 1);
    try { e.remove(); } catch { }
    return { text: "It didn't exist a minute ago. Now it never did" };
  }
  const H = hist.get(e.id);
  if (!H || !H.snaps.length) return null;
  const s = at60(H, ticks);
  if (!s) return null;
  const dim = e.dimension;
  ghost(dim, H, s);
  clockFx(dim, e.location);
  try { e.teleport({ x: s.x, y: s.y, z: s.z }, { dimension: world.getDimension(s.dim), rotation: { x: s.rx, y: s.ry } }); } catch { }
  if (s.hp !== null) { try { const hc = e.getComponent("minecraft:health"); hc.setCurrentValue(Math.max(1, Math.min(hc.effectiveMax, s.hp))); } catch { } }
  if (e.typeId === "minecraft:player") {
    try { for (const f of e.getEffects()) e.removeEffect(f.typeId); } catch { }
    for (const [id, amp, dur] of s.fx ?? []) { try { e.addEffect(id, Math.max(1, dur), { amplifier: amp, showParticles: false }); } catch { } }
    const L = hero(e).limbs;
    if (L && s.limbs) for (const side of ["r", "l"]) if (s.limbs[side] && !L[side]) import("./dismember.js").then((m) => m.rewindLimb?.(e, side)).catch(() => { });
    RT(e).bleedUntil = 0;
    if (e.id !== by?.id) msg(e, "§6Mirror Hour:§7 you were wound back one minute. §fYou remember everything.");
  }
  system.run(() => valid(e) && clockFx(e.dimension, e.location));
  sound(dim, "origin.sfx.lock", e.location, 0.6, 1);
  return { text: `Wound back ${Math.round((now() - s.t) / 20)} seconds` };
}
export function rewindWound(p) {
  const list = (wounds.get(p.id) ?? []).filter((w) => !w.healed && now() - w.t <= WINDOW);
  const H = hist.get(p.id), s = H ? at60(H, WINDOW) : null, L = hero(p).limbs;
  const lostArm = L && s?.limbs && ((s.limbs.r && !L.r) || (s.limbs.l && !L.l));
  if (!list.length && !lostArm) return null;
  let text = "";
  if (list.length) {
    const w = list.reduce((a, b) => (b.amount > a.amount ? b : a));
    w.healed = true;
    try { const hc = p.getComponent("minecraft:health"); hc.setCurrentValue(Math.min(hc.effectiveMax, hc.currentValue + w.amount)); } catch { }
    text = `A ${Math.round(w.amount)}-damage wound${w.by ? ` from ${w.by.split(":")[1].replace(/_/g, " ")}` : ""} never happened`;
  }
  if (lostArm) { for (const side of ["r", "l"]) if (s.limbs[side] && !L[side]) import("./dismember.js").then((m) => m.rewindLimb?.(p, side)).catch(() => { }); text += (text ? ". " : "") + "Your arm is back where it was"; }
  RT(p).bleedUntil = 0;
  clockFx(p.dimension, p.location);
  return { text };
}
export function rewindBlocks(by, center, radius = 3) {
  const dim = by.dimension, want = now() - WINDOW;
  const first = new Map();
  for (const b of blockLog) {
    if (b.t < want || b.dim !== dim.id) continue;
    if (Math.abs(b.x - center.x) > radius || Math.abs(b.y - center.y) > radius || Math.abs(b.z - center.z) > radius) continue;
    const k = `${b.x},${b.y},${b.z}`;
    if (!first.has(k)) first.set(k, b);
  }
  let n = 0;
  for (const b of first.values()) {
    try {
      const bl = dim.getBlock({ x: b.x, y: b.y, z: b.z });
      if (!bl) continue;
      if (b.perm) bl.setPermutation(b.perm); else bl.setType("minecraft:air");
      fx(dim, "origin:sparkle", { x: b.x + 0.5, y: b.y + 0.5, z: b.z + 0.5 }, GOLD, 1);
      n++;
    } catch { }
  }
  for (let i = blockLog.length - 1; i >= 0; i--) { const b = blockLog[i]; if (b.dim === dim.id && first.has(`${b.x},${b.y},${b.z}`)) blockLog.splice(i, 1); }
  if (n) clockFx(dim, center);
  return n;
}
// Time Stone: snap yourself back a few seconds (position + health), no once-per-fight limit
export function rewindSelfSeconds(p, secs) {
  const H = hist.get(p.id);
  if (!H?.snaps.length) return false;
  const r = rewindEntity(p, p, secs * 20);
  return !!r;
}
function lookEntity(p, d) { try { return p.getEntitiesFromViewDirection({ maxDistance: d }).map((h) => h.entity).find((e) => valid(e) && e.id !== p.id && !NO_TRACK.slice(0, -1).includes(e.typeId)) ?? null; } catch { return null; } }
function lookBlock(p, d) { try { const h = p.getBlockFromViewDirection({ maxDistance: d }); return h ? h.block.location : null; } catch { return null; } }
export const mirrorReady = (p) => !RT(p).mirrorSpent;
export function useMirror(p, mode = "auto") {
  const r = RT(p);
  if (r.mirrorSpent) { hudMsg(p, "§6Mirror Hour is spent. §7It comes back when this fight is over.", 50); psound(p, "random.fizz", 1.3, 0.4); return false; }
  let done = null, what = "";
  if (mode === "auto" || mode === "target") {
    const e = lookEntity(p, 24);
    if (e) { done = rewindEntity(p, e); what = e.typeId === "minecraft:player" ? e.name : (e.nameTag?.split("\n")[0] || e.typeId.split(":")[1].replace(/_/g, " ")); }
    else if (mode === "target") { hudMsg(p, "§7Look at whoever you want to rewind.", 40); return false; }
  }
  if (!done && (mode === "auto" || mode === "blocks")) {
    const b = lookBlock(p, 24);
    const n = b ? rewindBlocks(p, b, 3) : 0;
    if (n) { done = { text: `${n} block${n > 1 ? "s" : ""} back the way they were` }; what = "the world"; }
    else if (mode === "blocks") { hudMsg(p, "§7Nothing there has changed in the last minute.", 40); return false; }
  }
  if (!done && (mode === "auto" || mode === "wound")) {
    done = rewindWound(p); what = "your wound";
    if (!done && mode === "wound") { hudMsg(p, "§7You haven't been hurt in the last minute.", 40); return false; }
  }
  if (!done && mode === "self") { done = rewindEntity(p, p); what = "you"; }
  if (!done) { hudMsg(p, "§7There's nothing to rewind. §8(Look at something, or get hurt first.)", 50); return false; }
  r.mirrorSpent = true;
  r.mirrorAt = now();
  try { p.camera.fade({ fadeTime: { fadeInTime: 0.05, holdTime: 0.1, fadeOutTime: 0.6 }, fadeColor: { red: 0.55, green: 0.42, blue: 0.2 } }); } catch { }
  psound(p, "origin.sfx.lock", 0.7, 1);
  psound(p, "origin.sfx.highpitch", 0.5, 0.3);
  try { p.onScreenDisplay.setTitle("§6§lMIRROR HOUR", { fadeInDuration: 2, stayDuration: 34, fadeOutDuration: 10, subtitle: `§7${what}: §f${done.text}` }); r.titleUntil = now() + 48; } catch { }
  return true;
}
// every 20 ticks: Mirror Hour comes back once the fight is over
export function tickMirror() {
  for (const p of world.getAllPlayers()) {
    const r = RT(p);
    if (r.mirrorSpent && !r.fight && now() - (r.mirrorAt ?? 0) > 200) { r.mirrorSpent = false; if (hero(p).power === "mirror_hour") hudMsg(p, "§6Mirror Hour is ready again.", 40); }
  }
}
