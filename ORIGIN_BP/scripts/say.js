// ORIGIN v0.13 - say.js
// The suit's assistant voice. Lines go ONLY to the suit's owner (private chat line + a soft ping + the visor panel).
// {addr} = how it addresses you (sir / ma'am / boss / your name...), {name} = what you named it.
import { hero, RT } from "./data.js";
import { msg, psound, now } from "./util.js";

export const AI_DEFAULT = "ATLAS";
export function aiOf(p) {
  const a = hero(p).exo?.ai ?? {};
  return { name: String(a.name || AI_DEFAULT), addr: String(a.addr || "sir"), chatter: a.chatter !== false };
}
export const aiName = (p) => aiOf(p).name;
export function fmt(p, text) {
  const a = aiOf(p);
  const cap = a.addr.charAt(0).toUpperCase() + a.addr.slice(1);
  return String(text).replace(/\{addr\}/g, a.addr).replace(/\{Addr\}/g, cap).replace(/\{name\}/g, a.name).replace(/\{player\}/g, p.name);
}
export function aiSay(p, text, { ping = true, chat = true } = {}) {
  const a = aiOf(p);
  const t = fmt(p, text);
  if (chat) msg(p, `§3[§b${a.name}§3]§r §f${t}`);
  if (ping) psound(p, "origin.sfx.ding", 1.55, 0.3);
  const r = RT(p);
  r.aiLine = t;
  r.aiUntil = now() + 140;
  return t;
}
// unprompted callouts: respect the chatter setting and a per-key cooldown
export function aiChatter(p, key, text, cd = 600) {
  if (!aiOf(p).chatter) return false;
  const r = RT(p);
  r.aiCd ??= {};
  if ((r.aiCd[key] ?? -1e9) > now()) return false;
  r.aiCd[key] = now() + cd;
  aiSay(p, text);
  return true;
}
