// ORIGIN v0.07 - load.js
// Dimensional loading screens: a full-screen card for each world, shown while you cross over.
// Sent on the title channel as "origin_load[code]<text>"; RP ui/origin_ui.json draws the card.
import { RT, hero } from "./data.js";
import { now, valid } from "./util.js";

const CARDS = {
  iw: ["§l§dTHE INNER WORLD", "§7your mind, made solid"],
  st: ["§l§7T H E   S T A T I C", "§8channel ∅ · find the blue water"],
  vd: ["§l§5THE VOID", "§7somewhere nothing is"],
  ow: ["§l§fWAKING UP", "§7back to the world"],
};
const TIPS = [
  "Combos: Dash then Strike is a Blindside. Open the Move Forge to see them all.",
  "Fill your Surge in fights. At Ascendant it becomes your Awakened Form.",
  "Every villain attack has a tell. Double-tap sneak right before it lands.",
  "The Exo-Frame never breaks - it goes offline. Repair it at the Exo Workshop.",
  "Resolve comes from fights. Enough of it and your Inner World offers a Trial.",
  "In the Static, listen: you can hear the water from a long way off.",
  "The Lumen Signet builds whatever you can picture. Keep it charged in the light.",
  "Falling? Use the Exo Interface. Your suit will come and catch you mid-air.",
  "Talk to your suit: /ai where's the closest diamonds. Only you hear the answer.",
  "Paint your suit, rename your assistant and upgrade everything at the Exo Workshop.",
  "Mirror Hour rewinds one thing, once per fight. Choose well.",
];
export function showLoad(p, code, title, sub) {
  const c = CARDS[code] ?? CARDS.iw;
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
  const text = `${hero(p).overlay === "safe" ? "origin_load[alt]" : "origin_load"}[${code}]${title ?? c[0]}\n${sub ?? c[1]}\n\n§8${tip}`;
  RT(p).titleUntil = now() + 400;
  RT(p).loading = true;
  RT(p).loadAt = now();
  try { p.onScreenDisplay.setTitle(text, { fadeInDuration: 0, stayDuration: 400, fadeOutDuration: 0 }); } catch { }
}
export function hideLoad(p) {
  if (!valid(p)) return;
  const r = RT(p);
  if (!r.loading) return;
  r.loading = false;
  r.titleUntil = now() + 2;
  try { p.onScreenDisplay.setTitle("origin_load", { fadeInDuration: 0, stayDuration: 2, fadeOutDuration: 0 }); } catch { }
}

// failsafe: never leave a card up for more than 20 seconds
export function tickLoad(players) {
  for (const p of players) { const r = RT(p); if (r.loading && now() - (r.loadAt ?? 0) > 400) hideLoad(p); }
}
