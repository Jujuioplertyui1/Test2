// ORIGIN v0.22 - fall.js
// Falling looks like what it is - it depends on how far you're going to fall, not just how far you've fallen:
//   a little drop (under ~6 blocks)  - nothing special, you just fall
//   a real fall (6-18 blocks)        - arms out, legs kicking: an ordinary fall. You land in a crouch, or roll out of it
//                                      if you were running, or hit hard if it hurt
//   a big fall (18+ blocks)          - the DIVE: head-first, wind roaring past. A few blocks above the ground you flip
//                                      upright and brace, then land like a superhero (if you're a hero who can take
//                                      it) - dust ring, shockwave, a crater from really high - or crash down hard
//   into water                       - you stay in the dive all the way in: splash
//   knocked flying by a huge hit     - you tumble end over end until you land
// Plus the old Exo-Frame helpers: your assistant warns you, and Sky Catch fires the thrusters or flies the suit to you.
import { world, system } from "@minecraft/server";
import { hero, RT } from "./data.js";
import { V, at, valid, fx, sound, psound, C } from "./util.js";
import { isFlying } from "./flight.js";
import { exoData, fullSuit, knows, catchCall, autoThrust, groundBelow } from "./exo.js";
import { aiChatter } from "./say.js";
import { isFlung, crater } from "./impact.js";

const LOOP_STOP = "query.is_on_ground || query.is_in_water";
const HEROIC = ["super_strength", "super_durability", "flight", "graviton", "regeneration", "titan_grip", "super_speed", "stretch"];
const DUST = { red: 0.78, green: 0.72, blue: 0.62 }, WATER = { red: 0.75, green: 0.9, blue: 1 };
function loop(p, f, mode, anim) {
  if (f.mode === mode) return;
  f.mode = mode;
  try { p.playAnimation(anim, { controller: "origin_fall", stopExpression: LOOP_STOP, blendOutTime: 0.2 }); } catch { }
}
function stopAnim(p, f) {
  if (!f.mode) return;
  f.mode = null;
  try { p.playAnimation("animation.origin.fall.end", { controller: "origin_fall", stopExpression: "1", blendOutTime: 0.15 }); } catch { }
}
// landing poses: played once, then let go (land.hero holds its last frame and overrides the walk cycle, so it must be cleared)
const LAND_TICKS = { hero: 28, hard: 26, roll: 12, crouch: 10 };
export function landAnim(p, kind, blend = 0.2) {
  const r = RT(p), tok = (r.landTok = (r.landTok ?? 0) + 1);
  try { p.playAnimation(`animation.origin.land.${kind}`, { controller: "origin_land", stopExpression: "0", blendOutTime: blend }); } catch { }
  system.runTimeout(() => {
    if (!valid(p) || RT(p).landTok !== tok) return;
    try { p.playAnimation("animation.origin.clear", { controller: "origin_land", stopExpression: "1", blendOutTime: 0.25 }); } catch { }
  }, (LAND_TICKS[kind] ?? 20) + 1);
}
// distance to whatever you'll land on (and whether it's water)
function below(p) {
  try {
    const hit = p.dimension.getBlockFromRay(p.location, { x: 0, y: -1, z: 0 }, { maxDistance: 80, includeLiquidBlocks: true, includePassableBlocks: false });
    if (!hit) return { d: 80, water: false };
    return { d: Math.max(0, p.location.y - (hit.block.location.y + (hit.block.isLiquid ? 0.9 : 1))), water: !!hit.block.isLiquid };
  } catch { return { d: 80, water: false }; }
}
// can this fall hurt you? (flight grace, Durability, Graviton, slow falling, creative...)
function safeFall(p, h, r) {
  if ((r.flyGrace ?? 0) > system.currentTick || r.fly) return true;
  try { if (p.getEffect("slow_falling")) return true; } catch { }
  try { const gm = String(p.getGameMode()).toLowerCase(); if (gm === "creative" || gm === "spectator") return true; } catch { }
  return h.awakened && (h.power === "super_durability" || h.power === "stretch");
}
function landed(p, f, h, r) {
  const drop = f.drop, dim = p.dimension, L = p.location;
  if (r.cine || drop < 4) return;
  let water = false;
  try { water = p.isInWater; } catch { }
  if (water) {   // a dive into water: splash
    if (drop < 8) return;
    const n = Math.min(14, 4 + Math.round(drop / 3));
    for (let k = 0; k < n; k++) fx(dim, "origin:dust", at(L, (Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 1.6), WATER, 0.9);
    fx(dim, "origin:ground_ring", at(L, 0, 0.9, 0), WATER, 0.9, { size: 2 + drop / 10 });
    sound(dim, "random.splash", L, drop > 20 ? 0.7 : 0.9, 1);
    return;
  }
  const safe = safeFall(p, h, r), heroic = h.awakened && (safe || HEROIC.includes(h.power) || h.serum);
  let fast = false;
  try { const v = p.getVelocity(); fast = p.isSprinting || Math.hypot(v.x, v.z) > 0.18; } catch { }
  if (drop >= 18 && heroic) {
    landAnim(p, "hero", 0.3);
    fx(dim, "origin:shockwave", at(L, 0, 0.1, 0), C.white, 1, { radius: Math.min(7, 2 + drop / 8) });
    fx(dim, "origin:ground_ring", at(L, 0, 0.08, 0), DUST, 1, { size: Math.min(10, 3 + drop / 6) });
    for (let k = 0; k < 6; k++) fx(dim, "origin:dust", at(L, (Math.random() - 0.5) * 2.4, 0.2, (Math.random() - 0.5) * 2.4), DUST, 0.9);
    sound(dim, "origin.sfx.stonecrash", L, 0.8, 0.9); sound(dim, "random.explode", L, 0.7, 0.4);
    try { p.runCommand(`camerashake add @s ${Math.min(0.6, 0.15 + drop / 80).toFixed(2)} 0.35 positional`); } catch { }
    if (drop >= 32 && (safe || h.power === "super_durability" || h.power === "super_strength")) crater(dim, L, drop >= 60 ? 2 : 1);
  } else if (drop >= 12 && !safe) {
    landAnim(p, "hard", 0.25);
    fx(dim, "origin:dust", L, DUST, 1);
    sound(dim, "damage.fallbig", L, 1, 0.8);
  } else if (drop >= 6) {
    if (fast) landAnim(p, "roll", 0.1);
    else landAnim(p, "crouch", 0.15);
    fx(dim, "origin:dust", L, DUST, 0.6);
  }
}
// every tick
export function tickFall() {
  for (const p of world.getAllPlayers()) {
    if (!valid(p)) continue;
    const r = RT(p), h = hero(p);
    const y = p.location.y;
    const f = (r.fall ??= { top: y, lastY: y, drop: 0, vy: 0, mode: null, said: false, auto: false, ahead: 80, water: false, air: 0 });
    f.vy = y - f.lastY;
    f.lastY = y;
    let calm = true;
    try { calm = p.isOnGround || p.isInWater || p.isGliding || p.isClimbing || isFlying(p) || !!r.skyCatch || !!r.web || !!r.crawl || !!p.getComponent("minecraft:riding"); } catch { }
    if (calm) {
      if (f.air > 2) landed(p, f, h, r);
      f.top = y; f.drop = 0; f.said = false; f.auto = false; f.air = 0;
      stopAnim(p, f);
      continue;
    }
    f.air++;
    if (y > f.top) f.top = y;
    f.drop = f.top - y;
    if (r.cine) { stopAnim(p, f); continue; }
    if (f.air % 3 === 1) { const b = below(p); f.ahead = b.d; f.water = b.water; }
    else f.ahead = Math.max(0, f.ahead + f.vy);   // count the ground down between measurements (fast falls)
    const total = f.drop + f.ahead;
    // pick the pose
    if (isFlung(p) && f.air > 3) loop(p, f, "tumble", "animation.origin.fall.tumble");
    else if (f.vy < -0.3 && total >= 18) {
      if (f.ahead > 4.5 || f.water) loop(p, f, "dive", "animation.origin.fall.dive");
      else loop(p, f, "brace", "animation.origin.fall.brace");   // flip upright just before the ground
    } else if (f.vy < -0.35 && f.drop >= 3.5 && total >= 6) loop(p, f, "drop", "animation.origin.fall.drop");
    if (f.mode === "dive" && f.air % 4 === 0) {   // wind tearing past
      fx(p.dimension, "origin:streak", at(p.location, (Math.random() - 0.5) * 1.2, 1.6 + Math.random(), (Math.random() - 0.5) * 1.2), C.white, 0.35, { dx: 0, dy: 1, dz: 0, len: 0.9, w: 0.03, spd: 0.5, life: 0.25 });
      if (f.air % 20 === 0) psound(p, "origin.sfx.wind", 1.1, 0.5);
    }
    // the Exo-Frame: a warning, then Sky Catch
    if (f.drop < 8 || f.vy > -0.5 || !h.exo) continue;
    const x = exoData(h);
    const wearing = fullSuit(p);
    if (!wearing && !x.stored) continue;
    if (!f.said && f.drop > 11) { f.said = true; aiChatter(p, "fall", wearing ? "Altitude dropping fast, {addr}. Use the Interface and I'll fire the thrusters." : "You're falling, {addr}! Use the Interface - I'll come get you.", 160); }
    if (f.auto || !knows(h, "skycatch") || x.opts?.autoCatch === false) continue;
    const gd = groundBelow(p, 48);
    if (f.drop + gd < 15 || gd > 40) continue;
    f.auto = true;
    if (wearing) autoThrust(p);
    else catchCall(p, true);
  }
}
