// ORIGIN v0.24 - batarang.js
// BATARANGS (original take on the bat-shaped throwing blade).
//  use            throw one: it flies fast and flat, curving onto whoever you were looking at. A hit staggers them and
//                 knocks the weapon out of a mob's hand (DISARMED - a skeleton with no bow can't shoot). A miss
//                 sticks in the wall: walk over and pick it back up.
//  sneak + use    FAN: three at once in a spread (uses three)
//  sprint + use   REMOTE: you steer it with your view for three seconds - round corners, over cover
//  Explosive Batarang: sticks to whatever it hits (people included), blinks, and goes off a second later.
//                 No block damage.
// Crafting: 3 iron ingots + black dye = 6 batarangs · 2 batarangs + TNT + redstone = 2 explosive.
import { world, system, ItemStack, EntityDamageCause, EquipmentSlot } from "@minecraft/server";
import { RT } from "./data.js";
import { V, at, valid, fx, sound, now, C, isSolidBlock, FX_IDS, hexToRgb } from "./util.js";
import { hudMsg } from "./voice.js";

export const BATARANG = "origin:batarang", BAT_BOOM = "origin:explosive_batarang";
const THROWN = "origin:batarang_thrown";
export const isBatarang = (id) => id === BATARANG || id === BAT_BOOM;
const STEEL = hexToRgb("#8a93a3"), RED = hexToRgb("#ff3a2a"), WHITE = { red: 1, green: 1, blue: 1 };
const SKIP = new Set([...FX_IDS, "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", THROWN, "origin:float_text", "origin:exo_piece", "origin:exo_drone"]);
const flying = [];   // {owner, e, pos, dir, speed, kind, guided, t, life, lock, hits:Set, stuck:{e|pos, until}}
const creative = (p) => { try { const m = String(p.getGameMode()).toLowerCase(); return m === "creative"; } catch { return false; } };
const handPos = (p) => { const h = p.getHeadLocation(), d = p.getViewDirection(); return { x: h.x - d.z * 0.38 + d.x * 0.6, y: h.y - 0.35 + d.y * 0.3, z: h.z + d.x * 0.38 + d.z * 0.6 }; };
function creatures(dim, c, r, owner) {
  try { return dim.getEntities({ location: c, maxDistance: r, excludeFamilies: ["inanimate"] }).filter((e) => e.id !== owner?.id && !SKIP.has(e.typeId)); } catch { return []; }
}
function bodyHit(e, pos) {
  try { const l = e.location, top = e.getHeadLocation().y + 0.3; return Math.hypot(l.x - pos.x, l.z - pos.z) < 0.8 && pos.y > l.y - 0.2 && pos.y < top; } catch { return false; }
}
function lookTarget(p, d) { try { return p.getEntitiesFromViewDirection({ maxDistance: d }).map((x) => x.entity).find((e) => !SKIP.has(e.typeId) && e.id !== p.id) ?? null; } catch { return null; } }
function take(p, id, n) {
  if (creative(p)) return true;
  try {
    const c = p.getComponent("minecraft:inventory").container, slot = p.selectedSlotIndex, it = c.getItem(slot);
    if (it?.typeId !== id || it.amount < n) return false;
    if (it.amount > n) { it.amount -= n; c.setItem(slot, it); } else c.setItem(slot, undefined);
    return true;
  } catch { return false; }
}
function held(p) { try { return p.getComponent("minecraft:inventory").container.getItem(p.selectedSlotIndex); } catch { return undefined; } }

export function useBatarang(p, id, sneaking) {
  const r = RT(p), t = now();
  if ((r.batCd ?? 0) > t) return;
  const kind = id === BAT_BOOM ? "boom" : "plain";
  let sprint = false; try { sprint = p.isSprinting; } catch { }
  if (sneaking && kind === "plain") {
    if ((held(p)?.amount ?? 0) < 3 && !creative(p)) { hudMsg(p, "§7A fan needs three batarangs.", 30); return; }
    if (!take(p, id, 3)) return;
    r.batCd = t + 16;
    try { p.playAnimation("animation.origin.batarang.fan", { controller: "origin_gear", blendOutTime: 0.1 }); } catch { }
    const d = V.norm(p.getViewDirection()), right = V.norm({ x: -d.z, y: 0, z: d.x });
    system.runTimeout(() => { if (!valid(p)) return; for (const k of [-1, 0, 1]) launch(p, kind, V.norm(V.add(d, V.mul(right, k * 0.22))), { lock: k === 0 ? lookTarget(p, 32) : null }); }, 3);
    sound(p.dimension, "origin.sfx.swoosh", p.location, 1.5, 1);
    return;
  }
  if (!take(p, id, 1)) return;
  r.batCd = t + (sprint ? 20 : 6);
  try { p.playAnimation("animation.origin.batarang.throw", { controller: "origin_gear", blendOutTime: 0.1 }); } catch { }
  system.runTimeout(() => valid(p) && launch(p, kind, V.norm(p.getViewDirection()), { guided: sprint, lock: sprint ? null : lookTarget(p, 40) }), 2);
  sound(p.dimension, "origin.sfx.swoosh", p.location, 1.7, 0.8);
  if (sprint) hudMsg(p, "§8§lREMOTE §r§7- steer it with your view", 30);
}
function launch(p, kind, dir, { guided = false, lock = null } = {}) {
  const pos = handPos(p);
  let e = null;
  try { e = p.dimension.spawnEntity(THROWN, pos); e.setProperty("origin:kind", kind === "boom" ? 1 : 0); } catch { }
  flying.push({ owner: p, e, dim: p.dimension, pos, dir, speed: guided ? 1.1 : 2.1, kind, guided, t: 0, life: guided ? 60 : 30, lock, hits: new Set() });
}

// every tick
export function tickBatarangs() {
  for (let i = flying.length - 1; i >= 0; i--) {
    const b = flying[i];
    let done = false;
    try { done = step(b); } catch (err) { console.warn("[ORIGIN] batarang: " + err); done = true; }
    if (done) { try { if (valid(b.e)) b.e.remove(); } catch { } flying.splice(i, 1); }
  }
}
function step(b) {
  const dim = b.dim, p = b.owner;
  b.t++;
  if (b.stuck) return tickStuck(b);
  if (b.t > b.life || !valid(p)) { drop(b, b.pos); return true; }
  // steering: the remote follows your view; a locked throw curves onto its target; everything else falls a little
  if (b.guided) { try { b.dir = V.norm(V.lerp(b.dir, p.getViewDirection(), 0.35)); } catch { } if (b.t % 4 === 0) fx(dim, "origin:dot", b.pos, RED, 0.8); }
  else if (b.lock && valid(b.lock)) b.dir = V.norm(V.lerp(b.dir, V.norm(V.sub(at(b.lock.location, 0, 1, 0), b.pos)), 0.22));
  else b.dir = V.norm({ x: b.dir.x, y: b.dir.y - 0.012, z: b.dir.z });
  const n = 3, len = b.speed / n;
  for (let s = 0; s < n; s++) {
    const next = V.add(b.pos, V.mul(b.dir, len));
    const hit = creatures(dim, next, 2.4, p).find((e) => !b.hits.has(e.id) && bodyHit(e, next));
    if (hit) { b.pos = next; return onHit(b, hit); }
    let rh = null;
    try { rh = dim.getBlockFromRay(b.pos, b.dir, { maxDistance: len + 0.2, includePassableBlocks: false, includeLiquidBlocks: false }); } catch { }
    if (rh?.block && isSolidBlock(rh.block)) {
      const L = rh.block.location, pt = { x: L.x + rh.faceLocation.x, y: L.y + rh.faceLocation.y, z: L.z + rh.faceLocation.z };
      b.pos = V.sub(pt, V.mul(b.dir, 0.15));
      return onWall(b);
    }
    b.pos = next;
  }
  try { b.e?.teleport(b.pos, { rotation: { x: 0, y: (Math.atan2(-b.dir.x, b.dir.z) * 180) / Math.PI } }); } catch { }
  if (b.t % 2 === 0) fx(dim, "origin:streak", b.pos, b.kind === "boom" ? RED : STEEL, 0.55, { dx: -b.dir.x, dy: -b.dir.y, dz: -b.dir.z, len: 0.7, w: 0.05, spd: 0.1, life: 0.12 });
  if (b.t % 6 === 0) sound(dim, "origin.sfx.swoosh", b.pos, 2, 0.25);
  return false;
}
function onHit(b, e) {
  const dim = b.dim, p = b.owner;
  b.hits.add(e.id);
  if (b.kind === "boom") { b.stuck = { e, off: V.sub(b.pos, e.location), until: b.t + 22 }; sound(dim, "random.click", b.pos, 1.8, 1); return false; }
  try { e.applyDamage(6, { cause: EntityDamageCause.entityAttack, damagingEntity: p }); } catch { }
  try { e.addEffect("slowness", 25, { amplifier: 3, showParticles: false }); e.addEffect("weakness", 25, { amplifier: 1, showParticles: false }); } catch { }
  try { e.applyKnockback({ x: b.dir.x * 0.4, z: b.dir.z * 0.4 }, 0.15); } catch { }
  fx(dim, "origin:spark", b.pos, WHITE, 1); fx(dim, "origin:impact", b.pos, STEEL, 0.9, { size: 0.6 });
  sound(dim, "item.trident.hit", b.pos, 1.6, 0.8);
  if (e.typeId !== "minecraft:player") disarm(e, b);
  drop(b, at(e.location, 0, 0.5, 0));
  return true;
}
// knock the weapon out of a mob's hand: it lands at their feet
function disarm(e, b) {
  try {
    const eq = e.getComponent("minecraft:equippable");
    const it = eq?.getEquipment(EquipmentSlot.Mainhand);
    if (!it || !/(bow|crossbow|sword|axe|trident|mace)/.test(it.typeId)) return;
    eq.setEquipment(EquipmentSlot.Mainhand, undefined);
    try { b.dim.spawnItem(it, at(e.location, 0, 0.6, 0)); } catch { }
    if (b.owner?.typeId === "minecraft:player") hudMsg(b.owner, "§f§lDISARMED", 16);
  } catch { }
}
function onWall(b) {
  const dim = b.dim;
  if (b.kind === "boom") { b.stuck = { pos: { ...b.pos }, until: b.t + 22 }; sound(dim, "random.click", b.pos, 1.8, 1); return false; }
  fx(dim, "origin:spark", b.pos, WHITE, 1);
  sound(dim, "item.trident.hit_ground", b.pos, 1.5, 0.8);
  drop(b, b.pos);
  return true;
}
function tickStuck(b) {
  const s = b.stuck, dim = b.dim;
  if (s.e) { if (!valid(s.e)) { s.pos = { ...b.pos }; s.e = null; } else b.pos = V.add(s.e.location, s.off); }
  try { b.e?.teleport(b.pos); } catch { }
  if ((s.until - b.t) % 4 === 0) { fx(dim, "origin:flare", b.pos, RED, 1); sound(dim, "random.click", b.pos, 2, 0.6); }
  if (b.t < s.until) return false;
  boom(b);
  return true;
}
function boom(b) {
  const dim = b.dim, c = b.pos, p = b.owner;
  fx(dim, "origin:boom_fire", c, WHITE, 1); fx(dim, "origin:boom_smoke", c, C.grey, 1); fx(dim, "origin:shockwave", c, RED, 1, { radius: 3.5 }); fx(dim, "origin:flash", c, RED, 1, { size: 2.4 });
  sound(dim, "random.explode", c, 1.3, 1);
  for (const e of creatures(dim, c, 3.6, null)) {
    if (valid(p) && e.id === p.id) continue;
    const d = V.dist(e.location, c), k = Math.max(0.3, 1 - d / 3.6), dir = V.flat(V.sub(e.location, c));
    try { e.applyDamage(Math.round(11 * k), { cause: EntityDamageCause.entityExplosion, damagingEntity: valid(p) ? p : undefined }); } catch { }
    try { e.applyKnockback({ x: dir.x * 1.1 * k, z: dir.z * 1.1 * k }, 0.4 * k); } catch { }
  }
  try { for (const q of dim.getPlayers({ location: c, maxDistance: 14 })) q.runCommand("camerashake add @s 0.3 0.25 positional"); } catch { }
}
// a plain batarang that's done flying lands as an item you can pick up
function drop(b, where) {
  if (b.kind !== "plain") return;
  try { b.dim.spawnItem(new ItemStack(BATARANG, 1), where); } catch { }
}
export function batarangHelp(p) { hudMsg(p, "§8Batarang §7- use: throw · sneak + use: fan of three · sprint + use: remote control · Explosive: sticks, then blows", 120); }
