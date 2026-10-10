// ORIGIN v0.23 - main.js
// Build Your Own Hero. Entry point: wires events and tick loops.
import { ItemStack, world, system, InputButton, ButtonState } from "@minecraft/server";
import { hero, RT, saveDirty, forget, ARCH, markDirty, closeFight } from "./data.js";
import { valid, msg, now, psound, at } from "./util.js";
import { registerCommands } from "./commands.js";
import { resetPlayerView } from "./cine.js";
import { startAwakening, onOrbInteract } from "./awakening.js";
import { talk, tickVoice } from "./manifestation.js";
import { castActive, cycleActive, regen, tickMomentum, onMeleeHit } from "./moves.js";
import { tickDreadMeter, tickHeartbeat, tickFears, addDread } from "./dread.js";
import { tickBrutes, onBruteDeath, BRUTE, DUMMY } from "./enemy.js";
import { tickFloaters, onSneakPress } from "./combat.js";
import { tickHud } from "./hud.js";
import { openCodex } from "./ui.js";
import { spar, isDojoBell } from "./spar.js";
import { registerDimension, plans, tickPlayer, tickWorld, inHall, inIW, inStage, wake, updateFog, iwDim } from "./innerworld.js";
import { registerStations } from "./stations.js";
import { giveItem, giveKit, ITEMS } from "./kit.js";
import { tickFlight, onJumpPress, cancelsFall } from "./flight.js";
import { tickLoad } from "./load.js";
import { tickStamina, dodgeGate, onSneakDown, applyGuardPose, onGuardBefore, injectSerum, canSerumLeap, serumLeap, serumFall } from "./stamina.js";
import { setDodgeGate } from "./combat.js";
import { tickInk } from "./ego.js";
import { tryCut, sharpOf, tickLimbs, onLimbInteract, useBandage, installProsthetic, iaido, reapplyLimbs, dropArm, tickProsthetics, onProstheticSwing, onProstheticMelee, installModule, MODULE_OF_ITEM } from "./dismember.js";
import { SIGNET, useSignet, tickLumen, tickConstructs, tickRingGlow } from "./lumen.js";
import { gainResolve, tickTrials, tickAwakened, trySurge, onHurtSurge, onTrialDeath } from "./ascend.js";
import { INTERFACE, useInterface, tickExo, tickMeteors, canExoFly, exoTakeoff, tickSuitParts, tickMissiles, exoHurt, rescueSuit, tickDrones, tickBlade, bladeHit } from "./exo.js";
import { canPowerFly, powerTakeoff } from "./powers.js";
import { usePower, openPowerMenu, tickPowers, onPowerMelee, onShellBefore, onShellAfter, onSwing, rescueBanished, rollPower, POWERS } from "./powers.js";
import { SHARD, MASK, useShard, useMask, onHurtBefore as egoHurtBefore, onHurtAfter as egoHurtAfter, tickEgos, struggle, onEgoKill, onEgoHurt, isCaged, rescueCaged, sweepEgos } from "./ego.js";
import { tickStatic, inStatic, garbleChat, pullOut } from "./static.js";
import { tickAlter } from "./powers.js";
import { useReceiver, useRemote, tickNull, onNullDeath, onBruteKilledForQuest, NULL } from "./quest.js";
import { VILLAIN, tickVillains, tickVillainSpawns, onVillainDeath, onVillainHit, onVillainHurt } from "./villain.js";
import { tickFall } from "./fall.js";
import { tickTargets } from "./target.js";
import { tickAssistant, onWeather } from "./jarvis.js";
import { tickRecord, tickMirror, logWound, logBlock, onSpawn } from "./mirror.js";
import { STONE_OF, GAUNTLET, isGauntlet, useStone, useGauntlet, tickStones, tickStoneFlags, onStoneMelee, onStoneHurtBefore, onStoneHurtAfter, onStoneKill } from "./stones.js";
import { tickAmbience } from "./ambience.js";
import { tickImpact } from "./impact.js";
import { tickPhysical, onPhysHurtBefore, onPhysHurtAfter, onPhysMelee } from "./physical.js";
import { useBifrost, tickAsgard } from "./asgard.js";
import { onGoreHurt, onGoreDeath } from "./gorefx.js";
import { XOX, tickXoX, onXoxHurtBefore, useSeal, useMask as useXoxMask, tickUlt, onXoxPlayerDeath } from "./xox.js";
import { onCombatHit, onCombatHurt, onParryBefore, tickCombat2, onSwingTrail, isGun, useGun, onGunStart, onGunStop, isWeapon, useWeapon, serumSurge } from "./combat2.js";
import { tickBeams } from "./beams.js";
import { tickTempBlocks } from "./tempblocks.js";
import { regenFinalSave } from "./regen.js";
import { tickP2, onP2HurtBefore, onP2Melee, onP2Kill } from "./powers2.js";
import { tickP3, onP3HurtBefore, onP3HurtAfter, onP3Melee, onP3Kill } from "./powers3.js";
import { tickModels } from "./models.js";
import { MJ, STRAP as MJ_STRAP, throwHammer, recall as recallMj, thunderMenu, onMjMelee, onMjKill, onMjHurt, tickMjolnir, tickMjStone, onStoneInteract, canMjFly, mjTakeoff, restoreMj, onMjLeave } from "./mjolnir.js";
import { GEAR, useGear, onShieldBefore, onGearMelee, tickGear, restoreShield, onGearLeave } from "./gear.js";

// startup registrations (must happen before the world loads)
registerDimension();
registerStations();
registerCommands();

const safe = (fn) => (...a) => { try { return fn(...a); } catch (e) { console.warn("[ORIGIN] " + e + (e?.stack ? "\n" + e.stack : "")); } };

// precompute the Inner World plans in the background (spread across ticks)

// Subscribe defensively: if an event doesn't exist in this game version, skip it and keep going
// (v0.04 crashed here on world.beforeEvents.chatSend, which is beta-only, and every loop below it never started).
// Optional extras (chatSend only exists with the beta API) are skipped silently - nothing is wrong when they're missing.
const OPTIONAL = new Set(["chatSend"]);
function on(src, name, fn, opts) {
  const sig = src?.[name];
  if (!sig || typeof sig.subscribe !== "function") { if (!OPTIONAL.has(name)) console.warn(`[ORIGIN] event ${name} not available in this version - skipped`); return; }
  try { opts ? sig.subscribe(fn, opts) : sig.subscribe(fn); } catch (e) { console.warn(`[ORIGIN] subscribe ${name}: ${e}`); }
}
// Hits can come from things that are already gone - an exploded creeper, a despawned arrow. Every hurt/death handler
// gets a copy of the event with those dead references dropped, so reading an attacker's position can't throw (v0.21:
// "InvalidEntityError ... at onRegenHurt") and can't stop the rest of the chain from running.
const alive = (e) => { try { return !!e && e.isValid; } catch { return false; } };
function cleanSrc(s) {
  if (!s) return { cause: "none" };
  let cause = "none"; try { cause = s.cause; } catch { }
  return { cause, damagingEntity: alive(s.damagingEntity) ? s.damagingEntity : undefined, damagingProjectile: alive(s.damagingProjectile) ? s.damagingProjectile : undefined };
}
const hurtAfter = (ev) => ({ hurtEntity: ev.hurtEntity, damage: ev.damage ?? 0, damageSource: cleanSrc(ev.damageSource) });
const dieAfter = (ev) => ({ deadEntity: ev.deadEntity, damageSource: cleanSrc(ev.damageSource) });
function hurtBefore(ev) {
  return {
    hurtEntity: ev.hurtEntity, damageSource: cleanSrc(ev.damageSource),
    get cancel() { return ev.cancel; }, set cancel(v) { ev.cancel = v; },
    get damage() { return ev.damage; }, set damage(v) { ev.damage = v; },
  };
}
// after-events: skip a hurt entity that's already gone, and run each handler on its own so one failure can't block the rest
const each = (...fns) => (ev) => { for (const f of fns) { try { f(ev); } catch (e) { console.warn("[ORIGIN] " + e + (e?.stack ? "\n" + e.stack : "")); } } };

on(world.afterEvents, "worldLoad", () => { plans("brawler"); });

// ------------------------------------------------------------------ items
on(world.afterEvents, "itemUse", safe((ev) => {
  const p = ev.source;
  const id = ev.itemStack?.typeId;
  if (!p || !id || !id.startsWith("origin:")) return;
  const r = RT(p);
  if (id === ITEMS.codex) {
    if (now() - r.lastUse < 10 || r.station) return;
    r.lastUse = now();
    // if you're looking right at your Manifestation, the Codex talks to it instead of opening
    try {
      const hit = p.getEntitiesFromViewDirection({ maxDistance: 6 }).find((h) => h.entity.typeId === "origin:manifestation");
      if (hit) { talk(p); return; }
    } catch { }
    openCodex(p);
  } else if (id === ITEMS.focus) {
    if (p.isSneaking) {
      if (now() - r.lastUse < 6) return;
      r.lastUse = now();
      if (!trySurge(p)) cycleActive(p);     // full Surge: Awaken / Ultimate instead
    } else castActive(p);
  } else if (id === "origin:power_core") {
    if (now() - r.lastUse < 6 || r.station) return;
    r.lastUse = now();
    if (p.isSneaking) openPowerMenu(p);
    else usePower(p);
  } else if (id === "origin:detuned_receiver") {
    if (now() - r.lastUse < 10) return;
    r.lastUse = now();
    useReceiver(p);
  } else if (id === "origin:static_remote") {
    if (now() - r.lastUse < 10) return;
    r.lastUse = now();
    useRemote(p);
  } else if (id === "origin:katana") {
    if (now() - r.lastUse < 6) return;
    r.lastUse = now();
    iaido(p);
  } else if (id === "origin:super_serum" && hero(p).serum) {
    if (now() - r.lastUse < 20) return;
    r.lastUse = now();
    serumSurge(p);
  } else if (id === "origin:super_serum") {
    injectSerum(p, () => consumeHeld(p));
  } else if (MODULE_OF_ITEM[id]) {
    if (now() - r.lastUse < 10) return;
    r.lastUse = now();
    installModule(p, MODULE_OF_ITEM[id], () => consumeHeld(p));
  } else if (id === "origin:severed_arm") {
    if (now() - r.lastUse < 10) return;
    r.lastUse = now();
    dropArm(p, () => consumeHeld(p));
  } else if (id === "origin:bandage") {
    useBandage(p, () => consumeHeld(p));
  } else if (id === "origin:exo_prosthetic") {
    installProsthetic(p, () => consumeHeld(p));
  } else if (id === SIGNET) {
    if (now() - r.lastUse < 6) return;
    r.lastUse = now();
    useSignet(p, p.isSneaking);
  } else if (id === INTERFACE) {
    if (now() - r.lastUse < 4) return;
    r.lastUse = now();
    useInterface(p, p.isSneaking);
  } else if (id === SHARD) {
    useShard(p, () => consumeHeld(p));
  } else if (id === MASK) {
    if (now() - r.lastUse < 10) return;
    r.lastUse = now();
    useMask(p, p.isSneaking);
  } else if (isGun(id)) {
    useGun(p, p.isSneaking);
  } else if (isWeapon(id)) {
    if (now() - r.lastUse < 4) return;
    r.lastUse = now();
    useWeapon(p, id, p.isSneaking);
  } else if (id === MJ) {
    if (now() - r.lastUse < 6) return;
    r.lastUse = now();
    if (p.isSneaking) thunderMenu(p); else throwHammer(p);
  } else if (id === MJ_STRAP) {
    if (now() - r.lastUse < 6) return;
    r.lastUse = now();
    recallMj(p);
  } else if (GEAR.has(id)) {
    if (now() - r.lastUse < 4) return;
    r.lastUse = now();
    useGear(p, id, p.isSneaking);
  } else if (id === "origin:bifrost_key") {
    if (now() - r.lastUse < 20) return;
    r.lastUse = now();
    useBifrost(p);
  } else if (id === "origin:gravity_seal") {
    if (now() - r.lastUse < 20) return;
    r.lastUse = now();
    useSeal(p);
  } else if (id === "origin:ultimate_mask") {
    if (now() - r.lastUse < 20) return;
    r.lastUse = now();
    useXoxMask(p);
  } else if (STONE_OF[id]) {
    if (now() - r.lastUse < 4) return;
    r.lastUse = now();
    useStone(p, STONE_OF[id], p.isSneaking);
  } else if (isGauntlet(id)) {
    if (now() - r.lastUse < 6) return;
    r.lastUse = now();
    useGauntlet(p, p.isSneaking);
  } else if (id === "origin:blueprint_data") {
    if (now() - r.lastUse < 20) return;
    r.lastUse = now();
    msg(p, "§bSchematic Data§7 - research Blueprints with it at an §fExo Workshop§7 (Blueprints tab).");
  } else if (id === ITEMS.shard) {
    if (hero(p).awakened) {
      msg(p, "§7The shard hums softly. You already answered it. §8(/hero awaken to choose again)");
      return;
    }
    if (now() - r.lastUse < 20) return;
    r.lastUse = now();
    psound(p, "origin.sfx.hum", 0.8, 1);
    startAwakening(p);
  }
}));

function consumeHeld(p) {
  try {
    const slot = p.getComponent("minecraft:inventory").container.getSlot(p.selectedSlotIndex);
    const it = slot.getItem();
    if (!it) return;
    if (it.amount > 1) { it.amount -= 1; slot.setItem(it); } else slot.setItem(undefined);
  } catch { }
}
export function dropItem(dim, loc, typeId, n = 1) {
  try { const s = new ItemStack(typeId, n); dim.spawnItem(s, at(loc, 0, 0.5, 0)); } catch { }
}

// ------------------------------------------------------------------ blocks (the dojo bell starts a spar)
on(world.afterEvents, "playerInteractWithBlock", safe((ev) => {
  if (!ev.isFirstEvent) return;
  if (isDojoBell(ev.player, ev.block)) spar(ev.player);
}));

// ------------------------------------------------------------------ entities
on(world.afterEvents, "playerInteractWithEntity", safe((ev) => {
  if (ev.target?.typeId === "origin:severed_limb") { onLimbInteract(ev.player, ev.target); return; }
  const t = ev.target;
  if (!t) return;
  if (t.typeId === "origin:mjolnir_stone") { onStoneInteract(ev.player, t); return; }
  if (t.typeId === "origin:archetype_orb") onOrbInteract(ev.player, t);
  else if (t.typeId === "origin:manifestation") talk(ev.player);
}));

on(world.afterEvents, "entityHitEntity", safe((ev) => {
  const a = ev.damagingEntity;
  if (a?.typeId === "minecraft:player") { try { onStoneMelee(a, ev.hitEntity); } catch { } try { if (!onPhysMelee(a, ev.hitEntity)) onCombatHit(a, ev.hitEntity); } catch { } try { onP2Melee(a, ev.hitEntity); } catch { } try { onP3Melee(a, ev.hitEntity); } catch { } try { onMjMelee(a, ev.hitEntity); } catch { } try { onGearMelee(a, ev.hitEntity); } catch { } try { if (!a.getComponent("minecraft:inventory").container.getItem(a.selectedSlotIndex) && hero(a).awakened) a.dimension.playSound("origin.sfx.punch", ev.hitEntity.location, { volume: 0.55, pitch: 0.85 + Math.random() * 0.3 }); } catch { } onMeleeHit(a, ev.hitEntity); onPowerMelee(a, ev.hitEntity); bladeHit(a, ev.hitEntity); onProstheticMelee(a, ev.hitEntity); }
  else if (a?.typeId === VILLAIN) onVillainHit(a, ev.hitEntity);
}));

// Stretch: punches that reach past normal range
on(world.afterEvents, "playerSwingStart", safe((ev) => { onSwing(ev.player, ev); onProstheticSwing(ev.player, ev); onSwingTrail(ev.player); }));
// Mirror Hour's memory: what the world looked like a minute ago
on(world.afterEvents, "playerBreakBlock", safe((ev) => logBlock(ev.block.dimension, ev.block.location, ev.brokenBlockPermutation)));
on(world.afterEvents, "playerPlaceBlock", safe((ev) => logBlock(ev.block.dimension, ev.block.location, null)));
on(world.afterEvents, "blockExplode", safe((ev) => logBlock(ev.dimension, ev.block.location, ev.explodedBlockPermutation)));
on(world.afterEvents, "entitySpawn", safe((ev) => onSpawn(ev)));
on(world.afterEvents, "weatherChange", safe((ev) => onWeather(ev)));
// the stones: Soul Bind shares pain, Soul takes souls from kills
on(world.afterEvents, "entityHurt", (raw) => {
  if (!alive(raw.hurtEntity)) return;
  const ev = hurtAfter(raw);
  each(
    () => onStoneHurtAfter(ev.hurtEntity, ev.damage, ev.damageSource),
    () => onCombatHurt(ev.hurtEntity, ev.damage, ev.damageSource),
    () => onPhysHurtAfter(ev.hurtEntity, ev.damage, ev.damageSource),
    () => onGoreHurt(ev.hurtEntity, ev.damage, ev.damageSource),
    () => onP3HurtAfter(ev.hurtEntity, ev.damage, ev.damageSource),
    () => onMjHurt(ev.hurtEntity, ev.damageSource.damagingEntity),
  )(ev);
});
on(world.afterEvents, "entityDie", (raw) => { const ev = dieAfter(raw); each(() => onStoneKill(ev.damageSource.damagingEntity, ev.deadEntity))(ev); });
on(world.afterEvents, "itemStartUse", safe((ev) => onGunStart(ev.source, ev.itemStack)));
on(world.afterEvents, "itemStopUse", safe((ev) => onGunStop(ev.source)));

// Alter Ego (Sentry): a killing blow is cancelled and becomes the swap...
on(world.beforeEvents, "entityHurt", (raw) => {
  const ev = hurtBefore(raw);
  const step = (f) => { try { return f(); } catch (e) { console.warn("[ORIGIN] hurt: " + e); return false; } };
  step(() => onMjHurt(ev.hurtEntity, ev.damageSource.damagingEntity));   // who struck first counts even if the hit is blocked
  if (step(() => onStoneHurtBefore(ev))) return;
  if (step(() => onP3HurtBefore(ev))) return;
  if (step(() => onP2HurtBefore(ev))) return;
  if (step(() => onPhysHurtBefore(ev))) return;
  if (step(() => onXoxHurtBefore(ev))) return;
  if (step(() => onParryBefore(ev))) return;
  if (step(() => onShieldBefore(ev))) return;                 // the Vanguard Shield blocks what's in front of it
  if (step(() => cancelsFall(ev.hurtEntity, String(ev.damageSource.cause)))) { ev.cancel = true; return; }
  step(() => serumFall(ev));
  if (step(() => onGuardBefore(ev)) && ev.cancel) return;   // a parry
  if (step(() => egoHurtBefore(ev))) return;                 // the Other takes over instead of you dying
  step(() => onShellBefore(ev));                              // Sentry's Void Shell
  step(() => regenFinalSave(ev));                             // Regeneration cheats death - only if nothing above stopped the hit
}, { entityFilter: { type: "minecraft:player" } });
// XoX has his own: blocking, tougher against crowds, untouchable in his cutscenes, and his defeat (katana + mask).
// (Until v0.22 this lived only in the player-filtered chain above, so it never ran.)
on(world.beforeEvents, "entityHurt", (raw) => { try { onXoxHurtBefore(hurtBefore(raw)); } catch (e) { console.warn("[ORIGIN] xox hurt: " + e); } }, { entityFilter: { type: XOX } });
// ...and dropping under 30% health triggers it too
on(world.afterEvents, "entityHurt", (raw) => {
  if (!alive(raw.hurtEntity)) return;
  const ev = hurtAfter(raw), e = ev.hurtEntity;
  if (e.typeId === "minecraft:player") each(() => egoHurtAfter(e), () => onShellAfter(e), () => exoHurt(e, ev.damage || 1), () => onHurtSurge(e), () => logWound(e, ev.damage, ev.damageSource))(ev);
  // a sharp hit that connects badly can take an arm off (rare, permanent)
  const src = ev.damageSource.damagingEntity;
  each(
    () => { if (src && ev.damageSource.cause === "entityAttack") { const kind = sharpOf(src); if (kind) tryCut(src, e, ev.damage, kind); } },
    () => { if (e.typeId === "origin:alter_ego") onEgoHurt(e, src); },
    () => { if (e.typeId === VILLAIN) onVillainHurt(e, src); },
  )(ev);
});

on(world.afterEvents, "entityDie", safe((raw) => {
  const ev = dieAfter(raw);
  const dead = ev.deadEntity;
  const killer = ev.damageSource?.damagingEntity;
  if (killer?.typeId === "minecraft:player" && dead) {
    const chance = dead.typeId === BRUTE ? 0.18 : dead.typeId === VILLAIN ? 0.35 : dead.typeId === NULL ? 1 : 0;
    if (Math.random() < chance) dropItem(dead.dimension, dead.location, "origin:blueprint_data", dead.typeId === NULL ? 3 : 1);
  }
  if (killer?.typeId === "minecraft:player" && dead?.typeId !== "minecraft:player") gainResolve(killer, dead);
  try { onMjKill(killer, dead); } catch (e) { console.warn("[ORIGIN] honor: " + e); }
  if (dead?.typeId === "minecraft:player") { onTrialDeath(dead); try { onXoxPlayerDeath(dead); } catch { } }
  if (dead?.typeId === BRUTE) {
    onBruteDeath(dead, ev.damageSource);
    if (killer?.typeId === "minecraft:player") { onBruteKilledForQuest(killer); if (Math.random() < 0.006) dropItem(dead.dimension, dead.location, SHARD); if (Math.random() < 0.05) dropItem(dead.dimension, dead.location, "origin:rift_heart"); }
  }
  if (killer?.typeId === "origin:alter_ego") onEgoKill(killer, dead);
  if (dead?.typeId === NULL) onNullDeath(dead, ev.damageSource);
  if (dead?.typeId === VILLAIN) {
    onVillainDeath(dead, ev.damageSource);
    if (killer?.typeId === "minecraft:player") { onBruteKilledForQuest(killer, 0.4); if (Math.random() < 0.012) dropItem(dead.dimension, dead.location, SHARD); }
  }
  if (killer?.typeId === "minecraft:player" && dead?.typeId !== "minecraft:player" && dead?.typeId !== DUMMY) {
    const h = hero(killer);
    if (h.awakened) {
      h.stats.kills++;
      markDirty(killer);
      addDread(killer, 8);
      const r = RT(killer);
      if (r.fight) r.fight.kills++;
    }
  }
  if (dead?.typeId === "minecraft:player") closeFight(dead);
}));

// ------------------------------------------------------------------ input
// who can take off with a double-tap of jump (Flight power, or a powered Exo-Frame)
const flyers = [];
export function addFlyer(can, go) { flyers.push({ can, go }); }
addFlyer(canMjFly, mjTakeoff);       // first: holding Mjolnir is a choice
addFlyer(canExoFly, exoTakeoff);
addFlyer(canPowerFly, powerTakeoff);
addFlyer(canSerumLeap, serumLeap);   // last: only when you can't fly
setDodgeGate(dodgeGate);
function canFly(p) { return flyers.some((f) => { try { return f.can(p); } catch { return false; } }); }
function takeoff(p) { const f = flyers.find((x) => { try { return x.can(p); } catch { return false; } }); f?.go(p); }
// sneak: skip/advance cinematics; double-tap sneak: dodge
on(world.afterEvents, "playerButtonInput", safe((ev) => {
  if (ev.newButtonState !== ButtonState.Pressed) return;
  if (ev.button === InputButton.Jump) { onJumpPress(ev.player, canFly, takeoff); return; }
  if (ev.button !== InputButton.Sneak) return;
  onSneakDown(ev.player);
  if (isCaged(ev.player)) { struggle(ev.player); return; }
  const c = RT(ev.player).cine;
  if (c) { c.skipReq = true; return; }
  onSneakPress(ev.player);
}));

// ------------------------------------------------------------------ players
on(world.afterEvents, "playerSpawn", safe((ev) => {
  const p = ev.player;
  if (ev.initialSpawn) {
    resetPlayerView(p);
    const h = hero(p);
    RT(p).hudReset = true;
    // stranded mid-awakening or mid-forge (relog / crash): send them home
    if (inHall(p) || (inIW(p) && !h.awakened)) system.runTimeout(() => valid(p) && wake(p), 20);
    if (inStatic(p)) system.runTimeout(() => valid(p) && pullOut(p, "exit"), 20);
    if (h.banish) system.runTimeout(() => valid(p) && rescueBanished(p), 20);
    rescueCaged(p);
    system.runTimeout(() => { if (valid(p)) { reapplyLimbs(p); applyGuardPose(p); } }, 40);
    rescueSuit(p);
    system.runTimeout(() => { if (valid(p)) { restoreMj(p); restoreShield(p); } }, 30);   // thrown when they logged off: back in hand
    if (inStage(p)) system.runTimeout(() => {
      if (!valid(p)) return;
      const f = h.forgeRet;
      h.forgeRet = null;
      markDirty(p);
      if (f) { try { p.teleport({ x: f.x, y: f.y, z: f.z }, { dimension: world.getDimension(f.dim) }); return; } catch { } }
      wake(p);
    }, 20);
    if (!h.awakened && !h.gotShard) {
      h.gotShard = true;
      markDirty(p);
      system.runTimeout(() => {
        if (!valid(p)) return;
        giveItem(p, ITEMS.shard, { lore: ["§7It hums when you hold it.", "§7Use it."] });
        msg(p, "§7Something in your pocket is §dhumming§7. §8(Hold the Humming Shard and use it. /hero help for debug commands.)");
        psound(p, "origin.sfx.hum", 1.2, 0.5);
      }, 60);
    } else if (h.awakened) {
      system.runTimeout(() => {
        if (!valid(p)) return;
        // heroes from older versions: give them a power (and the Power Core) the first time they load v0.04
        if (!h.power || !POWERS[h.power]) {
          const k = rollPower(p);
          msg(p, `§f§lYOU HAVE A POWER: ${POWERS[k].icon}§l${POWERS[k].name.toUpperCase()}§r §7- ${POWERS[k].desc}`);
          msg(p, "§7Hold the §fPower Core§7 and use it. Sneak + use opens the Power menu.");
        }
        giveKit(p);
        msg(p, `§8ORIGIN v0.23 - ${ARCH[h.arch]?.name ?? ""} · ${POWERS[h.power]?.name ?? ""} | /hero help`);
      }, 60);
    }
  } else {
    const h = hero(p);
    if (h.awakened) system.runTimeout(() => valid(p) && giveKit(p), 5);
    system.runTimeout(() => { if (valid(p)) { reapplyLimbs(p); applyGuardPose(p); } }, 20);   // lost arms stay lost
    RT(p).momentum = 0;
  }
}));

// garbled chat while trapped in the Static (only that player's own messages)
on(world.beforeEvents, "chatSend", (ev) => {
  try {
    const p = ev.sender;
    if (RT(p).staticChat && inStatic(p)) {
      ev.cancel = true;
      const g = garbleChat(p, ev.message);
      system.run(() => { try { p.sendMessage(`§8<${p.name}> §7${g}`); } catch { } });
    }
  } catch { }
});

on(world.afterEvents, "playerLeave", safe((ev) => { onMjLeave(ev.playerId); onGearLeave(ev.playerId); forget(ev.playerId); }));

// ------------------------------------------------------------------ loops
system.runInterval(safe(() => { tickFlight(); tickSuitParts(); tickMissiles(); tickDrones(); tickConstructs(); }), 1);
system.runInterval(safe(() => { tickBrutes(); tickNull(); tickFloaters(); tickPowers(); tickVillains(); tickEgos(); }), 2);
system.runInterval(safe(sweepEgos), 200);
system.runInterval(safe(tickExo), 10);
system.runInterval(safe(tickTrials), 10);
system.runInterval(safe(tickLumen), 20);
system.runInterval(safe(tickLimbs), 10);
system.runInterval(safe(() => { tickStamina(); tickProsthetics(); tickInk(); }), 2);
system.runInterval(safe(() => { for (const p of world.getAllPlayers()) applyGuardPose(p); }), 600);
system.runInterval(safe(tickRingGlow), 10);
system.runInterval(safe(() => tickLoad(world.getAllPlayers())), 20);
system.runInterval(safe(() => { tickAwakened(); tickBlade(); }), 2);
system.runInterval(safe(tickMeteors), 20);
system.runInterval(safe(tickHud), 4);
system.runInterval(safe(tickFall), 1);
system.runInterval(safe(tickCombat2), 1);
system.runInterval(safe(tickBeams), 1);
system.runInterval(safe(tickTempBlocks), 5);
system.runInterval(safe(tickP2), 1);
system.runInterval(safe(tickP3), 1);
system.runInterval(safe(tickModels), 1);
system.runInterval(safe(tickMjolnir), 1);
system.runInterval(safe(tickGear), 1);
system.runInterval(safe(tickMjStone), 10);
system.runInterval(safe(tickPhysical), 1);
system.runInterval(safe(tickImpact), 1);
system.runInterval(safe(tickAsgard), 5);
on(world.afterEvents, "entityDie", (raw) => { const ev = dieAfter(raw); each(() => onGoreDeath(ev.deadEntity), () => onP2Kill(ev.damageSource.damagingEntity, ev.deadEntity), () => onP3Kill(ev.damageSource.damagingEntity, ev.deadEntity))(ev); });
system.runInterval(safe(tickXoX), 2);
system.runInterval(safe(tickUlt), 10);
system.runInterval(safe(tickTargets), 4);
system.runInterval(safe(tickStones), 2);
system.runInterval(safe(() => { tickRecord(); tickMirror(); tickStoneFlags(); }), 20);
system.runInterval(safe(() => { tickAssistant(); tickAmbience(); }), 10);
system.runInterval(safe(() => {
  tickFears();
  tickStatic();
  for (const p of world.getAllPlayers()) {
    tickPlayer(p);
    tickHeartbeat(p);
    tickVoice(p);
  }
}), 10);
system.runInterval(safe(() => {
  for (const p of world.getAllPlayers()) {
    regen(p);
    tickMomentum(p);
    tickDreadMeter(p);
    const r = RT(p);
    if (r.fight && now() - r.lastCombat > 200) closeFight(p);
  }
  tickWorld();
  tickAlter();
  tickVillainSpawns();
  saveDirty();
}), 20);
// stray training dummies left by a crash or reload (floating numbers despawn on their own)
system.runInterval(safe(() => {
  try {
    for (const e of iwDim().getEntities({ type: DUMMY })) {
      if (!world.getAllPlayers().some((p) => RT(p).station)) e.remove();
    }
  } catch { }
}), 600);

// after a /reload nobody gets a first-join reset: undo any camera or movement lock a cut-off cutscene left behind
system.runTimeout(() => { try { for (const p of world.getAllPlayers()) if (!RT(p).cine) resetPlayerView(p); } catch { } }, 20);
console.log("[ORIGIN] v0.23 loaded. /hero help");
