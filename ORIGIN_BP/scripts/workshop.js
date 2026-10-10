// ORIGIN v0.13 - workshop.js
// The Exo Workshop (the old Exo-Forge block, rebuilt): build any Mark you have the blueprint for, research new
// Blueprints with Schematic Data, paint the suit, upgrade it, repair it, fabricate parts, and set up your assistant.
import { system } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";
import { hero, RT, markDirty, saveNow } from "./data.js";
import { V, at, fx, sound, psound, msg, hexToRgb, rgbToHex } from "./util.js";
import { oform, show, ICONS } from "./forms.js";
import { runCine, EASE } from "./cine.js";
import { PALETTE } from "./suit.js";
import { aiSay, aiOf } from "./say.js";
import { MARKS, MARK_KEYS, SLOT_KEYS, SLOT_NAME, BLUEPRINTS, BP_KEYS, UPGRADES, UP_KEYS, MAX_UP, upCost, buildCost, exoData, knows,
  count, take, give, hasAll, needText, NICE, makePiece, paintFor, repaintSuit, repaintFactory, damagedPieces, repairPieces, HUD_COLORS, BEAM_COLORS, INTERFACE, suitName } from "./exo.js";

const R = (id, n) => ({ id, n });
const CYAN = hexToRgb("#55f2ff"), EMBER = hexToRgb("#ff7a1a"), GOLD = hexToRgb("#d9a441");
const DATA = "origin:blueprint_data";
export const AI_NAMES = ["ATLAS", "VEGA", "ORION", "NOVA", "ECHO", "SABLE"];
export const ADDRESS = ["sir", "ma'am", "boss", "captain", "chief", "partner"];
export const FABRICATE = [
  { out: "origin:aetherium_ingot", name: "Aetherium Ingot", time: 50, need: [R("origin:raw_aetherium", 2), R("minecraft:gold_ingot", 1)] },
  { out: "origin:starmetal_plate", name: "Starmetal Plate", time: 50, need: [R("origin:starmetal_fragment", 2), R("minecraft:iron_block", 1)] },
  { out: "origin:reactor_core", name: "Reactor Core", time: 140, big: true, need: [R("minecraft:nether_star", 1), R("origin:null_crystal", 2), R("origin:aetherium_ingot", 4), R("origin:rift_heart", 1)] },
  { out: INTERFACE, name: "Exo Interface", time: 40, need: [R("origin:aetherium_ingot", 1), R("origin:null_crystal", 1), R("minecraft:redstone_block", 1)] },
  { out: "origin:super_serum", name: "Super Soldier Serum", time: 140, big: true, need: [R("origin:rift_heart", 1), R("origin:null_crystal", 1), R("minecraft:enchanted_golden_apple", 1), R("minecraft:nether_wart", 4)] },
  { out: "origin:mod_cannon", name: "Module: Arm Cannon", time: 70, need: [R("origin:aetherium_ingot", 1), R("minecraft:blaze_rod", 2), R("minecraft:redstone", 8)] },
  { out: "origin:mod_grapple", name: "Module: Grapple Line", time: 70, need: [R("origin:aetherium_ingot", 1), R("minecraft:lead", 2), R("minecraft:tripwire_hook", 2)] },
  { out: "origin:mod_piston", name: "Module: Piston Fist", time: 70, need: [R("origin:aetherium_ingot", 1), R("minecraft:piston", 2), R("minecraft:iron_block", 1)] },
  { out: "origin:mod_drill", name: "Module: Mining Drill", time: 70, need: [R("origin:aetherium_ingot", 1), R("minecraft:diamond", 2), R("minecraft:gold_block", 1)] },
  { out: "origin:mod_shield", name: "Module: Shield Emitter", time: 70, need: [R("origin:starmetal_plate", 1), R("minecraft:shield", 1), R("minecraft:amethyst_shard", 4)] },
  { out: "origin:exo_prosthetic", name: "Exo Prosthetic Arm", time: 110, need: [R("origin:aetherium_ingot", 3), R("origin:starmetal_plate", 2), R("origin:null_crystal", 1), R("minecraft:redstone_block", 1)] },
];
const merge = (lists) => { const m = new Map(); for (const l of lists) for (const x of l) m.set(x.id, (m.get(x.id) ?? 0) + x.n); return [...m].map(([id, n]) => R(id, n)); };
function pay(p, need) {
  if (!hasAll(p, need)) {
    msg(p, `§cMissing: §7${need.filter((x) => count(p, x.id) < x.n).map((x) => `${x.n - count(p, x.id)}x ${NICE(x.id)}`).join(", ")}`);
    psound(p, "random.fizz", 1, 0.6);
    return false;
  }
  for (const x of need) take(p, x.id, x.n);
  return true;
}
async function scene(p, loc, title, time = 60, big = false) {
  const c0 = at(loc, 0.5, 1.1, 0.5), dim = p.dimension;
  await runCine(p, async (c) => {
    const f = V.flat(V.sub(p.location, c0));
    c.cam(at(c0, f.x * 2.6 + f.z * 1.2, 1.2, f.z * 2.6 - f.x * 1.2), c0);
    c.say(`§b${title}`, time);
    for (let t = 0; t < time; t += 4) {
      fx(dim, "origin:spark", at(c0, (Math.random() - 0.5) * 0.8, 0.2, (Math.random() - 0.5) * 0.8), Math.random() < 0.5 ? CYAN : EMBER, 1);
      if (t % 12 === 0) sound(dim, t % 24 ? "random.anvil_use" : "origin.sfx.servo", c0, 0.8 + Math.random() * 0.4, 0.8);
      if (t % 16 === 0) fx(dim, "origin:ring", at(c0, 0, 0.4, 0), CYAN, 0.8, { radius: 0.6 });
      if (t === Math.floor(time / 2)) c.cam(at(c0, -f.z * 2.2, 1.8, f.x * 2.2), c0, 1.2, EASE.InOutSine);
      if (big && t % 20 === 0) { fx(dim, "origin:shockwave", c0, CYAN, 1, { radius: 1.6 }); c.shake(0.2, 0.3); }
      await c.wait(4);
    }
    fx(dim, "origin:burst", c0, big ? CYAN : GOLD, 1);
    sound(dim, big ? "beacon.activate" : "random.levelup", c0, 1, 1.2);
    if (big) c.fade(0, 0.1, 0.5, { red: 0.7, green: 1, blue: 1 });
    await c.wait(12);
  });
}
async function menu(p, title, body, items) {
  const f = oform("menu", title, body);
  for (const [txt, icon] of items) f.button(txt, ICONS + icon);
  const res = await show(p, f);
  return !res || res.canceled ? -1 : res.selection;
}

export async function openWorkshop(p, loc) {
  const r = RT(p);
  if (r.cine || r.station) return;
  const h = hero(p), x = exoData(h);
  const hurt = damagedPieces(p);
  const acts = ["build", "paint", "up", "bp", "fab", "repair", "ai", "close"];
  const sel = await menu(p, "Exo Workshop", `§b§lEXO WORKSHOP§r §8· ${suitName(p)}\n§7Blueprints: §f${x.bp.length}/${BP_KEYS.length} §8· Schematic Data: §f${count(p, DATA)}\n§8Schematic Data: crafted (2 paper, redstone, lapis, glowstone), from Rift Brutes, villains, NULL and meteorites.`, [
    ["Build a Suit\n§8Forge any Mark you have the blueprint for", "x_build"],
    ["Paint Shop\n§8Paint, HUD color, beam color, suit name", "x_paint"],
    ["Upgrades\n§8Reactor · Thrusters · Plating · Repulsors · Sensors · Ordnance", "x_upgrade"],
    ["Blueprints\n§8Research new Marks and systems", "x_blueprint"],
    ["Fabricate\n§8Ingots, plates, reactor cores, modules", "x_fabricate"],
    [`Repair\n§8${hurt.length ? `${hurt.length} damaged · ${hurt.length * 2} Aetherium Ingots` : "nothing to repair"}`, "x_repair"],
    [`Assistant: ${aiOf(p).name}\n§8Its name, how it talks to you, chatter`, "x_ai"],
    ["Close", "act_back"],
  ]);
  const a = acts[sel];
  if (!a || a === "close") return;
  if (a === "build") return buildMenu(p, loc);
  if (a === "paint") return paintMenu(p, loc);
  if (a === "up") return upgradeMenu(p, loc);
  if (a === "bp") return blueprintMenu(p, loc);
  if (a === "fab") return fabMenu(p, loc);
  if (a === "ai") return aiMenu(p, loc);
  if (a === "repair") {
    if (!hurt.length) { aiSay(p, "Everything's in factory shape, {addr}."); return; }
    if (!pay(p, [R("origin:aetherium_ingot", hurt.length * 2)])) return;
    await scene(p, loc, "Repairing the Exo-Frame", 70);
    repairPieces(p, damagedPieces(p));
    aiSay(p, `${hurt.length} piece${hurt.length > 1 ? "s" : ""} back to factory spec, {addr}.`);
  }
}

async function buildMenu(p, loc) {
  const h = hero(p), x = exoData(h);
  const items = MARK_KEYS.map((k) => knows(h, k)
    ? [`§f${MARKS[k].name} · ${MARKS[k].title}\n§8${MARKS[k].blurb}`.slice(0, 150), `x_${k}`]
    : [`§8${MARKS[k].name} · ${MARKS[k].title} §7· locked\n§8Research its blueprint first`, "x_lock"]);
  items.push(["Back", "act_back"]);
  const sel = await menu(p, "Build a Suit", "§7Every Mark plays differently. Pieces mix: boots = thrusters, chest = reactor + weapons, helmet = sensors.\n§8New pieces come out in your current paint.", items);
  if (sel < 0) return;
  if (sel >= MARK_KEYS.length) return openWorkshop(p, loc);
  const mk = MARK_KEYS[sel];
  if (!knows(h, mk)) { aiSay(p, `I don't have the plans for the ${MARKS[mk].name} yet, {addr}. Research the blueprint first.`); return blueprintMenu(p, loc); }
  const full = merge(SLOT_KEYS.map((s) => buildCost(mk, s)));
  const opts = [["Full suit (all four pieces)\n" + needText(p, full).slice(0, 150), `x_${mk}`]];
  for (const s of SLOT_KEYS) opts.push([`${SLOT_NAME[s]}\n${needText(p, buildCost(mk, s))}`.slice(0, 160), "x_build"]);
  opts.push(["Back", "act_back"]);
  const pick = await menu(p, `${MARKS[mk].name} ${MARKS[mk].title}`, `§7${MARKS[mk].blurb}\n§8Armor ${MARKS[mk].armor >= 0 ? "+" : ""}${MARKS[mk].armor} · flight x${MARKS[mk].fly} · reactor ${MARKS[mk].reactor} · repulsor ${MARKS[mk].rep}`, opts);
  if (pick < 0) return;
  if (pick > SLOT_KEYS.length) return buildMenu(p, loc);
  const slots = pick === 0 ? SLOT_KEYS : [SLOT_KEYS[pick - 1]];
  if (!pay(p, pick === 0 ? full : buildCost(mk, slots[0]))) return;
  await scene(p, loc, `Forging ${MARKS[mk].name} ${MARKS[mk].title}`, pick === 0 ? 120 : 70, pick === 0);
  const col = paintFor(x, mk);
  for (const s of slots) give(p, makePiece(s, 0, 0, [], null, mk, col));
  msg(p, `§b§lFORGED: §r§f${MARKS[mk].name} ${slots.length === 4 ? "(full suit)" : SLOT_NAME[slots[0]]}`);
  aiSay(p, slots.length === 4 ? `The ${MARKS[mk].name} is ready, {addr}. Put it on.` : `${SLOT_NAME[slots[0]]} is done, {addr}.`, { chat: false });
}

async function paintMenu(p, loc) {
  const x = exoData(hero(p));
  const cur = x.paint.primary;
  const acts = ["primary", "hud", "beam", "name", "preview", "back"];
  const sel = await menu(p, "Paint Shop", "§7Not everyone flies the same suit. Make it yours.", [
    [`Paint: §f${cur ? cur : "each Mark's factory color"}\n§8Repaints every piece you wear or carry`, "x_paint"],
    [`HUD color: §f${HUD_COLORS[x.paint.hud ?? 0][0]}\n§8Your visor overlay and target markers`, "x_hud"],
    [`Beam color: §f${BEAM_COLORS[x.paint.beam ?? 0][0]}\n§8Repulsors, thrusters, Core Lance`, "x_beam"],
    [`Suit name: §f${x.paint.name || suitName(p)}`, "x_name"],
    ["Preview\n§8A slow turntable shot of you in the suit", "x_target"],
    ["Back", "act_back"],
  ]);
  const a = acts[sel];
  if (!a) return;
  if (a === "back") return openWorkshop(p, loc);
  if (a === "preview") {
    await runCine(p, async (c) => {
      const b = { ...p.location };
      for (let i = 0; i <= 80; i++) { const ang = (i / 80) * Math.PI * 2; c.cam(at(b, Math.sin(ang) * 3.1, 1.4, Math.cos(ang) * 3.1), at(b, 0, 1.05, 0), 0.1, EASE.Linear); await c.wait(1); }
    });
    return paintMenu(p, loc);
  }
  if (a === "primary") {
    const items = PALETTE.map(([n, hx], i) => [`${n}\n§8${hx}`, `swatch_${i}`]);
    items.push(["Custom color\n§8Mix your own (RGB)", "act_rgb"], ["Factory colors\n§8Each Mark keeps its own", "x_mk3"], ["Back", "act_back"]);
    const s = await menu(p, "Paint", "§7Pick your suit's main color. Trim and lights stay true to each Mark.", items);
    if (s < 0) return;
    if (s === items.length - 1) return paintMenu(p, loc);
    let hex = null;
    if (s < PALETTE.length) hex = PALETTE[s][1];
    else if (s === PALETTE.length) {
      const c = hexToRgb(cur || "#2F4E8C");
      const f = new ModalFormData().title("Custom paint")
        .slider("§cRed", 0, 255, { valueStep: 5, defaultValue: Math.round(c.red * 255 / 5) * 5 })
        .slider("§aGreen", 0, 255, { valueStep: 5, defaultValue: Math.round(c.green * 255 / 5) * 5 })
        .slider("§9Blue", 0, 255, { valueStep: 5, defaultValue: Math.round(c.blue * 255 / 5) * 5 });
      const res = await show(p, f);
      if (!res || res.canceled) return paintMenu(p, loc);
      const [rr, gg, bb] = res.formValues.map((v) => Number(v) / 255);
      hex = rgbToHex({ red: rr, green: gg, blue: bb });
    }
    x.paint.primary = hex;
    if (hex) repaintSuit(p, hex);
    else repaintFactory(p);
    markDirty(p);
    sound(p.dimension, "origin.sfx.swoosh", p.location, 1.4, 0.6);
    for (let i = 0; i < 12; i++) fx(p.dimension, "origin:mote", at(p.location, (Math.random() - 0.5), 0.3 + Math.random() * 1.6, (Math.random() - 0.5)), hexToRgb(hex || "#ffffff"), 1);
    aiSay(p, hex ? `Paint's on: ${hex}. Looks good, {addr}.` : "Factory colors restored, {addr}.", { chat: false });
    return paintMenu(p, loc);
  }
  if (a === "hud" || a === "beam") {
    const list = a === "hud" ? HUD_COLORS : BEAM_COLORS;
    const s = await menu(p, a === "hud" ? "HUD color" : "Beam color", "", [...list.map(([n, hx]) => [`${n}\n§8${hx}`, a === "hud" ? "x_hud" : "x_beam"]), ["Back", "act_back"]]);
    if (s >= 0 && s < list.length) { x.paint[a] = s; markDirty(p); psound(p, "origin.sfx.ting", 1.2, 0.5); }
    return paintMenu(p, loc);
  }
  if (a === "name") {
    const f = new ModalFormData().title("Name your suit").textField("Suit name (blank = automatic)", "Mark VII", { defaultValue: x.paint.name || "" });
    const res = await show(p, f);
    if (res && !res.canceled) { x.paint.name = String(res.formValues[0] ?? "").replace(/§./g, "").trim().slice(0, 24); markDirty(p); }
    return paintMenu(p, loc);
  }
}

async function upgradeMenu(p, loc) {
  const h = hero(p), x = exoData(h);
  const lv = (k) => x.up[k] ?? 0;
  const pips = (n) => "§b" + "■".repeat(n) + "§8" + "□".repeat(MAX_UP - n);
  const items = UP_KEYS.map((k) => [`${UPGRADES[k].name} ${pips(lv(k))}\n§8${lv(k) >= MAX_UP ? "maxed" : UPGRADES[k].desc}`.slice(0, 150), UPGRADES[k].icon]);
  items.push(["Back", "act_back"]);
  const sel = await menu(p, "Upgrades", "§7Upgrades belong to you, not one suit: they carry over to every Mark you wear.\n§8Level 3 needs the Advanced Schematics blueprint.", items);
  if (sel < 0) return;
  if (sel >= UP_KEYS.length) return openWorkshop(p, loc);
  const k = UP_KEYS[sel], next = lv(k) + 1;
  if (next > MAX_UP) { aiSay(p, `${UPGRADES[k].name} is maxed out, {addr}.`); return upgradeMenu(p, loc); }
  if (next === MAX_UP && !knows(h, "advanced")) { aiSay(p, "Level 3 needs the Advanced Schematics blueprint, {addr}."); return upgradeMenu(p, loc); }
  const cost = upCost(next);
  const ok = await menu(p, `${UPGRADES[k].name} → level ${next}`, `§7${UPGRADES[k].desc}\n§fCost: ${needText(p, cost)}`, [["Install", "x_upgrade"], ["Back", "act_back"]]);
  if (ok !== 0) return upgradeMenu(p, loc);
  if (!pay(p, cost)) return;
  await scene(p, loc, `${UPGRADES[k].name} Mk ${next}`, 70);
  x.up[k] = next;
  saveNow(p);
  aiSay(p, `${UPGRADES[k].name} upgraded to level ${next}. I can feel the difference, {addr}.`);
}

async function blueprintMenu(p, loc) {
  const h = hero(p), x = exoData(h);
  const items = BP_KEYS.map((k) => knows(h, k)
    ? [`§a✔ §f${BLUEPRINTS[k].name}\n§8${BLUEPRINTS[k].desc}`.slice(0, 150), BLUEPRINTS[k].icon]
    : [`§7${BLUEPRINTS[k].name}\n§8${BLUEPRINTS[k].data} Schematic Data + materials`, "x_blueprint"]);
  items.push(["Back", "act_back"]);
  const sel = await menu(p, "Blueprints", `§7Research turns Schematic Data into new designs. You have §f${count(p, DATA)}§7.`, items);
  if (sel < 0) return;
  if (sel >= BP_KEYS.length) return openWorkshop(p, loc);
  const k = BP_KEYS[sel], B = BLUEPRINTS[k];
  if (knows(h, k)) { aiSay(p, `${B.name}: ${B.desc}`, { chat: true }); return blueprintMenu(p, loc); }
  const cost = [R(DATA, B.data), ...B.need];
  const ok = await menu(p, B.name, `§7${B.desc}\n§fResearch: ${needText(p, cost)}`, [["Research", "x_blueprint"], ["Back", "act_back"]]);
  if (ok !== 0) return blueprintMenu(p, loc);
  if (!pay(p, cost)) return;
  await scene(p, loc, `Researching ${B.name}`, 90, B.kind === "mark");
  x.bp.push(k);
  saveNow(p);
  msg(p, `§b§lBLUEPRINT LEARNED: §r§f${B.name}`);
  aiSay(p, B.kind === "mark" ? `Plans for the ${B.name} are in my memory, {addr}. Build it whenever you like.` : `${B.name} is installed in my library, {addr}.`, { chat: false });
}

async function fabMenu(p, loc) {
  const items = FABRICATE.map((rec) => [`${hasAll(p, rec.need) ? "§a" : "§7"}${rec.name}\n§8${needText(p, rec.need)}`.slice(0, 160), hasAll(p, rec.need) ? "active" : "act_back"]);
  items.push(["Back", "act_back"]);
  const sel = await menu(p, "Fabricate", "§7Green = you have everything.", items);
  if (sel < 0) return;
  if (sel >= FABRICATE.length) return openWorkshop(p, loc);
  const rec = FABRICATE[sel];
  if (!pay(p, rec.need)) return;
  await scene(p, loc, rec.name, rec.time, !!rec.big);
  give(p, rec.out, 1);
  msg(p, `§b§lFABRICATED: §r§f${rec.name}`);
}

async function aiMenu(p, loc) {
  const x = exoData(hero(p)), a = aiOf(p);
  const ni = AI_NAMES.indexOf(a.name.toUpperCase());
  const ai = ADDRESS.indexOf(a.addr);
  const f = new ModalFormData().title("Your assistant")
    .dropdown("Name §8(these names also work as their own command: /atlas, /vega ...)", [...AI_NAMES, "Custom name"], { defaultValueIndex: ni >= 0 ? ni : AI_NAMES.length })
    .textField("Custom name §8(any name works with /ai and /hey <name>)", "JARVIS-like name", { defaultValue: ni >= 0 ? "" : a.name })
    .dropdown("It calls you", [...ADDRESS, "my name", "custom"], { defaultValueIndex: a.addr === p.name ? ADDRESS.length : ai >= 0 ? ai : ADDRESS.length + 1 })
    .textField("Custom title", "commander", { defaultValue: ai < 0 && a.addr !== p.name ? a.addr : "" })
    .toggle("Callouts (warnings and banter)", { defaultValue: a.chatter });
  const res = await show(p, f);
  if (!res || res.canceled) return openWorkshop(p, loc);
  const [n, cn, ad, ca, ch] = res.formValues;
  const clean = (s, max) => String(s ?? "").replace(/§./g, "").replace(/[^A-Za-z0-9' -]/g, "").trim().slice(0, max);
  x.ai.name = (Number(n) < AI_NAMES.length ? AI_NAMES[Number(n)] : clean(cn, 12).toUpperCase()) || "ATLAS";
  x.ai.addr = Number(ad) < ADDRESS.length ? ADDRESS[Number(ad)] : Number(ad) === ADDRESS.length ? p.name : (clean(ca, 16) || "sir");
  x.ai.chatter = !!ch;
  markDirty(p);
  aiSay(p, `Hello, {addr}. ${x.ai.name}, at your service. Ask me anything: /ai where's the closest diamonds`);
}
