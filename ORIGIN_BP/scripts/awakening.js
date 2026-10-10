// ORIGIN v0.02 - awakening.js
// One cinematic: the quiet breaks -> you fall into the dark -> three orbs -> you choose ->
// your Manifestation speaks -> your Inner World forms around you.
import { world, system } from "@minecraft/server";
import { HALL_MARKS, HALL_R, slotCenter, hallCenter } from "./plan.js";
import { hero, RT, saveNow, markDirty, ARCH, ARCH_KEYS, DEFAULT_MOVES } from "./data.js";
import { V, at, valid, cmd, overworld, fx, line, sound, psound, C, now, msg, locOf, forwardFromYaw, rightOf } from "./util.js";
import { Cine, SKIP, ABORT, EASE, unlockPlayer } from "./cine.js";
import { oform, show, ICONS } from "./forms.js";
import { hudMsg, quip } from "./voice.js";
import { LINES } from "./manifestation.js";
import {
  inIW, inHall, ensureHall, clearHallEntities, spawnOrbs, orbLoc, archOfOrb, buildIW, isBuilt,
  holdWhile, arrivalLoc, anchorFace, ensureManifestation, wake, updateFog, iwDim, loadArea, unloadArea,
  spawnRetry, slotOf,
} from "./innerworld.js";
import { giveKit, giveItem, removeOne, ITEMS } from "./kit.js";
import { rollPower, POWERS } from "./powers.js";
import { flashBeam, tinted } from "./beams.js";

const WHITE = { red: 1, green: 1, blue: 1 };
const BLACK = { red: 0, green: 0, blue: 0 };

export function isAwakening(player) {
  return !!RT(player).cine;
}

export async function startAwakening(player, { quick = false } = {}) {
  const r = RT(player);
  if (r.cine || r.traveling) { hudMsg(player, "§7Not now."); return; }
  if (quick) return quickAwaken(player);

  const h = hero(player);
  if (!inIW(player) && !inHall(player)) { h.ret = locOf(player); markDirty(player); }
  const c = new Cine(player);
  c.slot = slotOf(player);          // your own hall: nobody else's awakening can touch your orbs
  c.H = hallCenter(c.slot);
  let finished = false;
  try {
    c.lock();
    // 1) THE QUIET BREAKS (overworld, skippable)
    c.setSkippable(true);
    try { await phaseTrigger(c); } catch (e) { if (e !== SKIP) throw e; c.fade(0.15, 1.5, 0.6, WHITE); await system.waitTicks(4); }
    c.setSkippable(false);
    // 2) THE FALL (black, hall builds unseen)
    await phaseFall(c);
    // 3) THREE ORBS (skippable)
    c.setSkippable(true);
    try { await phaseReveal(c); } catch (e) { if (e !== SKIP) throw e; }
    c.setSkippable(false);
    // 4) CHOOSE
    const arch = await phasePick(c);
    // 5) SOMETHING ANSWERS
    await phaseManifest(c, arch);
    // 6) FIRST BREATH
    await phaseFirstBreath(c, arch);
    finalize(player, arch);
    finished = true;
  } catch (e) {
    if (e !== ABORT) console.warn("[ORIGIN] awakening error: " + e + (e?.stack ? "\n" + e.stack : ""));
  } finally {
    const p = c.p;
    c.end();
    // even if they left mid-awakening: free this hall's orbs and ticking areas (other players' halls are untouched)
    if (!finished) clearHallEntities(c.slot);
    unloadArea(`origin_hall_${c.slot}`);
    unloadArea(`origin_arrive_${c.slot}`);
    if (valid(p)) {
      cmd(p, "fog @s remove origin_wake");
      try { p.removeEffect("darkness"); } catch { }
      if (!finished) {
        if (inHall(p) || inIW(p)) system.run(() => wake(p));
        msg(p, "§7The vision slips away. §8(Use the Humming Shard or /hero awaken to try again.)");
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
async function phaseTrigger(c) {
  const p = c.p;
  const dim = p.dimension;
  const base = p.location;
  const head = p.getHeadLocation();
  const f = forwardFromYaw(p.getRotation().y);
  const rt = rightOf(f);
  const A = { x: base.x - f.x * 5 + rt.x * 3, y: base.y + 2.6, z: base.z - f.z * 5 + rt.z * 3 };
  const B = { x: base.x + f.x * 3.6 + rt.x * 2.4, y: base.y + 1.4, z: base.z + f.z * 3.6 + rt.z * 2.4 };
  const CL = { x: base.x + f.x * 1.4, y: head.y, z: base.z + f.z * 1.4 };

  sound(dim, "origin.sfx.double", base, 0.8, 1);
  try { p.addEffect("darkness", 100, { showParticles: false }); } catch { }
  c.cam(A, head);
  await system.waitTicks(1);
  c.cam(B, head, 3.0, EASE.InOutSine);
  c.say("§7Something is wrong with the quiet.", 50);
  for (let t = 0; t < 60; t += 6) {
    fx(dim, "origin:rise", base, t % 12 ? C.white : C.crimson, 0.9);
    if (t === 30) { c.shake(0.15, 0.8); sound(dim, "origin.sfx.hum", base, 0.6, 0.8); }
    await c.wait(6);
  }
  c.say("§fThen it breaks.", 30);
  c.cam(CL, head, 1.0, EASE.InExpo);
  await c.wait(18);
  sound(dim, "origin.sfx.burst", base, 0.7, 1);
  fx(dim, "origin:burst", head, C.white, 1);
  c.shake(0.5, 0.4);
  c.fade(0.3, 2.0, 0.8, WHITE);
  await c.wait(8);
}

async function phaseFall(c) {
  const p = c.p, H = c.H;
  const dim = iwDim();
  c.fade(0.5, 30, 1.0, BLACK);
  c.say("§8...falling...", 60);
  // load the hall's chunks BEFORE anything is placed or spawned there (fixes "not loaded and ticking")
  await Promise.all([c.wait(10), loadArea(`origin_hall_${c.slot}`, H, HALL_R + 2)]);
  c.check();
  const start = at(H, HALL_MARKS.start.x, HALL_MARKS.start.y, HALL_MARKS.start.z);
  const face = at(H, 0.5, 1.8, -4);
  try { p.removeEffect("darkness"); } catch { }
  try { p.camera.clear(); } catch { }   // the free camera is still parked in the overworld: drop it before changing dimension
  p.teleport(start, { dimension: dim, facingLocation: face });
  cmd(p, "fog @s push origin:awaken_void origin_wake");
  psound(p, "mob.warden.heartbeat", 0.8, 1);
  await holdWhile(p, start, ensureHall(c.slot), face);
  c.check();
  clearHallEntities(c.slot);
  await holdWhile(p, start, spawnOrbs(c.slot, p.id), face);
  c.check();
  psound(p, "mob.warden.heartbeat", 0.8, 1);
  await c.wait(20);
}

async function phaseReveal(c) {
  const p = c.p, H = c.H;
  const ow = iwDim();
  c.cam(at(H, 6, 9, 9), at(H, 0.5, 1.5, -3));
  await system.waitTicks(1);
  c.fade(0, 0.3, 1.6, BLACK);
  c.cam(at(H, -6, 4.5, 4), at(H, 0.5, 2, -4.5), 3.0, EASE.InOutSine);
  c.say("§7Three lights in the dark.", 50);
  await c.wait(62);
  for (let i = 0; i < 3; i++) {
    const key = ARCH_KEYS[i];
    const A = ARCH[key];
    const o = at(orbLoc(i, c.slot), 0, 0.5, 0);
    c.cam(at(o, (i - 1) * 0.9, 0.5, 2.8), o, 1.1, EASE.OutQuad);
    await c.wait(14);
    sound(ow, "origin.sfx.hum", o, [0.9, 1.3, 0.6][i], 1);
    fx(ow, "origin:burst", o, A.rgb, 0.9);
    c.say(`§7${A.tagline}`, 40, `${A.col}§l${A.name.toUpperCase()}`);
    await c.wait(42);
  }
  const start = at(H, HALL_MARKS.start.x, HALL_MARKS.start.y, HALL_MARKS.start.z);
  c.cam(at(start, 0, 2.2, 3.2), at(H, 0.5, 2, -4), 1.5, EASE.InOutSine);
  await c.wait(30);
}

async function phasePick(c) {
  const p = c.p, H = c.H;
  const ow = iwDim();
  c.clearCam();
  c.unlock();
  c.say("§7Touch one. §fChoose.", 80);
  hudMsg(p, "§fWalk to an orb and §einteract§f with it (tap / right-click).", 400);
  c.awaitingPick = true;
  const start = at(H, HALL_MARKS.start.x, HALL_MARKS.start.y, HALL_MARKS.start.z);
  let nag = now() + 600;
  while (!c.picked) {
    await c.wait(5);
    if (p.location.y < H.y - 3 || V.dist(p.location, H) > 16) p.teleport(start, { dimension: ow, facingLocation: at(H, 0.5, 1.8, -4) });
    if (now() > nag) { nag = now() + 600; hudMsg(p, "§7They're waiting. §8(Interact with an orb.)", 120); }
  }
  c.awaitingPick = false;
  c.lock();
  const arch = c.picked;
  const A = ARCH[arch];
  // shatter
  let ol = orbLoc(ARCH_KEYS.indexOf(arch), c.slot);
  try { if (valid(c.pickedOrb)) ol = c.pickedOrb.location; } catch { }
  ol = at(ol, 0, 0.5, 0);
  const head = p.getHeadLocation();
  const toOrb = V.flat(V.sub(ol, head));
  const side = rightOf(toOrb);
  const mid = V.lerp(head, ol, 0.5);
  c.cam(at(mid, side.x * 3.2, 0.5, side.z * 3.2), mid, 0.6, EASE.OutQuad);
  await c.wait(12);
  sound(ow, "origin.sfx.burst", ol, 1, 1);
  sound(ow, "random.explode", ol, 1.6, 0.4);
  for (let k = 0; k < 3; k++) fx(ow, "origin:burst", ol, k === 1 ? C.white : A.rgb, 1);
  c.shake(0.3, 0.3);
  for (const e of ow.getEntities({ type: "origin:archetype_orb", location: H, maxDistance: 20 })) {
    try {
      if (archOfOrb(e) !== arch) fx(ow, "origin:burst", at(e.location, 0, 0.5, 0), C.grey, 0.5);
      e.remove();
    } catch { }
  }
  // the light flows into you
  psound(p, "origin.sfx.hum", 1.4, 0.8);
  for (let s = 0; s <= 24; s++) {
    const t = s / 24;
    const chest = at(p.location, 0, 1.1, 0);
    const pt = V.lerp(ol, chest, t);
    const wob = Math.sin(t * Math.PI * 3) * 0.35 * (1 - t);
    fx(ow, "origin:trail", at(pt, side.x * wob, Math.cos(t * 9) * 0.15, side.z * wob), A.rgb, 1);
    fx(ow, "origin:dot", pt, C.white, 0.9);
    await c.wait(1);
  }
  fx(ow, "origin:burst", at(p.location, 0, 1, 0), A.rgb, 1);
  fx(ow, "origin:ring", at(p.location, 0, 0.1, 0), A.rgb, 1, { radius: 1.6 });
  psound(p, "origin.sfx.burst", 1.3, 0.8);
  c.say("§7...it fits.", 50, `${A.col}§l${A.name.toUpperCase()}`);
  await c.wait(34);
  return arch;
}

async function phaseManifest(c, arch) {
  const p = c.p, H = c.H;
  const ow = iwDim();
  const A = ARCH[arch];
  const mloc = at(H, HALL_MARKS.manifest.x, HALL_MARKS.manifest.y, HALL_MARKS.manifest.z);
  const m = await spawnRetry(ow, "origin:manifestation", mloc, 20);
  try { if (m) m.setProperty("origin:arch", A.idx); } catch { }
  c.check();
  try { p.teleport(p.location, { facingLocation: at(mloc, 0, 1.6, 0) }); } catch { }
  const head = p.getHeadLocation();
  const toM = V.flat(V.sub(mloc, head));
  const rt = rightOf(toM);
  const shoulder = { x: head.x - toM.x * 2.4 + rt.x * 1.1, y: head.y + 0.35, z: head.z - toM.z * 2.4 + rt.z * 1.1 };
  c.cam(shoulder, at(mloc, 0, 1.6, 0), 1.5, EASE.InOutSine);
  psound(p, "origin.sfx.hum", 0.55, 1);
  for (let t = 0; t < 40; t += 4) {
    fx(ow, "origin:rise", at(mloc, 0, -1, 0), C.grey, 0.7);
    await c.wait(4);
  }
  const lines = (LINES[arch] ?? LINES.brawler).meet;
  const close = { x: head.x - toM.x * 1.2 + rt.x * 0.7, y: head.y + 0.25, z: head.z - toM.z * 1.2 + rt.z * 0.7 };
  c.cam(close, at(mloc, 0, 1.7, 0), 9, EASE.Linear);
  for (const l of lines) {
    c.say(l, 70);
    psound(p, "origin.sfx.hum", 1.4, 0.35);
    fx(ow, "origin:burst", at(mloc, 0, 1.6, 0), A.rgb, 0.4);
    await c.waitOrAdvance(76);
  }
  c.fade(0.6, 3.0, 1.2, WHITE);
  psound(p, "origin.sfx.swell", 0.9, 1);
  await c.wait(14);
  try { if (valid(m)) m.remove(); } catch { }
  clearHallEntities(c.slot);
  unloadArea(`origin_hall_${c.slot}`);   // done with the hall - free its chunks for the Inner World build
  cmd(p, "fog @s remove origin_wake");
}

async function phaseFirstBreath(c, arch) {
  const p = c.p;
  const dim = iwDim();
  const slot = slotOf(p);
  const C0 = slotCenter(slot);
  const dest = arrivalLoc(C0);
  await loadArea(`origin_arrive_${slot}`, dest, 12);
  c.check();
  p.teleport(dest, { dimension: dim, facingLocation: anchorFace(C0) });
  if (!isBuilt(slot, arch)) {
    c.cam(at(C0, 0.5, 2.2, 10.5), at(C0, 0.5, 24, -12));
    const build = buildIW(slot, {
      arch,
      domePerTick: 900,
      islandPerTick: 120,
      onDome: (est) => {
        c.fade(0, 0.2, 1.8, WHITE);
        sound(dim, "origin.sfx.swell", dest, 1, 1);
        c.say("§fBreathe.", 60);
        c.cam(at(C0, 0.5, 2.4, 11), at(C0, 0.5, 8, -30), Math.max(1, est / 20), EASE.InOutSine);
      },
      onIsland: (est) => {
        sound(dim, "origin.sfx.double", dest, 1.1, 1);
        c.cam(at(C0, 0.5, 4, 20), at(C0, 0.5, 0, 0));
        system.run(() => {
          try {
            p.camera.setCamera("minecraft:free", {
              location: at(C0, 24, 20, 26),
              facingLocation: at(C0, 0, -2, 0),
              easeOptions: { easeTime: Math.max(1.5, est / 20), easeType: EASE.InOutSine },
            });
          } catch { }
        });
        c.say("§7...and the ground remembers you.", Math.min(120, est));
      },
    });
    await holdWhile(p, dest, build, anchorFace(C0));
    c.check();
  } else {
    c.cam(at(C0, 0.5, 4, 20), at(C0, 0.5, 0, 0));
    c.fade(0, 0.2, 1.8, WHITE);
    sound(dim, "origin.sfx.swell", dest, 1, 1);
    await c.wait(2);
    c.cam(at(C0, 24, 20, 26), at(C0, 0, -2, 0), 4.5, EASE.InOutSine);
    c.say("§fBreathe.", 60);
    await c.wait(90);
  }
  unloadArea(`origin_arrive_${slot}`);
  await ensureManifestation(slot, arch);
  updateFog(p);
  sound(dim, "origin.sfx.swell", dest, 1.25, 0.8);
  c.say("§7This is your Inner World.", 70, "§f§lORIGIN");
  c.cam(at(dest, 0, 2.2, 3.6), anchorFace(C0), 2.0, EASE.InOutSine);
  await c.wait(50);
}

// ---------------------------------------------------------------------------------------------
export async function onOrbInteract(player, orb) {
  const c = RT(player).cine;
  if (!c || !c.awaitingPick || c.confirming) return;
  try { const own = orb.getDynamicProperty("origin:owner"); if ((own && own !== player.id) || (c.H && V.dist(orb.location, c.H) > 20)) { hudMsg(player, "§7That light is waiting for someone else.", 40); return; } } catch { }
  c.confirming = true;
  try {
    const arch = archOfOrb(orb);
    const A = ARCH[arch];
    psound(player, "origin.sfx.hum", [0.9, 1.3, 0.6][A.idx], 0.6);
    const f = oform("menu", `${A.col}§l${A.name.toUpperCase()}`, `§f${A.tagline}\n\n§7${A.explain}\n\n§fEnergy pool: §b${A.maxEnergy}`)
      .button("§lThis is me", `${ICONS}arch_${arch}`)
      .button("Not yet", `${ICONS}act_back`);
    const r = await show(player, f);
    if (r && !r.canceled && r.selection === 0 && c.awaitingPick) {
      c.pickedOrb = orb;
      c.picked = arch;
    }
  } finally {
    c.confirming = false;
  }
}

async function quickAwaken(player) {
  const f = oform("menu", "Choose your Archetype", "§7Quick awaken (debug, no cinematic).");
  for (const k of ARCH_KEYS) f.button(`${ARCH[k].col}§l${ARCH[k].name}§r\n§8${ARCH[k].mechanic}`, `${ICONS}arch_${k}`);
  const r = await show(player, f);
  if (!r || r.canceled || r.selection === undefined) return;
  finalize(player, ARCH_KEYS[r.selection]);
}

function finalize(player, arch) {
  const h = hero(player);
  const A = ARCH[arch];
  h.awakened = true;
  h.arch = arch;
  h.moves = DEFAULT_MOVES[arch].map((m) => ({ ...m }));
  h.active = 0;
  h.energy = A.maxEnergy;
  h.dread = 0;
  h.skyOverride = "auto";
  h.gotShard = true;
  const power = rollPower(player);   // one random power from this archetype's pool
  const P = POWERS[power];
  saveNow(player);
  const r = RT(player);
  r.cd = [0, 0, 0];
  r.momentum = 0;
  removeOne(player, ITEMS.shard);
  giveKit(player);
  unlockPlayer(player);
  msg(player, `§f§lAWAKENED: ${A.col}${A.name.toUpperCase()}`);
  msg(player, "§7- §fPower Focus§7: use to cast your active move, §fsneak + use§7 to switch moves.");
  msg(player, "§7- §fDouble-tap sneak§7 to dodge. The Rift Brute learns your habits: mix it up.");
  msg(player, "§7- §fHero Codex§7: status, active move, meditate into your Inner World.");
  msg(player, "§7- The §cSuit Forge§7 and §dMove Forge§7 are on the workshop isle (south-east). Tap them.");
  msg(player, "§7- Ring the §fbell§7 in the east arena to spar. Walk through the §fGate§7 (north isle) to wake up.");
  msg(player, `§f§lYOUR POWER: ${P.icon}§l${P.name.toUpperCase()}§r §7- ${P.desc}`);
  system.runTimeout(() => valid(player) && powerReveal(player, power), 50);
  msg(player, "§7  (Hold the §fPower Core§7 and use it. Sneak + use opens the Power menu.)");
  msg(player, "§8  Powers aren't only for heroes. Watch out for villains who have them too.");
  system.runTimeout(() => {
    if (valid(player)) quip(player, "welcome", { brawler: "Alright, rookie. Arena's east, forges south-east, Gate's north. Go.", energy: "Forges! Arena! A GATE! Pick one! Pick all of them!", shadow: "The Gate is north, when you wish to leave. The forges are south-east. I'll be here." }[arch], 600, false);
  }, 60);
}

// ------------------------------------------------------------------ the power reveal: a short hero shot
import { runCine as _runCine, EASE as _EASE } from "./cine.js";
const REVEAL = {
  stretch: { col: { red: 0.91, green: 0.7, blue: 0.54 }, line: "§6Your body won't stay the length it was.", sfx: "mob.slime.big" },
  flight: { col: { red: 1, green: 0.83, blue: 0.42 }, line: "§6Gravity lets go of you.", sfx: "mob.enderdragon.flap" },
  blast: { col: { red: 1, green: 0.23, blue: 0.18 }, line: "§cSomething burns behind your eyes.", sfx: "mob.guardian.attack_loop" },
  sentry: { col: { red: 0.35, green: 0.16, blue: 0.54 }, line: "§5The Void opens a door, just for you.", sfx: "mob.warden.sonic_charge" },
  shadow_step: { col: { red: 0.16, green: 0.09, blue: 0.25 }, line: "§8Every shadow is a doorway now.", sfx: "mob.endermen.portal" },
  shade_form: { col: { red: 0.16, green: 0.09, blue: 0.25 }, line: "§8The dark wears you like a coat.", sfx: "mob.endermen.portal" },
  tendrils: { col: { red: 0.48, green: 0.25, blue: 0.82 }, line: "§5The shadows reach when you reach.", sfx: "mob.warden.dig" },
};
async function powerReveal(p, key) {
  const P = POWERS[key], R = REVEAL[key];
  if (!P || !R) return;
  await _runCine(p, async (c) => {
    const base = { ...p.location };
    const dim = p.dimension;
    try { p.addEffect("slowness", 140, { amplifier: 10, showParticles: false }); } catch { }
    // slow orbit, low angle
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI * 1.25;
      c.cam(at(base, Math.cos(a) * 4.2, 0.6 + i * 0.12, Math.sin(a) * 4.2), at(base, 0, 1.5, 0), i === 0 ? 0 : 0.35, _EASE.Linear);
      if (i === 1) c.say(R.line, 60);
      for (let k = 0; k < 4; k++) fx(dim, "origin:rise", at(base, (Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2), R.col, 1);
      await c.wait(7);
    }
    // the power itself, for a moment
    sound(dim, R.sfx, base, 1.2, 1);
    if (key === "blast") { const h = p.getHeadLocation(); flashBeam(dim, h, at(h, 0, 30, 0), tinted("laser", R.col), { life: 0.8 }); }
    else if (key === "flight") { try { p.applyKnockback({ x: 0, z: 0 }, 0.9); p.addEffect("slow_falling", 60, { showParticles: false }); } catch { } }
    else fx(dim, "origin:void_swirl", at(base, 0, 1, 0), R.col, 1);
    fx(dim, "origin:shockwave", at(base, 0, 0.05, 0), R.col, 1, { radius: 4 });
    fx(dim, "origin:burst", at(base, 0, 1, 0), R.col, 1);
    c.shake(0.35, 0.5);
    c.cam(at(base, 1.6, 1.4, 2.4), at(base, 0, 1.6, 0), 0.6, _EASE.OutCubic);
    try { p.onScreenDisplay.setTitle(`${P.icon}§l${P.name.toUpperCase()}`, { fadeInDuration: 3, stayDuration: 45, fadeOutDuration: 15, subtitle: "§7your power" }); } catch { }
    await c.wait(50);
  });
  try { p.removeEffect("slowness"); } catch { }
}
