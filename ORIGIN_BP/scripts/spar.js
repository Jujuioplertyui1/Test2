// ORIGIN v0.02 - spar.js
// Summon a sparring Rift Brute in your Inner World arena (Codex button or ring the dojo bell).
import { RT } from "./data.js";
import { at, now, V } from "./util.js";
import { hudMsg } from "./voice.js";
import { inIW, landmark, iwDim } from "./innerworld.js";
import { spawnBrute, BRUTE } from "./enemy.js";

export function spar(player) {
  if (!inIW(player)) { hudMsg(player, "§7Spar inside your Inner World (ring the dojo bell)."); return; }
  const r = RT(player);
  if (now() < (r.sparCd ?? 0)) { hudMsg(player, "§7The arena is still settling..."); return; }
  const c = landmark(player, "arena");
  const dim = iwDim();
  let alive = 0;
  try { alive = dim.getEntities({ type: BRUTE, location: c, maxDistance: 20 }).length; } catch { }
  if (alive >= 1) { hudMsg(player, "§cOne at a time. It's already here."); return; }
  r.sparCd = now() + 100;
  spawnBrute(dim, at(c, 0, 1, 0));
}

export function isDojoBell(player, block) {
  if (block.typeId !== "minecraft:bell" || !inIW(player)) return false;
  return V.dist(block.location, landmark(player, "bell")) < 2.5;
}
