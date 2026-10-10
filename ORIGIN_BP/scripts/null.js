// ORIGIN v0.08 - null.js
// NULL, the Dead Channel - a real boss fight now.
//  Intro: the sky goes gray, a column of static drops out of nowhere, NULL lands, title card.
//  Arena: a 20-block broadcast circle. Walk out and the signal drags you back in.
//  Attacks (every one has a tell):
//   STATIC SLAM    gray ring under you, then a crushing slam             -> leave the ring
//   CHANNEL HOP    it blinks behind you and leaves a ticking afterimage  -> get away from the afterimage
//   TEST PATTERN   color-bar shockwaves roll outward along the ground    -> JUMP over each wave
//   DEAD AIR       its screen whites out, then a beam sweeps an arc      -> get behind it / out of the arc
//   BROADCAST      (phase 2) three static echoes crawl toward you, pop   -> kill them or outrun them
//   SIGNAL LOST    (phase 2) a ring closes on you, then it pulls you into the Static -> break line of sight
//   DEAD PIXELS    squares light up on the ground, then black/white pixels slam down -> keep moving
//   FINAL BROADCAST (once, under 30%): a cutscene - NULL takes over every screen, counts down,
//                  and three SIGNAL BLOCKERS rise from the ground. Hide behind one, or eat the broadcast.
//  Phase 2 at half health: faster, the arena shrinks, the screen bleeds red.
import { world, system, EntityDamageCause } from "@minecraft/server";
import { V, at, valid, fx, line, sound, psound, C, now, health, cmd, hexToRgb, msg } from "./util.js";
import { telegraphRing, slamFx, readFx } from "./vfx.js";
import { popNumber } from "./combat.js";
import { runCine, EASE } from "./cine.js";
import { RT, hero } from "./data.js";
import { drawBeam, STYLES } from "./beams.js";

export const NULL = "origin:null";
const GRAY = hexToRgb("#9a9a9a"), RED = hexToRgb("#ff2a2a");
const BARS = ["#ffffff", "#ffe600", "#00e5ff", "#00e000", "#ff00e5", "#ff1a1a", "#1a3cff"].map(hexToRgb);
const brains = new Map();

// ------------------------------------------------------------------ NULL takes over your screen
// Full-screen cards on the title channel ("origin_null[code]text"): [intro] test pattern + name,
// [bcast] the Final Broadcast, [lost] SIGNAL LOST over snow, [hit] a split-second glitch when it hits you.
// While you're in its arena, a TV bezel with a blinking LIVE · CH ∅ sits around your screen.
export function nullCard(p, code, text, ticks = 30) {
  try {
    const r = RT(p);
    r.titleUntil = now() + ticks + 2;
    r.nullCardUntil = now() + ticks;
    const pre = hero(p).overlay === "safe" ? "origin_ncard[alt]" : "origin_ncard";
    p.onScreenDisplay.setTitle(`${pre}[${code}]${text}`, { fadeInDuration: 0, stayDuration: ticks + 10, fadeOutDuration: 0 });
    system.runTimeout(() => {
      if (!valid(p) || (RT(p).nullCardUntil ?? 0) > now()) return;
      try { p.onScreenDisplay.setTitle(pre, { fadeInDuration: 0, stayDuration: 2, fadeOutDuration: 0 }); } catch { }
    }, ticks);
  } catch { }
}
const fighting = new Map();   // playerId -> last tick seen in an arena
export function inNullFight(p) { return (fighting.get(p.id) ?? -999) > now() - 40; }

function setState(b, s) { b.state = s; try { b.e.setProperty("origin:state", s); } catch { } }
function brain(e) {
  let b = brains.get(e.id);
  if (!b) {
    let home = null;
    try { const hs = e.getDynamicProperty("origin:home"); if (hs) home = JSON.parse(hs); } catch { }
    b = { e, state: 0, t: 0, cd: now() + 40, phase: 1, home: home ?? { ...e.location }, R: 20, next: 0, moves: 0, echoes: [], waves: [], intro: false };
    brains.set(e.id, b);
  }
  return b;
}
const players = (b, r = 40, c = b.home) => { try { return b.e.dimension.getPlayers({ location: c, maxDistance: r }); } catch { return []; } };
function target(b) {
  let best = null, bd = 1e9;
  for (const p of players(b, 36)) { const d = V.dist(p.location, b.e.location); if (d < bd) { bd = d; best = p; } }
  return best;
}
function hurt(b, p, dmg, kb = 0.3) {
  if ((RT(p).nullCardUntil ?? 0) < now()) nullCard(p, "hit", " ", 5);
  try { p.applyDamage(dmg, { cause: EntityDamageCause.entityAttack, damagingEntity: b.e }); } catch { }
  try { p.applyKnockback({ x: 0, z: 0 }, kb); } catch { }
  try { popNumber(p.dimension, p.getHeadLocation(), `§8-${dmg}`); cmd(p, "camerashake add @s 0.4 0.25 positional"); } catch { }
}
function tag(b) {
  const hp = health(b.e); if (!hp) return;
  const seg = Math.round((hp.cur / hp.max) * 20);
  try { b.e.nameTag = b.phase === 2 ? "§c§lNULL §r§7· SIGNAL LOST" : "§8§lNULL §r§7· the dead channel"; } catch { }
}

// ------------------------------------------------------------------ summon + intro cinematic
export async function summonNull(player) {
  const dim = player.dimension;
  const f = V.flat(player.getViewDirection());
  const loc = at(player.location, f.x * 9, 0, f.z * 9);
  const sky = at(loc, 0, 22, 0);
  const watchers = (() => { try { return dim.getPlayers({ location: loc, maxDistance: 40 }); } catch { return [player]; } })();
  for (const p of watchers) { try { p.addEffect("darkness", 140, { showParticles: false }); cmd(p, "fog @s push origin:static origin_null"); } catch { } }
  let e = null;
  // the summoner gets the full shot; everyone else sees it happen
  const scene = runCine(player, async (c) => {
    const side = { x: -f.z, z: f.x };
    c.cam(at(player.location, side.x * 3 - f.x * 2, 2.4, side.z * 3 - f.z * 2), at(loc, 0, 6, 0));
    c.say("§7the receiver screams", 30);
    sound(dim, "mob.warden.sonic_charge", loc, 2, 0.5);
    for (let i = 0; i < 16; i++) {
      for (let k = 0; k < 6; k++) fx(dim, "origin:static_dot", at(loc, (Math.random() - 0.5) * 3, (i / 16) * 22 + Math.random() * 2, (Math.random() - 0.5) * 3), Math.random() < 0.5 ? C.white : C.grey, 1);
      if (i % 4 === 0) psound(player, "random.fizz", 0.6, 0.3 + i * 0.05);
      await c.wait(2);
    }
    c.cam(at(loc, side.x * 8, 3, side.z * 8), at(loc, 0, 12, 0), 1.2, EASE.InOutSine);
    c.say("§8something is tuning in", 40);
    await c.wait(16);
    try { e = dim.spawnEntity(NULL, sky); e.addEffect("resistance", 120, { amplifier: 5, showParticles: false }); e.setDynamicProperty("origin:home", JSON.stringify(loc)); } catch { }
    for (let i = 0; i < 10 && e; i++) {
      try { e.teleport(at(loc, 0, 22 - (i + 1) * 2.2, 0), { facingLocation: player.location }); } catch { }
      fx(dim, "origin:glitch", at(loc, 0, 22 - i * 2.2, 0), C.white, 1);
      await c.wait(1);
    }
    slamFx(dim, loc, 5, C.white);
    sound(dim, "random.explode", loc, 1.6, 0.6);
    sound(dim, "mob.warden.sonic_boom", loc, 1.4, 0.5);
    c.shake(0.8, 0.8);
    c.fade(0, 0.1, 0.4, { red: 1, green: 1, blue: 1 });
    c.cam(at(loc, f.x * -3.2, 2.6, f.z * -3.2), at(loc, 0, 2.6, 0), 0.8, EASE.OutCubic);
    await c.wait(18);
    c.cam(at(loc, f.x * -2.2, 2.9, f.z * -2.2), at(loc, 0, 2.9, 0), 2.2, EASE.Linear);
    for (const p of watchers) nullCard(p, "intro", "§l N U L L \n§r§7the dead channel", 60);
    await c.wait(40);
  }, { skippable: true });
  await scene;
  if (!e) { try { e = dim.spawnEntity(NULL, loc); e.setDynamicProperty("origin:home", JSON.stringify(loc)); } catch { msg(player, "§7No room for it here."); return; } }
  try { e.teleport(loc, { facingLocation: player.location }); e.nameTag = "§8§lNULL"; e.removeEffect("resistance"); } catch { }
  const b = brain(e);
  b.home = loc; b.cd = now() + 30;
  for (const p of watchers) { try { cmd(p, "fog @s remove origin_null"); } catch { } }
}

// ------------------------------------------------------------------ AI (every 2 ticks)
export function tickNull() {
  const t = now();
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end", "origin:the_static"]) {
    let list = [];
    try { list = world.getDimension(id).getEntities({ type: NULL }); } catch { continue; }
    for (const e of list) { const b = brain(e); try { step(b, t); } catch (err) { console.warn("[ORIGIN] null: " + err); setState(b, 0); b.state = 0; } }
  }
  for (const [id, b] of brains) if (!valid(b.e)) brains.delete(id);
}

function arena(b, t) {
  const dim = b.e.dimension;
  for (const p of players(b, b.R + 10)) fighting.set(p.id, t);
  if (t % 10 === 0) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + t * 0.01;
      fx(dim, "origin:static_dot", at(b.home, Math.cos(a) * b.R, 0.3 + Math.random() * 2, Math.sin(a) * b.R), i % 2 ? C.white : C.grey, 0.9);
    }
  }
  for (const p of players(b, b.R + 12)) {
    const d = V.hdist(p.location, b.home);
    if (d > b.R && d < b.R + 12) {
      const back = V.flat(V.sub(b.home, p.location));
      try { p.applyKnockback({ x: back.x * 0.9, z: back.z * 0.9 }, 0.15); } catch { }
      if (t % 20 === 0) RT(p).msg = "§8the signal won't let you leave";
    }
  }
}

function step(b, t) {
  const e = b.e, dim = e.dimension;
  if (t % 10 === 0) tag(b);
  const hp = health(e);
  if (hp && b.phase === 1 && hp.cur <= hp.max * 0.5) {
    b.phase = 2; b.R = 15;
    readFx(dim, e.getHeadLocation());
    sound(dim, "mob.warden.roar", e.location, 1.6, 0.6);
    for (const p of players(b)) { nullCard(p, "lost", "§lSIGNAL LOST\n§r§7it's getting louder", 40); try { cmd(p, "camerashake add @s 0.6 0.6 positional"); } catch { } }
  }
  arena(b, t);
  tickWaves(b, t);
  tickEchoes(b, t);
  const tg = target(b);
  const fast = b.phase === 2 ? 0.7 : 1;
  switch (b.state) {
    case 0: {
      if (!tg) return;
      try { e.teleport(e.location, { facingLocation: tg.location }); } catch { }
      if (t < b.cd) return;
      const d = V.dist(tg.location, e.location);
      const roll = Math.random();
      b.moves++;
      if (hp && hp.cur < hp.max * 0.3 && !b.finalDone) { b.finalDone = true; finalBroadcast(b); return; }
      if (roll > 0.82) return start(b, 9, tg, 16);                                // dead pixels
      if (b.phase === 2 && roll < 0.18 && !b.pulledRecently) return start(b, 5, tg, Math.round(30 * fast));
      if (b.phase === 2 && roll < 0.36 && b.echoes.length === 0) return start(b, 8, tg, 20);
      if (b.phase === 2 && roll < 0.5 && !b.jamRecently) return start(b, 11, tg, 50);   // interference
      if (b.moves % 4 === 0) return start(b, 7, tg, Math.round(24 * fast));     // test pattern
      if (roll < 0.3 && d < 14) return start(b, 6, tg, Math.round(26 * fast));   // dead air
      if (d > 7) return start(b, 4, tg, 10);                                       // channel hop
      return start(b, 1, tg, Math.round(18 * fast));                               // slam
    }
    case 1: {   // STATIC SLAM
      b.t -= 2;
      if (b.t % 4 === 0) telegraphRing(dim, b.center, 3.4, C.grey, 0.9);
      if (b.t <= 0) {
        slamFx(dim, b.center, 3.4, C.white);
        fx(dim, "origin:flash", at(b.center, 0, 0.5, 0), C.white, 1, { size: 3 }); fx(dim, "origin:glitch", at(b.center, 0, 0.8, 0), C.white, 1); fx(dim, "origin:dust", b.center, C.white, 1);
        sound(dim, "mob.warden.sonic_boom", b.center, 1.2, 0.8);
        for (const p of players(b)) if (V.hdist(p.location, b.center) <= 3.4) hurt(b, p, 8, 0.5);
        return recover(b, 22);
      }
      return;
    }
    case 3: {
      b.t -= 2;
      if (b.t % 6 === 0) fx(dim, "origin:glitch", at(e.location, 0, 2, 0), C.grey, 0.6);
      if (b.t <= 0) { setState(b, 0); b.cd = t + Math.round(20 * fast); }
      return;
    }
    case 4: {   // CHANNEL HOP: afterimage left behind, then blink behind the target
      b.t -= 2;
      if (b.t > 0 || !tg) return;
      const old = { ...e.location };
      spawnEcho(b, old, 30);
      const f = V.flat(V.sub(tg.location, e.location));
      const dest = at(tg.location, f.x * 2.2, 0, f.z * 2.2);
      try { if (!e.tryTeleport(dest, { checkForBlocks: true, facingLocation: tg.location })) e.teleport(at(tg.location, -f.x * 3, 0, -f.z * 3)); } catch { }
      fx(dim, "origin:void_swirl", at(e.location, 0, 1.4, 0), C.grey, 1);
      sound(dim, "mob.endermen.portal", e.location, 1, 0.5);
      return recover(b, 10);
    }
    case 5: {   // SIGNAL LOST: pull into the Static
      b.t -= 2;
      if (tg && b.t % 4 === 0) telegraphRing(dim, tg.location, 1 + b.t / 12, C.white, 0.9);
      if (b.t <= 0) {
        b.pulledRecently = true;
        system.runTimeout(() => { b.pulledRecently = false; }, 600);
        if (tg && V.dist(tg.location, e.location) < 24 && seesTarget(e, tg)) import("./static.js").then((m) => m.pullIn(null, tg));
        else sound(dim, "random.fizz", e.location, 1, 0.5);
        return recover(b, 26);
      }
      return;
    }
    case 6: {   // DEAD AIR: screen whites out, then a sweeping beam
      b.t -= 2;
      const head = at(e.location, 0, 2.4, 0);
      if (b.phase6 === "charge") {
        fx(dim, "origin:charge", head, C.white, 1);
        line(dim, "origin:dot", head, V.add(head, V.mul(dirAt(b.a0, b.dy), 8)), RED, 1, 0.6);
        if (b.t <= 0) { b.phase6 = "fire"; b.t = 40; sound(dim, "mob.guardian.attack_loop", head, 2, 0.5); }
        return;
      }
      const k = 1 - Math.max(0, b.t) / 40;
      const a = b.a0 + b.sweep * k;
      const dir = dirAt(a, b.dy);
      const end = V.add(head, V.mul(dir, 18));
      // RGB-split beam: three offset channels, like a signal tearing apart
      const side = { x: -dir.z * 0.18, y: 0, z: dir.x * 0.18 };
      drawBeam(dim, V.add(head, side), V.add(end, side), { ...STYLES.laser, glow: RED, width: 0.26, coreW: 0.05 }, now(), { life: 0.16 });
      drawBeam(dim, V.sub(head, side), V.sub(end, side), { ...STYLES.laser, glow: hexToRgb("#2affff"), sheath: hexToRgb("#9ffcff"), width: 0.26, coreW: 0.05 }, now(), { life: 0.16 });
      drawBeam(dim, head, end, { ...STYLES.laser, glow: C.white, core: C.white, width: 0.1, coreW: 0.05, sheath: null }, now(), { life: 0.16 });
      fx(dim, "origin:beam_flare", end, RED, 0.9, { size: 1.2 });
      for (const p of players(b, 24)) {
        const v = V.sub(at(p.location, 0, 1, 0), head);
        const along = V.dot(v, dir);
        if (along < 0 || along > 18) continue;
        const off = V.len(V.sub(v, V.mul(dir, along)));
        if (off < 1.5 && (b.hitAt?.[p.id] ?? -99) + 10 <= t) { (b.hitAt ??= {})[p.id] = t; hurt(b, p, 4, 0.2); }
      }
      if (b.t <= 0) { b.phase6 = null; return recover(b, 24); }
      return;
    }
    case 7: {   // TEST PATTERN: rolling color-bar shockwaves (jump them)
      b.t -= 2;
      if (b.t % 8 === 0 && b.t >= 0) {
        b.waves.push({ r: 1, made: t, hit: new Set(), col: BARS[(b.waves.length + b.moves) % BARS.length] });
        sound(dim, "random.anvil_land", e.location, 0.8, 0.4);
        slamFx(dim, e.location, 2, C.white);
      }
      if (b.t <= -2) return recover(b, 16);
      return;
    }
    case 9: {   // DEAD PIXELS: marked squares, then pixels slam down on them
      b.t -= 2;
      if (!b.pix) {
        b.pix = [];
        for (const pl of players(b, 30)) for (let k = 0; k < 3; k++) b.pix.push(at(pl.location, (Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6));
        for (let k = 0; k < 6; k++) { const a = Math.random() * Math.PI * 2, r = Math.random() * b.R; b.pix.push(at(b.home, Math.cos(a) * r, 0, Math.sin(a) * r)); }
      }
      for (const q of b.pix) if (b.t % 4 === 0) { for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) fx(dim, "origin:dot", at(q, dx, 0.15, dz), (b.t / 4) % 2 ? C.white : RED, 1); }
      if (b.t <= 0) {
        for (const q of b.pix) {
          for (let y = 6; y >= 0; y -= 2) fx(dim, "origin:static_dot", at(q, 0, y, 0), Math.random() < 0.5 ? C.white : C.grey, 1);
          fx(dim, "origin:boom_smoke", q, C.grey, 0.6);
          for (const pl of players(b, 30)) if (V.hdist(pl.location, q) < 1.6) hurt(b, pl, 6, 0.5);
        }
        sound(dim, "random.explode", b.home, 1, 1.6);
        b.pix = null;
        return recover(b, 18);
      }
      return;
    }
    case 11: {  // INTERFERENCE: your screen drowns in static while dead-signal bursts pop under everyone
      b.t -= 2;
      if (b.t % 10 === 0) {
        if (b.jam) for (const q of b.jam) { fx(dim, "origin:glitch", at(q, 0, 0.6, 0), C.white, 1); fx(dim, "origin:boom_smoke", q, C.grey, 0.5); for (const pl of players(b, 30)) if (V.hdist(pl.location, q) < 1.8) hurt(b, pl, 4, 0.4); }
        b.jam = players(b, 30).map((pl) => at(pl.location, (Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
        for (const q of b.jam) telegraphRing(dim, q, 1.8, RED, 1);
        sound(dim, "origin.sfx.shock", e.location, 1.2, 0.5);
      }
      if (b.t <= 0) { b.jam = null; return recover(b, 18); }
      return;
    }
    case 8: {   // BROADCAST: three echoes crawl toward you
      b.t -= 2;
      if (b.t <= 0) {
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          spawnEcho(b, at(e.location, Math.cos(a) * 3, 0, Math.sin(a) * 3), 160, true);
        }
        sound(dim, "mob.evocation_illager.prepare_summon", e.location, 1, 0.6);
        return recover(b, 20);
      }
      return;
    }
  }
}
function dirAt(a, dy = -0.12) { const v = { x: -Math.sin(a), y: dy, z: Math.cos(a) }; const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; }
function start(b, s, tg, ticks) {
  const e = b.e, dim = e.dimension;
  b.t = ticks;
  setState(b, s === 6 || s === 7 || s === 8 || s === 9 ? 1 : s);
  b.state = s;
  if (s === 1) { b.center = { ...tg.location }; sound(dim, "mob.warden.heartbeat", e.location, 1, 0.8); }
  if (s === 4) fx(dim, "origin:void_swirl", at(e.location, 0, 1, 0), C.grey, 1);
  if (s === 5) { readFx(dim, e.getHeadLocation()); try { tg.onScreenDisplay.setActionBar("§fbreak line of sight!"); } catch { } }
  if (s === 6) {
    const to = V.flat(V.sub(tg.location, e.location));
    const base = Math.atan2(-to.x, to.z);
    b.sweep = (Math.random() < 0.5 ? 1 : -1) * (b.phase === 2 ? 2.4 : 1.8);
    b.a0 = base - b.sweep / 2;
    const hd = Math.max(2, V.hdist(tg.location, e.location));
    b.dy = Math.max(-0.5, Math.min(0.3, ((tg.location.y + 1) - (e.location.y + 2.4)) / hd));
    b.phase6 = "charge";
    sound(dim, "beacon.activate", e.location, 2, 1.4);
  }
  if (s === 7) sound(dim, "mob.warden.sonic_charge", e.location, 1.4, 0.7);
  if (s === 8) readFx(dim, e.getHeadLocation());
  if (s === 9) { setState(b, 1); b.state = 9; sound(dim, "random.click", e.location, 2, 0.5); }
  if (s === 11) {
    setState(b, 1); b.state = 11; b.jamRecently = true; b.jam = null;
    system.runTimeout(() => { b.jamRecently = false; }, 500);
    for (const p of players(b)) nullCard(p, "jam", "§lINTERFERENCE\n§r§7hold on to something", 50);
    sound(dim, "origin.sfx.highpitch", e.location, 0.8, 0.8);
  }
}
function recover(b, ticks) { setState(b, 3); b.state = 3; b.t = ticks; }
function seesTarget(e, tg) {
  try {
    const from = at(e.location, 0, 2.4, 0), to = tg.getHeadLocation();
    const d = V.sub(to, from);
    return !e.dimension.getBlockFromRay(from, V.norm(d), { maxDistance: V.len(d), includePassableBlocks: false });
  } catch { return true; }
}

function tickWaves(b, t) {
  const dim = b.e.dimension;
  b.waves = b.waves.filter((w) => w.r < 18);
  for (const w of b.waves) {
    w.r += 0.55;
    const n = Math.floor(w.r * 3);
    for (let i = 0; i < n; i += 2) {
      const a = (i / n) * Math.PI * 2;
      const col = BARS[Math.floor((i / n) * BARS.length) % BARS.length];
      fx(dim, "origin:dot", at(b.e.location, Math.cos(a) * w.r, 0.25, Math.sin(a) * w.r), col, 1);
      if (i % 6 === 0) fx(dim, "origin:dot", at(b.e.location, Math.cos(a) * w.r, 0.9, Math.sin(a) * w.r), col, 0.8);
    }
    for (const p of players(b, w.r + 2, b.e.location)) {
      if (w.hit.has(p.id)) continue;
      const d = V.hdist(p.location, b.e.location);
      if (Math.abs(d - w.r) > 0.8) continue;
      if (!p.isOnGround) continue;       // jumped it!
      w.hit.add(p.id);
      hurt(b, p, 5, 0.7);
    }
  }
}
function spawnEcho(b, loc, life, hunter = false) {
  let e;
  try { e = b.e.dimension.spawnEntity("origin:static_echo", loc); } catch { return; }
  b.echoes.push({ e, until: now() + life, hunter, born: now() });
}
function tickEchoes(b, t) {
  const dim = b.e.dimension;
  b.echoes = b.echoes.filter((x) => {
    if (!valid(x.e)) return false;
    const tg = target(b);
    if (x.hunter && tg && t - x.born > 20) {
      const d = V.sub(tg.location, x.e.location);
      const step = V.mul(V.norm({ x: d.x, y: 0, z: d.z }), 0.22);
      try { x.e.teleport(V.add(x.e.location, step), { facingLocation: tg.location }); } catch { }
      if (V.len(d) < 1.6) { pop(b, x); return false; }
    }
    if (!x.hunter && x.until - t < 16 && t % 4 === 0) telegraphRing(dim, x.e.location, 2.6, C.white, 0.8);
    if (t >= x.until) { pop(b, x); return false; }
    return true;
  });
}
function pop(b, x) {
  const dim = b.e.dimension, c = { ...x.e.location };
  slamFx(dim, c, 2.6, C.white);
  sound(dim, "random.explode", c, 0.6, 1.4);
  for (const p of players(b)) if (V.dist(p.location, c) < 2.8) hurt(b, p, x.hunter ? 4 : 5, 0.4);
  try { x.e.remove(); } catch { }
}

export function forgetNull(e) {
  const b = brains.get(e.id);
  if (b) for (const x of b.echoes) { try { x.e.remove(); } catch { } }
  brains.delete(e.id);
}

// ------------------------------------------------------------------ FINAL BROADCAST (cinematic move, once per fight)
async function finalBroadcast(b) {
  const e = b.e, dim = e.dimension;
  setState(b, 1); b.state = 10;
  const { runCine, EASE } = await import("./cine.js");
  try { e.addEffect("resistance", 200, { amplifier: 5, showParticles: false }); } catch { }
  const home = { ...b.home };
  // three signal blockers rise around the arena
  const blocks = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.random();
    const c = at(home, Math.cos(a) * 9, 0, Math.sin(a) * 9);
    const x = Math.floor(c.x), z = Math.floor(c.z), y = Math.floor(c.y);
    for (let dy = 0; dy < 4; dy++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      try { const bl = dim.getBlock({ x: x + dx, y: y + dy, z: z + dz }); if (bl?.isAir) { bl.setType(dy === 3 ? "minecraft:sea_lantern" : "minecraft:black_concrete"); blocks.push(bl.location); } } catch { }
    }
  }
  const watchers = players(b, 40);
  const scenes = watchers.map((p) => runCine(p, async (c) => {
    const head = at(e.location, 0, 2.6, 0);
    const f = V.flat(V.sub(p.location, e.location));
    c.cam(at(head, f.x * 1.6, 0.1, f.z * 1.6), head);
    nullCard(p, "bcast", "§lTHIS IS NOT A TEST\n§r§7we interrupt your life for an important broadcast", 26);
    sound(dim, "mob.warden.sonic_charge", e.location, 2, 0.4);
    await c.wait(24);
    c.cam(at(home, f.x * 14, 9, f.z * 14), at(home, 0, 1, 0), 1.4, EASE.InOutSine);
    nullCard(p, "intro", "§lFIND COVER\n§r§7get behind a signal blocker", 30);
    await c.wait(30);
    for (const n of ["3", "2", "1"]) {
      c.cam(at(head, f.x * (2.4 - Number(n) * 0.3), 0.2, f.z * (2.4 - Number(n) * 0.3)), head, 0.3, EASE.OutCubic);
      nullCard(p, "bcast", `§l${n}`, 12);
      c.shake(0.3, 0.3);
      sound(dim, "random.click", p.location, 2, 0.4);
      for (let i = 0; i < 6; i++) fx(dim, "origin:static_dot", at(head, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2), Math.random() < 0.5 ? C.white : RED, 1);
      await c.wait(14);
    }
  }, { skippable: false }));
  await Promise.all(scenes);
  // 2 seconds to get into cover
  for (const p of players(b, 40)) nullCard(p, "hit", "§lGET BEHIND A BLOCKER", 30);
  for (let i = 0; i < 20; i++) { telegraphRing(dim, home, 2 + i, C.white, 0.6); await system.waitTicks(2); if (!valid(e)) break; }
  if (valid(e)) {
    const src = at(e.location, 0, 2.4, 0);
    for (let r = 2; r < 26; r += 3) { telegraphRing(dim, home, r, RED, 1); }
    sound(dim, "mob.warden.sonic_boom", src, 2, 0.4);
    sound(dim, "random.explode", src, 2, 0.6);
    for (const p of players(b, 30)) {
      if (seesTarget(e, p)) { nullCard(p, "lost", "§lBROADCAST RECEIVED", 30); hurt(b, p, 16, 0.8); try { p.addEffect("darkness", 60, { showParticles: false }); } catch { } }
      else { try { p.onScreenDisplay.setActionBar("§7the broadcast passes over you"); } catch { } }
    }
  }
  await system.waitTicks(40);
  for (const l of blocks) { try { const bl = dim.getBlock(l); if (bl && (bl.typeId === "minecraft:black_concrete" || bl.typeId === "minecraft:sea_lantern")) bl.setType("minecraft:air"); } catch { } }
  try { if (valid(e)) e.removeEffect("resistance"); } catch { }
  recover(b, 20);
}
