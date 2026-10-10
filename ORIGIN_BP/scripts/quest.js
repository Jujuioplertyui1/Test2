// ORIGIN v0.24 - quest.js
// "Signal Lost" — the questline that unlocks the Static for one special player, and NULL, its boss.
// Stages (hero.quest.signal):
//   0 nothing   1 heard the noise (got a Detuned Receiver)   2 collected 8 Static Shards
//   3 built the Static Remote   4 beat NULL   (5 = mastered: remote is permanent)
// Static Shards drop rarely from Rift Brutes. NULL is summoned at a tuned receiver once you have 8.
import { world, system, EntityDamageCause, ItemStack } from "@minecraft/server";
import { hero, RT, markDirty, ARCH } from "./data.js";
import { V, at, valid, now, msg, fx, sound, psound, C, cmd, health } from "./util.js";
import { hudMsg, quip } from "./voice.js";
import { giveItem, hasItem, removeOne, ITEMS, countItem } from "./kit.js";
import { title } from "./cine.js";
import { popNumber } from "./combat.js";

export const NULL = "origin:null";
export const SHARDS_NEEDED = 8;

export function questStage(player) { return hero(player).quest?.signal ?? 0; }
function setStage(player, n) {
  const h = hero(player);
  h.quest = h.quest ?? { signal: 0 };
  if (n <= h.quest.signal) return;
  h.quest.signal = n;
  markDirty(player);
}

// A Rift Brute (35%) or a villain (55%) died: chance to drop a Static Shard, and the first time, start the quest.
// (v0.24: the old odds - 22% x 35% - meant ~130 brutes for the ten shards it asked for; now it's eight shards, ~25 brutes)
export function onBruteKilledForQuest(player, chance = 0.35) {
  if (!player || player.typeId !== "minecraft:player") return;
  const h = hero(player);
  if (!h.awakened) return;
  if (Math.random() < chance) {
    if (questStage(player) === 0 || Math.random() < 0.9) giveItem(player, ITEMS.staticShard, { keep: true, lore: ["§7It hums on a channel that isn't there."] }); else { try { player.sendMessage("§8The static slips through your fingers. Keep trying."); } catch { } }
    if (questStage(player) === 0) {
      setStage(player, 1);
      giveItem(player, ITEMS.receiver, { keep: true, lore: ["§7Points toward the noise.", "§7Collect 8 Static Shards."] });
      system.runTimeout(() => valid(player) && (
        title(player, "§7a signal, lost", "§8something is broadcasting", 60),
        quip(player, "quest1", "Did you hear that? Static. From nowhere. Keep those shards. I want to know what it wants.", 500)
      ), 20);
    } else {
      const n = countItem(player, ITEMS.staticShard);
      hudMsg(player, `§7Static Shard §8(${n}/${SHARDS_NEEDED})`, 50);
      if (n >= SHARDS_NEEDED && questStage(player) < 2) {
        setStage(player, 2);
        quip(player, "quest2", "Eight. That's enough to point back at it. Use the Receiver out in the open.", 500);
      }
    }
  }
}

// Using the Detuned Receiver: once you have 8 shards, it summons NULL in the open.
export function useReceiver(player) {
  const h = hero(player);
  const t = now();
  const r = RT(player);
  if ((r.recvCd ?? 0) > t) return;
  r.recvCd = t + 20;
  const n = countItem(player, ITEMS.staticShard);
  if (nullOwed(player)) { h.quest = h.quest ?? { signal: 0 }; h.quest.nullFree = true; markDirty(player); }
  const free = !!h.quest?.nullFree;   // it left before the fight was over: calling it back is free
  if (n < SHARDS_NEEDED && !free) {
    hudMsg(player, `§7The receiver hisses. §8Static Shards: ${n}/${SHARDS_NEEDED}`, 60);
    psound(player, "random.fizz", 1, 0.5);
    fx(player.dimension, "origin:glitch", at(player.getHeadLocation(), 0, 0.2, 0), C.grey, 0.7);
    return;
  }
  if (nullAlive(player.dimension)) { hudMsg(player, "§7It's already here. Can't you feel it?"); return; }
  if (player.dimension.id !== "minecraft:overworld" && player.dimension.id !== "minecraft:nether" && player.dimension.id !== "minecraft:the_end") {
    hudMsg(player, "§7Not here. It wants open air. §8(Use it in the overworld.)"); return;
  }
  if (free) { h.quest.nullFree = false; markDirty(player); }
  else for (let i = 0; i < SHARDS_NEEDED; i++) removeOne(player, ITEMS.staticShard);
  summonNull(player);
}

function nullAlive(dim) {
  try { return dim.getEntities({ type: NULL }).length > 0; } catch { return false; }
}

// ------------------------------------------------------------------ NULL boss (null.js)
import { summonNull, tickNull as _tickNull, forgetNull, nullOwed } from "./null.js";
import { inStatic, pullIn } from "./static.js";
export const tickNull = _tickNull;

export function onNullDeath(e, source) {
  forgetNull(e);
  // the channel breaks apart: Null Crystals (Exo-Frame material), and the first time, a Shard of the Other
  try {
    const n = 3 + Math.floor(Math.random() * 3);
    e.dimension.spawnItem(new ItemStack("origin:null_crystal", n), at(e.location, 0, 1, 0));
    e.dimension.spawnItem(new ItemStack("minecraft:diamond", 2 + Math.floor(Math.random() * 3)), at(e.location, 0, 1, 0));
    e.dimension.spawnItem(new ItemStack("minecraft:experience_bottle", 8), at(e.location, 0, 1, 0));
  } catch { }
  const killer = source?.damagingEntity;
  const dim = e.dimension;
  fx(dim, "origin:pillar", e.location, C.white, 1);
  for (let i = 0; i < 24; i++) fx(dim, "origin:glitch", at(e.location, (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3), C.white, 1);
  sound(dim, "random.explode", e.location, 1.4, 0.6);
  if (killer?.typeId === "minecraft:player") {
    setStage(killer, 4);
    const h = hero(killer);
    h.nullKills = (h.nullKills ?? 0) + 1;
    if (h.nullKills === 1 || Math.random() < 0.25) {
      if (Math.random() < 0.4) { try { killer.dimension.spawnItem(new ItemStack("origin:other_shard", 1), at(e.location, 0, 1, 0)); } catch { } }
      if (h.nullKills === 1) system.runTimeout(() => valid(killer) && msg(killer, "§4Something fell out of its screen. §7A sliver of glass - and your reflection in it is smiling."), 60);
    }
    giveItem(killer, ITEMS.remote, { keep: true, lore: ["§7Pulls someone into the Static.", "§7Use while looking at a target.", "§7Use on yourself to enter alone."] });
    title(killer, "§f ", "§7The noise stops. You can hold it now.", 60);
    system.runTimeout(() => valid(killer) && quip(killer, "null_down", "You beat the signal. That remote? It can pull anyone into that place now. ...Be careful who you are.", 600), 40);
    markDirty(killer);
  }
}

// Using the Static Remote (after the quest): pull your target, or yourself, into the Static.
export function useRemote(player) {
  const h = hero(player);
  if (questStage(player) < 4) { hudMsg(player, "§7It won't tune. §8(Beat NULL first.)"); return; }
  const r = RT(player);
  const t = now();
  if ((r.remoteCd ?? 0) > t) { hudMsg(player, `§7Recharging... §c${(((r.remoteCd ?? 0) - t) / 20).toFixed(1)}s`, 20); return; }
  let tgt = null;
  try {
    const hit = player.getEntitiesFromViewDirection({ maxDistance: 30 }).filter((x) => x.entity.id !== player.id && x.entity.typeId === "minecraft:player");
    tgt = hit[0]?.entity ?? null;
  } catch { }
  r.remoteCd = t + 20 * 15;
  pullIn(player, tgt ?? player);
}
