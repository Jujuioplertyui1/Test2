// ORIGIN v0.02 - moves.js
// A move = Form + Element + Modifier + Finisher. Cast with the Power Focus.
import { system, EntityDamageCause } from "@minecraft/server";
import { hero, RT, markDirty, ARCH, PARTS, moveStats, maxEnergy, combat, COMBOS } from "./data.js";
import { V, at, valid, fx, line, sound, psound, C, now, clamp, rightOf, health, FX_IDS } from "./util.js";
import { addDread, applyFear } from "./dread.js";
import { hudMsg, quip } from "./voice.js";
import { ELEM, hitFx, slashFx, dashFx, beamFx, slamFx, chargeFx } from "./vfx.js";
import { popNumber, addCombo, hitStop } from "./combat.js";
import { onCast, modifyHit, onHitBy } from "./enemy.js";

const NO_HIT_TYPES = [...FX_IDS, 
  "minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:armor_stand", "minecraft:painting",
  "minecraft:leash_knot", "minecraft:fishing_hook", "minecraft:ender_pearl", "minecraft:snowball",
  "origin:manifestation", "origin:archetype_orb", "origin:float_text",
, "origin:lumen_construct", "origin:exo_piece", "origin:exo_drone"];

function targetsNear(ctx, center, radius) {
  let list = [];
  try {
    list = ctx.dim.getEntities({ location: center, maxDistance: radius, excludeTypes: NO_HIT_TYPES, excludeFamilies: ["player", "inanimate"] });
  } catch { }
  return list.filter((e) => e.id !== ctx.player.id && valid(e) && e.getComponent("minecraft:health"));
}

// ------------------------------------------------------------------ public
export function cycleActive(player) {
  const h = hero(player);
  if (!h.awakened) return;
  h.active = (h.active + 1) % 3;
  markDirty(player);
  hudMsg(player, `§fActive move: §e${h.moves[h.active].name}`, 50);
  psound(player, "random.click", 1.4, 0.6);
}

export function setActive(player, slot) {
  const h = hero(player);
  h.active = clamp(slot, 0, 2);
  markDirty(player);
}

export function archMult(player, h, overcharged) {
  const r = RT(player);
  if (h.arch === "brawler") return 1 + 0.12 * r.momentum;
  if (h.arch === "energy") return overcharged ? 1.4 : 1;
  if (h.arch === "shadow") return 1 + h.dread / 200;
  return 1;
}

export function addMomentum(player) {
  const h = hero(player);
  if (h.arch !== "brawler") return;
  const r = RT(player);
  const before = r.momentum;
  r.momentum = Math.min(5, r.momentum + 1);
  r.momentumAt = now();
  if (r.momentum === 5 && before < 5) {
    psound(player, "random.anvil_land", 1.8, 0.35);
    hudMsg(player, "§6§lMOMENTUM MAX", 30);
    fx(player.dimension, "origin:aura", player.location, ARCH.brawler.rgb, 1);
  }
}

export function tickMomentum(player) {
  const r = RT(player);
  if (r.momentum > 0 && now() - r.momentumAt > 60) r.momentum = Math.max(0, r.momentum - 1);
}

export function regen(player) {
  const h = hero(player);
  if (!h.awakened) return;
  const A = ARCH[h.arch];
  const max = maxEnergy(h);
  if (h.energy >= max) { h.energy = max; return; }
  const ooc = now() - RT(player).lastCombat > 160;
  h.energy = Math.min(max, h.energy + A.regen * (ooc ? 1.5 : 1));
  markDirty(player);
}

export function castActive(player) {
  return cast(player, hero(player).active);
}

// opts.draft: cast this move instead of a saved slot, for free (Move Forge test fire)
export async function cast(player, slot, opts = {}) {
  const h = hero(player);
  const r = RT(player);
  if (!h.awakened) { hudMsg(player, "§7Nothing happens. §8(You haven't awakened yet.)"); return false; }
  if (r.cine || (r.casting && !opts.echo) || r.traveling || r.caged || (r.station && !opts.draft)) return false;
  const m = opts.draft ?? opts.echo ?? h.moves[slot];
  if (!m) return false;
  const st = moveStats(m);
  const t = now();
  const A = ARCH[h.arch];
  const over = h.arch === "energy" && h.energy >= A.maxEnergy * 0.9;
  if (!opts.draft && !opts.echo) {
    if (r.cd[slot] > t) {
      hudMsg(player, `§7${m.name} is recharging... §c${((r.cd[slot] - t) / 20).toFixed(1)}s`, 25);
      psound(player, "random.click", 0.6, 0.4);
      return false;
    }
    const cost = Math.round(st.cost * (over ? 1.5 : 1));
    if (h.energy < cost) {
      hudMsg(player, `§bNot enough Energy §7(${Math.floor(h.energy)}/${cost})`, 30);
      psound(player, "random.fizz", 1.6, 0.4);
      return false;
    }
    h.energy -= cost;
    r.cd[slot] = t + Math.round(st.cd * ((r.awakenUntil ?? 0) > t ? 0.5 : 1));
    const fight = combat(player);
    fight.casts++;
    h.stats.casts++;
    addDread(player, 1);
    onCast(player, m.form);
  }
  r.casting = true;
  markDirty(player);

  const el = PARTS.elements[m.element] ?? PARTS.elements.kinetic;
  const mod = PARTS.modifiers[m.modifier] ?? PARTS.modifiers.none;
  const ctx = {
    player, h, m, el, mod, over, draft: !!opts.draft,
    rgb: (ELEM[m.element] ?? ELEM.kinetic).rgb,
    dim: player.dimension,
    mult: 1,
    hits: new Set(),
    form: PARTS.forms[m.form] ?? PARTS.forms.strike,
  };
  try {
    if (m.modifier === "charged") {
      try { player.addEffect("slowness", mod.windup + 2, { amplifier: 2, showParticles: false }); } catch { }
      psound(player, "origin.sfx.hum", 1.5, 0.7);
      chargeFx(ctx.dim, at(player.location, 0, 1.1, 0), ctx.rgb);
      for (let i = 0; i < mod.windup; i += 2) {
        if (!valid(player)) return false;
        const c = at(player.location, 0, 1.1, 0);
        const a = (i / mod.windup) * Math.PI * 4;
        const rad = 1.4 * (1 - i / mod.windup) + 0.2;
        fx(ctx.dim, "origin:dot", at(c, Math.cos(a) * rad, 0.2, Math.sin(a) * rad), ctx.rgb, 1);
        fx(ctx.dim, "origin:dot", at(c, -Math.cos(a) * rad, -0.2, -Math.sin(a) * rad), C.white, 1);
        await system.waitTicks(2);
      }
      if (!valid(player)) return false;
      fx(ctx.dim, "origin:impact", at(player.location, 0, 1.1, 0), ctx.rgb, 1, { size: 1.2 });
    }
    ctx.mult = archMult(player, h, over) * (mod.mult ?? 1) * ((r.awakenUntil ?? 0) > t ? 1.25 : 1);
    if (over) fx(ctx.dim, "origin:aura", player.location, C.gold, 1);
    // combos: the forms of your last few casts (within 3s) + this one
    if (!opts.draft && !opts.echo) {
      r.chain = (r.chain ?? []).filter((c) => t - c.t <= 60);
      r.chain.push({ f: m.form, t });
      const forms = r.chain.map((c) => c.f);
      const hitC = COMBOS.slice().sort((a, b) => b.seq.length - a.seq.length).find((c) => c.seq.length <= forms.length && c.seq.every((f, i) => forms[forms.length - c.seq.length + i] === f));
      if (hitC) {
        ctx.combo = hitC;
        ctx.mult *= hitC.mult;
        r.chain = [];
        h.surge = Math.min(100, (h.surge ?? 0) + 10);
        hudMsg(player, `§6§lCOMBO · ${hitC.name.toUpperCase()} §r§ex${hitC.mult}`, 40);
        psound(player, "random.levelup", 1.8, 0.5);
        fx(ctx.dim, "origin:shockwave", at(player.location, 0, 0.05, 0), C.gold, 1, { radius: 2.5 });
      }
    }
    if (opts.echo) ctx.mult *= 0.5;
    if (r.trial && !opts.draft) { r.trial.forms?.add(m.form); if (ctx.combo) r.trial.combos = (r.trial.combos ?? 0) + 1; }

    let impact;
    if (m.form === "dash") impact = doDash(ctx);
    else if (m.form === "blast") impact = doBlast(ctx);
    else if (m.form === "wave") impact = await doWave(ctx);
    else if (m.form === "leap") impact = await doLeap(ctx);
    else if (m.form === "nova") impact = doNova(ctx);
    else if (m.form === "volley") impact = await doVolley(ctx);
    else impact = doStrike(ctx);

    if (m.modifier === "area") doArea(ctx, impact, mod.radius ?? 3);
    if (m.finisher === "fear") doFearBurst(ctx, impact);
    finish(ctx, impact);
    if (m.modifier === "echo" && !opts.echo && !opts.draft) {
      system.runTimeout(() => { if (valid(player)) { fx(ctx.dim, "origin:wisp", at(player.location, 0, 1, 0), ctx.rgb, 1); cast(player, slot, { echo: m }); } }, 12);
    }
    if (!ctx.hits.size) psound(player, "random.fizz", 1.8, 0.15);
    return true;
  } catch (e) {
    console.warn("[ORIGIN] cast error: " + e);
    return false;
  } finally {
    r.casting = false;
  }
}

// ------------------------------------------------------------------ hit resolution
function hit(ctx, e, base, dir) {
  if (!valid(e) || ctx.hits.has(e.id)) return;
  ctx.hits.add(e.id);
  const p = ctx.player;
  let dmg = base * ctx.mult;
  if (ctx.m.finisher === "shatter") { const hp = health(e); if (hp && hp.cur < hp.max * 0.3) { dmg *= 2; ctx.shattered = true; } }
  const adj = modifyHit(e, p, ctx.m.form);   // brute guard / punish
  dmg *= adj.mult;
  const heavy = ctx.m.modifier === "charged" || adj.tag === "punish";
  try { e.applyDamage(dmg, { cause: EntityDamageCause.entityAttack, damagingEntity: p }); } catch { }
  let head;
  try { head = e.getHeadLocation(); } catch { head = e.location; }
  hitFx(ctx.dim, head, ctx.m.element, heavy);
  fx(ctx.dim, "origin:flash", head, ctx.rgb, heavy ? 1 : 0.7, { size: heavy ? 1.4 : 0.9 });
  const combo = ctx.draft ? 0 : addCombo(p);
  const col = adj.tag === "guard" ? "§7" : adj.tag === "punish" ? "§6§l" : heavy ? "§e§l" : "§f";
  popNumber(ctx.dim, head, `${col}${Math.round(dmg)}${adj.tag === "punish" ? " PUNISH!" : adj.tag === "guard" ? " GUARD" : heavy ? "!" : ""}`);
  if (heavy) hitStop(e, p, adj.tag === "punish" ? 6 : 4);
  try {
    if (ctx.m.element === "kinetic") {
      const d = dir ?? V.flat(V.sub(e.location, p.location));
      e.applyKnockback({ x: d.x * 1.6, z: d.z * 1.6 }, 0.38);
    } else if (ctx.m.element === "flame") {
      e.setOnFire(4, true);
    } else if (ctx.m.element === "void") {
      applyFear(e, "unease", 100);
    } else if (ctx.m.element === "frost") {
      e.addEffect("slowness", 60, { amplifier: 3 });
    } else if (ctx.m.element === "storm" && !ctx.chained) {
      ctx.chained = true;
      const near = targetsNear(ctx, e.location, 5).filter((o) => o.id !== e.id && !ctx.hits.has(o.id)).slice(0, 2);
      for (const o of near) { line(ctx.dim, "origin:arc", head, o.getHeadLocation(), ctx.rgb, 0.6, 1); hit(ctx, o, base * 0.5); }
      ctx.chained = false;
    }
    if (ctx.combo?.stun) e.addEffect("slowness", 30, { amplifier: 6 });
  } catch { }
  ctx.hitList = ctx.hitList ?? [];
  ctx.hitList.push(e);
  if (ctx.m.modifier === "drain" && !ctx.draft) {
    try { const hc = p.getComponent("minecraft:health"); hc.setCurrentValue(Math.min(hc.effectiveMax, hc.currentValue + dmg * 0.25)); } catch { }
  }
  if (!ctx.draft) ctx.h.surge = Math.min(100, (ctx.h.surge ?? 0) + 3);
  if (adj.tag === "punish") {
    hudMsg(p, "§e§lPUNISH! §r§7x1.5", 30);
    psound(p, "random.anvil_land", 1.4, 0.4);
  }
  onHitBy(e, p, ctx.m.form);
  if (ctx.draft) return;
  const f = combat(p);
  f.hits++;
  if (adj.tag === "punish") f.punish = (f.punish ?? 0) + 1;
  ctx.h.stats.hits++;
  addMomentum(p);
  addDread(p, ctx.m.element === "void" ? 4 : 2);
  if (combo >= 10) quip(p, "combo10", "Ten in a row. Show-off.", 6000, false);
}

// ------------------------------------------------------------------ forms
function doStrike(ctx) {
  const p = ctx.player;
  const head = p.getHeadLocation();
  const f = V.flat(p.getViewDirection());
  const rt = rightOf(f);
  const center = at(head, f.x * 1.8, -0.5, f.z * 1.8);
  sound(ctx.dim, "mob.irongolem.throw", center, 1.3, 0.8);
  sound(ctx.dim, "origin.sfx.burst", center, 1.5, 0.5);
  slashFx(ctx.dim, head, f, rt, ctx.m.element);
  for (const e of targetsNear(ctx, head, 3.4)) {
    const d = V.sub(e.location, p.location);
    const dist = Math.hypot(d.x, d.z);
    const dot = dist > 0 ? (d.x * f.x + d.z * f.z) / dist : 1;
    if (dist < 1.2 || dot > 0.55) hit(ctx, e, ctx.form.dmg, f);
  }
  return center;
}

function rayDist(dim, from, dir, max) {
  try {
    const bh = dim.getBlockFromRay(from, dir, { maxDistance: Math.ceil(max), includePassableBlocks: false, includeLiquidBlocks: false });
    if (!bh) return max;
    return Math.min(max, V.dist(from, V.add(bh.block.location, bh.faceLocation)));
  } catch { return max; }
}

function doDash(ctx) {
  const p = ctx.player;
  const start = p.location;
  const f = V.flat(p.getViewDirection());
  const lo = rayDist(ctx.dim, at(start, 0, 0.3, 0), f, 6);
  const hi = rayDist(ctx.dim, at(start, 0, 1.5, 0), f, 6);
  const dist = Math.max(0, Math.min(lo, hi) - 0.6);
  const dest = at(start, f.x * dist, 0, f.z * dist);
  sound(ctx.dim, "item.trident.riptide_1", start, 1.3, 0.8);
  dashFx(ctx.dim, start, dest, ctx.m.element);
  const mid = V.lerp(start, dest, 0.5);
  for (const e of targetsNear(ctx, mid, dist / 2 + 2)) {
    const ap = V.sub(e.location, start);
    const tt = clamp((ap.x * f.x + ap.z * f.z) / Math.max(0.01, dist), 0, 1);
    if (V.hdist(V.lerp(start, dest, tt), e.location) < 1.7 && Math.abs(e.location.y - start.y) < 2.5) hit(ctx, e, ctx.form.dmg, f);
  }
  try { p.teleport(dest, { keepVelocity: false, rotation: p.getRotation() }); } catch { }
  return at(dest, 0, 0.5, 0);
}

function doBlast(ctx) {
  const p = ctx.player;
  const head = p.getHeadLocation();
  const dir = p.getViewDirection();
  const maxD = rayDist(ctx.dim, head, dir, 18);
  let first = null;
  try {
    first = ctx.dim.getEntitiesFromRay(head, dir, { maxDistance: Math.max(1, Math.ceil(maxD)) })
      .filter((h) => h.entity.id !== p.id && h.distance <= maxD + 0.5 && !NO_HIT_TYPES.includes(h.entity.typeId)
        && h.entity.typeId !== "minecraft:player" && h.entity.getComponent("minecraft:health"))
      .sort((a, b) => a.distance - b.distance)[0] ?? null;
  } catch { }
  const pierce = ctx.m.modifier === "pierce" || ctx.combo?.pierce;
  const d = first && !pierce ? first.distance : maxD;
  const end = V.add(head, V.mul(dir, d));
  if (pierce) {
    try {
      for (const hh of ctx.dim.getEntitiesFromRay(head, dir, { maxDistance: Math.max(1, Math.ceil(maxD)) }))
        if (hh.entity.id !== p.id && !NO_HIT_TYPES.includes(hh.entity.typeId) && hh.entity.typeId !== "minecraft:player" && hh.entity.getComponent("minecraft:health")) hit(ctx, hh.entity, ctx.form.dmg, V.flat(dir));
    } catch { }
  }
  sound(ctx.dim, "mob.blaze.shoot", head, 1.4, 0.7);
  sound(ctx.dim, "origin.sfx.burst", head, 1.8, 0.5);
  beamFx(ctx.dim, V.add(head, V.mul(dir, 0.8)), end, ctx.m.element);
  if (first) hit(ctx, first.entity, ctx.form.dmg, V.flat(dir));
  return end;
}

function doArea(ctx, center, radius) {
  slamFx(ctx.dim, at(center, 0, -0.5, 0), radius, ctx.rgb);
  sound(ctx.dim, "random.explode", center, 1.5, 0.35);
  for (const e of targetsNear(ctx, center, radius)) hit(ctx, e, ctx.form.dmg, V.flat(V.sub(e.location, center)));
}

function doFearBurst(ctx, center) {
  const p = ctx.player;
  const strong = ctx.h.dread >= 30;
  fx(ctx.dim, "origin:shockwave", at(center, 0, -0.45, 0), strong ? C.crimson : C.grey, 1, { radius: 4 });
  fx(ctx.dim, "origin:void_swirl", center, C.blood, 1);
  fx(ctx.dim, "origin:wisp", center, C.blood, 1);
  sound(ctx.dim, "mob.warden.heartbeat", center, 0.8, 1);
  sound(ctx.dim, "origin.sfx.hum", center, 0.5, 0.8);
  for (const e of targetsNear(ctx, center, 4)) applyFear(e, strong ? "dread" : "unease", 120);
  if (ctx.draft) return;
  addDread(p, 5);
  if (strong) hudMsg(p, "§c§lDREAD§r§7 spreads.", 30);
}

// Melee punches (Brawler builds Momentum from fists too)
export function onMeleeHit(player, target) {
  const h = hero(player);
  if (!h.awakened) return;
  if (!target || target.typeId === "minecraft:player") return;
  combat(player).hits++;
  addCombo(player);
  if (h.arch === "brawler") addMomentum(player);
  addDread(player, 1);
  onHitBy(target, player, "melee");
}

// ------------------------------------------------------------------ v0.07 forms
async function doWave(ctx) {
  const p = ctx.player;
  const f = V.flat(p.getViewDirection());
  const start = at(p.location, f.x, 0.1, f.z);
  sound(ctx.dim, "random.explode", start, 1.6, 0.4);
  const pierce = ctx.m.modifier === "pierce" || ctx.combo?.pierce;
  let end = start;
  for (let i = 0; i < 10; i++) {
    const c = at(start, f.x * i, 0, f.z * i);
    end = c;
    fx(ctx.dim, "origin:shockwave", c, ctx.rgb, 1, { radius: 1.2 + i * 0.08 });
    fx(ctx.dim, "origin:debris", c, C.dust, 1);
    for (const e of targetsNear(ctx, c, 1.8)) {
      if (!pierce && ctx.waveStopped) continue;
      hit(ctx, e, ctx.form.dmg, f);
      if (!pierce) ctx.waveStopped = true;
    }
    if (ctx.waveStopped && !pierce) break;
    await system.waitTicks(2);
    if (!valid(p)) break;
  }
  return end;
}
async function doLeap(ctx) {
  const p = ctx.player;
  let tgt = null, bd = 1e9;
  for (const e of targetsNear(ctx, p.location, 12)) { const d = V.dist(e.location, p.location); if (d < bd) { bd = d; tgt = e; } }
  const f = V.flat(p.getViewDirection());
  const land = tgt ? { ...tgt.location } : at(p.location, f.x * 6, 0, f.z * 6);
  const dir = V.flat(V.sub(land, p.location));
  const dist = V.hdist(land, p.location);
  sound(ctx.dim, "mob.enderdragon.flap", p.location, 1, 0.8);
  try { p.applyKnockback({ x: dir.x * Math.min(2.4, dist * 0.22), z: dir.z * Math.min(2.4, dist * 0.22) }, 0.9); } catch { }
  for (let i = 0; i < 14; i++) { await system.waitTicks(1); if (!valid(p)) return land; fx(ctx.dim, "origin:trail", p.location, ctx.rgb, 1); if (i > 5 && p.isOnGround) break; }
  try { p.applyKnockback({ x: 0, z: 0 }, -1.2); } catch { }
  await system.waitTicks(3);
  const c = valid(p) ? { ...p.location } : land;
  const R = 3.2 * (ctx.combo?.radius ?? 1);
  slamFx(ctx.dim, c, R, ctx.rgb);
  fx(ctx.dim, "origin:dust", c, C.white, 1); fx(ctx.dim, "origin:shards", c, C.dust, 1); fx(ctx.dim, "origin:flash", at(c, 0, 0.5, 0), ctx.rgb, 1, { size: 2.2 });
  sound(ctx.dim, "random.explode", c, 1.2, 0.6);
  try { p.runCommand("camerashake add @s 0.4 0.3 positional"); } catch { }
  for (const e of targetsNear(ctx, c, R)) hit(ctx, e, ctx.form.dmg, V.flat(V.sub(e.location, c)));
  return at(c, 0, 0.5, 0);
}
function doNova(ctx) {
  const p = ctx.player;
  const c = at(p.location, 0, 1, 0);
  const R = 4 * (ctx.combo?.radius ?? 1);
  fx(ctx.dim, "origin:burst", c, ctx.rgb, 1);
  fx(ctx.dim, "origin:flash", c, ctx.rgb, 1, { size: R });
  fx(ctx.dim, "origin:dust", p.location, C.white, 1);
  fx(ctx.dim, "origin:shockwave", at(p.location, 0, 0.05, 0), ctx.rgb, 1, { radius: R });
  fx(ctx.dim, "origin:shockwave", at(p.location, 0, 1, 0), C.white, 1, { radius: R * 0.7 });
  sound(ctx.dim, "mob.warden.sonic_boom", c, 1.6, 0.5);
  for (const e of targetsNear(ctx, c, R)) hit(ctx, e, ctx.form.dmg, V.flat(V.sub(e.location, c)));
  return c;
}
async function doVolley(ctx) {
  const p = ctx.player;
  const pool = targetsNear(ctx, p.location, 16).sort((a, b) => V.dist(a.location, p.location) - V.dist(b.location, p.location));
  const f = V.flat(p.getViewDirection()), rt = rightOf(f);
  let last = at(p.location, f.x * 6, 1, f.z * 6);
  for (let i = 0; i < 3; i++) {
    const tg = pool[i % Math.max(1, pool.length)];
    const start = at(p.getHeadLocation(), rt.x * (i - 1) * 0.7, 0.3, rt.z * (i - 1) * 0.7);
    sound(ctx.dim, "mob.blaze.shoot", start, 1.6, 0.5);
    const mid = at(start, rt.x * (i - 1) * 3 + f.x * 2, 2.5, rt.z * (i - 1) * 3 + f.z * 2);
    for (let k = 1; k <= 8; k++) {
      const end = tg && valid(tg) ? tg.getHeadLocation() : at(start, f.x * 12, 0, f.z * 12);
      const s = k / 8;
      const pos = V.lerp(V.lerp(start, mid, s), V.lerp(mid, end, s), s);
      fx(ctx.dim, "origin:missile_glow", pos, ctx.rgb, 1);
      fx(ctx.dim, "origin:dot", pos, C.white, 1);
      last = pos;
      if (k % 2 === 0) await system.waitTicks(1);
    }
    if (tg && valid(tg)) { hitFx(ctx.dim, tg.getHeadLocation(), ctx.m.element, false); ctx.hits.delete(tg.id); hit(ctx, tg, ctx.form.dmg, f); }
  }
  return last;
}
// finishers that act on everything the move hit
function finish(ctx, impact) {
  const list = (ctx.hitList ?? []).filter((e) => valid(e));
  const p = ctx.player;
  if (ctx.m.finisher === "launch") for (const e of list) { try { e.applyKnockback({ x: 0, z: 0 }, 1.0); } catch { } fx(ctx.dim, "origin:rise", e.location, ctx.rgb, 1); }
  if (ctx.m.finisher === "pull") for (const e of list) { const d = V.flat(V.sub(p.location, e.location)); const dist = V.hdist(p.location, e.location); try { e.applyKnockback({ x: d.x * Math.min(2, dist * 0.25), z: d.z * Math.min(2, dist * 0.25) }, 0.3); } catch { } }
  if (ctx.m.finisher === "detonate" && list.length) {
    for (const e of list) fx(ctx.dim, "origin:charge", e.getHeadLocation(), ctx.rgb, 1);
    system.runTimeout(() => {
      for (const e of list) {
        if (!valid(e)) continue;
        fx(ctx.dim, "origin:boom_fire", e.location, ctx.rgb, 1);
        sound(ctx.dim, "random.explode", e.location, 0.7, 1.2);
        for (const o of targetsNear(ctx, e.location, 2.5)) { try { o.applyDamage(4 * ctx.mult, { cause: EntityDamageCause.entityExplosion, damagingEntity: p }); } catch { } }
      }
    }, 20);
  }
  if (ctx.shattered) { hudMsg(p, "§b§lSHATTER", 20); sound(ctx.dim, "random.glass", impact ?? p.location, 1, 1.4); }
}
