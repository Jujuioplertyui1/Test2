// ORIGIN v0.05 - suitforge.js
// The Suit Forge station: stand at it, the camera swings in front of you, and every pick
// is put on your body live. The form panel sits on the right so you can see yourself on the left.
import { system, InputPermissionCategory } from "@minecraft/server";
import { hero, RT, markDirty } from "./data.js";
import { V, at, valid, fx, psound, sound, C, hexToRgb, yawTo, rightOf } from "./util.js";
import { oform, show, ICONS, PAD, ModalFormData } from "./forms.js";
import { SUIT, PART_KEYS, PALETTE, PRESETS, suitOf, styleOf, nearestPalette, colorName, equipSuit, removeSuit, applyPreset, setPart } from "./suit.js";
import { quip } from "./voice.js";

const pad2 = (n) => String(n).padStart(2, "0");

// body codes the JSON UI reads to color the paper doll
function dollCodes(su, sel) {
  const ms = SUIT.mask.styles.findIndex((s) => s.key === su.mask.style);
  const te = SUIT.torso.styles.findIndex((s) => s.key === su.torso.style);
  const ls = SUIT.legs.styles.findIndex((s) => s.key === su.legs.style);
  // the paper doll only has art for the original styles: newer ones show the closest classic shape
  return `<m${pad2(nearestPalette(su.mask.color))}><t${pad2(nearestPalette(su.torso.color))}>` +
    `<l${pad2(nearestPalette(su.legs.color))}><b${pad2(nearestPalette(su.boots.color))}>` +
    `<ms${ms > 2 ? 0 : Math.max(0, ms)}><te${te > 3 ? 0 : Math.max(0, te)}><ls${ls > 1 ? 0 : Math.max(0, ls)}><sel${sel}>`;
}

function frame(player, station) {
  // turn the player away from the station and put the camera in front of them
  const P = player.location;
  const away = V.flat(V.sub(P, station));
  const camPos = at(P, away.x * 3.1, 1.35, away.z * 3.1);
  const camRight = rightOf({ x: -away.x, y: 0, z: -away.z });
  const look = at(P, camRight.x * 1.15, 1.05, camRight.z * 1.15);
  try {
    player.teleport(P, { rotation: { x: 0, y: yawTo(P, at(P, away.x, 0, away.z)) } });
    player.camera.setCamera("minecraft:free", { location: camPos, facingLocation: look, easeOptions: { easeTime: 0.6, easeType: "InOutSine" } });
  } catch { }
}

function lock(player, on) {
  try {
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, !on);
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, !on);
  } catch { }
}

function shimmer(player, hex) {
  const rgb = hexToRgb(hex);
  fx(player.dimension, "origin:aura", player.location, rgb, 0.9);
  fx(player.dimension, "origin:rise", at(player.location, 0, 0.8, 0), rgb, 0.8);
  psound(player, "armor.equip_leather", 1.1 + Math.random() * 0.2, 0.7);
}

export async function openSuitForge(player, stationLoc) {
  const h = hero(player);
  const r = RT(player);
  if (!h.awakened) { player.sendMessage("§7The mannequin's blank face stares back. §8(Awaken first.)"); return; }
  if (r.station || r.cine || r.traveling) return;
  r.station = { kind: "suit" };
  const station = at(stationLoc, 0.5, 0, 0.5);
  let part = "torso";
  let mode = "colors";        // the grid shows Colors or Styles; the row-1 buttons switch
  const history = [];
  try {
    lock(player, true);
    frame(player, station);
    sound(player.dimension, "origin.sfx.hum", station, 1.3, 0.6);
    fx(player.dimension, "origin:pillar", station, C.gold, 0.6);
    equipSuit(player);
    quip(player, "suitforge", "Ooh, fitting time. Tap a part, then a color. I'll tell you if it's ugly.", 6000, false);
    for (;;) {
      if (!valid(player)) return;
      const su = suitOf(h);
      const P = SUIT[part];
      const cur = su[part];
      const curIdx = PALETTE.findIndex(([, hx]) => hx.toUpperCase() === cur.color.toUpperCase());
      const f = oform("suit", `SUIT FORGE  §7·  §f${P.label}: §e${styleOf(part, cur.style).name}§7, §f${colorName(cur.color)}`, dollCodes(su, PART_KEYS.indexOf(part)));
      const acts = [];
      const btn = (text, icon, act) => { f.button(text, icon); acts.push(act); };
      // row 0: tabs
      for (const k of PART_KEYS) btn((k === part ? "» " : "") + SUIT[k].label, `${ICONS}tab_${k}`, { tab: k });
      btn("Presets", `${ICONS}tab_presets`, { presets: true });
      // row 1: the two sections + tools
      btn((mode === "colors" ? "» " : "") + "Colors", `${ICONS}act_rgb`, { mode: "colors" });
      btn((mode === "styles" ? "» " : "") + "Styles", `${ICONS}style_${part}_${cur.style}`, { mode: "styles" });
      btn("RGB", `${ICONS}act_rgb`, { rgb: true });
      btn("Match", `${ICONS}act_match`, { match: true });
      btn("Random", `${ICONS}act_suitup`, { random: true });
      // rows 2-5: a 4x4 grid (colors OR styles) + an action each
      const side = [["Suit Up", "act_suitup", { suitup: true }], ["Take Off", "act_takeoff", { off: true }], ["Undo", "act_back", { undo: true }], ["Done", "act_done", { done: true }]];
      for (let row = 0; row < 4; row++) {
        for (let c = 0; c < 4; c++) {
          const i = row * 4 + c;
          if (mode === "colors") btn(i === curIdx ? "»" : " ", `${ICONS}swatch_${i}`, { color: PALETTE[i][1] });
          else {
            const st = P.styles[i];
            if (st) btn((st.key === cur.style ? "» " : "") + st.name, `${ICONS}style_${part}_${st.key}`, { style: st.key });
            else btn(PAD, undefined, null);
          }
        }
        btn(side[row][0], ICONS + side[row][1], side[row][2]);
      }
      const res = await show(player, f);
      if (!res || res.canceled || res.selection === undefined) break;
      const a = acts[res.selection];
      if (!a) continue;
      if (a.done) break;
      if (a.tab) { part = a.tab; psound(player, "item.book.page_turn", 1.2, 0.6); continue; }
      if (a.mode) { mode = a.mode; psound(player, "random.click", 1.3, 0.6); continue; }
      if (a.undo) {
        const prev = history.pop();
        if (prev) { for (const k of PART_KEYS) setPart(player, k, { ...prev[k] }); equipSuit(player); psound(player, "item.book.page_turn", 0.8, 0.6); }
        continue;
      }
      history.push(JSON.parse(JSON.stringify(suitOf(h))));
      if (history.length > 20) history.shift();
      if (a.random) {
        for (const k of PART_KEYS) {
          const S = SUIT[k].styles;
          setPart(player, k, { style: S[Math.floor(Math.random() * S.length)].key, color: PALETTE[Math.floor(Math.random() * PALETTE.length)][1] });
        }
        equipSuit(player); suitUpFlourish(player, suitOf(h).torso.color); continue;
      }
      if (a.style) { setPart(player, part, { style: a.style }); equipSuit(player, [part]); shimmer(player, cur.color); continue; }
      if (a.color) { setPart(player, part, { color: a.color }); equipSuit(player, [part]); shimmer(player, a.color); continue; }
      if (a.match) { for (const k of PART_KEYS) setPart(player, k, { color: cur.color }); equipSuit(player); shimmer(player, cur.color); continue; }
      if (a.suitup) { equipSuit(player); suitUpFlourish(player, cur.color); continue; }
      if (a.off) { removeSuit(player); psound(player, "armor.equip_leather", 0.7, 0.8); continue; }
      if (a.presets) { await presets(player); continue; }
      if (a.rgb) { await customColor(player, part); continue; }
    }
  } finally {
    if (valid(player)) {
      try { player.camera.clear(); } catch { }
      lock(player, false);
    }
    r.station = null;
    markDirty(player);
  }
}

function suitUpFlourish(player, hex) {
  const rgb = hexToRgb(hex);
  fx(player.dimension, "origin:pillar", player.location, rgb, 1);
  fx(player.dimension, "origin:shockwave", at(player.location, 0, 0.05, 0), rgb, 1, { radius: 2 });
  sound(player.dimension, "origin.sfx.burst", player.location, 1.2, 0.8);
  sound(player.dimension, "random.anvil_land", player.location, 1.6, 0.3);
}

async function presets(player) {
  const f = oform("menu", "Suit Presets", "Pick a starting point. You can tweak every part after.");
  PRESETS.forEach((p, i) => f.button(p.name, `${ICONS}preset_${i}`));
  f.button("Back", `${ICONS}act_back`);
  const res = await show(player, f);
  if (!res || res.canceled || res.selection === undefined || res.selection >= PRESETS.length) return;
  applyPreset(player, PRESETS[res.selection]);
  equipSuit(player);
  suitUpFlourish(player, PRESETS[res.selection].torso[1]);
}

async function customColor(player, part) {
  const su = suitOf(hero(player));
  const c = hexToRgb(su[part].color);
  const f = new ModalFormData().title(`Custom color: ${SUIT[part].label}`)
    .slider("Red", 0, 255, { valueStep: 5, defaultValue: Math.round(c.red * 255 / 5) * 5 })
    .slider("Green", 0, 255, { valueStep: 5, defaultValue: Math.round(c.green * 255 / 5) * 5 })
    .slider("Blue", 0, 255, { valueStep: 5, defaultValue: Math.round(c.blue * 255 / 5) * 5 });
  const res = await show(player, f);
  if (!res || res.canceled || !res.formValues) return;
  const [rr, gg, bb] = res.formValues.map((v) => Math.max(0, Math.min(255, Number(v) || 0)));
  const hex = "#" + [rr, gg, bb].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  setPart(player, part, { color: hex });
  equipSuit(player, [part]);
  shimmer(player, hex);
}
