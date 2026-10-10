// ORIGIN v0.02 - forms.js
// The RP's JSON UI picks a custom layout from the title prefix:
//   origin:menu|Title   themed card list          origin:talk|Name   dialogue box with portrait
//   origin:suit|Title   Suit Forge (30-cell grid + live paper doll from <codes> in the body)
//   origin:forge|Title  Move Forge (15-cell grid + power bar from <pwNN>)
// Without the resource pack, these still work as normal (vanilla-looking) forms.
import { ActionFormData, ModalFormData, FormCancelationReason } from "@minecraft/server-ui";
import { system } from "@minecraft/server";
import { hero } from "./data.js";

export const ICONS = "textures/origin/ui/";
export const PAD = "~"; // invisible padding cell in grid layouts

export function oform(layout, title, body) {
  const f = new ActionFormData().title(`origin:${layout}|${title}`);
  if (body !== undefined) f.body(body);
  f.__raw = { title, body };
  return f;
}

// "/hero ui vanilla" (or the Codex toggle): plain Minecraft forms, no custom layouts.
function plain(player, form) {
  if (!form.__raw) return;
  let ui;
  try { ui = hero(player).ui; } catch { return; }
  if (ui !== "vanilla") return;
  form.title(form.__raw.title);
  if (form.__raw.body !== undefined) form.body(String(form.__raw.body).replace(/<[a-z]+\d+>/g, ""));
}

// Show a form; retries while the player is busy (e.g. chat open). Returns the response or null.
export async function show(player, form, tries = 20) {
  plain(player, form);
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await form.show(player); } catch { return null; }
    if (res.canceled && res.cancelationReason === FormCancelationReason.UserBusy) { await system.waitTicks(10); continue; }
    return res;
  }
  return null;
}

export { ActionFormData, ModalFormData };
