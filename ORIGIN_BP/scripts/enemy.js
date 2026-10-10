// ORIGIN v0.02 - enemy.js
// Rift Brute: a readable heavy that LEARNS how you fight.
//   - Use the same Form 3 times in a row and it reads it: Guard (60% less damage) + a counter.
//   - Dodge the same way twice and it predicts you: longer slams if you back off, 360 stomps if you sidestep.
//   - Stay at range and it throws rocks; read your Blast and it charges you down.
//   - Punish it 3 times and it stops leaving openings: shorter recovery and a second slam.
// States (property origin:state): 0 idle, 1 slam windup, 2 slam, 3 recover, 4 throw windup, 5 charge
import { world, EntityDamageCause, GameMode } from "@minecraft/server";
import { hero, RT, combat, markDirty, bar, BAR, ICON, PARTS } from "./data.js";
import { V, at, valid, fx, line, sound, C, now, cmd, yawTo, health, hexToRgb } from "./util.js";
import { fearOf } from "./dread.js";
import { quip, hudMsg } from "./voice.js";
import { slamFx, readFx, telegraphRing, telegraphLine } from "./vfx.js";
import { popNumber, setDodgeHooks } from "./combat.js";

export const BRUTE = "origin:rift_brute";
export const DUMMY = "origin:training_dummy";
const ORANGE = hexToRgb("#FF8A1F");
const DIMS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end", "origin:inner_world"];

const brutes = new Map(); // id -> brain
let scanAt = 0;

function brain(e) {
  let b = brutes.get(e.id);
  if (!b) {
    b = { e, state: 0, t: 0, total: 20, cd: now() + 20, center: null, radius: 2.6, color: C.crimson, kind: "slam",
      mem: new Map(), cycle: 0, second: false, dazed: false, rangeSince: null, throwCd: 0, chargeCd: 0, counterCd: 0,
      watch: new Map(), marker: null, dir: null, steps: 0, hitSet: new Set(), target: null };
    brutes.set(e.id, b);
    try { e.setProperty("origin:state", 0); e.triggerEvent("origin:unroot"); } catch { }
    updateTag(b);
  }
  return b;
}
function mem(b, player) {
  let m = b.mem.get(player.id);
  if (!m) { m = { lastForm: null, streak: 0, read: null, variety: 0, dodges: [], predict: null, punishes: 0, adapted: false, throwsDodged: 0, lead: false }; b.mem.set(player.id, m); }
  return m;
}
function setState(b, s) {
  b.state = s;
  try { b.e.setProperty("origin:state", s); } catch { }
}
function updateTag(b) {
  const hp = health(b.e);
  if (!hp) return;
  let read = "";
  for (const m of b.mem.values()) if (m.read) read = `\n§e${ICON.read} §7reads §e${PARTS.forms[m.read]?.name ?? m.read}`;
  let adapt = "";
  for (const m of b.mem.values()) if (m.adapted) adapt = ` §6${ICON.shield}`;
  try { b.e.nameTag = `§cRift Brute${adapt}\n§f${bar(BAR.health, hp.cur / hp.max, 10)}${read}`; } catch { }
}

function nearPlayers(dim, loc, r) {
  try { return dim.getPlayers({ location: loc, maxDistance: r, excludeGameModes: [GameMode.Creative, GameMode.Spectator] }); } catch { return []; }
}
function rescan() {
  for (const id of DIMS) {
    let list = [];
    try { list = world.getDimension(id).getEntities({ type: BRUTE }); } catch { }
    for (const e of list) brain(e);
  }
}

// every 2 ticks
export function tickBrutes() {
  const t = now();
  if (t >= scanAt) {
    scanAt = t + 20;
    rescan();
    for (const b of brutes.values()) if (valid(b.e)) updateTag(b);
  }
  for (const [id, b] of brutes) {
    if (!valid(b.e)) { brutes.delete(id); continue; }
    try { step(b, t); } catch { /* unloaded mid-step */ }
  }
}

function startSlam(b, target, opts = {}) {
  const e = b.e, loc = e.location;
  const m = mem(b, target);
  const f = V.flat(V.sub(target.location, loc));
  let kind = opts.kind ?? "slam";
  if (!opts.kind) {
    if (m.predict === "side") kind = "stomp";
    else if (m.predict === "back") kind = "long";
  }
  if (kind === "stomp") { b.center = { ...loc }; b.radius = 3.6; }
  else if (kind === "long") { b.center = { x: loc.x + f.x * 2.6, y: loc.y, z: loc.z + f.z * 2.6 }; b.radius = 3.0; }
  else { b.center = { x: loc.x + f.x * 1.3, y: loc.y, z: loc.z + f.z * 1.3 }; b.radius = 2.6; }
  b.kind = kind;
  b.color = opts.second ? ORANGE : kind === "slam" ? C.crimson : ORANGE;
  const fear = fearOf(e);
  b.total = (opts.second ? 12 : 20) + (fear === "dread" ? 10 : fear === "unease" ? 4 : 0);
  b.t = b.total;
  b.target = target;
  b.watch.clear();
  for (const p of nearPlayers(e.dimension, b.center, b.radius + 3)) b.watch.set(p.id, { ...p.location });
  setState(b, 1);
  e.triggerEvent("origin:root");
  e.setRotation({ x: 0, y: yawTo(loc, target.location) });
  sound(e.dimension, "mob.ravager.roar", loc, opts.second ? 1.0 : 0.75, 0.9);
  sound(e.dimension, "origin.sfx.hum", loc, 0.5, 1);
  for (const p of nearPlayers(e.dimension, loc, 16)) {
    const h = hero(p);
    if (!h.awakened) continue;
    if (h.stats.tells < 1) {
      h.stats.tells = 1;
      markDirty(p);
      quip(p, "tell_first", "Red glow means MOVE. Out of the circle. Now. (Double-tap sneak to dodge.)", 600);
    } else if (opts.second) quip(p, "second", "It's not done. Second hit!", 1200, false);
    else if (kind !== "slam") quip(p, "predict_" + kind, kind === "stomp" ? "It's hitting all around itself now. Back OUT, not sideways." : "Bigger circle. It knows you back off.", 2400, false);
  }
}

function startThrow(b, target) {
  const e = b.e;
  const m = mem(b, target);
  let mk = { ...target.location };
  if (m.lead) {
    const v = target.getVelocity();
    mk = { x: mk.x + v.x * 12, y: mk.y, z: mk.z + v.z * 12 };
  }
  b.marker = mk;
  b.target = target;
  b.phase = "aim";
  b.t = 16;
  b.throwCd = now() + 120;
  setState(b, 4);
  e.triggerEvent("origin:root");
  e.setRotation({ x: 0, y: yawTo(e.location, mk) });
  sound(e.dimension, "mob.zombie.woodbreak", e.location, 0.6, 0.8);
  quip(target, "throw", m.lead ? "It's aiming where you're GOING now. Change direction late." : "Rock incoming. Watch the circle on the ground.", 2400, false);
}

function startCharge(b, target) {
  const e = b.e;
  b.dir = V.flat(V.sub(target.location, e.location));
  b.phase = "aim";
  b.t = 18;
  b.steps = 0;
  b.hitSet.clear();
  b.target = target;
  b.chargeCd = now() + 160;
  setState(b, 5);
  e.triggerEvent("origin:root");
  e.setRotation({ x: 0, y: yawTo(e.location, target.location) });
  sound(e.dimension, "mob.ravager.roar", e.location, 0.6, 1);
  quip(target, "charge", "It's lining you up. Get off the line!", 1200, false);
}

function blocked(dim, loc) {
  try {
    for (const dy of [0.2, 1.4]) {
      const bl = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y + dy), z: Math.floor(loc.z) });
      if (bl && !bl.isAir && !bl.isLiquid) {
        const id = bl.typeId;
        if (!/grass|flower|tulip|bush|carpet|light_block|fern|torch|lantern|snow_layer|vine|sapling/.test(id)) return true;
      }
    }
  } catch { return true; }
  return false;
}

function hurt(b, p, dmg, push, cause = "slam") {
  try {
    p.applyDamage(dmg, { cause: EntityDamageCause.entityAttack, damagingEntity: b.e });
    p.applyKnockback({ x: push.x, z: push.z }, 0.45);
  } catch { }
  combat(p);
  popNumber(p.dimension, p.getHeadLocation(), `§c-${dmg}`);
}

function step(b, t) {
  const e = b.e;
  const dim = e.dimension;
  const loc = e.location;
  switch (b.state) {
    case 0: {
      if (t < b.cd) return;
      const near = nearPlayers(dim, loc, 20);
      if (!near.length) { b.rangeSince = null; return; }
      let target = near[0];
      for (const p of near) if (V.dist(p.location, loc) < V.dist(target.location, loc)) target = p;
      const d = V.dist(target.location, loc);
      const m = mem(b, target);
      if (d > 7) b.rangeSince = b.rangeSince ?? t; else b.rangeSince = null;
      if (d <= 3.8) {
        b.second = m.adapted && (b.cycle++ % 2 === 0);
        return startSlam(b, target);
      }
      if (b.rangeSince !== null && t - b.rangeSince > 60 && t > b.throwCd && d < 18) return startThrow(b, target);
      if (d > 4.5 && d < 11 && t > b.chargeCd && (m.read === "blast" || Math.random() < 0.015)) return startCharge(b, target);
      return;
    }
    case 1: {
      b.t -= 2;
      const prog = 1 - b.t / b.total;
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t * 0.6));
      if (b.t % 4 === 0 || b.t <= 4) {
        telegraphRing(dim, b.center, b.radius, b.color, pulse);
        telegraphRing(dim, b.center, Math.max(0.3, b.radius * prog), C.white, 0.85);
      }
      if (b.t % 6 === 0) fx(dim, "origin:rise", at(loc, 0, 0.2, 0), b.color, 0.6);
      if (b.t <= 0) slam(b, dim);
      return;
    }
    case 2: {
      b.t -= 2;
      if (b.t <= 0) {
        if (b.second) {
          b.second = false;
          const tg = valid(b.target) ? b.target : null;
          if (tg) return startSlam(b, tg, { second: true, kind: "stomp" });
        }
        setState(b, 3);
        const m = valid(b.target) ? mem(b, b.target) : null;
        b.t = b.dazed ? 44 : m?.adapted ? 16 : 26;
        b.dazed = false;
      }
      return;
    }
    case 3: {
      b.t -= 2;
      if (b.t % 8 === 0) fx(dim, "origin:wisp", at(loc, 0, 2.2, 0), C.gold, 0.7);
      if (b.t <= 0) { setState(b, 0); b.cd = t + 30; e.triggerEvent("origin:unroot"); }
      return;
    }
    case 4: { // rock throw
      b.t -= 2;
      if (b.phase === "aim") {
        if (b.t % 4 === 0) {
          telegraphRing(dim, b.marker, 1.8, ORANGE, 0.9);
          telegraphRing(dim, b.marker, Math.max(0.3, 1.8 * (1 - b.t / 16)), C.white, 0.8);
        }
        if (b.t <= 0) { b.phase = "fly"; b.t = 10; b.from = at(loc, 0, 2.6, 0); sound(dim, "mob.irongolem.throw", loc, 0.5, 1); }
        return;
      }
      if (b.phase === "fly") {
        const k = 1 - b.t / 10;
        const p = V.lerp(b.from, b.marker, k);
        p.y += Math.sin(k * Math.PI) * 4;
        fx(dim, "origin:debris", p, C.dust, 0.9);
        fx(dim, "origin:trail", p, ORANGE, 0.9);
        if (b.t <= 0) {
          slamFx(dim, b.marker, 1.8, ORANGE);
          sound(dim, "random.explode", b.marker, 0.9, 0.7);
          let hitAny = false;
          for (const p2 of nearPlayers(dim, b.marker, 2.2)) {
            if (V.hdist(p2.location, b.marker) <= 1.9 && Math.abs(p2.location.y - b.marker.y) < 2.5) {
              hurt(b, p2, 7, V.mul(V.flat(V.sub(p2.location, b.marker)), 0.9));
              hitAny = true;
            }
          }
          if (!hitAny && valid(b.target)) {
            const m = mem(b, b.target);
            m.throwsDodged++;
            if (m.throwsDodged >= 2 && !m.lead) { m.lead = true; readFx(dim, e.getHeadLocation()); }
          }
          setState(b, 3);
          b.t = 16;
        }
      }
      return;
    }
    case 5: { // charge
      if (b.phase === "aim") {
        b.t -= 2;
        if (b.t % 4 === 0) telegraphLine(dim, loc, at(loc, b.dir.x * 10, 0, b.dir.z * 10), C.crimson);
        if (b.t <= 0) { b.phase = "run"; b.steps = 0; sound(dim, "mob.ravager.roar", loc, 0.9, 1); }
        return;
      }
      b.steps++;
      const next = at(loc, b.dir.x * 1.6, 0, b.dir.z * 1.6);
      if (blocked(dim, next) || b.steps > 6) {
        slamFx(dim, loc, 1.6, C.crimson);
        setState(b, 3);
        b.t = 24;
        return;
      }
      try { e.teleport(next, { keepVelocity: false }); } catch { }
      fx(dim, "origin:debris", at(loc, 0, 0.2, 0), C.dust, 0.8);
      for (const p of nearPlayers(dim, next, 1.8)) {
        if (b.hitSet.has(p.id)) continue;
        b.hitSet.add(p.id);
        hurt(b, p, 8, { x: b.dir.x * 1.4 - b.dir.z * 0.8, z: b.dir.z * 1.4 + b.dir.x * 0.8 });
      }
      return;
    }
  }
}

function slam(b, dim) {
  setState(b, 2);
  b.t = 4;
  const c = b.center;
  slamFx(dim, c, b.radius, b.color);
  sound(dim, "random.explode", c, 0.7, 0.9);
  sound(dim, "origin.sfx.double", c, 0.6, 1);
  sound(dim, "mace.heavy_smash_ground", c, 0.8, 0.8);
  for (const p of nearPlayers(dim, c, 12)) {
    const d = V.hdist(p.location, c);
    const inside = d <= b.radius + 0.3 && Math.abs(p.location.y - c.y) < 2.5;
    cmd(p, `camerashake add @s ${inside ? 0.6 : 0.25} 0.35 positional`);
    if (inside) hurt(b, p, 9, V.mul(V.flat(V.sub(p.location, c)), 1.2));
    // learn how this player avoids the slam
    const start = b.watch.get(p.id);
    if (start && !inside) learnDodge(b, p, V.sub(p.location, start));
  }
}

function learnDodge(b, p, disp) {
  if (Math.hypot(disp.x, disp.z) < 0.6) return;
  const m = mem(b, p);
  const a = V.flat(V.sub(p.location, b.e.location));
  const dn = V.flat(disp);
  const along = a.x * dn.x + a.z * dn.z;
  m.dodges.push(along > 0.5 ? "back" : "side");
  if (m.dodges.length > 4) m.dodges.shift();
  const last = m.dodges.slice(-3);
  const backs = last.filter((x) => x === "back").length;
  const sides = last.length - backs;
  const before = m.predict;
  m.predict = backs >= 2 ? "back" : sides >= 2 ? "side" : null;
  if (m.predict && m.predict !== before) {
    readFx(b.e.dimension, b.e.getHeadLocation());
    quip(p, "learn_dodge", "It's learning how you dodge. Switch it up.", 1800);
  }
}

// ------------------------------------------------------------------ hooks for moves / combat
export function onCast(player, form) {
  let list = [];
  try { list = player.dimension.getEntities({ type: BRUTE, location: player.location, maxDistance: 16 }); } catch { }
  for (const e of list) {
    const b = brain(e);
    const m = mem(b, player);
    if (form === m.lastForm) m.streak++;
    else {
      m.streak = 1;
      if (m.read && form !== m.read && ++m.variety >= 2) {
        m.read = null; m.variety = 0;
        hudMsg(player, "§a§lREAD BROKEN §r§7- it can't guess you now", 40);
        updateTag(b);
      }
    }
    m.lastForm = form;
    if (m.streak >= 3 && m.read !== form) {
      m.read = form; m.variety = 0;
      readFx(e.dimension, e.getHeadLocation());
      quip(player, "read_" + form, `It's reading your ${PARTS.forms[form]?.name ?? form}. Mix it up.`, 1200);
      updateTag(b);
    }
    if (m.read === "blast" && form === "blast" && b.state === 0 && V.dist(e.location, player.location) > 5 && now() > b.chargeCd) startCharge(b, player);
  }
}

export function modifyHit(e, player, form) {
  if (e.typeId !== BRUTE) return { mult: 1, tag: null };
  const b = brain(e);
  const m = mem(b, player);
  if (b.state === 3) {
    m.punishes++;
    if (m.punishes >= 3 && !m.adapted) {
      m.adapted = true;
      readFx(e.dimension, e.getHeadLocation());
      quip(player, "adapted", "It stopped leaving openings. Watch for the second hit.", 6000);
      updateTag(b);
    }
    return { mult: 1.5, tag: "punish" };
  }
  if (m.read && m.read === form) {
    fx(e.dimension, "origin:spark", e.getHeadLocation(), C.white, 1);
    sound(e.dimension, "random.anvil_land", e.location, 1.6, 0.5);
    if ((form === "strike" || form === "dash") && now() > b.counterCd && V.dist(e.location, player.location) < 4.5) {
      b.counterCd = now() + 40;
      hurt(b, player, form === "dash" ? 5 : 4, V.mul(V.flat(V.sub(player.location, e.location)), 1.5));
      hudMsg(player, form === "dash" ? "§c§lCAUGHT!" : "§c§lCOUNTERED!", 30);
      sound(e.dimension, "mob.ravager.stun", e.location, 1.2, 0.8);
    }
    return { mult: 0.4, tag: "guard" };
  }
  return { mult: 1, tag: null };
}

export function onHitBy(e, player, form) {
  if (e.typeId === DUMMY) {
    try { const h = e.getComponent("minecraft:health"); if (h && h.currentValue < h.effectiveMax * 0.5) h.resetToMaxValue(); } catch { }
    return;
  }
  if (e.typeId !== BRUTE) return;
  updateTag(brain(e));
}

// Telegraph that will land on this player within ~8 ticks (for perfect dodges)
function threatFor(player) {
  for (const b of brutes.values()) {
    if (!valid(b.e) || b.e.dimension.id !== player.dimension.id) continue;
    const l = player.location;
    if (b.state === 1 && b.t <= 8 && V.hdist(l, b.center) <= b.radius + 0.3) return b;
    if (b.state === 4 && b.phase === "fly" && V.hdist(l, b.marker) <= 2) return b;
    if (b.state === 5 && b.phase === "aim" && b.t <= 6) {
      const ap = V.sub(l, b.e.location);
      const along = ap.x * b.dir.x + ap.z * b.dir.z;
      const side = Math.abs(ap.x * b.dir.z - ap.z * b.dir.x);
      if (along > 0 && along < 10 && side < 1.8) return b;
    }
  }
  return null;
}
setDodgeHooks(threatFor, (player, dir, perfect) => {
  const b = threatFor(player) ?? [...brutes.values()].find((x) => valid(x.e) && V.dist(x.e.location, player.location) < 10);
  if (!b) return;
  if (perfect) {
    b.dazed = true;
    try { b.e.addEffect("slowness", 30, { amplifier: 3, showParticles: false }); } catch { }
  }
});

// ------------------------------------------------------------------ spawning / death
export function spawnBrute(dim, loc) {
  try {
    const e = dim.spawnEntity(BRUTE, loc);
    fx(dim, "origin:pillar", loc, C.crimson, 1);
    fx(dim, "origin:shockwave", at(loc, 0, 0.05, 0), C.crimson, 1, { radius: 2.5 });
    sound(dim, "mob.ravager.roar", loc, 0.7, 1);
    return e;
  } catch (err) {
    console.warn("[ORIGIN] brute spawn failed: " + err);
    return null;
  }
}

export function onBruteDeath(e, damageSource) {
  brutes.delete(e.id);
  const killer = damageSource?.damagingEntity;
  if (killer?.typeId === "minecraft:player") {
    const r = RT(killer);
    if (r.fight) r.fight.won = true;
    const a = hero(killer).arch;
    quip(killer, "brute_down", a === "energy" ? "That's what you get for glowing at us!" : a === "shadow" ? "It won't be back. Probably." : "Big one down. Not bad, rookie.", 400);
  }
}

export function bruteCount() {
  return brutes.size;
}
