// ORIGIN v0.02 - voice.js
// Short messages (actionbar, sent by hud.js) + the Manifestation's voice in your head.
import { RT } from "./data.js";
import { now, msg, psound } from "./util.js";

export function hudMsg(player, text, ticks = 80) {
  const r = RT(player);
  r.msg = text;
  r.msgUntil = now() + ticks;
  r.msgSentText = null;
}

// Returns true if the line was spoken (false if that key is still on cooldown).
export function quip(player, key, text, cooldown = 1200, chat = true) {
  const r = RT(player);
  const t = now();
  if ((r.quips[key] ?? -1e9) > t) return false;
  r.quips[key] = t + cooldown;
  hudMsg(player, `§d§o"${text}"`, 100);
  if (chat) msg(player, `§8[§dManifestation§8] §7§o${text}`);
  psound(player, "origin.sfx.hum", 1.7, 0.25);
  return true;
}
