// ORIGIN v0.21 - regen.js
// REGENERATION, rebuilt.
//  Wounds you can see: a big hit tears you open right where it lands (bone shows through on the worst, beams and fire
//   char it black), and you watch every wound close - fibres knit across it, steam rises, raw pink skin, gone.
//  Beams strip you: stand in one and the side facing it burns down to muscle and bone with flesh flaking away... and
//   the moment it stops, it grows back.  Bullets and arrows push themselves back out.
//  Low on health, your body surges: it heals in steaming bursts.  A lost arm grows back out of the shoulder.
//  Rapid Regeneration (use): watch your body rebuild itself from the bone out - skeleton, sinew, muscle, skin.
//  Once every 3 minutes a killing blow fails: you drop, burned back to the skeleton... and you get up.
import { world, system } from "@minecraft/server";
import { hero, RT, saveNow } from "./data.js";
import { V, at, valid, fx, sound, psound, now, health, C } from "./util.js";
import { hudMsg } from "./voice.js";
import { runCine, EASE } from "./cine.js";
import { regrowLimb } from "./dismember.js";
import { beamedRecently } from "./beams.js";

const BLOOD = { red: 0.55, green: 0.03, blue: 0.03 }, FLESH = { red: 0.85, green: 0.25, blue: 0.27 }, PINK = { red: 1, green: 0.62, blue: 0.6 }, STEAM = { red: 0.95, green: 0.93, blue: 0.93 };
const WOUND = { flesh: "origin:wound_flesh", bone: "origin:wound_bone", char: "origin:wound_char" };
const isRegen = (p) => { const h = hero(p); return h.awakened && h.power === "regeneration"; };
const heal = (p, n) => { try { const hc = p.getComponent("minecraft:health"); hc.setCurrentValue(Math.min(hc.effectiveMax, hc.currentValue + n)); } catch { } };
const shake = (p, a, t) => { try { p.runCommand(`camerashake add @s ${a} ${t} positional`); } catch { } };
export const inRegenScene = (p) => { const r = RT(p); return !!r.regenScene || (r.regenSaving ?? 0) > now(); };   // saving covers the tick before the scene starts

// ------------------------------------------------------------------ wounds on the body
// a wound lives in body space: s = sideways, f = front/back, y = height; it follows you as you move and turn
function basis(p) {
  const yaw = (p.getRotation().y * Math.PI) / 180, f = { x: -Math.sin(yaw), z: Math.cos(yaw) };
  return { f, r: { x: -f.z, z: f.x } };
}
function woundPos(p, w) {
  const { f, r } = basis(p), L = p.location;
  return { x: L.x + r.x * w.s + f.x * w.f, y: L.y + w.y, z: L.z + r.z * w.s + f.z * w.f };
}
function facing(p, from) {   // where on the body a hit from this direction lands
  const { f, r } = basis(p);
  const d = from ? V.flat(V.sub(from, p.location)) : V.flat({ x: Math.random() - 0.5, y: 0, z: Math.random() - 0.5 });
  const nf = d.x * f.x + d.z * f.z, ns = d.x * r.x + d.z * r.z, l = Math.hypot(nf, ns) || 1;
  return { f: (nf / l) * 0.2, s: (ns / l) * 0.3 };
}
function addWound(p, o) {
  const r = RT(p), t = now();
  r.wounds ??= [];
  const near = r.wounds.find((w) => Math.hypot(w.s - o.s, w.f - o.f) < 0.18 && Math.abs(w.y - o.y) < 0.35 && !w.beam);
  if (near) {   // a second hit on an open wound makes it worse
    near.size = Math.min(0.36, near.size + o.size * 0.4);
    if (o.kind === "bone" || (o.kind === "char" && near.kind === "flesh")) near.kind = o.kind;
    near.born = t; near.dur = Math.max(near.dur, o.dur);
    return near;
  }
  if (r.wounds.length >= 5) r.wounds.shift();
  const w = { ...o, born: t };
  r.wounds.push(w);
  return w;
}
// after-hurt: open a wound where the hit landed
export function onRegenHurt(p, amount, src) {
  if (p?.typeId !== "minecraft:player" || !isRegen(p) || inRegenScene(p)) return;
  const cause = String(src?.cause ?? ""), fire = /fire|lava|lightning|magma|campfire/i.test(cause), beamed = beamedRecently(p) || /magic|sonic/i.test(cause);
  if (amount < 3 && !fire) return;
  if (!valid(p)) return;
  const by = src?.damagingEntity, proj = src?.damagingProjectile;
  let from;
  try { from = valid(by) ? by.location : undefined; } catch { }   // whatever hit you may already be gone (a creeper that blew up)
  try { if (valid(proj)) { const v = proj.getVelocity(); from = V.sub(p.location, V.mul(V.norm(v), 3)); } } catch { }
  const fall = /fall/i.test(cause);
  const pos = facing(p, from);
  const y = fall ? 0.25 + Math.random() * 0.35 : fire && !by ? 0.3 + Math.random() * 0.9 : Math.random() < 0.18 ? 1.55 + Math.random() * 0.2 : 0.85 + Math.random() * 0.6;
  const kind = beamed || fire ? "char" : amount >= 10 || (fall && amount >= 8) ? "bone" : "flesh";
  const size = Math.min(0.3, 0.11 + amount * 0.016);
  const r = RT(p);
  const w = addWound(p, { ...pos, y, kind, size, dur: Math.round((30 + amount * 7) * (r.fight ? 1.35 : 1)) });
  const at0 = woundPos(p, w), dim = p.dimension;
  if (amount >= 8) fx(dim, "origin:gibs", at0, FLESH, 1, { n: Math.min(8, Math.round(amount / 3)) });
  if (kind === "char") fx(dim, "origin:boom_smoke", at0, C.grey, 0.6);
  if (proj) system.runTimeout(() => {   // the round works its way back out
    if (!valid(p)) return;
    const q = woundPos(p, w);
    fx(p.dimension, "origin:spark", q, C.white, 1);
    sound(p.dimension, "random.anvil_land", q, 2, 0.2);
    sound(p.dimension, "mob.slime.small", q, 1.6, 0.4);
  }, 22);
  if (amount >= 7 && (r.woundMsgAt ?? 0) < now()) { r.woundMsgAt = now() + 400; hudMsg(p, kind === "char" ? "§cIt burns you down to the muscle... §7and it starts growing back." : kind === "bone" ? "§cIt tears you open to the bone... §7and it starts closing." : "§cIt tears you open... §7and it starts closing.", 50); }
}
function drawWounds(p, r, t) {
  const dim = p.dimension;
  for (let i = r.wounds.length - 1; i >= 0; i--) {
    const w = r.wounds[i], k = (t - w.born) / Math.max(1, w.dur), c = woundPos(p, w);
    if (k >= 1) {
      r.wounds.splice(i, 1);
      fx(dim, "origin:beam_flare", c, PINK, 0.8, { size: 0.28, life: 0.2 });
      fx(dim, "origin:sparkle", c, PINK, 1);
      sound(dim, "mob.slime.small", c, 1.7, 0.25);
      continue;
    }
    if (k < 0.78) fx(dim, WOUND[w.kind] ?? WOUND.flesh, c, C.white, 1, { size: w.size * (1 - 0.5 * (k / 0.78)), life: 0.1, rot: (w.born * 37) % 360 });
    if (k > 0.5) fx(dim, "origin:wound_heal", c, C.white, 1, { size: w.size * Math.min(1, (k - 0.5) * 3) * (1.15 - k * 0.6), life: 0.1, rot: (w.born * 53) % 360 });
    if (k > 0.12 && k < 0.85 && t % 3 === 0) {   // fibres knitting across it
      for (let j = 0; j < 2; j++) {
        const a = Math.random() * Math.PI * 2, rad = w.size * 1.6, o = { x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.8, z: Math.sin(a + 1.3) * rad * 0.5 };
        fx(dim, "origin:streak", V.add(c, o), j ? FLESH : PINK, 0.95, { dx: -o.x, dy: -o.y, dz: -o.z, len: 0.09, w: 0.022, spd: rad * 7.5, life: 0.28 });
      }
    }
    if (k < 0.9 && t % 6 === 0) fx(dim, "origin:steam", c, STEAM, 1, { n: 1 });
    if (k < 0.4 && t % 8 === 0) fx(dim, "origin:blood_drops", c, BLOOD, 1, { n: 2 });
  }
}
// standing in a beam: the side facing it is stripped, and it doesn't start healing until the beam stops
function beamStrip(p, r, t) {
  if (!beamedRecently(p)) { if (r.beamWound) { r.beamWound.beam = false; r.beamWound.born = t; r.beamWound.dur = 70; r.beamWound = null; hudMsg(p, "§7...and it grows back.", 30); } return; }
  const src = r.beamFrom ?? null;
  let w = r.beamWound;
  if (!w || !r.wounds?.includes(w)) {
    w = addWound(p, { ...facing(p, src), y: 1.05 + Math.random() * 0.3, kind: "char", size: 0.16, dur: 70, beam: true });
    w.beam = true; r.beamWound = w; w.burnAt = t;
  }
  w.born = t;   // no healing while it's still burning
  const pos = facing(p, src); w.s = pos.s; w.f = pos.f;
  w.size = Math.min(0.34, w.size + 0.006);
  if (t - w.burnAt > 30) w.kind = "bone";
  const c = woundPos(p, w), away = src ? V.norm(V.sub(p.location, src)) : { x: 0, y: 0, z: 0 };
  if (t % 3 === 0) fx(p.dimension, "origin:gibs", c, FLESH, 1, { n: 1 });
  if (t % 4 === 0) fx(p.dimension, "origin:streak", c, FLESH, 0.9, { dx: away.x, dy: 0.25, dz: away.z, len: 0.12, w: 0.03, spd: 3, life: 0.3 });
  if (t % 5 === 0) fx(p.dimension, "origin:boom_smoke", c, C.grey, 0.45);
}
function regrow(p, side) {   // the arm grows back out of the shoulder
  const dim = p.dimension, sx = side === "r" ? 1 : -1;
  regrowLimb(p, side);
  sound(dim, "mob.slime.big", p.location, 0.7, 0.8);
  let k = 0;
  const id = system.runInterval(() => {
    if (!valid(p) || ++k > 26) { system.clearRun(id); return; }
    const { f, r } = basis(p), L = p.location, drop = 1.45 - Math.min(0.75, k * 0.03);
    const sh = { x: L.x + r.x * 0.36 * sx + f.x * 0.02, y: L.y + drop, z: L.z + r.z * 0.36 * sx + f.z * 0.02 };
    fx(dim, k % 2 ? "origin:wound_flesh" : "origin:wound_heal", sh, C.white, 1, { size: 0.12, life: 0.12 });
    if (k % 2 === 0) fx(dim, "origin:streak", at(sh, (Math.random() - 0.5) * 0.4, 0.25, (Math.random() - 0.5) * 0.4), FLESH, 0.9, { dx: 0, dy: -1, dz: 0, len: 0.1, w: 0.025, spd: 2.5, life: 0.25 });
    if (k % 4 === 0) { fx(dim, "origin:steam", sh, STEAM, 1, { n: 1 }); fx(dim, "origin:blood_drops", sh, BLOOD, 1, { n: 2 }); }
  }, 2);
  hudMsg(p, "§cYour arm grows back.", 40);
}

// ------------------------------------------------------------------ every tick, for regenerating heroes
export function tickRegen(p, h, r, t) {
  if (r.wounds?.length || beamedRecently(p) || r.beamWound) { beamStrip(p, r, t); if (r.wounds?.length) drawWounds(p, r, t); }
  if (t % 10 !== 0 || inRegenScene(p)) return;
  try { p.addEffect("regeneration", 30, { amplifier: r.fight ? 0 : 2, showParticles: false }); } catch { }
  if (t % 40 === 0) { for (const b of ["poison", "wither"]) { try { p.removeEffect(b); } catch { } } }
  const hp = health(p);
  if (hp && hp.cur < hp.max * 0.3 && t % 20 === 0) {   // healing surge
    heal(p, 2);
    fx(p.dimension, "origin:steam", at(p.location, 0, 1.1, 0), STEAM, 1, { n: 4 });
    psound(p, "mob.warden.heartbeat", 1.25, 0.6);
    if ((r.surgeMsg ?? 0) < t) { r.surgeMsg = t + 600; hudMsg(p, "§c§lHEALING SURGE §r§7- your body won't let you die easy", 50); }
  }
  const L = h.limbs;
  if (L && (!L.r || !L.l)) { r.limbGone ??= t; if (t - r.limbGone > 300) { r.limbGone = null; for (const side of ["r", "l"]) if (!L[side]) regrow(p, side); } } else r.limbGone = null;
}

// ------------------------------------------------------------------ the rebuild (Rapid Regeneration + cheating death)
const STAGE_NAME = ["§fbone", "§csinew", "§4muscle", "§dskin", "§dskin", "§fwhole"];
export async function regenScene(p, revive = false) {
  const r = RT(p);
  if (r.cine || r.regenScene) return false;
  r.regenScene = true;
  const dim = p.dimension, base = { ...p.location }, yaw = p.getRotation().y, hp0 = health(p);
  const frac = hp0 ? hp0.cur / hp0.max : 1, start = revive ? 0 : frac < 0.25 ? 0 : frac < 0.6 ? 1 : 2;
  let body = null;
  try {
    body = dim.spawnEntity("origin:regen_body", base);
    body.setProperty("origin:stage", start);
    body.teleport(base, { rotation: { x: 0, y: yaw } });
    body.playAnimation(revive ? "animation.origin.regen.dead" : "animation.origin.regen.kneel");
  } catch { }
  try { p.addEffect("invisibility", 260, { showParticles: false }); } catch { }
  const follow = system.runInterval(() => { if (valid(body) && valid(p)) { try { body.teleport(p.location, { rotation: { x: 0, y: yaw } }); } catch { } } }, 1);
  const fwd = { x: -Math.sin((yaw * Math.PI) / 180), z: Math.cos((yaw * Math.PI) / 180) };
  try {
    await runCine(p, async (c) => {
      const torso = at(base, 0, revive ? 0.35 : 0.85, 0);
      if (revive) {
        c.cam(at(base, fwd.x * 0.6, 3.2, fwd.z * 0.6 + 0.01), at(base, -fwd.x * 0.4, 0.2, -fwd.z * 0.4));
        c.fade(0, 0.2, 0.9, { red: 0, green: 0, blue: 0 });
        c.say("§c...you should be dead.", 40);
        for (let k = 0; k < 6; k++) { fx(dim, "origin:boom_smoke", at(base, (Math.random() - 0.5) * 1.4, 0.2, -fwd.z * 0.5 + (Math.random() - 0.5)), C.grey, 0.6); await c.wait(5); }
        psound(p, "mob.warden.heartbeat", 0.6, 1);
        await c.wait(10);
        psound(p, "mob.warden.heartbeat", 0.7, 1);
        try { body?.playAnimation("animation.origin.regen.revive"); } catch { }
        c.cam(at(base, fwd.x * 2.6 + fwd.z * 1.2, 1.0, fwd.z * 2.6 - fwd.x * 1.2), at(base, 0, 0.7, 0), 1.4, EASE.InOutSine);
        await c.wait(8);
      } else {
        c.cam(at(base, fwd.x * 2.4 + fwd.z * 0.8, 1.1, fwd.z * 2.4 - fwd.x * 0.8), torso);
        c.say("§7let it all come off...", 26);
        await c.wait(8);
      }
      const hp = health(p), max = hp?.max ?? 20;
      for (let st = start; st <= 5; st++) {
        const k0 = (st - start) / Math.max(1, 5 - start);
        try { body?.setProperty("origin:stage", st); } catch { }
        if (st === 5) { try { body?.playAnimation("animation.origin.regen.rise"); } catch { } }
        heal(p, (max * (revive ? 0.9 : 1)) / (6 - start));
        try { p.onScreenDisplay.setTitle(" ", { fadeInDuration: 0, stayDuration: 24, fadeOutDuration: 6, subtitle: `${STAGE_NAME[st]} §8· §7tissue §f${Math.round(((st + 1) / 6) * 100)}%` }); r.titleUntil = now() + 30; } catch { }
        sound(dim, "mob.slime.big", base, 0.55 + st * 0.12, 0.9);
        if (st <= 2) sound(dim, "origin.sfx.bonecrack", base, 0.8 + st * 0.15, 0.8);
        sound(dim, "mob.warden.heartbeat", base, 0.8 + k0 * 0.6, 1);
        for (let j = 0; j < 4; j++) fx(dim, "origin:steam", at(base, (Math.random() - 0.5) * 0.7, 0.4 + Math.random() * 1.3, (Math.random() - 0.5) * 0.7), STEAM, 1, { n: 2 });
        if (st <= 2) fx(dim, "origin:blood_drops", torso, BLOOD, 1, { n: 10 });
        if (st === 2) fx(dim, "origin:gibs", torso, FLESH, 1, { n: 6 });
        const steps = 18;
        for (let s = 0; s < steps; s++) {
          const a = (yaw * Math.PI) / 180 + ((st - start) * steps + s) * 0.07, R0 = 2.6 - k0 * 0.6;
          c.cam(at(base, -Math.sin(a) * R0, 0.75 + k0 * 0.8, Math.cos(a) * R0), at(base, 0, 0.6 + k0 * 0.5, 0), 0.1, EASE.Linear);
          if (s % 2 === 0) {   // fibres pulling in from everywhere
            const u = Math.random() * Math.PI * 2, v = (Math.random() - 0.3) * 1.2, rad = 0.9 + Math.random() * 0.5;
            const o = { x: Math.cos(u) * rad, y: v, z: Math.sin(u) * rad };
            fx(dim, "origin:streak", V.add(torso, o), s % 4 ? FLESH : PINK, 0.95, { dx: -o.x, dy: -o.y, dz: -o.z, len: 0.16, w: 0.03, spd: rad * 7.5, life: 0.3 });
          }
          if (s % 6 === 0) fx(dim, "origin:sparkle", at(base, (Math.random() - 0.5) * 0.7, 0.3 + Math.random() * 1.3, (Math.random() - 0.5) * 0.7), PINK, 1);
          await c.wait(1);
        }
      }
      sound(dim, "random.levelup", base, 1.4, 0.6);
      c.cam(at(base, fwd.x * 3.2, 1.7, fwd.z * 3.2), at(base, 0, 1.4, 0), 0.6, EASE.OutCubic);
      c.shake(0.25, 0.4);
      for (let j = 0; j < 8; j++) fx(dim, "origin:steam", at(base, (Math.random() - 0.5) * 1.2, 0.2 + Math.random() * 1.8, (Math.random() - 0.5) * 1.2), STEAM, 1, { n: 3 });
      await c.wait(14);
      c.fade(0, 0.08, 0.4, { red: 1, green: 0.9, blue: 0.9 });
      await c.wait(4);
    }, { skippable: false });
  } finally {
    system.clearRun(follow);
    try { body?.remove(); } catch { }
    r.regenScene = false;
    if (valid(p)) {
      try { p.removeEffect("invisibility"); for (const b of ["poison", "wither", "weakness", "slowness", "nausea", "blindness", "darkness", "hunger"]) p.removeEffect(b); p.extinguishFire(); } catch { }
      r.bleedUntil = 0; r.wounds = []; r.beamWound = null;
      const L = hero(p).limbs;
      if (L) for (const side of ["r", "l"]) if (!L[side]) regrow(p, side);
      if (revive) hudMsg(p, "§c§lNOT TODAY. §r§7(the next save is ready in 3 minutes)", 60);
    }
  }
  return true;
}
export function rapidRegen(p) { regenScene(p, false); return { cost: 35, cd: 1200 }; }
// last in the before-hurt chain (main.js): only a hit nothing else stopped - parry, guard, a flight landing - can use the save
export function regenFinalSave(ev) {
  const p = ev.hurtEntity;
  if (ev.cancel || p?.typeId !== "minecraft:player") return false;
  const h = hero(p);
  if (!h.awakened || h.power !== "regeneration") return false;
  return regenDeathSave(ev, p, h);
}
// a killing blow on a regenerating hero (once every 3 minutes): true = handled
export function regenDeathSave(ev, p, h) {
  if (inRegenScene(p)) { ev.cancel = true; return true; }
  let hp = 20; try { hp = p.getComponent("minecraft:health").currentValue; } catch { }
  if (ev.damage < hp || (h.regenSaveAt ?? 0) >= Date.now() || RT(p).cine) return false;
  ev.cancel = true;
  RT(p).regenSaving = now() + 4;   // a second blow in the same tick can't finish the job
  h.regenSaveAt = Date.now() + 180000;
  saveNow(p);
  system.run(() => { if (!valid(p)) return; try { p.getComponent("minecraft:health").setCurrentValue(1); } catch { } regenScene(p, true); });
  return true;
}
export function regenLine(p) {
  const h = hero(p), r = RT(p);
  if (r.wounds?.length) {
    const t = now(), k = Math.min(...r.wounds.map((w) => (t - w.born) / Math.max(1, w.dur)));
    return ` §c✚ healing ${Math.round(Math.max(0, k) * 100)}%`;
  }
  return (h.regenSaveAt ?? 0) < Date.now() ? " §c♥ ready" : " §8♥ spent";
}
export function regenFlag(p) { return RT(p).wounds?.some((w) => (now() - w.born) / Math.max(1, w.dur) < 0.35) ? "origin_wound" : ""; }
