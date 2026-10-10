// ORIGIN v0.02 - combat.js
// The "feel" layer: damage numbers, combo counter, hit-stop, and the dodge.
import { system } from "@minecraft/server";
import { hero, RT, markDirty, maxEnergy } from "./data.js";
import { V, at, valid, now, psound, sound, cmd, forwardFromYaw } from "./util.js";
import { dodgeFx } from "./vfx.js";
import { hudMsg, quip } from "./voice.js";

// ------------------------------------------------------------------ floating numbers
const floaters = [];
export function popNumber(dim, loc, text) {
  try {
    const e = dim.spawnEntity("origin:float_text", at(loc, (Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6));
    e.nameTag = text;
    floaters.push({ e, until: now() + 18 });
  } catch { /* chunk edge: skip the number */ }
  if (floaters.length > 40) { const f = floaters.shift(); try { f.e.remove(); } catch { } }
}
// every 2 ticks
export function tickFloaters() {
  const t = now();
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    if (!valid(f.e) || t >= f.until) { try { f.e.remove(); } catch { } floaters.splice(i, 1); continue; }
    try { const l = f.e.location; f.e.teleport({ x: l.x, y: l.y + 0.09, z: l.z }); } catch { }
  }
}

// ------------------------------------------------------------------ combo
export function addCombo(player) {
  const r = RT(player);
  const t = now();
  r.combo = t < (r.comboUntil ?? 0) ? (r.combo ?? 0) + 1 : 1;
  r.comboUntil = t + 50;
  if (r.combo === 5 || r.combo === 10 || r.combo === 20) {
    psound(player, "random.orb", 0.8 + r.combo / 25, 0.6);
    hudMsg(player, `§6§lx${r.combo} COMBO`, 30);
  }
  return r.combo;
}
export function comboOf(player) {
  const r = RT(player);
  return now() < (r.comboUntil ?? 0) ? r.combo ?? 0 : 0;
}

// ------------------------------------------------------------------ hit-stop
export function hitStop(target, player, ticks = 4) {
  try { target.addEffect("slowness", ticks, { amplifier: 10, showParticles: false }); } catch { }
  if (player) cmd(player, "camerashake add @s 0.12 0.15 positional");
}

// ------------------------------------------------------------------ dodge (double-tap sneak)
let threatCheck = () => null;  // set by enemy.js: (player) => brute state info or null
let onDodged = () => { };       // enemy.js learns dodge habits through this
export function setDodgeHooks(check, dodged) { threatCheck = check; onDodged = dodged; }
// extra attackers (villains) register here too: check(player) -> truthy if a hit is about to land
const extraHooks = [];
export function addDodgeHook(check, dodged) { extraHooks.push({ check, dodged }); }
// stamina (or anything else) can veto a dodge
let dodgeGate = null;
export function setDodgeGate(fn) { dodgeGate = fn; }

export function onSneakPress(player) {
  const r = RT(player);
  const t = now();
  const h = hero(player);
  const double = t - (r.lastSneak ?? -99) <= 7;
  r.lastSneak = t;
  if (!double || !h.awakened || r.cine || r.station || r.traveling) return;
  if (t < (r.dodgeCd ?? 0)) return;
  if (dodgeGate && !dodgeGate(player)) return;
  r.dodgeCd = t + 24;
  r.lastSneak = -99;
  const vel = player.getVelocity();
  let d = { x: vel.x, y: 0, z: vel.z };
  if (Math.hypot(d.x, d.z) < 0.04) { const f = forwardFromYaw(player.getRotation().y); d = { x: -f.x, y: 0, z: -f.z }; }
  d = V.flat(d);
  const from = player.location;
  const bruteThreat = threatCheck(player);
  const extra = extraHooks.filter((k) => { try { return !!k.check(player); } catch { return false; } });
  const threat = bruteThreat || extra.length > 0;
  try {
    player.applyKnockback({ x: d.x * 1.9, z: d.z * 1.9 }, 0.2);
    player.addEffect("resistance", 7, { amplifier: 4, showParticles: false });
  } catch { }
  psound(player, "item.trident.riptide_1", 1.8, 0.6);
  system.runTimeout(() => { if (valid(player)) dodgeFx(player.dimension, from, player.location); }, 3);
  if (threat) {
    // Perfect dodge: you moved while a hit was about to land on you.
    psound(player, "random.orb", 0.6, 1);
    sound(player.dimension, "origin.sfx.burst", player.location, 1.8, 0.5);
    hudMsg(player, "§b§lPERFECT DODGE §r§7+15 Energy", 40);
    h.energy = Math.min(maxEnergy(h), h.energy + 15);
    markDirty(player);
    quip(player, "perfect", "Ooh. Do that again.", 2400, false);
  }
  onDodged(player, d, !!bruteThreat);
  for (const k of extra) { try { k.dodged(player, d); } catch { } }
}
