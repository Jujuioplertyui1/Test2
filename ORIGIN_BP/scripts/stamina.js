// ORIGIN v0.10 - stamina.js
// STAMINA (100): sprinting drains it, dodging costs 25, blocking a hit costs some. It comes back when you ease off.
//   Run dry and you're winded: no sprinting, no dodging, and your guard breaks.
//   Keep sprinting 1.5s and you hit your stride: a SUPER SPRINT (faster, burns more).
// GUARD: crouch to block. Hits from in front of you do 60% less (more with a Shield Emitter).
//   PARRY: start crouching just before the hit lands - it does nothing, the attacker is staggered and you get stamina back.
// SUPER SOLDIER SERUM: a one-time injection, and it hurts. After that, for good:
//   Peak Body: +4 hearts, 150 stamina, faster recovery, sprinting costs less.
//   Combat Read: twice the parry window - and a parry stops time around you for 2 seconds (BULLET TIME).
//   Serum Leap: double-tap jump in the air for a second jump.
//   Iron Constitution: poison, wither, hunger and nausea slide off you; falls hurt half as much.
import { world, system, EntityDamageCause } from "@minecraft/server";
import { hero, RT, markDirty, saveNow, BAR, bar } from "./data.js";
import { V, at, valid, fx, sound, psound, C, now, msg } from "./util.js";
import { hudMsg } from "./voice.js";
import { runCine, EASE } from "./cine.js";

const MAXS = (h) => (h.serum ? 150 : 100);
const st = (p) => { const r = RT(p); if (r.stamina === undefined) r.stamina = MAXS(hero(p)); return r; };

// ------------------------------------------------------------------ stamina (every 2 ticks)
export function tickStamina() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const h = hero(p), r = st(p);
    const max = MAXS(h);
    const sprint = p.isSprinting;
    if (sprint) {
      r.sprintFor = (r.sprintFor ?? 0) + 2;
      r.stamina -= (h.serum ? 0.3 : 0.5) * (r.sprintFor > 30 ? 1.6 : 1);
      r.restAt = t;
      if (r.sprintFor === 30 || r.sprintFor === 31) { fx(p.dimension, "origin:shockwave", at(p.location, 0, 0.05, 0), C.white, 0.6, { radius: 1.2 }); fx(p.dimension, "origin:dust", p.location, C.white, 1); psound(p, "elytra.loop", 1.6, 0.3); }
      if (r.sprintFor > 30) {
        try { p.addEffect("speed", 6, { amplifier: h.serum ? 2 : 1, showParticles: false }); } catch { }
        if (t % 4 === 0) { const v = p.getViewDirection(); fx(p.dimension, "origin:speedline", at(p.location, 0, 1, 0), C.white, 1, { dir_x: v.x, dir_z: v.z }); fx(p.dimension, "origin:dust", p.location, C.white, 0.6); }
      }
    } else {
      r.sprintFor = 0;
      if (t - (r.restAt ?? 0) > 16) r.stamina += (p.isSneaking ? 0.5 : h.serum ? 2 : 1.5);
    }
    if (r.stamina <= 0) {
      r.stamina = 0;
      if (!r.winded) { r.winded = true; hudMsg(p, "§cWINDED §7- catch your breath", 40); psound(p, "game.player.hurt", 0.6, 0.6); }
    }
    if (r.winded) {
      try { p.addEffect("slowness", 6, { amplifier: 1, showParticles: false }); } catch { }
      if (r.stamina >= max * 0.3) r.winded = false;
    }
    r.stamina = Math.min(max, r.stamina);
    // the serum's constitution
    if (h.serum && t % 20 === 0) {
      for (const bad of ["poison", "wither", "hunger", "nausea"]) { try { if (p.getEffect(bad)) p.removeEffect(bad); } catch { } }
      try { p.addEffect("health_boost", 400, { amplifier: 0, showParticles: false }); } catch { }
    }
  }
}
export function staminaLine(p) {
  const h = hero(p), r = st(p), max = MAXS(h);
  if (r.stamina >= max - 0.5 && !r.winded) return null;
  return `${r.winded ? "§c" : "§a"}◆ STAMINA §f${bar(BAR.gold, r.stamina / max, 6)} §7${Math.floor(r.stamina)}`;
}
// combat.js asks before a dodge
export function dodgeGate(p) {
  const r = st(p);
  if (r.winded || r.stamina < 25) { hudMsg(p, "§cToo tired to dodge", 20); return false; }
  r.stamina -= 25;
  r.restAt = now();
  return true;
}

// ------------------------------------------------------------------ guard & parry
export function onSneakDown(p) { st(p).sneakAt = now(); }
// the guard pose rides on a looping animation that only moves the arms while you crouch
export function applyGuardPose(p) {
  try { p.playAnimation("animation.origin.guard", { controller: "origin_guard", stopExpression: "0", blendOutTime: 0.1 }); } catch { }
}
// world.beforeEvents.entityHurt (players): returns true if it handled the hit
export function onGuardBefore(ev) {
  const p = ev.hurtEntity;
  if (!p.isSneaking) return false;
  const cause = String(ev.damageSource?.cause);
  if (cause !== "entityAttack" && cause !== "projectile") return false;
  const src = ev.damageSource.damagingEntity ?? ev.damageSource.damagingProjectile;
  if (!src) return false;
  // only what's in front of you
  const yaw = (p.getRotation().y * Math.PI) / 180;
  const facing = { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  const to = V.flat(V.sub(src.location, p.location));
  if (V.dot(to, facing) < 0.2) return false;
  const h = hero(p), r = st(p), t = now();
  const shield = (h.limbs?.mods ?? []).includes("shield");
  const window = (h.serum ? 12 : 6) + (shield ? 4 : 0);
  if (t - (r.sneakAt ?? -99) <= window) {
    ev.cancel = true;
    const attacker = ev.damageSource.damagingEntity;
    system.run(() => parry(p, attacker));
    return true;
  }
  const cost = Math.max(4, ev.damage * 2);
  if (r.winded || r.stamina < cost) {
    system.run(() => {
      if (!valid(p)) return;
      hudMsg(p, "§c§lGUARD BROKEN", 30);
      try { p.addEffect("slowness", 30, { amplifier: 2, showParticles: false }); } catch { }
      sound(p.dimension, "random.break", p.location, 0.8, 0.7);
    });
    return false;
  }
  r.stamina -= cost;
  r.restAt = t;
  ev.damage = ev.damage * (shield ? 0.2 : 0.4);
  system.run(() => {
    if (!valid(p)) return;
    fx(p.dimension, "origin:spark", at(p.location, facing.x * 0.6, 1.2, facing.z * 0.6), C.white, 1);
    sound(p.dimension, "item.shield.block", p.location, 1, 1);
  });
  return true;
}
function parry(p, attacker) {
  if (!valid(p)) return;
  const h = hero(p), r = st(p);
  r.stamina = Math.min(MAXS(h), r.stamina + 15);
  try { p.playAnimation("animation.origin.parry", { controller: "origin_parry", blendOutTime: 0.1 }); } catch { }
  sound(p.dimension, "random.anvil_land", p.location, 0.7, 1.9);
  sound(p.dimension, "item.shield.block", p.location, 1, 1.5);
  const c = at(p.location, 0, 1.2, 0);
  fx(p.dimension, "origin:shockwave", c, C.white, 1, { radius: 1.5 });
  fx(p.dimension, "origin:flash", c, C.gold, 1, { size: 1.6 });
  for (let i = 0; i < 6; i++) fx(p.dimension, "origin:spark", c, i % 2 ? C.gold : C.white, 1);
  hudMsg(p, h.serum ? "§b§lPARRY · BULLET TIME" : "§f§lPARRY", 30);
  if (valid(attacker)) {
    const d = V.flat(V.sub(attacker.location, p.location));
    try { attacker.applyKnockback({ x: d.x * 1.2, z: d.z * 1.2 }, 0.3); attacker.addEffect("slowness", 30, { amplifier: 3 }); attacker.addEffect("weakness", 40, { amplifier: 1 }); } catch { }
  }
  if (h.serum) bulletTime(p);
}
// the serum's gift: for two seconds, everything around you moves through syrup
function bulletTime(p) {
  let list = [];
  try { list = p.dimension.getEntities({ location: p.location, maxDistance: 9, excludeFamilies: ["inanimate"] }).filter((e) => e.id !== p.id); } catch { }
  for (const e of list) { try { e.addEffect("slowness", 40, { amplifier: 5, showParticles: false }); } catch { } }
  try { p.addEffect("speed", 40, { amplifier: 1, showParticles: false }); p.camera.fade({ fadeTime: { fadeInTime: 0, holdTime: 0.05, fadeOutTime: 0.5 }, fadeColor: { red: 0.7, green: 0.85, blue: 1 } }); } catch { }
  for (let i = 0; i < 10; i++) system.runTimeout(() => valid(p) && fx(p.dimension, "origin:dot", at(p.location, (Math.random() - 0.5) * 6, Math.random() * 2.5, (Math.random() - 0.5) * 6), C.cyan, 0.7), i * 4);
}

// ------------------------------------------------------------------ the serum
export async function injectSerum(p, consume) {
  const h = hero(p);
  if (h.serum) { hudMsg(p, "§7It's already in your blood. A second dose would stop your heart."); return; }
  if (RT(p).cine) return;
  consume();
  await runCine(p, async (c) => {
    const base = { ...p.location }, f = V.flat(p.getViewDirection());
    try { p.addEffect("slowness", 200, { amplifier: 10, showParticles: false }); } catch { }
    c.cam(at(base, f.x * 2 + f.z * 0.8, 1.4, f.z * 2 - f.x * 0.8), at(base, 0, 1.3, 0));
    c.say("§7cold, then burning", 40);
    sound(p.dimension, "random.drink", base, 1, 0.6);
    for (let i = 0; i < 8; i++) {
      psound(p, "mob.warden.heartbeat", 1, 0.8 + i * 0.12);
      if (i % 2) c.fade(0, 0.05, 0.25, { red: 0.5, green: 0, blue: 0 });
      c.shake(0.15 + i * 0.05, 0.4);
      await c.wait(Math.max(4, 12 - i));
    }
    c.say("§c§levery muscle at once", 30);
    for (let k = 0; k < 16; k++) fx(p.dimension, "origin:spark", at(base, (Math.random() - 0.5) * 0.9, 0.3 + Math.random() * 1.5, (Math.random() - 0.5) * 0.9), { red: 0.9, green: 0.12, blue: 0.1 }, 1);
    psound(p, "origin.sfx.heavyhit", 0.6, 1);
    c.fade(0.1, 0.4, 0.6, { red: 1, green: 1, blue: 1 });
    await c.wait(14);
    c.cam(at(base, f.x * 3.2, 0.7, f.z * 3.2), at(base, 0, 1.6, 0), 1.2, EASE.OutCubic);
    sound(p.dimension, "random.totem", base, 0.8, 1.3);
    fx(p.dimension, "origin:shockwave", at(base, 0, 0.05, 0), C.cyan, 1, { radius: 4 });
    await c.wait(30);
  });
  h.serum = { at: Date.now() };
  saveNow(p);
  RT(p).stamina = 150;
  try { p.removeEffect("slowness"); p.addEffect("health_boost", 400, { amplifier: 0, showParticles: false }); p.addEffect("instant_health", 1, { amplifier: 2 }); } catch { }
  try { p.onScreenDisplay.setTitle("§b§lSUPER SOLDIER", { fadeInDuration: 5, stayDuration: 60, fadeOutDuration: 20, subtitle: "§7peak body · combat read · serum leap · iron constitution" }); RT(p).titleUntil = now() + 80; } catch { }
  msg(p, "§b§lTHE SERUM TOOK. §r§7+4 hearts, 150 stamina, double parry window with Bullet Time, a second jump in the air, poison/wither/hunger/nausea don't stick to you any more, peak-human speed, heavier punches (+2 and more knockback), and any serum after this one is an §bAdrenaline Surge§7 (45s, 5-minute recovery).");
}
// double-tap jump in the air (when you can't fly): the Serum Leap
export function canSerumLeap(p) { const h = hero(p); return !!h.serum && !p.isOnGround && !(RT(p).leapUsed); }
export function serumLeap(p) {
  const r = RT(p);
  r.leapUsed = true;
  const f = V.flat(p.getViewDirection());
  try { p.applyKnockback({ x: f.x * 0.8, z: f.z * 0.8 }, 0.75); } catch { }
  fx(p.dimension, "origin:shockwave", p.location, C.white, 0.8, { radius: 1.4 });
  sound(p.dimension, "mob.enderdragon.flap", p.location, 0.6, 1.6);
  system.runTimeout(() => { const wait = () => { if (!valid(p) || p.isOnGround) { r.leapUsed = false; return; } system.runTimeout(wait, 5); }; wait(); }, 5);
}
// serum: falls hurt half as much (beforeEvents)
export function serumFall(ev) {
  const p = ev.hurtEntity;
  if (!hero(p).serum || String(ev.damageSource?.cause) !== "fall") return;
  ev.damage = ev.damage * 0.5;
}
