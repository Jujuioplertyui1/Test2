// ORIGIN v0.24 - null.js
// NULL, the Dead Channel - a three-act boss fight.
//  Intro: the sky goes gray, a column of static drops out of nowhere, NULL lands, title card.
//  Arena: a broadcast circle. Walk out and the signal drags you back in.
//  It HUNTS you now (v0.24): it walks you down, blinks in when you run, and has a real melee game.
//  ACT ONE - TEST PATTERN (100% -> 66%)
//   GLITCH CLAW    close range: its screen flashes red, then three lunging slashes   -> back off, or guard/parry
//   STATIC SLAM    gray ring under you, then a crushing slam                         -> leave the ring
//   CHANNEL HOP    it blinks behind you and leaves a ticking afterimage              -> get away from the afterimage
//   TEST PATTERN   color-bar shockwaves roll outward along the ground                -> JUMP over each wave
//   DEAD AIR       its screen whites out, then a beam sweeps an arc                  -> get behind it / out of the arc
//   DEAD PIXELS    squares light up on the ground, then pixels slam down             -> keep moving
//  ACT TWO - SIGNAL LOST (66% -> 33%): the arena shrinks and three SIGNAL TOWERS rise at its edge. While any tower
//   stands NULL is shielded (it barely feels your hits) and the towers snipe at you. Bring all three down and NULL
//   OVERLOADS: it drops to its knees, BUFFERING, wide open for six seconds. New tricks:
//   BROADCAST      three static echoes crawl toward you, then pop                   -> kill them or outrun them
//   SIGNAL LOST    a ring closes on you, then it pulls you into the Static           -> break line of sight
//   INTERFERENCE   your screen drowns in static while bursts pop under everyone      -> keep moving
//  ACT THREE - DEAD CHANNEL (under 33%): the FINAL BROADCAST (hide behind a signal blocker or eat it), then it's
//   enraged: faster, CHANNEL SURF (it zaps from screen to screen around you, slashing - watch for the flicker where
//   it's about to land) and the floor keeps dropping dead pixels.
//  After its big moves it's EXPOSED for a moment (hits land harder). More players = it takes the hits better.
//  Everyone dies or walks away? It loses interest and fades out - the next Receiver use calls it back for free.
import { world, system, EntityDamageCause } from "@minecraft/server";
import { V, at, valid, fx, line, sound, psound, C, now, health, cmd, hexToRgb, msg, yawTo } from "./util.js";
import { telegraphRing, slamFx, readFx } from "./vfx.js";
import { popNumber } from "./combat.js";
import { runCine, EASE } from "./cine.js";
import { RT, hero, markDirty } from "./data.js";
import { drawBeam, STYLES } from "./beams.js";

export const NULL = "origin:null";
export const TOWER = "origin:null_antenna";
const GRAY = hexToRgb("#9a9a9a"), RED = hexToRgb("#ff2a2a"), CYAN = hexToRgb("#2affff");
const BARS = ["#ffffff", "#ffe600", "#00e5ff", "#00e000", "#ff00e5", "#ff1a1a", "#1a3cff"].map(hexToRgb);
const brains = new Map();
const ARENA = [0, 20, 16, 14];          // radius per act
const P2 = 0.66, P3 = 0.33;             // act thresholds (fraction of max health)

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

// the client only knows states 0-5 (0 idle, 1 wind-up, 3 recover/kneel, 4 hop): everything else maps onto those
const ANIM = { 0: 0, 1: 1, 3: 3, 4: 4, 5: 5, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 13: 3, 14: 1 };
function setState(b, s) { b.state = s; try { b.e.setProperty("origin:state", ANIM[s] ?? 1); } catch { } }
function save(b) { try { b.e.setDynamicProperty("origin:nb", JSON.stringify({ phase: b.phase, finalDone: !!b.finalDone, towersDone: !!b.towersDone, fighters: [...b.fighters] })); } catch { } }
function brain(e) {
  let b = brains.get(e.id);
  if (!b) {
    let home = null, saved = {};
    try { const hs = e.getDynamicProperty("origin:home"); if (hs) home = JSON.parse(hs); } catch { }
    try { saved = JSON.parse(e.getDynamicProperty("origin:nb") ?? "{}"); } catch { }
    const phase = saved.phase ?? 1;
    b = {
      e, state: 0, t: 0, cd: now() + 40, phase, home: home ?? { ...e.location }, R: ARENA[phase] ?? 20, moves: 0, echoes: [], waves: [], towers: [],
      intro: false, finalDone: !!saved.finalDone, towersDone: !!saved.towersDone, fighters: new Set(saved.fighters ?? []), lastSeen: now(), last: [],
      exposedUntil: 0, blinkAt: 0, rooted: false, used: {},
    };
    brains.set(e.id, b);
    // a reload mid act two: the towers it had are gone with the brain - stand them back up
    if (phase === 2 && !b.towersDone) system.runTimeout(() => valid(e) && raiseTowers(b), 20);
  }
  return b;
}
const players = (b, r = 40, c = b.home) => { try { return b.e.dimension.getPlayers({ location: c, maxDistance: r }).filter((p) => { try { return p.getGameMode() !== "Spectator" && p.getGameMode() !== "spectator"; } catch { return true; } }); } catch { return []; } };
function target(b) {
  let best = null, bd = 1e9;
  for (const p of players(b, 36)) { const d = V.dist(p.location, b.e.location); if (d < bd) { bd = d; best = p; } }
  return best;
}
function hurt(b, p, dmg, kb = 0.3, dir = null) {
  if ((RT(p).nullCardUntil ?? 0) < now()) nullCard(p, "hit", " ", 5);
  const scaled = Math.round(dmg * (b.phase === 3 ? 1.15 : 1));
  try { p.applyDamage(scaled, { cause: EntityDamageCause.entityAttack, damagingEntity: b.e }); } catch { }
  try { p.applyKnockback(dir ? { x: dir.x * kb * 2, z: dir.z * kb * 2 } : { x: 0, z: 0 }, kb); } catch { }
  try { popNumber(p.dimension, p.getHeadLocation(), `§8-${scaled}`); cmd(p, "camerashake add @s 0.4 0.25 positional"); } catch { }
}
function tag(b) {
  const shielded = b.towers.some((x) => valid(x.e));
  const name = b.state === 13 ? "§e§lNULL §r§7· §eBUFFERING..." : b.phase === 3 ? "§4§lNULL §r§7· DEAD CHANNEL" : b.phase === 2 ? "§c§lNULL §r§7· SIGNAL LOST" : "§8§lNULL §r§7· the dead channel";
  try { b.e.nameTag = name + (shielded ? " §b[SHIELDED]" : (b.exposedUntil ?? 0) > now() ? " §e[EXPOSED]" : ""); } catch { }
}
function root(b, on) {
  if (b.rooted === on) return;
  b.rooted = on;
  try { b.e.triggerEvent(on ? "origin:root" : "origin:unroot"); } catch { }
}
function face(b, loc) { try { b.e.setRotation({ x: 0, y: yawTo(b.e.location, loc) }); } catch { } }

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
  for (const p of watchers) { b.fighters.add(p.id); try { cmd(p, "fog @s remove origin_null"); } catch { } }
  save(b);
  for (const p of watchers) msg(p, "§8[§7NULL§8] §7Act one: §fTEST PATTERN§7. Watch its screen - every attack has a tell. §8(It's EXPOSED after its big moves.)");
}

// ------------------------------------------------------------------ AI (every 2 ticks)
export function tickNull() {
  const t = now();
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end", "origin:the_static"]) {
    let list = [];
    try { list = world.getDimension(id).getEntities({ type: NULL }); } catch { continue; }
    for (const e of list) { const b = brain(e); try { step(b, t); } catch (err) { console.warn("[ORIGIN] null: " + err); setState(b, 0); root(b, false); } }
  }
  for (const [id, b] of brains) if (!valid(b.e)) { for (const x of b.towers) { try { if (valid(x.e)) x.e.remove(); } catch { } } brains.delete(id); }
  // towers with no NULL to feed (it died or left while they were unloaded) shut down
  if (t % 200 === 0) {
    const mine = new Set([...brains.values()].flatMap((b) => b.towers.map((x) => x.e.id)));
    for (const p of world.getAllPlayers()) {
      try { for (const tw of p.dimension.getEntities({ type: TOWER, location: p.location, maxDistance: 96 })) if (!mine.has(tw.id)) tw.remove(); } catch { }
    }
  }
}

function arena(b, t) {
  const dim = b.e.dimension;
  const near = players(b, b.R + 10);
  for (const p of near) { fighting.set(p.id, t); if (!b.fighters.has(p.id)) { b.fighters.add(p.id); save(b); } }
  if (near.length) b.lastSeen = t;
  if (t % 10 === 0) {
    const col = b.phase === 3 ? RED : b.phase === 2 ? CYAN : C.white;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + t * 0.01;
      fx(dim, "origin:static_dot", at(b.home, Math.cos(a) * b.R, 0.3 + Math.random() * 2, Math.sin(a) * b.R), i % 2 ? col : C.grey, 0.9);
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
  // NULL itself never wanders off its stage
  if (V.hdist(b.e.location, b.home) > b.R + 2) blink(b, at(b.home, (Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4));
}

// everyone's gone (dead, or walked away): it loses interest. Whoever fought it can call it back for free.
function abandon(b, why) {
  const e = b.e, dim = e.dimension;
  for (const p of players(b, 60)) nullCard(p, "lost", why === "won" ? "§lSIGNAL RESTORED\n§r§7...for now" : "§lNO SIGNAL\n§r§7it lost interest", 40);
  for (let i = 0; i < 18; i++) fx(dim, "origin:glitch", at(e.location, (Math.random() - 0.5) * 2, Math.random() * 3, (Math.random() - 0.5) * 2), C.white, 1);
  sound(dim, "random.fizz", e.location, 0.6, 1);
  for (const id of b.fighters) {
    const p = world.getAllPlayers().find((q) => q.id === id);
    if (p) { const h = hero(p); h.quest = h.quest ?? { signal: 0 }; h.quest.nullFree = true; markDirty(p); msg(p, "§8[§7NULL§8] §7The channel went quiet. §8(Your Receiver can call it back without shards.)"); }
    else { try { const owed = new Set(String(world.getDynamicProperty("origin:null_owed") ?? "").split(",").filter(Boolean)); owed.add(id); world.setDynamicProperty("origin:null_owed", [...owed].join(",")); } catch { } }
  }
  forgetNull(e);
  try { e.remove(); } catch { }
}
// a player who wasn't online when it left gets the free call too
export function nullOwed(p) {
  try {
    const owed = new Set(String(world.getDynamicProperty("origin:null_owed") ?? "").split(",").filter(Boolean));
    if (!owed.delete(p.id)) return false;
    world.setDynamicProperty("origin:null_owed", [...owed].join(","));
    return true;
  } catch { return false; }
}

function step(b, t) {
  const e = b.e, dim = e.dimension;
  if (t % 10 === 0) tag(b);
  if (b.state === 10) return;                    // the Final Broadcast runs on its own
  if (t - b.lastSeen > 1200) return abandon(b, b.fighters.size ? "won" : "left");
  const hp = health(e);
  const frac = hp ? hp.cur / hp.max : 1;
  if (b.phase === 1 && frac <= P2) return actTwo(b);
  if (b.phase === 2 && frac <= P3 && !b.finalDone && b.state !== 13) { b.finalDone = true; save(b); finalBroadcast(b); return; }
  arena(b, t);
  tickWaves(b, t);
  tickEchoes(b, t);
  tickTowers(b, t);
  if (b.phase === 3 && t % 30 === 0) rainPixel(b);
  const tg = target(b);
  const fast = b.phase === 3 ? 0.6 : b.phase === 2 ? 0.8 : 1;
  switch (b.state) {
    case 0: {
      root(b, false);
      if (!tg) return;
      const d = V.dist(tg.location, e.location);
      // hunting: it walks you down on its own (navigation); if you run, it blinks in after you
      if (d > 14 && t - b.blinkAt > (b.phase === 3 ? 40 : 70)) {
        b.blinkAt = t;
        const f = V.flat(V.sub(tg.location, e.location));
        blink(b, at(tg.location, -f.x * 5, 0, -f.z * 5));
      }
      if (t < b.cd) return;
      return choose(b, tg, d, fast);
    }
    case 1: {   // STATIC SLAM
      b.t -= 2;
      if (b.t % 4 === 0) telegraphRing(dim, b.center, 3.4, C.grey, 0.9);
      if (b.t <= 0) {
        slamFx(dim, b.center, 3.4, C.white);
        fx(dim, "origin:flash", at(b.center, 0, 0.5, 0), C.white, 1, { size: 3 }); fx(dim, "origin:glitch", at(b.center, 0, 0.8, 0), C.white, 1); fx(dim, "origin:dust", b.center, C.white, 1);
        sound(dim, "mob.warden.sonic_boom", b.center, 1.2, 0.8);
        for (const p of players(b)) if (V.hdist(p.location, b.center) <= 3.4) hurt(b, p, 8, 0.5);
        return recover(b, 26, true);
      }
      return;
    }
    case 3: {   // recovering (sometimes EXPOSED)
      b.t -= 2;
      if (b.t % 6 === 0) fx(dim, "origin:glitch", at(e.location, 0, 2, 0), (b.exposedUntil ?? 0) > t ? RED : C.grey, 0.6);
      if (b.t <= 0) { setState(b, 0); root(b, false); b.cd = t + Math.round(20 * fast); }
      return;
    }
    case 4: {   // CHANNEL HOP: afterimage left behind, then blink behind the target
      b.t -= 2;
      if (b.t > 0 || !tg) return;
      spawnEcho(b, { ...e.location }, 30);
      const f = V.flat(V.sub(tg.location, e.location));
      blink(b, at(tg.location, f.x * 2.2, 0, f.z * 2.2), tg.location);
      return recover(b, 10);
    }
    case 5: {   // SIGNAL LOST: pull into the Static
      b.t -= 2;
      if (tg && b.t % 4 === 0) telegraphRing(dim, tg.location, 1 + b.t / 12, C.white, 0.9);
      if (b.t <= 0) {
        b.used.pull = t;
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
      drawBeam(dim, V.sub(head, side), V.sub(end, side), { ...STYLES.laser, glow: CYAN, sheath: hexToRgb("#9ffcff"), width: 0.26, coreW: 0.05 }, now(), { life: 0.16 });
      drawBeam(dim, head, end, { ...STYLES.laser, glow: C.white, core: C.white, width: 0.1, coreW: 0.05, sheath: null }, now(), { life: 0.16 });
      fx(dim, "origin:beam_flare", end, RED, 0.9, { size: 1.2 });
      for (const p of players(b, 24)) {
        const v = V.sub(at(p.location, 0, 1, 0), head);
        const along = V.dot(v, dir);
        if (along < 0 || along > 18) continue;
        const off = V.len(V.sub(v, V.mul(dir, along)));
        if (off < 1.5 && (b.hitAt?.[p.id] ?? -99) + 10 <= t) { (b.hitAt ??= {})[p.id] = t; hurt(b, p, 4, 0.2); }
      }
      if (b.t <= 0) { b.phase6 = null; return recover(b, 30, true); }
      return;
    }
    case 7: {   // TEST PATTERN: rolling color-bar shockwaves (jump them)
      b.t -= 2;
      if (b.t % 8 === 0 && b.t >= 0) {
        b.waves.push({ r: 1, c: { ...e.location }, made: t, hit: new Set(), col: BARS[(b.waves.length + b.moves) % BARS.length] });
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
        for (const q of b.pix) pixelSlam(b, q);
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
    case 12: {  // GLITCH CLAW: wind-up (red screen), then three lunging slashes
      b.t -= 2;
      if (tg && b.combo === 0) face(b, tg.location);
      if (b.t > 0) {
        if (b.t % 4 === 0) fx(dim, "origin:flash", at(e.location, 0, 2.6, 0), RED, 0.9, { size: 0.9 });
        return;
      }
      if (b.combo >= 3) return recover(b, 24, true);
      b.combo++;
      b.t = b.phase === 3 ? 6 : 8;
      const aim = tg ? V.flat(V.sub(tg.location, e.location)) : V.flat(e.getViewDirection());
      const dest = at(e.location, aim.x * 2, 0, aim.z * 2);
      try { if (!e.tryTeleport(dest, { checkForBlocks: true, facingLocation: at(dest, aim.x * 3, 0, aim.z * 3) })) face(b, at(e.location, aim.x, 0, aim.z)); } catch { }
      const c = at(e.location, aim.x * 1.4, 1.2, aim.z * 1.4);
      fx(dim, "origin:slash_arc", c, b.combo % 2 ? RED : C.white, 1, { size: 2.6, rot: b.combo % 2 ? 35 : -35 });
      fx(dim, "origin:glitch", c, C.white, 1);
      sound(dim, "origin.sfx.sweep", c, 0.8 + b.combo * 0.12, 1);
      for (const p of players(b, 8, e.location)) {
        const to = V.sub(p.location, e.location), dd = V.len(to);
        if (dd > 3 || V.dot(V.flat(to), aim) < 0.2) continue;
        hurt(b, p, b.combo === 3 ? 7 : 5, b.combo === 3 ? 0.6 : 0.3, aim);
      }
      return;
    }
    case 13: {  // OVERLOAD: on its knees, BUFFERING, wide open
      b.t -= 2;
      if (b.t % 8 === 0) { fx(dim, "origin:glitch", at(e.location, 0, 1.8, 0), C.white, 1); fx(dim, "origin:spark", at(e.location, 0, 2.2, 0), CYAN, 1); }
      if (b.t % 20 === 0) for (const p of players(b, 40)) psound(p, "random.click", 0.6 + Math.random() * 0.3, 0.6);
      if (b.t <= 0) { b.exposedUntil = 0; sound(dim, "mob.warden.roar", e.location, 1.5, 0.6); setState(b, 0); root(b, false); b.cd = now() + 20; }
      return;
    }
    case 14: {  // CHANNEL SURF: it zaps from screen to screen around you - each landing spot flickers first
      b.t -= 2;
      if (!tg) return recover(b, 10);
      if (!b.surf) {
        if (b.surfN >= (b.phase === 3 ? 5 : 3)) return recover(b, 28, true);
        const a = Math.random() * Math.PI * 2;
        b.surf = { at: at(tg.location, Math.cos(a) * 3, 0, Math.sin(a) * 3), t: 10 };
        sound(dim, "random.click", b.surf.at, 1.8, 0.6);
      }
      const s = b.surf;
      s.t -= 2;
      telegraphRing(dim, s.at, 1.2, s.t % 4 === 0 ? RED : C.white, 1);
      fx(dim, "origin:static_dot", at(s.at, 0, 1 + Math.random(), 0), C.white, 1);
      if (s.t > 0) return;
      spawnEcho(b, { ...e.location }, 16);
      blink(b, s.at, tg.location);
      const aim = V.flat(V.sub(tg.location, e.location));
      fx(dim, "origin:slash_arc", at(e.location, aim.x * 1.2, 1.2, aim.z * 1.2), RED, 1, { size: 2.8, rot: Math.random() * 90 - 45 });
      sound(dim, "origin.sfx.sweep2", e.location, 1.1, 1);
      for (const p of players(b, 6, e.location)) if (V.dist(p.location, e.location) < 3.2) hurt(b, p, 5, 0.45, aim);
      b.surf = null; b.surfN++;
      return;
    }
  }
}
// what to do next: depends on range and act, never the same move three times in a row
function choose(b, tg, d, fast) {
  const t = now(), hp = health(b.e);
  b.moves++;
  const opts = [];
  const add = (s, w, ticks) => { if (w > 0 && !(b.last[0] === s && b.last[1] === s)) opts.push([s, w, ticks]); };
  if (d < 4.5) { add(12, 5, 12); add(1, 2, Math.round(18 * fast)); }
  if (d < 14) { add(6, 2, Math.round(26 * fast)); add(7, b.moves % 4 === 0 ? 4 : 1.5, Math.round(24 * fast)); add(1, 2, Math.round(18 * fast)); }
  if (d >= 4.5) { add(4, d > 7 ? 3 : 1, 10); add(9, 1.5, 16); }
  if (b.phase >= 2) {
    if (t - (b.used.pull ?? -9999) > 600) add(5, 1.5, Math.round(30 * fast));
    if (!b.echoes.length) add(8, 1.5, 20);
    if (t - (b.used.jam ?? -9999) > 500) add(11, 1.2, 50);
  }
  if (b.phase === 3) { add(14, 4, 6); add(12, 2, 10); }
  if (!opts.length) add(1, 1, 18);
  const total = opts.reduce((a, o) => a + o[1], 0);
  let r = Math.random() * total, pick = opts[0];
  for (const o of opts) { r -= o[1]; if (r <= 0) { pick = o; break; } }
  b.last.unshift(pick[0]); b.last.length = 2;
  return start(b, pick[0], tg, pick[2]);
}
function dirAt(a, dy = -0.12) { const v = { x: -Math.sin(a), y: dy, z: Math.cos(a) }; const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; }
function start(b, s, tg, ticks) {
  const e = b.e, dim = e.dimension;
  b.t = ticks;
  setState(b, s);
  if (s !== 4) root(b, true);
  face(b, tg.location);
  if (s === 1) { b.center = { ...tg.location }; sound(dim, "mob.warden.heartbeat", e.location, 1, 0.8); }
  if (s === 4) fx(dim, "origin:void_swirl", at(e.location, 0, 1, 0), C.grey, 1);
  if (s === 5) { readFx(dim, e.getHeadLocation()); try { tg.onScreenDisplay.setActionBar("§fbreak line of sight!"); } catch { } }
  if (s === 6) {
    const to = V.flat(V.sub(tg.location, e.location));
    const base = Math.atan2(-to.x, to.z);
    b.sweep = (Math.random() < 0.5 ? 1 : -1) * (b.phase >= 2 ? 2.4 : 1.8);
    b.a0 = base - b.sweep / 2;
    const hd = Math.max(2, V.hdist(tg.location, e.location));
    b.dy = Math.max(-0.5, Math.min(0.3, ((tg.location.y + 1) - (e.location.y + 2.4)) / hd));
    b.phase6 = "charge";
    sound(dim, "beacon.activate", e.location, 2, 1.4);
  }
  if (s === 7) sound(dim, "mob.warden.sonic_charge", e.location, 1.4, 0.7);
  if (s === 8) readFx(dim, e.getHeadLocation());
  if (s === 9) sound(dim, "random.click", e.location, 2, 0.5);
  if (s === 11) {
    b.used.jam = now(); b.jam = null;
    for (const p of players(b)) nullCard(p, "jam", "§lINTERFERENCE\n§r§7hold on to something", 50);
    sound(dim, "origin.sfx.highpitch", e.location, 0.8, 0.8);
  }
  if (s === 12) { b.combo = 0; sound(dim, "mob.warden.heartbeat", e.location, 1.6, 1); sound(dim, "origin.sfx.highpitch", e.location, 1.6, 0.4); }
  if (s === 14) { b.surf = null; b.surfN = 0; for (const p of players(b)) nullCard(p, "hit", "§lCHANNEL SURF", 12); sound(dim, "mob.endermen.portal", e.location, 0.6, 1); }
}
// exposed = after a big move it stays down a beat longer and every hit lands harder
function recover(b, ticks, exposed = false) {
  setState(b, 3); b.t = ticks;
  if (exposed) {
    b.exposedUntil = now() + ticks;
    fx(b.e.dimension, "origin:flash", at(b.e.location, 0, 2.6, 0), hexToRgb("#ffd36a"), 1, { size: 1.4 });
    try { popNumber(b.e.dimension, at(b.e.location, 0, 3.4, 0), "§e§lEXPOSED"); } catch { }
  }
}
function blink(b, dest, faceAt = null) {
  const e = b.e, dim = e.dimension;
  fx(dim, "origin:void_swirl", at(e.location, 0, 1.4, 0), C.grey, 1);
  try { if (!e.tryTeleport(dest, { checkForBlocks: true, ...(faceAt ? { facingLocation: faceAt } : {}) })) e.teleport(at(b.home, 0, 0, 0)); } catch { }
  fx(dim, "origin:void_swirl", at(e.location, 0, 1.4, 0), C.grey, 1);
  fx(dim, "origin:glitch", at(e.location, 0, 1.4, 0), C.white, 1);
  sound(dim, "mob.endermen.portal", e.location, 1, 0.5);
}
function seesTarget(e, tg) {
  try {
    const from = at(e.location, 0, 2.4, 0), to = tg.getHeadLocation();
    const d = V.sub(to, from);
    return !e.dimension.getBlockFromRay(from, V.norm(d), { maxDistance: V.len(d), includePassableBlocks: false });
  } catch { return true; }
}
function pixelSlam(b, q) {
  const dim = b.e.dimension;
  for (let y = 6; y >= 0; y -= 2) fx(dim, "origin:static_dot", at(q, 0, y, 0), Math.random() < 0.5 ? C.white : C.grey, 1);
  fx(dim, "origin:boom_smoke", q, C.grey, 0.6);
  for (const pl of players(b, 30)) if (V.hdist(pl.location, q) < 1.6 && Math.abs(pl.location.y - q.y) < 3) hurt(b, pl, 6, 0.5);
}
// act three: the floor keeps dropping dead pixels near whoever it's fighting
function rainPixel(b) {
  const dim = b.e.dimension;
  for (const pl of players(b, b.R + 4)) {
    const q = at(pl.location, (Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5);
    let k = 0;
    const tick = () => {
      if (!valid(b.e)) return;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) fx(dim, "origin:dot", at(q, dx * 0.8, 0.15, dz * 0.8), k % 2 ? RED : C.white, 1);
      if (++k < 6) system.runTimeout(tick, 4); else pixelSlam(b, q);
    };
    tick();
  }
}

function tickWaves(b, t) {
  const dim = b.e.dimension;
  b.waves = b.waves.filter((w) => w.r < 18);
  for (const w of b.waves) {
    w.r += 0.55;
    const c = w.c ?? b.e.location;
    const n = Math.floor(w.r * 3);
    for (let i = 0; i < n; i += 2) {
      const a = (i / n) * Math.PI * 2;
      const col = BARS[Math.floor((i / n) * BARS.length) % BARS.length];
      fx(dim, "origin:dot", at(c, Math.cos(a) * w.r, 0.25, Math.sin(a) * w.r), col, 1);
      if (i % 6 === 0) fx(dim, "origin:dot", at(c, Math.cos(a) * w.r, 0.9, Math.sin(a) * w.r), col, 0.8);
    }
    for (const p of players(b, w.r + 2, c)) {
      if (w.hit.has(p.id)) continue;
      const d = V.hdist(p.location, c);
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

// ------------------------------------------------------------------ ACT TWO: the signal towers
async function actTwo(b) {
  const e = b.e, dim = e.dimension;
  b.phase = 2; b.R = ARENA[2];
  save(b);
  setState(b, 10); root(b, true);
  readFx(dim, e.getHeadLocation());
  sound(dim, "mob.warden.roar", e.location, 1.6, 0.6);
  for (const p of players(b)) { nullCard(p, "lost", "§lSIGNAL LOST\n§r§7it's calling for backup", 50); try { cmd(p, "camerashake add @s 0.6 0.6 positional"); } catch { } }
  for (let i = 0; i < 20; i++) { fx(dim, "origin:static_dot", at(e.location, (Math.random() - 0.5) * 2, Math.random() * 4, (Math.random() - 0.5) * 2), Math.random() < 0.5 ? C.white : CYAN, 1); }
  await system.waitTicks(30);
  if (!valid(e)) return;
  raiseTowers(b);
  for (const p of players(b)) msg(p, "§8[§7NULL§8] §7Act two: §cSIGNAL LOST§7. §bThree signal towers§7 are shielding it - §fbring them down§7 and it overloads.");
  setState(b, 0); root(b, false); b.cd = now() + 30;
}
function raiseTowers(b) {
  const e = b.e, dim = e.dimension;
  for (const x of b.towers) { try { if (valid(x.e)) x.e.remove(); } catch { } }
  try { for (const old of dim.getEntities({ type: TOWER, location: b.home, maxDistance: b.R + 16 })) old.remove(); } catch { }   // left over from before a reload
  b.towers = [];
  const n = 3, a0 = Math.random() * Math.PI * 2;
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2, r = b.R - 3;
    let spot = at(b.home, Math.cos(a) * r, 0, Math.sin(a) * r);
    try { const top = dim.getTopmostBlock({ x: spot.x, z: spot.z }); if (top && Math.abs(top.location.y + 1 - b.home.y) < 6) spot = { x: spot.x, y: top.location.y + 1, z: spot.z }; } catch { }
    let tw = null;
    try { tw = dim.spawnEntity(TOWER, spot); tw.nameTag = "§bSignal Tower"; } catch { }
    if (!tw) continue;
    b.towers.push({ e: tw, next: now() + 60 + k * 25 });
    slamFx(dim, spot, 3, CYAN);
    fx(dim, "origin:pillar", spot, CYAN, 1);
    sound(dim, "random.anvil_land", spot, 0.6, 1);
  }
}
function tickTowers(b, t) {
  if (!b.towers.length) return;
  const dim = b.e.dimension, head = at(b.e.location, 0, 2.6, 0);
  const alive = b.towers.filter((x) => valid(x.e));
  for (const x of alive) {
    const top = at(x.e.location, 0, 3.6, 0);
    if (t % 6 === 0) drawBeam(dim, top, head, { ...STYLES.laser, glow: CYAN, core: C.white, sheath: null, width: 0.07, coreW: 0.02 }, t, { life: 0.35 });
    if (t >= x.next) {   // sniping: a red blink on the antenna, then a bolt at whoever is nearest
      const tg = players(b, 40, x.e.location).sort((p, q) => V.dist(p.location, x.e.location) - V.dist(q.location, x.e.location))[0];
      if (!tg) { x.next = t + 40; continue; }
      if (!x.aim) { x.aim = t + 16; try { x.e.setProperty("origin:hot", 1); } catch { } sound(dim, "random.click", top, 1.6, 0.6); }
      else if (t >= x.aim) {
        const to = tg.getHeadLocation();
        drawBeam(dim, top, to, { ...STYLES.laser, glow: RED, width: 0.12, coreW: 0.04 }, t, { life: 0.25 });
        fx(dim, "origin:spark", to, RED, 1);
        sound(dim, "origin.sfx.shock", top, 1.4, 0.8);
        if (seesTarget(x.e, tg)) hurt(b, tg, 4, 0.2);
        x.aim = 0; x.next = t + (b.phase === 3 ? 50 : 80) + Math.floor(Math.random() * 30);
        try { x.e.setProperty("origin:hot", 0); } catch { }
      } else line(dim, "origin:dot", top, tg.getHeadLocation(), RED, 2.5, 0.5);
    }
  }
  if (!alive.length) {   // the last one fell: OVERLOAD
    b.towers = [];
    b.towersDone = true; save(b);
    const e = b.e;
    for (const p of players(b)) { nullCard(p, "lost", "§lOVERLOAD\n§r§eit's buffering - hit it now!", 40); psound(p, "random.levelup", 0.6, 0.6); }
    sound(dim, "mob.warden.sonic_boom", e.location, 0.8, 1);
    slamFx(dim, e.location, 4, CYAN);
    setState(b, 13); root(b, true);
    b.t = 120;
    b.exposedUntil = now() + 120;
  }
}
export function onTowerDeath(e) {
  const dim = e.dimension;
  fx(dim, "origin:flash", at(e.location, 0, 3, 0), CYAN, 1, { size: 2.2 });
  for (let i = 0; i < 14; i++) fx(dim, "origin:spark", at(e.location, 0, 1 + Math.random() * 3, 0), i % 2 ? CYAN : C.white, 1);
  sound(dim, "random.explode", e.location, 1.3, 0.8);
  sound(dim, "random.glass", e.location, 0.8, 1);
}

// damage NULL takes: shielded by its towers, open while EXPOSED or BUFFERING, tougher against a crowd
export function onNullHurtBefore(ev) {
  const e = ev.hurtEntity;
  if (e?.typeId !== NULL) return false;
  const b = brains.get(e.id);
  if (!b) return false;
  if (b.state === 10) { ev.cancel = true; return true; }        // mid-cutscene
  let k = 1;
  const shielded = b.towers.some((x) => valid(x.e));
  if (shielded) k *= 0.25;
  if ((b.exposedUntil ?? 0) > now()) k *= b.state === 13 ? 1.6 : 1.35;
  const n = Math.max(1, players(b, b.R + 6).length);
  k /= 1 + 0.35 * (n - 1);
  ev.damage = Math.min(40, ev.damage * k);
  if (shielded && Math.random() < 0.3) system.run(() => { if (valid(e)) { fx(e.dimension, "origin:shockwave", at(e.location, 0, 1.5, 0), CYAN, 0.8, { radius: 1.4 }); sound(e.dimension, "item.shield.block", e.location, 1.4, 0.6); } });
  return false;
}

export function forgetNull(e) {
  const b = brains.get(e.id);
  if (b) {
    for (const x of b.echoes) { try { x.e.remove(); } catch { } }
    for (const x of b.towers) { try { if (valid(x.e)) x.e.remove(); } catch { } }
  }
  brains.delete(e.id);
}

// ------------------------------------------------------------------ FINAL BROADCAST (cinematic move, once per fight)
async function finalBroadcast(b) {
  const e = b.e, dim = e.dimension;
  setState(b, 10); root(b, true);
  try { e.addEffect("resistance", 200, { amplifier: 5, showParticles: false }); } catch { }
  for (const x of b.towers) { try { if (valid(x.e)) x.e.remove(); } catch { } }
  b.towers = [];
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
  }, { skippable: false, kind: "boss" }));
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
  if (!valid(e)) return;
  try { e.removeEffect("resistance"); } catch { }
  // ACT THREE
  b.phase = 3; b.R = ARENA[3];
  save(b);
  for (const p of players(b, 40)) { nullCard(p, "lost", "§lDEAD CHANNEL\n§r§cit's not holding back any more", 40); msg(p, "§8[§7NULL§8] §7Act three: §4DEAD CHANNEL§7. Watch for the §cflicker§7 where it's about to land."); }
  sound(dim, "mob.warden.roar", e.location, 1.2, 0.8);
  recover(b, 20);
}
