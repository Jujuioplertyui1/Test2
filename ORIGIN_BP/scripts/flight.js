// ORIGIN v0.23 - flight.js
// Real flight (Flight power, Exo-Frame thrusters, the Lumen Signet, Mjolnir). Runs every tick:
//  - you fly where you LOOK when you push forward; strafe sideways; jump climbs, sneak dives
//  - momentum: you accelerate, drift and bank instead of snapping around
//  - sprint (or double-tap forward) = BOOST: faster, sonic ring, wind
//  - let go of the stick = HOVER in place (gentle bob), not falling
//  - your body poses like a flyer (horizontal at speed, upright when hovering) via player animations
//  - landing is free: no fall damage for a few seconds after flight
// Mobile: double-tap JUMP in the air to take off / land.
import { world, system, InputButton, ButtonState } from "@minecraft/server";
import { RT } from "./data.js";
import { V, at, fx, sound, psound, C, now, rightOf, valid } from "./util.js";

const CFG = {
  power: { cruise: 0.85, boost: 1.55, accel: 0.16, climb: 0.55, trail: "origin:trail", col: { red: 1, green: 0.83, blue: 0.42 } },
  exo: { cruise: 1.0, boost: 1.9, accel: 0.2, climb: 0.65, trail: "origin:spark", col: { red: 0.35, green: 0.95, blue: 1 } },
  lumen: { cruise: 0.95, boost: 1.7, accel: 0.18, climb: 0.6, trail: "origin:missile_glow", col: { red: 0.5, green: 1, blue: 0.87 } },
  mjolnir: { cruise: 1.05, boost: 2.05, accel: 0.21, climb: 0.66, trail: "origin:spark", col: { red: 0.55, green: 0.8, blue: 1 } },
};
const POSES = { power: ["animation.origin.fly.pose", "animation.origin.fly.hover"], exo: ["animation.origin.fly.exo", "animation.origin.fly.exo_hover"], lumen: ["animation.origin.fly.pose", "animation.origin.fly.hover"], mjolnir: ["animation.origin.fly.mjolnir", "animation.origin.fly.hover"] };
const END = "animation.origin.fly.end";

export const isFlying = (p) => !!RT(p).fly;
function anim(p, name, stop = "0") {
  try { p.playAnimation(name, { controller: "origin_fly", stopExpression: stop, blendOutTime: 0.25 }); } catch { }
}
// opts: { kind: "power"|"exo", maxTicks, onTick(p, t, boosting) -> false to stop, onEnd(p, why) }
export function startFlight(p, opts) {
  try { if ((RT(p).groundedUntil ?? 0) > now()) return false; } catch { }
  const r = RT(p);
  if (r.fly) return false;
  r.fly = { kind: opts.kind ?? "power", start: now(), max: opts.maxTicks ?? 400, onTick: opts.onTick, onEnd: opts.onEnd, pose: null, boostAt: -99, v: { x: 0, y: 0.5, z: 0 }, lastFwd: 0, tapFwd: -99, mult: opts.mult ?? 1, col: opts.col ?? null };
  const c = CFG[r.fly.kind] ?? CFG.power;
  const col0 = opts.col ?? c.col;
  try { p.playAnimation("animation.origin.fall.end", { controller: "origin_fall", stopExpression: "1", blendOutTime: 0.1 }); } catch { }
  sound(p.dimension, "origin.sfx.windblast", p.location, 1, 0.6);
  // take-off burst
  try { p.applyKnockback({ x: 0, z: 0 }, 0.9); } catch { }
  fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.05, 0), col0, 1, { radius: 2.4 });
  fx(p.dimension, "origin:burst", at(p.location, 0, 0.2, 0), col0, 1);
  fx(p.dimension, "origin:dust", p.location, C.white, 1);
  sound(p.dimension, "mob.enderdragon.flap", p.location, 0.9, 1.1);
  psound(p, "elytra.loop", 1.3, 0.35);
  try { p.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0, fadeOutTime: 0.25 }, fadeColor: { red: 1, green: 1, blue: 1 } }); } catch { }
  return true;
}
export function stopFlight(p, why = "land") {
  const r = RT(p);
  const f = r.fly;
  if (!f) return;
  r.fly = null;
  r.flyGrace = now() + 120;           // no fall damage for 6s
  anim(p, END, "1");
  try { p.addEffect("slow_falling", why === "land" ? 30 : 80, { showParticles: false }); } catch { }
  sound(p.dimension, "mob.enderdragon.flap", p.location, 0.6, 0.8);
  fx(p.dimension, "origin:dust", p.location, C.white, 1);
  try { f.onEnd?.(p, why); } catch { }
}
// a power can take the stick for a moment (a Sonic Ram, a dive): hold this velocity for `ticks`, optionally in a pose
export function flightOverride(p, v, ticks, pose) {
  const f = RT(p).fly;
  if (!f) return false;
  f.force = { v, until: now() + ticks };
  if (pose) { f.poseLock = now() + ticks; f.pose = "lock"; anim(p, pose); }
  return true;
}
// world.beforeEvents.entityHurt: flyers don't take fall damage when they land
export function cancelsFall(p, cause) {
  if (cause !== "fall") return false;
  const r = RT(p);
  return !!r.fly || (r.flyGrace ?? 0) > now();
}

// double-tap jump in the air = toggle (call from playerButtonInput)
export function onJumpPress(p, canFly, begin) {
  const r = RT(p);
  const t = now();
  const dbl = t - (r.jumpTap ?? -99) <= 7;
  r.jumpTap = t;
  if (!dbl) return;
  r.jumpTap = -99;
  if (r.fly) { stopFlight(p, "land"); return; }
  if (!canFly(p)) return;
  if (p.isOnGround) return;           // first tap jumps, second (in the air) takes off
  begin(p);
}

export function tickFlight() {
  for (const p of world.getAllPlayers()) {
    const r = RT(p);
    const f = r.fly;
    if (!f) continue;
    if (!valid(p) || r.cine || r.station) { stopFlight(p, "interrupt"); continue; }
    const t = now();
    const age = t - f.start;
    const c = CFG[f.kind];
    let mv = { x: 0, y: 0 }, jump = false;
    try {
      mv = p.inputInfo.getMovementVector();
      jump = p.inputInfo.getButtonState(InputButton.Jump) === ButtonState.Pressed;
    } catch { }
    // double-tap forward also boosts (mobile has no sprint key in some layouts)
    if (mv.y > 0.5 && f.lastFwd <= 0.5) { if (t - f.tapFwd < 8) f.boostAt = t; f.tapFwd = t; }
    f.lastFwd = mv.y;
    const boosting = mv.y > 0.5 && (p.isSprinting || t - f.boostAt < 60 || f.boostHeld);
    if (boosting && t - f.boostAt >= 60) f.boostAt = t;
    if (f.onTick && f.onTick(p, age, boosting) === false) { stopFlight(p, "tired"); continue; }
    if (age >= f.max) { stopFlight(p, "tired"); continue; }
    if (age > 10 && p.isOnGround && mv.y <= 0.1 && !jump && f.v.y <= 0.05) { stopFlight(p, "land"); continue; }

    const look = p.getViewDirection();
    const left = (() => { const rt = rightOf(V.flat(look)); return { x: -rt.x, y: 0, z: -rt.z }; })();
    const speed = (boosting ? c.boost : c.cruise) * (f.mult ?? 1);
    let want = V.add(V.mul(look, mv.y * speed), V.mul(left, mv.x * speed * 0.6));
    want.y += (jump ? c.climb : 0) + (p.isSneaking ? -c.climb : 0);
    const idle = Math.abs(mv.y) < 0.1 && Math.abs(mv.x) < 0.1 && !jump && !p.isSneaking;
    if (idle) want = { x: 0, y: Math.sin(age / 9) * 0.02, z: 0 };     // hover
    const forced = f.force && f.force.until > t;
    if (forced) want = f.force.v; else f.force = null;
    // momentum: ease from what we're doing to what we want
    // momentum lives in OUR state: the server's copy of a player's velocity lags and reads as falling,
    // which made flight sink faster and faster
    const k = forced ? 0.55 : idle ? 0.22 : c.accel * (boosting ? 1.3 : 1);
    const nv = V.lerp(f.v, want, k);
    nv.y = Math.max(forced ? -2.4 : -1.2, Math.min(forced ? 2 : 1.2, nv.y));
    f.v = nv;
    try { p.applyKnockback({ x: nv.x, z: nv.z }, nv.y + 0.08); } catch { }   // +0.08 = one tick of gravity

    // pose
    const spd = Math.hypot(nv.x, nv.y, nv.z);
    const pose = spd > 0.35 ? "fly" : "hover";
    if ((f.poseLock ?? 0) > t) { /* a power is holding a pose */ }
    else if (pose !== f.pose || age % 100 === 0) { f.pose = pose; anim(p, POSES[f.kind][pose === "fly" ? 0 : 1]); }
    // visuals
    if (t % 2 === 0) fx(p.dimension, c.trail, at(p.location, -nv.x * 0.6, 0.15, -nv.z * 0.6), f.col ?? c.col, 0.8);
    if (boosting && t % 2 === 0) fx(p.dimension, "origin:speedline", p.getHeadLocation(), C.white, 1, { dir_x: look.x, dir_z: look.z });
    if (boosting && t % 3 === 0) {
      fx(p.dimension, "origin:dot", at(p.getHeadLocation(), look.x * 2.5 + (Math.random() - 0.5) * 1.6, look.y * 2.5 + (Math.random() - 0.5) * 1.2, look.z * 2.5 + (Math.random() - 0.5) * 1.6), C.white, 0.7);
    }
    if (boosting && t - f.boostAt === 0) {
      fx(p.dimension, "origin:shockwave", p.location, C.white, 1, { radius: 2 });
      sound(p.dimension, "mob.warden.sonic_boom", p.location, 0.25, 1.8);
      try { p.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0, fadeOutTime: 0.15 }, fadeColor: { red: 0.9, green: 0.95, blue: 1 } }); } catch { }
    }
    if (age % 40 === 0) psound(p, "elytra.loop", boosting ? 1.4 : 1, boosting ? 0.5 : 0.25);
  }
}
