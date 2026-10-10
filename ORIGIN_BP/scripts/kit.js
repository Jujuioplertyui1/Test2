// ORIGIN v0.02 - kit.js
import { ItemStack } from "@minecraft/server";

export const ITEMS = {
  codex: "origin:hero_codex",
  focus: "origin:power_focus",
  shard: "origin:humming_shard",
  suitForge: "origin:suit_forge",
  moveForge: "origin:move_forge",
  core: "origin:power_core",
  staticShard: "origin:static_shard",
  receiver: "origin:detuned_receiver",
  remote: "origin:static_remote",
};

function container(player) {
  try { return player.getComponent("minecraft:inventory")?.container; } catch { return undefined; }
}

export function hasItem(player, typeId) {
  const c = container(player);
  if (!c) return false;
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (it && it.typeId === typeId) return true;
  }
  return false;
}

export function giveItem(player, typeId, { keep = true, lore } = {}) {
  try {
    const s = new ItemStack(typeId, 1);
    s.keepOnDeath = keep;
    if (lore) s.setLore(lore);
    const c = container(player);
    const left = c ? c.addItem(s) : s;
    if (left) player.dimension.spawnItem(left, player.location);
    return true;
  } catch (e) {
    console.warn("[ORIGIN] give failed: " + e);
    return false;
  }
}

export function countItem(player, typeId) {
  const c = container(player);
  if (!c) return 0;
  let n = 0;
  for (let i = 0; i < c.size; i++) { const it = c.getItem(i); if (it && it.typeId === typeId) n += it.amount; }
  return n;
}

export function removeOne(player, typeId) {
  const c = container(player);
  if (!c) return false;
  for (let i = 0; i < c.size; i++) {
    const it = c.getItem(i);
    if (it && it.typeId === typeId) {
      if (it.amount > 1) { it.amount -= 1; c.setItem(i, it); }
      else c.setItem(i, undefined);
      return true;
    }
  }
  return false;
}

export function giveKit(player) {
  if (!hasItem(player, ITEMS.codex)) giveItem(player, ITEMS.codex, { lore: ["§7Use: open your Hero Codex"] });
  if (!hasItem(player, ITEMS.focus)) giveItem(player, ITEMS.focus, { lore: ["§7Use: cast active move", "§7Sneak + Use: next move"] });
  if (!hasItem(player, ITEMS.core)) giveItem(player, ITEMS.core, { lore: ["§7Use: your signature power.", "§7Sneak + use: Power menu."] });
}

export function giveStations(player) {
  giveItem(player, ITEMS.suitForge, { keep: false });
  giveItem(player, ITEMS.moveForge, { keep: false });
}
