// ORIGIN v0.04 - hud.js
// Corner HUD: the script sends "origin_hud<lines>" on the TITLE channel; RP ui/hud_screen.json hides that
// title in the middle of the screen and draws the text in a panel in the top-left corner instead
// (it keeps the last value, so real titles can still play over it). Quips use the actionbar.
// HUD "vanilla" mode (Codex toggle or /hero hud vanilla) shows the v0.01 actionbar HUD instead.
import { world, HudElement, HudVisibility } from "@minecraft/server";
import { hero, RT, ARCH, ICON, BAR, bar, moveStats, maxEnergy } from "./data.js";
import { now, health } from "./util.js";
import { inIW } from "./innerworld.js";
import { comboOf } from "./combat.js";
import { powerLine } from "./powers.js";
import { exoLine, visorOn, hudIndex, exoFlags } from "./exo.js";
import { targetPanel } from "./target.js";
import { gauntletLine, gauntletFlags } from "./stones.js";
import { physFlags } from "./physical.js";
import { cageLine } from "./ego.js";
import { surgeLine, trialLine } from "./ascend.js";
import { lumenLine } from "./lumen.js";
import { inNullFight } from "./null.js";
import { limbLine } from "./dismember.js";
import { staminaLine } from "./stamina.js";

export const HUD_PREFIX = "origin_hud";

function arcLine(p, h, r, over) {
  if (h.arch === "brawler") {
    let pips = "";
    for (let i = 0; i < 5; i++) pips += i < r.momentum ? ICON.pipOn : ICON.pipOff;
    return `§f${ICON.fist} ${pips}${r.momentum ? ` §6x${(1 + 0.12 * r.momentum).toFixed(2)}` : " §8Momentum"}`;
  }
  if (h.arch === "energy") return over ? `§f${ICON.star} §6§lOVERCHARGE` : `§f${ICON.star} §8Overcharge at 90%`;
  return h.dread >= 25 ? `§f${ICON.moon} §5Menace §dON §8x${(1 + h.dread / 200).toFixed(2)}` : `§f${ICON.moon} §8Menace at 25 Dread`;
}

function moveLine(h, r, t, over) {
  const m = h.moves[h.active];
  const st = moveStats(m);
  const cost = Math.round(st.cost * (over ? 1.5 : 1));
  const cd = r.cd[h.active] - t;
  const ready = cd <= 0 ? (h.energy >= cost ? "§aREADY" : "§bLOW EN") : `§c${(cd / 20).toFixed(1)}s`;
  return `§f${ICON.diamond} §e${m.name} ${ready} §8${cost}EN`;
}

export function buildCorner(p) {
  const h = hero(p);
  const r = RT(p);
  const t = now();
  const max = maxEnergy(h);
  const over = h.arch === "energy" && h.energy >= max * 0.9;
  const hp = health(p) ?? { cur: 20, max: 20 };
  const low = hp.cur <= hp.max * 0.3;
  const lines = [
    `§f${ICON.heart}${bar(low ? BAR.hot : BAR.health, hp.cur / hp.max)} §f${Math.ceil(hp.cur)}§7/${Math.round(hp.max)}`,
    `§f${ICON.bolt}${bar(over ? BAR.gold : BAR.energy, h.energy / max)} §b${Math.floor(h.energy)}§7/${max}`,
    `§f${ICON.eye}${bar(h.dread >= 70 ? BAR.hot : BAR.dread, h.dread / 100)} §c${Math.floor(h.dread)} §8Dread`,
    arcLine(p, h, r, over),
    moveLine(h, r, t, over),
  ];
  const pl = powerLine(p);
  if (pl) lines.push(pl);
  const xl = exoLine(p);
  if (xl) lines.push(xl);
  const sl = surgeLine(p);
  if (sl) lines.push(sl);
  const ll = lumenLine(p);
  if (ll) lines.push(ll);
  const tl = trialLine(p);
  if (tl) lines.unshift(tl);
  const lb = limbLine(p);
  if (lb) lines.unshift(lb);
  const stl = staminaLine(p);
  if (stl) lines.push(stl);
  const cl = cageLine(p);
  if (cl) lines.unshift(cl);
  const gl = gauntletLine(p);
  if (gl) lines.push(gl);
  const c = comboOf(p);
  if (c >= 2) lines.push(`§6${ICON.combo} §lx${c} §r§6COMBO`);
  return lines.join("\n");
}

// the v0.01 actionbar HUD (contextual)
function holding(player) {
  try {
    const inv = player.getComponent("minecraft:inventory")?.container;
    const it = inv?.getItem(player.selectedSlotIndex);
    return it?.typeId === "origin:power_focus" || it?.typeId === "origin:hero_codex" || it?.typeId === "origin:power_core";
  } catch { return false; }
}
function buildVanilla(p) {
  const h = hero(p);
  const r = RT(p);
  const t = now();
  const hasMsg = r.msgUntil > t && r.msg;
  const show = hasMsg || holding(p) || t - r.lastCombat < 160 || h.dread >= 70 || inIW(p);
  if (!show) return null;
  const max = maxEnergy(h);
  const over = h.arch === "energy" && h.energy >= max * 0.9;
  const lines = [];
  if (hasMsg) lines.push(r.msg);
  lines.push(moveLine(h, r, t, over));
  const pl = powerLine(p);
  if (pl) lines.push(pl);
  const xl = exoLine(p);
  if (xl) lines.push(xl);
  const cl = cageLine(p);
  if (cl) lines.unshift(cl);
  lines.push(`§f${ICON.bolt}${bar(over ? BAR.gold : BAR.energy, h.energy / max, 8)} §b${Math.floor(h.energy)}`);
  lines.push(`§f${ICON.eye}${bar(h.dread >= 70 ? BAR.hot : BAR.dread, h.dread / 100, 8)} §c${Math.floor(h.dread)}`);
  lines.push(arcLine(p, h, r, over));
  return lines.join("\n");
}

function sendTitle(p, text, sub = " ") {
  try { p.onScreenDisplay.setTitle(text, { fadeInDuration: 0, stayDuration: 200, fadeOutDuration: 0, subtitle: sub || " " }); } catch { }
}

// every 4 ticks
export function tickHud() {
  const t = now();
  for (const p of world.getAllPlayers()) {
    const r = RT(p);
    const h = hero(p);
    const mode = h.awakened ? (h.hud === "vanilla" ? "vanilla" : "corner") : "none";
    if (r.hudReset || (mode !== "corner" && r.hudMode === "corner")) {
      r.hudReset = false;
      try { p.onScreenDisplay.setHudVisibility(HudVisibility.Reset, [HudElement.Health]); } catch { }
      if (!(r.titleUntil > t)) sendTitle(p, HUD_PREFIX);   // empty corner HUD
      r.lastHud = HUD_PREFIX;
      r.hpHideAt = -999;
    }
    r.hudMode = mode;
    // quips and messages: actionbar (re-sent so long messages stay up)
    if (mode !== "vanilla" && r.msgUntil > t && r.msg && !(r.cine && !r.cine.awaitingPick)) {
      if (r.msgSentText !== r.msg || t - (r.msgSentAt ?? -99) >= 36) {
        try { p.onScreenDisplay.setActionBar(r.msg); } catch { }
        r.msgSentText = r.msg;
        r.msgSentAt = t;
      }
    }
    if (mode === "vanilla") {
      if (r.cine && !r.cine.awaitingPick) continue;
      const text = buildVanilla(p);
      if (text) try { p.onScreenDisplay.setActionBar(text); } catch { }
      continue;
    }
    if (mode !== "corner") continue;
    if (t - (r.hpHideAt ?? -999) > 100) {
      r.hpHideAt = t;
      try { p.onScreenDisplay.setHudVisibility(HudVisibility.Hide, [HudElement.Health]); } catch { }
    }
    if (r.titleUntil > t) continue;
    // flags ride on the title (visor + its color, NULL's live frame, safe-overlay mode); the target panel rides on the subtitle
    let text, sub;
    try {
      text = HUD_PREFIX + gauntletFlags(p) + physFlags(p) + (visorOn(p) ? "origin_visororigin_vc" + hudIndex(p) + exoFlags(p) : "") + (inNullFight(p) ? "origin_live" : "") + (h.overlay === "safe" ? "origin_alt" : "") + buildCorner(p);
      sub = targetPanel(p) || " ";
    } catch { continue; }
    if (text !== r.lastHud || sub !== r.lastSub || t - (r.lastHudAt ?? -999) > 80) {
      if (text === r.lastHud && sub !== r.lastSub) r.hudQ = !r.hudQ;   // force a title change so the UI re-reads the subtitle
      sendTitle(p, r.hudQ ? text.replace(HUD_PREFIX, HUD_PREFIX + "origin_q") : text, sub);
      r.lastHud = text;
      r.lastSub = sub;
      r.lastHudAt = t;
    }
  }
}
